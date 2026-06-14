import { getLabelsForCandidateRole, loadCorpus } from './corpus';
import { checkAcceptanceThresholds, evaluateMatchRuns } from './metrics';
import {
  DEFAULT_ACCEPTANCE_THRESHOLDS,
  type AcceptanceThresholds,
  type EvaluationResult,
  type PersistedMatchAlignment,
  type PersistedMatchRun,
  type PersistedRankedChallenge,
} from './types';

export interface EvaluationOptions {
  corpusId: string;
  matchRunIds?: string[];
  comparisonMatchRunIds?: string[];
  thresholds?: Partial<AcceptanceThresholds>;
  persistResult?: boolean;
}

interface MatchRunRow {
  id: string;
  candidate_id: string;
  role_context_id: string | null;
  candidate_snapshot_id: string;
  role_snapshot_id: string;
  policy_version: string;
  model_version: string | null;
  status: string;
  ranked_results_json: string;
}

function requiredString(
  row: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

function requiredNumber(
  row: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${context}.${key} must be a finite number`);
  }
  return value;
}

function requiredBoolean(
  row: Record<string, unknown>,
  key: string,
  context: string,
): boolean {
  const value = row[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${context}.${key} must be a boolean`);
  }
  return value;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function parseAlignment(
  value: unknown,
  context: string,
): PersistedMatchAlignment {
  const row = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const rawPairScore = row.pairScore;
  const pairScore = typeof rawPairScore === 'number'
    ? rawPairScore
    : rawPairScore && typeof rawPairScore === 'object'
      ? requiredNumber(
          rawPairScore as Record<string, unknown>,
          'total',
          `${context}.pairScore`,
        )
      : requiredNumber(row, 'pairScore', context);
  const pairScoreBreakdown = row.pairScoreBreakdown
    && typeof row.pairScoreBreakdown === 'object'
    ? row.pairScoreBreakdown as PersistedMatchAlignment['pairScoreBreakdown']
    : undefined;
  const weightedScore = typeof row.weightedScore === 'number'
    ? row.weightedScore
    : undefined;
  return {
    atomId: requiredString(row, 'atomId', context),
    demandId: requiredString(row, 'demandId', context),
    pairScore,
    ...(pairScoreBreakdown ? { pairScoreBreakdown } : {}),
    ...(weightedScore !== undefined ? { weightedScore } : {}),
    stretch: row.stretch && typeof row.stretch === 'object'
      ? row.stretch as PersistedMatchAlignment['stretch']
      : null,
    sharedConcepts: Array.isArray(row.sharedConcepts)
      ? row.sharedConcepts.filter((entry): entry is string => typeof entry === 'string')
      : [],
    candidateSourceRefs: Array.isArray(row.candidateSourceRefs)
      ? row.candidateSourceRefs as PersistedMatchAlignment['candidateSourceRefs']
      : [],
    challengeSourceRefs: Array.isArray(row.challengeSourceRefs)
      ? row.challengeSourceRefs as PersistedMatchAlignment['challengeSourceRefs']
      : [],
  };
}

function parseRankedResults(json: string): PersistedRankedChallenge[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('ranked_results_json must contain an array');
  }
  return parsed.map((entry, index) => {
    const context = `ranked_results_json[${index}]`;
    const row = entry && typeof entry === 'object'
      ? entry as Record<string, unknown>
      : {};
    const rank = row.rank === null ? null : positiveInteger(row.rank);
    if (row.rank !== null && rank === null) {
      throw new Error(`${context}.rank must be null or a positive integer`);
    }
    const recallRank = positiveInteger(row.recallRank);
    const prNumber = positiveInteger(row.prNumber);
    if (recallRank === null) {
      throw new Error(`${context}.recallRank must be a positive integer`);
    }
    if (prNumber === null) {
      throw new Error(`${context}.prNumber must be a positive integer`);
    }
    const rejectionReasons = Array.isArray(row.rejectionReasons)
      ? row.rejectionReasons.filter((reason): reason is string => typeof reason === 'string')
      : [];
    return {
      rank,
      recallRank,
      challengeId: requiredString(row, 'challengeId', context),
      repoId: requiredString(row, 'repoId', context),
      prNumber,
      sourceVersion: requiredString(row, 'sourceVersion', context),
      score: requiredNumber(row, 'score', context),
      candidateEvidenceAlignment: requiredNumber(
        row,
        'candidateEvidenceAlignment',
        context,
      ),
      roleRelevance: requiredNumber(row, 'roleRelevance', context),
      contextualSpecificity: requiredNumber(row, 'contextualSpecificity', context),
      challengeQuality: requiredNumber(row, 'challengeQuality', context),
      validationDeepeningValue: requiredNumber(
        row,
        'validationDeepeningValue',
        context,
      ),
      alignedDemandCount: positiveInteger(row.alignedDemandCount) ?? 0,
      stretchCount: positiveInteger(row.stretchCount) ?? 0,
      stretchDemandWeightRatio: requiredNumber(
        row,
        'stretchDemandWeightRatio',
        context,
      ),
      provenanceComplete: requiredBoolean(row, 'provenanceComplete', context),
      eligible: requiredBoolean(row, 'eligible', context),
      alignments: Array.isArray(row.alignments)
        ? row.alignments.map((alignment, alignmentIndex) =>
            parseAlignment(alignment, `${context}.alignments[${alignmentIndex}]`)
          )
        : [],
      rejectionReasons,
    };
  });
}

