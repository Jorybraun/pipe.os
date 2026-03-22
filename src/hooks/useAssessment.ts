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
  annotations: Record<string, unknown[]>;
}

export interface QuizSubmission {
  answers: Record<string, number>;
}

export type StageSubmission = CodeReviewSubmission | QuizSubmission | Record<string, unknown>;

export interface StageWithChallenges {
  id: string;
  title?: string | null;
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
    cachedDiffJson: unknown;
    githubPrTitle: string | null;
    githubRepoUrl: string | null;
    githubPrNumber: number | null;
    githubPrDescription: string | null;
    cachedMetadata: unknown;
  }[];
}

export interface FollowUpQuestion {
  id: string;
  type: 'SHORT_ANSWER';
  question: string;
  context: string;
}

interface UseAssessmentState {
  candidate: Candidate | null;
  stages: StageWithChallenges[];
  currentStageIndex: number;
  currentChallengeIndex: number;
  isLoading: boolean;
  error: Error | null;
  isSubmitted: boolean;
  hasStarted: boolean;
  /** null = not yet loaded; non-null after CODE_REVIEW submission */
  followUpQuestions: FollowUpQuestion[] | null;
  followUpLoading: boolean;
  followUpAnswers: Record<string, string>;
  /** assessmentId of the most recently submitted assessment (for follow-up saving) */
  lastAssessmentId: string | null;
}

interface UseAssessmentReturn extends UseAssessmentState {
  submitChallenge: (submission: StageSubmission) => Promise<void>;
  submitFollowUpAnswers: (answers: Record<string, string>) => Promise<void>;
  nextChallenge: () => void;
  onStart: () => void;
  reset: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useAssessment - Handles candidate-side data fetching and submission for challenges.
 *
 * Key behaviours:
 * - `hasStarted` is false until `onStart()` is called — gating the WelcomeScreen
 * - The INVITED → IN_PROGRESS status update is deferred to `onStart()`
 * - After a CODE_REVIEW submission, `generateCodeReviewFollowUps` is triggered
 *   non-fatally; `followUpLoading` and `followUpQuestions` track the result
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
    hasStarted: false,
    followUpQuestions: null,
    followUpLoading: false,
    followUpAnswers: {},
    lastAssessmentId: null,
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

      if (!candidate) {
        throw new Error('INVALID_TOKEN');
      }

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
          'challenges.codeArtifact.groundTruth',
          'challenges.cachedDiffJson',
          'challenges.githubPrTitle',
          'challenges.githubRepoUrl',
          'challenges.githubPrNumber',
          'challenges.githubPrDescription',
          'challenges.cachedMetadata',
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

      // NOTE: Status update INVITED → IN_PROGRESS is deferred to onStart()
      // so that the welcome screen is shown first.

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

  /**
   * Called when the candidate clicks START_INTERVIEW on the welcome screen.
   * Updates the candidate status from INVITED → IN_PROGRESS and sets hasStarted.
   */
  const onStart = useCallback(() => {
    setState((prev) => {
      // Trigger status update non-fatally in background
      if (prev.candidate && prev.candidate.status === 'INVITED') {
        client.models.Candidate.update({
          id: prev.candidate.id,
          status: 'IN_PROGRESS',
        }).catch((err: unknown) => {
          console.warn('[useAssessment] Status update to IN_PROGRESS failed (non-fatal):', err);
        });
      }
      return { ...prev, hasStarted: true };
    });
  }, []);

