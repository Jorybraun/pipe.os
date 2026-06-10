import { createMiddleware } from 'hono/factory';
import { verifyToken } from '@clerk/backend';
import type { Env, Variables } from '../types';

/**
 * Clerk JWT authentication middleware for the meetings Worker.
 * Mirrors the auth pattern from workers/api — reads Bearer token from
 * Authorization header, verifies via Clerk, attaches userId to context.
 */
export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next): Promise<void> => {
    if (c.env.DEV_AUTH_BYPASS === 'true') {
      const bypassUserId = c.env.DEV_BYPASS_USER_ID;
      if (bypassUserId) {
        c.set('userId', bypassUserId);
        await next();
        return;
      }
    }

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

    try {
      const payload = await verifyToken(token, {
        secretKey: c.env.CLERK_SECRET_KEY,
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
