import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ExplainerAgentUnavailableError,
  callExplainerAgent,
  type CallExplainerAgentInput,
} from '../lib/explainerAgent';

const mockAiRun = vi.fn();
const mockAi = { run: mockAiRun } as unknown as Ai;

function workersAiResponse(content: string): { response: string } {
  return { response: content };
}

const BASE_INPUT: CallExplainerAgentInput = {
  apiKey: '',
  provider: 'workers-ai',
  ai: mockAi,
  prBrief: 'Fix token refresh retry handling.',
  prDiff: '--- src/auth.ts\n+retryTokenRefresh();',
  repoKnowledge: null,
  previousExchanges: [],
  newQuestion: {
    text: 'Why does this retry path matter?',
    file: 'src/auth.ts',
    line: 12,
  },
};

beforeEach(() => {
  mockAiRun.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('callExplainerAgent', () => {
  it('returns source-backed provider content when Workers AI returns valid JSON', async () => {
    mockAiRun.mockResolvedValueOnce(workersAiResponse(JSON.stringify({
      content: 'The retry path matters because expired credentials can otherwise leave requests permanently unauthenticated.',
      context_provided: ['data_flow', 'problem_context'],
      depth_level: 'deep',
    })));

    const result = await callExplainerAgent(BASE_INPUT);

    expect(result).toEqual({
      content: 'The retry path matters because expired credentials can otherwise leave requests permanently unauthenticated.',
      context_provided: ['data_flow', 'problem_context'],
      depth_level: 'deep',
    });
  });

  it('returns an AI_DEVELOPER_UNAVAILABLE diagnostic instead of a fake explainer answer when Workers AI is missing', async () => {
    await expect(callExplainerAgent({
      ...BASE_INPUT,
      ai: undefined,
    })).rejects.toMatchObject({
      name: 'ExplainerAgentUnavailableError',
      diagnostic: {
        mode: 'AI_DEVELOPER_UNAVAILABLE',
        verdict: 'AI_DEVELOPER_UNAVAILABLE',
        provider: 'workers-ai',
        retryable: true,
      },
    } satisfies Partial<ExplainerAgentUnavailableError>);
  });

  it('does not fall back to canned explainer content when the provider call fails', async () => {
    mockAiRun.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(callExplainerAgent(BASE_INPUT)).rejects.toMatchObject({
      name: 'ExplainerAgentUnavailableError',
      diagnostic: {
        mode: 'AI_DEVELOPER_UNAVAILABLE',
        verdict: 'AI_DEVELOPER_UNAVAILABLE',
        provider: 'workers-ai',
        retryable: true,
      },
    } satisfies Partial<ExplainerAgentUnavailableError>);
  });

  it('does not fall back to canned explainer content when provider JSON is invalid', async () => {
    mockAiRun.mockResolvedValueOnce(workersAiResponse('This PR adds a cache layer.'));

    await expect(callExplainerAgent(BASE_INPUT)).rejects.toMatchObject({
      name: 'ExplainerAgentUnavailableError',
      diagnostic: {
        mode: 'AI_DEVELOPER_UNAVAILABLE',
        verdict: 'AI_DEVELOPER_UNAVAILABLE',
        provider: 'workers-ai',
        retryable: true,
      },
    } satisfies Partial<ExplainerAgentUnavailableError>);
  });

  it('requires a real Google AI API key instead of returning local mock content', async () => {
    await expect(callExplainerAgent({
      ...BASE_INPUT,
      provider: 'google-ai',
      apiKey: '',
      ai: undefined,
    })).rejects.toMatchObject({
      name: 'ExplainerAgentUnavailableError',
      diagnostic: {
        mode: 'AI_DEVELOPER_UNAVAILABLE',
        verdict: 'AI_DEVELOPER_UNAVAILABLE',
        provider: 'google-ai',
        retryable: true,
      },
    } satisfies Partial<ExplainerAgentUnavailableError>);
  });
});
