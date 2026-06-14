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
  QueryPurpose,
  SourceRef,
} from './types';
import type { ChallengePacket as RepoChallengePacket } from '../repoSemanticGraph';
import { openSemanticTerm } from '../livingContext/openTerms';

interface CandidateEvidenceRow {
  assertion_id: string;
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

const GENERIC_CORPUS_MIN_PACKETS = 3;
const GENERIC_CORPUS_RATIO = 0.4;

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

function candidateSourceRef(row: CandidateEvidenceRow): SourceRef {
  const start = row.byte_start ?? row.char_start ?? 0;
  const end = row.byte_end ?? row.char_end ?? Math.max(1, row.exact_text.length);
  return {
    artifactId: row.artifact_version_id,
    artifactVersion: row.artifact_version_id,
    contentHash: row.content_hash,
    startOffset: start,
    endOffset: Math.max(start + 1, end),
    locator: `assertion:${row.assertion_id}`,
  };
}

async function loadCandidateSignals(
  db: D1Database,
  candidateId: string,
): Promise<CandidateSignal[]> {
  const result = await db.prepare(
    `SELECT sa.id AS assertion_id, sa.episode_id, sa.narrative, sa.confidence,
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

  const signals: CandidateSignal[] = [];
  for (const row of result.results ?? []) {
    const concepts = conceptsFromRow(row);
    const purpose: QueryPurpose = 'validation';
    const signal: CandidateSignal = {
      id: row.concept_key ? `${row.assertion_id}:${row.concept_key}` : row.assertion_id,
      episodeId: row.episode_id ?? row.assertion_id,
      narrative: row.narrative,
      purpose,
      evidenceLevel: row.evidence_level,
      evidenceStrength: row.strength != null && row.concept_weight != null
        ? row.strength * row.concept_weight
        : null,
      confidence: row.confidence,
      concepts,
      sourceRefs: [candidateSourceRef(row)],
    };
    if (
      signal.evidenceLevel != null
      && signal.evidenceStrength != null
      && signal.confidence != null
    ) {
      signals.push(signal);
    }
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
    locator: span.path ? `${span.path}:${start}-${end}` : span.id,
  };
}

async function loadChallengePackets(
  db: D1Database,
  roleConcepts?: string[],
): Promise<ChallengePacket[]> {
  const rows = await db.prepare(
    `SELECT id, repo_id, packet_json
       FROM review_challenge_packets
      WHERE production_ready = 1 AND quality_score >= 0.70
      ORDER BY repo_id, pr_number`,
  ).all<PacketRow>();
  const packets: ChallengePacket[] = [];

  for (const row of rows.results ?? []) {
    const packet = JSON.parse(row.packet_json) as RepoChallengePacket;
    const spanIds = [...new Set(packet.demands.flatMap((demand) => demand.sourceSpanIds))];
    if (spanIds.length === 0) continue;
    const placeholders = spanIds.map(() => '?').join(',');
    const spans = await db.prepare(
      `SELECT id, artifact_version_id, content_hash, byte_start, byte_end, exact_text, path
         FROM repo_source_spans WHERE id IN (${placeholders})`,
    ).bind(...spanIds).all<RepoSpanRow>();
    const spanById = new Map((spans.results ?? []).map((span) => [span.id, span]));
    const roleConceptSet = roleConcepts ? new Set(roleConcepts) : null;
    const roleDemands = roleConceptSet
      ? packet.demands.filter((demand) => demand.conceptKeys.some((key) => roleConceptSet.has(key)))
      : packet.demands;
    const maxRoleWeight = roleDemands.length > 0
      ? Math.max(...roleDemands.map((demand) => demand.weight))
      : null;

    packets.push({
      id: packet.id,
      repoId: String(row.repo_id),
      prNumber: packet.pullRequest.number,
      sourceVersion: packet.repoSnapshotId,
      challengeReady: packet.quality.eligible,
      languages: [packet.languageSupport.normalizedLanguage],
      seniority: undefined,
      concepts: [...new Set(packet.demands.flatMap((demand) => demand.conceptKeys))],
      demands: packet.demands.map((demand) => {
        const concepts = demand.conceptKeys;
        const demandSpans = demand.sourceSpanIds
          .map((id) => spanById.get(id))
          .filter((span): span is RepoSpanRow => Boolean(span));
        const sourceRefs = demandSpans.length === demand.sourceSpanIds.length
          ? demandSpans.map(packetSourceRef)
          : [];
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
    });
  }
  return packets;
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
  explanation?: ReturnType<typeof explainChallengeMatch>;
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

export async function matchCandidateToReviewChallenge(
  db: D1Database,
  candidateId: string,
  options: CandidateReviewChallengeOptions = {},
): Promise<CandidateReviewChallengeMatch> {
  const [signals, challenges] = await Promise.all([
    loadCandidateSignals(db, candidateId),
    loadChallengePackets(db, options.roleConcepts),
  ]);
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
    JSON.stringify(recalled.challenges.map((item) => item.challenge.id)),
    JSON.stringify(recalled.excludedChallengeIds),
    JSON.stringify(evaluated.map((alignment, index) => ({
      rank: eligibleRankByChallengeId.get(alignment.challenge.id) ?? null,
      recallRank: index + 1,
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

  if (!selected) return { status, matchRunId };
  return {
    status: 'MATCHED',
    matchRunId,
    repoId: Number(selected.challenge.repoId),
    prNumber: selected.challenge.prNumber,
    explanation: explainChallengeMatch(selected),
  };
}
