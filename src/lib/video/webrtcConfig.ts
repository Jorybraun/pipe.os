// ============================================================================
// WebRTC Configuration
// ============================================================================
//
// Uses Metered.ca for TURN relay (free tier: 50GB/month).
// Set VITE_METERED_API_KEY in your .env file.
// Falls back to STUN-only if credentials unavailable.

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

  const apiKey = import.meta.env.VITE_METERED_API_KEY as string | undefined;
  if (!apiKey) {
    console.warn('[webrtcConfig] VITE_METERED_API_KEY not set — using STUN-only (will fail behind NAT/VPN)');
    return STUN_FALLBACK;
  }

  try {
    const response = await fetch(
      `https://pipe-os.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
    );

    if (!response.ok) {
      console.error('[webrtcConfig] Metered API returned', response.status);
      return STUN_FALLBACK;
    }

    const servers: RTCIceServer[] = await response.json();
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
