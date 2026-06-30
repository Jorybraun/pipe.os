/**
 * Dispositional weight overlay tests — ADR-036 §3.
 *
 * The sign-preservation clamp is the single highest-risk bug in Path B:
 * a dispositional multiplier must never zero a dimension. These tests lock
 * the clamp range, the trait→dimension translation, and the renormalization
 * invariant. If any of these break, RCD-scored candidates are corrupted.
 */

import { describe, it, expect } from 'vitest';

import {
  applyDispositionalWeights,
  computeBarsComposite,
  getWeightsForLevel,
  MIN_DISPOSITIONAL,
  MAX_DISPOSITIONAL,
  DIMENSION_IDS,
  type DimensionId,
} from '../lib/scorerRubric';
import { computeOverallScore, type BarsDimensionScores, type EffectivenessScore } from '../lib/scoring';

const FLAT_MID_SCORES: BarsDimensionScores = {
  issue_identification: 3,
  reasoning_quality: 3,
  prioritization: 3,
  question_formation: 3,
  revision_evaluation: 3,
  ai_direction: 3,
};

const EFFECTIVENESS: EffectivenessScore = { ris: 50, efficiency: 50, delta: 50, score: 50 };

function sumWeights(w: Record<DimensionId, number>): number {
  return DIMENSION_IDS.reduce((s, id) => s + w[id], 0);
}

describe('applyDispositionalWeights', () => {
  it('returns base weights untouched when dispositional is empty or undefined', () => {
    const base = getWeightsForLevel('mid');
    expect(applyDispositionalWeights(base, undefined)).toEqual(base);
    expect(applyDispositionalWeights(base, {})).toEqual(base);
  });

  it('renormalizes to sum=1.0 after applying any trait multiplier', () => {
    const base = getWeightsForLevel('mid');
    const adjusted = applyDispositionalWeights(base, { pragmatism: 1.3, rigor: 0.8 });
    expect(sumWeights(adjusted)).toBeCloseTo(1.0, 10);
  });

  it('boosts pragmatism dimensions (prioritization, ai_direction) relative to base', () => {
    const base = getWeightsForLevel('mid');
    const adjusted = applyDispositionalWeights(base, { pragmatism: 1.5 });

    // pragmatism dims should be a larger fraction of the total than in base
    const basePrag = base.prioritization + base.ai_direction;
    const adjPrag = adjusted.prioritization + adjusted.ai_direction;
    expect(adjPrag).toBeGreaterThan(basePrag);
  });

  it('penalizes rigor dimensions (issue_identification, revision_evaluation) when rigor < 1', () => {
    const base = getWeightsForLevel('mid');
    const adjusted = applyDispositionalWeights(base, { rigor: 0.5 });
    const baseRig = base.issue_identification + base.revision_evaluation;
    const adjRig = adjusted.issue_identification + adjusted.revision_evaluation;
    expect(adjRig).toBeLessThan(baseRig);
  });

  it('clamps multipliers above 1.5 to 1.5 (sign-preservation upper bound)', () => {
    const base = getWeightsForLevel('mid');
    const clamped = applyDispositionalWeights(base, { pragmatism: 10 });
    const capped = applyDispositionalWeights(base, { pragmatism: MAX_DISPOSITIONAL });
    expect(clamped).toEqual(capped);
  });

  it('clamps multipliers below 0.5 to 0.5 (sign-preservation lower bound — NEVER zero a dimension)', () => {
    const base = getWeightsForLevel('mid');
    const clamped = applyDispositionalWeights(base, { rigor: 0 });
    const capped = applyDispositionalWeights(base, { rigor: MIN_DISPOSITIONAL });
    expect(clamped).toEqual(capped);

    // Direct assertion: rigor dimensions must remain strictly positive.
    expect(clamped.issue_identification).toBeGreaterThan(0);
    expect(clamped.revision_evaluation).toBeGreaterThan(0);
  });

  it('handles negative multipliers by clamping to the floor (sign preservation)', () => {
    const base = getWeightsForLevel('mid');
    const clamped = applyDispositionalWeights(base, { rigor: -5 });
    for (const id of DIMENSION_IDS) {
      expect(clamped[id]).toBeGreaterThan(0);
    }
  });

  it('accepts direct dimension-ID keys and overrides trait-level values', () => {
    const base = getWeightsForLevel('mid');
    const adjusted = applyDispositionalWeights(base, {
      pragmatism: 1.5,           // would boost prioritization and ai_direction
      ai_direction: 0.5,         // direct override wins for ai_direction only
    });
    // prioritization should still be boosted; ai_direction should be penalized.
    expect(adjusted.prioritization / base.prioritization).toBeGreaterThan(1);
    expect(adjusted.ai_direction / base.ai_direction).toBeLessThan(1);
  });

  it('ignores unknown keys without throwing', () => {
    const base = getWeightsForLevel('mid');
    const adjusted = applyDispositionalWeights(base, { nonsense_trait: 1.2 });
    for (const id of DIMENSION_IDS) {
      expect(adjusted[id]).toBeCloseTo(base[id], 10);
    }
  });

  it('ignores non-finite values (NaN, Infinity)', () => {
    const base = getWeightsForLevel('mid');
    const adjusted = applyDispositionalWeights(base, {
      pragmatism: Number.NaN,
      rigor: Number.POSITIVE_INFINITY,
    });
    // NaN defaults to 1; Infinity clamps to MAX_DISPOSITIONAL.
    expect(sumWeights(adjusted)).toBeCloseTo(1.0, 10);
    expect(adjusted.issue_identification).toBeGreaterThan(0);
  });
});

