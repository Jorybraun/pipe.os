import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { sanitizeChallengeConfig } from '../lib/utils';

const client = generateClient<Schema>({ authMode: 'apiKey' });

// Selection set for challenge content — shared between initial load and stage-advance fetches.
// groundTruth, serverConfig, and cachedMetadata are intentionally excluded (answer keys / sensitive data).
const CHALLENGE_SELECTION_SET = [
  'id', 'title', 'order', 'timeLimit', 'mode', 'videoConfig',
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
  'challenges.cachedDiffJson',
  'challenges.githubPrTitle',
  'challenges.githubRepoUrl',
  'challenges.githubPrNumber',
  'challenges.githubPrDescription',
] as const;

/**
 * Fetches challenge content for a single stage by ID.
 * Called on-demand as the candidate advances — never bulk-prefetched.
 */
async function fetchStageChallenges(stageId: string): Promise<StageWithChallenges> {
  const { data: stage, errors } = await client.models.Stage.get(
    { id: stageId },
    { selectionSet: CHALLENGE_SELECTION_SET }
  );
  if (errors) throw new Error(errors[0]?.message ?? 'Failed to fetch stage');
  if (!stage) throw new Error(`Stage ${stageId} not found`);

  return {
    ...stage,
    challenges: (stage.challenges || [])
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(challenge => {
        const parsedConfig = typeof challenge.config === 'string'
          ? JSON.parse(challenge.config)
          : challenge.config;
        return {
          ...challenge,
          config: sanitizeChallengeConfig(parsedConfig, challenge.type ?? ''),
        };
      }),
  };
}

// ============================================================================
// Types
// ============================================================================

/**
 * Candidate data available client-side during an assessment.
 * Sourced from the resolveToken Lambda — intentionally excludes email and inviteToken
 * to prevent cross-candidate enumeration.
 */
export interface ResolvedCandidate {
  id: string;
  pipelineId: string;
  status: string | null;
  name?: string | null;
  // ownerId removed — recruiter Cognito sub is no longer sent to candidate clients.
  // Assessment.ownerId is now set server-side by the createAssessment Lambda.
  // email is intentionally not fetched from resolveToken — only present here
  // for UI compat. Always undefined in the candidate assessment flow.
  email?: string | null;
}

// Keep the full Candidate type export for other consumers (recruiter pages)
export type Candidate = Schema['Candidate']['type'];
export type Stage = Schema['Stage']['type'];
export type Assessment = Schema['Assessment']['type'];

export interface CodeReviewSubmission {
  annotations: Record<string, unknown[]>;
}

export interface QuizSubmission {
  answers: Record<string, number>;
}

/** QUIZ_SHORT_ANSWER typed text submission */
export interface ShortAnswerTextSubmission {
  inputMode: 'text';
  text: string;
}

/** QUIZ_SHORT_ANSWER voice-to-text submission */
export interface ShortAnswerVoiceSubmission {
  inputMode: 'voice';
  /** Speech-to-text transcript — primary answer */
  text: string;
  /** S3 key of the raw audio file (optional — may be absent if upload failed) */
  audioS3Key?: string;
}

/** QUIZ_SHORT_ANSWER video recording submission */
export interface ShortAnswerVideoSubmission {
  inputMode: 'video';
  /** S3 key of the candidate video file */
  videoS3Key: string;
  /** Filename shown in recruiter UI */
  filename: string;
}

export type ShortAnswerSubmission =
  | ShortAnswerTextSubmission
  | ShortAnswerVoiceSubmission
  | ShortAnswerVideoSubmission;

/** Type guard for ShortAnswerSubmission */
export function isShortAnswerSubmission(s: unknown): s is ShortAnswerSubmission {
  return (
    typeof s === 'object' &&
    s !== null &&
    'inputMode' in s &&
    ((s as ShortAnswerSubmission).inputMode === 'text' ||
      (s as ShortAnswerSubmission).inputMode === 'voice' ||
      (s as ShortAnswerSubmission).inputMode === 'video')
  );
}

export type StageSubmission = CodeReviewSubmission | QuizSubmission | ShortAnswerSubmission | Record<string, unknown>;

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
      // groundTruth intentionally excluded — answer keys must never be sent to the client
    } | null;
    cachedDiffJson: unknown;
    githubPrTitle: string | null;
    githubRepoUrl: string | null;
    githubPrNumber: number | null;
    githubPrDescription: string | null;
    // cachedMetadata intentionally excluded — may contain sensitive reviewer data
  }[];
}

export interface FollowUpQuestion {
  id: string;
  type: 'SHORT_ANSWER';
  question: string;
  context: string;
}

interface UseAssessmentState {
  candidate: ResolvedCandidate | null;
  stages: StageWithChallenges[];
  currentStageIndex: number;
  currentChallengeIndex: number;
  isLoading: boolean;
  error: Error | null;
  isSubmitted: boolean;
  hasStarted: boolean;
  /** null = not yet triggered; non-null once generation completes (or fails) */
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
 * - FOLLOW_UP is a first-class challenge type — when reached, `generateFollowUps`
 *   is triggered automatically using `lastAssessmentId` (the previous challenge's
 *   assessment). `followUpLoading` and `followUpQuestions` track the result.
 * - Scoring is deferred when the next challenge is FOLLOW_UP; otherwise immediate.
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
      // 1. Resolve invite token → candidate identity (server-side — no cross-candidate exposure)
      const { data: resolved, errors: resolveErrors } = await client.queries.resolveToken({ inviteToken });

