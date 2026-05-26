/**
 * Factory — creates the correct LLMProvider from environment variables.
 *
 * Per-agent config via env vars:
 *   ROLE_AGENT_PROVIDER              = 'cloudflare-ai' | 'vertex-ai' | 'google-ai' | 'kimi'
 *   ROLE_AGENT_MODEL                 = model override (optional)
 *   ROLE_AGENT_SYNTHESIS_PROVIDER    = same options (optional — falls back to ROLE_AGENT_PROVIDER)
 *   ROLE_AGENT_SYNTHESIS_MODEL       = model override (optional)
 *   CULTURE_AGENT_PROVIDER           = same options
 *   CULTURE_AGENT_MODEL              = model override (optional)
 *   COPILOT_AGENT_PROVIDER           = same options
 *   COPILOT_AGENT_MODEL              = model override (optional)
 *   CANDIDATE_AGENT_PROVIDER         = same options
 *   CANDIDATE_AGENT_MODEL            = model override (optional)
 *
 * Shared Vertex / Google / Kimi credentials:
 *   CF_AI_GATEWAY_URL      = Cloudflare AI Gateway URL for Vertex AI (required for vertex-ai provider)
 *   CF_API_TOKEN           = Cloudflare API token with AI Gateway:Read (required for vertex-ai provider)
 *   VERTEX_AI_PROJECT_ID   = GCP project ID (required for the Vertex AI URL path)
 *   VERTEX_AI_REGION       = GCP region (default: us-central1)
 *   VERTEX_AI_MODEL        = default Vertex model (default: google/gemma-4-26b-a4b-it-maas)
 *   GOOGLE_AI_API_KEY      = Gemini API key (NOT RECOMMENDED — geo-blocked on Cloudflare edge)
 *   KIMI_API_KEY           = Moonshot / Kimi API key
 *   KIMI_BASE_URL          = Moonshot base URL (default: https://api.moonshot.cn/v1)
 *   KIMI_MODEL             = default Kimi model (default: kimi-k2-6)
 *
 * Shared Cloudflare credentials:
 *   CLOUDFLARE_AI_MODEL    = default Workers AI model (default: @cf/meta/llama-3.1-8b-instruct)
 *   AI                     = Cloudflare Workers AI binding
 *
 * When 'MOCK_AI=true', culture/copilot/candidate agents return null (deterministic mock paths).
 */

import { GoogleAIProvider } from './googleAIProvider';
import { CloudflareAIProvider } from './cloudflareAIProvider';
import { VertexAIProvider } from './vertexAIProvider';
import { KimiProvider } from './kimiProvider';
import type { LLMProvider } from './types';

export type ProviderName = 'google-ai' | 'cloudflare-ai' | 'vertex-ai' | 'kimi';

const DEFAULT_VERTEX_MODEL = 'google/gemma-4-26b-a4b-it-maas';
const DEFAULT_CLOUDFLARE_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DEFAULT_KIMI_MODEL = 'kimi-k2-6';
const DEFAULT_KIMI_BASE_URL = 'https://api.moonshot.cn/v1';

export interface ProviderEnv {
  GOOGLE_AI_API_KEY?: string;
  /** Cloudflare AI Gateway base URL for Vertex AI (e.g. https://gateway.ai.cloudflare.com/v1/ACCOUNT_ID/GATEWAY_NAME/google-vertex-ai). */
  CF_AI_GATEWAY_URL?: string;
  /** Cloudflare API token with AI Gateway:Read permission. */
  CF_API_TOKEN?: string;
  /** GCP project ID — required for the Vertex AI URL path. */
  VERTEX_AI_PROJECT_ID?: string;
  VERTEX_AI_REGION?: string;
  VERTEX_AI_MODEL?: string;
  /** GCP service account JSON — still required for VertexLiveProvider and TTS. */
  VERTEX_SA_KEY_JSON?: string;

