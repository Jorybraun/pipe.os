import { describe, expect, it, vi } from 'vitest';

import { CloudflareAIProvider } from '../cloudflareAIProvider';
import {
  DEFAULT_CLOUDFLARE_MODEL,
  createCandidateAgentProvider,
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
    expect(DEFAULT_CLOUDFLARE_MODEL).toBe('@cf/google/gemma-4-26b-a4b-it');
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

  it('remaps deprecated Workers AI Llama 3.1 8B variants before inference', async () => {
    const ai = createAi();
    const provider = createGenerationProvider(aiEnv(ai), '@cf/meta/llama-3.1-8b-instruct-fast');

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
      '@cf/meta/llama-3.1-8b-instruct-fast',
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
});

function aiEnv(ai: Ai): { AI: Ai } {
  return { AI: ai };
}
