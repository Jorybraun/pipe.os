/**
 * Shared GCP service-account JWT auth helpers.
 *
 * Used by code paths that still call Google APIs directly (Vertex AI Live
 * WebSocket, Cloud Text-to-Speech) and cannot go through Cloudflare AI Gateway.
 *
 * For regular Vertex AI REST calls, use VertexAIProvider which talks to
 * Cloudflare AI Gateway and does NOT need these helpers.
 */

export interface ServiceAccountKey {
  private_key: string;
  client_email: string;
  project_id: string;
}

// ─── Module-level token cache ─────────────────────────────────────────────────
// Workers isolates may reuse module-level state between requests on the same
// isolate. Cache hits cost 0ms; cache misses cost ~50ms for the token exchange.

let _tokenCache: { token: string; expiresAt: number } | null = null;
let _cryptoKey: CryptoKey | null = null;

// ─── JWT helpers (pure Web Crypto — no npm) ───────────────────────────────────

function b64urlEncode(data: Uint8Array): string {
  let bin = '';
  for (const byte of data) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJson(obj: unknown): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function importKey(pemPrivateKey: string): Promise<CryptoKey> {
  const b64 = pemPrivateKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\n/g, '')
    .trim();
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-V1_5', hash: { name: 'SHA-256' } },
    false,
    ['sign'],
  );
}

async function signJwt(key: CryptoKey, payload: Record<string, unknown>): Promise<string> {
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const body = encodeJson(payload);
  const sigInput = `${header}.${body}`;
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-V1_5' },
    key,
    new TextEncoder().encode(sigInput),
  );
  return `${sigInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

// ─── Access token (with cache) ────────────────────────────────────────────────

export async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now) return _tokenCache.token;

  if (!_cryptoKey) {
    _cryptoKey = await importKey(sa.private_key);
  }

  const iat = Math.floor(now / 1000);
  const jwt = await signJwt(_cryptoKey, {
    iss: sa.client_email,
    sub: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new Error(`GCP token exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Cache for expires_in minus a 5-minute buffer
  _tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in - 300) * 1000 };
  return _tokenCache.token;
}