  ROLE_AGENT_PROVIDER?: string;
  ROLE_AGENT_MODEL?: string;
  ROLE_AGENT_SYNTHESIS_PROVIDER?: string;
  ROLE_AGENT_SYNTHESIS_MODEL?: string;
  CULTURE_AGENT_PROVIDER?: string;
  CULTURE_AGENT_MODEL?: string;
  COPILOT_AGENT_PROVIDER?: string;
  COPILOT_AGENT_MODEL?: string;
  CANDIDATE_AGENT_PROVIDER?: string;
  CANDIDATE_AGENT_MODEL?: string;

  KIMI_API_KEY?: string;
  KIMI_BASE_URL?: string;
  KIMI_MODEL?: string;
  /** Cloudflare Workers AI model override. */
  CLOUDFLARE_AI_MODEL?: string;
  AI?: Ai;
  /** When 'true', culture/copilot/candidate agents return null (deterministic mock path). */
  MOCK_AI?: string;
}


/** Registry — maps provider name to its factory. No if-chains, just lookups. */
const PROVIDER_REGISTRY: Record<
  ProviderName,
  (env: ProviderEnv, modelOverride?: string) => LLMProvider | null
> = {
  'cloudflare-ai': (env, modelOverride) => {
    if (!env.AI) return null;
    return new CloudflareAIProvider(env.AI, modelOverride ?? env.CLOUDFLARE_AI_MODEL ?? DEFAULT_CLOUDFLARE_MODEL);
  },
  'google-ai': (env) => {
    const key = env.GOOGLE_AI_API_KEY ?? '';
    if (!key) return null;
    return new GoogleAIProvider(key);
  },
  'vertex-ai': (env, modelOverride) => {
    if (!env.CF_AI_GATEWAY_URL || !env.CF_API_TOKEN) {
      console.error('[createProvider] CF_AI_GATEWAY_URL and CF_API_TOKEN required for vertex-ai provider');
      return null;
    }
    if (!env.VERTEX_AI_PROJECT_ID) {
      console.error('[createProvider] VERTEX_AI_PROJECT_ID required for vertex-ai provider');
      return null;
    }
    return new VertexAIProvider(
      env.CF_AI_GATEWAY_URL,
      env.CF_API_TOKEN,
      env.VERTEX_AI_PROJECT_ID,
      env.VERTEX_AI_REGION ?? 'us-central1',
      modelOverride ?? env.VERTEX_AI_MODEL ?? DEFAULT_VERTEX_MODEL,
    );
  },
  'kimi': (env, modelOverride) => {
    const key = env.KIMI_API_KEY ?? '';
    if (!key) return null;
    return new KimiProvider(
      key,
      modelOverride ?? env.KIMI_MODEL ?? DEFAULT_KIMI_MODEL,
      env.KIMI_BASE_URL ?? DEFAULT_KIMI_BASE_URL,
    );
  },
};

/** Resolve a provider name string to a validated ProviderName or null. */
function resolveProviderName(raw: string | undefined, fallback: ProviderName): ProviderName {
  const name = (raw ?? fallback) as ProviderName;
  if (name in PROVIDER_REGISTRY) return name;
  console.warn(`[createProvider] Unknown provider "${name}", falling back to ${fallback}`);
  return fallback;
}

/**
 * Core helper — looks up the provider in the registry.
 * Every agent factory delegates here.
 */
function createProvider(
  env: ProviderEnv,
  providerName: ProviderName,
  modelOverride?: string,
): LLMProvider | null {
  const factory = PROVIDER_REGISTRY[providerName];
  if (!factory) return null;
  return factory(env, modelOverride);
}

// ───────────────────────────────────────────────────────────────
// Agent-specific factories — thin wrappers that read env keys
// ───────────────────────────────────────────────────────────────

export function createRoleAgentProvider(env: ProviderEnv): LLMProvider | null {
  const name = resolveProviderName(env.ROLE_AGENT_PROVIDER, 'cloudflare-ai');
  return createProvider(env, name, env.ROLE_AGENT_MODEL);
}

/**
 * Create a fallback provider that uses a DIFFERENT backend than the primary.
 * Switching models gives us resilience when one provider is down or rate-limited.
 */
