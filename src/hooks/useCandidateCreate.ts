/**
 * useCandidateCreate — creates a candidate via the Worker API.
 *
 * Replaces the Amplify version. The invite token is generated server-side
 * in the Worker so it never touches the frontend.
 */

import { useState, useCallback } from 'react';
import { useClerkAuth } from '../providers/clerk';
import { createApiClient } from '../lib/api/client';
import type { CreateCandidateResponse } from '../lib/api/types';

export interface CandidateCreateInput {
  pipelineId: string;
  name: string;
  email: string;
  currentStageId?: string | null;
  skipEmail?: boolean;
}

export interface CandidateCreateResult {
  id: string;
  inviteToken: string;
  scheduledInterview?: {
    id: string;
    status: string;
    meetingUrl: string | null;
  } | null;
}

interface UseCandidateCreateState {
  isSubmitting: boolean;
  error: Error | null;
  createdId: string | null;
  inviteToken: string | null;
}

interface UseCandidateCreateReturn extends UseCandidateCreateState {
  create: (input: CandidateCreateInput) => Promise<CandidateCreateResult | null>;
  reset: () => void;
}

/**
 * useCandidateCreate - Handles candidate creation via the Worker API.
 */
export function useCandidateCreate(): UseCandidateCreateReturn {
  const { getToken } = useClerkAuth();

  const [state, setState] = useState<UseCandidateCreateState>({
    isSubmitting: false,
    error: null,
    createdId: null,
    inviteToken: null,
  });

  const create = useCallback(
    async (input: CandidateCreateInput): Promise<CandidateCreateResult | null> => {
      setState({ isSubmitting: true, error: null, createdId: null, inviteToken: null });

      try {
        const api = createApiClient({ getToken });
        const data = await api.post<CreateCandidateResponse>(
          `/api/v1/pipelines/${input.pipelineId}/candidates`,
          {
            name: input.name.trim(),
            email: input.email.trim(),
            ...(input.currentStageId ? { currentStageId: input.currentStageId } : {}),
            ...(input.skipEmail ? { skipEmail: true } : {}),
          },
        );

        const candidateId = data.candidate.id;
        const token = data.candidate.inviteToken;
        console.log('[useCandidateCreate] Candidate created:', candidateId);
        setState({ isSubmitting: false, error: null, createdId: candidateId, inviteToken: token });
        return {
          id: candidateId,
          inviteToken: token,
          scheduledInterview: data.candidate.scheduledInterview ?? null,
        };
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('An unexpected error occurred');
        console.error('[useCandidateCreate] Unexpected error:', error);
        setState({ isSubmitting: false, error, createdId: null, inviteToken: null });
        return null;
      }
    },
    [getToken],
  );

  const reset = useCallback(() => {
    setState({ isSubmitting: false, error: null, createdId: null, inviteToken: null });
  }, []);

  return {
    ...state,
    create,
    reset,
  };
}
