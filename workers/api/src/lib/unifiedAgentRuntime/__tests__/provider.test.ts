import { describe, it, expect, vi } from 'vitest';
import { callProvider } from '../provider';
import type { LLMProvider, LLMCompletion } from '../../llm/types';

function makeMockProvider(responses: LLMCompletion[]): LLMProvider {
  let callCount = 0;
  return {
    name: 'mock-provider',
    supportsTools: false,
    async complete(): Promise<LLMCompletion> {
      const resp = responses[callCount++] ?? { content: null };
      return resp;
    },
  };
}

const defaultOpts = { forceJson: undefined, maxTokens: undefined, tools: undefined, budgetLabel: undefined, signal: undefined } as const;

describe('callProvider', () => {
  it('returns content on success', async () => {
    const provider = makeMockProvider([{ content: '{"answer": 42}' }]);
    const result = await callProvider(provider, [{ role: 'user', content: 'hi' }], defaultOpts);
    expect(result.content).toBe('{"answer": 42}');
  });

  it('retries on transient errors', async () => {
    let calls = 0;
    const throwingProvider: LLMProvider = {
      name: 'thrower',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        calls++;
        if (calls === 1) throw new Error('503 Service Unavailable');
        return { content: 'ok after retry' };
      },
    };

    const result = await callProvider(throwingProvider, [{ role: 'user', content: 'hi' }], defaultOpts);
    expect(result.content).toBe('ok after retry');
    expect(calls).toBe(2);
  });

  it('does not retry on abort', async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: 'abort',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        calls++;
        throw new Error('abort');
      },
    };

    await expect(callProvider(provider, [{ role: 'user', content: 'hi' }], defaultOpts)).rejects.toThrow('abort');
    expect(calls).toBe(1);
  });

  it('fires onUsage callback with usage data', async () => {
    const usageCb = vi.fn();
    const provider = makeMockProvider([
      { content: 'hello', usage: { inputTokens: 10, outputTokens: 5 } },
    ]);

    await callProvider(
      provider,
      [{ role: 'user', content: 'hi' }],
      { forceJson: undefined, maxTokens: undefined, tools: undefined, budgetLabel: 'interviewer', signal: undefined },
      usageCb,
    );

    expect(usageCb).toHaveBeenCalledWith({
      budgetLabel: 'interviewer',
      inputTokens: 10,
      outputTokens: 5,
      model: 'mock-provider',
    });
  });

  it('re-prompts on invalid JSON when forceJson is true', async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: 'json-test',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        calls++;
        if (calls === 1) return { content: 'not json' };
        return { content: '{"valid": true}' };
      },
    };

    const result = await callProvider(
      provider,
      [{ role: 'user', content: 'hi' }],
      { forceJson: true, maxTokens: undefined, tools: undefined, budgetLabel: undefined, signal: undefined },
    );
    expect(calls).toBe(2);
    expect(result.content).toBe('{"valid": true}');
  });

  it('strips markdown fences from JSON content', async () => {
    const provider = makeMockProvider([{ content: '```json\n{"x": 1}\n```' }]);
    const result = await callProvider(provider, [{ role: 'user', content: 'hi' }], defaultOpts);
    expect(result.content).toBe('```json\n{"x": 1}\n```');
  });
});