      if (resolveErrors) throw new Error(resolveErrors[0]?.message ?? 'Token resolution failed');

      if (!resolved?.id || !resolved?.pipelineId) {
        throw new Error('INVALID_TOKEN');
      }

      const candidate: ResolvedCandidate = {
        id: resolved.id,
        pipelineId: resolved.pipelineId,
        status: resolved.status ?? null,
        name: resolved.name ?? null,
      };

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

      // 3. Fetch stage metadata for all stages (no challenge content).
      //    Challenge content is loaded lazily — only the current stage is fetched.
      //    This prevents future stage questions from being visible in the browser.
      const { data: stagesMeta, errors: stagesErrors } = await client.models.Stage.list({
        filter: { pipelineId: { eq: candidate.pipelineId } },
        selectionSet: ['id', 'title', 'order', 'timeLimit', 'mode', 'videoConfig'],
      });
      if (stagesErrors) throw new Error(stagesErrors[0]?.message ?? 'Failed to fetch stages');

      const sortedMetas = [...stagesMeta]
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      // Build placeholder stages with empty challenge arrays
      const placeholderStages: StageWithChallenges[] = sortedMetas.map(s => ({
        ...s,
        challenges: [],
      }));

      // 4. Eagerly load challenge content for stage 0 only
      if (sortedMetas.length > 0 && sortedMetas[0]) {
        placeholderStages[0] = await fetchStageChallenges(sortedMetas[0].id);
      }

      // NOTE: Status update INVITED → IN_PROGRESS is deferred to onStart()
      // so that the welcome screen is shown first.

