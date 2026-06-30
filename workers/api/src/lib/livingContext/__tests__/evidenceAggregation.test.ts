import { describe, it, expect } from 'vitest';
import {
  aggregateConceptEvidence,
  aggregateAllConceptEvidence,
  DEFAULT_AGGREGATION_CONFIG,
  type EvidenceObservation,
  type AggregationConfig,
} from '../evidenceAggregation';

const referenceTime = new Date('2026-06-15T00:00:00Z').getTime();

function makeConfig(overrides?: Partial<AggregationConfig>): AggregationConfig {
  return {
    ...DEFAULT_AGGREGATION_CONFIG,
    decay: {
      ...DEFAULT_AGGREGATION_CONFIG.decay,
      referenceTimeMs: referenceTime,
    },
    ...overrides,
  };
}

function observation(overrides: Partial<EvidenceObservation> = {}): EvidenceObservation {
  return {
    assertionId: `assertion-${Math.random().toString(36).slice(2, 8)}`,
    conceptKey: 'term:typescript',
    confidence: 0.8,
    strength: 0.7,
    observedAt: '2026-06-10T00:00:00Z',
    interactionType: 'code_review',
    polarity: 'positive',
    ...overrides,
  };
}

describe('evidenceAggregation', () => {
  describe('aggregateConceptEvidence', () => {
    it('returns zeros for empty observations', () => {
      const result = aggregateConceptEvidence([], makeConfig());
      expect(result.observationCount).toBe(0);
      expect(result.compositeConfidence).toBe(0);
      expect(result.compositeStrength).toBe(0);
    });

    it('returns raw values for single observation within grace period', () => {
      const config = makeConfig();
      const obs = observation({ observedAt: '2026-06-10T00:00:00Z' });
      const result = aggregateConceptEvidence([obs], config);
      expect(result.observationCount).toBe(1);
      expect(result.corroborationCount).toBe(0);
      expect(result.compositeConfidence).toBeCloseTo(0.8, 2);
      expect(result.compositeStrength).toBeCloseTo(0.7, 2);
    });

    it('boosts confidence with corroborating observations', () => {
      const config = makeConfig();
      const obs1 = observation({ assertionId: 'a1', observedAt: '2026-06-10T00:00:00Z' });
      const obs2 = observation({ assertionId: 'a2', observedAt: '2026-06-08T00:00:00Z' });
      const obs3 = observation({ assertionId: 'a3', observedAt: '2026-06-05T00:00:00Z' });

      const single = aggregateConceptEvidence([obs1], config);
      const multiple = aggregateConceptEvidence([obs1, obs2, obs3], config);

      expect(multiple.compositeConfidence).toBeGreaterThan(single.compositeConfidence);
      expect(multiple.corroborationCount).toBe(2);
    });

    it('applies diversity bonus for multiple interaction types', () => {
      const config = makeConfig();
      const obs1 = observation({ interactionType: 'code_review', observedAt: '2026-06-10T00:00:00Z' });
      const obs2 = observation({ interactionType: 'interview', observedAt: '2026-06-08T00:00:00Z' });

      const sameType = aggregateConceptEvidence(
        [obs1, observation({ interactionType: 'code_review', observedAt: '2026-06-08T00:00:00Z' })],
        config,
      );
      const differentTypes = aggregateConceptEvidence([obs1, obs2], config);

      expect(differentTypes.compositeConfidence).toBeGreaterThan(sameType.compositeConfidence);
      expect(differentTypes.sourceDiversity).toBe(2);
    });

    it('reduces confidence for contradictions', () => {
      const config = makeConfig();
      const positive = observation({ polarity: 'positive', observedAt: '2026-06-10T00:00:00Z' });
      const negative = observation({ polarity: 'negative', observedAt: '2026-06-10T00:00:00Z' });

      const withoutContradiction = aggregateConceptEvidence([positive], config);
      const withContradiction = aggregateConceptEvidence([positive, negative], config);

      expect(withContradiction.compositeConfidence).toBeLessThan(withoutContradiction.compositeConfidence);
      expect(withContradiction.contradictionCount).toBe(1);
    });

    it('weights recent evidence more heavily', () => {
      const config = makeConfig();
      const recent = observation({
        assertionId: 'recent',
        confidence: 0.9,
        strength: 0.9,
        observedAt: '2026-06-10T00:00:00Z',
      });
      const old = observation({
        assertionId: 'old',
        confidence: 0.3,
        strength: 0.3,
        observedAt: '2025-01-01T00:00:00Z',
      });

      const result = aggregateConceptEvidence([recent, old], config);
      expect(result.compositeConfidence).toBeGreaterThan(0.5);
    });

    it('tracks latest and oldest observation timestamps', () => {
      const config = makeConfig();
      const obs1 = observation({ observedAt: '2026-06-10T00:00:00Z' });
      const obs2 = observation({ observedAt: '2026-01-01T00:00:00Z' });

      const result = aggregateConceptEvidence([obs1, obs2], config);
      expect(result.latestObservedAt).toBe('2026-06-10T00:00:00Z');
      expect(result.oldestObservedAt).toBe('2026-01-01T00:00:00Z');
    });

    it('caps corroboration multiplier at max', () => {
      const config = makeConfig({ maxCorroborationMultiplier: 1.2 });
      const observations = Array.from({ length: 20 }, (_, i) =>
        observation({ assertionId: `a${i}`, observedAt: '2026-06-10T00:00:00Z' }),
      );

      const result = aggregateConceptEvidence(observations, config);
      expect(result.compositeConfidence).toBeLessThanOrEqual(1.0);
    });

    it('handles null observedAt with reduced weight', () => {
      const config = makeConfig();
      const obs = observation({ observedAt: null });
      const result = aggregateConceptEvidence([obs], config);
      expect(result.compositeConfidence).toBeGreaterThan(0);
      expect(result.latestObservedAt).toBeNull();
    });
  });

  describe('aggregateAllConceptEvidence', () => {
    it('groups observations by concept key', () => {
      const config = makeConfig();
      const ts1 = observation({ conceptKey: 'term:typescript', observedAt: '2026-06-10T00:00:00Z' });
      const ts2 = observation({ conceptKey: 'term:typescript', observedAt: '2026-06-08T00:00:00Z' });
      const react = observation({ conceptKey: 'term:react', observedAt: '2026-06-10T00:00:00Z' });

      const results = aggregateAllConceptEvidence([ts1, ts2, react], config);
      expect(results.length).toBe(2);
      const tsResult = results.find((r) => r.conceptKey === 'term:typescript');
      const reactResult = results.find((r) => r.conceptKey === 'term:react');
      expect(tsResult?.observationCount).toBe(2);
      expect(reactResult?.observationCount).toBe(1);
    });

    it('sorts by composite strength descending', () => {
      const config = makeConfig();
      const strong = observation({ conceptKey: 'term:strong', strength: 0.9, observedAt: '2026-06-10T00:00:00Z' });
      const weak = observation({ conceptKey: 'term:weak', strength: 0.2, observedAt: '2026-06-10T00:00:00Z' });

      const results = aggregateAllConceptEvidence([weak, strong], config);
      expect(results[0]!.conceptKey).toBe('term:strong');
      expect(results[1]!.conceptKey).toBe('term:weak');
    });

    it('returns empty array for no observations', () => {
      const results = aggregateAllConceptEvidence([], makeConfig());
      expect(results).toEqual([]);
    });
  });
});
