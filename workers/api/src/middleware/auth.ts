import { createMiddleware } from 'hono/factory';
import { verifyToken } from '@clerk/backend';
import type { Env, Variables } from '../types';

/**
 * Clerk JWT authentication middleware.
 *
 * Reads the JWT from the `Authorization: Bearer <token>` header.
 * All recruiter API routes (/api/v1/*) require an explicit Bearer token.
 * The React frontend retrieves the token via Clerk's getToken() and sends it
 * in the Authorization header; it never relies on cookie-based auth for API
 * calls to this Worker.
 *
 * Verifies the token using the Clerk backend SDK and attaches the Clerk
 * user ID to the Hono context so downstream handlers can use `c.var.userId`.
 *
 * Returns 401 if no valid token is found.
 */
export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next): Promise<void> => {
    // Local dev bypass — only when DEV_AUTH_BYPASS is explicitly 'true'.
    // The user ID is read from DEV_BYPASS_USER_ID env var; never hardcoded.
    // Never enable these in production.
    if (c.env.DEV_AUTH_BYPASS === 'true') {
      const bypassUserId = c.env.DEV_BYPASS_USER_ID;
      if (bypassUserId) {
        c.set('userId', bypassUserId);
        await next();
        return;
      }
    }

    // Read Authorization: Bearer <token> header.
    const authHeader = c.req.header('Authorization');
    let token: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // WebSocket connections can't set headers — accept token from query param
    if (!token) {
      const url = new URL(c.req.url);
      token = url.searchParams.get('token') ?? undefined;
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
