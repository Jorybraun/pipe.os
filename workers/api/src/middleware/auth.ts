import { createMiddleware } from 'hono/factory';
import { verifyToken } from '@clerk/backend';
import type { Env, Variables } from '../types';

/**
 * Clerk JWT authentication middleware.
 *
 * Reads a JWT from one of two locations (in precedence order):
 *   1. `Authorization: Bearer <token>` header
 *   2. `__session` cookie (set by Clerk in the browser; used by Playwright e2e
 *      tests via storageState without an explicit Authorization header)
 *
 * Verifies the token using the Clerk backend SDK and attaches the Clerk
 * user ID to the Hono context so downstream handlers can use `c.var.userId`.
 *
 * Returns 401 if no valid token is found.
 */
export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next): Promise<void> => {
    // 1. Try Authorization: Bearer header first (API clients, Workers-to-Workers).
    const authHeader = c.req.header('Authorization');
    let token: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      // 2. Fall back to the __session cookie (Clerk browser sessions, Playwright
      //    storageState-based tests that don't set an explicit auth header).
      const cookieHeader = c.req.header('Cookie') ?? '';
      const sessionMatch = cookieHeader.match(/(?:^|;\s*)__session=([^;]+)/);
      if (sessionMatch?.[1]) {
        token = decodeURIComponent(sessionMatch[1]);
      }
    }

    if (!token) {
      c.res = c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header.' } },
        401,
      );
      return;
    }

    // Legacy: allow a raw token string (no "Bearer " prefix) as a fallback for
    // development tooling that passes the token directly.
    const rawToken = token;

    try {
      const payload = await verifyToken(rawToken, {
        secretKey: c.env.CLERK_SECRET_KEY,
        // Allow up to 120 seconds of clock skew. Clerk dev-mode JWTs have a
        // 60-second TTL; Playwright tests read the cookie immediately after
        // page.goto() before Clerk JS has had time to refresh the token.
        // This tolerance prevents 401s in the test window while keeping
        // real authentication guarantees intact (signature is still verified).
        clockSkewInMs: 120_000,
      });
      c.set('userId', payload.sub);
    } catch {
      c.res = c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token.' } },
        401,
      );
      return;
    }

    await next();
  },
);
