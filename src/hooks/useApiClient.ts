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

/**
 * Returns a stable ApiClient instance bound to the current Clerk session.
 *
 * Usage:
 *   const api = useApiClient();
 *   const data = await api.get<MyType>('/api/v1/...');
 */
export function useApiClient(): ApiClient {
  const { getToken } = useClerkAuth();
  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  return useMemo(() => createApiClient({
    getToken: () => getTokenRef.current(),
  }), []);
}