export function createRoleAgentFallbackProvider(env: ProviderEnv): LLMProvider | null {
  const primaryName = resolveProviderName(env.ROLE_AGENT_PROVIDER, 'cloudflare-ai');
  return _createFallbackForPrimary(env, primaryName);
}

/**
 * Create a synthesis-specific provider for the Role Agent.
 * Falls back to ROLE_AGENT_PROVIDER when ROLE_AGENT_SYNTHESIS_PROVIDER is unset.
 */
export function createRoleAgentSynthesisProvider(env: ProviderEnv): LLMProvider | null {
  if (env.ROLE_AGENT_SYNTHESIS_PROVIDER) {
    const name = resolveProviderName(env.ROLE_AGENT_SYNTHESIS_PROVIDER, 'cloudflare-ai');
    return createProvider(env, name, env.ROLE_AGENT_SYNTHESIS_MODEL);
  }
  return createRoleAgentProvider(env);
}

/**
 * Fallback for synthesis provider.
 * When a synthesis-specific provider is configured, fall back to the regular
 * role agent fallback. Otherwise reuse the regular fallback.
 */
export function createRoleAgentSynthesisFallbackProvider(env: ProviderEnv): LLMProvider | null {
  if (env.ROLE_AGENT_SYNTHESIS_PROVIDER) {
    const name = resolveProviderName(env.ROLE_AGENT_SYNTHESIS_PROVIDER, 'cloudflare-ai');
    return _createFallbackForPrimary(env, name);
  }
  return createRoleAgentFallbackProvider(env);
}

/** Shared fallback logic — returns a DIFFERENT backend than the primary. */
function _createFallbackForPrimary(env: ProviderEnv, primaryName: ProviderName): LLMProvider | null {
  // Map: primary → fallback preference list
  const FALLBACK_MAP: Record<ProviderName, ProviderName[]> = {
    'kimi': ['vertex-ai', 'cloudflare-ai'],
    'vertex-ai': ['cloudflare-ai', 'kimi'],
    'cloudflare-ai': ['vertex-ai', 'kimi'],
    'google-ai': ['vertex-ai', 'cloudflare-ai', 'kimi'],
  };

  const candidates = FALLBACK_MAP[primaryName] ?? ['cloudflare-ai', 'vertex-ai'];
  for (const candidate of candidates) {
    if (candidate === primaryName) continue;
    const provider = createProvider(env, candidate);
    if (provider) return provider;
  }
  return null;
}

/**
 * Factory for the Culture Interview Agent (ADR-029).
 */
export function createCultureAgentProvider(env: ProviderEnv): LLMProvider | null {
  if (env.MOCK_AI === 'true') return null;
  const name = resolveProviderName(env.CULTURE_AGENT_PROVIDER, 'cloudflare-ai');
  return createProvider(env, name, env.CULTURE_AGENT_MODEL);
}

/**
 * Factory for the Global Copilot Agent (recruiter assistant drawer).
 */
export function createCopilotProvider(env: ProviderEnv): LLMProvider | null {
  if (env.MOCK_AI === 'true') return null;
  const name = resolveProviderName(env.COPILOT_AGENT_PROVIDER, 'cloudflare-ai');
  return createProvider(env, name, env.COPILOT_AGENT_MODEL);
}

/**
 * Factory for the Candidate Discovery agent (ADR-039).
 */
export function createCandidateAgentProvider(env: ProviderEnv): LLMProvider | null {
  if (env.MOCK_AI === 'true') return null;
  const name = resolveProviderName(env.CANDIDATE_AGENT_PROVIDER, 'cloudflare-ai');
  return createProvider(env, name, env.CANDIDATE_AGENT_MODEL);
}

/**
 * Factory for Challenge Generation Pipeline agents (ADR-034 CA Phase 3).
 * Takes an explicit model string because different pipeline stages use
 * different models (Gemma 26B, Qwen 32B, Gemma 12B).
 */
export function createGenerationProvider(env: ProviderEnv, model: string): LLMProvider | null {
  if (!env.AI) return null;
  return new CloudflareAIProvider(env.AI, model);
}
