import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type {
  CandidateCoverage,
  CoverageDimension,
} from '../../../types';
import {
  CANDIDATE_COVERAGE_POLICY,
  computeCandidateCoverage,
  computeCoverageFromRows,
  getCandidateCoverage,
  identifyNextProbeTarget,
  type CandidateCoverageEvidenceRow,
} from '../candidateCoverage';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function evidence(
  canonicalKey: string,
  overrides: Partial<CandidateCoverageEvidenceRow> = {},
): CandidateCoverageEvidenceRow {
  const suffix = overrides.assertion_id ?? canonicalKey;
  return {
    concept_id: overrides.concept_id ?? `concept:${canonicalKey}`,
    canonical_key: canonicalKey,
    label: overrides.label ?? canonicalKey,
    assertion_id: `assertion:${suffix}`,
    assertion_confidence: 0.8,
    assertion_observed_at: '2026-06-01T00:00:00.000Z',
    evidence_id: `evidence:${suffix}`,
    evidence_strength: 0.8,
    evidence_polarity: 1,
    evidence_observed_at: '2026-06-01T00:00:00.000Z',
    source_key: 'source-a',
    interaction_id: 'interaction-a',
    ...overrides,
  };
}

function dimension(
  canonicalKey: string,
  score: number,
  conceptId = `concept:${canonicalKey}`,
): CoverageDimension {
  return {
    conceptId,
    canonicalKey,
    label: canonicalKey,
    score,
    confidence: score,
    evidenceCount: 1,
    assertionCount: 1,
    sourceDiversity: 1,
    interactionCount: 1,
    firstObservedAt: '2026-06-01T00:00:00.000Z',
    lastObservedAt: '2026-06-01T00:00:00.000Z',
  };
}

describe('computeCoverageFromRows', () => {
  it('returns an empty open projection when no concepts exist', () => {
    const coverage = computeCoverageFromRows([], 'candidate-1');
    expect(coverage).toMatchObject({
      candidateId: 'candidate-1',
      overallScore: 0,
      evidenceCount: 0,
      sourceDiversity: 0,
      interactionCount: 0,
      dimensions: [],
      policyVersion: CANDIDATE_COVERAGE_POLICY.version,
    });
  });

  it('retains a previously unseen concept without a code change', () => {
    const coverage = computeCoverageFromRows([
      evidence('term:temporal-workflow-compensation'),
    ], 'candidate-1');

    expect(coverage.dimensions).toHaveLength(1);
    expect(coverage.dimensions[0]).toMatchObject({
      conceptId: 'concept:term:temporal-workflow-compensation',
      canonicalKey: 'term:temporal-workflow-compensation',
      evidenceCount: 1,
      sourceDiversity: 1,
      interactionCount: 1,
    });
    expect(coverage.dimensions[0]!.score).toBeGreaterThan(0);
  });

  it('increases concept coverage with independent evidence and source diversity', () => {
    const one = computeCoverageFromRows([
      evidence('term:distributed-log'),
    ]);
    const multiple = computeCoverageFromRows([
      evidence('term:distributed-log', {
        assertion_id: 'a1',
        evidence_id: 'e1',
        source_key: 'resume',
        interaction_id: 'i1',
      }),
      evidence('term:distributed-log', {
        assertion_id: 'a2',
        evidence_id: 'e2',
        source_key: 'conversation',
        interaction_id: 'i2',
      }),
      evidence('term:distributed-log', {
        assertion_id: 'a3',
        evidence_id: 'e3',
        source_key: 'work-sample',
        interaction_id: 'i3',
      }),
    ]);

    expect(multiple.dimensions[0]!.score).toBeGreaterThan(one.dimensions[0]!.score);
    expect(multiple.dimensions[0]).toMatchObject({
      evidenceCount: 3,
      assertionCount: 3,
      sourceDiversity: 3,
      interactionCount: 3,
    });
  });

  it('does not assign code-owned weights to named source types', () => {
    const first = computeCoverageFromRows([
      evidence('term:event-stream', { source_key: 'source-never-seen-before' }),
    ]);
    const second = computeCoverageFromRows([
      evidence('term:event-stream', { source_key: 'resume' }),
    ]);
    expect(first.dimensions[0]!.score).toBe(second.dimensions[0]!.score);
  });

  it('does not fabricate strength when evidence and assertion confidence are absent', () => {
    const coverage = computeCoverageFromRows([
      evidence('term:unscored-observation', {
        assertion_confidence: null,
        evidence_strength: null,
      }),
    ]);

    expect(coverage.dimensions[0]).toMatchObject({
      confidence: 0,
      score: 0,
    });
    expect(coverage.overallScore).toBe(0);
  });

});

