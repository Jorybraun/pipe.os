import { describe, expect, it } from 'vitest';
import { checkStagedRolloutGate } from '../../../lib/challengeMatching/evaluation/metrics';
import type { EvaluationMetrics } from '../../../lib/challengeMatching/evaluation/types';
import { STAGED_ROLLOUT_THRESHOLDS } from '../../../lib/challengeMatching/evaluation/types';

describe('rollout gate — criterion #8: controlled staged rollout', () => {
  function passingMetrics(overrides: Partial<EvaluationMetrics> = {}): EvaluationMetrics {
    return {
      corpusVersion: '1.0.0',
      corpusId: 'test-corpus',
      matchRunIds: ['run-1'],
      comparisonMatchRunIds: ['run-1'],
      evaluatedAt: new Date().toISOString(),
      recallAt50: 0.99,
      precisionAt3: 0.90,
      ndcgAt5: 0.90,
      guardrailViolationCount: 0,
      multiStretchViolationCount: 0,
      missingProvenanceCount: 0,
      missingMatchRunCount: 0,
      byteIdenticalRerun: true,
      rerunFingerprints: {},
      determinismComparisons: [],
      totalEvaluations: 20,
      evaluatedPairCount: 10,
      highlyRelevantInTop3: 18,
      relevantInTop3: 0,
      irrelevantInTop3: 0,
      forbiddenInResults: 0,
      syntheticFixtureCount: 0,
      expertLabelCount: 5,
      labelResults: [],
      expectedPacketCount: 5,
      packetCoverage: 1.0,
      pairCoverage: 1.0,
      comparisonCoverage: 1.0,
      missingPacketIds: [],
      packetIdentityMismatches: [],
      ...overrides,
    };
  }

  it('shadow stage passes with basic metrics', () => {
    const result = checkStagedRolloutGate(passingMetrics(), 'shadow');
    expect(result.stage).toBe('shadow');
    expect(result.ready).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('canary stage passes with full coverage and quality', () => {
    const result = checkStagedRolloutGate(passingMetrics(), 'canary');
    expect(result.stage).toBe('canary');
    expect(result.ready).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('production stage requires expert labels', () => {
    const result = checkStagedRolloutGate(
      passingMetrics({ expertLabelCount: 0, syntheticFixtureCount: 5 }),
      'production',
    );
    expect(result.stage).toBe('production');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('expert') || f.includes('Expert'))).toBe(true);
  });

  it('stages have progressively stricter thresholds', () => {
    const shadow = STAGED_ROLLOUT_THRESHOLDS.shadow;
    const canary = STAGED_ROLLOUT_THRESHOLDS.canary;
    const production = STAGED_ROLLOUT_THRESHOLDS.production;

    expect(shadow.minRecallAt50).toBeLessThanOrEqual(canary.minRecallAt50);
    expect(canary.minRecallAt50).toBeLessThanOrEqual(production.minRecallAt50);
    expect(shadow.minPairCoverage).toBeLessThanOrEqual(canary.minPairCoverage);
  });

  it('canary rejects low recall', () => {
    const result = checkStagedRolloutGate(
      passingMetrics({ recallAt50: 0.50 }),
      'canary',
    );
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('Recall'))).toBe(true);
  });

  it('canary rejects missing packet declarations', () => {
    const result = checkStagedRolloutGate(
      passingMetrics({ expectedPacketCount: 0, packetCoverage: 0 }),
      'canary',
    );
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('packet') || f.includes('declare'))).toBe(true);
  });

  it('returns structured result with metrics and thresholds', () => {
    const metrics = passingMetrics();
    const result = checkStagedRolloutGate(metrics, 'shadow');
    expect(result).toHaveProperty('stage');
    expect(result).toHaveProperty('ready');
    expect(result).toHaveProperty('failures');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('thresholds');
    expect(result.metrics).toBe(metrics);
  });
});
