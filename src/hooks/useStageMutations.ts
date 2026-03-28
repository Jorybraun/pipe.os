/**
 * useStageMutations — write operations for a stage.
 *
 * Exposes `updateStage` which calls PATCH /api/v1/stages/:stageId.
 * Uses Clerk's useAuth() for JWT injection.
 */

import { useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import type { StageDetail, UpdateStageRequest } from '../lib/api/types';
import { ApiError } from '../lib/api/types';

export interface UseStageMutationsResult {
  updateStage: (
    stageId: string,
    payload: UpdateStageRequest,
  ) => Promise<StageDetail>;
}

/**
 * Returns mutation helpers for stage write operations.
 */
export function useStageMutations(): UseStageMutationsResult {
  const { getToken } = useClerkAuth();

  const updateStage = useCallback(
    async (stageId: string, payload: UpdateStageRequest): Promise<StageDetail> => {
      const api = createApiClient({ getToken });

      try {
        return await api.patch<StageDetail>(`/api/v1/stages/${stageId}`, payload);
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('[useStageMutations] updateStage API error:', err.code, err.message);
          throw err;
        }
        const message = err instanceof Error ? err.message : 'Failed to update stage';
        console.error('[useStageMutations] updateStage unexpected error:', message);
        throw new Error(message);
      }
    },
    [getToken],
  );

  return { updateStage };
}
