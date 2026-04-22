/**
 * Candidate Situation Fit scorer unit tests.
 *
 * Exercises `candidateSituationFit` with a stub LLMProvider.
 * Pattern mirrors `roleFitRerank.ts` parse/normalize path.
 */

import { describe, it, expect } from 'vitest';
import { candidateSituationFit } from '../situationFit';
import type { LLMProvider } from '../../llm/types';

function makeStubProvider(response: unknown, name = 'stub-gemma'): LLMProvider {
  return {
    name,
    supportsTools: false,
    async complete() {
      return { content: typeof response === 'string' ? response : JSON.stringify(response) };
    },
  };
}

function validResponse(overrides: Record<string, unknown> = {}) {
  return {
    rankings: [
      {
        repo_id: 42,
        fit_score: 0.82,
        fit_band: 'strong',
        reasoning: {
          matches: ['Candidate has shipped zero-to-one fintech infra matching repo scale-out signals'],
          mismatches: ['No evidence of platform engineering'],
          summary: 'Strong situational fit for early-stage fintech scale-out.',
        },
        per_signal_scores: {
          company_stage_match: 0.9,
          challenge_type_match: 0.85,
          team_topology_match: 0.8,
          growth_trajectory_match: 0.75,
          codebase_complexity_tolerance: 0.8,
          review_culture_match: 0.9,
        },
      },
    ],
    ...overrides,
  };
}

describe('candidateSituationFit', () => {
  it('parses a well-formed Gemma response into structured result', async () => {
    const provider = makeStubProvider(validResponse());

    const result = await candidateSituationFit({
      provider,
      candidateSituation: {
        career_context: { company_stages: ['early-stage'] },
        situation_signature: { primary_challenge_types: ['zero-to-one'] },
      },
      repoSignals: {
        repo_id: 42,
        signals_version: 'v1',
        engineering_narrative: 'Scale-out fintech monorepo.',
      } as unknown as import('../../types').RepoEngineeringSignalsRow,
      rcdTechnicalContext: {
        stack: ['typescript', 'react'],
        constructs: ['monorepo'],
        seniority_band: 'mid',
        codebase_expectations: ['clean abstractions', 'thorough review'],
      },
    });

    expect(result.fitScore).toBe(0.82);
    expect(result.fitBand).toBe('strong');
    expect(result.reasoning.matches.length).toBeGreaterThan(0);
    expect(result.perSignalScores.company_stage_match).toBe(0.9);
    expect(result.modelUsed).toBe('stub-gemma');
  });

  it('clamps fit_score to [0, 1]', async () => {
    const provider = makeStubProvider({
      rankings: [
        {
          repo_id: 42,
          fit_score: 1.5,
          fit_band: 'strong',
          reasoning: { matches: [], mismatches: [], summary: '' },
          per_signal_scores: {},
        },
      ],
    });

    const result = await candidateSituationFit({
      provider,
      candidateSituation: {
        career_context: {},
        situation_signature: {},
      },
      repoSignals: { repo_id: 42 } as unknown as import('../../types').RepoEngineeringSignalsRow,
      rcdTechnicalContext: { stack: [], constructs: [], seniority_band: 'mid', codebase_expectations: [] },
    });

    expect(result.fitScore).toBe(1);
  });

  it('derives fit_band from fit_score when band is missing or invalid', async () => {
    const provider = makeStubProvider({
      rankings: [
        {
          repo_id: 42,
          fit_score: 0.3,
          fit_band: 'INVALID_BAND',
          reasoning: { matches: [], mismatches: [], summary: '' },
          per_signal_scores: {},
        },
        {
          repo_id: 43,
          fit_score: 0.6,
          fit_band: undefined,
          reasoning: { matches: [], mismatches: [], summary: '' },
          per_signal_scores: {},
        },
      ],
    });

    const result = await candidateSituationFit({
      provider,
      candidateSituation: {
        career_context: {},
        situation_signature: {},
      },
      repoSignals: { repo_id: 42 } as unknown as import('../../types').RepoEngineeringSignalsRow,
      rcdTechnicalContext: { stack: [], constructs: [], seniority_band: 'mid', codebase_expectations: [] },
    });

    // 0.3 -> weak
    expect(result.fitBand).toBe('weak');
  });

  it('throws when rankings array is missing', async () => {
    const provider = makeStubProvider({ fit_score: 0.5 });

    await expect(
      candidateSituationFit({
        provider,
        candidateSituation: {
          career_context: {},
          situation_signature: {},
        },
        repoSignals: { repo_id: 42 } as unknown as import('../../types').RepoEngineeringSignalsRow,
        rcdTechnicalContext: { stack: [], constructs: [], seniority_band: 'mid', codebase_expectations: [] },
      }),
    ).rejects.toThrow(/rankings/i);
  });

  it('clamps per_signal_scores to [0, 1]', async () => {
    const provider = makeStubProvider({
      rankings: [
        {
          repo_id: 42,
          fit_score: 0.5,
          fit_band: 'moderate',
          reasoning: { matches: [], mismatches: [], summary: '' },
          per_signal_scores: {
            company_stage_match: -0.2,
            challenge_type_match: 1.3,
            team_topology_match: 0.5,
          },
        },
      ],
    });

    const result = await candidateSituationFit({
      provider,
      candidateSituation: {
        career_context: {},
        situation_signature: {},
      },
      repoSignals: { repo_id: 42 } as unknown as import('../../types').RepoEngineeringSignalsRow,
      rcdTechnicalContext: { stack: [], constructs: [], seniority_band: 'mid', codebase_expectations: [] },
    });

    expect(result.perSignalScores.company_stage_match).toBe(0);
    expect(result.perSignalScores.challenge_type_match).toBe(1);
    expect(result.perSignalScores.team_topology_match).toBe(0.5);
  });

  it('strips markdown code fences around JSON', async () => {
    const provider = makeStubProvider(
      '```json\n' + JSON.stringify(validResponse()) + '\n```',
    );

    const result = await candidateSituationFit({
      provider,
      candidateSituation: {
        career_context: {},
        situation_signature: {},
      },
      repoSignals: { repo_id: 42 } as unknown as import('../../types').RepoEngineeringSignalsRow,
      rcdTechnicalContext: { stack: [], constructs: [], seniority_band: 'mid', codebase_expectations: [] },
    });

    expect(result.fitScore).toBe(0.82);
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
        candidateSituation: {
          career_context: {},
          situation_signature: {},
        },
        repoSignals: { repo_id: 42 } as unknown as import('../../types').RepoEngineeringSignalsRow,
        rcdTechnicalContext: { stack: [], constructs: [], seniority_band: 'mid', codebase_expectations: [] },
      }),
    ).rejects.toThrow(/empty/i);
  });
});
