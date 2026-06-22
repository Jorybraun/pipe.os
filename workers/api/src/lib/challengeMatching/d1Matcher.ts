import {
  alignCandidateToChallenge,
  compileCandidateMatchQuery,
  explainChallengeMatch,
  rankReviewChallenges,
  recallReviewChallenges,
} from './engine';
import type {
  CandidateSignal,
  ChallengePacket,
  EvidenceLevel,
  MatchExplanation,
  QueryPurpose,
  SourceRef,
} from './types';
import {
  hashObject,
  stableId,
  stableJson,
  type ChallengePacket as RepoChallengePacket,
} from '../repoSemanticGraph';
import { LivingContextStore } from '../livingContext/persistence';
import { openSemanticTerm } from '../livingContext/openTerms';
import type {
  ContextRecordConceptInput,
  ContextRecordEntityInput,
  ContextRecordInput,
  ContextRecordSourceInput,
  JsonObject,
  JsonValue,
} from '../livingContext/types';

interface CandidateEvidenceRow {
  context_record_id: string | null;
  assertion_id: string | null;
  source_span_id: string;
  episode_id: string | null;
  narrative: string;
  confidence: number | null;
  evidence_level: EvidenceLevel | null;
  strength: number | null;
  artifact_version_id: string;
  content_hash: string;
  byte_start: number | null;
  byte_end: number | null;
  char_start: number | null;
  char_end: number | null;
  exact_text: string;
  qualifiers_json: string;
  concept_key: string | null;
  concept_weight: number | null;
}

interface PacketRow {
  id: string;
  repo_id: number;
  pr_number: number | null;
  production_ready: number;
  quality_score: number | null;
  source_hash: string | null;
  packet_json: string;
}

interface RepoSpanRow {
  id: string;
  artifact_version_id: string;
  content_hash: string;
  byte_start: number | null;
  byte_end: number | null;
  exact_text: string;
  path: string | null;
}

export interface ChallengePacketLoadExclusion {
  id: string;
  repoId: string;
  prNumber: number | null;
  packetContentHash?: string | null;
  reason:
    | 'DEMAND_WITHOUT_SOURCE_SPANS'
    | 'MISSING_DEMAND_SOURCE_SPANS'
    | 'PACKET_NOT_PRODUCTION_READY'
    | 'PACKET_PROVENANCE_INVALID';
  demandIds: string[];
  missingSourceSpanIds: string[];
  gateFailures?: string[];
  provenanceFailures?: string[];
  qualityScore?: number | null;
}

export interface RoleGuardrailChallengeExclusion {
  id: string;
  reason: 'ROLE_GUARDRAIL_FAILED';
  repoId?: string;
  prNumber?: number | null;
  packetContentHash?: string | null;
}

export type ChallengeMatchExclusion = ChallengePacketLoadExclusion | RoleGuardrailChallengeExclusion;

export interface ChallengeMatchDiagnostics {
  excludedPackets: ChallengeMatchExclusion[];
  recalledPacketIds: string[];
  evaluatedChallenges: Array<{
    challengeId: string;
    repoId: string;
    prNumber: number;
    packetContentHash?: string | null;
    recallRank: number;
    rank: number | null;
    eligible: boolean;
    rejectionReasons: string[];
    provenanceComplete: boolean;
    alignedDemandCount: number;
    stretchCount: number;
  }>;
}

interface ChallengePacketLoadResult {
  packets: ChallengePacket[];
  exclusions: ChallengePacketLoadExclusion[];
}

const GENERIC_CORPUS_MIN_PACKETS = 3;
const GENERIC_CORPUS_RATIO = 0.4;

function conceptNamespace(canonicalKey: string): string {
  const separator = canonicalKey.indexOf(':');
  return separator > 0 ? canonicalKey.slice(0, separator) : 'open';
}

function conceptLabel(canonicalKey: string): string {
  const separator = canonicalKey.indexOf(':');
  const raw = separator >= 0 ? canonicalKey.slice(separator + 1) : canonicalKey;
  return raw.replace(/[-_]+/g, ' ').trim() || canonicalKey;
}

function conceptsFromRow(row: CandidateEvidenceRow): string[] {
  if (row.concept_key) return [row.concept_key];
  try {
    const qualifiers = JSON.parse(row.qualifiers_json) as {
      extractedProperties?: unknown;
    };
    if (typeof qualifiers.extractedProperties !== 'string') {
      return [];
    }
    const properties = JSON.parse(qualifiers.extractedProperties) as {
      semantic_terms?: Array<{
        surface?: unknown;
        canonical_key?: unknown;
      }>;
    };
    const terms = new Set<string>();
    for (const term of properties.semantic_terms ?? []) {
      if (typeof term.canonical_key === 'string' && term.canonical_key.trim()) {
        terms.add(term.canonical_key.trim());
        continue;
      }
      if (typeof term.surface === 'string') {
        const resolved = openSemanticTerm(term.surface);
        if (resolved) terms.add(resolved.canonicalKey);
      }
    }
    return [...terms];
  } catch {
    return [];
  }
}

function candidateEvidenceId(row: CandidateEvidenceRow): string {
  return row.assertion_id ?? row.context_record_id ?? row.source_span_id;
}

function candidateSourceRef(row: CandidateEvidenceRow): SourceRef {
  const start = row.byte_start ?? row.char_start ?? 0;
  const end = row.byte_end ?? row.char_end ?? Math.max(1, row.exact_text.length);
  const locator = row.context_record_id
    ? `context_record:${row.context_record_id}`
    : `assertion:${row.assertion_id}`;
  return {
    artifactId: row.artifact_version_id,
    artifactVersion: row.artifact_version_id,
    contentHash: row.content_hash,
    startOffset: start,
    endOffset: Math.max(start + 1, end),
    sourceRefType: 'source_span',
    sourceRefId: row.source_span_id,
    sourceSpanId: row.source_span_id,
    locator,
    exactText: row.exact_text,
  };
}

