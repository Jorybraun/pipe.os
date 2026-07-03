/**
 * Unified match report pipeline — orchestrates confidence scoring, gap analysis,
 * staleness alerts, and provenance into a single comprehensive report for a
 * candidate-to-challenge match.
 *
 * This is the top-level entrypoint for criteria #5 (evidence-based matching)
 * and #6 (explain every match). Recruiters get a single view combining all
 * evidence dimensions with actionable verdicts.
 */

import { computeMatchConfidence, type MatchConfidenceReport, type MatchConfidenceOptions } from './matchConfidenceScoring';
import { analyzeEvidenceGapsForChallenge, type EvidenceGapReport, type GapAnalysisOptions } from './evidenceGapAnalysis';
import { loadCandidateStalenessAlerts, type StalenessAlertSummary } from './evidenceStalenessAlerts';
import { loadMatchProvenanceChain, type MatchProvenanceChain } from './matchProvenanceChain';
import { loadPriorDecisionExclusions, type DecisionExclusionResult } from './decisionWeightedRematch';
import { buildConceptProfile } from './conceptSemanticMatch';
import type { D1Database } from '@cloudflare/workers-types';

export type MatchVerdict = 'strong_match' | 'likely_match' | 'needs_review' | 'weak_match' | 'insufficient_evidence';

export interface MatchReportSection {
  loaded: boolean;
  errorMessage: string | null;
}

export interface MatchReportConfidence extends MatchReportSection {
  report: MatchConfidenceReport | null;
}

export interface MatchReportGaps extends MatchReportSection {
  report: EvidenceGapReport | null;
}

export interface MatchReportStaleness extends MatchReportSection {
  summary: StalenessAlertSummary | null;
}

export interface MatchReportProvenance extends MatchReportSection {
  chain: MatchProvenanceChain | null;
}

export interface MatchReportDecisionHistory extends MatchReportSection {
  exclusions: DecisionExclusionResult | null;
}

export interface VerdictRationale {
  verdict: MatchVerdict;
  score: number;
  label: string;
  primaryReasons: string[];
  riskFactors: string[];
}

export interface UnifiedMatchReport {
  candidateId: string;
  challengePacketId: string;
  matchRunId: string | null;
  verdict: VerdictRationale;
  confidence: MatchReportConfidence;
  gaps: MatchReportGaps;
  staleness: MatchReportStaleness;
  provenance: MatchReportProvenance;
  decisionHistory: MatchReportDecisionHistory;
  generatedAt: string;
  pipelineVersion: string;
}

export interface CompactMatchEvidenceLine {
  label: string;
  detail: string;
  concepts: string[];
}

export interface CompactMatchReport {
  candidateId: string;
  challengePacketId: string;
  verdict: MatchVerdict;
  score: number;
  usable: boolean;
  candidateEvidence: CompactMatchEvidenceLine[];
  repoEvidence: CompactMatchEvidenceLine[];
  missingEvidence: CompactMatchEvidenceLine[];
  riskFactors: string[];
  nextAction: 'ready_for_assignment' | 'review_before_assignment' | 'collect_more_evidence' | 'design_better_challenge';
  generatedAt: string;
}

export interface MatchReportPipelineOptions {
  confidence?: MatchConfidenceOptions;
  gaps?: GapAnalysisOptions;
  includeProvenance?: boolean;
  matchRunId?: string;
  now?: Date;
}

const PIPELINE_VERSION = '1.0.0';

const REQUIRED_SIGNAL_FAMILIES: Array<{ label: string; tokens: readonly string[] }> = [
  { label: 'cron/schedule evidence', tokens: ['cron', 'schedule', 'schedules'] },
  { label: 'typed-array buffer evidence', tokens: ['arraybuffer', 'arraybufferview', 'typedarray', 'uint8array'] },
  { label: 'popover interaction evidence', tokens: ['onopenchange', 'popover', 'usepopoverroot'] },
];

function conceptTokenSet(concepts: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const concept of concepts) {
    for (const token of buildConceptProfile(concept).tokens) {
      tokens.add(token);
    }
  }
  return tokens;
}

function missingRequiredSignalFamilies(confidence: MatchConfidenceReport): string[] {
  const demandTokens = conceptTokenSet(confidence.demands.flatMap((demand) => demand.demandConcepts));
  const matchedTokens = conceptTokenSet(confidence.demands.flatMap((demand) => demand.matchedConcepts));
  const missing: string[] = [];

  for (const family of REQUIRED_SIGNAL_FAMILIES) {
    const isDemanded = family.tokens.some((token) => demandTokens.has(token));
    if (!isDemanded) continue;
    const isMatched = family.tokens.some((token) => matchedTokens.has(token));
    if (!isMatched) missing.push(family.label);
  }

  return missing;
}

