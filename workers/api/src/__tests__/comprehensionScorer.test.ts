import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ComprehensionScorerUnavailableError,
  scoreComprehensionSession,
  type ComprehensionGroundTruth,
  type ComprehensionScorerInput,
} from '../lib/comprehensionScorer';

const mockAiRun = vi.fn();
const mockAi = { run: mockAiRun } as unknown as Ai;

function workersAiResponse(content: string): { response: string } {
  return { response: content };
}

const GROUND_TRUTH: ComprehensionGroundTruth = {
  mode: 'comprehension',
  keyInsights: [
    { id: 1, category: 'data_flow', insight: 'Retry state crosses worker boundaries.', depth: 'deep', importance: 'high' },
    { id: 2, category: 'risk', insight: 'Expired credentials can strand queued jobs.', depth: 'moderate', importance: 'high' },
  ],
  idealVerdict: 'request_changes',
  idealRationale: 'The retry path needs explicit failure handling before approval.',
};

const BASE_INPUT: ComprehensionScorerInput = {
  apiKey: '',
  provider: 'workers-ai',
  ai: mockAi,
  transcript: {
    exchanges: [
      { question: { text: 'Where does retry state live?' }, answer: { content: 'In the worker state.' } },
      { question: { text: 'What happens when credentials expire?' }, answer: { content: 'Jobs can fail permanently.' } },
    ],
    verdict: 'request_changes',
  },
  groundTruth: GROUND_TRUTH,
  prTitle: 'Fix retry handling',
  prDescription: 'Adds retry flow for expired credentials.',
};

beforeEach(() => {
  mockAiRun.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('scoreComprehensionSession', () => {
  it('scores comprehension from real provider JSON without mock defaults', async () => {
    mockAiRun
      .mockResolvedValueOnce(workersAiResponse(JSON.stringify({
        strategic_questioning: 8,
        depth_progression: 8,
        specificity: 8,
        coverage: 8,
        efficiency: 8,
        probing_skill: 8,
        summary: 'Questions targeted the retry state and failure mode.',
      })))
      .mockResolvedValueOnce(workersAiResponse(JSON.stringify({
        insight_coverage: 7,
        mental_model_accuracy: 7,
        context_synthesis: 7,
        misconception_avoidance: 7,
        depth_of_understanding: 7,
        insights_discovered: [1],
        insights_missed: [2],
        summary: 'Understood the worker boundary but missed credential expiry impact.',
      })))
      .mockResolvedValueOnce(workersAiResponse(JSON.stringify({
        verdict_alignment: 9,
        rationale_quality: 9,
        tradeoff_awareness: 9,
        risk_identification: 9,
        proportionality: 9,
        summary: 'Verdict was aligned with the source-backed risk.',
      })))
      .mockResolvedValueOnce(workersAiResponse(JSON.stringify({
        narrative: 'Strong review with one missed risk.',
        strengths: ['Targeted state questions'],
        growth_areas: ['Probe credential expiry'],
      })));

    const report = await scoreComprehensionSession(BASE_INPUT);

    expect(report.question_quality.score).toBe(80);
    expect(report.comprehension.score).toBe(70);
    expect(report.decision_quality.score).toBe(90);
    expect(report.efficiency.score).toBe(65);
    expect(report.overall.score).toBe(77);
    expect(report.overall.narrative).toBe('Strong review with one missed risk.');
  });

  it('does not return a mock report when Google AI credentials are missing', async () => {
    await expect(scoreComprehensionSession({
      ...BASE_INPUT,
      provider: 'google-ai',
      apiKey: '',
      ai: undefined,
    })).rejects.toMatchObject({
      name: 'ComprehensionScorerUnavailableError',
      provider: 'google-ai',
    } satisfies Partial<ComprehensionScorerUnavailableError>);
  });

  it('does not fabricate midpoint scores when provider output omits required dimensions', async () => {
    mockAiRun
      .mockResolvedValueOnce(workersAiResponse(JSON.stringify({
        strategic_questioning: 8,
        summary: 'Partial response only.',
      })))
      .mockResolvedValueOnce(workersAiResponse(JSON.stringify({
        insight_coverage: 7,
        mental_model_accuracy: 7,
        context_synthesis: 7,
        misconception_avoidance: 7,
        depth_of_understanding: 7,
        insights_discovered: [1],
        insights_missed: [2],
      })))
      .mockResolvedValueOnce(workersAiResponse(JSON.stringify({
        verdict_alignment: 9,
        rationale_quality: 9,
        tradeoff_awareness: 9,
        risk_identification: 9,
        proportionality: 9,
      })));

    await expect(scoreComprehensionSession(BASE_INPUT)).rejects.toMatchObject({
      name: 'ComprehensionScorerUnavailableError',
      provider: 'workers-ai',
    } satisfies Partial<ComprehensionScorerUnavailableError>);
  });
});
