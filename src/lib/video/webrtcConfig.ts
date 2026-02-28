import { generateClient } from 'aws-amplify/data';

// ============================================================================
// WebRTC Configuration
// ============================================================================
//
// Uses Metered.ca for TURN relay (free tier: 50GB/month).
// Set METERED_API_KEY in your .env file.
// Falls back to STUN-only if credentials unavailable.

const client = generateClient();

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
 */
export async function getIceServers(): Promise<RTCIceServer[]> {
  // Return cached if still fresh
  if (cachedIceServers && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedIceServers;
  }

  try {
    const response = await client.graphql({
      query: `query GetTurnCredentials {
        getTurnCredentials
      }`,
    }) as any;

    const servers = response.data?.getTurnCredentials as RTCIceServer[] | null;

    if (!servers) {
      console.error('[webrtcConfig] getTurnCredentials query returned null');
      return STUN_FALLBACK;
    }
    
    // Metered returns an array of ICE servers (STUN + TURN with temp credentials)
    cachedIceServers = servers;
    cacheTimestamp = Date.now();
    console.log('[webrtcConfig] Fetched TURN credentials:', servers.length, 'servers');
    return servers;
  } catch (err) {
    console.error('[webrtcConfig] Failed to fetch TURN credentials:', err);
    return STUN_FALLBACK;
  }
}

/**
 * Builds a fully configured RTCPeerConnection with the correct ICE servers.
 */
export async function createPeerConnection(): Promise<RTCPeerConnection> {
  const iceServers = await getIceServers();
  return new RTCPeerConnection({ iceServers });
}
