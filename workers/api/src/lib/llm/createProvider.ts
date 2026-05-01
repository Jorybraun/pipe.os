/**
 * Factory — creates the correct LLMProvider from environment variables.
 *
 * Config via env vars:
 *   ROLE_AGENT_PROVIDER    = 'cloudflare-ai' | 'vertex-ai' (default: 'cloudflare-ai')
 *   CULTURE_AGENT_PROVIDER = 'cloudflare-ai' | 'vertex-ai' (default: 'cloudflare-ai')
 *   VERTEX_SA_KEY_JSON     = GCP service account JSON string (for vertex-ai)
 *   VERTEX_AI_PROJECT_ID   = GCP project ID (optional — read from SA JSON if omitted)
 *   VERTEX_AI_REGION       = GCP region (default: us-central1)
 *   VERTEX_AI_MODEL        = model ID (default: gemma-4-26b-a4b-it)
 *   (cloudflare-ai uses env.AI binding — no key required)
 *
 * DO NOT set *_PROVIDER=google-ai — Cloudflare edge IPs are geo-blocked by
 * generativelanguage.googleapis.com. Use vertex-ai or cloudflare-ai instead.
 *
 * Routing rationale: Role Discovery and Culture both default to Workers AI Gemma 4
 * (cloudflare-ai) — edge-native binding, no external network, free tier. Use
 * vertex-ai when you need higher throughput or the full 31B model via a dedicated
 * Vertex endpoint.
 */

import { GoogleAIProvider } from './googleAIProvider';
import { CloudflareAIProvider } from './cloudflareAIProvider';
import { VertexAIProvider } from './vertexAIProvider';
import { KimiProvider } from './kimiProvider';
import type { ServiceAccountKey } from './vertexAIProvider';
import type { LLMProvider } from './types';

export type ProviderName = 'google-ai' | 'cloudflare-ai' | 'vertex-ai' | 'kimi';

export interface ProviderEnv {
  GOOGLE_AI_API_KEY?: string;
  /** GCP service account JSON string — used by VertexAIProvider for self-refreshing JWT auth. */
  VERTEX_SA_KEY_JSON?: string;
  /** Optional — if omitted, project_id is read from VERTEX_SA_KEY_JSON. */
  VERTEX_AI_PROJECT_ID?: string;
  VERTEX_AI_REGION?: string;
  VERTEX_AI_MODEL?: string;
  ROLE_AGENT_PROVIDER?: string;
  ROLE_AGENT_SYNTHESIS_PROVIDER?: string;
  CULTURE_AGENT_PROVIDER?: string;
  COPILOT_AGENT_PROVIDER?: string;
  CANDIDATE_AGENT_PROVIDER?: string;
  KIMI_API_KEY?: string;
  KIMI_BASE_URL?: string;
  KIMI_MODEL?: string;
  /** Cloudflare Workers AI model override. Default: @cf/meta/llama-3.1-8b-instruct */
  CLOUDFLARE_AI_MODEL?: string;
  AI?: Ai;
  /** When 'true', culture agent returns null provider and uses deterministic mock path. */
  MOCK_AI?: string;
}

/** Parse and validate VERTEX_SA_KEY_JSON. Returns null if missing or malformed. */
function parseServiceAccount(env: ProviderEnv): ServiceAccountKey | null {
  const raw = env.VERTEX_SA_KEY_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.private_key !== 'string' || typeof parsed.client_email !== 'string') {
      console.error('[createProvider] VERTEX_SA_KEY_JSON missing private_key or client_email');
      return null;
    }
    return {
      private_key: parsed.private_key,
      client_email: parsed.client_email,
      project_id: typeof parsed.project_id === 'string' ? parsed.project_id : (env.VERTEX_AI_PROJECT_ID ?? ''),
    };
  } catch {
    console.error('[createProvider] Failed to parse VERTEX_SA_KEY_JSON');
    return null;
  }
}

export function createRoleAgentProvider(env: ProviderEnv): LLMProvider | null {
  const providerName = (env.ROLE_AGENT_PROVIDER ?? 'cloudflare-ai') as ProviderName;
  return _createProviderByName(env, providerName);
}

/**
 * Create a fallback provider that uses a DIFFERENT backend than the primary.
 * Switching models gives us resilience when one provider is down or rate-limited.
 *
 * Preference order:
 *   - Primary = vertex-ai  → fallback = cloudflare-ai (edge-native, no external network)
 *   - Primary = cloudflare-ai or google-ai → fallback = vertex-ai (if SA key configured)
 *   - Otherwise → null (no alternate provider available)
 */
export function createRoleAgentFallbackProvider(env: ProviderEnv): LLMProvider | null {
  const primaryName = (env.ROLE_AGENT_PROVIDER ?? 'cloudflare-ai') as ProviderName;
  return _createFallbackForPrimary(env, primaryName);
}

/**
 * Create a synthesis-specific provider for the Role Agent.
 * Falls back to ROLE_AGENT_PROVIDER when ROLE_AGENT_SYNTHESIS_PROVIDER is unset.
 */
export function createRoleAgentSynthesisProvider(env: ProviderEnv): LLMProvider | null {
  const synthesisProviderName = env.ROLE_AGENT_SYNTHESIS_PROVIDER;
  if (synthesisProviderName) {
    return _createProviderByName(env, synthesisProviderName as ProviderName);
  }
  // No override — reuse the regular role agent provider
  return createRoleAgentProvider(env);
}

/**
 * Fallback for synthesis provider.
 * When a synthesis-specific provider is configured, fall back to the regular
 * role agent fallback. Otherwise reuse the regular fallback.
 */