async function loadCandidateSignals(
  db: D1Database,
  candidateId: string,
): Promise<CandidateSignal[]> {
  const result = await db.prepare(
    `SELECT NULL AS context_record_id, sa.id AS assertion_id, ss.id AS source_span_id,
            sa.episode_id, sa.narrative, sa.confidence,
            sa.qualifiers_json,
            (SELECT evidence_level
               FROM signal_evidence selected_evidence
              WHERE selected_evidence.assertion_id = sa.id
                AND (
                  selected_evidence.concept_id = ac.concept_id
                  OR (selected_evidence.concept_id IS NULL AND ac.concept_id IS NULL)
                )
              ORDER BY selected_evidence.strength DESC, selected_evidence.id
              LIMIT 1) AS evidence_level,
            (SELECT MAX(strength)
               FROM signal_evidence strongest_evidence
              WHERE strongest_evidence.assertion_id = sa.id
                AND (
                  strongest_evidence.concept_id = ac.concept_id
                  OR (strongest_evidence.concept_id IS NULL AND ac.concept_id IS NULL)
                )) AS strength,
            ss.artifact_version_id, av.content_hash,
            ss.byte_start, ss.byte_end, ss.char_start, ss.char_end, ss.exact_text,
            c.canonical_key AS concept_key, ac.weight AS concept_weight
       FROM applications app
       JOIN semantic_assertions sa ON sa.workspace_person_id = app.workspace_person_id
       JOIN assertion_source_spans ass ON ass.assertion_id = sa.id
       JOIN source_spans ss ON ss.id = ass.source_span_id
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       LEFT JOIN assertion_concepts ac ON ac.assertion_id = sa.id
       LEFT JOIN concepts c ON c.id = ac.concept_id
      WHERE app.legacy_candidate_id = ?1
      ORDER BY COALESCE(sa.observed_at, sa.created_at) DESC, sa.id, c.canonical_key`,
  ).bind(candidateId).all<CandidateEvidenceRow>();

  const contextResult = await db.prepare(
    `SELECT cr.id AS context_record_id, cr.assertion_id, ss.id AS source_span_id,
            cr.episode_id, cr.narrative, cr.confidence,
            cr.qualifiers_json,
            (SELECT evidence_level
               FROM signal_evidence selected_evidence
              WHERE cr.assertion_id IS NOT NULL
                AND selected_evidence.assertion_id = cr.assertion_id
                AND selected_evidence.concept_id = crc.concept_id
              ORDER BY selected_evidence.strength DESC, selected_evidence.id
              LIMIT 1) AS evidence_level,
            (SELECT MAX(strength)
               FROM signal_evidence strongest_evidence
              WHERE cr.assertion_id IS NOT NULL
                AND strongest_evidence.assertion_id = cr.assertion_id
                AND strongest_evidence.concept_id = crc.concept_id) AS strength,
            ss.artifact_version_id, av.content_hash,
            ss.byte_start, ss.byte_end, ss.char_start, ss.char_end, ss.exact_text,
            c.canonical_key AS concept_key, crc.weight AS concept_weight
       FROM applications app
       JOIN context_records cr ON cr.workspace_person_id = app.workspace_person_id
       JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
       JOIN source_spans ss ON ss.id = crsr.source_span_id
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN context_record_concepts crc ON crc.context_record_id = cr.id
       JOIN concepts c ON c.id = crc.concept_id
      WHERE app.legacy_candidate_id = ?1
      ORDER BY COALESCE(cr.observed_at, cr.created_at) DESC, cr.id, c.canonical_key`,
  ).bind(candidateId).all<CandidateEvidenceRow>();

  const signals: CandidateSignal[] = [];
  const seen = new Set<string>();
  for (const row of [...(result.results ?? []), ...(contextResult.results ?? [])]) {
    const concepts = conceptsFromRow(row);
    const baseId = candidateEvidenceId(row);
    const purpose: QueryPurpose = 'validation';
    const id = row.concept_key ? `${baseId}:${row.concept_key}` : baseId;
    const sourceRef = candidateSourceRef(row);
    const dedupeKey = [
      id,
      sourceRef.sourceSpanId ?? sourceRef.sourceRefId ?? sourceRef.locator ?? '',
      row.evidence_level ?? '',
      row.strength ?? '',
    ].join('\u0000');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const signal: CandidateSignal = {
      id,
      episodeId: row.episode_id ?? baseId,
      narrative: row.narrative,
      purpose,
      evidenceLevel: row.evidence_level,
      evidenceStrength: row.strength != null && row.concept_weight != null
        ? row.strength * row.concept_weight
        : null,
      confidence: row.confidence,
      concepts,
      sourceRefs: [sourceRef],
    };
    signals.push(signal);
  }
  return signals;
}

function packetSourceRef(span: RepoSpanRow): SourceRef {
  const start = span.byte_start ?? 0;
  const end = span.byte_end ?? Math.max(1, span.exact_text.length);
  return {
    artifactId: span.artifact_version_id,
    artifactVersion: span.artifact_version_id,
    contentHash: span.content_hash,
    startOffset: start,
    endOffset: Math.max(start + 1, end),
    sourceRefType: 'repo_source_span',
    sourceRefId: span.id,
    locator: span.path ? `${span.path}:${start}-${end}` : span.id,
    exactText: span.exact_text,
  };
}

function packetDemandIds(packet: Partial<RepoChallengePacket> | null): string[] {
  return Array.isArray(packet?.demands)
    ? packet.demands
      .map((demand) => demand?.id)
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      .sort()
    : [];
}

function packetGateFailures(packet: Partial<RepoChallengePacket> | null): string[] {
  return Array.isArray(packet?.quality?.gates)
    ? packet.quality.gates
      .filter((gate) => gate && gate.passed === false && typeof gate.gate === 'string')
      .map((gate) => gate.gate)
      .sort()
    : [];
}

