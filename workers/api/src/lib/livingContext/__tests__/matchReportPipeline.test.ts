import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependent modules
vi.mock('../matchConfidenceScoring', () => ({
  computeMatchConfidence: vi.fn(),
}));
vi.mock('../evidenceGapAnalysis', () => ({
  analyzeEvidenceGapsForChallenge: vi.fn(),
}));
vi.mock('../evidenceStalenessAlerts', () => ({
  loadCandidateStalenessAlerts: vi.fn(),
}));
vi.mock('../matchProvenanceChain', () => ({
  loadMatchProvenanceChain: vi.fn(),
}));
vi.mock('../decisionWeightedRematch', () => ({
  loadPriorDecisionExclusions: vi.fn(),
}));

import { generateUnifiedMatchReport } from '../matchReportPipeline';
import { computeMatchConfidence } from '../matchConfidenceScoring';
import { analyzeEvidenceGapsForChallenge } from '../evidenceGapAnalysis';
import { loadCandidateStalenessAlerts } from '../evidenceStalenessAlerts';
import { loadMatchProvenanceChain } from '../matchProvenanceChain';
import { loadPriorDecisionExclusions } from '../decisionWeightedRematch';
import type { MatchConfidenceReport } from '../matchConfidenceScoring';
import type { EvidenceGapReport } from '../evidenceGapAnalysis';
import type { StalenessAlertSummary } from '../evidenceStalenessAlerts';

const mockDb = {} as D1Database;
const CANDIDATE_ID = 'cand-abc';
const PACKET_ID = 'pkt-123';

