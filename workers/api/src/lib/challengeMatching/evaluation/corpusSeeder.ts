/**
 * Corpus seeder — extracts evaluation corpus data from real match decisions.
 *
 * Queries completed match runs from D1, loads candidate living context evidence,
 * role requirements, and challenge packets, then formats everything into a draft
 * EvaluationCorpus for expert review and labelling.
 *
 * Draft labels are marked with `labeledBy: 'corpus-seeder'` so they fail the
 * production corpus gate (which requires real expert provenance). Experts
 * upgrade individual labels through the labelling workflow.
 */

import type {
  CandidatePersonEvidence,
  EvaluationCorpus,
  ExpectedChallengePacket,
  ExpectedDemandReference,
  ExpertLabel,
  RelevanceGrade,
  RoleRequirements,
} from './types';
import { EVALUATION_CORPUS_VERSION } from './types';
import { validateCorpus } from './corpus';
import { loadPersistedMatchRun } from './cli';
import type { PersistedMatchRun, PersistedRankedChallenge } from './types';

export interface CorpusSeederOptions {
  /** Maximum number of match runs to include. Default 50. */
  limit?: number;
  /** Only include match runs with this status. Default 'MATCHED'. */
  statusFilter?: string;
  /** Optional role context ID filter. */
  roleContextId?: string;
  /** Description for the generated corpus. */
  description?: string;
}

export interface CorpusSeederResult {
  corpus: EvaluationCorpus;
  matchRunCount: number;
  candidateCount: number;
  roleCount: number;
  challengeCount: number;
  warnings: string[];
}

interface MatchRunListRow {
  id: string;
  candidate_id: string;
  role_context_id: string | null;
  role_snapshot_id: string;
  status: string;
  selected_packet_id: string | null;
  created_at: string;
}

interface AssertionEvidenceRow {
  assertion_id: string;
  episode_id: string;
  narrative: string;
  source_span_id: string;
  artifact_id: string;
  artifact_version_id: string;
  version_number: number;
  content_hash: string;
  exact_text: string;
  byte_start: number | null;
  byte_end: number | null;
  char_start: number | null;
  char_end: number | null;
  line_start: number | null;
  line_end: number | null;
}

interface AssertionConceptRow {
  assertion_id: string;
  concept_key: string;
}

interface RoleContextRow {
  id: string;
  required_languages_json: string | null;
  relevant_concepts_json: string | null;
  required_concepts_json: string | null;
  forbidden_concepts_json: string | null;
}

interface RoleSourceRefRow {
  entity_id: string;
  locator: string;
  concept_keys_json: string;
  source_ref_type: string;
  source_ref_id: string;
  exact_text: string;
  content_hash: string;
}

interface ChallengePacketRow {
  id: string;
  repo_id: string;
  pr_number: number;
  source_version: string;
  content_hash: string | null;
  demands_json: string | null;
}

function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function safeJsonParseOptional(json: string | null): string[] | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as string[];
  } catch {
    return undefined;
  }
}

