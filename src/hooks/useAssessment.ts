import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>({ authMode: 'apiKey' });

// ============================================================================
// Types
// ============================================================================

export type Candidate = Schema['Candidate']['type'];
export type Stage = Schema['Stage']['type'];
export type Assessment = Schema['Assessment']['type'];

export type StageSubmission = any; // Will be refined as we build the stages

interface UseAssessmentState {
  candidate: Candidate | null;
  stages: Stage[];
  currentStageIndex: number;
  isLoading: boolean;
  error: Error | null;
  isSubmitted: boolean;
}

interface UseAssessmentReturn extends UseAssessmentState {
  submitStage: (submission: StageSubmission) => Promise<void>;
  nextStage: () => void;
  reset: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useAssessment - Handles candidate-side data fetching and submission.
 *
 * This hook is used by the public /assess/:token route.
 * It does not require authentication and uses API Key auth mode.
 *
 * Logic:
 * 1. Find candidate by inviteToken.
 * 2. If candidate is already COMPLETED, set error.
 * 3. Fetch all stages for the candidate's pipeline.
 * 4. Update candidate status to IN_PROGRESS on first load.
 * 5. Provide submitStage to create Assessment records.
 */
export function useAssessment(inviteToken: string): UseAssessmentReturn {
  const [state, setState] = useState<UseAssessmentState>({
    candidate: null,
    stages: [],
    currentStageIndex: 0,
    isLoading: true,
    error: null,
    isSubmitted: false,
  });

  const fetchData = useCallback(async () => {
    if (!inviteToken) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: new Error('Missing invite token'),
      }));
      return;
    }

    try {
      // 1. Find candidate by token
      const { data: candidates, errors: candidateErrors } = await client.models.Candidate.list({
        filter: { inviteToken: { eq: inviteToken } },
      });

      if (candidateErrors && candidateErrors.length > 0) {
        throw new Error(candidateErrors[0].message);
      }

      if (!candidates || candidates.length === 0) {
        throw new Error('INVALID_TOKEN');
      }

      const candidate = candidates[0];

      // 2. Check if already completed
      if (candidate.status === 'COMPLETED') {
        setState((prev) => ({
          ...prev,
          candidate,
          isLoading: false,
          error: new Error('ALREADY_COMPLETED'),
        }));
        return;
      }

      // 3. Fetch stages for the pipeline
      const { data: stages, errors: stageErrors } = await client.models.Stage.list({
        filter: { pipelineId: { eq: candidate.pipelineId } },
      });

      if (stageErrors && stageErrors.length > 0) {
        throw new Error(stageErrors[0].message);
      }

      const sortedStages = [...stages].sort((a, b) => (a.order || 0) - (b.order || 0));

      // 4. Update status to IN_PROGRESS if it was INVITED
      if (candidate.status === 'INVITED') {
        await client.models.Candidate.update({
          id: candidate.id,
          status: 'IN_PROGRESS',
        });
      }

      setState((prev) => ({
        ...prev,
        candidate,
        stages: sortedStages,
        isLoading: false,
        error: null,
      }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('An unexpected error occurred');
      console.error('[useAssessment] Failed to load assessment data:', error);
      setState((prev) => ({ ...prev, isLoading: false, error }));
    }
  }, [inviteToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const submitStage = useCallback(
    async (submission: StageSubmission): Promise<void> => {
      const { candidate, stages, currentStageIndex } = state;
      if (!candidate || stages.length === 0) return;

      const currentStage = stages[currentStageIndex];

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        // Create Assessment record
        const { errors } = await client.models.Assessment.create({
          candidateId: candidate.id,
          stageId: currentStage.id,
          submission: JSON.stringify(submission),
          score: 0, // Score will be computed in Phase 2
          completedAt: new Date().toISOString(),
        });

        if (errors && errors.length > 0) {
          throw new Error(errors[0].message);
        }

        // If this was the last stage, mark candidate as COMPLETED
        if (currentStageIndex === stages.length - 1) {
          await client.models.Candidate.update({
            id: candidate.id,
            status: 'COMPLETED',
          });
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isSubmitted: true,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            currentStageIndex: prev.currentStageIndex + 1,
          }));
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to submit assessment');
        console.error('[useAssessment] Submission error:', error);
        setState((prev) => ({ ...prev, isLoading: false, error }));
      }
    },
    [state]
  );

  const nextStage = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStageIndex: Math.min(prev.currentStageIndex + 1, prev.stages.length - 1),
    }));
  }, []);

  const reset = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    submitStage,
    nextStage,
    reset,
  };
}
