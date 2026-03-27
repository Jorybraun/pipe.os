import { useState, useEffect, useCallback, useRef } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const publicClient = generateClient<Schema>({ authMode: 'apiKey' });

function getCandidateClient(sessionToken: string | null) {
  if (sessionToken) {
    return generateClient<Schema>({ authMode: 'lambda', authToken: sessionToken });
  }
  return publicClient;
}

// ============================================================================
// Types
// ============================================================================

export interface ResolvedCandidate {
  id: string;
  pipelineId: string;
  status: string | null;
  name?: string | null;
  email?: string | null;
}

export type Candidate = Schema['Candidate']['type'];
export type Stage = Schema['Stage']['type'];
export type Assessment = Schema['Assessment']['type'];

export interface CodeReviewSubmission { annotations: Record<string, unknown[]> }
export interface QuizSubmission { answers: Record<string, number> }
export interface ShortAnswerTextSubmission { inputMode: 'text'; text: string }
export interface ShortAnswerVoiceSubmission { inputMode: 'voice'; text: string; audioS3Key?: string }
export interface ShortAnswerVideoSubmission { inputMode: 'video'; videoS3Key: string; filename: string }
export type ShortAnswerSubmission = ShortAnswerTextSubmission | ShortAnswerVoiceSubmission | ShortAnswerVideoSubmission;

export function isShortAnswerSubmission(s: unknown): s is ShortAnswerSubmission {
  return typeof s === 'object' && s !== null && 'inputMode' in s &&
    ['text', 'voice', 'video'].includes((s as ShortAnswerSubmission).inputMode);
}

export type StageSubmission = CodeReviewSubmission | QuizSubmission | ShortAnswerSubmission | Record<string, unknown>;

/** Stage rendering config returned by getStageConfig Lambda */
export interface StageConfigDTO {
  isComplete: boolean;
  stageTitle?: string;
  mode?: string;
  timeLimit?: number | null;
  videoConfig?: unknown;
  challenges?: Array<{ type: string; order: number }>;
  currentIndex?: number;
}

/** Challenge content returned by getChallenge Lambda */
export interface ChallengeContentDTO {
  type?: string;
  title?: string;
  instructions?: string;
  config?: unknown;
  cachedDiffJson?: unknown;
  githubPrTitle?: string;
  githubPrNumber?: number;
  githubRepoUrl?: string;
  githubPrDescription?: string;
  codeArtifact?: unknown;
}

export interface FollowUpQuestion {
  id: string;
  type: 'SHORT_ANSWER' | 'VOICE' | 'VIDEO' | 'MCQ';
  question: string;
  context: string;
  options?: Array<{ id: string; text: string }>;
}

interface UseAssessmentState {
  candidate: ResolvedCandidate | null;
  stageConfig: StageConfigDTO | null;
  challengeContent: ChallengeContentDTO | null;
  currentOrder: number;
  isLoading: boolean;
  error: Error | null;
  isSubmitted: boolean;
  hasStarted: boolean;
  followUpQuestions: FollowUpQuestion[] | null;
  followUpLoading: boolean;
  lastChallengeSubmissionId: string | null;
}

interface UseAssessmentReturn extends UseAssessmentState {
  submitChallenge: (submission: StageSubmission) => Promise<void>;
  onStart: () => void;
  reset: () => void;
  sessionToken: string | null;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useAssessment — Secure server-side challenge progression.
 *
 * Two-call pattern:
 *   getStageConfig → stage rendering config + challenge types (no content)
 *   getChallenge(order) → single challenge content
 *
 * No database IDs, no future challenge content exposed to client.
 */
export function useAssessment(inviteToken: string): UseAssessmentReturn {
  const [state, setState] = useState<UseAssessmentState>({
    candidate: null,
    stageConfig: null,
    challengeContent: null,
    currentOrder: 0,
    isLoading: true,
    error: null,
    isSubmitted: false,
    hasStarted: false,
    followUpQuestions: null,
    followUpLoading: false,
    lastChallengeSubmissionId: null,
  });

  const sessionTokenRef = useRef<string | null>(
    typeof window !== 'undefined' ? sessionStorage.getItem('pipe_session_token') : null
  );

  // ── Resolve token on mount ──────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!inviteToken) {
      setState((prev) => ({ ...prev, isLoading: false, error: new Error('Missing invite token') }));
      return;
    }

