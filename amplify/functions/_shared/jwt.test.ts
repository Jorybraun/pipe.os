import { describe, it, expect, vi, afterEach } from 'vitest';
import { signJwt, verifyJwt, type JwtPayload } from './jwt';

const SECRET = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

const PAYLOAD = { sub: 'cand-123', pid: 'pipe-456' };

describe('JWT library', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── signJwt ─────────────────────────────────────────────────────────────

  it('produces a valid 3-part token', () => {
    const token = signJwt(PAYLOAD, SECRET);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    // Each part is non-empty
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0));
  });

  it('sets exp to iat + ttlSeconds', () => {
    const token = signJwt(PAYLOAD, SECRET, 3600);
    const payloadPart = token.split('.')[1];
    const decoded = JSON.parse(
      Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as JwtPayload;

    expect(decoded.exp).toBe(decoded.iat + 3600);
  });

  it('defaults TTL to 7200 seconds (2 hours)', () => {
    const token = signJwt(PAYLOAD, SECRET);
    const payloadPart = token.split('.')[1];
    const decoded = JSON.parse(
      Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as JwtPayload;

    expect(decoded.exp).toBe(decoded.iat + 7200);
  });

  // ── verifyJwt ───────────────────────────────────────────────────────────

  it('round-trips: sign then verify returns identical payload', () => {
    const token = signJwt(PAYLOAD, SECRET, 3600);
    const result = verifyJwt(token, SECRET);

    expect(result).not.toBeNull();
    expect(result!.sub).toBe('cand-123');
    expect(result!.pid).toBe('pipe-456');
    expect(result!.exp).toBe(result!.iat + 3600);
  });

  it('returns null for an expired token', () => {
    // Mock Date.now to be in the past when signing, then restore for verification
    const pastTime = (Date.now() - 10_000_000); // ~2.7 hours ago
    vi.spyOn(Date, 'now').mockReturnValueOnce(pastTime);

    const token = signJwt(PAYLOAD, SECRET, 3600); // Expired ~1.7h ago
    vi.restoreAllMocks(); // Restore so verifyJwt uses real time

    const result = verifyJwt(token, SECRET);
    expect(result).toBeNull();
  });

  it('returns null for a tampered payload', () => {
    const token = signJwt(PAYLOAD, SECRET);
    const parts = token.split('.');

    // Tamper with the payload (change candidateId)
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: 'ATTACKER', pid: 'pipe-456', iat: 0, exp: 9999999999 }),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const result = verifyJwt(tamperedToken, SECRET);
    expect(result).toBeNull();
  });

  it('returns null for a wrong secret', () => {
    const token = signJwt(PAYLOAD, SECRET);
    const result = verifyJwt(token, 'wrong-secret-entirely');
    expect(result).toBeNull();
  });

  it('returns null for malformed tokens', () => {
    expect(verifyJwt('', SECRET)).toBeNull();
    expect(verifyJwt('only-one-part', SECRET)).toBeNull();
    expect(verifyJwt('two.parts', SECRET)).toBeNull();
    expect(verifyJwt('..', SECRET)).toBeNull();
    expect(verifyJwt(null as unknown as string, SECRET)).toBeNull();
    expect(verifyJwt(undefined as unknown as string, SECRET)).toBeNull();
  });
});
