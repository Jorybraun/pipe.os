import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  CANDIDATE_RECENCY_POLICY,
  analyzeProfileRecency,
  checkAndTriggerReEngagement,
  computeRecencyMultiplier,
  getDimensionTrajectory,
} from '../candidateRecency';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function buildMockDb(fixture: {
  recencyRows?: Array<{
    concept_id: string;
    canonical_key: string;
    label: string;
    last_observed_at: string | null;
    evidence_count: number;
  }>;
  trajectoryRows?: Array<{
    id: string;
    concept_id: string;
    canonical_key: string;
    narrative_text: string;
    observed_at: string | null;
    confidence: number | null;
    polarity: number;
  }>;
  ingestion?: { last_enriched_at: number | null; github_url: string | null } | null;
}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind: () => ({
          all: async () => ({
            results: sql.includes('GROUP BY c.id')
              ? fixture.recencyRows ?? []
              : fixture.trajectoryRows ?? [],
          }),
          first: async () =>
            sql.includes('candidate_ingestion') ? fixture.ingestion ?? null : null,
          run: async () => ({ success: true }),
        }),
      };
    },
  } as unknown as D1Database;
}

describe('analyzeProfileRecency', () => {
  it('tracks previously unseen concepts without node-type registration', async () => {
    const db = buildMockDb({
      recencyRows: [{
        concept_id: 'concept:unseen',
        canonical_key: 'term:unseen-database-mechanism',
        label: 'Unseen database mechanism',
        last_observed_at: isoDaysAgo(20),
        evidence_count: 2,
      }],
    });
    const report = await analyzeProfileRecency(db, 'candidate-1');

    expect(report.policyVersion).toBe(CANDIDATE_RECENCY_POLICY.version);
    expect(report.overallStaleness).toBe('fresh');
    expect(report.dimensions['term:unseen-database-mechanism']).toMatchObject({
      conceptId: 'concept:unseen',
      evidenceCount: 2,
      staleFlag: false,
    });
  });

  it('uses the stale ratio across whatever concepts exist', async () => {
    const db = buildMockDb({
      recencyRows: [
        {
          concept_id: 'c1',
          canonical_key: 'term:a',
          label: 'A',
          last_observed_at: isoDaysAgo(400),
          evidence_count: 1,
        },
        {
          concept_id: 'c2',
          canonical_key: 'term:b',
          label: 'B',
          last_observed_at: isoDaysAgo(10),
          evidence_count: 1,
        },
      ],
    });
    const report = await analyzeProfileRecency(db, 'candidate-1');
    expect(report.overallStaleness).toBe('stale');
    expect(report.dimensions['term:a']!.staleFlag).toBe(true);
    expect(report.dimensions['term:b']!.staleFlag).toBe(false);
  });

  it('returns partial when fewer than half of the concepts are stale', async () => {
    const db = buildMockDb({
      recencyRows: [
        {
          concept_id: 'c1',
          canonical_key: 'term:a',
          label: 'A',
          last_observed_at: isoDaysAgo(400),
          evidence_count: 1,
        },
        ...['b', 'c'].map((key) => ({
          concept_id: `c:${key}`,
          canonical_key: `term:${key}`,
          label: key,
          last_observed_at: isoDaysAgo(10),
          evidence_count: 1,
        })),
      ],
    });
    expect(
      (await analyzeProfileRecency(db, 'candidate-1')).overallStaleness,
    ).toBe('partial');
  });

  it('treats a profile with no source-backed concepts as stale', async () => {
    const report = await analyzeProfileRecency(buildMockDb({}), 'candidate-1');
    expect(report.overallStaleness).toBe('stale');
    expect(report.dimensions).toEqual({});
  });
});

describe('checkAndTriggerReEngagement', () => {
  it('returns stale concept keys as open probe dimensions', async () => {
    const db = buildMockDb({
      recencyRows: [{
        concept_id: 'concept:novel',
        canonical_key: 'term:novel-stream-topology',
        label: 'Novel stream topology',
        last_observed_at: isoDaysAgo(400),
        evidence_count: 1,
      }],
      ingestion: {
        last_enriched_at: Date.now() - 20 * DAY_MS,
        github_url: null,
      },
    });
    const plan = await checkAndTriggerReEngagement(db, 'candidate-1', 'role-1');
    expect(plan.needsScreener).toBe(true);
    expect(plan.thinDimensions).toEqual(['term:novel-stream-topology']);
  });

  it('queues enrichment using versioned time policy, independent of concepts', async () => {
    const db = buildMockDb({
      recencyRows: [],
      ingestion: {
        last_enriched_at: Date.now()
          - (CANDIDATE_RECENCY_POLICY.reEnrichAfterDays + 1) * DAY_MS,
        github_url: 'https://github.com/example',
      },
    });
    const plan = await checkAndTriggerReEngagement(db, 'candidate-1', 'role-1');
    expect(plan.needsReEnrichment).toBe(true);
    expect(plan.shouldRecomputeMatch).toBe(true);
  });
});

describe('computeRecencyMultiplier', () => {
  it('returns 1.0 for empty and recent evidence', () => {
    expect(computeRecencyMultiplier([])).toBe(1);
    expect(computeRecencyMultiplier([{
      captured_at: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
    }])).toBe(1);
  });

  it('discounts old evidence using the temporal scoring policy', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(computeRecencyMultiplier([{
      captured_at: now - 3 * 365 * 24 * 60 * 60,
    }])).toBe(0.8);
    expect(computeRecencyMultiplier([{
      captured_at: now - 5 * 365 * 24 * 60 * 60,
    }])).toBe(0.6);
  });
});

describe('getDimensionTrajectory', () => {
  function trajectory(confidences: number[]) {
    return confidences.map((confidence, index) => ({
      id: `assertion-${index}`,
      concept_id: 'concept:unseen',
      canonical_key: 'term:unseen-trajectory',
      narrative_text: `Evidence ${index}`,
      observed_at: new Date(Date.now() + index * 1000).toISOString(),
      confidence,
      polarity: 1,
    }));
  }

  it('queries by an open concept key and reports improvement', async () => {
    const result = await getDimensionTrajectory(
      buildMockDb({ trajectoryRows: trajectory([0.4, 0.6, 0.8]) }),
      'candidate-1',
      'term:unseen-trajectory',
    );
    expect(result.dimensionTrend).toBe('improving');
    expect(result.nodes[0]!.canonical_key).toBe('term:unseen-trajectory');
  });

  it('reports stable, declining, and insufficient trajectories', async () => {
    const stable = await getDimensionTrajectory(
      buildMockDb({ trajectoryRows: trajectory([0.6, 0.65, 0.7]) }),
      'candidate-1',
      'term:unseen-trajectory',
    );
    const declining = await getDimensionTrajectory(
      buildMockDb({ trajectoryRows: trajectory([0.8, 0.6, 0.4]) }),
      'candidate-1',
      'term:unseen-trajectory',
    );
    const thin = await getDimensionTrajectory(
      buildMockDb({ trajectoryRows: trajectory([0.8, 0.9]) }),
      'candidate-1',
      'term:unseen-trajectory',
    );
    expect(stable.dimensionTrend).toBe('stable');
    expect(declining.dimensionTrend).toBe('declining');
    expect(thin.dimensionTrend).toBe('insufficient_data');
  });
});
