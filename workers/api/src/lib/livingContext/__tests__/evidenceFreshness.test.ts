import { describe, it, expect } from 'vitest';
import {
  computeEvidenceFreshness,
  type EvidenceRow,
} from '../evidenceFreshness';

const referenceTime = new Date('2026-06-15T00:00:00Z').getTime();

function makeEntry(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    observedAt: '2026-06-10T00:00:00Z',
    ...overrides,
  };
}

describe('evidenceFreshness', () => {
  describe('computeEvidenceFreshness', () => {
    it('returns zeros for empty entries', () => {
      const result = computeEvidenceFreshness([], { referenceTimeMs: referenceTime });
      expect(result.totalEntries).toBe(0);
      expect(result.freshCount).toBe(0);
      expect(result.averageDecay).toBe(0);
    });

    it('classifies recent evidence as fresh', () => {
      const entries = [
        makeEntry({ id: 'e1', observedAt: '2026-06-14T00:00:00Z' }),
        makeEntry({ id: 'e2', observedAt: '2026-06-12T00:00:00Z' }),
      ];

      const result = computeEvidenceFreshness(entries, { referenceTimeMs: referenceTime });
      expect(result.totalEntries).toBe(2);
      expect(result.freshCount).toBe(2);
      expect(result.averageDecay).toBeCloseTo(1.0, 1);

      const entry = result.entries.find((e) => e.id === 'e1');
      expect(entry).toBeDefined();
      expect(entry!.freshnessLevel).toBe('fresh');
      expect(entry!.decayMultiplier).toBeCloseTo(1.0, 2);
    });

    it('classifies old evidence as stale', () => {
      const entries = [
        makeEntry({ id: 'e1', observedAt: '2025-06-01T00:00:00Z' }),
      ];

      const result = computeEvidenceFreshness(entries, { referenceTimeMs: referenceTime });
      expect(result.staleCount).toBe(1);
      expect(result.freshCount).toBe(0);

      const entry = result.entries[0]!;
      expect(entry.freshnessLevel).toBe('stale');
      expect(entry.decayMultiplier).toBeLessThan(0.35);
    });

    it('classifies medium-aged evidence as recent or aging', () => {
      const entries = [
        makeEntry({ id: 'recent', observedAt: '2026-05-20T00:00:00Z' }),
        makeEntry({ id: 'aging', observedAt: '2026-03-01T00:00:00Z' }),
      ];

      const result = computeEvidenceFreshness(entries, { referenceTimeMs: referenceTime });
      const recentEntry = result.entries.find((e) => e.id === 'recent')!;
      const agingEntry = result.entries.find((e) => e.id === 'aging')!;

      expect(['fresh', 'recent']).toContain(recentEntry.freshnessLevel);
      expect(['aging', 'stale']).toContain(agingEntry.freshnessLevel);
      expect(recentEntry.decayMultiplier).toBeGreaterThan(agingEntry.decayMultiplier);
    });

    it('computes median age days', () => {
      const entries = [
        makeEntry({ observedAt: '2026-06-14T00:00:00Z' }),
        makeEntry({ observedAt: '2026-06-10T00:00:00Z' }),
        makeEntry({ observedAt: '2026-05-01T00:00:00Z' }),
      ];

      const result = computeEvidenceFreshness(entries, { referenceTimeMs: referenceTime });
      expect(result.medianAgeDays).toBeGreaterThan(0);
    });

    it('tracks oldest and newest observation dates', () => {
      const entries = [
        makeEntry({ observedAt: '2026-06-14T00:00:00Z' }),
        makeEntry({ observedAt: '2026-03-01T00:00:00Z' }),
        makeEntry({ observedAt: '2026-01-15T00:00:00Z' }),
      ];

      const result = computeEvidenceFreshness(entries, { referenceTimeMs: referenceTime });
      expect(result.newestObservedAt).toBe('2026-06-14T00:00:00Z');
      expect(result.oldestObservedAt).toBe('2026-01-15T00:00:00Z');
    });

    it('applies base weight to effective weight', () => {
      const entries = [
        makeEntry({ id: 'e1', observedAt: '2026-06-14T00:00:00Z', baseWeight: 0.9 }),
        makeEntry({ id: 'e2', observedAt: '2026-06-14T00:00:00Z', baseWeight: 0.3 }),
      ];

      const result = computeEvidenceFreshness(entries, { referenceTimeMs: referenceTime });
      const e1 = result.entries.find((e) => e.id === 'e1')!;
      const e2 = result.entries.find((e) => e.id === 'e2')!;

      expect(e1.effectiveWeight).toBeGreaterThan(e2.effectiveWeight);
      expect(e1.effectiveWeight).toBeCloseTo(0.9, 1);
    });

    it('handles null observed dates gracefully', () => {
      const entries = [
        makeEntry({ id: 'e1', observedAt: null }),
      ];

      const result = computeEvidenceFreshness(entries, { referenceTimeMs: referenceTime });
      expect(result.totalEntries).toBe(1);
      const entry = result.entries[0]!;
      expect(entry.decayMultiplier).toBe(1.0);
      expect(entry.freshnessLevel).toBe('fresh');
    });

    it('produces correct distribution counts', () => {
      const entries = [
        makeEntry({ id: 'fresh-1', observedAt: '2026-06-14T00:00:00Z' }),
        makeEntry({ id: 'fresh-2', observedAt: '2026-06-13T00:00:00Z' }),
        makeEntry({ id: 'stale-1', observedAt: '2025-01-01T00:00:00Z' }),
      ];

      const result = computeEvidenceFreshness(entries, { referenceTimeMs: referenceTime });
      expect(result.totalEntries).toBe(3);
      expect(result.freshCount).toBe(2);
      expect(result.staleCount).toBe(1);
      expect(result.freshCount + result.recentCount + result.agingCount + result.staleCount).toBe(3);
    });
  });
});
