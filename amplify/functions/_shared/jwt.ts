/**
 * Minimal JWT library using node:crypto HMAC-SHA256.
 *
 * Zero external dependencies. Used by:
 *   - resolveToken (sign after validating inviteToken)
 *   - sessionAuthorizer (verify on every candidate request)
 */

import { createHmac } from 'node:crypto';

// ── Types ───────────────────────────────────────────────────────────────────

export interface JwtPayload {
  /** Subject — candidateId */
  sub: string;
  /** Pipeline ID */
  pid: string;
  /** Issued at (unix seconds) */
  iat: number;
  /** Expires at (unix seconds) */
  exp: number;
}

// ── Base64url helpers ───────────────────────────────────────────────────────

function base64urlEncode(data: string): string {
  return Buffer.from(data, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str: string): string {
  // Restore standard base64 padding
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

// ── Sign ────────────────────────────────────────────────────────────────────

const HEADER = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/**
 * Sign a JWT with HMAC-SHA256.
 *
 * @param payload - Must contain `sub` (candidateId) and `pid` (pipelineId).
 *                  `iat` and `exp` are set automatically.
 * @param secret  - HMAC signing secret (hex string from SESSION_TOKEN_SECRET).
 * @param ttlSeconds - Token lifetime in seconds (default: 7200 = 2 hours).
 */
export function signJwt(
  payload: Pick<JwtPayload, 'sub' | 'pid'>,
  secret: string,
  ttlSeconds: number = 7200,
): string {
  const now = Math.floor(Date.now() / 1000);

  const fullPayload: JwtPayload = {
    sub: payload.sub,
    pid: payload.pid,
    iat: now,
    exp: now + ttlSeconds,
  };

  const encodedPayload = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${HEADER}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${signature}`;
}

// ── Verify ──────────────────────────────────────────────────────────────────

/**
 * Verify a JWT's signature and expiry. Returns the payload if valid, null otherwise.
 *
 * @param token  - The full JWT string (header.payload.signature).
 * @param secret - The same HMAC secret used to sign.
 */
export function verifyJwt(token: string, secret: string): JwtPayload | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;

  // Verify signature
  const signingInput = `${header}.${payload}`;
  const expectedSignature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  if (signature !== expectedSignature) return null;

  // Decode payload
  let decoded: JwtPayload;
  try {
    decoded = JSON.parse(base64urlDecode(payload)) as JwtPayload;
  } catch {
    return null;
  }

  // Validate required fields
  if (
    typeof decoded.sub !== 'string' ||
    typeof decoded.pid !== 'string' ||
    typeof decoded.iat !== 'number' ||
    typeof decoded.exp !== 'number'
  ) {
    return null;
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (decoded.exp <= now) return null;

  return decoded;
}