function computeVerdict(
  confidence: MatchConfidenceReport | null,
  gaps: EvidenceGapReport | null,
  staleness: StalenessAlertSummary | null,
): VerdictRationale {
  const primaryReasons: string[] = [];
  const riskFactors: string[] = [];

  if (!confidence) {
    return {
      verdict: 'insufficient_evidence',
      score: 0,
      label: 'Insufficient Evidence',
      primaryReasons: ['Could not compute match confidence — missing data'],
      riskFactors: [],
    };
  }

  const baseScore = confidence.compositeScore;
  let adjustedScore = baseScore;
  const coverageScore = confidence.dimensions.find((dimension) => dimension.name === 'coverage')?.score ?? 0;
  if (coverageScore <= 0 || confidence.demands.every((demand) => demand.matchedConcepts.length === 0)) {
    return {
      verdict: 'insufficient_evidence',
      score: 0,
      label: 'Insufficient Evidence',
      primaryReasons: ['No candidate evidence overlaps this challenge packet'],
      riskFactors: ['No aligned candidate evidence found for the repo demands'],
    };
  }

  // Factor in staleness
  if (staleness) {
    if (staleness.overallHealth === 'critical') {
      adjustedScore *= 0.7;
      riskFactors.push(`Evidence health is critical (${staleness.criticalCount} critical alerts)`);
    } else if (staleness.overallHealth === 'at_risk') {
      riskFactors.push(`Evidence health at risk (${staleness.warningCount} warnings)`);
    }
  }

  // Factor in gap coverage
  if (gaps) {
    const gapPenalty = gaps.summary.noneCount / Math.max(gaps.summary.totalDemands, 1);
    if (gapPenalty > 0.5) {
      adjustedScore *= 0.75;
      riskFactors.push(`${gaps.summary.noneCount}/${gaps.summary.totalDemands} demands have no evidence`);
    } else if (gapPenalty > 0.25) {
      adjustedScore *= 0.9;
      riskFactors.push(`${gaps.summary.noneCount} demands lack any evidence`);
    }
  }

  const missingRequiredSignals = missingRequiredSignalFamilies(confidence);
  if (missingRequiredSignals.length > 0) {
    adjustedScore = Math.min(adjustedScore, 0.54);
    riskFactors.push(`Missing required ${missingRequiredSignals.join(', ')}`);
  }

  // Build primary reasons from confidence
  if (confidence.strongMatches.length > 0) {
    primaryReasons.push(`${confidence.strongMatches.length} demands strongly matched`);
  }
  if (confidence.stretchAreas.length > 0) {
    primaryReasons.push(`${confidence.stretchAreas.length} stretch areas identified`);
  }
  if (confidence.dimensions.length > 0) {
    const sorted = [...confidence.dimensions].sort((a, b) => b.score - a.score);
    const topDim = sorted[0];
    if (topDim) {
      primaryReasons.push(`Strongest dimension: ${topDim.label} (${(topDim.score * 100).toFixed(0)}%)`);
    }
  }

  // Classify verdict
  let verdict: MatchVerdict;
  let label: string;

  if (adjustedScore >= 0.75) {
    verdict = 'strong_match';
    label = 'Strong Match';
  } else if (adjustedScore >= 0.55) {
    verdict = 'likely_match';
    label = 'Likely Match';
  } else if (adjustedScore >= 0.35) {
    verdict = 'needs_review';
    label = 'Needs Review';
  } else if (adjustedScore > 0.1) {
    verdict = 'weak_match';
    label = 'Weak Match';
  } else {
    verdict = 'insufficient_evidence';
    label = 'Insufficient Evidence';
  }

  return {
    verdict,
    score: adjustedScore,
    label,
    primaryReasons,
    riskFactors,
  };
}

