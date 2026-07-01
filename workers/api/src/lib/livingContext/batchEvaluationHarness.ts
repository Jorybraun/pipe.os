/**
 * Batch evaluation harness for the living context graph.
 *
 * Runs evaluation across multiple candidate-challenge pairs, comparing
 * the living context match confidence against expert labels. Produces
 * per-pair diagnostics and aggregate metrics for staged rollout gates.
 *
 * Criterion #8: Prove production quality through batch evaluation.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { MatchConfidenceReport } from './matchConfidenceScoring';
import type { UnifiedMatchReport, MatchVerdict } from './matchReportPipeline';

export interface BatchEvaluationCandidate {
  candidateId: string;
  challengePacketId: string;
  expectedVerdict?: MatchVerdict;
  expertLabel?: string;
}

export interface BatchEvaluationPairResult {
  candidateId: string;
  challengePacketId: string;
  confidenceReport: MatchConfidenceReport | null;
  unifiedReport: UnifiedMatchReport | null;
  computedVerdict: MatchVerdict | null;
  expectedVerdict: MatchVerdict | null;
  verdictMatch: boolean;
  error: string | null;
  durationMs: number;
}

export interface BatchEvaluationMetrics {
  totalPairs: number;
  successfulPairs: number;
  failedPairs: number;
  verdictAccuracy: number;
  averageConfidence: number;
  verdictDistribution: Record<MatchVerdict, number>;
  evaluatedAt: string;
}

export interface BatchEvaluationResult {
  batchId: string;
  metrics: BatchEvaluationMetrics;
  pairResults: BatchEvaluationPairResult[];
}

export interface BatchEvaluationOptions {
  includeProvenance?: boolean;
  maxConcurrency?: number;
}

/**
 * Runs batch evaluation of the living context match pipeline across
 * multiple candidate-challenge pairs. For each pair, computes the unified
 * match report and compares the verdict against an optional expected verdict.
 */
export async function runBatchEvaluation(
  db: D1Database,
  candidates: BatchEvaluationCandidate[],
  options: BatchEvaluationOptions = {},
): Promise<BatchEvaluationResult> {
  const { computeMatchConfidence } = await import('./matchConfidenceScoring');
  const { generateUnifiedMatchReport } = await import('./matchReportPipeline');
  const batchId = `batch-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const includeProvenance = options.includeProvenance ?? false;

  const pairResults: BatchEvaluationPairResult[] = [];
  const verdictCounts: Record<MatchVerdict, number> = {
    strong_match: 0,
    likely_match: 0,
    needs_review: 0,
    weak_match: 0,
    insufficient_evidence: 0,
  };

  let totalConfidence = 0;
  let confidenceCount = 0;
  let verdictMatchCount = 0;

  for (const candidate of candidates) {
    const startTime = Date.now();
    let confidenceReport: MatchConfidenceReport | null = null;
    let unifiedReport: UnifiedMatchReport | null = null;
    let computedVerdict: MatchVerdict | null = null;
    let error: string | null = null;

    try {
      [confidenceReport, unifiedReport] = await Promise.all([
        computeMatchConfidence(db, candidate.candidateId, candidate.challengePacketId),
        generateUnifiedMatchReport(db, candidate.candidateId, candidate.challengePacketId, {
          includeProvenance,
        }),
      ]);
      computedVerdict = unifiedReport.verdict.verdict;
      verdictCounts[computedVerdict]++;
      totalConfidence += confidenceReport.compositeScore;
      confidenceCount++;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    const durationMs = Date.now() - startTime;
    const expectedVerdict = candidate.expectedVerdict ?? null;
    const verdictMatch = expectedVerdict !== null && computedVerdict === expectedVerdict;
    if (expectedVerdict !== null && computedVerdict !== null) {
      if (verdictMatch) verdictMatchCount++;
    }

    pairResults.push({
      candidateId: candidate.candidateId,
      challengePacketId: candidate.challengePacketId,
      confidenceReport,
      unifiedReport,
      computedVerdict,
      expectedVerdict,
      verdictMatch,
      error,
      durationMs,
    });
  }

  const pairsWithExpected = pairResults.filter((r) => r.expectedVerdict !== null);
  const verdictAccuracy = pairsWithExpected.length > 0
    ? verdictMatchCount / pairsWithExpected.length
    : 0;

  const metrics: BatchEvaluationMetrics = {
    totalPairs: candidates.length,
    successfulPairs: pairResults.filter((r) => r.error === null).length,
    failedPairs: pairResults.filter((r) => r.error !== null).length,
    verdictAccuracy,
    averageConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
    verdictDistribution: verdictCounts,
    evaluatedAt: new Date().toISOString(),
  };

  return { batchId, metrics, pairResults };
}

/**
 * Load candidate-challenge pairs from the evaluation corpus seeded in D1.
 * Returns pairs suitable for batch evaluation input.
 */
export async function loadEvaluationPairsFromCorpus(
  db: D1Database,
): Promise<BatchEvaluationCandidate[]> {
  const rows = await db.prepare(`
    SELECT DISTINCT
      mr.candidate_id,
      mr.ranked_results_json
    FROM match_runs mr
    WHERE mr.status = 'MATCHED'
    ORDER BY mr.created_at DESC
    LIMIT 100
  `).all<{ candidate_id: string; ranked_results_json: string }>();

  const pairs: BatchEvaluationCandidate[] = [];
  for (const row of rows.results) {
    try {
      const ranked = JSON.parse(row.ranked_results_json) as Array<{
        challengeId?: string;
        repoId?: string;
        prNumber?: number;
        sourceVersion?: string;
      }>;
      const first = ranked[0];
      if (ranked.length > 0 && first?.challengeId) {
        pairs.push({
          candidateId: row.candidate_id,
          challengePacketId: first.challengeId,
        });
      }
    } catch {
      // Skip malformed match run data
    }
  }

  return pairs;
}
