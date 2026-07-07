/**
 * Internal match-quality evaluation for living-context repo matching.
 *
 * This is intentionally not candidate-facing. It evaluates labelled
 * candidate/challenge cases so repo matching can fail loudly before a code
 * review invite is sent.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { MatchConfidenceReport } from './matchConfidenceScoring';
import type {
  CompactMatchReport,
  MatchVerdict,
  UnifiedMatchReport,
} from './matchReportPipeline';

export type MatchQualityReasonCategory =
  | 'aligned'
  | 'insufficient_evidence'
  | 'missing_candidate_evidence'
  | 'missing_repo_evidence'
  | 'needs_challenge_design'
  | 'negative_contrast'
  | 'source_backing';

export interface BatchEvaluationCandidate {
  caseId?: string;
  candidateId: string;
  challengePacketId: string;
  expectedVerdict: MatchVerdict;
  expectedReasonCategory?: MatchQualityReasonCategory;
  expertLabel?: string;
  negativeCandidateId?: string;
  minimumScoreSeparation?: number;
  requireSourceBackedPr?: boolean;
  requireCandidateEvidence?: boolean;
  requireRepoEvidence?: boolean;
}

export interface BatchEvaluationPairResult {
  caseId: string;
  candidateId: string;
  challengePacketId: string;
  negativeCandidateId: string | null;
  confidenceReport: MatchConfidenceReport | null;
  unifiedReport: UnifiedMatchReport | null;
  compactReport: CompactMatchReport | null;
  computedVerdict: MatchVerdict | null;
  expectedVerdict: MatchVerdict;
  verdictMatch: boolean;
  reasonCategory: MatchQualityReasonCategory | null;
  scoreSeparation: number | null;
  minimumScoreSeparation: number | null;
  sourceBackedPr: boolean;
  candidateEvidencePresent: boolean;
  repoEvidencePresent: boolean;
  usableChallenge: boolean;
  failedReasons: string[];
  error: string | null;
  durationMs: number;
}

export interface BatchEvaluationMetrics {
  totalPairs: number;
  successfulPairs: number;
  failedPairs: number;
  negativeCaseCount: number;
  insufficientEvidenceCaseCount: number;
  contrastCaseCount: number;
  reasonCategoryExpectationCount: number;
  verdictAccuracy: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  averageConfidence: number;
  averageScoreSeparation: number;
  usableChallengeRate: number;
  verdictDistribution: Record<MatchVerdict, number>;
  evaluatedAt: string;
}

export interface BatchEvaluationResult {
  batchId: string;
  metrics: BatchEvaluationMetrics;
  failedCases: BatchEvaluationPairResult[];
  pairResults: BatchEvaluationPairResult[];
}

export interface MatchQualityEvaluationThresholds {
  minAccuracy: number;
  maxFalsePositiveCount: number;
  maxFalseNegativeCount: number;
  minAverageScoreSeparation: number;
  minUsableChallengeRate: number;
  minNegativeCaseCount: number;
  minInsufficientEvidenceCaseCount: number;
  minContrastCaseCount: number;
  minReasonCategoryExpectationCount: number;
}

export interface MatchQualityEvaluationResult extends BatchEvaluationResult {
  corpusId: string;
  passed: boolean;
  thresholds: MatchQualityEvaluationThresholds;
  gateFailures: string[];
}

export interface MatchQualityEvaluationOptions {
  corpusId: string;
  cases: BatchEvaluationCandidate[];
  thresholds?: Partial<MatchQualityEvaluationThresholds>;
  includeProvenance?: boolean;
}

export interface BatchEvaluationOptions {
  includeProvenance?: boolean;
}

interface PacketQuality {
  sourceBackedPr: boolean;
  repoEvidencePresent: boolean;
}

const DEFAULT_THRESHOLDS: MatchQualityEvaluationThresholds = {
  minAccuracy: 0.9,
  maxFalsePositiveCount: 0,
  maxFalseNegativeCount: 0,
  minAverageScoreSeparation: 0.08,
  minUsableChallengeRate: 0.95,
  minNegativeCaseCount: 1,
  minInsufficientEvidenceCaseCount: 1,
  minContrastCaseCount: 1,
  minReasonCategoryExpectationCount: 1,
};

function verdictCounts(): Record<MatchVerdict, number> {
  return {
    strong_match: 0,
    likely_match: 0,
    needs_review: 0,
    weak_match: 0,
    insufficient_evidence: 0,
  };
}

function isPositiveVerdict(verdict: MatchVerdict | null): boolean {
  return verdict === 'strong_match' || verdict === 'likely_match';
}

function candidateEvidencePresent(report: MatchConfidenceReport | null): boolean {
  return Boolean(report?.demands.some((demand) => demand.matchedConcepts.length > 0));
}

function repoEvidencePresentFromPacket(packet: unknown): boolean {
  if (!packet || typeof packet !== 'object') return false;
  const demands = (packet as { demands?: unknown }).demands;
  if (!Array.isArray(demands) || demands.length === 0) return false;
  return demands.some((demand) => {
    if (!demand || typeof demand !== 'object') return false;
    const row = demand as {
      sourceSpanIds?: unknown;
      changedSymbolIds?: unknown;
      conceptKeys?: unknown;
      concepts?: unknown;
    };
    return (Array.isArray(row.sourceSpanIds) && row.sourceSpanIds.length > 0)
      || (Array.isArray(row.changedSymbolIds) && row.changedSymbolIds.length > 0)
      || (Array.isArray(row.conceptKeys) && row.conceptKeys.length > 0)
      || (Array.isArray(row.concepts) && row.concepts.length > 0);
  });
}

async function loadPacketQuality(
  db: D1Database,
  challengePacketId: string,
): Promise<PacketQuality> {
  const row = await db.prepare(
    `SELECT pr_number, production_ready, quality_score, packet_json
       FROM review_challenge_packets
      WHERE id = ?1`,
  ).bind(challengePacketId).first<{
    pr_number: number | null;
    production_ready: number | null;
    quality_score: number | null;
    packet_json: string;
  }>();
  if (!row) return { sourceBackedPr: false, repoEvidencePresent: false };

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.packet_json);
  } catch {
    return { sourceBackedPr: false, repoEvidencePresent: false };
  }

  return {
    sourceBackedPr: Number.isInteger(row.pr_number)
      && (row.pr_number ?? 0) > 0
      && row.production_ready === 1
      && (row.quality_score ?? 0) >= 0.7,
    repoEvidencePresent: repoEvidencePresentFromPacket(parsed),
  };
}

function caseIdFor(candidate: BatchEvaluationCandidate, index: number): string {
  return candidate.caseId
    ?? `${candidate.candidateId}:${candidate.challengePacketId}:${index + 1}`;
}

function failedReasonsFor(input: {
  candidate: BatchEvaluationCandidate;
  computedVerdict: MatchVerdict | null;
  verdictMatch: boolean;
  sourceBackedPr: boolean;
  candidateEvidencePresent: boolean;
  repoEvidencePresent: boolean;
  scoreSeparation: number | null;
}): string[] {
  const failures: string[] = [];
  if (!input.verdictMatch) failures.push('verdict_mismatch');
  if (input.candidate.requireSourceBackedPr !== false && !input.sourceBackedPr) {
    failures.push('missing_source_backed_pr');
  }
  if (input.candidate.requireCandidateEvidence !== false && !input.candidateEvidencePresent) {
    failures.push('missing_candidate_evidence');
  }
  if (input.candidate.requireRepoEvidence !== false && !input.repoEvidencePresent) {
    failures.push('missing_repo_evidence');
  }
  if (
    input.candidate.minimumScoreSeparation !== undefined
    && (
      input.scoreSeparation === null
      || input.scoreSeparation < input.candidate.minimumScoreSeparation
    )
  ) {
    failures.push('score_separation_too_flat');
  }
  if (
    isPositiveVerdict(input.computedVerdict)
    && (!input.sourceBackedPr || !input.candidateEvidencePresent || !input.repoEvidencePresent)
  ) {
    failures.push('positive_verdict_without_provenance');
  }
  return [...new Set(failures)];
}

function reasonCategoryFor(input: {
  computedVerdict: MatchVerdict | null;
  failedReasons: string[];
}): MatchQualityReasonCategory | null {
  if (input.failedReasons.includes('case_error')) return null;
  if (input.failedReasons.includes('missing_source_backed_pr')) return 'source_backing';
  if (input.failedReasons.includes('missing_repo_evidence')) return 'missing_repo_evidence';
  if (input.failedReasons.includes('missing_candidate_evidence')) return 'missing_candidate_evidence';
  if (input.failedReasons.includes('score_separation_too_flat')) return 'negative_contrast';
  if (input.failedReasons.includes('positive_verdict_without_provenance')) return 'source_backing';
  if (input.computedVerdict === 'insufficient_evidence') return 'insufficient_evidence';
  if (isPositiveVerdict(input.computedVerdict)) return 'aligned';
  if (input.computedVerdict === 'needs_review' || input.computedVerdict === 'weak_match') {
    return 'needs_challenge_design';
  }
  return null;
}

/**
 * Runs labelled pair evaluation. Prefer runMatchQualityEvaluation for gates.
 */
