/**
 * Factory — creates the correct LLMProvider from environment variables.
 *
 * Config via env vars:
 *   ROLE_AGENT_PROVIDER    = 'cloudflare-ai' | 'mistral' | 'google-ai' (default: 'cloudflare-ai')
 *   CULTURE_AGENT_PROVIDER = 'cloudflare-ai' | 'mistral' | 'google-ai' (default: 'cloudflare-ai')
 *   MISTRAL_API_KEY        = your Mistral API key (used as Role Agent fallback)
 *   GOOGLE_AI_API_KEY      = your Google AI Studio key
 *   (cloudflare-ai uses env.AI binding — no key required)
 *
 * Routing rationale: Role Discovery and Culture both use Workers AI Gemma 4
 * as primary because it's strong at structured JSON output, runs at the edge
 * with no per-call API key cost, and avoids burning Mistral budget on
 * non-evaluative tasks. Mistral is reserved for the code-review scoring panel
 * (Devstral) where evaluative quality matters more than cost.
 */

import { MistralProvider } from './mistralProvider';
import { GoogleAIProvider } from './googleAIProvider';
import { CloudflareAIProvider } from './cloudflareAIProvider';
import type { LLMProvider } from './types';

export type ProviderName = 'mistral' | 'google-ai' | 'cloudflare-ai';

interface ProviderEnv {
  MISTRAL_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  ROLE_AGENT_PROVIDER?: string;
  CULTURE_AGENT_PROVIDER?: string;
  COPILOT_AGENT_PROVIDER?: string;
  AI?: Ai;
  /** When 'true', culture agent returns null provider and uses deterministic mock path. */
  MOCK_AI?: string;
}

export function createRoleAgentProvider(env: ProviderEnv): LLMProvider | null {
  const providerName = (env.ROLE_AGENT_PROVIDER ?? 'cloudflare-ai') as ProviderName;

  if (providerName === 'cloudflare-ai') {
    if (env.AI) return new CloudflareAIProvider(env.AI);
    // Fallback chain: Workers AI binding missing → Mistral → null.
    const mistralKey = env.MISTRAL_API_KEY ?? '';
    if (mistralKey) return new MistralProvider(mistralKey);
    return null;
  }

  if (providerName === 'google-ai') {
    const key = env.GOOGLE_AI_API_KEY ?? '';
    if (!key) return null;
    return new GoogleAIProvider(key);
  }

  // Explicit 'mistral' selection
  const key = env.MISTRAL_API_KEY ?? '';
  if (!key) return null;
  return new MistralProvider(key);
}

/**
 * Factory for the Culture Interview Agent (ADR-029).
 * Defaults to Cloudflare Workers AI Gemma 4 — cheap and fast at the edge.
 * Can be overridden for calibration runs or fallback via CULTURE_AGENT_PROVIDER.
 */
export function createCultureAgentProvider(env: ProviderEnv): LLMProvider | null {
  // MOCK_AI short-circuit — forces the culture agent down its deterministic
  // mock-turn path (see mockTurnResponse in cultureAgent.ts). Used by E2E/Vitest.
  if (env.MOCK_AI === 'true') return null;

  const providerName = (env.CULTURE_AGENT_PROVIDER ?? 'cloudflare-ai') as ProviderName;

  if (providerName === 'cloudflare-ai') {
    if (!env.AI) return null;
    return new CloudflareAIProvider(env.AI);
  }

  if (providerName === 'google-ai') {
    const key = env.GOOGLE_AI_API_KEY ?? '';
    if (!key) return null;
    return new GoogleAIProvider(key);
  }

  if (providerName === 'mistral') {
    const key = env.MISTRAL_API_KEY ?? '';
    if (!key) return null;
    return new MistralProvider(key);
  }

  return null;
}

/**
 * Factory for the Global Copilot Agent (recruiter assistant drawer).
 * Defaults to Cloudflare Workers AI Gemma 4.
 */
export function createCopilotProvider(env: ProviderEnv): LLMProvider | null {
  if (env.MOCK_AI === 'true') return null;

  const providerName = (env.COPILOT_AGENT_PROVIDER ?? 'cloudflare-ai') as ProviderName;

  if (providerName === 'cloudflare-ai') {
    if (!env.AI) return null;
    return new CloudflareAIProvider(env.AI);
  }

  if (providerName === 'mistral') {
    const key = env.MISTRAL_API_KEY ?? '';
    if (!key) return null;
    return new MistralProvider(key);
  }

  return null;
}

/**
 * Factory for Challenge Generation Pipeline agents (ADR-034 CA Phase 3).
 * Takes an explicit model string because different pipeline stages use
 * different models (Gemma 26B, Qwen 32B, Gemma 12B).
 *
 * Falls back to null if the AI binding is unavailable.
 */
export function createGenerationProvider(env: ProviderEnv, model: string): LLMProvider | null {
  if (!env.AI) return null;
  return new CloudflareAIProvider(env.AI, model);
}
