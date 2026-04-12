import type { LiveProvider } from './types';
import { VertexLiveProvider } from './vertexLiveProvider';
import { MockLiveProvider } from './mockLiveProvider';

interface LiveProviderEnv {
  LIVE_PROVIDER?: string;
  VERTEX_API_KEY?: string;
}

/**
 * Returns the configured LiveProvider for real-time voice sessions.
 *
 * Selection order:
 *   1. LIVE_PROVIDER=mock → MockLiveProvider (tests only)
 *   2. VERTEX_API_KEY present → VertexLiveProvider
 *   3. null (live voice unavailable — feature should be disabled)
 *
 * Configured via LIVE_PROVIDER env var. Default: 'vertex-live'.
 */
export function createLiveProvider(env: LiveProviderEnv): LiveProvider | null {
  const name = env.LIVE_PROVIDER ?? 'vertex-live';

  if (name === 'mock') {
    return new MockLiveProvider();
  }

  if (env.VERTEX_API_KEY) {
    return new VertexLiveProvider(env.VERTEX_API_KEY);
  }

  return null;
}
