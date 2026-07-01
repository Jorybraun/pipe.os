/**
 * useApiClient
 *
 * Returns a stable ApiClient bound to the current Clerk session token.
 * Wraps createApiClient so hooks don't need to import useAuth directly.
 *
 * The returned client is re-created whenever the Clerk auth object changes
 * (which is rare — Clerk tokens last ~60 seconds and are refreshed silently).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import type { ApiClient } from '../lib/api/client';
import { isDevProxyRecruiterAuthBypassEnabled } from '../lib/auth/devProxyAuth';

const TOKEN_CACHE_TTL_MS = 45_000;

interface TokenCache {
  token: string | null;
  expiresAt: number;
  inFlight: Promise<string | null> | null;
}

let sharedTokenUserId: string | null | undefined;
let sharedTokenCache: TokenCache = {
  token: null,
  expiresAt: 0,
  inFlight: null,
};

function resetSharedTokenCache(): void {
  sharedTokenCache = {
    token: null,
    expiresAt: 0,
    inFlight: null,
  };
}

function syncSharedTokenUser(userId: string | null | undefined): void {
  if (sharedTokenUserId === userId) return;
  sharedTokenUserId = userId;
  resetSharedTokenCache();
}

async function resolveSharedToken(
  getToken: () => Promise<string | null> | string | null,
  userId: string | null | undefined,
): Promise<string | null> {
  syncSharedTokenUser(userId);
  const cached = sharedTokenCache;
  if (cached.token && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  if (cached.inFlight) {
    return cached.inFlight;
  }

  const inFlight = Promise.resolve(getToken()).then(
    (token) => {
      sharedTokenCache = {
        token,
        expiresAt: token ? Date.now() + TOKEN_CACHE_TTL_MS : 0,
        inFlight: null,
      };
      return token;
    },
    (error: unknown) => {
      resetSharedTokenCache();
      throw error;
    },
  );
  sharedTokenCache = {
    token: cached.token,
    expiresAt: cached.expiresAt,
    inFlight,
  };
  return inFlight;
}

export function warmApiClientToken(
  getToken: () => Promise<string | null> | string | null,
  userId: string | null | undefined,
): void {
  if (isDevProxyRecruiterAuthBypassEnabled()) return;
  void resolveSharedToken(getToken, userId).catch(() => undefined);
}

/**
 * Returns a stable ApiClient instance bound to the current Clerk session.
 *
 * Usage:
 *   const api = useApiClient();
 *   const data = await api.get<MyType>('/api/v1/...');
 */
export function useApiClient(): ApiClient {
  const bypassClerkToken = isDevProxyRecruiterAuthBypassEnabled();
  const { getToken, userId } = useClerkAuth();
  const getTokenRef = useRef(getToken);
  const userIdRef = useRef(userId);

  useEffect(() => {
    if (!bypassClerkToken) {
      getTokenRef.current = getToken;
      userIdRef.current = userId;
      syncSharedTokenUser(userId);
    }
  }, [bypassClerkToken, getToken, userId]);

  return useMemo(() => {
    if (bypassClerkToken) {
      return createApiClient({ getToken: () => null });
    }
    return createApiClient({
      getToken: () => resolveSharedToken(() => getTokenRef.current(), userIdRef.current),
    });
  }, [bypassClerkToken]);
}
