import { describe, it, expect, vi } from 'vitest';
import { loadTemporalAdjacencies, loadTemporalNeighborhood } from '../conceptAdjacencyDecay';

const referenceTime = new Date('2026-06-15T00:00:00Z').getTime();
const MS_PER_DAY = 86_400_000;

function mockDb(rows: unknown[]): D1Database {
  const prepare = vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: rows }),
    }),
  });
  return { prepare } as unknown as D1Database;
}

function adjacencyRow(overrides: Partial<{
  from_concept_id: string;
  to_concept_id: string;
  from_canonical_key: string;
  to_canonical_key: string;
  dimension: string;
  stretch_allowed: number;
  confidence: number | null;
  observed_at: number;
}> = {}): unknown {
  return {
    from_concept_id: 'concept-ts',
    to_concept_id: 'concept-react',
    from_canonical_key: 'lang:typescript',
    to_canonical_key: 'framework:react',
    dimension: 'co-occurrence',
    stretch_allowed: 0,
    confidence: 0.8,
    observed_at: referenceTime - 5 * MS_PER_DAY,
    ...overrides,
  };
}

describe('conceptAdjacencyDecay', () => {
  describe('loadTemporalAdjacencies', () => {
    it('returns empty array when no adjacencies exist', async () => {
      const db = mockDb([]);
      const result = await loadTemporalAdjacencies(db, 'concept-1', { referenceTimeMs: referenceTime });
      expect(result).toEqual([]);
    });

    it('returns full confidence for recent adjacencies within grace period', async () => {
      const recentObservation = referenceTime - 3 * MS_PER_DAY;
      const db = mockDb([adjacencyRow({ observed_at: recentObservation })]);

      const result = await loadTemporalAdjacencies(db, 'concept-ts', {
        referenceTimeMs: referenceTime,
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.fromCanonicalKey).toBe('lang:typescript');
      expect(result[0]!.toCanonicalKey).toBe('framework:react');
      expect(result[0]!.temporalWeight).toBeCloseTo(1.0, 2);
      expect(result[0]!.effectiveConfidence).toBeCloseTo(0.8, 2);
    });

    it('decays temporal weight for older adjacencies', async () => {
      const oldObservation = referenceTime - 120 * MS_PER_DAY;
      const db = mockDb([adjacencyRow({ observed_at: oldObservation })]);

      const result = await loadTemporalAdjacencies(db, 'concept-ts', {
        referenceTimeMs: referenceTime,
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.temporalWeight).toBeLessThan(0.8);
      // Single-observation weighted average equals raw confidence,
      // but temporal weight signals the adjacency is aging
      expect(result[0]!.effectiveConfidence).toBeCloseTo(0.8, 2);
    });

    it('aggregates multiple observations of the same concept pair', async () => {
      const recent = referenceTime - 5 * MS_PER_DAY;
      const older = referenceTime - 60 * MS_PER_DAY;
      const db = mockDb([
        adjacencyRow({ observed_at: recent, confidence: 0.9 }),
        adjacencyRow({ observed_at: older, confidence: 0.7 }),
      ]);

      const result = await loadTemporalAdjacencies(db, 'concept-ts', {
        referenceTimeMs: referenceTime,
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.observationCount).toBe(2);
      expect(result[0]!.rawConfidence).toBeCloseTo(0.8, 2);
      expect(result[0]!.latestObservedAt).toBe(recent);
      expect(result[0]!.oldestObservedAt).toBe(older);
    });

    it('keeps separate entries for different dimensions', async () => {
      const db = mockDb([
        adjacencyRow({ dimension: 'co-occurrence' }),
        adjacencyRow({ dimension: 'semantic-similarity' }),
      ]);

      const result = await loadTemporalAdjacencies(db, 'concept-ts', {
        referenceTimeMs: referenceTime,
      });

      expect(result).toHaveLength(2);
      const dimensions = result.map((a) => a.dimension).sort();
      expect(dimensions).toEqual(['co-occurrence', 'semantic-similarity']);
    });

    it('sorts results by effective confidence descending', async () => {
      const db = mockDb([
        adjacencyRow({
          to_concept_id: 'concept-node',
          to_canonical_key: 'runtime:node',
          confidence: 0.5,
          observed_at: referenceTime - 200 * MS_PER_DAY,
        }),
        adjacencyRow({
          to_concept_id: 'concept-react',
          to_canonical_key: 'framework:react',
          confidence: 0.9,
          observed_at: referenceTime - 3 * MS_PER_DAY,
        }),
      ]);

      const result = await loadTemporalAdjacencies(db, 'concept-ts', {
        referenceTimeMs: referenceTime,
      });

      expect(result).toHaveLength(2);
      expect(result[0]!.effectiveConfidence).toBeGreaterThan(result[1]!.effectiveConfidence);
    });

    it('preserves stretch_allowed flag', async () => {
      const db = mockDb([adjacencyRow({ stretch_allowed: 1 })]);
      const result = await loadTemporalAdjacencies(db, 'concept-ts', {
        referenceTimeMs: referenceTime,
      });
      expect(result[0]!.stretchAllowed).toBe(true);
    });
  });

  describe('loadTemporalNeighborhood', () => {
    it('returns empty map for no concepts', async () => {
      const db = mockDb([]);
      const result = await loadTemporalNeighborhood(db, [], {
        referenceTimeMs: referenceTime,
      });
      expect(result.size).toBe(0);
    });

    it('loads adjacencies for multiple concepts', async () => {
      const db = mockDb([adjacencyRow()]);
      const result = await loadTemporalNeighborhood(db, ['concept-ts', 'concept-react'], {
        referenceTimeMs: referenceTime,
      });
      expect(result.size).toBe(2);
      expect(result.has('concept-ts')).toBe(true);
      expect(result.has('concept-react')).toBe(true);
    });
  });
});