  const submitChallenge = useCallback(
    async (submission: StageSubmission): Promise<void> => {
      const { candidate, stages, currentStageIndex, currentChallengeIndex } = state;
      if (!candidate || stages.length === 0) return;

      const currentStage = stages[currentStageIndex];
      if (!currentStage) return;

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
          const assessmentId = assessment.id;

          // For non-CODE_REVIEW challenges: score immediately (deterministic, no follow-ups)
          // For CODE_REVIEW: defer scoring until after follow-up answers are submitted
          if (currentChallenge.type !== 'CODE_REVIEW') {
            try {
              await client.mutations.scoreAssessment({ assessmentId });
              console.log(`[useAssessment] Triggered scoringAgent for ${assessmentId}`);
            } catch (lambdaErr) {
              console.error(`[useAssessment] scoringAgent failed for ${assessmentId}:`, lambdaErr);
            }
          }

          // For CODE_REVIEW challenges: trigger follow-up question generation
          if (currentChallenge.type === 'CODE_REVIEW') {
            setState((prev) => ({
              ...prev,
              followUpLoading: true,
              lastAssessmentId: assessmentId,
            }));

            // Run asynchronously — don't block the submission flow
            client.mutations.generateCodeReviewFollowUps({ assessmentId })
              .then((result) => {
                // result.data is a JSON value (the FollowUpAgentOutput)
                let questions: FollowUpQuestion[] = [];
                try {
                  // AppSync serializes a.json() return values as a JSON string,
                  // not a parsed object — parse it if needed.
                  const raw = result.data;
                  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
                  if (parsed && typeof parsed === 'object') {
                    const output = parsed as Record<string, unknown>;
                    if (Array.isArray(output['questions'])) {
                      questions = output['questions'] as FollowUpQuestion[];
                    }
                  }
                } catch {
                  console.warn('[useAssessment] Failed to parse follow-up questions');
                }
                setState((prev) => ({
                  ...prev,
                  followUpQuestions: questions,
                  followUpLoading: false,
                }));
              })
              .catch((err: unknown) => {
                console.error('[useAssessment] generateCodeReviewFollowUps failed (non-fatal):', err);
                // Set empty array so UI can show SKIP_FOLLOW_UP
                setState((prev) => ({
                  ...prev,
                  followUpQuestions: [],
                  followUpLoading: false,
                }));
              });
          }
        }

        // Determine next step
        const isLastChallengeInStage = currentChallengeIndex === challenges.length - 1;
        const isLastStage = currentStageIndex === stages.length - 1;

        if (isLastChallengeInStage && isLastStage) {
          // Final submission — but if CODE_REVIEW, wait for follow-up flow to finish
          if (currentChallenge.type === 'CODE_REVIEW') {
            // followUpQuestions will gate advancement in the page
            setState((prev) => ({ ...prev, isLoading: false }));
          } else {
            await client.models.Candidate.update({
              id: candidate.id,
              status: 'COMPLETED',
            });
            setState((prev) => ({ ...prev, isLoading: false, isSubmitted: true }));
          }
        } else if (isLastChallengeInStage) {
          if (currentChallenge.type === 'CODE_REVIEW') {
            setState((prev) => ({ ...prev, isLoading: false }));
          } else {
            setState((prev) => ({
              ...prev,
              isLoading: false,
              currentStageIndex: prev.currentStageIndex + 1,
              currentChallengeIndex: 0
            }));
          }
        } else {
          if (currentChallenge.type === 'CODE_REVIEW') {
            setState((prev) => ({ ...prev, isLoading: false }));
          } else {
            setState((prev) => ({
              ...prev,
              isLoading: false,
              currentChallengeIndex: prev.currentChallengeIndex + 1
            }));
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to submit assessment');
        console.error('[useAssessment] ❌ SUBMISSION_ERROR:', error);
        setState((prev) => ({ ...prev, isLoading: false, error }));
      }
    },
    [state]
  );

  /**
   * Saves follow-up answers to the Assessment and advances the flow.
   */
  const submitFollowUpAnswers = useCallback(
    async (answers: Record<string, string>): Promise<void> => {
      const { lastAssessmentId, followUpQuestions, candidate, stages, currentStageIndex, currentChallengeIndex } = state;
      if (!lastAssessmentId || !followUpQuestions || !candidate) return;

      setState((prev) => ({ ...prev, isLoading: true }));

      try {
        // Build the full followUpQuestionsJson with answers filled in
        const followUpAnswers = Object.entries(answers).map(([questionId, answer]) => ({
          questionId,
          answer,
          answeredAt: new Date().toISOString(),
        }));

        const followUpQuestionsJson = JSON.stringify({
          questions: followUpQuestions,
          answers: followUpAnswers,
          generatedAt: new Date().toISOString(),
        });

        await client.models.Assessment.update({
          id: lastAssessmentId,
          followUpQuestionsJson,
        });

        console.log('[useAssessment] Follow-up answers saved');

        // Now trigger agentic scoring — Mistral sees the full submission + follow-up answers
        try {
          await client.mutations.scoreAssessment({ assessmentId: lastAssessmentId });
          console.log(`[useAssessment] Triggered agentic scoringAgent for ${lastAssessmentId}`);
        } catch (lambdaErr) {
          console.error(`[useAssessment] scoringAgent (post follow-up) failed:`, lambdaErr);
        }

        // Advance the flow
        const currentStage = stages[currentStageIndex];
        const challenges = currentStage?.challenges || [];
        const isLastChallengeInStage = currentChallengeIndex === challenges.length - 1;
        const isLastStage = currentStageIndex === stages.length - 1;

        if (isLastChallengeInStage && isLastStage) {
          await client.models.Candidate.update({ id: candidate.id, status: 'COMPLETED' });
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isSubmitted: true,
            followUpQuestions: null,
            followUpAnswers: {},
          }));
        } else if (isLastChallengeInStage) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            currentStageIndex: prev.currentStageIndex + 1,
            currentChallengeIndex: 0,
            followUpQuestions: null,
            followUpAnswers: {},
          }));
        } else {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            currentChallengeIndex: prev.currentChallengeIndex + 1,
            followUpQuestions: null,
            followUpAnswers: {},
          }));
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to save follow-up answers');
        console.error('[useAssessment] ❌ FOLLOW_UP_SAVE_ERROR:', error);
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
    submitFollowUpAnswers,
    nextChallenge,
    onStart,
    reset,
  };
}