function packetPrNumber(row: PacketRow, packet: Partial<RepoChallengePacket> | null): number | null {
  return row.pr_number ?? (
    typeof packet?.pullRequest?.number === 'number' ? packet.pullRequest.number : null
  );
}

function packetIdentity(packet: RepoChallengePacket): {
  repoSnapshotId: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  policyVersion: 'repo-challenge-v1';
} {
  return {
    repoSnapshotId: packet.repoSnapshotId,
    prNumber: packet.pullRequest.number,
    baseSha: packet.pullRequest.baseSha.toLowerCase(),
    headSha: packet.pullRequest.headSha.toLowerCase(),
    policyVersion: packet.policyVersion,
  };
}

async function challengePacketIntegrityFailures(
  row: PacketRow,
  packet: RepoChallengePacket,
): Promise<string[]> {
  const failures: string[] = [];
  const identity = packetIdentity(packet);
  const expectedPacketId = await stableId('challenge_packet', identity);
  const packetSpanIds = new Set(packet.sourceSpanIds);
  const demandFamilies = packet.demands.map((demand) => demand.family).sort();
  const content = {
    ...identity,
    repository: packet.repository,
    pullRequest: {
      number: packet.pullRequest.number,
      url: packet.pullRequest.url,
      title: packet.pullRequest.title,
      body: packet.pullRequest.body,
      author: packet.pullRequest.author,
      baseSha: identity.baseSha,
      headSha: identity.headSha,
      mergedAt: packet.pullRequest.mergedAt,
    },
    languageSupport: packet.languageSupport,
    changedFilePaths: packet.changedFilePaths,
    changedSymbolIds: packet.changedSymbolIds,
    sourceSpanIds: packet.sourceSpanIds,
    testChanges: packet.testChanges,
    issue: packet.issue,
    demands: packet.demands,
    demandFamilies: packet.demandFamilies,
    quality: packet.quality,
  };
  const expectedPacketHash = await hashObject(content);

  if (packet.id !== row.id) {
    failures.push(`packet row id ${row.id} does not match packet JSON id ${packet.id}`);
  }
  if (row.pr_number !== null && row.pr_number !== packet.pullRequest.number) {
    failures.push(`packet row PR ${row.pr_number} does not match packet PR ${packet.pullRequest.number}`);
  }
  if (packet.id !== expectedPacketId) {
    failures.push(`packet id ${packet.id} does not match normalized identity ${expectedPacketId}`);
  }
  if (row.source_hash !== packet.contentHash) {
    failures.push('packet source_hash does not match packet contentHash');
  }
  if (packet.contentHash !== expectedPacketHash) {
    failures.push(`packet contentHash is stale; expected ${expectedPacketHash}`);
  }
  if (stableJson(packet.demandFamilies) !== stableJson(demandFamilies)) {
    failures.push('packet demandFamilies do not match packet demands');
  }

  for (const demand of packet.demands) {
    const demandSpansMissingFromPacket = demand.sourceSpanIds.filter((spanId) => !packetSpanIds.has(spanId));
    if (demandSpansMissingFromPacket.length > 0) {
      failures.push(`demand ${demand.id} references spans absent from packet: ${demandSpansMissingFromPacket.join(', ')}`);
    }
    const demandIdentity = {
      repoSnapshotId: packet.repoSnapshotId,
      prNumber: packet.pullRequest.number,
      family: demand.family,
      sourceSpanIds: demand.sourceSpanIds,
    };
    const expectedDemandId = await stableId('challenge_demand', demandIdentity);
    const expectedDemandHash = await hashObject({
      ...demandIdentity,
      narrative: demand.narrative,
      conceptKeys: demand.conceptKeys,
      problems: demand.problems,
      mechanisms: demand.mechanisms,
      domains: demand.domains,
      businessObjects: demand.businessObjects,
      ownershipActions: demand.ownershipActions,
      changedSymbolIds: demand.changedSymbolIds,
    });
    if (demand.id !== expectedDemandId) {
      failures.push(`demand ${demand.id} does not match normalized identity ${expectedDemandId}`);
    }
    if (demand.contentHash !== expectedDemandHash) {
      failures.push(`demand ${demand.id} contentHash is stale`);
    }
  }

  return failures.sort();
}