    try {
      const cachedToken = sessionStorage.getItem('pipe_session_token');
      const cachedCandidateJson = sessionStorage.getItem('pipe_session_candidate');
      let candidate: ResolvedCandidate;

      if (cachedToken && cachedCandidateJson) {
        try {
          const parsed = JSON.parse(cachedCandidateJson) as Record<string, unknown>;
          if (typeof parsed.id === 'string' && typeof parsed.pipelineId === 'string') {
            candidate = {
              id: parsed.id as string,
              pipelineId: parsed.pipelineId as string,
              status: (parsed.status as string) ?? null,
              name: (parsed.name as string) ?? null,
            };
            sessionTokenRef.current = cachedToken;
          } else {
            throw new Error('Invalid cache');
          }
        } catch {
          sessionStorage.removeItem('pipe_session_token');
          sessionStorage.removeItem('pipe_session_candidate');
          throw new Error('SESSION_EXPIRED');
        }
      } else {
        const { data: resolved, errors } = await publicClient.queries.resolveToken({ inviteToken });
        if (errors) throw new Error(errors[0]?.message ?? 'Token resolution failed');
        if (!resolved?.id || !resolved?.pipelineId) throw new Error('INVALID_TOKEN');

        if (resolved.sessionToken) {
          sessionTokenRef.current = resolved.sessionToken;
          sessionStorage.setItem('pipe_session_token', resolved.sessionToken);
        }

        candidate = {
          id: resolved.id,
          pipelineId: resolved.pipelineId,
          status: resolved.status ?? null,
          name: resolved.name ?? null,
        };
        sessionStorage.setItem('pipe_session_candidate', JSON.stringify(candidate));
      }

      if (candidate.status === 'COMPLETED') {
        setState((prev) => ({ ...prev, candidate, isLoading: false, error: new Error('ALREADY_COMPLETED') }));
        return;
      }

      setState((prev) => ({ ...prev, candidate, isLoading: false }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('An unexpected error occurred');
      console.error('[useAssessment] Error:', error);
      setState((prev) => ({ ...prev, isLoading: false, error }));
    }
  }, [inviteToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Load stage config from server ───────────────────────────────────────
  const loadStageConfig = useCallback(async (): Promise<StageConfigDTO | null> => {
    const client = getCandidateClient(sessionTokenRef.current);
    const { data: raw, errors } = await client.mutations.getStageConfig({ inviteToken });

    if (errors?.length) {
      const msg = errors[0]?.message ?? 'Failed to load stage config';
      if (msg.includes('Unauthorized') || msg.includes('401')) {
        sessionStorage.removeItem('pipe_session_token');
        sessionStorage.removeItem('pipe_session_candidate');
        throw new Error('SESSION_EXPIRED');
      }
      throw new Error(msg);
    }

    if (!raw) throw new Error('SESSION_EXPIRED');

    const result = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
    if (result['error']) throw new Error(result['error'] as string);

    return result as unknown as StageConfigDTO;
  }, [inviteToken]);

  // ── Load challenge content by order ─────────────────────────────────────
  const loadChallenge = useCallback(async (order: number): Promise<ChallengeContentDTO | null> => {
    const client = getCandidateClient(sessionTokenRef.current);
    const { data: raw, errors } = await client.mutations.getChallenge({ inviteToken, order });

    if (errors?.length) {
      const msg = errors[0]?.message ?? 'Failed to load challenge';
      if (msg.includes('Unauthorized') || msg.includes('401')) {
        sessionStorage.removeItem('pipe_session_token');
        sessionStorage.removeItem('pipe_session_candidate');
        throw new Error('SESSION_EXPIRED');
      }
      throw new Error(msg);
    }

    if (!raw) throw new Error('SESSION_EXPIRED');

    const result = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
    if (result['error']) throw new Error(result['error'] as string);

    return result as unknown as ChallengeContentDTO;
  }, [inviteToken]);

  // ── onStart: load stage config + first challenge ────────────────────────
  const onStart = useCallback(async () => {
    setState((prev) => ({ ...prev, hasStarted: true, isLoading: true }));

    // Update candidate status (non-fatal)
    const client = getCandidateClient(sessionTokenRef.current);
    if (state.candidate?.status === 'INVITED') {
      client.models.Candidate.update(
        { id: state.candidate.id, status: 'IN_PROGRESS' },
        { selectionSet: ['id', 'status'] }
      ).catch((err: unknown) => console.warn('[useAssessment] Status update failed (non-fatal):', err));
    }

    try {
      const config = await loadStageConfig();

      if (!config || config.isComplete) {
        setState((prev) => ({ ...prev, isLoading: false, isSubmitted: true }));
        return;
      }

      const currentIndex = config.currentIndex ?? 0;
      const content = await loadChallenge(currentIndex);

      setState((prev) => ({
        ...prev,
        isLoading: false,
        stageConfig: config,
        challengeContent: content,
        currentOrder: currentIndex,
        followUpQuestions: null,
        followUpLoading: false,
      }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load stage');
      console.error('[useAssessment] onStart error:', error);
      setState((prev) => ({ ...prev, isLoading: false, error }));
    }
  }, [state.candidate, loadStageConfig, loadChallenge]);

  // ── Auto-trigger follow-up generation ───────────────────────────────────
  useEffect(() => {
    const { stageConfig, currentOrder, lastChallengeSubmissionId, followUpLoading, followUpQuestions, hasStarted } = state;
    if (!hasStarted || !stageConfig?.challenges) return;

    const currentType = stageConfig.challenges[currentOrder]?.type;
    if (currentType !== 'FOLLOW_UP') return;
    if (!lastChallengeSubmissionId) return;
    if (followUpLoading || followUpQuestions !== null) return;

    setState((prev) => ({ ...prev, followUpLoading: true }));

    const client = getCandidateClient(sessionTokenRef.current);
    client.mutations.generateFollowUps({ challengeSubmissionId: lastChallengeSubmissionId })
      .then((result) => {
        let questions: FollowUpQuestion[] = [];
        try {
          const raw = result.data;
          const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
          if (Array.isArray(parsed['questions'])) {
            questions = parsed['questions'] as FollowUpQuestion[];
          }
        } catch { /* */ }
        setState((prev) => ({ ...prev, followUpQuestions: questions, followUpLoading: false }));
      })
      .catch((err: unknown) => {
        console.error('[useAssessment] generateFollowUps failed:', err);
        setState((prev) => ({ ...prev, followUpQuestions: [], followUpLoading: false }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentOrder, state.lastChallengeSubmissionId, state.hasStarted]);

  // ── Advance to next challenge (or next stage, or complete) ──────────────
  const advance = useCallback(async () => {
    const { stageConfig, currentOrder } = state;
    if (!stageConfig?.challenges) return;

    const nextOrder = currentOrder + 1;

    if (nextOrder < stageConfig.challenges.length) {
      // Next challenge in same stage
      try {
        const content = await loadChallenge(nextOrder);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          challengeContent: content,
          currentOrder: nextOrder,
          followUpQuestions: null,
          followUpLoading: false,
        }));
      } catch (err) {
        console.error('[useAssessment] Failed to load next challenge:', err);
        setState((prev) => ({ ...prev, isLoading: false, error: err instanceof Error ? err : new Error('Failed to load challenge') }));
      }
    } else {
      // Stage complete — load next stage config
      try {
        const config = await loadStageConfig();

        if (!config || config.isComplete) {
          // All done — mark candidate completed
          const client = getCandidateClient(sessionTokenRef.current);
          client.models.Candidate.update(
            { id: state.candidate!.id, status: 'COMPLETED' },
            { selectionSet: ['id', 'status'] }
          ).catch((e: unknown) => console.warn('[useAssessment] COMPLETED update failed:', e));

          setState((prev) => ({ ...prev, isLoading: false, isSubmitted: true }));
          return;
        }

        const newIndex = config.currentIndex ?? 0;
        const content = await loadChallenge(newIndex);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          stageConfig: config,
          challengeContent: content,
          currentOrder: newIndex,
          followUpQuestions: null,
          followUpLoading: false,
        }));
      } catch (err) {
        console.error('[useAssessment] Failed to load next stage:', err);
        setState((prev) => ({ ...prev, isLoading: false, error: err instanceof Error ? err : new Error('Failed to load stage') }));
      }
    }
  }, [state, loadStageConfig, loadChallenge]);

  // ── Submit challenge ────────────────────────────────────────────────────
  const submitChallenge = useCallback(
    async (submission: StageSubmission): Promise<void> => {
      const { candidate, stageConfig, currentOrder } = state;
      if (!candidate || !stageConfig?.challenges) return;

      const currentType = stageConfig.challenges[currentOrder]?.type;
      const client = getCandidateClient(sessionTokenRef.current);
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        // ── FOLLOW_UP: save answers to previous submission, score, advance ──
        if (currentType === 'FOLLOW_UP') {
          const { lastChallengeSubmissionId, followUpQuestions } = state;
          if (lastChallengeSubmissionId && followUpQuestions && followUpQuestions.length > 0) {
            const answers = (submission as { answers?: Record<string, string> }).answers ?? {};
            const answersData = Object.entries(answers).map(([questionId, answer]) => ({
              questionId, answer, answeredAt: new Date().toISOString(),
            }));
            await client.models.ChallengeSubmission.update({
              id: lastChallengeSubmissionId,
              followUpQuestionsJson: JSON.stringify({
                questions: followUpQuestions,
                answers: answersData,
                generatedAt: new Date().toISOString(),
              }),
            });
            try {
              await client.mutations.scoreChallengeSubmission({ challengeSubmissionId: lastChallengeSubmissionId });
            } catch (e) {
              console.error('[useAssessment] scoringAgent (follow-up) failed:', e);
            }
          }

          // Create a ChallengeSubmission for the FOLLOW_UP challenge itself
          // so getStageConfig marks it as completed
          try {
            await client.mutations.submitChallengeResponse({
              inviteToken,
              order: currentOrder,
              submission: JSON.stringify(submission),
            });
          } catch (e) {
            console.error('[useAssessment] FOLLOW_UP submission record failed (non-fatal):', e);
          }

          await advance();
          return;
        }

        // ── Non-FOLLOW_UP: submit via Lambda ──────────────────────────────
        const { data: submitResult } = await client.mutations.submitChallengeResponse({
          inviteToken,
          order: currentOrder,
          submission: JSON.stringify(submission),
        });

        if (submitResult?.success && submitResult.challengeSubmissionId) {
          // Score
          try {
            await client.mutations.scoreChallengeSubmission({ challengeSubmissionId: submitResult.challengeSubmissionId });
          } catch (e) {
            console.error('[useAssessment] scoringAgent failed:', e);
          }

          setState((prev) => ({ ...prev, lastChallengeSubmissionId: submitResult.challengeSubmissionId! }));
          await advance();
        } else {
          const errorMsg = submitResult?.error ?? 'Failed to submit';
          console.error('[useAssessment] submitChallengeResponse failed:', errorMsg);
          setState((prev) => ({ ...prev, isLoading: false, error: new Error(errorMsg) }));
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to submit');
        console.error('[useAssessment] SUBMISSION_ERROR:', error);
        setState((prev) => ({ ...prev, isLoading: false, error }));
      }
    },
    [state, inviteToken, advance]
  );

  const reset = useCallback(() => {
    sessionStorage.removeItem('pipe_session_token');
    sessionStorage.removeItem('pipe_session_candidate');
    sessionTokenRef.current = null;
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    submitChallenge,
    onStart,
    reset,
    sessionToken: sessionTokenRef.current,
  };
}
