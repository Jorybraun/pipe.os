/**
 * Triangulated match combinator unit tests.
 *
 * Exercises `triangulateMatch` — the deterministic weighted combinator
 * that blends role_repo_alignment, candidate_repo_fit, role_candidate_cosine,
 * and skill_coverage into a single score.
 */

import { describe, it, expect } from 'vitest';
import { triangulateMatch } from '../triangulateMatch';

describe('triangulateMatch', () => {
  it('computes triangulated_score with known inputs', () => {
    const result = triangulateMatch({
      roleRepoAlignment: 0.8,
      candidateRepoFit: 0.6,
      roleCandidateCosine: 0.7,
      skillCoverage: 0.9,
      weights: {
        role_repo: 0.25,
        candidate: 0.25,
        cosine: 0.25,
        skills: 0.25,
      },
    });

    // (0.8 + 0.6 + 0.7 + 0.9) * 0.25 = 0.75
    expect(result.triangulatedScore).toBe(0.75);
    expect(result.triangulatedBand).toBe('strong');
  });

  it('validate mode weights role_repo_alignment heavily', () => {
    const result = triangulateMatch({
      roleRepoAlignment: 1.0,
      candidateRepoFit: 0.0,
      roleCandidateCosine: 0.0,
      skillCoverage: 0.0,
      mode: 'validate',
    });

    expect(result.triangulatedScore).toBeCloseTo(0.6, 5);
    expect(result.mode).toBe('validate');
  });

  it('tailored mode ignores role_repo_alignment', () => {
    const result = triangulateMatch({
      roleRepoAlignment: 1.0,
      candidateRepoFit: 0.5,
      roleCandidateCosine: 0.5,
      skillCoverage: 0.5,
      mode: 'tailored',
    });

    // role_repo weight is 0.0 in tailored
    expect(result.triangulatedScore).toBeCloseTo(0.45 * 0.5 + 0.35 * 0.5 + 0.2 * 0.5, 5);
    expect(result.mode).toBe('tailored');
  });

  it('hybrid mode blends both role and candidate signals', () => {
    const result = triangulateMatch({
      roleRepoAlignment: 0.8,
      candidateRepoFit: 0.4,
      roleCandidateCosine: 0.6,
      skillCoverage: 1.0,
      mode: 'hybrid',
    });

    // 0.35*0.8 + 0.25*0.4 + 0.25*0.6 + 0.15*1.0 = 0.28 + 0.10 + 0.15 + 0.15 = 0.68
    expect(result.triangulatedScore).toBeCloseTo(0.68, 5);
    expect(result.mode).toBe('hybrid');
  });

  it('clamps all input scores to [0, 1]', () => {
    const result = triangulateMatch({
      roleRepoAlignment: 1.2,
      candidateRepoFit: -0.3,
      roleCandidateCosine: 0.5,
      skillCoverage: 2.0,
      weights: {
        role_repo: 0.25,
        candidate: 0.25,
        cosine: 0.25,
        skills: 0.25,
      },
    });

    // clamped: 1.0, 0.0, 0.5, 1.0 -> avg = 0.625
    expect(result.triangulatedScore).toBe(0.625);
  });

  it('clamps triangulated_score to [0, 1] even with extreme weights', () => {
    const result = triangulateMatch({
      roleRepoAlignment: 1.0,
      candidateRepoFit: 1.0,
      roleCandidateCosine: 1.0,
      skillCoverage: 1.0,
      weights: {
        role_repo: 10.0,
        candidate: 10.0,
        cosine: 10.0,
        skills: 10.0,
      },
    });

    expect(result.triangulatedScore).toBe(1);
    expect(result.triangulatedBand).toBe('strong');
  });

  it('derives triangulated_band from score thresholds', () => {
    const strong = triangulateMatch({
      roleRepoAlignment: 0.9,
      candidateRepoFit: 0.9,
      roleCandidateCosine: 0.9,
      skillCoverage: 0.9,
      weights: { role_repo: 0.25, candidate: 0.25, cosine: 0.25, skills: 0.25 },
    });
    expect(strong.triangulatedBand).toBe('strong');

    const moderate = triangulateMatch({
      roleRepoAlignment: 0.6,
      candidateRepoFit: 0.6,
      roleCandidateCosine: 0.6,
      skillCoverage: 0.6,
      weights: { role_repo: 0.25, candidate: 0.25, cosine: 0.25, skills: 0.25 },
    });
    expect(moderate.triangulatedBand).toBe('moderate');

    const weak = triangulateMatch({
      roleRepoAlignment: 0.3,
      candidateRepoFit: 0.3,
      roleCandidateCosine: 0.3,
      skillCoverage: 0.3,
      weights: { role_repo: 0.25, candidate: 0.25, cosine: 0.25, skills: 0.25 },
    });
    expect(weak.triangulatedBand).toBe('weak');

    const mismatch = triangulateMatch({
      roleRepoAlignment: 0.1,
      candidateRepoFit: 0.1,
      roleCandidateCosine: 0.1,
      skillCoverage: 0.1,
      weights: { role_repo: 0.25, candidate: 0.25, cosine: 0.25, skills: 0.25 },
    });
    expect(mismatch.triangulatedBand).toBe('mismatch');
  });

  it('stamps weights_json on the result for reproducibility', () => {
    const result = triangulateMatch({
      roleRepoAlignment: 0.5,
      candidateRepoFit: 0.5,
      roleCandidateCosine: 0.5,
      skillCoverage: 0.5,
      mode: 'hybrid',
    });

    expect(result.weightsJson).toEqual(
      JSON.stringify({ role_repo: 0.35, candidate: 0.25, cosine: 0.25, skills: 0.15 }),
    );
  });
});