export function materializeChallengePacketForMatching(
  repoId: number,
  packet: RepoChallengePacket,
  spanById: Map<string, RepoSpanRow>,
  roleConcepts?: string[],
  packetContentHash?: string | null,
): { packet: ChallengePacket } | { exclusion: ChallengePacketLoadExclusion } {
  const demandsWithoutSpans = packet.demands
    .filter((demand) => demand.sourceSpanIds.length === 0)
    .map((demand) => demand.id)
    .sort();
  if (demandsWithoutSpans.length > 0) {
    return {
      exclusion: {
        id: packet.id,
        repoId: String(repoId),
        prNumber: packet.pullRequest.number,
        packetContentHash: packetContentHash ?? packet.contentHash,
        reason: 'DEMAND_WITHOUT_SOURCE_SPANS',
        demandIds: demandsWithoutSpans,
        missingSourceSpanIds: [],
      },
    };
  }

  const missingByDemand = packet.demands.flatMap((demand) =>
    demand.sourceSpanIds
      .filter((spanId) => !spanById.has(spanId))
      .map((spanId) => ({ demandId: demand.id, spanId })),
  );
  if (missingByDemand.length > 0) {
    return {
      exclusion: {
        id: packet.id,
        repoId: String(repoId),
        prNumber: packet.pullRequest.number,
        packetContentHash: packetContentHash ?? packet.contentHash,
        reason: 'MISSING_DEMAND_SOURCE_SPANS',
        demandIds: [...new Set(missingByDemand.map((entry) => entry.demandId))].sort(),
        missingSourceSpanIds: [...new Set(missingByDemand.map((entry) => entry.spanId))].sort(),
      },
    };
  }

  const roleConceptSet = roleConcepts ? new Set(roleConcepts) : null;
  const roleDemands = roleConceptSet
    ? packet.demands.filter((demand) => demand.conceptKeys.some((key) => roleConceptSet.has(key)))
    : packet.demands;
  const maxRoleWeight = roleDemands.length > 0
    ? Math.max(...roleDemands.map((demand) => demand.weight))
    : null;

  return {
    packet: {
      id: packet.id,
      repoId: String(repoId),
      prNumber: packet.pullRequest.number,
      sourceVersion: packet.repoSnapshotId,
      packetContentHash: packetContentHash ?? packet.contentHash,
      challengeReady: packet.quality.eligible,
      languages: [packet.languageSupport.normalizedLanguage],
      seniority: undefined,
      concepts: [...new Set(packet.demands.flatMap((demand) => demand.conceptKeys))],
      demands: packet.demands.map((demand) => {
        const concepts = demand.conceptKeys;
        const sourceRefs = demand.sourceSpanIds.map((spanId) => packetSourceRef(spanById.get(spanId)!));
        return {
          id: demand.id,
          family: demand.family,
          narrative: demand.narrative,
          weight: demand.weight,
          concepts,
          problems: demand.problems,
          mechanisms: demand.mechanisms,
          domains: demand.domains,
          businessObjects: demand.businessObjects,
          ownershipActions: demand.ownershipActions,
          sourceRefs,
          roleRequirement: roleConceptSet
            ? demand.conceptKeys.some((key) => roleConceptSet.has(key))
            : true,
          highWeightRoleRequirement: maxRoleWeight !== null
            && demand.weight === maxRoleWeight
            && (!roleConceptSet || demand.conceptKeys.some((key) => roleConceptSet.has(key))),
        };
      }),
      quality: {
        deterministic: packet.quality.score,
        contextualSpecificity: packet.quality.metrics.demandDiversity,
      },
    },
  };
}

async function loadChallengePackets(
  db: D1Database,
  roleConcepts?: string[],
): Promise<ChallengePacketLoadResult> {
  const rows = await db.prepare(
    `SELECT id, repo_id, pr_number, production_ready, quality_score, source_hash, packet_json
       FROM review_challenge_packets
      ORDER BY repo_id, pr_number`,
  ).all<PacketRow>();
  const packets: ChallengePacket[] = [];
  const exclusions: ChallengePacketLoadExclusion[] = [];

  for (const row of rows.results ?? []) {
    let packet: RepoChallengePacket | null = null;
    try {
      packet = JSON.parse(row.packet_json) as RepoChallengePacket;
    } catch {
      exclusions.push({
        id: row.id,
        repoId: String(row.repo_id),
        prNumber: row.pr_number,
        packetContentHash: row.source_hash,
        reason: 'PACKET_PROVENANCE_INVALID',
        demandIds: [],
        missingSourceSpanIds: [],
        provenanceFailures: ['packet_json could not be parsed'],
        qualityScore: row.quality_score,
      });
      continue;
    }

    if (row.production_ready !== 1 || (row.quality_score ?? 0) < 0.70) {
      exclusions.push({
        id: row.id,
        repoId: String(row.repo_id),
        prNumber: packetPrNumber(row, packet),
        packetContentHash: row.source_hash ?? packet.contentHash,
        reason: 'PACKET_NOT_PRODUCTION_READY',
        demandIds: packetDemandIds(packet),
        missingSourceSpanIds: [],
        gateFailures: packetGateFailures(packet),
        qualityScore: row.quality_score,
      });
      continue;
    }

    let provenanceFailures: string[];
    try {
      provenanceFailures = await challengePacketIntegrityFailures(row, packet);
    } catch (error) {
      provenanceFailures = [
        `packet_json does not match challenge packet schema: ${error instanceof Error ? error.message : String(error)}`,
      ];
    }
    if (provenanceFailures.length > 0) {
      exclusions.push({
        id: row.id,
        repoId: String(row.repo_id),
        prNumber: packetPrNumber(row, packet),
        packetContentHash: row.source_hash ?? packet.contentHash,
        reason: 'PACKET_PROVENANCE_INVALID',
        demandIds: packetDemandIds(packet),
        missingSourceSpanIds: [],
        provenanceFailures,
        qualityScore: row.quality_score,
      });
      continue;
    }

    const spanIds = [...new Set(packet.demands.flatMap((demand) => demand.sourceSpanIds))];
    if (spanIds.length === 0) {
      const loaded = materializeChallengePacketForMatching(
        row.repo_id,
        packet,
        new Map(),
        roleConcepts,
        row.source_hash ?? packet.contentHash,
      );
      if ('exclusion' in loaded) exclusions.push(loaded.exclusion);
      continue;
    }
    const placeholders = spanIds.map(() => '?').join(',');
    const spans = await db.prepare(
      `SELECT id, artifact_version_id, content_hash, byte_start, byte_end, exact_text, path
         FROM repo_source_spans WHERE id IN (${placeholders})`,
    ).bind(...spanIds).all<RepoSpanRow>();
    const spanById = new Map((spans.results ?? []).map((span) => [span.id, span]));
    const loaded = materializeChallengePacketForMatching(
      row.repo_id,
      packet,
      spanById,
      roleConcepts,
      row.source_hash ?? packet.contentHash,
    );
    if ('exclusion' in loaded) exclusions.push(loaded.exclusion);
    else packets.push(loaded.packet);
  }
  return { packets, exclusions };
}

