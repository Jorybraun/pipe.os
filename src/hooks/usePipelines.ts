/**
 * usePipelines — fetches the authenticated user's pipeline list from the
 * Cloudflare Worker API.
 *
 * Uses Clerk's useAuth() hook to obtain the session JWT, then passes it to
 * the API client so the client itself stays Clerk-free.
 *
 * The hook fetches on mount and exposes a `refetch` function for manual
 * refresh (e.g. after a delete operation).
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import type { PipelineListItem, PipelinesResponse } from '../lib/api/types';
import { ApiError } from '../lib/api/types';

export interface UsePipelinesResult {
  pipelines: PipelineListItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function usePipelines(): UsePipelinesResult {
  const { getToken } = useClerkAuth();

  const [pipelines, setPipelines] = useState<PipelineListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPipelines = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    const api = createApiClient({ getToken });

    try {
      const data = await api.get<PipelinesResponse>('/api/v1/pipelines');
      setPipelines(data.pipelines);
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[usePipelines] API error:', err.code, err.message);
        setError(err.message);
      } else {
        const message = err instanceof Error ? err.message : 'Failed to load pipelines';
        console.error('[usePipelines] Unexpected error:', message);
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void fetchPipelines();
  }, [fetchPipelines]);

  return {
    pipelines,
    isLoading,
    error,
    refetch: fetchPipelines,
  };
}
