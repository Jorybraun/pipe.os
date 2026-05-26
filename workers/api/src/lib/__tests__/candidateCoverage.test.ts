import { describe, it, expect } from 'vitest';
import {
  scoreStarDepth,
  computeCoverageState,
  evaluateCoverageTermination,
  rankCoverageGaps,
  isDimensionCovered,
  DEFAULT_COVERAGE_CONFIG,
  type StarCoverageTurn,
  type CoverageState,
} from '../candidateCoverage';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeSlots(
  overrides: Partial<Record<import('../cultureQuestionBank').StarSlot, { present: boolean; specificity: number }>> = {},
): Record<import('../cultureQuestionBank').StarSlot, { present: boolean; specificity: number }> {
  return {
    S: { present: false, specificity: 0 },
    T: { present: false, specificity: 0 },
    A: { present: false, specificity: 0 },
    R: { present: false, specificity: 0 },
    ...overrides,
  };
}

function makeTurn(
  dimension: string,
  slots: ReturnType<typeof makeSlots>,
  probeOf: string | null = null,
): StarCoverageTurn {
  return { questionId: 'q-1', probeOf, dimension, starSlots: slots };
}

// ─── scoreStarDepth ────────────────────────────────────────────────────────────

describe('scoreStarDepth', () => {
  it('returns 0 for empty slots', () => {
    const result = scoreStarDepth(makeSlots());
    expect(result.depthScore).toBe(0);
    expect(result.completeness).toBe(0);
    expect(result.avgSpecificity).toBe(0);
  });

  it('returns high depth for complete strong STAR', () => {
    const result = scoreStarDepth(
      makeSlots({
        S: { present: true, specificity: 2 },
        T: { present: true, specificity: 2 },
        A: { present: true, specificity: 2 },
        R: { present: true, specificity: 2 },
      }),
    );
    expect(result.completeness).toBe(1);
    expect(result.avgSpecificity).toBe(2);
    expect(result.depthScore).toBe(2);
  });

  it('returns moderate depth for partial STAR', () => {
    const result = scoreStarDepth(
      makeSlots({
        S: { present: true, specificity: 1 },
        T: { present: true, specificity: 1 },
        A: { present: false, specificity: 0 },
        R: { present: false, specificity: 0 },
      }),
    );
    expect(result.completeness).toBe(0.5);
    expect(result.avgSpecificity).toBe(1);
    expect(result.depthScore).toBe(0.5);
  });

  it('penalizes vague specificity', () => {
    const result = scoreStarDepth(
      makeSlots({
        S: { present: true, specificity: 0 },
        T: { present: true, specificity: 0 },
        A: { present: true, specificity: 0 },
        R: { present: true, specificity: 0 },
      }),
    );
    expect(result.completeness).toBe(1);
    expect(result.avgSpecificity).toBe(0);
    expect(result.depthScore).toBe(0);
  });
});

// ─── computeCoverageState ──────────────────────────────────────────────────────

