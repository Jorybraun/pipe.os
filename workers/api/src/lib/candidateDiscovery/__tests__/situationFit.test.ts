/**
 * Candidate Situation Fit scorer unit tests.
 *
 * Exercises `candidateSituationFit` with a stub LLMProvider.
 * Pattern mirrors `roleFitRerank.ts` parse/normalize path.
 */

import { describe, it, expect } from 'vitest';
import { candidateSituationFit } from '../candidateSituationFit';
import type { LLMProvider } from '../../llm/types';
import type { CandidateDiscoveryResult } from '../agent';
import type { RepoEngineeringSignalsRow } from '../../../types';

function makeStubProvider(response: unknown, name = 'stub-gemma'): LLMProvider {
  return {
    name,
    supportsTools: false,
    async complete() {
      return { content: typeof response === 'string' ? response : JSON.stringify(response) };
    },
  };
}

function validResponse(repoId = 42) {
  return {
    rankings: [
      {
        repo_id: repoId,
        fit_score: 0.82,
        fit_band: 'strong',
        reasoning: {
          matches: ['Candidate has microservices experience matching repo architecture'],
          mismatches: [],
          summary: 'Strong fit for platform-level candidate.',
        },
        per_signal_scores: {
          skill_coverage: 0.9,
          seniority_fit: 0.85,
          complexity_fit: 0.8,
          architecture_fit: 0.9,
          test_culture_fit: 0.75,
          challenge_surface_fit: 0.8,
        },
      },
    ],
  };
}

function makeCandidateResult(): CandidateDiscoveryResult {
  return {
    candidateSearchableProfile: 'Jane is a senior platform engineer...',
    keyConcepts: {
      mustHaveSkills: ['typescript', 'nodejs'],
      niceToHaveSkills: ['rust'],
      seniority: 'senior',
      primary_language: 'typescript',
      detected_domain: 'fintech',
    },
    careerContext: {
      company_stages: ['series-b', 'growth'],
      company_size_exposure: ['50-200', '200-1000'],
      tenure_pattern: 'stable',
      progression_velocity: 'fast',
      ownership_depth: 'platform',
      system_scale_exposure: ['microservices', 'high-throughput'],
      greenfield_ratio: 0.4,
    },
    situationSignature: {
      primary_challenge_types: ['scaling', 'reliability'],
      architecture_exposure: ['microservices', 'event-driven'],
      test_culture_exposure: 'TDD, high coverage',
      review_culture: 'small PRs, thorough review',
      impact_signals: ['reduced latency 40%'],
    },
    profileVersion: 'candidate-v2',
    modelUsed: 'stub-gemma',
    rawText: '',
  };
}

function makeRepoSignals(repoId: number): RepoEngineeringSignalsRow {
  return {
    repo_id: repoId,
    signals_version: 'v2.0.0',
    content_hash: 'abc',
    test_touch_rate: 0.8,
    mean_changed_files: 5,
    p90_changed_files: 12,
    issue_link_rate: 0.7,
    complexity_band: 'high',
    swe_bench_eligibility_rate: 0.6,
    architecture_style: 'microservice',
    review_density: 2.5,
    commit_cadence: null,
    satd_density: null,
    test_style: 'integration_heavy',
    challenge_surfaces: null,
    repo_searchable_profile: 'A microservice repo...',
    engineering_narrative: 'Engineering narrative...',
    signal_json: '',
    generated_at: '',
    model_used: '',
    model_version: '',
  };
}

describe('candidateSituationFit', () => {
  it('parses a well-formed Gemma response into structured result', async () => {
    const provider = makeStubProvider(validResponse(101));

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
    });

    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0]!.repo_id).toBe(101);
    expect(result.rankings[0]!.fit_score).toBe(0.82);
    expect(result.rankings[0]!.fit_band).toBe('strong');
    expect(result.rankings[0]!.reasoning.matches[0]).toContain('microservices');
  });

  it('strips markdown code fences around the JSON response', async () => {
    const provider = makeStubProvider(
      '```json\n' + JSON.stringify(validResponse(101)) + '\n```',
    );

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
    });

    expect(result.rankings[0]!.fit_score).toBe(0.82);
  });

  it('returns empty rankings when repos array is empty', async () => {
    const provider = makeStubProvider(validResponse());

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [],
    });

    expect(result.rankings).toEqual([]);
    expect(result.rawText).toBe('');
  });

  it('clamps fit_score to [0, 1]', async () => {
    const provider = makeStubProvider({
      rankings: [
        {
          repo_id: 101,
          fit_score: 2.5,
          fit_band: 'strong',
          reasoning: { matches: [], mismatches: [], summary: '' },
          per_signal_scores: { skill_coverage: 1.2 },
        },
      ],
    });

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
    });

    expect(result.rankings[0]!.fit_score).toBe(1);
  });

  it('derives fit_band from score when band is missing/invalid', async () => {
    const provider = makeStubProvider({
      rankings: [
        {
          repo_id: 101,
          fit_score: 0.3,
          fit_band: 'INVALID',
          reasoning: { matches: [], mismatches: [], summary: '' },
          per_signal_scores: {},
        },
      ],
    });

    const result = await candidateSituationFit({
      provider,
      candidateResult: makeCandidateResult(),
      candidateKeyConcepts: makeCandidateResult().keyConcepts,
      repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
    });

    expect(result.rankings[0]!.fit_band).toBe('weak');
  });

  it('throws when rankings array is missing', async () => {
    const provider = makeStubProvider({});

    await expect(
      candidateSituationFit({
        provider,
        candidateResult: makeCandidateResult(),
        candidateKeyConcepts: makeCandidateResult().keyConcepts,
        repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      }),
    ).rejects.toThrow(/rankings/i);
  });

  it('throws on empty provider response', async () => {
    const provider: LLMProvider = {
      name: 'empty',
      supportsTools: false,
      async complete() {
        return { content: null };
      },
    };

    await expect(
      candidateSituationFit({
        provider,
        candidateResult: makeCandidateResult(),
        candidateKeyConcepts: makeCandidateResult().keyConcepts,
        repos: [{ repo_id: 101, full_name: 'acme/widgets', signals: makeRepoSignals(101) }],
      }),
    ).rejects.toThrow(/empty/i);
  });
});
