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
import type { ServiceAccountKey } from './vertexAIProvider';
import type { LLMProvider } from './types';

export type ProviderName = 'google-ai' | 'cloudflare-ai' | 'vertex-ai';

export interface ProviderEnv {
  GOOGLE_AI_API_KEY?: string;
  /** GCP service account JSON string — used by VertexAIProvider for self-refreshing JWT auth. */
  VERTEX_SA_KEY_JSON?: string;
  /** Optional — if omitted, project_id is read from VERTEX_SA_KEY_JSON. */
  VERTEX_AI_PROJECT_ID?: string;
  VERTEX_AI_REGION?: string;
  VERTEX_AI_MODEL?: string;
  ROLE_AGENT_PROVIDER?: string;
  CULTURE_AGENT_PROVIDER?: string;
  COPILOT_AGENT_PROVIDER?: string;
  CANDIDATE_AGENT_PROVIDER?: string;
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

  if (providerName === 'cloudflare-ai') {
    if (env.AI) return new CloudflareAIProvider(env.AI);
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
    return new CloudflareAIProvider(env.AI);
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
    if (env.AI) return new CloudflareAIProvider(env.AI);
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