export async function loadPersistedMatchRun(
  db: D1Database,
  matchRunId: string,
): Promise<PersistedMatchRun> {
  const row = await db.prepare(
    `SELECT id, candidate_id, role_context_id, candidate_snapshot_id, role_snapshot_id,
            policy_version, model_version, status, ranked_results_json
       FROM match_runs
      WHERE id = ?1`,
  ).bind(matchRunId).first<MatchRunRow>();
  if (!row) throw new Error(`Match run "${matchRunId}" was not found`);
  return {
    matchRunId: row.id,
    candidateId: row.candidate_id,
    roleId: row.role_context_id ?? row.role_snapshot_id,
    candidateSnapshotId: row.candidate_snapshot_id,
    policyVersion: row.policy_version,
    modelVersion: row.model_version,
    status: row.status,
    rankedChallenges: parseRankedResults(row.ranked_results_json),
  };
}

async function latestRunIdsForCorpus(
  db: D1Database,
  corpus: ReturnType<typeof loadCorpus>,
): Promise<string[]> {
  const pairs = new Map<string, { candidateId: string; roleId: string }>();
  for (const label of corpus.expertLabels) {
    pairs.set(JSON.stringify([label.candidateId, label.roleId]), {
      candidateId: label.candidateId,
      roleId: label.roleId,
    });
  }
  const ids: string[] = [];
  for (const pair of pairs.values()) {
    const row = await db.prepare(
      `SELECT id
         FROM match_runs
        WHERE candidate_id = ?1
          AND (role_context_id = ?2 OR role_snapshot_id = ?2)
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    ).bind(pair.candidateId, pair.roleId).first<{ id: string }>();
    if (row) ids.push(row.id);
  }
  return ids;
}

export async function runEvaluation(
  db: D1Database,
  options: EvaluationOptions,
): Promise<EvaluationResult> {
  const corpusRow = await db.prepare(
    `SELECT corpus_json
       FROM evaluation_corpora
      WHERE corpus_id = ?1`,
  ).bind(options.corpusId).first<{ corpus_json: string }>();
  if (!corpusRow) throw new Error(`Evaluation corpus "${options.corpusId}" was not found`);

  const corpus = loadCorpus(corpusRow.corpus_json);
  const matchRunIds = options.matchRunIds?.length
    ? options.matchRunIds
    : await latestRunIdsForCorpus(db, corpus);
  const matchRuns = await Promise.all(
    matchRunIds.map((id) => loadPersistedMatchRun(db, id)),
  );
  const comparisonRuns = await Promise.all(
    (options.comparisonMatchRunIds ?? []).map((id) => loadPersistedMatchRun(db, id)),
  );
  const thresholds = {
    ...DEFAULT_ACCEPTANCE_THRESHOLDS,
    ...options.thresholds,
  };
  const result = checkAcceptanceThresholds(
    evaluateMatchRuns(corpus, matchRuns, comparisonRuns),
    thresholds,
  );

  if (options.persistResult) {
    await db.prepare(
      `INSERT INTO evaluation_results (
         id, corpus_id, match_run_ids_json, comparison_match_run_ids_json,
         metrics_json, result_json, passed, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())`,
    ).bind(
      crypto.randomUUID(),
      corpus.corpusId,
      JSON.stringify(result.metrics.matchRunIds),
      JSON.stringify(result.metrics.comparisonMatchRunIds),
      JSON.stringify(result.metrics),
      JSON.stringify(result),
      result.passed ? 1 : 0,
    ).run();
  }

  return result;
}

export function generateHumanReadableReport(result: EvaluationResult): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    '=== Matching Evaluation Report ===',
    `Corpus: ${result.metrics.corpusId} (schema ${result.metrics.corpusVersion})`,
    `Match runs: ${result.metrics.matchRunIds.join(', ') || '(none)'}`,
    `Comparison runs: ${result.metrics.comparisonMatchRunIds.join(', ') || '(none)'}`,
    '',
    `Recall@50: ${percent(result.metrics.recallAt50)}`,
    `Precision@3: ${percent(result.metrics.precisionAt3)}`,
    `nDCG@5: ${percent(result.metrics.ndcgAt5)}`,
    `Guardrail violations: ${result.metrics.guardrailViolationCount}`,
    `Multi-stretch violations: ${result.metrics.multiStretchViolationCount}`,
    `Missing provenance: ${result.metrics.missingProvenanceCount}`,
    `Missing match runs: ${result.metrics.missingMatchRunCount}`,
    `Byte-identical comparison: ${result.metrics.byteIdenticalRerun ? 'PASS' : 'NOT PROVEN'}`,
    `Expert labels: ${result.metrics.expertLabelCount}`,
    `Synthetic labels: ${result.metrics.syntheticFixtureCount}`,
    '',
    result.passed ? 'RESULT: PASS' : 'RESULT: FAIL',
  ];
  if (result.failures.length > 0) {
    lines.push('', 'Failures:', ...result.failures.map((failure) => `- ${failure}`));
  }
  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:', ...result.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join('\n');
}

export function candidateRoleLabels(
  corpusJson: string,
  candidateId: string,
  roleId: string,
) {
  return getLabelsForCandidateRole(loadCorpus(corpusJson), candidateId, roleId);
}
