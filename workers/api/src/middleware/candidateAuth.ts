/**
 * Candidate JWT authentication middleware.
 *
 * Verifies session JWTs issued by resolve-token.
 * Extracts candidateId and pipelineId into Hono context variables.
 *
 * Reads JWT from Authorization: Bearer header.
 */

import { createMiddleware } from 'hono/factory';
import { verifyJwt } from '../lib/jwt';
import type { Env } from '../types';

export interface CandidateVariables {
  candidateId: string;
  pipelineId: string;
}

export const candidateAuth = createMiddleware<{
  Bindings: Env;
  Variables: CandidateVariables;
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
    console.error('[candidateAuth] SESSION_TOKEN_SECRET not configured');
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

  c.set('candidateId', payload.sub);
  c.set('pipelineId', payload.pid);

  await next();
});