describe('computeBarsComposite with dispositional overlay', () => {
  it('rejects incomplete score maps instead of fabricating midpoint dimensions', () => {
    const incomplete = {
      ...FLAT_MID_SCORES,
      ai_direction: undefined,
    } as unknown as BarsDimensionScores;

    expect(() => computeBarsComposite(incomplete, 'mid')).toThrow(
      'Missing or invalid BARS dimension score: ai_direction',
    );
  });

  it('tilts composite toward prioritization when pragmatism > rigor', () => {
    // Flat scores except prioritization is high, issue_identification is low.
    const scores: BarsDimensionScores = {
      ...FLAT_MID_SCORES,
      prioritization: 5,
      issue_identification: 1,
    };
    const baseComposite = computeBarsComposite(scores, 'mid');
    const pragmaticComposite = computeBarsComposite(scores, 'mid', { pragmatism: 1.5, rigor: 0.5 });
    // Pragmatic team should score this reviewer HIGHER because the strong
    // dimension (prioritization) carries more weight.
    expect(pragmaticComposite).toBeGreaterThan(baseComposite);
  });

  it('tilts composite toward issue_identification when rigor > pragmatism', () => {
    const scores: BarsDimensionScores = {
      ...FLAT_MID_SCORES,
      issue_identification: 5,
      prioritization: 1,
    };
    const baseComposite = computeBarsComposite(scores, 'mid');
    const rigorousComposite = computeBarsComposite(scores, 'mid', { rigor: 1.5, pragmatism: 0.5 });
    expect(rigorousComposite).toBeGreaterThan(baseComposite);
  });

  it('never zeros a dimension under any extreme dispositional input', () => {
    const scores: BarsDimensionScores = {
      issue_identification: 5,
      reasoning_quality: 1,
      prioritization: 1,
      question_formation: 1,
      revision_evaluation: 1,
      ai_direction: 1,
    };
    // Even with absurd pragmatism, issue_identification must still contribute.
    const extreme = computeBarsComposite(scores, 'mid', { pragmatism: 100, rigor: -100 });
    const rigorless = computeBarsComposite(
      { ...scores, issue_identification: 1 },
      'mid',
      { pragmatism: 100, rigor: -100 },
    );
    // If issue_identification were zeroed, dropping it from 5→1 would not move the composite.
    expect(extreme).toBeGreaterThan(rigorless);
  });
});

describe('computeOverallScore with dispositional overlay', () => {
  it('propagates dispositional weights into the final composite', () => {
    const scores: BarsDimensionScores = {
      ...FLAT_MID_SCORES,
      prioritization: 5,
      issue_identification: 1,
    };
    const base = computeOverallScore(scores, EFFECTIVENESS, 'mid');
    const pragmatic = computeOverallScore(scores, EFFECTIVENESS, 'mid', { pragmatism: 1.5, rigor: 0.5 });
    expect(pragmatic).toBeGreaterThan(base);
  });

  it('is idempotent when dispositional is undefined or empty', () => {
    const a = computeOverallScore(FLAT_MID_SCORES, EFFECTIVENESS, 'mid');
    const b = computeOverallScore(FLAT_MID_SCORES, EFFECTIVENESS, 'mid', undefined);
    const c = computeOverallScore(FLAT_MID_SCORES, EFFECTIVENESS, 'mid', {});
    expect(a).toBe(b);
    expect(a).toBe(c);
  });
});
