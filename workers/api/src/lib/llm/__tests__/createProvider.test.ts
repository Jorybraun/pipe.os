import { describe, expect, it, vi } from 'vitest';

import { CloudflareAIProvider } from '../cloudflareAIProvider';
import {
  DEFAULT_CLOUDFLARE_MODEL,
  createCandidateAgentProvider,
  createGenerationProvider,
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
});

function aiEnv(ai: Ai): { AI: Ai } {
  return { AI: ai };
}
