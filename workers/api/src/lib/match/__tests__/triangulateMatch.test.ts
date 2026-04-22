/**
 * Triangulated match combinator unit tests.
 *
 * Exercises `triangulateMatch` — the deterministic weighted combinator
 * that blends role_repo_alignment, candidate_repo_fit, role_candidate_cosine,
 * and skill_coverage into a single score.
 */

import { describe, it, expect } from 'vitest';
import { triangulateMatch, triangulateShortlist } from '../triangulateMatch';
import type { MatchReposForCandidateResult } from '../matchReposForCandidate';
import type { SituationFitRanking } from '../../candidateDiscovery/candidateSituationFit';

function makeGraphResult(overrides?: Partial<MatchReposForCandidateResult>): MatchReposForCandidateResult {
  return {
    repoChoice: {
      repoId: 101,
      fullName: 'acme/widgets',
      githubUrl: 'https://github.com/acme/widgets',
      score: 0.7,
      cosine: 0.6,
      rationale: 'matched acme/widgets (graph 0.700, cosine 0.600) covering 3/3 must-have skill(s)',
    },
    review: { prNumber: 42, prTitle: 'fix off-by-one' },
    implementation: { issueNumber: 100, issueTitle: 'add caching' },
    shortlist: [
      { repoId: 101, fullName: 'acme/widgets', score: 0.7, cosine: 0.6 },
      { repoId: 102, fullName: 'acme/things', score: 0.5, cosine: 0.8 },
    ],
    ...overrides,
  };
}

function makeSituationRanking(repoId: number, fitScore: number): SituationFitRanking {
  return {
    repo_id: repoId,
    fit_score: fitScore,
    fit_band: fitScore >= 0.75 ? 'strong' : fitScore >= 0.5 ? 'moderate' : fitScore >= 0.25 ? 'weak' : 'mismatch',
    reasoning: { matches: [], mismatches: [], summary: '' },
    per_signal_scores: {
      skill_coverage: fitScore,
      seniority_fit: fitScore,
      complexity_fit: fitScore,
      architecture_fit: fitScore,
      test_culture_fit: fitScore,
      challenge_surface_fit: fitScore,
    },
  };
}

describe('triangulateMatch', () => {
  it('computes triangulated_score with known inputs (hybrid)', () => {
    const graphResult = makeGraphResult();
    const situationRankings = [makeSituationRanking(101, 0.6)];
    const roleRepoAlignments = new Map([[101, 0.8]]);

    const result = triangulateMatch({
      philosophy: 'hybrid',
      graphResult,
      situationRankings,
      roleRepoAlignments,
      roleCandidateCosine: 0.7,
    });

    // hybrid weights: role_repo=0.25, candidate_fit=0.35, role_candidate=0.20, skill_coverage=0.20
    // normalized skill_coverage from graph score 0.7 -> (0.7-0.3)/(0.9-0.3) = 0.667
    // = 0.25*0.8 + 0.35*0.6 + 0.20*0.7 + 0.20*0.667 = 0.683
    expect(result.triangulated_score).toBeCloseTo(0.683, 2);
    expect(result.repo_id).toBe(101);
    expect(result.dimensions.skill_coverage).toBeCloseTo(0.667, 2);
    expect(result.dimensions.situation_fit).toBe(0.6);
    expect(result.dimensions.role_alignment).toBe(0.8);
    expect(result.dimensions.semantic_similarity).toBe(0.6);
  });

  it('validate mode weights role_repo_alignment heavily', () => {
    const graphResult = makeGraphResult();
    const situationRankings = [makeSituationRanking(101, 0.0)];
    const roleRepoAlignments = new Map([[101, 1.0]]);

    const result = triangulateMatch({
      philosophy: 'validate',
      graphResult,
      situationRankings,
      roleRepoAlignments,
      roleCandidateCosine: 0.0,
    });

    // validate weights: role_repo=0.35, candidate_fit=0.30, role_candidate=0.15, skill_coverage=0.20
    // = 0.35*1.0 + 0.30*0.0 + 0.15*0.0 + 0.20*0.667 = 0.483
    expect(result.triangulated_score).toBeCloseTo(0.483, 2);
  });

  it('tailored mode ignores role_repo_alignment', () => {
    const graphResult = makeGraphResult();
    const situationRankings = [makeSituationRanking(101, 0.5)];
    const roleRepoAlignments = new Map([[101, 1.0]]); // should be ignored

    const result = triangulateMatch({
      philosophy: 'tailored',
      graphResult,
      situationRankings,
      roleRepoAlignments,
      roleCandidateCosine: 0.5,
    });

    // tailored weights: role_repo=0.00, candidate_fit=0.50, role_candidate=0.20, skill_coverage=0.30
    // = 0.00*1.0 + 0.50*0.5 + 0.20*0.5 + 0.30*0.667 = 0.550
    expect(result.triangulated_score).toBeCloseTo(0.550, 2);
  });

  it('handles missing role alignment gracefully', () => {
    const graphResult = makeGraphResult();
    const situationRankings = [makeSituationRanking(101, 0.5)];

    const result = triangulateMatch({
      philosophy: 'hybrid',
      graphResult,
      situationRankings,
      roleRepoAlignments: new Map(), // empty
      roleCandidateCosine: null,
    });

    // role_repo and role_candidate are null -> treated as 0
    // = 0.25*0 + 0.35*0.5 + 0.20*0 + 0.20*0.667 = 0.308
    expect(result.triangulated_score).toBeCloseTo(0.308, 2);
  });

  it('clamps triangulated_score to [0, 1] even with extreme inputs', () => {
    const graphResult = makeGraphResult({ repoChoice: { ...makeGraphResult().repoChoice, score: 99 } });
    const situationRankings = [makeSituationRanking(101, 2.0)];
    const roleRepoAlignments = new Map([[101, 99]]);

    const result = triangulateMatch({
      philosophy: 'hybrid',
      graphResult,
      situationRankings,
      roleRepoAlignments,
      roleCandidateCosine: 99,
    });

    expect(result.triangulated_score).toBeLessThanOrEqual(1);
    expect(result.triangulated_score).toBeGreaterThanOrEqual(0);
  });
});

describe('triangulateShortlist', () => {
  it('returns sorted batch scores for explainability', () => {
    const graphResult = makeGraphResult();
    const situationRankings = [
      makeSituationRanking(101, 0.8),
      makeSituationRanking(102, 0.4),
    ];
    const roleRepoAlignments = new Map([
      [101, 0.9],
      [102, 0.5],
    ]);

    const result = triangulateShortlist({
      philosophy: 'hybrid',
      graphResult,
      situationRankings,
      roleRepoAlignments,
      roleCandidateCosine: 0.7,
    });

    expect(result).toHaveLength(2);
    expect(result[0]!.repo_id).toBe(101);
    expect(result[0]!.triangulated_score).toBeGreaterThan(result[1]!.triangulated_score);
    expect(result[0]!.fit_band).toBe('strong');
  });
});
