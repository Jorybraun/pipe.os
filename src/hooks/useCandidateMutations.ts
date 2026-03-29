/**
 * useCandidateMutations — candidate create and update operations.
 *
 * Wraps the Worker API candidate endpoints and provides typed mutation
 * functions so the OverviewPage can remain free of direct fetch calls.
 */

import { useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import type { CreateCandidateResponse } from '../lib/api/types';
import { ApiError } from '../lib/api/types';

export interface CreateCandidateInput {
  name: string;
  email: string;
  currentStageId?: string;
}

export interface UpdateCandidateInput {
  currentStageId?: string | null;
  status?: 'INVITED' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface UseCandidateMutationsResult {
  createCandidate: (
    pipelineId: string,
    input: CreateCandidateInput,
  ) => Promise<CreateCandidateResponse['candidate']>;
  updateCandidate: (
    candidateId: string,
    input: UpdateCandidateInput,
  ) => Promise<void>;
}

/**
 * Provides candidate mutation helpers bound to the current Clerk session.
 */
export function useCandidateMutations(): UseCandidateMutationsResult {
  const { getToken } = useClerkAuth();

  /**
   * Create a new candidate on the given pipeline.
   * The Worker generates a UUID invite token server-side.
   */
  const createCandidate = useCallback(
    async (
      pipelineId: string,
      input: CreateCandidateInput,
    ): Promise<CreateCandidateResponse['candidate']> => {
      const api = createApiClient({ getToken });
      try {
        const data = await api.post<CreateCandidateResponse>(
          `/api/v1/pipelines/${pipelineId}/candidates`,
          input,
        );
        return data.candidate;
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('[useCandidateMutations] createCandidate API error:', err.code, err.message);
        } else {
          console.error('[useCandidateMutations] createCandidate unexpected error:', err);
        }
        throw err;
      }
    },
    [getToken],
  );

  /**
   * Update a candidate's current stage or status.
   */
  const updateCandidate = useCallback(
    async (candidateId: string, input: UpdateCandidateInput): Promise<void> => {
      const api = createApiClient({ getToken });
      try {
        await api.patch<unknown>(`/api/v1/candidates/${candidateId}`, input);
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('[useCandidateMutations] updateCandidate API error:', err.code, err.message);
        } else {
          console.error('[useCandidateMutations] updateCandidate unexpected error:', err);
        }
        throw err;
      }
    },
    [getToken],
  );

  return { createCandidate, updateCandidate };
}
