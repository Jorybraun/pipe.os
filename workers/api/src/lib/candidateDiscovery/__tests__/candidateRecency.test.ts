/**
 * Candidate recency analysis unit tests.
 *
 * Exercises analyzeProfileRecency, checkAndTriggerReEngagement, and
 * getDimensionTrajectory with a lightweight in-memory D1Database stub.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  analyzeProfileRecency,
  checkAndTriggerReEngagement,
  getDimensionTrajectory,
  computeRecencyMultiplier,
} from '../candidateRecency';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): number {
  return Date.now() - days * DAY_MS;
}

interface MockNode {
  node_type: string;
  captured_at: number;
  confidence: number | null;
  superseded_at?: number | null;
}

function buildMockDb(fixture: {
  candidateNodes?: MockNode[];
  ingestion?: { last_enriched_at: number | null; github_url: string | null } | null;
}): D1Database {
  const nodes = fixture.candidateNodes ?? [];
  const ingestion = fixture.ingestion ?? null;

  const prepare = (sql: string): unknown => {
    const statement = {
      bind: (...args: unknown[]) => {
        const boundTypes = args.slice(1) as string[];

        return {
          first: async <T>(): Promise<T | null> => {
            if (sql.includes('candidate_ingestion')) {
              return ingestion as T | null;
            }
            if (sql.includes('candidate_nodes') && sql.includes('MAX(captured_at)')) {
              const matchingNodes = nodes.filter(
                (n) => (n.superseded_at ?? null) === null && boundTypes.includes(n.node_type),
              );
              const last_captured_at =
                matchingNodes.length > 0
                  ? Math.max(...matchingNodes.map((n) => n.captured_at))
                  : null;
              const node_count = matchingNodes.length;
              return { last_captured_at, node_count } as T;
            }
            return null;
          },
          all: async <T>(): Promise<{ results: T[] }> => {
            if (sql.includes('candidate_nodes') && sql.includes('ORDER BY captured_at')) {
              const matchingNodes = nodes
                .filter((n) => boundTypes.includes(n.node_type))
                .sort((a, b) => a.captured_at - b.captured_at);
              return {
                results: matchingNodes.map((n) => ({
                  id: `${n.node_type}-${n.captured_at}`,
                  node_type: n.node_type,
                  narrative_text: '',
                  captured_at: n.captured_at,
                  confidence: n.confidence,
                  superseded_at: n.superseded_at ?? null,
                })) as T[],
              };
            }
            return { results: [] };
          },
          run: async () => ({ success: true }),
        };
      },
    };
    return statement;
  };

  return { prepare } as unknown as D1Database;
}

function allDimensionNodes(capturedAt: number): MockNode[] {
  return [
    { node_type: 'Experience', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'Accomplishment', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'Project', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'CulturalSignal', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'Skill', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'TechnicalDemonstration', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'Education', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'Credential', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'Motivation', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'WorkingStyle', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'CareerArc', captured_at: capturedAt, confidence: 0.5 },
    { node_type: 'Context', captured_at: capturedAt, confidence: 0.5 },
  ];
}

// ─── analyzeProfileRecency ───────────────────────────────────────────────────

describe('analyzeProfileRecency', () => {
  it('returns stale when all dimensions are old', async () => {
    const db = buildMockDb({
      candidateNodes: allDimensionNodes(daysAgo(400)),
    });

    const report = await analyzeProfileRecency(db, 'candidate-1');

    expect(report.overallStaleness).toBe('stale');
    expect(report.dimensions.experience.staleFlag).toBe(true);
    expect(report.dimensions.cultural.staleFlag).toBe(true);
    expect(report.dimensions.technical.staleFlag).toBe(true);
    expect(report.dimensions.motivation.staleFlag).toBe(true);
    expect(report.dimensions.context.staleFlag).toBe(true);
  });

  it('returns fresh when all dimensions are recent', async () => {
    const db = buildMockDb({
      candidateNodes: allDimensionNodes(daysAgo(30)),
    });

    const report = await analyzeProfileRecency(db, 'candidate-1');

    expect(report.overallStaleness).toBe('fresh');
    expect(report.dimensions.experience.staleFlag).toBe(false);
    expect(report.dimensions.cultural.staleFlag).toBe(false);
    expect(report.dimensions.technical.staleFlag).toBe(false);
    expect(report.dimensions.motivation.staleFlag).toBe(false);
    expect(report.dimensions.context.staleFlag).toBe(false);
  });

  it('returns partial when 1-2 dimensions are stale', async () => {
    const db = buildMockDb({
      candidateNodes: [
        ...allDimensionNodes(daysAgo(30)).filter(
          (n) => !['Experience', 'Accomplishment', 'Project'].includes(n.node_type),
        ),
        { node_type: 'Experience', captured_at: daysAgo(400), confidence: 0.5 },
        { node_type: 'Accomplishment', captured_at: daysAgo(400), confidence: 0.5 },
        { node_type: 'Project', captured_at: daysAgo(400), confidence: 0.5 },
      ],
    });

    const report = await analyzeProfileRecency(db, 'candidate-1');

    expect(report.overallStaleness).toBe('partial');
    expect(report.dimensions.experience.staleFlag).toBe(true);
    expect(report.dimensions.cultural.staleFlag).toBe(false);
    expect(report.dimensions.technical.staleFlag).toBe(false);
    expect(report.dimensions.motivation.staleFlag).toBe(false);
    expect(report.dimensions.context.staleFlag).toBe(false);
  });

  it('returns stale when both motivation and context are stale even if only 2 total stale', async () => {
    const db = buildMockDb({
      candidateNodes: [
        { node_type: 'Motivation', captured_at: daysAgo(400), confidence: 0.5 },
        { node_type: 'WorkingStyle', captured_at: daysAgo(400), confidence: 0.5 },
        { node_type: 'CareerArc', captured_at: daysAgo(400), confidence: 0.5 },
        { node_type: 'Context', captured_at: daysAgo(400), confidence: 0.5 },
      ],
    });

    const report = await analyzeProfileRecency(db, 'candidate-1');

    expect(report.overallStaleness).toBe('stale');
    expect(report.dimensions.motivation.staleFlag).toBe(true);
    expect(report.dimensions.context.staleFlag).toBe(true);
    expect(report.dimensions.experience.staleFlag).toBe(false);
    expect(report.dimensions.cultural.staleFlag).toBe(false);
    expect(report.dimensions.technical.staleFlag).toBe(false);
  });
});

// ─── checkAndTriggerReEngagement ─────────────────────────────────────────────

describe('checkAndTriggerReEngagement', () => {
  it('sets needsScreener=true for stale profile', async () => {
    const db = buildMockDb({
      candidateNodes: allDimensionNodes(daysAgo(400)),
      ingestion: { last_enriched_at: daysAgo(30), github_url: 'https://github.com/test' },
    });

    const plan = await checkAndTriggerReEngagement(db, 'candidate-1', 'role-1');

    expect(plan.needsScreener).toBe(true);
    expect(plan.thinDimensions).toContain('experience');
    expect(plan.thinDimensions).toContain('cultural');
    expect(plan.thinDimensions).toContain('technical');
    expect(plan.thinDimensions).toContain('motivation');
    expect(plan.thinDimensions).toContain('context');
  });

  it('sets needsReEnrichment=true when last_enriched_at is null', async () => {
    const db = buildMockDb({
      candidateNodes: allDimensionNodes(daysAgo(30)),
      ingestion: { last_enriched_at: null, github_url: 'https://github.com/test' },
    });

    const plan = await checkAndTriggerReEngagement(db, 'candidate-1', 'role-1');

    expect(plan.needsReEnrichment).toBe(true);
  });

  it('sets needsReEnrichment=true when last_enriched_at is > 6 months old', async () => {
    const db = buildMockDb({
      candidateNodes: allDimensionNodes(daysAgo(30)),
      ingestion: { last_enriched_at: daysAgo(210), github_url: 'https://github.com/test' },
    });

    const plan = await checkAndTriggerReEngagement(db, 'candidate-1', 'role-1');

    expect(plan.needsReEnrichment).toBe(true);
  });

  it('does not set needsReEnrichment when github_url is null', async () => {
    const db = buildMockDb({
      candidateNodes: allDimensionNodes(daysAgo(400)),
      ingestion: { last_enriched_at: daysAgo(30), github_url: null },
    });

    const plan = await checkAndTriggerReEngagement(db, 'candidate-1', 'role-1');

    expect(plan.needsReEnrichment).toBe(false);
  });

  it('always sets shouldRecomputeMatch=true', async () => {
    const db = buildMockDb({
      candidateNodes: allDimensionNodes(daysAgo(30)),
      ingestion: { last_enriched_at: daysAgo(30), github_url: 'https://github.com/test' },
    });

    const plan = await checkAndTriggerReEngagement(db, 'candidate-1', 'role-1');

    expect(plan.shouldRecomputeMatch).toBe(true);
  });
});

// ─── computeRecencyMultiplier ────────────────────────────────────────────────

describe('computeRecencyMultiplier', () => {
  it('returns 1.0 for empty input', () => {
    expect(computeRecencyMultiplier([])).toBe(1.0);
  });

  it('returns 1.0 for recent nodes', () => {
    const nodes = [{ captured_at: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60 }];
    expect(computeRecencyMultiplier(nodes)).toBe(1.0);
  });

  it('returns 0.8 for nodes older than 2 years', () => {
    const nodes = [{ captured_at: Math.floor(Date.now() / 1000) - 3 * 365 * 24 * 60 * 60 }];
    expect(computeRecencyMultiplier(nodes)).toBe(0.8);
  });

  it('returns 0.6 for nodes older than 4 years', () => {
    const nodes = [{ captured_at: Math.floor(Date.now() / 1000) - 5 * 365 * 24 * 60 * 60 }];
    expect(computeRecencyMultiplier(nodes)).toBe(0.6);
  });

  it('averages mixed-age nodes', () => {
    const now = Math.floor(Date.now() / 1000);
    const nodes = [
      { captured_at: now - 30 * 24 * 60 * 60 },
      { captured_at: now - 3 * 365 * 24 * 60 * 60 },
    ];
    expect(computeRecencyMultiplier(nodes)).toBe(0.9); // (1.0 + 0.8) / 2
  });
});

// ─── getDimensionTrajectory ──────────────────────────────────────────────────

describe('getDimensionTrajectory', () => {
  it('returns insufficient_data for < 3 active nodes', async () => {
    const db = buildMockDb({
      candidateNodes: [
        { node_type: 'CulturalSignal', captured_at: daysAgo(100), confidence: 0.5 },
        { node_type: 'CulturalSignal', captured_at: daysAgo(50), confidence: 0.6 },
      ],
    });

    const trajectory = await getDimensionTrajectory(db, 'candidate-1', 'cultural');

    expect(trajectory.dimensionTrend).toBe('insufficient_data');
  });

  it('returns improving when last confidence > first + 0.15', async () => {
    const db = buildMockDb({
      candidateNodes: [
        { node_type: 'CulturalSignal', captured_at: daysAgo(100), confidence: 0.5 },
        { node_type: 'CulturalSignal', captured_at: daysAgo(50), confidence: 0.6 },
        { node_type: 'CulturalSignal', captured_at: daysAgo(10), confidence: 0.7 },
      ],
    });

    const trajectory = await getDimensionTrajectory(db, 'candidate-1', 'cultural');

    expect(trajectory.dimensionTrend).toBe('improving');
  });

  it('returns declining when last confidence < first - 0.15', async () => {
    const db = buildMockDb({
      candidateNodes: [
        { node_type: 'CulturalSignal', captured_at: daysAgo(100), confidence: 0.7 },
        { node_type: 'CulturalSignal', captured_at: daysAgo(50), confidence: 0.6 },
        { node_type: 'CulturalSignal', captured_at: daysAgo(10), confidence: 0.5 },
      ],
    });

    const trajectory = await getDimensionTrajectory(db, 'candidate-1', 'cultural');

    expect(trajectory.dimensionTrend).toBe('declining');
  });

  it('returns stable when confidence change is within 0.15', async () => {
    const db = buildMockDb({
      candidateNodes: [
        { node_type: 'CulturalSignal', captured_at: daysAgo(100), confidence: 0.6 },
        { node_type: 'CulturalSignal', captured_at: daysAgo(50), confidence: 0.65 },
        { node_type: 'CulturalSignal', captured_at: daysAgo(10), confidence: 0.7 },
      ],
    });

    const trajectory = await getDimensionTrajectory(db, 'candidate-1', 'cultural');

    expect(trajectory.dimensionTrend).toBe('stable');
  });

  it('includes superseded nodes in the returned nodes array', async () => {
    const db = buildMockDb({
      candidateNodes: [
        {
          node_type: 'CulturalSignal',
          captured_at: daysAgo(200),
          confidence: 0.4,
          superseded_at: daysAgo(100),
        },
        { node_type: 'CulturalSignal', captured_at: daysAgo(100), confidence: 0.5 },
        { node_type: 'CulturalSignal', captured_at: daysAgo(50), confidence: 0.6 },
      ],
    });

    const trajectory = await getDimensionTrajectory(db, 'candidate-1', 'cultural');

    expect(trajectory.nodes).toHaveLength(3);
    expect(trajectory.nodes.some((n) => n.superseded_at !== null)).toBe(true);
  });
});
