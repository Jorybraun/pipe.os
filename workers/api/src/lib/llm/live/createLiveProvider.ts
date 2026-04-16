import type { LiveProvider } from './types';
import { VertexLiveProvider } from './vertexLiveProvider';
import { MockLiveProvider } from './mockLiveProvider';

interface LiveProviderEnv {
  LIVE_PROVIDER?: string;
  /** Gemini Developer API key (AIzaSy...) — preferred for Live API sessions. */
  GOOGLE_AI_API_KEY?: string;
  /** Legacy: Vertex AI key. Prefer GOOGLE_AI_API_KEY for new setups. */
  VERTEX_API_KEY?: string;
}

/**
 * Returns the configured LiveProvider for real-time voice sessions.
 *
 * Selection order:
 *   1. LIVE_PROVIDER=mock → MockLiveProvider (tests only)
 *   2. GOOGLE_AI_API_KEY present → VertexLiveProvider (Gemini Developer API endpoint)
 *   3. VERTEX_API_KEY present → VertexLiveProvider (legacy fallback)
 *   4. null (live voice unavailable — feature should be disabled)
 *
 * To swap backends: change the VertexLiveProvider constructor call here.
 */
export function createLiveProvider(env: LiveProviderEnv): LiveProvider | null {
  const name = env.LIVE_PROVIDER ?? 'vertex-live';

  if (name === 'mock') {
    return new MockLiveProvider();
  }

  const apiKey = env.GOOGLE_AI_API_KEY ?? env.VERTEX_API_KEY;
  if (apiKey) {
    return new VertexLiveProvider(apiKey);
  }

  return null;
}
