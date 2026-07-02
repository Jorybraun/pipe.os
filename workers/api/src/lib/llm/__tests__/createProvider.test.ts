import { describe, expect, it, vi } from 'vitest';

import { CloudflareAIProvider } from '../cloudflareAIProvider';
import {
  DEFAULT_CLOUDFLARE_MODEL,
  createCandidateAgentProvider,
  createCandidateAgentProviders,
  createGenerationProvider,
  createRoleAgentProvider,
} from '../createProvider';

function createAi(): Ai {
  return { run: vi.fn(async () => ({ response: '{"ok":true}' })) } as unknown as Ai;
}

describe('createCandidateAgentProvider', () => {
  it('uses the non-deprecated Workers AI default model for candidate decomposition', () => {
    const provider = createCandidateAgentProvider({ AI: createAi() });

    expect(provider).toBeInstanceOf(CloudflareAIProvider);
    expect((provider as CloudflareAIProvider).model).toBe(DEFAULT_CLOUDFLARE_MODEL);
    expect(DEFAULT_CLOUDFLARE_MODEL).toBe('@cf/zai-org/glm-4.7-flash');
  });

  it('keeps explicit candidate model overrides intact', () => {
    const provider = createCandidateAgentProvider({
      AI: createAi(),
      CANDIDATE_AGENT_MODEL: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    });

    expect(provider).toBeInstanceOf(CloudflareAIProvider);
    expect((provider as CloudflareAIProvider).model).toBe('@cf/mistralai/mistral-small-3.1-24b-instruct');
  });

  it('remaps deprecated Workers AI model overrides to the current default', () => {
    const provider = createCandidateAgentProvider({
      AI: createAi(),
      CANDIDATE_AGENT_MODEL: '@cf/meta/llama-3.1-8b-instruct',
    });

    expect(provider).toBeInstanceOf(CloudflareAIProvider);
    expect((provider as CloudflareAIProvider).model).toBe(DEFAULT_CLOUDFLARE_MODEL);
  });

  it('remaps stale shared Workers AI env overrides before candidate inference', () => {
    const provider = createCandidateAgentProvider({
      AI: createAi(),
      CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.1-8b-instruct-awq',
    });

    expect(provider).toBeInstanceOf(CloudflareAIProvider);
    expect((provider as CloudflareAIProvider).model).toBe(DEFAULT_CLOUDFLARE_MODEL);
  });

  it('builds an ordered current Workers AI failover list for candidate discovery', () => {
    const providers = createCandidateAgentProviders({ AI: createAi() });
    const models = providers
      .filter((provider): provider is CloudflareAIProvider => provider instanceof CloudflareAIProvider)
      .map((provider) => provider.model);

    expect(models).toEqual([
      DEFAULT_CLOUDFLARE_MODEL,
      '@cf/openai/gpt-oss-20b',
      '@cf/google/gemma-4-26b-a4b-it',
      '@cf/qwen/qwen3-30b-a3b-fp8',
    ]);
  });

  it('trims and remaps stale role-agent model overrides before repo discovery inference', async () => {
    const ai = createAi();
    const provider = createRoleAgentProvider({
      AI: ai,
      ROLE_AGENT_MODEL: '  @CF/META/LLAMA-3.1-8B-INSTRUCT  ',
    });

    expect(provider).toBeInstanceOf(CloudflareAIProvider);
    expect((provider as CloudflareAIProvider).model).toBe(DEFAULT_CLOUDFLARE_MODEL);

    await provider?.complete([{ role: 'user', content: 'Return JSON.' }], { forceJson: true });

    expect(ai.run).toHaveBeenCalledWith(
      DEFAULT_CLOUDFLARE_MODEL,
      expect.objectContaining({
        messages: expect.any(Array),
      }),
    );
    expect(ai.run).not.toHaveBeenCalledWith(
      '@cf/meta/llama-3.1-8b-instruct',
      expect.anything(),
    );
  });

  it('keeps active Workers AI Llama 3.1 8B fast variants intact', async () => {
    const ai = createAi();
    const provider = createGenerationProvider(aiEnv(ai), '@cf/meta/llama-3.1-8b-instruct-fast');

    expect(provider).toBeInstanceOf(CloudflareAIProvider);
    expect((provider as CloudflareAIProvider).model).toBe('@cf/meta/llama-3.1-8b-instruct-fast');

    await provider?.complete([{ role: 'user', content: 'Return JSON.' }], { forceJson: true });

    expect(ai.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.1-8b-instruct-fast',
      expect.objectContaining({
        messages: expect.any(Array),
      }),
    );
    expect(ai.run).not.toHaveBeenCalledWith(
      DEFAULT_CLOUDFLARE_MODEL,
      expect.anything(),
    );
  });

  it.each([
    '@cf/moonshotai/kimi-k2.5',
    '@hf/meta-llama/meta-llama-3-8b-instruct',
    '@cf/meta/llama-3-8b-instruct',
    '@cf/meta/llama-3-8b-instruct-awq',
    '@cf/meta/llama-3.1-70b-instruct',
    '@cf/meta/llama-2-7b-chat-int8',
    '@cf/meta/llama-2-7b-chat-fp16',
    '@cf/mistral/mistral-7b-instruct-v0.1',
    '@hf/mistral/mistral-7b-instruct-v0.2',
    '@hf/google/gemma-7b-it',
    '@cf/google/gemma-3-12b-it',
    '@hf/nousresearch/hermes-2-pro-mistral-7b',
    '@cf/microsoft/phi-2',
    '@cf/defog/sqlcoder-7b-2',
    '@cf/unum/uform-gen2-qwen-500m',
    '@cf/facebook/bart-large-cnn',
  ])('remaps Workers AI model deprecated on 2026-05-30 before inference: %s', async (model) => {
    const ai = createAi();
    const provider = createGenerationProvider(aiEnv(ai), model);

    expect(provider).toBeInstanceOf(CloudflareAIProvider);
    expect((provider as CloudflareAIProvider).model).toBe(DEFAULT_CLOUDFLARE_MODEL);

    await provider?.complete([{ role: 'user', content: 'Return JSON.' }], { forceJson: true });

    expect(ai.run).toHaveBeenCalledWith(
      DEFAULT_CLOUDFLARE_MODEL,
      expect.objectContaining({ messages: expect.any(Array) }),
    );
    expect(ai.run).not.toHaveBeenCalledWith(
      model,
      expect.anything(),
    );
  });

  it('retries the current default once when Workers AI reports a configured model is deprecated at runtime', async () => {
    const ai = {
      run: vi.fn()
        .mockRejectedValueOnce(new Error('5028: This model was deprecated on 2026-05-30. Please use an alternative model.'))
        .mockResolvedValueOnce({
          response: '{"ok":true}',
          usage: { prompt_tokens: 7, completion_tokens: 5 },
        }),
    } as unknown as Ai;
    const provider = createGenerationProvider(aiEnv(ai), '@cf/example/newly-deprecated-model');

    expect(provider).toBeInstanceOf(CloudflareAIProvider);
    expect((provider as CloudflareAIProvider).model).toBe('@cf/example/newly-deprecated-model');

    const completion = await provider?.complete([{ role: 'user', content: 'Return JSON.' }], { forceJson: true });

    expect(completion?.content).toBe('{"ok":true}');
    expect(ai.run).toHaveBeenNthCalledWith(
      1,
      '@cf/example/newly-deprecated-model',
      expect.objectContaining({ messages: expect.any(Array) }),
    );
    expect(ai.run).toHaveBeenNthCalledWith(
      2,
      DEFAULT_CLOUDFLARE_MODEL,
      expect.objectContaining({ messages: expect.any(Array) }),
    );
    expect((provider as CloudflareAIProvider).getModelKey()).toBe(`workers-ai/${DEFAULT_CLOUDFLARE_MODEL}`);
    expect((provider as CloudflareAIProvider).getLastUsage()).toEqual({ inputTokens: 7, outputTokens: 5 });
  });

  it('unwraps nested Workers AI result envelopes before parsing completions', async () => {
    const ai = {
      run: vi.fn(async () => ({
        result: {
          response: '{"candidate_searchable_profile":"ok"}',
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        },
      })),
    } as unknown as Ai;
    const provider = createCandidateAgentProvider({ AI: ai });

    const completion = await provider?.complete([{ role: 'user', content: 'Return JSON.' }], { forceJson: true });

    expect(completion?.content).toBe('{"candidate_searchable_profile":"ok"}');
    expect((provider as CloudflareAIProvider).getLastUsage()).toEqual({ inputTokens: 3, outputTokens: 4 });
  });

  it('reads object-shaped Workers AI response text before treating candidate output as empty', async () => {
    const ai = {
      run: vi.fn(async () => ({
        response: {
          text: '{"candidate_searchable_profile":"ok from nested text"}',
        },
      })),
    } as unknown as Ai;
    const provider = createCandidateAgentProvider({ AI: ai });

    const completion = await provider?.complete([{ role: 'user', content: 'Return JSON.' }], { forceJson: true });

    expect(completion?.content).toBe('{"candidate_searchable_profile":"ok from nested text"}');
  });
});

function aiEnv(ai: Ai): { AI: Ai } {
  return { AI: ai };
}
