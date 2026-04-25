import { describe, it, expect } from 'vitest';
import {
  computeEffectiveness,
  weightedAvg,
  assignBand,
  countReviewerComments,
  TECH_WEIGHTS,
  CONV_WEIGHTS,
  PRACTICE_WEIGHTS,
  type PlantedBug,
} from '../lib/scoring';

// ─── Test fixtures ──────────────────────────────────────────────────────────

const GROUND_TRUTH: PlantedBug[] = [
  { id: 1, severity: 'critical', description: 'SQL injection in search' },
  { id: 2, severity: 'major', description: 'Race condition on save' },
  { id: 3, severity: 'minor', description: 'Typo in error message' },
];

// ─── computeEffectiveness ───────────────────────────────────────────────────

describe('computeEffectiveness', () => {
  it('returns RIS=100 when all planted bugs are found', () => {
    const result = computeEffectiveness([1, 2, 3], [], GROUND_TRUTH, 0, 3);
    expect(result.ris).toBe(100);
  });

  it('returns RIS=0 when no bugs are found', () => {
    const result = computeEffectiveness([], [1, 2, 3], GROUND_TRUTH, 0, 3);
    expect(result.ris).toBe(0);
  });

  it('weights critical bugs higher than minor bugs in RIS', () => {
    // Finding only the critical bug (weight 3) out of total 6 (3+2+1) = 50%
    const criticalOnly = computeEffectiveness([1], [2, 3], GROUND_TRUTH, 0, 1);
    // Finding only the minor bug (weight 1) out of total 6 = 16.7%
    const minorOnly = computeEffectiveness([3], [1, 2], GROUND_TRUTH, 0, 1);

    expect(criticalOnly.ris).toBeGreaterThan(minorOnly.ris);
    expect(criticalOnly.ris).toBeCloseTo(50, 0);
    expect(minorOnly.ris).toBeCloseTo(16.7, 0);
  });

  it('degrades efficiency with false positives', () => {
    // 5 total comments, 2 false positives
    // useful = 3, raw efficiency = (3/5)*100 = 60, penalty = 2*10 = 20 → 40
    const result = computeEffectiveness([1, 2, 3], [], GROUND_TRUTH, 2, 5);
    expect(result.efficiency).toBe(40);
  });

  it('floors efficiency at 0', () => {
    // 2 comments, both false positives: useful=0, raw=0, penalty=20 → clamped to 0
    const result = computeEffectiveness([], [1, 2, 3], GROUND_TRUTH, 2, 2);
    expect(result.efficiency).toBe(0);
  });

  it('computes delta as % of critical+major bugs found', () => {
    // 2 critical+major bugs. Found 1 of 2 → 50%
    const result = computeEffectiveness([1], [2, 3], GROUND_TRUTH, 0, 1);
    expect(result.delta).toBe(50);
  });

  it('returns delta=100 when no critical/major bugs exist', () => {
    const minorOnly: PlantedBug[] = [
      { id: 1, severity: 'minor', description: 'Nit 1' },
      { id: 2, severity: 'minor', description: 'Nit 2' },
    ];
    const result = computeEffectiveness([1], [2], minorOnly, 0, 1);
    expect(result.delta).toBe(100);
  });

  it('computes correct composite score', () => {
    // RIS=100, efficiency=100 (3 comments, 0 FP), delta=100
    // score = 0.50*100 + 0.30*100 + 0.20*100 = 100
    const result = computeEffectiveness([1, 2, 3], [], GROUND_TRUTH, 0, 3);
    expect(result.score).toBe(100);
  });

  it('handles empty ground truth', () => {
    const result = computeEffectiveness([], [], [], 0, 0);
    expect(result.ris).toBe(0);
    expect(result.efficiency).toBe(0);
    expect(result.delta).toBe(100); // no critical/major → defaults to 100
    expect(result.score).toBe(20); // 0.20 * 100
  });
});

// ─── weightedAvg ────────────────────────────────────────────────────────────

describe('weightedAvg', () => {
  it('returns 100 when all dimensions are 10', () => {
    const allTens: Record<string, number> = {};
    for (const key of Object.keys(TECH_WEIGHTS)) {
      allTens[key] = 10;
    }
    expect(weightedAvg(allTens, TECH_WEIGHTS)).toBe(100);
  });

  it('returns 10 when all dimensions are 1', () => {
    const allOnes: Record<string, number> = {};
    for (const key of Object.keys(TECH_WEIGHTS)) {
      allOnes[key] = 1;
    }
    expect(weightedAvg(allOnes, TECH_WEIGHTS)).toBe(10);
  });

  it('defaults missing dimensions to 5', () => {
    // Empty dimensions → all default to 5 → 5 * sum_of_weights * 10 = 50
    expect(weightedAvg({}, TECH_WEIGHTS)).toBe(50);
    expect(weightedAvg({}, CONV_WEIGHTS)).toBe(50);
    expect(weightedAvg({}, PRACTICE_WEIGHTS)).toBe(50);
  });

  it('weight sets sum to 1.0', () => {
    const techSum = Object.values(TECH_WEIGHTS).reduce((a, b) => a + b, 0);
    const convSum = Object.values(CONV_WEIGHTS).reduce((a, b) => a + b, 0);
    const practiceSum = Object.values(PRACTICE_WEIGHTS).reduce((a, b) => a + b, 0);

    expect(techSum).toBeCloseTo(1.0, 10);
    expect(convSum).toBeCloseTo(1.0, 10);
    expect(practiceSum).toBeCloseTo(1.0, 10);
  });
});

// ─── assignBand ─────────────────────────────────────────────────────────────

describe('assignBand', () => {
  it('assigns strong at boundary (75)', () => {
    expect(assignBand(75)).toBe('strong');
  });

  it('assigns adequate just below strong boundary (74)', () => {
    expect(assignBand(74)).toBe('adequate');
  });

  it('assigns adequate at lower boundary (45)', () => {
    expect(assignBand(45)).toBe('adequate');
  });

  it('assigns weak just below adequate boundary (44)', () => {
    expect(assignBand(44)).toBe('weak');
  });

  it('assigns strong at 100', () => {
    expect(assignBand(100)).toBe('strong');
  });

  it('assigns weak at 0', () => {
    expect(assignBand(0)).toBe('weak');
  });
});

// ─── countReviewerComments ──────────────────────────────────────────────────

describe('countReviewerComments', () => {
  it('counts comments across multiple rounds', () => {
    const transcript = {
      rounds: [
        { reviewer_comments: [{ id: 1 }, { id: 2 }] },
        { reviewer_comments: [{ id: 3 }] },
      ],
    };
    expect(countReviewerComments(transcript)).toBe(3);
  });

  it('returns 0 for empty transcript', () => {
    expect(countReviewerComments({})).toBe(0);
    expect(countReviewerComments({ rounds: [] })).toBe(0);
  });

  it('returns 0 for null/undefined input', () => {
    expect(countReviewerComments(null)).toBe(0);
    expect(countReviewerComments(undefined)).toBe(0);
  });

  it('handles malformed rounds gracefully', () => {
    expect(countReviewerComments({ rounds: 'not an array' })).toBe(0);
    expect(countReviewerComments({ rounds: [{ reviewer_comments: 'bad' }] })).toBe(0);
    expect(countReviewerComments({ rounds: [{}] })).toBe(0);
  });
});
