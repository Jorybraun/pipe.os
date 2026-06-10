/**
 * JWT library for Cloudflare Workers — HMAC-SHA256 via Web Crypto API.
 *
 * Zero Node.js dependencies. Replaces amplify/functions/_shared/jwt.ts.
 *
 * Used by:
 *   - resolve-token (sign after validating inviteToken)
 *   - candidateAuth middleware (verify on every /rpc/* request)
 *   - refresh-session (verify signature ignoring expiry, then reissue)
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface JwtPayload {
  /** Subject — candidateId */
  sub: string;
  /** Pipeline ID (null for talent-pool / standalone candidates) */
  pid: string | null;
  /** Issued at (unix seconds) */
  iat: number;
  /** Expires at (unix seconds) */
  exp: number;
}

// ── Base64url helpers ───────────────────────────────────────────────────────

function base64urlEncode(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlEncodeString(str: string): string {
  return base64urlEncode(new TextEncoder().encode(str));
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Crypto key import ───────────────────────────────────────────────────────

async function getSigningKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// ── Header (static) ────────────────────────────────────────────────────────

const HEADER = base64urlEncodeString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

// ── Sign ────────────────────────────────────────────────────────────────────

/**
 * Sign a JWT with HMAC-SHA256 using Web Crypto API.
 *
 * @param payload - Must contain `sub` (candidateId) and `pid` (pipelineId).
 * @param secret  - HMAC signing secret (SESSION_TOKEN_SECRET env var).
 * @param ttlSeconds - Token lifetime in seconds (default: 7200 = 2 hours).
 */
export async function signJwt(
  payload: Pick<JwtPayload, 'sub' | 'pid'>,
  secret: string,
  ttlSeconds: number = 7200,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const fullPayload: JwtPayload = {
    sub: payload.sub,
    pid: payload.pid,
    iat: now,
    exp: now + ttlSeconds,
  };

  const encodedPayload = base64urlEncodeString(JSON.stringify(fullPayload));
  const signingInput = `${HEADER}.${encodedPayload}`;

  const key = await getSigningKey(secret);
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  );

  const signature = base64urlEncode(new Uint8Array(signatureBuffer));
  return `${signingInput}.${signature}`;
}

// ── Verify ──────────────────────────────────────────────────────────────────

/**
 * Verify a JWT's signature and expiry. Returns the payload if valid, null otherwise.
 *
 * @param token - The full JWT string (header.payload.signature).
 * @param secret - The same HMAC secret used to sign.
 * @param ignoreExpiry - If true, skip the exp check (used for refresh flow).
 */
export async function verifyJwt(
  token: string,
  secret: string,
  ignoreExpiry: boolean = false,
): Promise<JwtPayload | null> {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;

  // Verify signature — wrap in try-catch for malformed tokens
  let valid: boolean;
  try {
    const signingInput = `${header}.${payload}`;
    const key = await getSigningKey(secret);
    const signatureBytes = base64urlDecode(signature);
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput),
    );
  } catch {
    return null;
  }

  if (!valid) return null;

  // Decode payload
  let decoded: JwtPayload;
  try {
    const payloadBytes = base64urlDecode(payload);
    decoded = JSON.parse(new TextDecoder().decode(payloadBytes)) as JwtPayload;
  } catch {
    return null;
  }

  // Validate required fields
  if (
    typeof decoded.sub !== 'string' ||
    (typeof decoded.pid !== 'string' && decoded.pid !== null) ||
    typeof decoded.iat !== 'number' ||
    typeof decoded.exp !== 'number'
  ) {
    return null;
  }

  // Check expiry (unless explicitly ignored for refresh)
  if (!ignoreExpiry) {
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp <= now) return null;
  }

  return decoded;
}
