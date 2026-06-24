import { loadCorpus, productionCorpusFailures } from './corpus';
import type { EvaluationMetrics, EvaluationResult, RolloutStage } from './types';
import { STAGED_ROLLOUT_THRESHOLDS } from './types';

interface EvaluationResultRow {
  id: string;
  corpus_id: string;
  metrics_json: string;
  corpus_json: string;
  result_json: string;
  passed: number;
  created_at: number;
  expert_label_count: number;
  synthetic_fixture_count: number;
}

export interface EvaluationReadinessOptions {
  corpusId: string;
  /**
   * Rollout stage to enforce. Defaults to `production`. Earlier stages relax
   * the coverage requirements (see `STAGED_ROLLOUT_THRESHOLDS`).
   */
  stage?: RolloutStage;
}

export interface EvaluationReadinessReport {
  ready: boolean;
  corpusId: string;
  evaluationResultId: string | null;
  createdAt: number | null;
  failures: string[];
  warnings: string[];
  metrics: EvaluationMetrics | null;
  stage: RolloutStage;
}

function parseJson<T>(json: string, label: string): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    throw new Error(
      `Stored evaluation ${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export async function checkLatestProductionEvaluation(
  db: D1Database,
  options: EvaluationReadinessOptions,
): Promise<EvaluationReadinessReport> {
  const row = await db.prepare(
    `SELECT r.id, r.corpus_id, r.metrics_json, c.corpus_json, r.result_json, r.passed, r.created_at,
            c.expert_label_count, c.synthetic_fixture_count
       FROM evaluation_results r
       JOIN evaluation_corpora c ON c.corpus_id = r.corpus_id
      WHERE r.corpus_id = ?1
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 1`,
  ).bind(options.corpusId).first<EvaluationResultRow>();

  if (!row) {
    return {
      ready: false,
      corpusId: options.corpusId,
      evaluationResultId: null,
      createdAt: null,
      failures: [`No persisted evaluation result found for corpus ${options.corpusId}`],
      warnings: [],
      metrics: null,
      stage: options.stage ?? 'production',
    };
  }

  const result = parseJson<EvaluationResult>(row.result_json, 'result_json');
  const metrics = parseJson<EvaluationMetrics>(row.metrics_json, 'metrics_json');
  const failures: string[] = [];
  const warnings = [...(result.warnings ?? [])];
  const thresholds = result.thresholds;
  let corpusProductionFailures: string[];
  try {
    corpusProductionFailures = productionCorpusFailures(loadCorpus(row.corpus_json));
  } catch (error) {
    corpusProductionFailures = [
      `Stored evaluation corpus is invalid: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  const stage = options.stage ?? 'production';
  const stageThresholds = STAGED_ROLLOUT_THRESHOLDS[stage];

  if (row.passed !== 1 || result.passed !== true) {
    failures.push('Latest persisted evaluation did not pass');
  }
  if (stageThresholds.requireExpertLabels) {
    if (!thresholds?.requireExpertLabels) {
      failures.push('Persisted evaluation was not run with the expert-label gate enabled');
    }
    if (metrics.expertLabelCount <= 0) {
      failures.push(`${stage} rollout requires at least one expert label`);
    }
    if (metrics.syntheticFixtureCount !== 0) {
      failures.push(`${stage} rollout requires zero synthetic fixture labels`);
    }
  }
  if (stageThresholds.requireByteIdenticalRerun) {
    if (!thresholds?.requireByteIdenticalRerun) {
      failures.push('Persisted evaluation did not require byte-identical rerun proof');
    }
    if (!metrics.byteIdenticalRerun) {
      failures.push('Byte-identical rerun proof is required');
    }
    if (metrics.determinismComparisons.length === 0) {
      failures.push('At least one independent determinism comparison is required');
    }
    for (const comparison of metrics.determinismComparisons) {
      if (!comparison.comparisonMatchRunId) {
        failures.push(`Missing comparison run for ${comparison.candidateId}/${comparison.roleId}`);
      }
      if (!comparison.identical) {
        failures.push(`Determinism comparison failed for ${comparison.candidateId}/${comparison.roleId}`);
      }
      if (
        !comparison.fingerprint
        || !comparison.comparisonFingerprint
        || comparison.fingerprint !== comparison.comparisonFingerprint
      ) {
        failures.push(`Determinism fingerprints are incomplete or divergent for ${comparison.candidateId}/${comparison.roleId}`);
      }
    }
  }
  if (row.corpus_id !== metrics.corpusId || row.corpus_id !== result.metrics?.corpusId) {
    failures.push('Persisted evaluation corpus identity is inconsistent');
  }
  if (row.expert_label_count !== metrics.expertLabelCount) {
    failures.push('Corpus expert label count does not match persisted metrics');
  }
  if (row.synthetic_fixture_count !== metrics.syntheticFixtureCount) {
    failures.push('Corpus synthetic fixture count does not match persisted metrics');
  }
  if (stage === 'canary' || stage === 'production') {
    failures.push(...corpusProductionFailures);
  }
  if (Number.isFinite(stageThresholds.maxGuardrailViolations)
    && metrics.guardrailViolationCount > stageThresholds.maxGuardrailViolations
  ) {
    failures.push(`Guardrail violations must be <= ${stageThresholds.maxGuardrailViolations}; got ${metrics.guardrailViolationCount}`);
  }
  if (Number.isFinite(stageThresholds.maxMultiStretchViolations)
    && metrics.multiStretchViolationCount > stageThresholds.maxMultiStretchViolations
  ) {
    failures.push(`Multi-stretch violations must be <= ${stageThresholds.maxMultiStretchViolations}; got ${metrics.multiStretchViolationCount}`);
  }
  if (Number.isFinite(stageThresholds.maxMissingProvenance)
    && metrics.missingProvenanceCount > stageThresholds.maxMissingProvenance
  ) {
    failures.push(`Missing provenance must be <= ${stageThresholds.maxMissingProvenance}; got ${metrics.missingProvenanceCount}`);
  }
  if (Number.isFinite(stageThresholds.maxMissingMatchRuns)
    && metrics.missingMatchRunCount > stageThresholds.maxMissingMatchRuns
  ) {
    failures.push(`Missing match runs must be <= ${stageThresholds.maxMissingMatchRuns}; got ${metrics.missingMatchRunCount}`);
  }
  if (
    finiteNumber(stageThresholds.minRecallAt50)
    && metrics.recallAt50 < stageThresholds.minRecallAt50
  ) {
    failures.push(`Recall@50 ${metrics.recallAt50} below ${stageThresholds.minRecallAt50}`);
  }
  if (
    finiteNumber(stageThresholds.minPrecisionAt3)
    && metrics.precisionAt3 < stageThresholds.minPrecisionAt3
  ) {
    failures.push(`Precision@3 ${metrics.precisionAt3} below ${stageThresholds.minPrecisionAt3}`);
  }
  if (
    finiteNumber(stageThresholds.minNdcgAt5)
    && metrics.ndcgAt5 < stageThresholds.minNdcgAt5
  ) {
    failures.push(`nDCG@5 ${metrics.ndcgAt5} below ${stageThresholds.minNdcgAt5}`);
  }

  if (stage === 'canary' || stage === 'production') {
    if (metrics.pairCoverage < 1) {
      failures.push(
        `Rollout coverage missing: pair coverage ${metrics.pairCoverage} must be complete for ${stage} stage`,
      );
    }
    if (metrics.comparisonCoverage < 1) {
      failures.push(
        `Rollout coverage missing: comparison rerun coverage ${metrics.comparisonCoverage} must be complete for ${stage} stage`,
      );
    }
    if (metrics.expectedPacketCount === 0) {
      failures.push(
        `Rollout coverage missing: corpus declares no expected packets for ${stage} stage`,
      );
    } else if (metrics.packetCoverage < 1) {
      failures.push(
        `Rollout coverage missing: packet coverage ${metrics.packetCoverage} must be complete for ${stage} stage`,
      );
    }
    if (metrics.packetIdentityMismatches.length > 0) {
      failures.push(
        `Rollout coverage missing: ${metrics.packetIdentityMismatches.length} packet identity mismatch(es) detected for ${stage} stage`,
      );
    }
    if (metrics.missingPacketIds.length > 0) {
      failures.push(
        `Rollout coverage missing: expected packets not surfaced: ${metrics.missingPacketIds.join(', ')}`,
      );
    }
  }

  return {
    ready: failures.length === 0,
    corpusId: row.corpus_id,
    evaluationResultId: row.id,
    createdAt: row.created_at,
    failures,
    warnings,
    metrics,
    stage,
  };
}