      setState((prev) => ({
        ...prev,
        candidate,
        stages: placeholderStages,
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
        client.models.Candidate.update(
          { id: prev.candidate.id, status: 'IN_PROGRESS' },
          { selectionSet: ['id', 'status'] }
        ).catch((err: unknown) => {
          console.warn('[useAssessment] Status update to IN_PROGRESS failed (non-fatal):', err);
        });
      }
      return { ...prev, hasStarted: true };
    });
  }, []);

  /**
   * When the current challenge is FOLLOW_UP, auto-trigger generateFollowUps
   * using the previous challenge's assessmentId (lastAssessmentId).
   * Runs whenever the candidate advances to a new challenge.
   */
  useEffect(() => {
    const { stages, currentStageIndex, currentChallengeIndex, lastAssessmentId, followUpLoading, followUpQuestions, hasStarted } = state;
    if (!hasStarted) return;

    const currentStage = stages[currentStageIndex];
    const currentChallenge = currentStage?.challenges?.[currentChallengeIndex];

    if (currentChallenge?.type !== 'FOLLOW_UP') return;
    if (!lastAssessmentId) return;
    if (followUpLoading || followUpQuestions !== null) return; // already in progress

    setState((prev) => ({ ...prev, followUpLoading: true }));

    client.mutations.generateFollowUps({ assessmentId: lastAssessmentId })
      .then((result) => {
        let questions: FollowUpQuestion[] = [];
        try {
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
        setState((prev) => ({ ...prev, followUpQuestions: questions, followUpLoading: false }));
      })
      .catch((err: unknown) => {
        console.error('[useAssessment] generateFollowUps failed (non-fatal):', err);
        setState((prev) => ({ ...prev, followUpQuestions: [], followUpLoading: false }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentChallengeIndex, state.currentStageIndex, state.lastAssessmentId, state.hasStarted]);

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
        // ── FOLLOW_UP: save answers to previous assessment + score, then advance ──
        if (currentChallenge.type === 'FOLLOW_UP') {
          const { lastAssessmentId, followUpQuestions } = state;
          if (lastAssessmentId && followUpQuestions && followUpQuestions.length > 0) {
            const answers = (submission as { answers?: Record<string, string> }).answers ?? {};
            const answersData = Object.entries(answers).map(([questionId, answer]) => ({
              questionId,
              answer,
              answeredAt: new Date().toISOString(),
            }));
            await client.models.Assessment.update({
              id: lastAssessmentId,
              followUpQuestionsJson: JSON.stringify({
                questions: followUpQuestions,
                answers: answersData,
                generatedAt: new Date().toISOString(),
              }),
            });
            try {
              await client.mutations.scoreAssessment({ assessmentId: lastAssessmentId });
              console.log(`[useAssessment] Triggered scoringAgent (post follow-up) for ${lastAssessmentId}`);
            } catch (lambdaErr) {
              console.error('[useAssessment] scoringAgent (post follow-up) failed:', lambdaErr);
            }
          }

          // Advance past FOLLOW_UP — no Assessment record created for it
          const isLastChallengeInStage = currentChallengeIndex === challenges.length - 1;
          const isLastStage = currentStageIndex === stages.length - 1;
          if (isLastChallengeInStage && isLastStage) {
            client.models.Candidate.update({ id: candidate.id, status: 'COMPLETED' }).catch(
              (e: unknown) => console.warn('[useAssessment] Candidate.update COMPLETED failed:', e)
            );
            setState((prev) => ({ ...prev, isLoading: false, isSubmitted: true, followUpQuestions: null, followUpAnswers: {} }));
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
          return;
        }

        // Create Assessment via secure Lambda resolver — validates inviteToken server-side,
        // sets candidateId and ownerId from the Candidate record (never from client input).
        const { data: assessmentResult } = await client.mutations.submitAssessment({
          inviteToken,
          challengeId: currentChallenge.id,
          submission: JSON.stringify(submission),
        });

        if (assessmentResult?.success && assessmentResult.assessmentId) {
          const assessmentId = assessmentResult.assessmentId;

          // Determine next step
          const isLastChallengeInStage = currentChallengeIndex === challenges.length - 1;
          const isLastStage = currentStageIndex === stages.length - 1;

          // Check if the next challenge is FOLLOW_UP — if so, defer scoring so the
          // scoring agent can see the full submission + follow-up answers together.
          const nextChallenge = !isLastChallengeInStage ? challenges[currentChallengeIndex + 1] : null;
          const nextIsFollowUp = nextChallenge?.type === 'FOLLOW_UP';

          if (!nextIsFollowUp) {
            try {
              await client.mutations.scoreAssessment({ assessmentId });
              console.log(`[useAssessment] Triggered scoringAgent for ${assessmentId}`);
            } catch (lambdaErr) {
              console.error(`[useAssessment] scoringAgent failed for ${assessmentId}:`, lambdaErr);
            }
          }

          // Always advance — FOLLOW_UP is now a first-class challenge in the queue
          if (isLastChallengeInStage && isLastStage) {
            await client.models.Candidate.update({ id: candidate.id, status: 'COMPLETED' });
            setState((prev) => ({ ...prev, isLoading: false, isSubmitted: true, lastAssessmentId: assessmentId }));
          } else if (isLastChallengeInStage) {
            // Advance to next stage — load challenge content on demand (progressive loading)
            const nextIndex = currentStageIndex + 1;
            const nextStage = stages[nextIndex];
            if (nextStage && nextStage.challenges.length === 0) {
              try {
                const enriched = await fetchStageChallenges(nextStage.id);
                setState((prev) => {
                  const updated = [...prev.stages];
                  updated[nextIndex] = enriched;
                  return {
                    ...prev,
                    isLoading: false,
                    lastAssessmentId: assessmentId,
                    stages: updated,
                    currentStageIndex: nextIndex,
                    currentChallengeIndex: 0,
                  };
                });
              } catch (loadErr) {
                console.error('[useAssessment] Failed to load next stage:', loadErr);
                setState((prev) => ({ ...prev, isLoading: false }));
              }
            } else {
              setState((prev) => ({
                ...prev,
                isLoading: false,
                lastAssessmentId: assessmentId,
                currentStageIndex: prev.currentStageIndex + 1,
                currentChallengeIndex: 0,
              }));
            }
          } else {
            setState((prev) => ({
              ...prev,
              isLoading: false,
              lastAssessmentId: assessmentId,
              currentChallengeIndex: prev.currentChallengeIndex + 1,
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

        await client.models.Assessment.update(
          { id: lastAssessmentId, followUpQuestionsJson },
          { selectionSet: ['id'] }
        );

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
          // Mark candidate as COMPLETED — non-fatal: isSubmitted is set regardless
          client.models.Candidate.update(
            { id: candidate.id, status: 'COMPLETED' },
            { selectionSet: ['id', 'status'] }
          ).catch(
            (err: unknown) => console.warn('[useAssessment] Candidate.update COMPLETED failed (non-fatal):', err)
          );
          setState((prev) => ({
            ...prev,
            isLoading: false,
            isSubmitted: true,
            followUpQuestions: null,
            followUpAnswers: {},
          }));
        } else if (isLastChallengeInStage) {
          // Load next stage content before advancing
          const nextIndex = currentStageIndex + 1;
          const nextStage = stages[nextIndex];
          if (nextStage && nextStage.challenges.length === 0) {
            try {
              const enriched = await fetchStageChallenges(nextStage.id);
              setState((prev) => {
                const updated = [...prev.stages];
                updated[nextIndex] = enriched;
                return {
                  ...prev,
                  isLoading: false,
                  stages: updated,
                  currentStageIndex: nextIndex,
                  currentChallengeIndex: 0,
                  followUpQuestions: null,
                  followUpAnswers: {},
                };
              });
            } catch (loadErr) {
              console.error('[useAssessment] Failed to load next stage:', loadErr);
              setState((prev) => ({ ...prev, isLoading: false }));
            }
          } else {
            setState((prev) => ({
              ...prev,
              isLoading: false,
              currentStageIndex: nextIndex,
              currentChallengeIndex: 0,
              followUpQuestions: null,
              followUpAnswers: {},
            }));
          }
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
