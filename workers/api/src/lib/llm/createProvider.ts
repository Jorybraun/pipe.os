/**
 * Factory — creates the correct LLMProvider from environment variables.
 *
 * Config via env vars:
 *   ROLE_AGENT_PROVIDER    = 'mistral' | 'google-ai'                 (default: 'mistral')
 *   CULTURE_AGENT_PROVIDER = 'cloudflare-ai' | 'mistral' | 'google-ai' (default: 'cloudflare-ai')
 *   MISTRAL_API_KEY        = your Mistral API key
 *   GOOGLE_AI_API_KEY      = your Google AI Studio key
 *   (cloudflare-ai uses env.AI binding — no key required)
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
  AI?: Ai;
}

export function createRoleAgentProvider(env: ProviderEnv): LLMProvider | null {
  const providerName = (env.ROLE_AGENT_PROVIDER ?? 'mistral') as ProviderName;

  if (providerName === 'google-ai') {
    const key = env.GOOGLE_AI_API_KEY ?? '';
    if (!key) return null;
    return new GoogleAIProvider(key);
  }

  // Default: Mistral
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
