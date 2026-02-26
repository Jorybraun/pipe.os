import { useState, useCallback } from 'react';
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../../amplify/data/resource';
import { generateInviteToken } from '../lib/generateInviteToken';

const client = generateClient<Schema>();

// ============================================================================
// Types
// ============================================================================

export interface CandidateCreateInput {
  pipelineId: string;
  name: string;
  email: string;
}

interface UseCandidateCreateState {
  isSubmitting: boolean;
  error: Error | null;
  createdId: string | null;
}

interface UseCandidateCreateReturn extends UseCandidateCreateState {
  create: (input: CandidateCreateInput) => Promise<string | null>;
  reset: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useCandidateCreate - Handles candidate creation with an automatically generated inviteToken.
 */
export function useCandidateCreate(): UseCandidateCreateReturn {
  const [state, setState] = useState<UseCandidateCreateState>({
    isSubmitting: false,
    error: null,
    createdId: null,
  });

  const create = useCallback(
    async (input: CandidateCreateInput): Promise<string | null> => {
      setState({ isSubmitting: true, error: null, createdId: null });

      try {
        const { data, errors } = await client.models.Candidate.create({
          pipelineId: input.pipelineId,
          name: input.name.trim(),
          email: input.email.trim(),
          inviteToken: generateInviteToken(),
          status: 'INVITED',
        });

        if (errors && errors.length > 0) {
          const err = new Error(errors[0].message ?? 'Failed to create candidate');
          console.error('[useCandidateCreate] GraphQL errors:', errors);
          setState({ isSubmitting: false, error: err, createdId: null });
          return null;
        }

        if (!data?.id) {
          const err = new Error('Candidate was created but no ID was returned');
          console.error('[useCandidateCreate] No ID returned from create mutation');
          setState({ isSubmitting: false, error: err, createdId: null });
          return null;
        }

        console.log('[useCandidateCreate] Candidate created:', data.id);
        setState({ isSubmitting: false, error: null, createdId: data.id });
        return data.id;
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('An unexpected error occurred');
        console.error('[useCandidateCreate] Unexpected error:', error);
        setState({ isSubmitting: false, error, createdId: null });
        return null;
      }
    },
    []
  );

  const reset = useCallback(() => {
    setState({ isSubmitting: false, error: null, createdId: null });
  }, []);

  return {
    ...state,
    create,
    reset,
  };
}