describe('computeCandidateCoverage', () => {
  it('queries living-context evidence and replaces the concept projection', async () => {
    const statements: string[] = [];
    const rows = [evidence('term:novel-runtime')];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind: () => ({
            all: async () => (
              sql.includes('FROM applications app')
                ? { results: rows }
                : { results: [] }
            ),
            run: async () => ({ success: true }),
          }),
        };
      },
    } as unknown as D1Database;

    const coverage = await computeCandidateCoverage(db, 'candidate-1');
    expect(coverage.dimensions[0]!.canonicalKey).toBe('term:novel-runtime');
    expect(statements.some((sql) => sql.includes('INSERT INTO candidate_coverage ('))).toBe(true);
    expect(statements.some((sql) =>
      sql.includes('DELETE FROM candidate_coverage_dimensions')
    )).toBe(true);
    expect(statements.some((sql) =>
      sql.includes('INSERT INTO candidate_coverage_dimensions')
    )).toBe(true);
  });
});

describe('identifyNextProbeTarget', () => {
  const coverage = {
    candidateId: 'candidate-1',
    overallScore: 0.4,
    evidenceCount: 2,
    sourceDiversity: 1,
    interactionCount: 1,
    firstObservedAt: null,
    lastObservedAt: null,
    policyVersion: CANDIDATE_COVERAGE_POLICY.version,
    dimensions: [
      dimension('term:alpha', 0.4),
      dimension('term:beta', 0.2),
    ],
  };

  it('selects the weakest persisted concept deterministically', () => {
    expect(identifyNextProbeTarget(coverage, [])?.canonicalKey).toBe('term:beta');
  });

  it('accepts exhaustion by concept id or canonical key', () => {
    expect(
      identifyNextProbeTarget(coverage, ['concept:term:beta'])?.canonicalKey,
    ).toBe('term:alpha');
    expect(
      identifyNextProbeTarget(coverage, ['term:beta'])?.canonicalKey,
    ).toBe('term:alpha');
  });

  it('can probe a missing role concept supplied as persisted data', () => {
    const target = dimension('term:role-specific-unseen-concept', 0);
    expect(
      identifyNextProbeTarget(coverage, [], [...coverage.dimensions, target])
        ?.canonicalKey,
    ).toBe('term:role-specific-unseen-concept');
  });

  it('returns null when every supplied concept is complete or exhausted', () => {
    const complete = {
      ...coverage,
      dimensions: [dimension('term:complete', 0.95)],
    };
    expect(identifyNextProbeTarget(complete, [])).toBeNull();
    expect(
      identifyNextProbeTarget(coverage, ['term:alpha', 'term:beta']),
    ).toBeNull();
  });
});

describe('getCandidateCoverage', () => {
  it('loads the generic summary and concept dimensions', async () => {
    const summary: Omit<CandidateCoverage, 'dimensions'> = {
      candidate_id: 'candidate-1',
      overall_coverage: 0.62,
      dimension_count: 1,
      evidence_count: 3,
      source_diversity: 2,
      interaction_count: 2,
      first_observed_at: '2026-05-01T00:00:00.000Z',
      last_observed_at: '2026-06-01T00:00:00.000Z',
      last_probed_at: null,
      next_probe_concept_id: null,
      policy_version: CANDIDATE_COVERAGE_POLICY.version,
      updated_at: 1,
    };
    const db = {
      prepare(sql: string) {
        return {
          bind: () => ({
            first: async () => summary,
            all: async () => ({
              results: sql.includes('candidate_coverage_dimensions')
                ? [{
                    concept_id: 'concept:new',
                    canonical_key: 'term:new',
                    label: 'New',
                    score: 0.62,
                    confidence: 0.8,
                    evidence_count: 3,
                    assertion_count: 3,
                    source_diversity: 2,
                    interaction_count: 2,
                    first_observed_at: summary.first_observed_at,
                    last_observed_at: summary.last_observed_at,
                  }]
                : [],
            }),
          }),
        };
      },
    } as unknown as D1Database;

    const coverage = await getCandidateCoverage(db, 'candidate-1');
    expect(coverage?.overall_coverage).toBe(0.62);
    expect(coverage?.dimensions[0]).toMatchObject({
      conceptId: 'concept:new',
      canonicalKey: 'term:new',
      evidenceCount: 3,
    });
  });

  it('returns null when the summary does not exist', async () => {
    const db = {
      prepare() {
        return { bind: () => ({ first: async () => null }) };
      },
    } as unknown as D1Database;
    expect(await getCandidateCoverage(db, 'candidate-1')).toBeNull();
  });
});
