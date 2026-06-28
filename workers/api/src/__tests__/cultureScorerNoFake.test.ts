import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCultureTranscript } from '../lib/cultureAgent';
import { COMPETENCY_DIMENSIONS } from '../lib/cultureQuestionBank';
import {
  CULTURE_PROFILE_DIMENSIONS,
  CultureScorerUnavailableError,
  scoreCultureInterview,
  type OrgCultureBenchmark,
} from '../lib/cultureScorer';
import type { LLMProvider, LLMMessage, CompleteOptions, LLMCompletion } from '../lib/llm/types';

const ORG_BENCHMARK: OrgCultureBenchmark = {
  autonomy: 3,
  riskTolerance: 3,
  workPace: 3,
  collaborationStyle: 3,
  feedbackOrientation: 3,
};

function providerFromResponses(responses: string[]): LLMProvider {
  let index = 0;
  return {
    name: 'test-provider',
    model: 'test-model',
    supportsTools: false,
    async complete(_messages: LLMMessage[], _options?: CompleteOptions): Promise<LLMCompletion> {
      const content = responses[index] ?? '';
      index += 1;
      return { content };
    },
  };
}

function validResponses(): string[] {
  const quote = 'I owned the end-to-end migration and coordinated with three teams.';
  const competency = JSON.stringify({
    score: 4,
    evidence_quotes: [quote],
    confidence: 0.82,
    reasoning: 'Candidate gave source-backed evidence of ownership and collaboration.',
  });
  const profile = JSON.stringify({
    candidate_position: 3,
    evidence_quotes: [quote],
    confidence: 0.78,
    reasoning: 'Candidate described adaptable working style with direct evidence.',
  });
  const synthesis = JSON.stringify({
    headline: 'Source-backed culture scoring complete',
    narrative: 'Scores are grounded in candidate transcript quotes.',
    recommendation: 'FLAG_FOR_REVIEW',
  });
  return [
    ...COMPETENCY_DIMENSIONS.map(() => competency),
    ...CULTURE_PROFILE_DIMENSIONS.map(() => profile),
    synthesis,
  ];
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('scoreCultureInterview no-fake behavior', () => {
  it('persists only provider-backed culture scores with evidence quotes', async () => {
    const report = await scoreCultureInterview({
      provider: providerFromResponses(validResponses()),
      transcript: defaultCultureTranscript(),
      orgBenchmark: ORG_BENCHMARK,
    });

    expect(report.competencyScores).toHaveLength(COMPETENCY_DIMENSIONS.length);
    expect(report.profileScores).toHaveLength(CULTURE_PROFILE_DIMENSIONS.length);
    expect(report.competencyScores.every((score) => score.evidenceQuotes.length > 0)).toBe(true);
    expect(report.profileScores.every((score) => score.evidenceQuotes.length > 0)).toBe(true);
    expect(report.synthesis.headline).toBe('Source-backed culture scoring complete');
  });

  it('rejects missing providers instead of fabricating midpoint scores', async () => {
    await expect(scoreCultureInterview({
      provider: null,
      transcript: defaultCultureTranscript(),
      orgBenchmark: ORG_BENCHMARK,
    })).rejects.toMatchObject({
      name: 'CultureScorerUnavailableError',
      provider: null,
    } satisfies Partial<CultureScorerUnavailableError>);
  });

  it('rejects provider output without evidence quotes after one re-prompt', async () => {
    const ungroundedCompetency = JSON.stringify({
      score: 4,
      evidence_quotes: [],
      confidence: 0.82,
      reasoning: 'This omits direct transcript evidence.',
    });

    await expect(scoreCultureInterview({
      provider: providerFromResponses([
        ungroundedCompetency,
        ungroundedCompetency,
        ...validResponses(),
      ]),
      transcript: defaultCultureTranscript(),
      orgBenchmark: ORG_BENCHMARK,
    })).rejects.toMatchObject({
      name: 'CultureScorerUnavailableError',
      provider: 'test-provider',
    } satisfies Partial<CultureScorerUnavailableError>);
  });

  it('rejects empty provider output instead of writing neutral fallback scores', async () => {
    await expect(scoreCultureInterview({
      provider: providerFromResponses(['']),
      transcript: defaultCultureTranscript(),
      orgBenchmark: ORG_BENCHMARK,
    })).rejects.toMatchObject({
      name: 'CultureScorerUnavailableError',
      provider: 'test-provider',
    } satisfies Partial<CultureScorerUnavailableError>);
  });
});
