import { describe, it, expect } from 'vitest';
import {
  computeDecayMultiplier,
  applyTemporalDecay,
  parseObservedAtMs,
  evidenceAgeDays,
  DEFAULT_DECAY_CONFIG,
  type TemporalDecayConfig,
} from '../temporalDecay';

const MS_PER_DAY = 86_400_000;

function daysAgo(days: number, reference: number = Date.now()): number {
  return reference - days * MS_PER_DAY;
}

describe('temporalDecay', () => {
  const referenceTime = new Date('2026-06-15T00:00:00Z').getTime();
  const config: TemporalDecayConfig = {
    referenceTimeMs: referenceTime,
    halfLifeDays: 90,
    floorMultiplier: 0.25,
    gracePeriodDays: 14,
  };

  describe('computeDecayMultiplier', () => {
    it('returns 1.0 for evidence within grace period', () => {
      const recent = daysAgo(7, referenceTime);
      expect(computeDecayMultiplier(recent, config)).toBe(1.0);
    });

    it('returns 1.0 for evidence exactly at grace period boundary', () => {
      const boundary = daysAgo(14, referenceTime);
      expect(computeDecayMultiplier(boundary, config)).toBe(1.0);
    });

    it('returns ~0.5 for evidence at half-life past grace period', () => {
      const halfLife = daysAgo(14 + 90, referenceTime);
      const multiplier = computeDecayMultiplier(halfLife, config);
      expect(multiplier).toBeCloseTo(0.5, 5);
    });

    it('returns ~0.25 for evidence at two half-lives past grace period', () => {
      const twoHalfLives = daysAgo(14 + 180, referenceTime);
      const multiplier = computeDecayMultiplier(twoHalfLives, config);
      expect(multiplier).toBeCloseTo(0.25, 5);
    });

    it('never drops below floor multiplier', () => {
      const ancient = daysAgo(1000, referenceTime);
      const multiplier = computeDecayMultiplier(ancient, config);
      expect(multiplier).toBe(0.25);
    });

    it('returns 1.0 for future evidence timestamps', () => {
      const future = referenceTime + 10 * MS_PER_DAY;
      expect(computeDecayMultiplier(future, config)).toBe(1.0);
    });

    it('decays monotonically with increasing age', () => {
      const ages = [15, 30, 60, 90, 120, 180, 365];
      const multipliers = ages.map((days) =>
        computeDecayMultiplier(daysAgo(days, referenceTime), config),
      );
      for (let i = 1; i < multipliers.length; i++) {
        expect(multipliers[i]!).toBeLessThanOrEqual(multipliers[i - 1]!);
      }
    });

    it('uses default config values', () => {
      const defaultConfig = { ...DEFAULT_DECAY_CONFIG, referenceTimeMs: referenceTime };
      const recent = daysAgo(7, referenceTime);
      expect(computeDecayMultiplier(recent, defaultConfig)).toBe(1.0);
    });
  });

  describe('applyTemporalDecay', () => {
    it('preserves full strength within grace period', () => {
      const recent = daysAgo(5, referenceTime);
      expect(applyTemporalDecay(0.8, recent, config)).toBe(0.8);
    });

    it('reduces strength for old evidence', () => {
      const old = daysAgo(14 + 90, referenceTime);
      const decayed = applyTemporalDecay(1.0, old, config);
      expect(decayed).toBeCloseTo(0.5, 5);
    });

    it('respects floor: strength never drops below floor × original', () => {
      const ancient = daysAgo(2000, referenceTime);
      const decayed = applyTemporalDecay(0.9, ancient, config);
      expect(decayed).toBeCloseTo(0.9 * 0.25, 5);
    });

    it('handles zero strength correctly', () => {
      const old = daysAgo(200, referenceTime);
      expect(applyTemporalDecay(0, old, config)).toBe(0);
    });
  });

  describe('parseObservedAtMs', () => {
    it('parses ISO 8601 date strings', () => {
      const ms = parseObservedAtMs('2026-06-01T12:00:00Z');
      expect(ms).toBe(new Date('2026-06-01T12:00:00Z').getTime());
    });

    it('parses SQLite datetime format', () => {
      const ms = parseObservedAtMs('2026-06-01 12:00:00');
      expect(ms).not.toBeNull();
      expect(typeof ms).toBe('number');
    });

    it('returns null for null input', () => {
      expect(parseObservedAtMs(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(parseObservedAtMs(undefined)).toBeNull();
    });

    it('returns null for invalid date string', () => {
      expect(parseObservedAtMs('not-a-date')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseObservedAtMs('')).toBeNull();
    });
  });

  describe('evidenceAgeDays', () => {
    it('returns 0 for same-time evidence', () => {
      expect(evidenceAgeDays(referenceTime, referenceTime)).toBe(0);
    });

    it('returns correct day count', () => {
      const thirtyDaysAgo = daysAgo(30, referenceTime);
      expect(evidenceAgeDays(thirtyDaysAgo, referenceTime)).toBeCloseTo(30, 5);
    });

    it('returns 0 for future timestamps', () => {
      const future = referenceTime + 5 * MS_PER_DAY;
      expect(evidenceAgeDays(future, referenceTime)).toBe(0);
    });
  });

  describe('integration: decay curve characteristics', () => {
    it('75% of strength retained at ~38 days past grace (half-life=90)', () => {
      const daysForThreeQuarters = 14 + 90 * Math.log2(4 / 3);
      const observed = daysAgo(daysForThreeQuarters, referenceTime);
      const multiplier = computeDecayMultiplier(observed, config);
      expect(multiplier).toBeCloseTo(0.75, 1);
    });

    it('custom half-life of 30 days decays faster', () => {
      const fastConfig: TemporalDecayConfig = {
        ...config,
        halfLifeDays: 30,
      };
      const old = daysAgo(14 + 30, referenceTime);
      const fastDecay = computeDecayMultiplier(old, fastConfig);
      const normalDecay = computeDecayMultiplier(old, config);
      expect(fastDecay).toBeLessThan(normalDecay);
      expect(fastDecay).toBeCloseTo(0.5, 5);
    });

    it('zero grace period means immediate decay', () => {
      const noGraceConfig: TemporalDecayConfig = {
        ...config,
        gracePeriodDays: 0,
      };
      const oneDay = daysAgo(1, referenceTime);
      const multiplier = computeDecayMultiplier(oneDay, noGraceConfig);
      expect(multiplier).toBeLessThan(1.0);
      expect(multiplier).toBeGreaterThan(0.99);
    });
  });
});
