import type { DataProvider } from '../../providers/types';

// ============================================================================
// WebRTC Configuration
// ============================================================================
//
// Uses Metered.ca for TURN relay (free tier: 50GB/month).
// METERED_API_KEY is stored in the Lambda environment (never exposed to client).
// Falls back to STUN-only if credentials unavailable.
//
// NOTE: Only called by authenticated recruiters. Candidates receive ICE servers
// via the OFFER payload — they never call this API directly.

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
 * Fetches temporary TURN credentials from Metered.ca REST API.
 * Returns combined STUN + TURN servers on success, STUN-only on failure.
 *
 * Credentials are cached for 1 hour to avoid excessive API calls.
 *
 * @param client - Authenticated DataProvider (recruiter userPool client).
 */
export async function getIceServers(client: DataProvider): Promise<RTCIceServer[]> {
  // Return cached if still fresh
  if (cachedIceServers && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedIceServers;
  }

  try {
    console.log('[webrtcConfig] Fetching TURN credentials from API...');
    const response = await client.queries.getTurnCredentials!({});

    if (response.errors) {
      console.error('[webrtcConfig] getTurnCredentials GraphQL errors:', JSON.stringify(response.errors, null, 2));
      return STUN_FALLBACK;
    }

    // a.json() (AWSJSON scalar) may return a JSON string or a parsed object
    // depending on the AppSync/Amplify client version. Handle both.
    let servers: unknown = response.data;
    if (typeof servers === 'string') {
      try {
        servers = JSON.parse(servers);
      } catch {
        console.error('[webrtcConfig] Failed to parse TURN response as JSON:', servers);
        return STUN_FALLBACK;
      }
    }

    if (!servers || !Array.isArray(servers)) {
      console.warn('[webrtcConfig] getTurnCredentials returned unexpected format:', typeof servers, servers);
      console.warn('This usually means the METERED_API_KEY secret is not set or the user is not authenticated.');
      return STUN_FALLBACK;
    }

    const iceServers = servers as RTCIceServer[];

    // Metered returns an array of ICE servers (STUN + TURN with temp credentials)
    cachedIceServers = iceServers;
    cacheTimestamp = Date.now();
    console.log('[webrtcConfig] Successfully fetched', iceServers.length, 'TURN/STUN servers');
    return iceServers;
  } catch (err) {
    console.error('[webrtcConfig] Unexpected error fetching TURN credentials:', err);
    return STUN_FALLBACK;
  }
}

/**
 * Builds a fully configured RTCPeerConnection.
 *
 * @param iceServers - ICE servers to use. Recruiters obtain these by calling
 *   getIceServers(client) first. Candidates receive them via the OFFER payload.
 *   Falls back to STUN-only if not provided.
 */
export function createPeerConnection(iceServers?: RTCIceServer[]): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: iceServers ?? STUN_FALLBACK });
}
