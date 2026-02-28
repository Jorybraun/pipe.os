// ============================================================================
// WebRTC Configuration
// ============================================================================
//
// MVP: STUN-only using Google's free public STUN servers.
// When NAT traversal fails (~20% of connections), add TURN credentials here.
//
// To add TURN later (e.g. Metered.ca):
//   1. Get credentials from your TURN provider
//   2. Add { urls: 'turn:...', username: ..., credential: ... } entries below
//   3. No other code changes needed — all callers use getIceServers()

/**
 * Returns the ICE server configuration for RTCPeerConnection.
 *
 * Currently STUN-only. Structured as an async function so TURN credentials
 * (which may require a server fetch) can be appended in the future without
 * changing any call sites.
 */
export async function getIceServers(): Promise<RTCIceServer[]> {
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // To add TURN later, uncomment and fill in:
  // const turnCredentials = await fetchTurnCredentials();
  // return [
  //   { urls: 'stun:stun.l.google.com:19302' },
  //   {
  //     urls: 'turn:your-turn-server.example.com:3478',
  //     username: turnCredentials.username,
  //     credential: turnCredentials.credential,
  //   },
  // ];
}

/**
 * Builds a fully configured RTCPeerConnection with the correct ICE servers.
 */
export async function createPeerConnection(): Promise<RTCPeerConnection> {
  const iceServers = await getIceServers();
  return new RTCPeerConnection({ iceServers });
}