export async function seedCorpusFromMatchRuns(
  db: D1Database,
  options: CorpusSeederOptions = {},
): Promise<CorpusSeederResult> {
  const limit = options.limit ?? 50;
  const statusFilter = options.statusFilter ?? 'MATCHED';
  const warnings: string[] = [];

  // Step 1: Load completed match runs
  const matchRunQuery = options.roleContextId
    ? db.prepare(
      `SELECT id, candidate_id, role_context_id, role_snapshot_id, status, selected_packet_id, created_at
         FROM match_runs
        WHERE status = ?1
          AND role_context_id = ?2
        ORDER BY created_at DESC
        LIMIT ?3`,
    ).bind(statusFilter, options.roleContextId, limit)
    : db.prepare(
      `SELECT id, candidate_id, role_context_id, role_snapshot_id, status, selected_packet_id, created_at
         FROM match_runs
        WHERE status = ?1
        ORDER BY created_at DESC
        LIMIT ?2`,
    ).bind(statusFilter, limit);

  const matchRunRows = await matchRunQuery.all<MatchRunListRow>();
  const matchRuns: PersistedMatchRun[] = [];
  for (const row of matchRunRows.results ?? []) {
    try {
      const run = await loadPersistedMatchRun(db, row.id);
      matchRuns.push(run);
    } catch (err) {
      warnings.push(`Skipped match run ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (matchRuns.length === 0) {
    throw new Error('No match runs found matching the filter criteria');
  }

  // Step 2: Collect unique candidate IDs and role IDs
  const candidateIds = [...new Set(matchRuns.map((r) => r.candidateId))];
  const roleIds = [...new Set(matchRuns.map((r) => r.roleId))];

  // Step 3: Load candidate evidence from living context
  const candidateEvidence: CandidatePersonEvidence[] = [];
  for (const candidateId of candidateIds) {
    const assertions = await db.prepare(
      `SELECT sa.id AS assertion_id, sa.episode_id, sa.narrative,
              ss.id AS source_span_id,
              av.artifact_id, av.id AS artifact_version_id,
              av.version_number, av.content_hash,
              ss.exact_text,
              ss.byte_start, ss.byte_end,
              ss.char_start, ss.char_end,
              ss.line_start, ss.line_end
         FROM semantic_assertions sa
         JOIN assertion_source_spans ass ON ass.assertion_id = sa.id
         JOIN source_spans ss ON ss.id = ass.source_span_id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
         JOIN interactions i ON i.id = a.interaction_id
         JOIN workspace_people wp ON wp.id = i.workspace_person_id
         JOIN applications app ON app.workspace_person_id = wp.id
        WHERE app.legacy_candidate_id = ?1
        LIMIT 200`,
    ).bind(candidateId).all<AssertionEvidenceRow>();

    const conceptRows = await db.prepare(
      `SELECT ac.assertion_id, c.canonical_key AS concept_key
         FROM assertion_concepts ac
         JOIN concepts c ON c.id = ac.concept_id
         JOIN semantic_assertions sa ON sa.id = ac.assertion_id
         JOIN assertion_source_spans ass ON ass.assertion_id = sa.id
         JOIN source_spans ss ON ss.id = ass.source_span_id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
         JOIN interactions i ON i.id = a.interaction_id
         JOIN workspace_people wp ON wp.id = i.workspace_person_id
         JOIN applications app ON app.workspace_person_id = wp.id
        WHERE app.legacy_candidate_id = ?1`,
    ).bind(candidateId).all<AssertionConceptRow>();

    const conceptsByAssertion = new Map<string, string[]>();
    for (const row of conceptRows.results ?? []) {
      const existing = conceptsByAssertion.get(row.assertion_id) ?? [];
      existing.push(row.concept_key);
      conceptsByAssertion.set(row.assertion_id, existing);
    }

    const seenAssertions = new Set<string>();
    for (const row of assertions.results ?? []) {
      if (seenAssertions.has(row.assertion_id)) continue;
      seenAssertions.add(row.assertion_id);

      const startOffset = row.char_start ?? row.byte_start ?? 0;
      const endOffset = row.char_end ?? row.byte_end ?? (startOffset + (row.exact_text?.length ?? 0));

      candidateEvidence.push({
        candidateId,
        evidenceId: row.assertion_id,
        episodeId: row.episode_id,
        narrative: row.narrative,
        concepts: conceptsByAssertion.get(row.assertion_id) ?? [],
        evidenceReferences: [{
          artifactId: row.artifact_id,
          artifactVersion: row.artifact_version_id,
          contentHash: row.content_hash,
          sourceRefType: 'source_span',
          sourceRefId: row.source_span_id,
          exactText: row.exact_text,
          startOffset,
          endOffset,
        }],
      });
    }

    if (seenAssertions.size === 0) {
      warnings.push(`Candidate ${candidateId} has no living context assertions with source spans`);
    }
  }

  // Step 4: Load role requirements
  const roleRequirements: RoleRequirements[] = [];
  for (const roleId of roleIds) {
    const roleRow = await db.prepare(
      `SELECT id, required_languages_json, relevant_concepts_json,
              required_concepts_json, forbidden_concepts_json
         FROM role_context_documents
        WHERE id = ?1`,
    ).bind(roleId).first<RoleContextRow>();

    const sourceRefs = await db.prepare(
      `SELECT entity_id, locator, concept_keys_json,
              source_ref_type, source_ref_id, exact_text, content_hash
         FROM role_source_references
        WHERE role_context_id = ?1`,
    ).bind(roleId).all<RoleSourceRefRow>();

    const roleSourceRefs = (sourceRefs.results ?? []).map((ref) => ({
      entityId: ref.entity_id,
      locator: ref.locator,
      conceptKeys: safeJsonParse<string[]>(ref.concept_keys_json, []),
      sourceRefType: ref.source_ref_type,
      sourceRefId: ref.source_ref_id,
      exactText: ref.exact_text,
      contentHash: ref.content_hash,
    }));

    if (roleRow) {
      roleRequirements.push({
        roleId,
        requiredLanguages: safeJsonParse<string[]>(roleRow.required_languages_json, []),
        relevantConcepts: safeJsonParseOptional(roleRow.relevant_concepts_json),
        requiredConcepts: safeJsonParseOptional(roleRow.required_concepts_json),
        forbiddenConcepts: safeJsonParseOptional(roleRow.forbidden_concepts_json),
        sourceReferences: roleSourceRefs,
      });
    } else {
      // Fallback: use the role snapshot ID as a stub
      roleRequirements.push({
        roleId,
        requiredLanguages: [],
        sourceReferences: roleSourceRefs.length > 0 ? roleSourceRefs : [{
          entityId: roleId,
          locator: 'role_snapshot',
          conceptKeys: ['standalone-code-review'],
          sourceRefType: 'role_snapshot',
          sourceRefId: roleId,
          exactText: `Standalone code review role: ${roleId}`,
          contentHash: `sha256:${roleId}`,
        }],
      });
      warnings.push(`Role ${roleId} has no role_context_documents row; using stub`);
    }
  }

  // Step 5: Load challenge packets for expected packets
  const selectedPacketIds = new Set<string>();
  const allChallengeIds = new Set<string>();
  for (const run of matchRuns) {
    for (const challenge of run.rankedChallenges) {
      allChallengeIds.add(challenge.challengeId);
    }
    const selected = run.rankedChallenges.find((c) => c.rank === 1);
    if (selected) selectedPacketIds.add(selected.challengeId);
  }

  const expectedPackets: ExpectedChallengePacket[] = [];
  for (const packetId of selectedPacketIds) {
    const packetRow = await db.prepare(
      `SELECT id, repo_id, pr_number, source_version, content_hash, demands_json
         FROM review_challenge_packets
        WHERE id = ?1`,
    ).bind(packetId).first<ChallengePacketRow>();

    if (packetRow) {
      const demands = safeJsonParse<Array<{ demandId: string; concepts: string[]; sourceRefs: unknown[] }>>(
        packetRow.demands_json,
        [],
      );
      expectedPackets.push({
        challengeId: packetRow.id,
        repoId: packetRow.repo_id,
        prNumber: packetRow.pr_number,
        sourceVersion: packetRow.source_version,
        packetContentHash: packetRow.content_hash ?? undefined,
        demands: demands.map((d) => ({
          demandId: d.demandId,
          concepts: d.concepts ?? [],
          sourceRefs: (d.sourceRefs ?? []) as ExpectedDemandReference['sourceRefs'],
        })),
      });
    }
  }

  // Step 6: Generate draft expert labels from match results
  const expertLabels: ExpertLabel[] = [];
  const labeledTriples = new Set<string>();

  for (const run of matchRuns) {
    const selected = run.rankedChallenges.find((c) => c.rank === 1);
    if (!selected) continue;

    const eligibleIds = run.rankedChallenges
      .filter((c) => c.eligible && c.score > 0)
      .map((c) => c.challengeId);

    const triple = JSON.stringify([run.candidateId, run.roleId, selected.challengeId]);
    if (labeledTriples.has(triple)) continue;
    labeledTriples.add(triple);

    const grade = gradeFromScore(selected.score);

    expertLabels.push({
      labelId: `seeded-${run.matchRunId}-${selected.challengeId}`,
      candidateId: run.candidateId,
      roleId: run.roleId,
      challengeId: selected.challengeId,
      relevanceGrade: grade,
      eligibleChallengeIds: eligibleIds,
      explanation: `Auto-seeded from match run ${run.matchRunId} (score: ${selected.score.toFixed(3)})`,
      labelVersion: '1.0.0-seeded',
      labeledAt: new Date().toISOString(),
      labeledBy: 'corpus-seeder',
    });
  }

  // Step 7: Assemble corpus
  const corpusId = `seeded-${Date.now()}-${candidateIds.length}c-${roleIds.length}r`;
  const challengeCount = allChallengeIds.size;

  const corpus: EvaluationCorpus = {
    version: EVALUATION_CORPUS_VERSION,
    corpusId,
    createdAt: new Date().toISOString(),
    description: options.description ?? `Auto-seeded evaluation corpus from ${matchRuns.length} match runs`,
    candidateEvidence,
    roleRequirements,
    expertLabels,
    expectedPackets,
    metadata: {
      totalLabels: expertLabels.length,
      totalCandidates: candidateIds.length,
      totalRoles: roleIds.length,
      totalChallenges: challengeCount,
      syntheticFixtureCount: 0,
      totalExpectedPackets: expectedPackets.length,
    },
  };

  // Step 8: Validate (will throw on structural issues)
  try {
    validateCorpus(corpus);
  } catch (err) {
    warnings.push(`Corpus validation: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    corpus,
    matchRunCount: matchRuns.length,
    candidateCount: candidateIds.length,
    roleCount: roleIds.length,
    challengeCount,
    warnings,
  };
}

function gradeFromScore(score: number): RelevanceGrade {
  if (score >= 0.8) return 'highly_relevant';
  if (score >= 0.6) return 'relevant';
  if (score >= 0.4) return 'borderline';
  return 'irrelevant';
}

/**
 * Persist a seeded corpus to the evaluation_corpora table.
 */
export async function persistSeededCorpus(
  db: D1Database,
  corpus: EvaluationCorpus,
): Promise<{ corpusId: string; persisted: boolean }> {
  const json = JSON.stringify(corpus);
  await db.prepare(
    `INSERT INTO evaluation_corpora (corpus_id, corpus_json, created_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT (corpus_id) DO UPDATE SET corpus_json = excluded.corpus_json`,
  ).bind(corpus.corpusId, json, corpus.createdAt).run();
  return { corpusId: corpus.corpusId, persisted: true };
}