export async function runBatchEvaluation(
  db: D1Database,
  candidates: BatchEvaluationCandidate[],
  options: BatchEvaluationOptions = {},
): Promise<BatchEvaluationResult> {
  const { computeMatchConfidence } = await import('./matchConfidenceScoring');
  const { generateCompactMatchReport, generateUnifiedMatchReport } = await import('./matchReportPipeline');
  const batchId = `batch-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const includeProvenance = options.includeProvenance ?? false;
  const pairResults: BatchEvaluationPairResult[] = [];
  const distribution = verdictCounts();
  let totalConfidence = 0;
  let confidenceCount = 0;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    const startedAt = Date.now();
    let confidenceReport: MatchConfidenceReport | null = null;
    let unifiedReport: UnifiedMatchReport | null = null;
    let compactReport: CompactMatchReport | null = null;
    let computedVerdict: MatchVerdict | null = null;
    let error: string | null = null;
    let scoreSeparation: number | null = null;
    let sourceBackedPr = false;
    let repoEvidencePresent = false;

    try {
      const [confidence, unified, compact, packetQuality] = await Promise.all([
        computeMatchConfidence(db, candidate.candidateId, candidate.challengePacketId),
        generateUnifiedMatchReport(db, candidate.candidateId, candidate.challengePacketId, {
          includeProvenance,
        }),
        generateCompactMatchReport(db, candidate.candidateId, candidate.challengePacketId, {
          includeProvenance,
        }),
        loadPacketQuality(db, candidate.challengePacketId),
      ]);
      confidenceReport = confidence;
      unifiedReport = unified;
      compactReport = compact;
      computedVerdict = unified.verdict.verdict;
      distribution[computedVerdict]++;
      totalConfidence += confidence.compositeScore;
      confidenceCount++;
      sourceBackedPr = packetQuality.sourceBackedPr;
      repoEvidencePresent = packetQuality.repoEvidencePresent;

      if (candidate.negativeCandidateId) {
        const negativeConfidence = await computeMatchConfidence(
          db,
          candidate.negativeCandidateId,
          candidate.challengePacketId,
        );
        scoreSeparation = confidence.compositeScore - negativeConfidence.compositeScore;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    const hasCandidateEvidence = candidateEvidencePresent(confidenceReport);
    const verdictMatch = computedVerdict === candidate.expectedVerdict;
    const failedReasons = error
      ? ['case_error']
      : failedReasonsFor({
          candidate,
          computedVerdict,
          verdictMatch,
          sourceBackedPr,
          candidateEvidencePresent: hasCandidateEvidence,
          repoEvidencePresent,
          scoreSeparation,
        });
    const reasonCategory = reasonCategoryFor({ computedVerdict, failedReasons });
    if (
      !error
      && candidate.expectedReasonCategory !== undefined
      && reasonCategory !== candidate.expectedReasonCategory
    ) {
      failedReasons.push('reason_category_mismatch');
    }

    pairResults.push({
      caseId: caseIdFor(candidate, index),
      candidateId: candidate.candidateId,
      challengePacketId: candidate.challengePacketId,
      negativeCandidateId: candidate.negativeCandidateId ?? null,
      confidenceReport,
      unifiedReport,
      compactReport,
      computedVerdict,
      expectedVerdict: candidate.expectedVerdict,
      verdictMatch,
      reasonCategory,
      scoreSeparation,
      minimumScoreSeparation: candidate.minimumScoreSeparation ?? null,
      sourceBackedPr,
      candidateEvidencePresent: hasCandidateEvidence,
      repoEvidencePresent,
      usableChallenge: sourceBackedPr && repoEvidencePresent,
      failedReasons,
      error,
      durationMs: Date.now() - startedAt,
    });
  }

  const successfulPairs = pairResults.filter((result) => result.error === null);
  const scoreSeparations = pairResults
    .map((result) => result.scoreSeparation)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const verdictMatches = successfulPairs.filter((result) => result.verdictMatch).length;
  const falsePositiveCount = pairResults.filter((result) =>
    isPositiveVerdict(result.computedVerdict) && !isPositiveVerdict(result.expectedVerdict)
  ).length;
  const falseNegativeCount = pairResults.filter((result) =>
    !isPositiveVerdict(result.computedVerdict) && isPositiveVerdict(result.expectedVerdict)
  ).length;
  const negativeCaseCount = candidates.filter((candidate) =>
    !isPositiveVerdict(candidate.expectedVerdict)
  ).length;
  const insufficientEvidenceCaseCount = candidates.filter((candidate) =>
    candidate.expectedVerdict === 'insufficient_evidence'
  ).length;
  const contrastCaseCount = candidates.filter((candidate) =>
    Boolean(candidate.negativeCandidateId)
      && candidate.minimumScoreSeparation !== undefined
  ).length;
  const reasonCategoryExpectationCount = candidates.filter((candidate) =>
    candidate.expectedReasonCategory !== undefined
  ).length;

  const metrics: BatchEvaluationMetrics = {
    totalPairs: candidates.length,
    successfulPairs: successfulPairs.length,
    failedPairs: pairResults.filter((result) => result.error !== null).length,
    negativeCaseCount,
    insufficientEvidenceCaseCount,
    contrastCaseCount,
    reasonCategoryExpectationCount,
    verdictAccuracy: successfulPairs.length > 0 ? verdictMatches / successfulPairs.length : 0,
    falsePositiveCount,
    falseNegativeCount,
    averageConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
    averageScoreSeparation: scoreSeparations.length > 0
      ? scoreSeparations.reduce((sum, value) => sum + value, 0) / scoreSeparations.length
      : 0,
    usableChallengeRate: pairResults.length > 0
      ? pairResults.filter((result) => result.usableChallenge).length / pairResults.length
      : 0,
    verdictDistribution: distribution,
    evaluatedAt: new Date().toISOString(),
  };

  const failedCases = pairResults.filter((result) =>
    result.error !== null || result.failedReasons.length > 0
  );

  return {
    batchId,
    metrics,
    failedCases,
    pairResults,
  };
}

export async function runMatchQualityEvaluation(
  db: D1Database,
  options: MatchQualityEvaluationOptions,
): Promise<MatchQualityEvaluationResult> {
  const thresholds: MatchQualityEvaluationThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...options.thresholds,
  };
  const batch = await runBatchEvaluation(db, options.cases, {
    includeProvenance: options.includeProvenance,
  });
  const gateFailures: string[] = [];

  if (batch.metrics.verdictAccuracy < thresholds.minAccuracy) {
    gateFailures.push(`accuracy ${batch.metrics.verdictAccuracy.toFixed(3)} below ${thresholds.minAccuracy}`);
  }
  if (batch.metrics.falsePositiveCount > thresholds.maxFalsePositiveCount) {
    gateFailures.push(`false positives ${batch.metrics.falsePositiveCount} above ${thresholds.maxFalsePositiveCount}`);
  }
  if (batch.metrics.falseNegativeCount > thresholds.maxFalseNegativeCount) {
    gateFailures.push(`false negatives ${batch.metrics.falseNegativeCount} above ${thresholds.maxFalseNegativeCount}`);
  }
  if (batch.metrics.averageScoreSeparation < thresholds.minAverageScoreSeparation) {
    gateFailures.push(`average score separation ${batch.metrics.averageScoreSeparation.toFixed(3)} below ${thresholds.minAverageScoreSeparation}`);
  }
  if (batch.metrics.usableChallengeRate < thresholds.minUsableChallengeRate) {
    gateFailures.push(`usable challenge rate ${batch.metrics.usableChallengeRate.toFixed(3)} below ${thresholds.minUsableChallengeRate}`);
  }
  if (batch.metrics.negativeCaseCount < thresholds.minNegativeCaseCount) {
    gateFailures.push(`negative cases ${batch.metrics.negativeCaseCount} below ${thresholds.minNegativeCaseCount}`);
  }
  if (batch.metrics.insufficientEvidenceCaseCount < thresholds.minInsufficientEvidenceCaseCount) {
    gateFailures.push(
      `insufficient-evidence cases ${batch.metrics.insufficientEvidenceCaseCount} below ${thresholds.minInsufficientEvidenceCaseCount}`,
    );
  }
  if (batch.metrics.contrastCaseCount < thresholds.minContrastCaseCount) {
    gateFailures.push(`contrast cases ${batch.metrics.contrastCaseCount} below ${thresholds.minContrastCaseCount}`);
  }
  if (batch.metrics.reasonCategoryExpectationCount < thresholds.minReasonCategoryExpectationCount) {
    gateFailures.push(`reason-category expectations ${batch.metrics.reasonCategoryExpectationCount} below ${thresholds.minReasonCategoryExpectationCount}`);
  }
  if (batch.failedCases.length > 0) {
    gateFailures.push(`${batch.failedCases.length} labelled case${batch.failedCases.length === 1 ? '' : 's'} failed`);
  }
  const reasonMismatchCount = batch.failedCases.filter((result) =>
    result.failedReasons.includes('reason_category_mismatch')
  ).length;
  if (reasonMismatchCount > 0) {
    gateFailures.push(`${reasonMismatchCount} labelled case${reasonMismatchCount === 1 ? '' : 's'} failed reason-category expectations`);
  }

  return {
    ...batch,
    corpusId: options.corpusId,
    passed: gateFailures.length === 0,
    thresholds,
    gateFailures,
  };
}