export function deriveCorpusGenericConcepts(challenges: ChallengePacket[]): string[] {
  if (challenges.length < GENERIC_CORPUS_MIN_PACKETS) return [];
  const packetFrequency = new Map<string, number>();
  for (const challenge of challenges) {
    for (const concept of new Set(challenge.concepts)) {
      packetFrequency.set(concept, (packetFrequency.get(concept) ?? 0) + 1);
    }
  }
  const minimumFrequency = Math.max(
    GENERIC_CORPUS_MIN_PACKETS,
    Math.ceil(challenges.length * GENERIC_CORPUS_RATIO),
  );
  return [...packetFrequency.entries()]
    .filter(([, frequency]) => frequency >= minimumFrequency)
    .map(([concept]) => concept)
    .sort();
}

export interface CandidateReviewChallengeMatch {
  status: 'MATCHED' | 'NEEDS_MORE_EVIDENCE' | 'NO_ROLE_SAFE_CHALLENGE';
  matchRunId: string;
  repoId?: number;
  prNumber?: number;
  explanation?: MatchExplanation;
  diagnostics?: ChallengeMatchDiagnostics;
}

export interface CandidateReviewChallengeOptions {
  roleSnapshotId?: string;
  roleContextId?: string;
  requiredLanguages?: string[];
  requiredConcepts?: string[];
  forbiddenConcepts?: string[];
  roleConcepts?: string[];
  conceptResolverVersion?: string;
  roleSourceReferences?: Array<{
    entityId: string;
    locator: string;
    conceptKeys: string[];
  }>;
}

function sourceRefToContextSource(
  ref: SourceRef,
  evidenceRole: string,
): ContextRecordSourceInput | null {
  if (!ref.sourceRefType || !ref.sourceRefId) return null;
  return {
    sourceRefType: ref.sourceRefType,
    sourceRefId: ref.sourceRefId,
    sourceSpanId: ref.sourceRefType === 'source_span' ? ref.sourceSpanId ?? ref.sourceRefId : null,
    evidenceRole,
    locator: {
      artifactId: ref.artifactId,
      artifactVersion: ref.artifactVersion,
      locator: ref.locator ?? null,
      startOffset: ref.startOffset,
      endOffset: ref.endOffset,
    },
    exactText: ref.exactText ?? null,
    contentHash: ref.contentHash,
  };
}

async function buildMatchContextConcepts(
  store: LivingContextStore,
  input: {
    matchRunId: string;
    query: ReturnType<typeof compileCandidateMatchQuery>['query'];
    selected: ReturnType<typeof alignCandidateToChallenge> | undefined;
  },
): Promise<ContextRecordConceptInput[]> {
  if (!input.selected) return [];
  const conceptKeys = new Set<string>();
  for (const alignment of input.selected.alignments) {
    const demandConcepts = new Set(alignment.demand.concepts);
    for (const concept of alignment.atom.concepts) {
      if (demandConcepts.has(concept)) conceptKeys.add(concept);
    }
  }

  const concepts: ContextRecordConceptInput[] = [];
  for (const canonicalKey of [...conceptKeys].map((key) => key.trim()).filter(Boolean).sort()) {
    const concept = await store.upsertConcept({
      ingestionKey: `match-open-concept:${canonicalKey}`,
      canonicalKey,
      namespace: conceptNamespace(canonicalKey),
      label: conceptLabel(canonicalKey),
      metadata: {
        source: 'candidate_pr_match_decision',
        matchRunId: input.matchRunId,
        policyVersion: input.query.policyVersion,
        selectedPacketId: input.selected.challenge.id,
      },
    });
    concepts.push({
      conceptId: concept.id,
      relationship: 'concept',
      weight: 1,
    });
  }
  return concepts;
}

