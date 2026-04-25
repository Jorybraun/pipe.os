import type { LiveProvider } from './types';
import { VertexLiveProvider } from './vertexLiveProvider';
import { MockLiveProvider } from './mockLiveProvider';
import type { ServiceAccountKey } from '../vertexAIProvider';

interface LiveProviderEnv {
  LIVE_PROVIDER?: string;
  VERTEX_SA_KEY_JSON?: string;
  VERTEX_AI_PROJECT_ID?: string;
  VERTEX_AI_REGION?: string;
  /** Override the Vertex AI Live model ID. Defaults to gemini-live-2.5-flash-native-audio. */
  VERTEX_AI_LIVE_MODEL?: string;
}

function parseSaKey(env: LiveProviderEnv): ServiceAccountKey | null {
  const raw = env.VERTEX_SA_KEY_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.private_key !== 'string' || typeof parsed.client_email !== 'string') {
      console.error('[createLiveProvider] VERTEX_SA_KEY_JSON missing private_key or client_email');
      return null;
    }
    return {
      private_key: parsed.private_key,
      client_email: parsed.client_email,
      project_id: typeof parsed.project_id === 'string' ? parsed.project_id : (env.VERTEX_AI_PROJECT_ID ?? ''),
    };
  } catch {
    console.error('[createLiveProvider] Failed to parse VERTEX_SA_KEY_JSON');
    return null;
  }
}

/**
 * Returns the configured LiveProvider for real-time voice sessions.
 *
 * Selection order:
 *   1. LIVE_PROVIDER=mock → MockLiveProvider (tests only)
 *   2. VERTEX_SA_KEY_JSON present → VertexLiveProvider (Vertex AI endpoint, SA auth)
 *   3. null (live voice unavailable — feature should be disabled)
 */
export function createLiveProvider(env: LiveProviderEnv): LiveProvider | null {
  if (env.LIVE_PROVIDER === 'mock') {
    return new MockLiveProvider();
  }

  const sa = parseSaKey(env);
  if (sa) {
    const region = env.VERTEX_AI_REGION ?? 'us-central1';
    return new VertexLiveProvider(sa, sa.project_id, region, env.VERTEX_AI_LIVE_MODEL);
  }

  return null;
}
