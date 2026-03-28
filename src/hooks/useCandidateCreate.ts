import { useState, useCallback } from "react";
import { useData } from "../providers";
import type { DataProviderFactory } from "../providers";
import { generateInviteToken } from "../lib/generateInviteToken";

// ============================================================================
// Types
// ============================================================================

export interface CandidateCreateInput {
  pipelineId: string;
  name: string;
  email: string;
  currentStageId?: string;
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
  const factory: DataProviderFactory = useData();

  const [state, setState] = useState<UseCandidateCreateState>({
    isSubmitting: false,
    error: null,
    createdId: null,
  });

  const create = useCallback(
    async (input: CandidateCreateInput): Promise<string | null> => {
      setState({ isSubmitting: true, error: null, createdId: null });

      try {
        const client = factory.createClient();
        const { data, errors } = await client.models.Candidate.create({
          pipelineId: input.pipelineId,
          name: input.name.trim(),
          email: input.email.trim(),
          inviteToken: generateInviteToken(),
          status: "INVITED",
          currentStageId: input.currentStageId ?? null,
        });

        if (errors && errors.length > 0) {
          const err = new Error(
            errors[0]?.message ?? "Failed to create candidate",
          );
          console.error("[useCandidateCreate] GraphQL errors:", errors);
          setState({ isSubmitting: false, error: err, createdId: null });
          return null;
        }

        if (!data) {
          const err = new Error("Candidate was created but no data was returned");
          console.error(
            "[useCandidateCreate] No data returned from create mutation",
          );
          setState({ isSubmitting: false, error: err, createdId: null });
          return null;
        }

        const record = data as Record<string, unknown>;
        if (!record['id']) {
          const err = new Error("Candidate was created but no ID was returned");
          console.error(
            "[useCandidateCreate] No ID returned from create mutation",
          );
          setState({ isSubmitting: false, error: err, createdId: null });
          return null;
        }

        const candidateId = record['id'] as string;
        console.log("[useCandidateCreate] Candidate created:", candidateId);
        setState({ isSubmitting: false, error: null, createdId: candidateId });
        return candidateId;
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error("An unexpected error occurred");
        console.error("[useCandidateCreate] Unexpected error:", error);
        setState({ isSubmitting: false, error, createdId: null });
        return null;
      }
    },
    [factory],
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
