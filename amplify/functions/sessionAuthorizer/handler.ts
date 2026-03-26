/**
 * sessionAuthorizer — AppSync Lambda Authorizer
 *
 * Validates JWT session tokens issued by resolveToken.
 * Returns candidateId and pipelineId in resolverContext,
 * making them available to all downstream resolvers.
 *
 * Authorization: Called by AppSync before every Lambda-authorized request.
 */

import { verifyJwt } from '../_shared/jwt';

interface AuthorizerEvent {
  authorizationToken: string;
  requestContext: {
    apiId: string;
    accountId: string;
    requestId: string;
    queryString: string;
    operationName: string | null;
    variables: Record<string, unknown>;
  };
}

interface AuthorizerResponse {
  isAuthorized: boolean;
  resolverContext?: Record<string, string>;
  ttlOverride?: number;
}

const SECRET = process.env.SESSION_TOKEN_SECRET ?? '';

export async function handler(event: AuthorizerEvent): Promise<AuthorizerResponse> {
  let token = event.authorizationToken ?? '';

  // Strip "Bearer " prefix if present
  if (token.startsWith('Bearer ')) {
    token = token.slice(7);
  }

  if (!token) {
    return { isAuthorized: false };
  }

  if (!SECRET) {
    console.error('[sessionAuthorizer] SESSION_TOKEN_SECRET not configured');
    return { isAuthorized: false };
  }

  const payload = verifyJwt(token, SECRET);

  if (!payload) {
    return { isAuthorized: false };
  }

  return {
    isAuthorized: true,
    resolverContext: {
      candidateId: payload.sub,
      pipelineId: payload.pid,
    },
    ttlOverride: 300, // Cache authorization for 5 minutes
  };
}