describe('computeCoverageState', () => {
  it('initializes all dimensions with zero depth', () => {
    const state = computeCoverageState([], ['ownership', 'collaboration']);
    expect(state.dimensions).toHaveLength(2);
    expect(state.dimensions.every((d) => d.depthScore === 0)).toBe(true);
    expect(state.gaps).toEqual(['ownership', 'collaboration']);
    expect(state.isComplete).toBe(false);
  });

  it('accumulates depth from multiple strong turns', () => {
    const turns: StarCoverageTurn[] = [
      makeTurn('ownership', makeSlots({
        S: { present: true, specificity: 2 },
        T: { present: true, specificity: 2 },
        A: { present: true, specificity: 2 },
        R: { present: true, specificity: 2 },
      })),
      makeTurn('ownership', makeSlots({
        S: { present: true, specificity: 2 },
        T: { present: true, specificity: 2 },
        A: { present: true, specificity: 2 },
        R: { present: true, specificity: 2 },
      })),
    ];
    const state = computeCoverageState(turns, ['ownership']);
    const dim = state.dimensions[0];
    expect(dim.turnCount).toBe(2);
    expect(dim.completeness).toBe(1);
    expect(dim.avgSpecificity).toBe(2);
    expect(dim.depthScore).toBe(2);
    expect(dim.missingSlots).toEqual([]);
    expect(state.isComplete).toBe(true);
  });

  it('tracks missing slots across turns', () => {
    const turns: StarCoverageTurn[] = [
      makeTurn('ownership', makeSlots({
        S: { present: true, specificity: 2 },
        T: { present: true, specificity: 2 },
        A: { present: false, specificity: 0 },
        R: { present: false, specificity: 0 },
      })),
    ];
    const state = computeCoverageState(turns, ['ownership']);
    const dim = state.dimensions[0];
    expect(dim.missingSlots).toContain('A');
    expect(dim.missingSlots).toContain('R');
    expect(dim.weakSlots).toEqual([]);
  });

  it('tracks weak slots (present but low specificity)', () => {
    const turns: StarCoverageTurn[] = [
      makeTurn('ownership', makeSlots({
        S: { present: true, specificity: 2 },
        T: { present: true, specificity: 2 },
        A: { present: true, specificity: 0 },
        R: { present: true, specificity: 0 },
      })),
    ];
    const state = computeCoverageState(turns, ['ownership']);
    const dim = state.dimensions[0];
    expect(dim.missingSlots).toEqual([]);
    expect(dim.weakSlots).toContain('A');
    expect(dim.weakSlots).toContain('R');
  });

  it('does not count probe turns', () => {
    const turns: StarCoverageTurn[] = [
      makeTurn('ownership', makeSlots({
        S: { present: true, specificity: 2 },
        T: { present: true, specificity: 2 },
        A: { present: true, specificity: 2 },
        R: { present: true, specificity: 2 },
      }), 'q-parent'),
    ];
    const state = computeCoverageState(turns, ['ownership']);
    expect(state.dimensions[0].turnCount).toBe(0);
    expect(state.dimensions[0].depthScore).toBe(0);
  });

  it('identifies gaps across multiple dimensions', () => {
    const turns: StarCoverageTurn[] = [
      makeTurn('ownership', makeSlots({
        S: { present: true, specificity: 2 },
        T: { present: true, specificity: 2 },
        A: { present: true, specificity: 2 },
        R: { present: true, specificity: 2 },
      })),
      makeTurn('collaboration', makeSlots({
        S: { present: true, specificity: 0 },
        T: { present: false, specificity: 0 },
        A: { present: false, specificity: 0 },
        R: { present: false, specificity: 0 },
      })),
    ];
    const state = computeCoverageState(turns, ['ownership', 'collaboration', 'learning-orientation']);
    expect(state.gaps).toEqual(['collaboration', 'learning-orientation']);
    expect(state.isComplete).toBe(false);
    expect(state.probeRecommendations).toHaveLength(2);
  });

  it('generates probe recommendations for missing slots', () => {
    const turns: StarCoverageTurn[] = [
      makeTurn('ownership', makeSlots({
        S: { present: true, specificity: 2 },
        T: { present: true, specificity: 2 },
        A: { present: false, specificity: 0 },
        R: { present: false, specificity: 0 },
      })),
    ];
    const state = computeCoverageState(turns, ['ownership']);
    const rec = state.probeRecommendations[0];
    expect(rec.dimension).toBe('ownership');
    expect(rec.missingSlots).toContain('A');
    expect(rec.missingSlots).toContain('R');
    expect(rec.suggestedProbes.length).toBeGreaterThan(0);
    expect(rec.suggestedProbes[0]).toContain('Walk me through');
  });

  it('supports custom depth threshold', () => {
    const turns: StarCoverageTurn[] = [
      makeTurn('ownership', makeSlots({
        S: { present: true, specificity: 1 },
        T: { present: true, specificity: 1 },
        A: { present: true, specificity: 1 },
        R: { present: true, specificity: 1 },
      })),
    ];
    // With default threshold 1.0, depthScore = 1.0 * 1.0 * 2 = 2.0 → covered
    let state = computeCoverageState(turns, ['ownership']);
    expect(state.isComplete).toBe(true);

    // With threshold 2.5, still not covered
    state = computeCoverageState(turns, ['ownership'], { threshold: 2.5 });
    expect(state.isComplete).toBe(false);
  });
});