export function generateEvaluationReadinessReport(report: EvaluationReadinessReport): string {
  const lines = [
    '=== Matching Evaluation Readiness Gate ===',
    `Corpus: ${report.corpusId}`,
    `Stage: ${report.stage}`,
    `Evaluation result: ${report.evaluationResultId ?? '(none)'}`,
    `Created at: ${report.createdAt ?? '(none)'}`,
    `Ready: ${report.ready ? 'YES' : 'NO'}`,
  ];

  if (report.metrics) {
    lines.push(
      '',
      `Expert labels: ${report.metrics.expertLabelCount}`,
      `Synthetic labels: ${report.metrics.syntheticFixtureCount}`,
      `Recall@50: ${report.metrics.recallAt50}`,
      `Precision@3: ${report.metrics.precisionAt3}`,
      `nDCG@5: ${report.metrics.ndcgAt5}`,
      `Byte-identical rerun: ${report.metrics.byteIdenticalRerun ? 'PASS' : 'FAIL'}`,
      `Pair coverage: ${report.metrics.pairCoverage}`,
      `Comparison coverage: ${report.metrics.comparisonCoverage}`,
      `Packet coverage: ${report.metrics.packetCoverage} (${report.metrics.expectedPacketCount} expected)`,
      `Packet identity mismatches: ${report.metrics.packetIdentityMismatches.length}`,
    );
  }
  if (report.failures.length > 0) {
    lines.push('', 'Failures:', ...report.failures.map((failure) => `- ${failure}`));
  }
  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:', ...report.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join('\n');
}
