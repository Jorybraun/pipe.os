import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signJwt } from '../_shared/jwt';

const TEST_SECRET = 'test-secret-for-authorizer-unit-tests-only-not-real';

function makeEvent(token: string) {
  return {
    authorizationToken: token,
    requestContext: {
      apiId: 'test-api',
      accountId: '123456789',
      requestId: 'req-1',
      queryString: 'query { test }',
      operationName: null,
      variables: {},
    },
  };
}

describe('sessionAuthorizer handler', () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.SESSION_TOKEN_SECRET = TEST_SECRET;
  });

  it('returns isAuthorized:true with correct resolverContext for valid JWT', async () => {
    const token = signJwt({ sub: 'cand-1', pid: 'pipe-1' }, TEST_SECRET, 3600);
    const { handler } = await import('./handler');

    const result = await handler(makeEvent(token));

    expect(result.isAuthorized).toBe(true);
    expect(result.resolverContext).toEqual({
      candidateId: 'cand-1',
      pipelineId: 'pipe-1',
    });
  });

  it('returns isAuthorized:false for expired JWT', async () => {
    // Sign a token in the past
    vi.spyOn(Date, 'now').mockReturnValueOnce(Date.now() - 10_000_000);
    const token = signJwt({ sub: 'cand-1', pid: 'pipe-1' }, TEST_SECRET, 3600);
    vi.restoreAllMocks();

    const { handler } = await import('./handler');
    const result = await handler(makeEvent(token));

    expect(result.isAuthorized).toBe(false);
    expect(result.resolverContext).toBeUndefined();
  });

  it('returns isAuthorized:false for missing token', async () => {
    const { handler } = await import('./handler');
    const result = await handler(makeEvent(''));

    expect(result.isAuthorized).toBe(false);
  });

  it('returns isAuthorized:false for tampered token', async () => {
    const token = signJwt({ sub: 'cand-1', pid: 'pipe-1' }, TEST_SECRET);
    const parts = token.split('.');
    // Flip a character in the signature
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}X`;

    const { handler } = await import('./handler');
    const result = await handler(makeEvent(tampered));

    expect(result.isAuthorized).toBe(false);
  });

  it('handles Bearer prefix correctly', async () => {
    const token = signJwt({ sub: 'cand-2', pid: 'pipe-2' }, TEST_SECRET, 3600);
    const { handler } = await import('./handler');

    const result = await handler(makeEvent(`Bearer ${token}`));

    expect(result.isAuthorized).toBe(true);
    expect(result.resolverContext).toEqual({
      candidateId: 'cand-2',
      pipelineId: 'pipe-2',
    });
  });

  it('returns isAuthorized:false when SECRET is not configured', async () => {
    process.env.SESSION_TOKEN_SECRET = '';
    const token = signJwt({ sub: 'cand-1', pid: 'pipe-1' }, TEST_SECRET);

    const { handler } = await import('./handler');
    const result = await handler(makeEvent(token));

    expect(result.isAuthorized).toBe(false);
  });

  it('sets ttlOverride to 300 seconds', async () => {
    const token = signJwt({ sub: 'cand-1', pid: 'pipe-1' }, TEST_SECRET, 3600);
    const { handler } = await import('./handler');

    const result = await handler(makeEvent(token));

    expect(result.ttlOverride).toBe(300);
  });
});
