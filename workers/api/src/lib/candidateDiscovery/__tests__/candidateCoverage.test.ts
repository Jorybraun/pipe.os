import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  computeCandidateCoverage,
  identifyNextProbeTarget,
  getCandidateCoverage,
} from '../candidateCoverage';
import type { CandidateCoverage } from '../../../types';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── D1 mock helper ──────────────────────────────────────────────────────────

interface MockNodeRow {
  node_type: string;
  confidence: number | null;
  extracted_properties_json: string | null;
  source_type?: string;
}

function buildMockDb(rows: MockNodeRow[]) {
  // Default source_type to high-weight source so legacy tests behave the same
  const normalized = rows.map((r) => ({
    ...r,
    source_type: r.source_type ?? 'code_review_session',
  }));
  return {
    prepare: (sql: string) => {
      if (sql.includes('FROM candidate_nodes') && sql.includes('superseded_at')) {
        return {
          bind: () => ({
            all: async () => ({ results: normalized }),
          }),
        };
      }
      if (sql.includes('INSERT INTO candidate_coverage')) {
        return {
          bind: () => ({
            run: async () => ({}),
          }),
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as D1Database;
}

function buildMockDbForGetCoverage(row: CandidateCoverage | null) {
  return {
    prepare: (sql: string) => {
      if (sql.includes('FROM candidate_coverage') && sql.includes('next_probe_target')) {
        return {
          bind: () => ({
            first: async <T>(): Promise<T | null> => (row as T | null) ?? null,
          }),
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as D1Database;
}

// ─── computeCandidateCoverage ────────────────────────────────────────────────

describe('computeCandidateCoverage', () => {
  it('returns 0.0 for all dimensions when no nodes exist', async () => {
    const db = buildMockDb([]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    expect(coverage.experience).toBe(0.0);
    expect(coverage.cultural).toBe(0.0);
    expect(coverage.technical).toBe(0.0);
    expect(coverage.motivation).toBe(0.0);
    expect(coverage.context).toBe(0.0);
  });

  it('experience coverage = 1.0 for 3 Experience nodes at confidence >= 0.7', async () => {
    const db = buildMockDb([
      { node_type: 'Experience', confidence: 0.8, extracted_properties_json: null },
      { node_type: 'Experience', confidence: 0.8, extracted_properties_json: null },
      { node_type: 'Experience', confidence: 0.8, extracted_properties_json: null },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    expect(coverage.experience).toBe(1.0);
    expect(coverage.cultural).toBe(0.0);
    expect(coverage.technical).toBe(0.0);
    expect(coverage.motivation).toBe(0.0);
    expect(coverage.context).toBe(0.0);
  });

  it('experience coverage scales linearly for 1 node', async () => {
    const db = buildMockDb([
      { node_type: 'Experience', confidence: 0.7, extracted_properties_json: null },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    expect(coverage.experience).toBeCloseTo(0.3, 5);
  });

  it('cultural coverage accumulates across 5 dimensions', async () => {
    const db = buildMockDb([
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"ownership"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"collaboration"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"learning-orientation"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"self-awareness"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"autonomy"}' },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    expect(coverage.cultural).toBe(1.0);
  });

  it('cultural coverage accumulates across all 10 dimensions', async () => {
    const db = buildMockDb([
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"ownership"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"collaboration"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"learning-orientation"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"conflict-handling"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"self-awareness"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"autonomy"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"risk-tolerance"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"work-pace"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"collaboration-style"}' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"feedback-orientation"}' },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    expect(coverage.cultural).toBe(1.0);
  });

  it('technical coverage = 1.0 for 5+ nodes at high confidence', async () => {
    const db = buildMockDb([
      { node_type: 'Skill', confidence: 0.7, extracted_properties_json: null },
      { node_type: 'Skill', confidence: 0.7, extracted_properties_json: null },
      { node_type: 'Skill', confidence: 0.7, extracted_properties_json: null },
      { node_type: 'Skill', confidence: 0.7, extracted_properties_json: null },
      { node_type: 'Skill', confidence: 0.7, extracted_properties_json: null },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    expect(coverage.technical).toBe(1.0);
  });

  it('motivation coverage = 0.8 for Motivation + WorkingStyle', async () => {
    const db = buildMockDb([
      { node_type: 'Motivation', confidence: 0.7, extracted_properties_json: null },
      { node_type: 'WorkingStyle', confidence: 0.7, extracted_properties_json: null },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    expect(coverage.motivation).toBe(0.8);
  });

  it('motivation coverage = 1.0 for all 3 types', async () => {
    const db = buildMockDb([
      { node_type: 'Motivation', confidence: 0.7, extracted_properties_json: null },
      { node_type: 'WorkingStyle', confidence: 0.7, extracted_properties_json: null },
      { node_type: 'CareerArc', confidence: 0.7, extracted_properties_json: null },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    expect(coverage.motivation).toBe(1.0);
  });

  it('context coverage = 0.5 for 1 Context node', async () => {
    const db = buildMockDb([
      { node_type: 'Context', confidence: 0.7, extracted_properties_json: null },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    expect(coverage.context).toBe(0.5);
  });

  it('context coverage = 1.0 for 2+ Context nodes with different subtypes', async () => {
    const db = buildMockDb([
      { node_type: 'Context', confidence: 0.7, extracted_properties_json: '{"subtype":"location"}' },
      { node_type: 'Context', confidence: 0.7, extracted_properties_json: '{"subtype":"availability"}' },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    expect(coverage.context).toBe(1.0);
  });

  it('source-aware weighting discounts resume-sourced nodes', async () => {
    // 5 resume-sourced Skill nodes should score lower than 5 code_review-sourced
    const db = buildMockDb([
      { node_type: 'Skill', confidence: 0.8, extracted_properties_json: null, source_type: 'resume' },
      { node_type: 'Skill', confidence: 0.8, extracted_properties_json: null, source_type: 'resume' },
      { node_type: 'Skill', confidence: 0.8, extracted_properties_json: null, source_type: 'resume' },
      { node_type: 'Skill', confidence: 0.8, extracted_properties_json: null, source_type: 'resume' },
      { node_type: 'Skill', confidence: 0.8, extracted_properties_json: null, source_type: 'resume' },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    // 5 resume skills * 0.6 weight = 3.0 weighted count
    // baseScore = min(3/5, 1) * (0.8/0.65) = 0.6 * 1.23 = 0.738
    expect(coverage.technical).toBeLessThan(1.0);
    expect(coverage.technical).toBeCloseTo(0.738, 2);
  });

  it('source-aware cultural coverage weights dimensions by best source', async () => {
    const db = buildMockDb([
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"ownership"}', source_type: 'resume' },
      { node_type: 'CulturalSignal', confidence: 0.8, extracted_properties_json: '{"dimension":"ownership"}', source_type: 'culture_interview' },
    ]);
    const coverage = await computeCandidateCoverage(db, 'candidate-1');

    // ownership dimension uses max weight (culture_interview = 1.0)
    // weightedCoverage = 0.2 * 1.0 = 0.2
    expect(coverage.cultural).toBe(0.2);
  });
});

// ─── identifyNextProbeTarget ─────────────────────────────────────────────────

describe('identifyNextProbeTarget', () => {
  it('returns experience when all dimensions are low and none exhausted', () => {
    const coverage = { experience: 0.1, cultural: 0.2, technical: 0.3, motivation: 0.4, context: 0.5 };
    const result = identifyNextProbeTarget(coverage, []);
    expect(result).toBe('experience');
  });

  it('returns technical when experience is exhausted', () => {
    const coverage = { experience: 0.1, cultural: 0.3, technical: 0.2, motivation: 0.4, context: 0.5 };
    const result = identifyNextProbeTarget(coverage, ['experience']);
    expect(result).toBe('technical');
  });

  it('returns null when all dimensions exhausted', () => {
    const coverage = { experience: 0.1, cultural: 0.2, technical: 0.3, motivation: 0.4, context: 0.5 };
    const result = identifyNextProbeTarget(coverage, [
      'experience',
      'cultural',
      'technical',
      'motivation',
      'context',
    ]);
    expect(result).toBeNull();
  });

  it('returns null when all scores >= 0.9', () => {
    const coverage = { experience: 0.9, cultural: 0.95, technical: 1.0, motivation: 0.92, context: 0.9 };
    const result = identifyNextProbeTarget(coverage, []);
    expect(result).toBeNull();
  });
});

// ─── getCandidateCoverage ────────────────────────────────────────────────────

describe('getCandidateCoverage', () => {
  it('returns null when no coverage row exists', async () => {
    const db = buildMockDbForGetCoverage(null);
    const result = await getCandidateCoverage(db, 'candidate-1');
    expect(result).toBeNull();
  });

  it('returns coverage row when it exists', async () => {
    const mockCoverage: CandidateCoverage = {
      candidate_id: 'candidate-1',
      experience_coverage: 0.5,
      cultural_coverage: 0.6,
      technical_coverage: 0.7,
      motivation_coverage: 0.8,
      context_coverage: 0.9,
      last_probed_at: 1234567890,
      next_probe_target: 'experience',
      updated_at: 1234567890,
    };
    const db = buildMockDbForGetCoverage(mockCoverage);
    const result = await getCandidateCoverage(db, 'candidate-1');
    expect(result).toEqual(mockCoverage);
  });
});