async function loadSection<T>(
  loader: () => Promise<T>,
): Promise<{ data: T | null; loaded: boolean; errorMessage: string | null }> {
  try {
    const data = await loader();
    return { data, loaded: true, errorMessage: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { data: null, loaded: false, errorMessage: message };
  }
}

export async function generateUnifiedMatchReport(
  db: D1Database,
  candidateId: string,
  challengePacketId: string,
  options: MatchReportPipelineOptions = {},
): Promise<UnifiedMatchReport> {
  const now = options.now ?? new Date();
  const confidenceOpts: MatchConfidenceOptions = { ...options.confidence, now };

  // Run confidence + gaps + staleness in parallel (independent queries)
  const [confidenceResult, gapsResult, stalenessResult, decisionResult] = await Promise.all([
    loadSection(() => computeMatchConfidence(db, candidateId, challengePacketId, confidenceOpts)),
    loadSection(() => analyzeEvidenceGapsForChallenge(db, candidateId, challengePacketId, options.gaps)),
    loadSection(() => loadCandidateStalenessAlerts(db, candidateId, { now })),
    loadSection(() => loadPriorDecisionExclusions(db, candidateId)),
  ]);

  // Provenance requires a match run ID — load only if provided
  let provenanceResult: { data: MatchProvenanceChain | null; loaded: boolean; errorMessage: string | null };
  if (options.matchRunId && options.includeProvenance !== false) {
    provenanceResult = await loadSection(() =>
      loadMatchProvenanceChain(db, options.matchRunId as string),
    );
  } else {
    provenanceResult = { data: null, loaded: false, errorMessage: options.matchRunId ? null : 'No match run ID provided' };
  }

  // Compute unified verdict
  const verdict = computeVerdict(
    confidenceResult.data,
    gapsResult.data,
    stalenessResult.data,
  );

  return {
    candidateId,
    challengePacketId,
    matchRunId: options.matchRunId ?? null,
    verdict,
    confidence: {
      loaded: confidenceResult.loaded,
      errorMessage: confidenceResult.errorMessage,
      report: confidenceResult.data,
    },
    gaps: {
      loaded: gapsResult.loaded,
      errorMessage: gapsResult.errorMessage,
      report: gapsResult.data,
    },
    staleness: {
      loaded: stalenessResult.loaded,
      errorMessage: stalenessResult.errorMessage,
      summary: stalenessResult.data,
    },
    provenance: {
      loaded: provenanceResult.loaded,
      errorMessage: provenanceResult.errorMessage,
      chain: provenanceResult.data,
    },
    decisionHistory: {
      loaded: decisionResult.loaded,
      errorMessage: decisionResult.errorMessage,
      exclusions: decisionResult.data,
    },
    generatedAt: now.toISOString(),
    pipelineVersion: PIPELINE_VERSION,
  };
}

function compactEvidenceLine(demand: {
  demandNarrative: string;
  matchedConcepts: string[];
  missingConcepts: string[];
  confidenceLevel: string;
}): CompactMatchEvidenceLine {
  return {
    label: demand.demandNarrative,
    detail: `${demand.confidenceLevel} evidence confidence`,
    concepts: demand.matchedConcepts,
  };
}

function compactMissingLine(demand: {
  demandNarrative: string;
  missingConcepts: string[];
}): CompactMatchEvidenceLine {
  return {
    label: demand.demandNarrative,
    detail: demand.missingConcepts.length > 0
      ? `Missing: ${demand.missingConcepts.slice(0, 4).join(', ')}`
      : 'No matched candidate evidence',
    concepts: demand.missingConcepts,
  };
}

function nextActionFor(report: UnifiedMatchReport): CompactMatchReport['nextAction'] {
  if (!report.confidence.report) return 'collect_more_evidence';
  if (report.verdict.verdict === 'strong_match' || report.verdict.verdict === 'likely_match') {
    return report.verdict.riskFactors.length > 0 ? 'review_before_assignment' : 'ready_for_assignment';
  }
  if (report.verdict.verdict === 'needs_review' || report.verdict.verdict === 'weak_match') {
    return 'review_before_assignment';
  }
  return report.gaps.report?.summary.noneCount === report.gaps.report?.summary.totalDemands
    ? 'collect_more_evidence'
    : 'design_better_challenge';
}

export function compactMatchReport(report: UnifiedMatchReport): CompactMatchReport {
  const confidence = report.confidence.report;
  const sortedDemands = confidence
    ? [...confidence.demands].sort((left, right) => right.confidenceScore - left.confidenceScore)
    : [];
  const missingDemands = sortedDemands
    .filter((demand) => demand.missingConcepts.length > 0 || demand.matchedConcepts.length === 0)
    .sort((left, right) => right.demandWeight - left.demandWeight);

  return {
    candidateId: report.candidateId,
    challengePacketId: report.challengePacketId,
    verdict: report.verdict.verdict,
    score: Math.round(report.verdict.score * 1000) / 1000,
    usable: report.verdict.verdict === 'strong_match' || report.verdict.verdict === 'likely_match',
    candidateEvidence: sortedDemands
      .filter((demand) => demand.matchedConcepts.length > 0)
      .slice(0, 3)
      .map(compactEvidenceLine),
    repoEvidence: sortedDemands
      .slice(0, 3)
      .map((demand) => ({
        label: demand.demandNarrative,
        detail: `${demand.demandConcepts.length} challenge concept${demand.demandConcepts.length === 1 ? '' : 's'}`,
        concepts: demand.demandConcepts,
      })),
    missingEvidence: missingDemands.slice(0, 3).map(compactMissingLine),
    riskFactors: [
      ...report.verdict.riskFactors,
      ...(confidence?.recommendations ?? []),
    ].slice(0, 5),
    nextAction: nextActionFor(report),
    generatedAt: report.generatedAt,
  };
}

export async function generateCompactMatchReport(
  db: D1Database,
  candidateId: string,
  challengePacketId: string,
  options: MatchReportPipelineOptions = {},
): Promise<CompactMatchReport> {
  const report = await generateUnifiedMatchReport(db, candidateId, challengePacketId, options);
  return compactMatchReport(report);
}