export function createRoleAgentSynthesisFallbackProvider(env: ProviderEnv): LLMProvider | null {
  const synthesisProviderName = env.ROLE_AGENT_SYNTHESIS_PROVIDER;
  if (synthesisProviderName) {
    return _createFallbackForPrimary(env, synthesisProviderName as ProviderName);
  }
  return createRoleAgentFallbackProvider(env);
}

/** Shared fallback logic — returns a DIFFERENT backend than the primary. */
function _createFallbackForPrimary(env: ProviderEnv, primaryName: ProviderName): LLMProvider | null {
  if (primaryName === 'kimi') {
    // Fallback to Vertex if credentials exist, else Cloudflare Workers AI
    const sa = parseServiceAccount(env);
    if (sa && sa.project_id) {
      return new VertexAIProvider(sa, sa.project_id, env.VERTEX_AI_REGION ?? 'us-central1', env.VERTEX_AI_MODEL ?? 'gemma-4-26b-a4b-it');
    }
    if (env.AI) return new CloudflareAIProvider(env.AI);
    return null;
  }

  if (primaryName === 'vertex-ai') {
    // Fallback to Cloudflare Workers AI (edge binding, always available in prod)
    if (env.AI) return new CloudflareAIProvider(env.AI);
    return null;
  }

  // Primary is cloudflare-ai or google-ai — try Vertex if credentials exist
  const sa = parseServiceAccount(env);
  if (sa && sa.project_id) {
    return new VertexAIProvider(sa, sa.project_id, env.VERTEX_AI_REGION ?? 'us-central1', env.VERTEX_AI_MODEL ?? 'gemma-4-26b-a4b-it');
  }

  return null;
}

function _createProviderByName(env: ProviderEnv, providerName: ProviderName): LLMProvider | null {
  if (providerName === 'cloudflare-ai') {
    if (env.AI) return new CloudflareAIProvider(env.AI, env.CLOUDFLARE_AI_MODEL);
    return null;
  }

  if (providerName === 'google-ai') {
    const key = env.GOOGLE_AI_API_KEY ?? '';
    if (!key) return null;
    return new GoogleAIProvider(key);
  }

  if (providerName === 'vertex-ai') {
    const sa = parseServiceAccount(env);
    if (!sa || !sa.project_id) return null;
    return new VertexAIProvider(sa, sa.project_id, env.VERTEX_AI_REGION ?? 'us-central1', env.VERTEX_AI_MODEL ?? 'gemma-4-26b-a4b-it');
  }

  if (providerName === 'kimi') {
    const key = env.KIMI_API_KEY ?? '';
    if (!key) return null;
    return new KimiProvider(key, env.KIMI_MODEL ?? 'kimi-k2-6', env.KIMI_BASE_URL);
  }

  return null;
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
    return new CloudflareAIProvider(env.AI, env.CLOUDFLARE_AI_MODEL);
  }

  if (providerName === 'vertex-ai') {
    const sa = parseServiceAccount(env);
    if (!sa || !sa.project_id) return null;
    return new VertexAIProvider(sa, sa.project_id, env.VERTEX_AI_REGION ?? 'us-central1', env.VERTEX_AI_MODEL ?? 'gemma-4-26b-a4b-it');
  }

  if (providerName === 'google-ai') {
    const key = env.GOOGLE_AI_API_KEY ?? '';
    if (!key) return null;
    return new GoogleAIProvider(key);
  }

  if (providerName === 'kimi') {
    const key = env.KIMI_API_KEY ?? '';
    if (!key) return null;
    return new KimiProvider(key, env.KIMI_MODEL ?? 'kimi-k2-6', env.KIMI_BASE_URL);
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
    return new CloudflareAIProvider(env.AI, env.CLOUDFLARE_AI_MODEL);
  }

  if (providerName === 'vertex-ai') {
    const sa = parseServiceAccount(env);
    if (!sa || !sa.project_id) return null;
    return new VertexAIProvider(sa, sa.project_id, env.VERTEX_AI_REGION ?? 'us-central1', env.VERTEX_AI_MODEL ?? 'gemma-4-26b-a4b-it');
  }

  return null;
}

/**
 * Factory for the Candidate Discovery agent (ADR-039 + STRATEGY.md Decision
 * Log 2026-04-21). Mirror of createRoleAgentProvider — same Gemma 4 26B on
 * Vertex AI in prod with Workers AI binding as fallback.
 */
export function createCandidateAgentProvider(env: ProviderEnv): LLMProvider | null {
  if (env.MOCK_AI === 'true') return null;

  const providerName = (env.CANDIDATE_AGENT_PROVIDER ?? 'cloudflare-ai') as ProviderName;

  if (providerName === 'cloudflare-ai') {
    if (env.AI) return new CloudflareAIProvider(env.AI, env.CLOUDFLARE_AI_MODEL);
    return null;
  }

  if (providerName === 'vertex-ai') {
    const sa = parseServiceAccount(env);
    if (!sa || !sa.project_id) return null;
    return new VertexAIProvider(
      sa,
      sa.project_id,
      env.VERTEX_AI_REGION ?? 'us-central1',
      env.VERTEX_AI_MODEL ?? 'gemma-4-26b-a4b-it',
    );
  }

  if (providerName === 'google-ai') {
    const key = env.GOOGLE_AI_API_KEY ?? '';
    if (!key) return null;
    return new GoogleAIProvider(key);
  }

  if (providerName === 'kimi') {
    const key = env.KIMI_API_KEY ?? '';
    if (!key) return null;
    return new KimiProvider(key, env.KIMI_MODEL ?? 'kimi-k2-6', env.KIMI_BASE_URL);
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