function makeConfidenceReport(overrides: Partial<MatchConfidenceReport> = {}): MatchConfidenceReport {
  return {
    candidateId: CANDIDATE_ID,
    workspacePersonId: 'wp-1',
    challengeId: PACKET_ID,
    compositeScore: 0.72,
    compositeLevel: 'moderate',
    dimensions: [
      { name: 'coverage', label: 'Coverage', score: 0.8, weight: 0.35, detail: '80% of demands covered' },
      { name: 'recency', label: 'Recency', score: 0.65, weight: 0.25, detail: 'Moderate freshness' },
      { name: 'depth', label: 'Depth', score: 0.7, weight: 0.25, detail: '2.1 avg sources' },
      { name: 'consistency', label: 'Consistency', score: 0.6, weight: 0.15, detail: 'Low variance' },
    ],
    demands: [],
    stretchAreas: [{ demandId: 'd1', demandNarrative: 'Kubernetes experience', demandWeight: 0.5, demandConcepts: ['k8s'], matchedConcepts: [], missingConcepts: ['k8s'], coverageRatio: 0, averageRecency: 0, corroboratingSourceCount: 0, bestStrength: 0, effectiveStrength: 0, confidenceScore: 0.2, confidenceLevel: 'low', isStretch: true, stretchReason: 'Adjacent concept detected' }],
    strongMatches: [{ demandId: 'd2', demandNarrative: 'TypeScript proficiency', demandWeight: 0.8, demandConcepts: ['typescript'], matchedConcepts: ['typescript'], missingConcepts: [], coverageRatio: 1, averageRecency: 0.9, corroboratingSourceCount: 3, bestStrength: 0.9, effectiveStrength: 0.85, confidenceScore: 0.9, confidenceLevel: 'high', isStretch: false, stretchReason: null }],
    recommendations: ['Conduct technical interview to assess Kubernetes'],
    computedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeGapReport(overrides: Partial<EvidenceGapReport> = {}): EvidenceGapReport {
  return {
    candidateId: CANDIDATE_ID,
    workspacePersonId: 'wp-1',
    challengeId: PACKET_ID,
    demands: [],
    summary: {
      strongCount: 3,
      partialCount: 2,
      weakCount: 1,
      noneCount: 1,
      totalDemands: 7,
      coverageScore: 0.71,
      weightedCoverageScore: 0.68,
    },
    recommendations: ['Request evidence for distributed systems'],
    ...overrides,
  };
}

function makeStalenessAlerts(overrides: Partial<StalenessAlertSummary> = {}): StalenessAlertSummary {
  return {
    candidateId: CANDIDATE_ID,
    workspacePersonId: 'wp-1',
    criticalCount: 0,
    warningCount: 1,
    infoCount: 2,
    overallHealth: 'attention_needed',
    alerts: [],
    computedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('matchReportPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateUnifiedMatchReport', () => {
    it('produces a strong_match verdict when confidence is high and no risk factors', async () => {
      const confidence = makeConfidenceReport({ compositeScore: 0.85, compositeLevel: 'high' });
      const gaps = makeGapReport({ summary: { ...makeGapReport().summary, noneCount: 0 } });
      const staleness = makeStalenessAlerts({ overallHealth: 'healthy', criticalCount: 0, warningCount: 0 });

      vi.mocked(computeMatchConfidence).mockResolvedValue(confidence);
      vi.mocked(analyzeEvidenceGapsForChallenge).mockResolvedValue(gaps);
      vi.mocked(loadCandidateStalenessAlerts).mockResolvedValue(staleness);
      vi.mocked(loadPriorDecisionExclusions).mockResolvedValue({
        excludedPacketIds: [],
        exclusions: [],
        deferredCount: 0,
        totalDecisions: 0,
      });

      const report = await generateUnifiedMatchReport(mockDb, CANDIDATE_ID, PACKET_ID);

      expect(report.verdict.verdict).toBe('strong_match');
      expect(report.verdict.score).toBeGreaterThanOrEqual(0.75);
      expect(report.verdict.riskFactors).toHaveLength(0);
      expect(report.confidence.loaded).toBe(true);
      expect(report.gaps.loaded).toBe(true);
      expect(report.staleness.loaded).toBe(true);
      expect(report.pipelineVersion).toBe('1.0.0');
    });

    it('produces a needs_review verdict when confidence is moderate with staleness risk', async () => {
      const confidence = makeConfidenceReport({ compositeScore: 0.55 });
      const gaps = makeGapReport();
      const staleness = makeStalenessAlerts({ overallHealth: 'critical', criticalCount: 2 });

      vi.mocked(computeMatchConfidence).mockResolvedValue(confidence);
      vi.mocked(analyzeEvidenceGapsForChallenge).mockResolvedValue(gaps);
      vi.mocked(loadCandidateStalenessAlerts).mockResolvedValue(staleness);
      vi.mocked(loadPriorDecisionExclusions).mockResolvedValue({
        excludedPacketIds: ['pkt-old'],
        exclusions: [{ packetId: 'pkt-old', verdict: 'reject', decidedAt: '2026-06-01', candidateId: CANDIDATE_ID, challengeTitle: 'Old PR' }],
        deferredCount: 0,
        totalDecisions: 1,
      });

      const report = await generateUnifiedMatchReport(mockDb, CANDIDATE_ID, PACKET_ID);

      expect(report.verdict.verdict).toBe('needs_review');
      expect(report.verdict.riskFactors.length).toBeGreaterThan(0);
      expect(report.verdict.riskFactors.some((r) => r.includes('critical'))).toBe(true);
      expect(report.decisionHistory.exclusions?.totalDecisions).toBe(1);
    });

    it('produces insufficient_evidence when confidence computation fails', async () => {
      vi.mocked(computeMatchConfidence).mockRejectedValue(new Error('No workspace person'));
      vi.mocked(analyzeEvidenceGapsForChallenge).mockRejectedValue(new Error('Packet not found'));
      vi.mocked(loadCandidateStalenessAlerts).mockResolvedValue(null);
      vi.mocked(loadPriorDecisionExclusions).mockResolvedValue({
        excludedPacketIds: [],
        exclusions: [],
        deferredCount: 0,
        totalDecisions: 0,
      });

      const report = await generateUnifiedMatchReport(mockDb, CANDIDATE_ID, PACKET_ID);

      expect(report.verdict.verdict).toBe('insufficient_evidence');
      expect(report.confidence.loaded).toBe(false);
      expect(report.confidence.errorMessage).toContain('No workspace person');
      expect(report.gaps.loaded).toBe(false);
    });

    it('includes provenance when matchRunId is provided', async () => {
      vi.mocked(computeMatchConfidence).mockResolvedValue(makeConfidenceReport());
      vi.mocked(analyzeEvidenceGapsForChallenge).mockResolvedValue(makeGapReport());
      vi.mocked(loadCandidateStalenessAlerts).mockResolvedValue(null);
      vi.mocked(loadPriorDecisionExclusions).mockResolvedValue({
        excludedPacketIds: [],
        exclusions: [],
        deferredCount: 0,
        totalDecisions: 0,
      });
      vi.mocked(loadMatchProvenanceChain).mockResolvedValue({
        decision: { matchRunId: 'run-1', candidateId: CANDIDATE_ID, status: 'matched', selectedPacketId: PACKET_ID, policyVersion: '2.0', createdAt: Date.now() },
        demandLinks: [],
        signals: [],
        assertions: [],
        artifacts: [],
        interactions: [],
        summary: { totalDemands: 5, linkedDemands: 3, totalSignals: 4, totalAssertions: 6, totalArtifacts: 2, totalInteractions: 3 },
      });

      const report = await generateUnifiedMatchReport(mockDb, CANDIDATE_ID, PACKET_ID, {
        matchRunId: 'run-1',
      });

      expect(report.provenance.loaded).toBe(true);
      expect(report.provenance.chain).not.toBeNull();
      expect(loadMatchProvenanceChain).toHaveBeenCalledWith(mockDb, 'run-1');
    });

    it('skips provenance when no matchRunId', async () => {
      vi.mocked(computeMatchConfidence).mockResolvedValue(makeConfidenceReport());
      vi.mocked(analyzeEvidenceGapsForChallenge).mockResolvedValue(makeGapReport());
      vi.mocked(loadCandidateStalenessAlerts).mockResolvedValue(null);
      vi.mocked(loadPriorDecisionExclusions).mockResolvedValue({
        excludedPacketIds: [],
        exclusions: [],
        deferredCount: 0,
        totalDecisions: 0,
      });

      const report = await generateUnifiedMatchReport(mockDb, CANDIDATE_ID, PACKET_ID);

      expect(report.provenance.loaded).toBe(false);
      expect(report.provenance.chain).toBeNull();
      expect(loadMatchProvenanceChain).not.toHaveBeenCalled();
    });

    it('applies gap penalty for high missing-demand ratio', async () => {
      const confidence = makeConfidenceReport({ compositeScore: 0.65 });
      const gaps = makeGapReport({
        summary: { strongCount: 1, partialCount: 0, weakCount: 0, noneCount: 5, totalDemands: 6, coverageScore: 0.2, weightedCoverageScore: 0.15 },
      });

      vi.mocked(computeMatchConfidence).mockResolvedValue(confidence);
      vi.mocked(analyzeEvidenceGapsForChallenge).mockResolvedValue(gaps);
      vi.mocked(loadCandidateStalenessAlerts).mockResolvedValue(null);
      vi.mocked(loadPriorDecisionExclusions).mockResolvedValue({
        excludedPacketIds: [],
        exclusions: [],
        deferredCount: 0,
        totalDecisions: 0,
      });

      const report = await generateUnifiedMatchReport(mockDb, CANDIDATE_ID, PACKET_ID);

      // 0.65 * 0.75 = 0.4875 → needs_review
      expect(report.verdict.score).toBeLessThan(0.65);
      expect(report.verdict.riskFactors.some((r) => r.includes('no evidence'))).toBe(true);
    });

    it('returns correct structure with all fields populated', async () => {
      vi.mocked(computeMatchConfidence).mockResolvedValue(makeConfidenceReport());
      vi.mocked(analyzeEvidenceGapsForChallenge).mockResolvedValue(makeGapReport());
      vi.mocked(loadCandidateStalenessAlerts).mockResolvedValue(makeStalenessAlerts());
      vi.mocked(loadPriorDecisionExclusions).mockResolvedValue({
        excludedPacketIds: [],
        exclusions: [],
        deferredCount: 0,
        totalDecisions: 0,
      });

      const now = new Date('2026-07-01T00:00:00.000Z');
      const report = await generateUnifiedMatchReport(mockDb, CANDIDATE_ID, PACKET_ID, { now });

      expect(report.candidateId).toBe(CANDIDATE_ID);
      expect(report.challengePacketId).toBe(PACKET_ID);
      expect(report.matchRunId).toBeNull();
      expect(report.generatedAt).toBe('2026-07-01T00:00:00.000Z');
      expect(report.pipelineVersion).toBe('1.0.0');
      expect(report.verdict).toHaveProperty('verdict');
      expect(report.verdict).toHaveProperty('score');
      expect(report.verdict).toHaveProperty('label');
      expect(report.verdict).toHaveProperty('primaryReasons');
      expect(report.verdict).toHaveProperty('riskFactors');
    });

    it('handles likely_match classification (0.55-0.75 range)', async () => {
      const confidence = makeConfidenceReport({ compositeScore: 0.62, compositeLevel: 'moderate' });
      const gaps = makeGapReport({ summary: { ...makeGapReport().summary, noneCount: 0 } });

      vi.mocked(computeMatchConfidence).mockResolvedValue(confidence);
      vi.mocked(analyzeEvidenceGapsForChallenge).mockResolvedValue(gaps);
      vi.mocked(loadCandidateStalenessAlerts).mockResolvedValue(makeStalenessAlerts({ overallHealth: 'healthy' }));
      vi.mocked(loadPriorDecisionExclusions).mockResolvedValue({
        excludedPacketIds: [],
        exclusions: [],
        deferredCount: 0,
        totalDecisions: 0,
      });

      const report = await generateUnifiedMatchReport(mockDb, CANDIDATE_ID, PACKET_ID);

      expect(report.verdict.verdict).toBe('likely_match');
      expect(report.verdict.label).toBe('Likely Match');
    });

    it('handles weak_match classification (0.1-0.35 range)', async () => {
      const confidence = makeConfidenceReport({ compositeScore: 0.25, compositeLevel: 'low' });
      const gaps = makeGapReport({ summary: { ...makeGapReport().summary, noneCount: 0 } });

      vi.mocked(computeMatchConfidence).mockResolvedValue(confidence);
      vi.mocked(analyzeEvidenceGapsForChallenge).mockResolvedValue(gaps);
      vi.mocked(loadCandidateStalenessAlerts).mockResolvedValue(null);
      vi.mocked(loadPriorDecisionExclusions).mockResolvedValue({
        excludedPacketIds: [],
        exclusions: [],
        deferredCount: 0,
        totalDecisions: 0,
      });

      const report = await generateUnifiedMatchReport(mockDb, CANDIDATE_ID, PACKET_ID);

      expect(report.verdict.verdict).toBe('weak_match');
      expect(report.verdict.label).toBe('Weak Match');
    });
  });
});