function buildMatchContextRecordInput(input: {
  matchRunId: string;
  candidateId: string;
  applicationId: string | null;
  roleContextId: string | null;
  status: CandidateReviewChallengeMatch['status'];
  query: ReturnType<typeof compileCandidateMatchQuery>['query'];
  selected: ReturnType<typeof alignCandidateToChallenge> | undefined;
  evaluated: ReturnType<typeof alignCandidateToChallenge>[];
  diagnostics: ChallengeMatchDiagnostics;
  conceptResolverVersion: string | null;
  roleSourceReferences: NonNullable<CandidateReviewChallengeOptions['roleSourceReferences']>;
  concepts: ContextRecordConceptInput[];
}): ContextRecordInput {
  const selectedPacketId = input.selected?.challenge.id ?? null;
  const packetContentHashById = new Map<string, string>();
  const rememberPacketContentHash = (packetId: string | null | undefined, hash: string | null | undefined) => {
    if (packetId && hash) packetContentHashById.set(packetId, hash);
  };
  rememberPacketContentHash(selectedPacketId, input.selected?.challenge.packetContentHash);
  for (const alignment of input.evaluated) {
    rememberPacketContentHash(alignment.challenge.id, alignment.challenge.packetContentHash);
  }
  for (const packet of input.diagnostics.excludedPackets) {
    rememberPacketContentHash(packet.id, packet.packetContentHash);
  }
  for (const challenge of input.diagnostics.evaluatedChallenges) {
    rememberPacketContentHash(challenge.challengeId, challenge.packetContentHash);
  }
  const evidenceSources: ContextRecordSourceInput[] = [
    {
      sourceRefType: 'match_run',
      sourceRefId: input.matchRunId,
      evidenceRole: 'decision_record',
      locator: {
        candidateId: input.candidateId,
        roleSnapshotId: input.query.roleSnapshotId,
        status: input.status,
      },
      metadata: {
        policyVersion: input.query.policyVersion,
        modelVersion: input.conceptResolverVersion,
      },
    },
  ];

  const packetIds = new Set<string>();
  if (selectedPacketId) packetIds.add(selectedPacketId);
  for (const packetId of input.diagnostics.recalledPacketIds) packetIds.add(packetId);
  for (const packet of input.diagnostics.excludedPackets) packetIds.add(packet.id);
  for (const evaluated of input.diagnostics.evaluatedChallenges) packetIds.add(evaluated.challengeId);
  for (const packetId of [...packetIds].sort()) {
    evidenceSources.push({
      sourceRefType: 'review_challenge_packet',
      sourceRefId: packetId,
      evidenceRole: packetId === selectedPacketId ? 'selected_packet' : 'considered_packet',
      contentHash: packetContentHashById.get(packetId) ?? null,
      locator: {
        matchRunId: input.matchRunId,
        selected: packetId === selectedPacketId,
      },
    });
  }

  for (const roleSource of input.roleSourceReferences) {
    evidenceSources.push({
      sourceRefType: 'role_source',
      sourceRefId: roleSource.entityId,
      evidenceRole: 'role_source',
      locator: {
        roleContextId: input.roleContextId,
        locator: roleSource.locator,
      },
      metadata: {
        conceptKeys: roleSource.conceptKeys,
      },
    });
  }

  for (const alignment of input.evaluated) {
    for (const entry of alignment.alignments) {
      for (const sourceRef of entry.atom.sourceRefs) {
        const source = sourceRefToContextSource(sourceRef, alignment.challenge.id === selectedPacketId
          ? 'selected_candidate_evidence'
          : 'candidate_evidence');
        if (source) evidenceSources.push(source);
      }
      for (const sourceRef of entry.demand.sourceRefs) {
        const source = sourceRefToContextSource(sourceRef, alignment.challenge.id === selectedPacketId
          ? 'selected_repo_evidence'
          : 'repo_evidence');
        if (source) evidenceSources.push(source);
      }
    }
  }

  const entities: ContextRecordEntityInput[] = [
    {
      entityType: 'match_run',
      entityId: input.matchRunId,
      relationship: 'decision_record',
    },
    {
      entityType: 'candidate',
      entityId: input.candidateId,
      relationship: 'candidate',
    },
    {
      entityType: 'role_snapshot',
      entityId: input.query.roleSnapshotId,
      relationship: 'role_context',
    },
    {
      entityType: 'match_status',
      relationship: 'outcome',
      value: { status: input.status },
    },
  ];
  if (input.applicationId) {
    entities.push({
      entityType: 'application',
      entityId: input.applicationId,
      relationship: 'application',
    });
  }
  if (input.roleContextId) {
    entities.push({
      entityType: 'role_context',
      entityId: input.roleContextId,
      relationship: 'role_context',
    });
  }
  if (input.selected) {
    entities.push(
      {
        entityType: 'review_challenge_packet',
        entityId: input.selected.challenge.id,
        relationship: 'selected_packet',
        metadata: {
          repoId: input.selected.challenge.repoId,
          prNumber: input.selected.challenge.prNumber,
          score: input.selected.finalScore,
        },
      },
      {
        entityType: 'pull_request',
        entityId: `${input.selected.challenge.repoId}#${input.selected.challenge.prNumber}`,
        relationship: 'selected_pull_request',
        metadata: {
          repoId: input.selected.challenge.repoId,
          prNumber: input.selected.challenge.prNumber,
        },
      },
    );
  }
  for (const packet of input.diagnostics.excludedPackets) {
    entities.push({
      entityType: 'review_challenge_packet',
      entityId: packet.id,
      relationship: 'rejected_packet',
      metadata: packet as unknown as JsonObject,
    });
  }
  for (const challenge of input.diagnostics.evaluatedChallenges) {
    entities.push({
      entityType: 'review_challenge_packet',
      entityId: challenge.challengeId,
      relationship: challenge.challengeId === selectedPacketId ? 'selected_evaluation' : 'evaluated_packet',
      metadata: {
        repoId: challenge.repoId,
        prNumber: challenge.prNumber,
        recallRank: challenge.recallRank,
        rank: challenge.rank,
        eligible: challenge.eligible,
        rejectionReasons: challenge.rejectionReasons,
        provenanceComplete: challenge.provenanceComplete,
        alignedDemandCount: challenge.alignedDemandCount,
        stretchCount: challenge.stretchCount,
      },
    });
  }

  return {
    ingestionKey: `match-run:${input.matchRunId}:context`,
    scopeType: 'match_run',
    scopeId: input.matchRunId,
    recordType: 'candidate_pr_match_decision',
    predicate: input.status === 'MATCHED'
      ? 'selects review challenge'
      : 'records match diagnostic',
    narrative: input.status === 'MATCHED' && input.selected
      ? `Matched candidate ${input.candidateId} to PR #${input.selected.challenge.prNumber} from repo ${input.selected.challenge.repoId}.`
      : `Match run for candidate ${input.candidateId} returned ${input.status}.`,
    qualifiers: {
      status: input.status,
      candidateSnapshotId: input.query.candidateSnapshotId,
      roleSnapshotId: input.query.roleSnapshotId,
      policyVersion: input.query.policyVersion,
      modelVersion: input.conceptResolverVersion,
      selectedPacketId,
      recalledPacketIds: input.diagnostics.recalledPacketIds,
      excludedPackets: input.diagnostics.excludedPackets as unknown as JsonValue,
      evaluatedChallenges: input.diagnostics.evaluatedChallenges as unknown as JsonValue,
      alignmentScores: input.evaluated.map((alignment) => ({
        challengeId: alignment.challenge.id,
        score: alignment.finalScore,
        eligible: alignment.eligible,
        alignedDemandCount: alignment.alignments.length,
        stretchCount: alignment.stretchCount,
      })) as unknown as JsonValue,
    },
    confidence: input.selected?.finalScore ?? null,
    extractionVersion: input.query.policyVersion,
    sources: evidenceSources,
    entities,
    concepts: input.concepts,
  };
}

