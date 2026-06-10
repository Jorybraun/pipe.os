import { useState, useEffect, useCallback, useRef } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface ResolvedCandidate {
  id: string;
  pipelineId: string | null;
  status: string | null;
  name?: string | null;
  email?: string | null;
}

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

/** Stage rendering config returned by get-stage-config Worker */
export interface WaitingChallengeConfig {
  autoRefresh: boolean;
  refreshIntervalSeconds: number;
}

export interface WaitingChallengeDTO {
  id: string;
  type: 'WAITING_FOR_MATCH';
  title: string;
  instructions: string;
  config: WaitingChallengeConfig;
}

export interface StageConfigDTO {
  isComplete: boolean;
  stageId?: string;
  candidateId?: string;
  stageTitle?: string;
  mode?: string;
  timeLimit?: number | null;
  videoConfig?: unknown;
  screeningInputMode?: 'text' | 'voice' | 'video' | null;
  challenges?: Array<{ type: string; order: number; title?: string }>;
  /** Preview of parts that come after the current stage (e.g. the code review behind a CV intake gate). */
  upcoming?: Array<{ type: string; title?: string }>;
  currentIndex?: number;
  waitingChallenge?: WaitingChallengeDTO;
}

/** Challenge content returned by get-challenge Worker */
export interface ChallengeContentDTO {
  id?: string;
  type?: string;
  title?: string;
  instructions?: string;
  config?: unknown;
  cachedDiffJson?: unknown;
  githubPrTitle?: string;
  githubPrNumber?: number;
  githubRepoUrl?: string;
  githubPrDescription?: string;
  devContainerRepoUrl?: string;
  issueBody?: { title?: string | null; body?: string | null; labels?: string[] } | null;
  codeArtifact?: unknown;
  reviewSession?: {
    requiresInit?: boolean;
  } | null;
}

export interface FollowUpQuestion {
  id: string;
  type: 'SHORT_ANSWER' | 'VOICE' | 'VIDEO' | 'MCQ';
  question: string;
  context: string;
  /** MCQ options: `{ id, label }[]` serialized by backend for MCQ-typed follow-ups. */
  options?: Array<{ id: string; label: string }>;
}

interface AssessmentState {
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

interface UseAssessmentReturn extends AssessmentState {
  submitChallenge: (submission: StageSubmission) => Promise<void>;
  onStart: () => Promise<void>;
  reset: () => void;
  refresh: () => Promise<void>;
  sessionToken: string | null;
}

// ============================================================================
// API helpers — direct Workers RPC calls
// ============================================================================

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

async function rpcPost<T>(
  path: string,
  body: Record<string, unknown>,
  sessionToken?: string | null,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    throw new Error('SESSION_EXPIRED');
  }

  if (res.status === 403) {
    const data = await res.json() as Record<string, unknown>;
    if ((data as { status?: string }).status === 'COMPLETED') {
      throw new Error('ALREADY_COMPLETED');
    }
    throw new Error('ALREADY_COMPLETED');
  }

