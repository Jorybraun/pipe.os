/**
 * useStageDetail — fetches a stage and its challenges from the Cloudflare
 * Worker API.
 *
 * Calls GET /api/v1/stages/:stageId.
 * Uses Clerk's useAuth() to obtain the session JWT.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import type { StageDetail } from '../lib/api/types';
import { ApiError } from '../lib/api/types';

export interface UseStageDetailResult {
  stage: StageDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Fetches the stage identified by `stageId`, including its ordered challenge list.
 *
 * Returns null while loading or if the stage is not found.
 */
export function useStageDetail(stageId: string | undefined): UseStageDetailResult {
  const { getToken } = useClerkAuth();

  const [stage, setStage] = useState<StageDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStage = useCallback(async (): Promise<void> => {
    if (!stageId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const api = createApiClient({ getToken });

    try {
      const data = await api.get<StageDetail>(`/api/v1/stages/${stageId}`);
      setStage(data);
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[useStageDetail] API error:', err.code, err.message);
        setError(err.message);
      } else {
        const message =
          err instanceof Error ? err.message : 'Failed to load stage';
        console.error('[useStageDetail] Unexpected error:', message);
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [stageId, getToken]);

  useEffect(() => {
    void fetchStage();
  }, [fetchStage]);

  return {
    stage,
    isLoading,
    error,
    refetch: fetchStage,
  };
}