function rejectedPacketExplanations(
  diagnostics: ChallengeMatchDiagnostics,
): MatchExplanation['rejectedPackets'] {
  const rejected = new Map<string, MatchExplanation['rejectedPackets'][number]>();
  for (const packet of diagnostics.excludedPackets) {
    rejected.set(packet.id, {
      id: packet.id,
      repoId: 'repoId' in packet ? packet.repoId : undefined,
      prNumber: 'prNumber' in packet ? packet.prNumber : undefined,
      reasons: [packet.reason],
      demandIds: 'demandIds' in packet ? packet.demandIds : undefined,
      missingSourceSpanIds: 'missingSourceSpanIds' in packet ? packet.missingSourceSpanIds : undefined,
      gateFailures: 'gateFailures' in packet ? packet.gateFailures : undefined,
      provenanceFailures: 'provenanceFailures' in packet ? packet.provenanceFailures : undefined,
      qualityScore: 'qualityScore' in packet ? packet.qualityScore : undefined,
    });
  }
  for (const challenge of diagnostics.evaluatedChallenges) {
    if (challenge.eligible) continue;
    rejected.set(challenge.challengeId, {
      id: challenge.challengeId,
      repoId: challenge.repoId,
      prNumber: challenge.prNumber,
      reasons: challenge.rejectionReasons,
    });
  }
  return [...rejected.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function diagnosticMissingEvidence(input: {
  status: CandidateReviewChallengeMatch['status'];
  compiledStatus: ReturnType<typeof compileCandidateMatchQuery>['status'];
  excludedSignalIds: string[];
  diagnostics: ChallengeMatchDiagnostics;
}): MatchExplanation['missingEvidence'] {
  const missing: MatchExplanation['missingEvidence'] = [];
  if (input.compiledStatus === 'NEEDS_MORE_EVIDENCE') {
    missing.push({
      scope: 'candidate',
      reason: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
    });
  }
  if (input.excludedSignalIds.length > 0) {
    missing.push({
      scope: 'candidate',
      reason: 'CANDIDATE_SIGNALS_EXCLUDED_FOR_MISSING_OR_NULL_EVIDENCE',
    });
  }
  for (const packet of input.diagnostics.excludedPackets) {
    if ('missingSourceSpanIds' in packet && packet.missingSourceSpanIds.length > 0) {
      missing.push({
        scope: 'repo',
        reason: packet.reason,
        challengeId: packet.id,
        sourceRefs: [],
      });
    }
    if ('reason' in packet && packet.reason === 'PACKET_PROVENANCE_INVALID') {
      missing.push({
        scope: 'repo',
        reason: packet.reason,
        challengeId: packet.id,
        sourceRefs: [],
      });
    }
  }
  if (
    input.status === 'NO_ROLE_SAFE_CHALLENGE'
    && input.diagnostics.recalledPacketIds.length === 0
    && input.diagnostics.excludedPackets.length === 0
  ) {
    missing.push({
      scope: 'challenge',
      reason: 'NO_SOURCE_BACKED_ROLE_SAFE_CHALLENGE_RECALLED',
    });
  }
  return missing;
}

function buildRunExplanation(input: {
  status: CandidateReviewChallengeMatch['status'];
  matchRunId: string;
  compiled: ReturnType<typeof compileCandidateMatchQuery>;
  selected: ReturnType<typeof alignCandidateToChallenge> | undefined;
  diagnostics: ChallengeMatchDiagnostics;
}): MatchExplanation {
  const rejectedPackets = rejectedPacketExplanations(input.diagnostics);
  const missingEvidence = diagnosticMissingEvidence({
    status: input.status,
    compiledStatus: input.compiled.status,
    excludedSignalIds: input.compiled.excludedSignalIds,
    diagnostics: input.diagnostics,
  });
  if (input.selected) {
    return explainChallengeMatch(input.selected, { rejectedPackets, missingEvidence });
  }
  return {
    status: input.status,
    score: 0,
    summary: input.status === 'NEEDS_MORE_EVIDENCE'
      ? `Match run ${input.matchRunId} needs more source-backed candidate evidence.`
      : `Match run ${input.matchRunId} found no role-safe source-backed review challenge.`,
    evidence: [],
    candidateSpans: [],
    repoSpans: [],
    rejectedPackets,
    missingEvidence,
    stretchAreas: [],
    unmatchedDemandIds: [],
    rejectionReasons: input.status === 'NEEDS_MORE_EVIDENCE'
      ? ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE']
      : ['NO_ROLE_SAFE_CHALLENGE'],
  };
}

export async function matchCandidateToReviewChallenge(
  db: D1Database,
  candidateId: string,
  options: CandidateReviewChallengeOptions = {},
): Promise<CandidateReviewChallengeMatch> {
  const [signals, challengeLoad] = await Promise.all([
    loadCandidateSignals(db, candidateId),
    loadChallengePackets(db, options.roleConcepts),
  ]);
  const { packets: challenges, exclusions: packetLoadExclusions } = challengeLoad;
  const genericConcepts = deriveCorpusGenericConcepts(challenges);
  const genericConceptSet = new Set(genericConcepts);
  const challengeSelectionConcepts = [...new Set(
    challenges.flatMap((challenge) => challenge.concepts),
  )].filter((concept) => !genericConceptSet.has(concept));
  const compiled = compileCandidateMatchQuery({
    candidateSnapshotId: `candidate:${candidateId}:living-context-v1`,
    roleSnapshotId: options.roleSnapshotId ?? 'standalone-code-review-v1',
    signals,
    selectionConcepts: options.roleConcepts?.length
      ? options.roleConcepts.filter((concept) => !genericConceptSet.has(concept))
      : challengeSelectionConcepts,
    roleGuardrails: {
      requiredLanguages: options.requiredLanguages ?? [],
      relevantConcepts: options.roleConcepts,
      genericConcepts,
      requiredConcepts: options.requiredConcepts,
      forbiddenConcepts: options.forbiddenConcepts,
      conceptResolverVersion: options.conceptResolverVersion,
      sourceReferences: options.roleSourceReferences,
    },
  });
  const recalled = recallReviewChallenges({ query: compiled.query, challenges });
  const alignments = recalled.challenges.map(({ challenge }) =>
    alignCandidateToChallenge({ query: compiled.query, challenge }),
  );
  const ranked = rankReviewChallenges(compiled.query, alignments);
  const selected = ranked.matches[0]?.alignment;
  const eligibleRankByChallengeId = new Map(
    ranked.matches.map((match) => [match.alignment.challenge.id, match.rank]),
  );
  const evaluated = [...alignments].sort((left, right) =>
    right.finalScore - left.finalScore
    || right.candidateEvidenceAlignment - left.candidateEvidenceAlignment
    || left.challenge.repoId.localeCompare(right.challenge.repoId)
    || left.challenge.prNumber - right.challenge.prNumber
    || left.challenge.id.localeCompare(right.challenge.id)
  );
  const status = compiled.status === 'NEEDS_MORE_EVIDENCE'
    ? 'NEEDS_MORE_EVIDENCE'
    : ranked.status;
  const challengeById = new Map(challenges.map((challenge) => [challenge.id, challenge]));
  const excludedPackets: ChallengeMatchExclusion[] = [
    ...packetLoadExclusions,
    ...recalled.excludedChallengeIds.map((id) => {
      const challenge = challengeById.get(id);
      return {
        id,
        reason: 'ROLE_GUARDRAIL_FAILED' as const,
        repoId: challenge?.repoId,
        prNumber: challenge?.prNumber ?? null,
        packetContentHash: challenge?.packetContentHash,
      };
    }),
  ];
  const evaluatedChallenges = evaluated.map((alignment, index) => ({
    challengeId: alignment.challenge.id,
    repoId: alignment.challenge.repoId,
    prNumber: alignment.challenge.prNumber,
    packetContentHash: alignment.challenge.packetContentHash,
    recallRank: index + 1,
    rank: eligibleRankByChallengeId.get(alignment.challenge.id) ?? null,
    eligible: alignment.eligible,
    rejectionReasons: alignment.rejectionReasons,
    provenanceComplete: alignment.provenanceComplete,
    alignedDemandCount: alignment.alignments.length,
    stretchCount: alignment.stretchCount,
  }));
  const diagnostics: ChallengeMatchDiagnostics = {
    excludedPackets,
    recalledPacketIds: recalled.challenges.map((item) => item.challenge.id),
    evaluatedChallenges,
  };
  const matchRunId = crypto.randomUUID();
  const application = await db.prepare(
    `SELECT id FROM applications WHERE legacy_candidate_id = ?1`,
  ).bind(candidateId).first<{ id: string }>();

  await db.prepare(
    `INSERT INTO match_runs (
       id, candidate_id, application_id, role_context_id,
       candidate_snapshot_id, role_snapshot_id, policy_version, model_version,
       status, query_json, recalled_packets_json, excluded_packets_json,
       ranked_results_json, selected_packet_id, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, unixepoch())`,
  ).bind(
    matchRunId,
    candidateId,
    application?.id ?? null,
    options.roleContextId ?? null,
    compiled.query.candidateSnapshotId,
    compiled.query.roleSnapshotId,
    compiled.query.policyVersion,
    options.conceptResolverVersion ?? null,
    status,
    JSON.stringify(compiled.query),
    JSON.stringify(diagnostics.recalledPacketIds),
    JSON.stringify(diagnostics.excludedPackets),
    JSON.stringify(evaluated.map((alignment, index) => ({
      rank: evaluatedChallenges[index]!.rank,
      recallRank: evaluatedChallenges[index]!.recallRank,
      challengeId: alignment.challenge.id,
      repoId: alignment.challenge.repoId,
      prNumber: alignment.challenge.prNumber,
      sourceVersion: alignment.challenge.sourceVersion,
      score: alignment.finalScore,
      candidateEvidenceAlignment: alignment.candidateEvidenceAlignment,
      roleRelevance: alignment.roleRelevance,
      contextualSpecificity: alignment.contextualSpecificity,
      challengeQuality: alignment.challengeQuality,
      validationDeepeningValue: alignment.validationDeepeningValue,
      alignedDemandCount: alignment.alignments.length,
      stretchCount: alignment.stretchCount,
      stretchDemandWeightRatio: alignment.stretchDemandWeightRatio,
      provenanceComplete: alignment.provenanceComplete,
      eligible: alignment.eligible,
      alignments: alignment.alignments.map((entry) => ({
        atomId: entry.atom.id,
        demandId: entry.demand.id,
        pairScore: entry.pairScore.total,
        pairScoreBreakdown: entry.pairScore,
        weightedScore: entry.weightedScore,
        stretch: entry.stretch ?? null,
        sharedConcepts: entry.atom.concepts.filter((concept) =>
          entry.demand.concepts.includes(concept)
        ),
        candidateSourceRefs: entry.atom.sourceRefs,
        challengeSourceRefs: entry.demand.sourceRefs,
      })),
      rejectionReasons: alignment.rejectionReasons,
    }))),
    selected?.challenge.id ?? null,
  ).run();

  const contextStore = new LivingContextStore(db);
  const matchConcepts = await buildMatchContextConcepts(contextStore, {
    matchRunId,
    query: compiled.query,
    selected,
  });
  await contextStore.upsertContextRecord(buildMatchContextRecordInput({
    matchRunId,
    candidateId,
    applicationId: application?.id ?? null,
    roleContextId: options.roleContextId ?? null,
    status,
    query: compiled.query,
    selected,
    evaluated,
    diagnostics,
    conceptResolverVersion: options.conceptResolverVersion ?? null,
    roleSourceReferences: options.roleSourceReferences ?? [],
    concepts: matchConcepts,
  }));

  const explanation = buildRunExplanation({
    status,
    matchRunId,
    compiled,
    selected,
    diagnostics,
  });

  if (!selected) return { status, matchRunId, explanation, diagnostics };
  return {
    status: 'MATCHED',
    matchRunId,
    repoId: Number(selected.challenge.repoId),
    prNumber: selected.challenge.prNumber,
    explanation,
    diagnostics,
  };
}