  if (res.status === 404) {
    throw new Error('INVALID_TOKEN');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    const errMsg = (data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return res.json() as Promise<T>;
}

// ============================================================================
// Hook
// ============================================================================

export function useAssessment(inviteToken: string): UseAssessmentReturn {
  const [state, setState] = useState<AssessmentState>({
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
    const cachedToken = sessionStorage.getItem('pipe_session_token');
    const cachedCandidateJson = sessionStorage.getItem('pipe_session_candidate');

    // Allow empty inviteToken when a cached session exists (demo/self-reg flow)
    if (!inviteToken && !(cachedToken && cachedCandidateJson)) {
      setState((prev) => ({ ...prev, isLoading: false, error: new Error('Missing invite token') }));
      return;
    }

    try {
      let candidate: ResolvedCandidate;

      if (cachedToken && cachedCandidateJson) {
        try {
          const parsed = JSON.parse(cachedCandidateJson) as Record<string, unknown>;
          if (typeof parsed.id === 'string' && (typeof parsed.pipelineId === 'string' || parsed.pipelineId === null)) {
            candidate = {
              id: parsed.id as string,
              pipelineId: (parsed.pipelineId as string | null) ?? null,
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
        // Resolve token via Workers RPC
        const resolved = await rpcPost<{
          id: string;
          pipelineId: string | null;
          status: string;
          name: string | null;
          sessionToken: string;
        }>('/rpc/resolve-token', { inviteToken });

        sessionTokenRef.current = resolved.sessionToken;
        sessionStorage.setItem('pipe_session_token', resolved.sessionToken);

        candidate = {
          id: resolved.id,
          pipelineId: resolved.pipelineId,
          status: resolved.status,
          name: resolved.name,
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

  useEffect(() => { void fetchData(); }, [fetchData]);

  // ── Load stage config from Worker ──────────────────────────────────────
  const loadStageConfig = useCallback(async (): Promise<StageConfigDTO | null> => {
    return rpcPost<StageConfigDTO>('/rpc/get-stage-config', {}, sessionTokenRef.current);
  }, []);

  // ── Load challenge content by order ────────────────────────────────────
  const loadChallenge = useCallback(async (order: number): Promise<ChallengeContentDTO | null> => {
    return rpcPost<ChallengeContentDTO>('/rpc/get-challenge', { order }, sessionTokenRef.current);
  }, []);

  // ── onStart: load stage config + first challenge ───────────────────────
  const onStart = useCallback(async () => {
    setState((prev) => ({ ...prev, hasStarted: true, isLoading: true }));

    try {
      const config = await loadStageConfig();

      if (!config || config.isComplete) {
        setState((prev) => ({ ...prev, isLoading: false, isSubmitted: true }));
        return;
      }

      const currentIndex = config.currentIndex ?? 0;
      const currentChallenge = config.challenges?.[currentIndex];

      // WAITING_FOR_MATCH: synthetic challenge — skip get-challenge, use waitingChallenge data
      let content: ChallengeContentDTO | null = null;
      if (currentChallenge?.type === 'WAITING_FOR_MATCH' && config.waitingChallenge) {
        content = {
          id: config.waitingChallenge.id,
          type: config.waitingChallenge.type,
          title: config.waitingChallenge.title,
          instructions: config.waitingChallenge.instructions,
          config: config.waitingChallenge.config,
        };
      } else {
        content = await loadChallenge(currentIndex);
      }

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
  }, [loadStageConfig, loadChallenge]);

  // ── Advance to next challenge (or next stage, or complete) ─────────────
  const advance = useCallback(async () => {
    const { stageConfig, currentOrder } = state;
    if (!stageConfig?.challenges) return;

    const nextOrder = currentOrder + 1;

    if (nextOrder < stageConfig.challenges.length) {
      try {
        const nextChallenge = stageConfig.challenges[nextOrder];
        let content: ChallengeContentDTO | null = null;
        if (nextChallenge?.type === 'WAITING_FOR_MATCH' && stageConfig.waitingChallenge) {
          content = {
            id: stageConfig.waitingChallenge.id,
            type: stageConfig.waitingChallenge.type,
            title: stageConfig.waitingChallenge.title,
            instructions: stageConfig.waitingChallenge.instructions,
            config: stageConfig.waitingChallenge.config,
          };
        } else {
          content = await loadChallenge(nextOrder);
        }
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
          // Update candidate status to COMPLETED
          await rpcPost('/rpc/submit-status', { status: 'COMPLETED' }, sessionTokenRef.current);

          sessionStorage.removeItem('pipe_session_token');
          sessionStorage.removeItem('pipe_session_candidate');
          setState((prev) => ({ ...prev, isLoading: false, isSubmitted: true }));
          return;
        }

        const newIndex = config.currentIndex ?? 0;
        const newChallenge = config.challenges?.[newIndex];
        let content: ChallengeContentDTO | null = null;
        if (newChallenge?.type === 'WAITING_FOR_MATCH' && config.waitingChallenge) {
          content = {
            id: config.waitingChallenge.id,
            type: config.waitingChallenge.type,
            title: config.waitingChallenge.title,
            instructions: config.waitingChallenge.instructions,
            config: config.waitingChallenge.config,
          };
        } else {
          content = await loadChallenge(newIndex);
        }
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

  // ── Submit challenge ───────────────────────────────────────────────────
  const submitChallenge = useCallback(
    async (submission: StageSubmission): Promise<void> => {
      const { candidate, stageConfig, currentOrder } = state;
      if (!candidate || !stageConfig?.challenges) return;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const result = await rpcPost<{ success: boolean; next?: boolean; challengeSubmissionId?: string; error?: string }>(
          '/rpc/submit-challenge-response',
          { order: currentOrder, submission: JSON.stringify(submission) },
          sessionTokenRef.current,
        );

        if (result.success && result.next) {
          // Synthetic challenge (WELCOME, LIVE_VIDEO) — just advance, no scoring
          await advance();
        } else if (result.success && result.challengeSubmissionId) {
          // Score (fire-and-forget)
          rpcPost('/rpc/score-submission', { challengeSubmissionId: result.challengeSubmissionId }, sessionTokenRef.current)
            .catch((e: unknown) => console.error('[useAssessment] scoringAgent failed:', e));

          setState((prev) => ({ ...prev, lastChallengeSubmissionId: result.challengeSubmissionId! }));
          await advance();
        } else {
          const errorMsg = result.error ?? 'Failed to submit';
          setState((prev) => ({ ...prev, isLoading: false, error: new Error(errorMsg) }));
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to submit');
        console.error('[useAssessment] SUBMISSION_ERROR:', error);
        setState((prev) => ({ ...prev, isLoading: false, error }));
      }
    },
    [state, advance],
  );

  const reset = useCallback(() => {
    sessionStorage.removeItem('pipe_session_token');
    sessionStorage.removeItem('pipe_session_candidate');
    sessionTokenRef.current = null;
    void fetchData();
  }, [fetchData]);

  // Refresh current stage config + challenge (used by WAITING_FOR_MATCH auto-refresh)
  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const config = await loadStageConfig();

      if (!config || config.isComplete) {
        setState((prev) => ({ ...prev, isLoading: false, isSubmitted: true }));
        return;
      }

      const currentIndex = config.currentIndex ?? 0;
      const currentChallenge = config.challenges?.[currentIndex];

      let content: ChallengeContentDTO | null = null;
      if (currentChallenge?.type === 'WAITING_FOR_MATCH' && config.waitingChallenge) {
        content = {
          id: config.waitingChallenge.id,
          type: config.waitingChallenge.type,
          title: config.waitingChallenge.title,
          instructions: config.waitingChallenge.instructions,
          config: config.waitingChallenge.config,
        };
      } else {
        content = await loadChallenge(currentIndex);
      }

      setState((prev) => ({
        ...prev,
        isLoading: false,
        stageConfig: config,
        challengeContent: content,
        currentOrder: currentIndex,
        followUpQuestions: null,
        followUpLoading: false,
        error: null,
      }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Refresh failed');
      console.error('[useAssessment] refresh error:', error);
      setState((prev) => ({ ...prev, isLoading: false, error }));
    }
  }, [loadStageConfig, loadChallenge]);

  return {
    ...state,
    submitChallenge,
    onStart,
    reset,
    refresh,
    sessionToken: sessionTokenRef.current,
  };
}
