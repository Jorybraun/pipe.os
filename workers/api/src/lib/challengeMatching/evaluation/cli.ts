/**
 * CLI for evaluating candidate-to-PR matching against the expert-label corpus.
 *
 * This script loads persisted match runs from D1 and evaluates them against
 * a frozen expert-label corpus, producing both JSON and human-readable reports.
 */

import type {
  EvaluationCorpus,
  EvaluationResult,
  AcceptanceThresholds,
  PersistedMatchRun,
} from './types';
import { evaluateMatchRuns, checkAcceptanceThresholds } from './metrics';
import { loadCorpus } from './corpus';
import { DEFAULT_ACCEPTANCE_THRESHOLDS } from './types';

export interface CliOptions {
  corpusPath: string;
  matchRunIds?: string[];
  comparisonMatchRunIds?: string[];
  outputJson?: string;
  outputReport?: string;
  thresholds?: Partial<AcceptanceThresholds>;
  verbose?: boolean;
}

/**
 * Run evaluation with CLI options.
 *
 * This is a simplified implementation that requires D1 database integration.
 * The full implementation would load match runs from D1 and evaluate them.
 */
export async function runEvaluation(
  db: unknown,
  options: CliOptions,
): Promise<EvaluationResult> {
  // In a real implementation, this would:
  // 1. Load corpus from D1
  // 2. Load match runs from D1
  // 3. Evaluate using evaluateMatchRuns
  // 4. Check thresholds
  // 5. Output results

  throw new Error('CLI requires D1 database connection - not implemented in stub');
}

/**
 * Generate human-readable report.
 */
export function generateHumanReadableReport(result: EvaluationResult): string {
  const lines: string[] = [];

  lines.push('=== Matching Evaluation Report ===');
  lines.push('');
  lines.push(`Corpus: ${result.metrics.corpusId} (v${result.metrics.corpusVersion})`);
  lines.push(`Match Runs: ${result.metrics.matchRunIds.join(', ')}`);
  lines.push(`Comparison Runs: ${result.metrics.comparisonMatchRunIds.join(', ')}`);
  lines.push(`Evaluated At: ${result.metrics.evaluatedAt}`);
  lines.push('');

  lines.push('--- Metrics ---');
  lines.push(`Recall@50: ${(result.metrics.recallAt50 * 100).toFixed(1)}%`);
  lines.push(`Precision@3: ${(result.metrics.precisionAt3 * 100).toFixed(1)}%`);
  lines.push(`nDCG@5: ${(result.metrics.ndcgAt5 * 100).toFixed(1)}%`);
  lines.push('');

  lines.push('--- Guardrail Compliance ---');
  lines.push(`Guardrail Violations: ${result.metrics.guardrailViolationCount}`);
  lines.push(`Multi-Stretch Violations: ${result.metrics.multiStretchViolationCount}`);
  lines.push(`Missing Provenance: ${result.metrics.missingProvenanceCount}`);
  lines.push('');

  lines.push('--- Determinism ---');
  lines.push(`Byte-Identical Rerun: ${result.metrics.byteIdenticalRerun ? 'PASS' : 'FAIL'}`);
  lines.push('');

  lines.push('--- Thresholds ---');
  lines.push(`Min Recall@50: ${(result.thresholds.minRecallAt50 * 100).toFixed(1)}%`);
  lines.push(`Min Precision@3: ${(result.thresholds.minPrecisionAt3 * 100).toFixed(1)}%`);
  lines.push(`Min nDCG@5: ${(result.thresholds.minNdcgAt5 * 100).toFixed(1)}%`);
  lines.push(`Max Guardrail Violations: ${result.thresholds.maxGuardrailViolations}`);
  lines.push(`Max Multi-Stretch Violations: ${result.thresholds.maxMultiStretchViolations}`);
  lines.push(`Max Missing Provenance: ${result.thresholds.maxMissingProvenance}`);
  lines.push('');

  lines.push('--- Result ---');
  lines.push(result.passed ? '✓ PASS' : '✗ FAIL');
  lines.push('');

  if (result.failures.length > 0) {
    lines.push('--- Failures ---');
    for (const failure of result.failures) {
      lines.push(`  - ${failure}`);
    }
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push('--- Warnings ---');
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
    lines.push('');
  }

  lines.push('--- Detailed Results ---');
  for (const labelResult of result.metrics.labelResults) {
    lines.push(`Label: ${labelResult.labelId}`);
    lines.push(`  Candidate: ${labelResult.candidateId}`);
    lines.push(`  Role: ${labelResult.roleId}`);
    lines.push(`  Challenge: ${labelResult.challengeId}`);
    lines.push(`  Expected Grade: ${labelResult.expectedGrade}`);
    lines.push(`  Actual Rank: ${labelResult.actualRank ?? 'N/A'}`);
    lines.push(`  Actual Score: ${labelResult.actualScore?.toFixed(3) ?? 'N/A'}`);
    lines.push(`  Status: ${labelResult.passed ? 'PASS' : 'FAIL'}`);
    if (labelResult.failureReason) {
      lines.push(`  Failure: ${labelResult.failureReason}`);
    }
    if (labelResult.guardrailViolations.length > 0) {
      lines.push(`  Guardrail Violations: ${labelResult.guardrailViolations.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * CLI entry point for Node.js execution.
 */
export async function cliMain(args: string[]): Promise<number> {
  // Parse arguments (simplified for this implementation)
  const options: CliOptions = {
    corpusPath: args[0] ?? 'default',
    verbose: args.includes('--verbose'),
  };

  const jsonIndex = args.indexOf('--json');
  if (jsonIndex >= 0 && jsonIndex + 1 < args.length) {
    options.outputJson = args[jsonIndex + 1];
  }

  const reportIndex = args.indexOf('--report');
  if (reportIndex >= 0 && reportIndex + 1 < args.length) {
    options.outputReport = args[reportIndex + 1];
  }

  // In a real implementation, this would connect to D1
  // For now, we'll return an error code
  console.error('CLI requires D1 database connection');
  return 1;
}
