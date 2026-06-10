/**
 * Participant JWT authentication middleware (ADR-028).
 *
 * Verifies session JWTs issued to invited team members for role discovery.
 * Extracts participantId and roleContextId into Hono context variables.
 *
 * JWT payload: { sub: participantId, pid: roleContextId }
 * Reuses the same signJwt/verifyJwt as candidateAuth.
 */

import { createMiddleware } from 'hono/factory';
import { verifyJwt } from '../lib/jwt';
import type { Env } from '../types';

export interface ParticipantVariables {
  participantId: string;
  roleContextId: string;
}

export const participantAuth = createMiddleware<{
  Bindings: Env;
  Variables: ParticipantVariables;
}>(async (c, next): Promise<void> => {
  const authHeader = c.req.header('Authorization');
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) {
    c.res = c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Missing session token.' } },
      401,
    );
    return;
  }

  const secret = c.env.SESSION_TOKEN_SECRET;
  if (!secret) {
    console.error('[participantAuth] SESSION_TOKEN_SECRET not configured');
    c.res = c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Auth not configured.' } },
      500,
    );
    return;
  }

  const payload = await verifyJwt(token, secret);
  if (!payload) {
    c.res = c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired session token.' } },
      401,
    );
    return;
  }

  // sub = participantId, pid = roleContextId (always non-null for participants)
  c.set('participantId', payload.sub);
  c.set('roleContextId', payload.pid ?? '');

  await next();
});
