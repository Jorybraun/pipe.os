/**
 * useChallengeMutations — write operations for challenges.
 *
 * Exposes:
 *   createChallenge  — POST /api/v1/stages/:stageId/challenges
 *   deleteChallenge  — DELETE /api/v1/challenges/:challengeId
 *   reorderChallenges — PATCH /api/v1/stages/:stageId/challenges/reorder
 *
 * Uses Clerk's useAuth() for JWT injection.
 */

import { useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import type { ChallengeItem, CreateChallengeRequest } from '../lib/api/types';
import { ApiError } from '../lib/api/types';

export interface ReorderItem {
  id: string;
  order: number;
}

export interface UseChallengeMutationsResult {
  createChallenge: (
    stageId: string,
    payload: CreateChallengeRequest,
  ) => Promise<ChallengeItem>;
  deleteChallenge: (challengeId: string) => Promise<void>;
  reorderChallenges: (
    stageId: string,
    challenges: ReorderItem[],
  ) => Promise<void>;
}

/**
 * Returns mutation helpers for challenge write operations.
 */
export function useChallengeMutations(): UseChallengeMutationsResult {
  const { getToken } = useClerkAuth();

  const createChallenge = useCallback(
    async (stageId: string, payload: CreateChallengeRequest): Promise<ChallengeItem> => {
      const api = createApiClient({ getToken });

      try {
        return await api.post<ChallengeItem>(
          `/api/v1/stages/${stageId}/challenges`,
          payload,
        );
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('[useChallengeMutations] createChallenge API error:', err.code, err.message);
          throw err;
        }
        const message = err instanceof Error ? err.message : 'Failed to create challenge';
        console.error('[useChallengeMutations] createChallenge unexpected error:', message);
        throw new Error(message);
      }
    },
    [getToken],
  );

  const deleteChallenge = useCallback(
    async (challengeId: string): Promise<void> => {
      const api = createApiClient({ getToken });

      try {
        await api.del(`/api/v1/challenges/${challengeId}`);
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('[useChallengeMutations] deleteChallenge API error:', err.code, err.message);
          throw err;
        }
        const message = err instanceof Error ? err.message : 'Failed to delete challenge';
        console.error('[useChallengeMutations] deleteChallenge unexpected error:', message);
        throw new Error(message);
      }
    },
    [getToken],
  );

  const reorderChallenges = useCallback(
    async (stageId: string, challenges: ReorderItem[]): Promise<void> => {
      const api = createApiClient({ getToken });

      try {
        await api.patch<{ updated: number }>(
          `/api/v1/stages/${stageId}/challenges/reorder`,
          { challenges },
        );
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('[useChallengeMutations] reorderChallenges API error:', err.code, err.message);
          throw err;
        }
        const message = err instanceof Error ? err.message : 'Failed to reorder challenges';
        console.error('[useChallengeMutations] reorderChallenges unexpected error:', message);
        throw new Error(message);
      }
    },
    [getToken],
  );

  return { createChallenge, deleteChallenge, reorderChallenges };
}
