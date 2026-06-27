import { describe, expect, it, vi } from 'vitest';

import { CloudflareAIProvider } from '../cloudflareAIProvider';
import {
  DEFAULT_CLOUDFLARE_MODEL,
  createCandidateAgentProvider,
} from '../createProvider';

function createAi(): Ai {
  return { run: vi.fn() } as unknown as Ai;
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
});
