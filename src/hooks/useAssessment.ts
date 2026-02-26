import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

// ============================================================================
// Types
// ============================================================================

export type Candidate = Schema['Candidate']['type'];
export type Stage = Schema['Stage']['type'];
export type Assessment = Schema['Assessment']['type'];

export type StageSubmission = any;

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
      console.error('[useAssessment] CRITICAL: No token provided');
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: new Error('Missing invite token'),
      }));
      return;
    }

    console.log('[useAssessment] 1. START_FETCH for token:', inviteToken);

    try {
      // 1. Find candidate by token
      console.log('[useAssessment] 2. LOOKING_UP_CANDIDATE...');
      const { data: candidates, errors: candidateErrors } = await client.models.Candidate.list({
        filter: { inviteToken: { eq: inviteToken } },
      }, { authMode: 'apiKey' });

      if (candidateErrors && candidateErrors.length > 0) {
        console.error('[useAssessment] ❌ Candidate lookup failed:', candidateErrors);
        throw new Error(candidateErrors[0].message);
      }

      if (!candidates || candidates.length === 0) {
        console.error('[useAssessment] ❌ Token not found in database');
        throw new Error('INVALID_TOKEN');
      }

      const candidate = candidates[0];
      console.log('[useAssessment] 3. FOUND_CANDIDATE:', candidate.name, '| Status:', candidate.status);

      // 2. Check if already completed
      if (candidate.status === 'COMPLETED') {
        console.warn('[useAssessment] ⚠️ Candidate already COMPLETED');
        setState((prev) => ({
          ...prev,
          candidate,
          isLoading: false,
          error: new Error('ALREADY_COMPLETED'),
        }));
        return;
      }

      // 3. Fetch stages for the pipeline
      console.log('[useAssessment] 4. FETCHING_STAGES for pipeline:', candidate.pipelineId);
      const { data: stages, errors: stageErrors } = await client.models.Stage.list({
        filter: { pipelineId: { eq: candidate.pipelineId } },
      }, { authMode: 'apiKey' });

      if (stageErrors && stageErrors.length > 0) {
        console.error('[useAssessment] ❌ Stage fetch failed:', stageErrors);
        throw new Error(stageErrors[0].message);
      }

      const sortedStages = [...stages].sort((a, b) => (a.order || 0) - (b.order || 0));
      console.log('[useAssessment] 5. LOADED_STAGES:', sortedStages.length);

      // 4. Update status to IN_PROGRESS if it was INVITED
      if (candidate.status === 'INVITED') {
        console.log('[useAssessment] 6. UPDATING_STATUS -> IN_PROGRESS...');
        try {
          await client.models.Candidate.update({
            id: candidate.id,
            status: 'IN_PROGRESS',
          }, { authMode: 'apiKey' });
          console.log('[useAssessment] 7. STATUS_UPDATE_SUCCESS');
        } catch (updateErr) {
          console.warn('[useAssessment] ⚠️ Status update failed (non-fatal):', updateErr);
          // We continue anyway so the candidate can still see their assessment
        }
      }

      console.log('[useAssessment] 8. FETCH_COMPLETE_SUCCESS');
      setState((prev) => ({
        ...prev,
        candidate,
        stages: sortedStages,
        isLoading: false,
        error: null,
      }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('An unexpected error occurred');
      console.error('[useAssessment] ❌ FATAL_HOOK_ERROR:', error);
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
      console.log('[useAssessment] SUBMIT_STAGE:', currentStage.type, '| Index:', currentStageIndex);

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        // Create Assessment record
        const { errors } = await client.models.Assessment.create({
          candidateId: candidate.id,
          stageId: currentStage.id,
          submission: JSON.stringify(submission),
          score: 0,
          completedAt: new Date().toISOString(),
        }, { authMode: 'apiKey' });

        if (errors && errors.length > 0) {
          console.error('[useAssessment] ❌ Assessment creation failed:', errors);
          throw new Error(errors[0].message);
        }

        console.log('[useAssessment] ✅ Assessment created');

        // If this was the last stage, mark candidate as COMPLETED
        if (currentStageIndex === stages.length - 1) {
          console.log('[useAssessment] FINALIZING_CANDIDATE...');
          await client.models.Candidate.update({
            id: candidate.id,
            status: 'COMPLETED',
          }, { authMode: 'apiKey' });
          console.log('[useAssessment] ✅ Candidate COMPLETED');
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isSubmitted: true,
          }));
        } else {
          console.log('[useAssessment] ADVANCING_STAGE');
          setState((prev) => ({
            ...prev,
            isLoading: false,
            currentStageIndex: prev.currentStageIndex + 1,
          }));
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to submit assessment');
        console.error('[useAssessment] ❌ SUBMISSION_ERROR:', error);
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
