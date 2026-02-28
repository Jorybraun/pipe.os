import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { sanitizeChallengeConfig } from '../lib/utils';

const client = generateClient<Schema>({ authMode: 'apiKey' });

// ============================================================================
// Types
// ============================================================================

export type Candidate = Schema['Candidate']['type'];
export type Stage = Schema['Stage']['type'];
export type Assessment = Schema['Assessment']['type'];

export interface CodeReviewSubmission {
  annotations: Record<string, any[]>;
}

export interface QuizSubmission {
  answers: Record<string, number>;
}

export type StageSubmission = CodeReviewSubmission | QuizSubmission | Record<string, any>;

export interface StageWithChallenges {
  id: string;
  order: number | null;
  timeLimit?: number | null;
  type?: string | null;
  mode?: 'ASYNC' | 'LIVE_VIDEO' | null;
  // Amplify JSON fields return a broad union; cast to Record at point of use
  videoConfig?: string | number | boolean | object | unknown[] | null;
  challenges: {
    id: string;
    type: string | null;
    title: string;
    instructions: string | null;
    config: unknown;
    order: number | null;
    codeArtifact: {
      id: string;
      code: string | null;
      language: string | null;
      title: string | null;
      groundTruth: unknown;
    } | null;
  }[];
}

interface UseAssessmentState {
  candidate: Candidate | null;
  stages: StageWithChallenges[];
  currentStageIndex: number;
  currentChallengeIndex: number;
  isLoading: boolean;
  error: Error | null;
  isSubmitted: boolean;
}

interface UseAssessmentReturn extends UseAssessmentState {
  submitChallenge: (submission: StageSubmission) => Promise<void>;
  nextChallenge: () => void;
  reset: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useAssessment - Handles candidate-side data fetching and submission for challenges.
 */
export function useAssessment(inviteToken: string): UseAssessmentReturn {
  const [state, setState] = useState<UseAssessmentState>({
    candidate: null,
    stages: [],
    currentStageIndex: 0,
    currentChallengeIndex: 0,
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

    try {
      // 1. Find candidate by token
      const { data: candidates } = await client.models.Candidate.list({
        filter: { inviteToken: { eq: inviteToken } },
      });

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

      // 3. Fetch stages and nested challenges
      const { data: stages } = await client.models.Stage.list({
        filter: { pipelineId: { eq: candidate.pipelineId } },
        selectionSet: [
          'id',
          'title',
          'order',
          'timeLimit',
          'mode',
          'videoConfig',
          'challenges.id',
          'challenges.type',
          'challenges.title',
          'challenges.instructions',
          'challenges.config',
          'challenges.order',
          'challenges.codeArtifact.id',
          'challenges.codeArtifact.code',
          'challenges.codeArtifact.language',
          'challenges.codeArtifact.title',
          'challenges.codeArtifact.groundTruth'
        ]
      });

      const sortedStages = [...stages]
        .filter(s => s !== null)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

      // Sort challenges within each stage and sanitize configs
      const sanitizedStages: StageWithChallenges[] = sortedStages.map(stage => ({
        ...stage,
        challenges: (stage.challenges || [])
          .filter(c => c !== null)
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map(challenge => {
            const parsedConfig = typeof challenge.config === 'string' 
              ? JSON.parse(challenge.config) 
              : challenge.config;
            
            return {
              ...challenge,
              config: sanitizeChallengeConfig(parsedConfig, challenge.type || '')
            };
          })
      }));

      // 4. Update status to IN_PROGRESS if it was INVITED
      if (candidate.status === 'INVITED') {
        try {
          await client.models.Candidate.update({
            id: candidate.id,
            status: 'IN_PROGRESS',
          });
        } catch (updateErr) {
          console.warn('[useAssessment] Status update failed (non-fatal):', updateErr);
        }
      }

      setState((prev) => ({
        ...prev,
        candidate,
        stages: sanitizedStages,
        isLoading: false,
        error: null,
      }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('An unexpected error occurred');
      console.error('[useAssessment] ❌ Error:', error);
      setState((prev) => ({ ...prev, isLoading: false, error }));
    }
  }, [inviteToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const submitChallenge = useCallback(
    async (submission: StageSubmission): Promise<void> => {
      const { candidate, stages, currentStageIndex, currentChallengeIndex } = state;
      if (!candidate || stages.length === 0) return;

      const currentStage = stages[currentStageIndex];
      const challenges = currentStage.challenges || [];
      const currentChallenge = challenges[currentChallengeIndex];

      if (!currentChallenge) return;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        // Create Assessment record
        const { data: assessment } = await client.models.Assessment.create({
          candidateId: candidate.id,
          challengeId: currentChallenge.id,
          submission: JSON.stringify(submission),
          score: 0,
          completedAt: new Date().toISOString(),
        });

        if (assessment) {
          // Trigger scoring agent Lambda function
          try {
            await client.mutations.scoreAssessment({
              assessmentId: assessment.id
            });
            console.log(`[useAssessment] Triggered scoringAgent for assessment ${assessment.id}`);
          } catch (lambdaErr) {
            console.error(`[useAssessment] Failed to trigger scoringAgent for assessment ${assessment.id}:`, lambdaErr);
          }
        }

        // Determine next step
        const isLastChallengeInStage = currentChallengeIndex === challenges.length - 1;
        const isLastStage = currentStageIndex === stages.length - 1;

        if (isLastChallengeInStage && isLastStage) {
          // Final submission
          await client.models.Candidate.update({
            id: candidate.id,
            status: 'COMPLETED',
          });
          setState((prev) => ({ ...prev, isLoading: false, isSubmitted: true }));
        } else if (isLastChallengeInStage) {
          // Move to next stage
          setState((prev) => ({
            ...prev,
            isLoading: false,
            currentStageIndex: prev.currentStageIndex + 1,
            currentChallengeIndex: 0
          }));
        } else {
          // Move to next challenge in same stage
          setState((prev) => ({
            ...prev,
            isLoading: false,
            currentChallengeIndex: prev.currentChallengeIndex + 1
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

  const nextChallenge = useCallback(() => {
    // Handled by submitChallenge
  }, []);

  const reset = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    submitChallenge,
    nextChallenge,
    reset,
  };
}
