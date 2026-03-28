import { createMiddleware } from 'hono/factory';
import { verifyToken } from '@clerk/backend';
import type { Env, Variables } from '../types';

/**
 * Clerk JWT authentication middleware.
 *
 * Reads the `Authorization: Bearer <token>` header, verifies the token using
 * the Clerk backend SDK's top-level `verifyToken`, and attaches the Clerk
 * user ID to the Hono context so downstream handlers can use `c.var.userId`.
 *
 * Returns 401 if the header is missing or the token is invalid.
 */
export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next): Promise<void> => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      c.res = c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header.' } },
        401,
      );
      return;
    }

    const token = authHeader.slice(7); // Strip "Bearer "

    try {
      const payload = await verifyToken(token, {
        secretKey: c.env.CLERK_SECRET_KEY,
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