// ─── evaluateCoverageTermination ───────────────────────────────────────────────

describe('evaluateCoverageTermination', () => {
  it('returns hard_cap when max questions reached', () => {
    const state = computeCoverageState([], ['ownership']);
    const result = evaluateCoverageTermination({
      coverageState: state,
      questionsAsked: 20,
      minQuestions: 5,
      maxQuestions: 20,
    });
    expect(result).toBe('hard_cap');
  });

  it('returns null when below min questions', () => {
    const turns = [makeTurn('ownership', makeSlots({
      S: { present: true, specificity: 2 },
      T: { present: true, specificity: 2 },
      A: { present: true, specificity: 2 },
      R: { present: true, specificity: 2 },
    }))];
    const state = computeCoverageState(turns, ['ownership']);
    const result = evaluateCoverageTermination({
      coverageState: state,
      questionsAsked: 3,
      minQuestions: 5,
      maxQuestions: 20,
    });
    expect(result).toBeNull();
  });

  it('returns coverage_complete when all dimensions deep and min met', () => {
    const turns = [makeTurn('ownership', makeSlots({
      S: { present: true, specificity: 2 },
      T: { present: true, specificity: 2 },
      A: { present: true, specificity: 2 },
      R: { present: true, specificity: 2 },
    }))];
    const state = computeCoverageState(turns, ['ownership']);
    const result = evaluateCoverageTermination({
      coverageState: state,
      questionsAsked: 5,
      minQuestions: 5,
      maxQuestions: 20,
    });
    expect(result).toBe('coverage_complete');
  });

  it('returns null when gaps remain', () => {
    const state = computeCoverageState([], ['ownership', 'collaboration']);
    const result = evaluateCoverageTermination({
      coverageState: state,
      questionsAsked: 10,
      minQuestions: 5,
      maxQuestions: 20,
    });
    expect(result).toBeNull();
  });
});

// ─── rankCoverageGaps ──────────────────────────────────────────────────────────

describe('rankCoverageGaps', () => {
  it('orders dimensions by ascending depth score', () => {
    const turns: StarCoverageTurn[] = [
      makeTurn('ownership', makeSlots({
        S: { present: true, specificity: 2 },
        T: { present: true, specificity: 2 },
        A: { present: true, specificity: 2 },
        R: { present: true, specificity: 2 },
      })),
      makeTurn('collaboration', makeSlots({
        S: { present: true, specificity: 1 },
        T: { present: true, specificity: 1 },
        A: { present: false, specificity: 0 },
        R: { present: false, specificity: 0 },
      })),
    ];
    const state = computeCoverageState(turns, ['ownership', 'collaboration']);
    const ranked = rankCoverageGaps(state);
    expect(ranked[0].dimension).toBe('collaboration');
    expect(ranked[1].dimension).toBe('ownership');
  });
});

// ─── isDimensionCovered ────────────────────────────────────────────────────────

describe('isDimensionCovered', () => {
  it('returns true when dimension meets threshold', () => {
    const turns = [makeTurn('ownership', makeSlots({
      S: { present: true, specificity: 2 },
      T: { present: true, specificity: 2 },
      A: { present: true, specificity: 2 },
      R: { present: true, specificity: 2 },
    }))];
    const state = computeCoverageState(turns, ['ownership']);
    expect(isDimensionCovered('ownership', state)).toBe(true);
  });

  it('returns false when dimension is below threshold', () => {
    const turns = [makeTurn('ownership', makeSlots({
      S: { present: true, specificity: 0 },
      T: { present: false, specificity: 0 },
      A: { present: false, specificity: 0 },
      R: { present: false, specificity: 0 },
    }))];
    const state = computeCoverageState(turns, ['ownership']);
    expect(isDimensionCovered('ownership', state)).toBe(false);
  });
});
