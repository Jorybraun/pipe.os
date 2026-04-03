// ============================================================================
// WebRTC Configuration
// ============================================================================
//
// Uses Metered.ca for TURN relay (free tier: 50GB/month).
// METERED_API_KEY is stored in the Worker environment (never exposed to client).
// Falls back to STUN-only if credentials unavailable.
//
// NOTE: Only called by authenticated recruiters. Candidates receive ICE servers
// via the OFFER payload — they never call this API directly.

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

/** Cached TURN credentials to avoid re-fetching during a session */
let cachedIceServers: RTCIceServer[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 3600_000; // 1 hour — Metered credentials last ~24h

/** STUN-only fallback when TURN is unavailable */
const STUN_FALLBACK: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Fetches temporary TURN credentials from the Worker API.
 * Returns combined STUN + TURN servers on success, STUN-only on failure.
 *
 * Credentials are cached for 1 hour to avoid excessive API calls.
 *
 * @param getToken - Function to get the current Clerk JWT for authentication.
 */
export async function getIceServers(
  getToken: () => Promise<string | null>,
): Promise<RTCIceServer[]> {
  // Return cached if still fresh
  if (cachedIceServers && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedIceServers;
  }

  try {
    console.log('[webrtcConfig] Fetching TURN credentials from Worker API...');

    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/api/v1/video/turn-credentials`, {
      headers,
    });

    if (!response.ok) {
      console.error('[webrtcConfig] TURN credentials fetch failed:', response.status);
      return STUN_FALLBACK;
    }

    const data = await response.json() as { iceServers: RTCIceServer[] };

    if (!data.iceServers || !Array.isArray(data.iceServers)) {
      console.warn('[webrtcConfig] Unexpected response format:', data);
      return STUN_FALLBACK;
    }

    cachedIceServers = data.iceServers;
    cacheTimestamp = Date.now();
    console.log('[webrtcConfig] Successfully fetched', data.iceServers.length, 'TURN/STUN servers');
    return data.iceServers;
  } catch (err) {
    console.error('[webrtcConfig] Unexpected error fetching TURN credentials:', err);
    return STUN_FALLBACK;
  }
}

/**
 * Builds a fully configured RTCPeerConnection.
 *
 * @param iceServers - ICE servers to use. Recruiters obtain these by calling
 *   getIceServers(getToken) first. Candidates receive them via the OFFER payload.
 *   Falls back to STUN-only if not provided.
 */
export function createPeerConnection(iceServers?: RTCIceServer[]): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: iceServers ?? STUN_FALLBACK });
}
