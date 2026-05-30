/**
 * useRoleDiscovery — manages the full role discovery interview flow (ADR-028).
 *
 * State machine: IDLE → CALIBRATING → INTERVIEWING → COMPLETE
 *
 * Owns the single useConversation instance for a role discovery session and
 * exposes it as `conv` so that `<AIChat conv={rd.conv} />` reads the SAME
 * state — if two hooks call `useConversation` over the same adapter they end
 * up with two disconnected copies of `phase`/`persona`/etc., which silently
 * breaks the synthesis handoff.
 *
 * Role-discovery-specific fields (contextId, participantId, participantRole,
 * baseline) are stored in refs on this hook and exposed on the returned object.
 */

import { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { useApiClient } from './useApiClient';
import { useConversation } from './useConversation';
import type {
  RoleContextBaseline,
  RoleContextExchange,
  ParticipantRole,
  CandidatePersona,
  GeneratedJobDescription,
  RoleContextDocument,
  RoleContextFullState,
  DomainCoverage,
  CreateRoleContextResponse,
  StartRoleContextResponse,
  FlagAttributeResponse,
  SubmitGapAnswerResponse,
  InterviewState,
  DomainCompletionStatus,
  PostRespondResponse,
  PostSynthesizeResponse,
} from '../lib/api/types';
import type {
  ConversationAdapter,
  AdapterConfig,
  QuestionTurnResult,
  SynthesisResult,
  TurnResult,
} from '../components/AIChat/types';
import type { UseConversationResult } from './useConversation';

export type DiscoveryPhase = 'IDLE' | 'BASELINE' | 'CALIBRATING' | 'INTERVIEWING' | 'COMPLETE';

export type { PastExchange } from '../components/AIChat/types';

export interface UseRoleDiscoveryResult {
  phase: DiscoveryPhase;
  contextId: string | null;
  participantId: string | null;
  participantRole: ParticipantRole | null;

  /** The ConversationAdapter — stable identity for the session. */
  adapter: ConversationAdapter;

  /**
   * Shared conversation state. Pass to `<AIChat conv={rd.conv} />` so the
   * component and the page read/write the same instance — never duplicate.
   */
  conv: UseConversationResult;

  // Current turn
  acknowledgment: string | null;
  currentQuestion: UseConversationResult['currentQuestion'];
  progress: UseConversationResult['progress'];

  // History
  pastExchanges: UseConversationResult['pastExchanges'];

  // Streaming
  streamingText: UseConversationResult['streamingText'];

  // Baseline (stored for pipeline creation)
  baseline: RoleContextBaseline | null;

  // Synthesis (when COMPLETE) — Role Discovery v2 artifacts
  persona: UseConversationResult['persona'];
  jobDescription: UseConversationResult['jobDescription'];
  /** Legacy narrative string, derived from persona.archetype. Kept for compat. */
  synthesis: string | null;
  /** Full Role Context Document — null until synthesis runs. */
  rcd: RoleContextDocument | null;

  // Domain-driven interview metadata
  currentDomain: string | null;
  domainCompletion: Record<string, DomainCompletionStatus> | undefined;

  // Loading & error
  isLoading: boolean;
  error: string | null;

  // Actions
  createAndStart: (baseline: RoleContextBaseline) => Promise<void>;
  respond: (answer: string, questionId: string) => Promise<void>;
  completeEarly: () => Promise<void>;
  submitFeedback: (questionId: string, feedback: string) => Promise<void>;
  /** Flag an RCD attribute for calibration. Returns a clarifying question. */
  flagAttribute: (flagType: string, domain: string, attribute: string, note?: string) => Promise<FlagAttributeResponse>;
  /** Submit the recruiter's answer to a calibration gap-fill question. */
  submitGapAnswer: (answer: string) => Promise<SubmitGapAnswerResponse>;
  /** Refetch the RCD from the server. */
  refreshRcd: () => Promise<void>;
  /** Hydrate directly to COMPLETE phase from a server-fetched context (resume path). */
  hydrateComplete: (data: { id: string; baseline: RoleContextBaseline; persona: CandidatePersona | null; jobDescription: GeneratedJobDescription | null; rcd?: RoleContextDocument | null }) => void;
  /** Restore a mid-interview session from server state without calling adapter.initialize(). */
  hydrateInterviewing: (data: {
    id: string;
    participantId: string;
    participantRole: ParticipantRole | null;
    baseline: RoleContextBaseline;
    exchanges: RoleContextExchange[];
    knowledgeState: Record<string, unknown>;
    questionBudget: number;
    currentDomain?: string | null | undefined;
    domainCompletion?: Record<string, DomainCompletionStatus> | undefined;
  }) => void;
  /** Wipe the whole discovery back to IDLE — used by step-indicator back-nav. */
  reset: () => void;
}

export function useRoleDiscovery(): UseRoleDiscoveryResult {
  const api = useApiClient();

  // Refs for values set once during initialize — no re-render needed; the
  // component will re-render from useConversation's isLoading/phase state changes.
  const contextIdRef = useRef<string | null>(null);
  const participantIdRef = useRef<string | null>(null);
  const participantRoleRef = useRef<ParticipantRole | null>(null);
  const baselineRef = useRef<RoleContextBaseline | null>(null);

  // Interview state is held in refs (not React state) so it survives adapter
  // re-creation when useApiClient returns a new object.
  const interviewStateRef = useRef<InterviewState | null>(null);
  const pendingKsuRef = useRef<Record<string, Record<string, unknown>> | undefined>(undefined);
  const pendingDcRef = useRef<Record<string, DomainCoverage> | undefined>(undefined);

  // Override state for hydrateComplete — bypasses useConversation when resuming
  // a COMPLETE context directly from the server without re-running the interview.
  const [overridePhase, setOverridePhase] = useState<DiscoveryPhase | null>(null);
  const [hydratedPersona, setHydratedPersona] = useState<CandidatePersona | null>(null);
  const [hydratedJobDescription, setHydratedJobDescription] = useState<GeneratedJobDescription | null>(null);
  const [hydratedRcd, setHydratedRcd] = useState<RoleContextDocument | null>(null);

  const roleDiscoveryAdapter: ConversationAdapter & {
    hydrateInterviewState(state: InterviewState): void;
    resetInterviewState(): void;
  } = useMemo(
    () => ({
      async initialize(config: AdapterConfig): Promise<QuestionTurnResult> {
        const baseline = config.baseline as unknown as RoleContextBaseline;

        // Step 1: Create role context — returns id + participantId for creator.
        const created = await api.post<CreateRoleContextResponse>(
          '/api/v1/role-contexts',
          { baseline },
        );
        contextIdRef.current = created.id;
        participantIdRef.current = created.participantId;
        baselineRef.current = baseline;

        // Step 2: Start → returns the hardcoded calibration question.
        const started = await api.post<StartRoleContextResponse>(
          `/api/v1/role-contexts/${created.id}/start`,
          { participantId: created.participantId },
        );

        interviewStateRef.current = {
          baseline: baseline as unknown as Record<string, unknown>,
          participantRole: null,
          questionBudget: started.progress.budget,
          exchanges: [{
            questionId: started.question.id,
            question: started.question.text,
            acknowledgment: started.acknowledgment,
            input: started.question.input,
          }],
          knowledgeState: {},
          coverage: started.progress.domains,
          phase: 'CONTEXT',
          questionsAsked: 0,
          synthesisReady: false,
          reasoning: 'Phase CONTEXT. Warm-up not yet complete.',
          urgentGaps: ['Warm-up not yet complete'],
          questionStack: [],
          currentDomain: null,
          domainCompletion: {
            team: 'pending',
            work: 'pending',
            bar: 'pending',
            codebase: 'pending',
            process: 'pending',
            why: 'pending',
          },
          domainQuestions: {},
          domainQuestionsDelivered: {
            team: 0,
            work: 0,
            bar: 0,
            codebase: 0,
            process: 0,
            why: 0,
          },
          domainFollowUpsDelivered: 0,
        };
        pendingKsuRef.current = undefined;
        pendingDcRef.current = undefined;

        return {
          type: 'question',
          acknowledgment: started.acknowledgment,
          question: started.question,
          progress: started.progress,
        };
      },

      async respond(answer: string, questionId: string): Promise<TurnResult> {
        const contextId = contextIdRef.current;
        const state = interviewStateRef.current;
        const participantId = participantIdRef.current;
        if (!contextId || !state || !participantId) {
          throw new Error('No context created');
        }

        const res = await api.post<PostRespondResponse>(
          `/api/v1/role-contexts/${contextId}/respond`,
          {
            answer,
            questionId,
            state,
            participantId,
          },
        );

        // Update local state with the server's authoritative state
        interviewStateRef.current = res.state;

        if (res.participantRole) {
          participantRoleRef.current = res.participantRole as ParticipantRole;
        }

        if (res.type === 'synthesis') {
          return {
            type: 'synthesis',
            synthesis: res.synthesis ?? '',
            persona: res.persona ?? null,
            jobDescription: res.jobDescription ?? null,
            progress: res.progress,
          };
        }

        return {
          type: 'question',
          acknowledgment: res.acknowledgment,
          question: res.question!,
          progress: res.progress,
        };
      },

      async completeEarly(): Promise<SynthesisResult> {
        const contextId = contextIdRef.current;
        const state = interviewStateRef.current;
        if (!contextId || !state) {
          throw new Error('No context created');
        }

        const synthRes = await api.post<PostSynthesizeResponse>(
          `/api/v1/role-contexts/${contextId}/synthesize`,
          { state },
        );

        return {
          type: 'synthesis',
          synthesis: synthRes.synthesis,
          persona: synthRes.persona,
          jobDescription: synthRes.jobDescription,
          progress: {
            asked: state.questionsAsked,
            budget: 0,
            domains: state.coverage,
            currentDomain: state.currentDomain,
            domainCompletion: state.domainCompletion,
          },
        };
      },

      async submitFeedback(questionId: string, feedback: string): Promise<void> {
        const contextId = contextIdRef.current;
        const participantId = participantIdRef.current;
        if (!contextId || !participantId) return;

        await api.post(`/api/v1/role-contexts/${contextId}/feedback`, {
          questionId,
          feedback,
          participantId,
        });
      },

      hydrateInterviewState(state: InterviewState): void {
        interviewStateRef.current = state;
        pendingKsuRef.current = undefined;
        pendingDcRef.current = undefined;
      },

      resetInterviewState(): void {
        interviewStateRef.current = null;
        pendingKsuRef.current = undefined;
        pendingDcRef.current = undefined;
      },
    }),
    [api],
  );

  const conv = useConversation(roleDiscoveryAdapter);

  const createAndStart = useCallback(
    async (baseline: RoleContextBaseline): Promise<void> => {
      // Starting a fresh interview — clear any prior hydration so stale persona
      // from a previous COMPLETE session can't leak into the new one.
      setOverridePhase(null);
      setHydratedPersona(null);
      setHydratedJobDescription(null);
      await conv.initialize({ baseline: baseline as unknown as Record<string, unknown> });
    },
    [conv],
  );

  const hydrateComplete = useCallback((data: {
    id: string;
    baseline: RoleContextBaseline;
    persona: CandidatePersona | null;
    jobDescription: GeneratedJobDescription | null;
    rcd?: RoleContextDocument | null;
  }): void => {
    contextIdRef.current = data.id;
    baselineRef.current = data.baseline;
    setOverridePhase('COMPLETE');
    setHydratedPersona(data.persona);
    setHydratedJobDescription(data.jobDescription);
    setHydratedRcd(data.rcd ?? null);
  }, []);

  const hydrateInterviewing = useCallback((data: {
    id: string;
    participantId: string;
    participantRole: ParticipantRole | null;
    baseline: RoleContextBaseline;
    exchanges: RoleContextExchange[];
    knowledgeState: Record<string, unknown>;
    questionBudget: number;
    currentDomain?: string | null | undefined;
    domainCompletion?: Record<string, DomainCompletionStatus> | undefined;
    domainQuestions?: Record<string, unknown[]> | undefined;
    domainQuestionsDelivered?: Record<string, number> | undefined;
    domainFollowUpsDelivered?: number | undefined;
  }): void => {
    contextIdRef.current = data.id;
    participantIdRef.current = data.participantId;
    participantRoleRef.current = data.participantRole;
    baselineRef.current = data.baseline;

    const defaultCoverage: Record<string, DomainCoverage> = {
      why: 'none',
      work: 'none',
      team: 'none',
      bar: 'none',
      codebase: 'none',
      process: 'none',
    };

    const domainCompletion = data.domainCompletion ?? {
      team: 'pending',
      work: 'pending',
      bar: 'pending',
      codebase: 'pending',
      process: 'pending',
      why: 'pending',
    };

    const domainQuestionsDelivered = data.domainQuestionsDelivered ?? {
      team: 0,
      work: 0,
      bar: 0,
      codebase: 0,
      process: 0,
      why: 0,
    };

      const reconstructedState: InterviewState = {
      baseline: data.baseline as unknown as Record<string, unknown>,
      participantRole: data.participantRole,
      questionBudget: data.questionBudget,
      exchanges: data.exchanges.map((ex) => ({
        questionId: ex.questionId,
        question: ex.question,
        acknowledgment: ex.acknowledgment,
        ...(ex.answer !== undefined ? { answer: ex.answer } : {}),
        input: ex.input,
      })),
      knowledgeState: data.knowledgeState as Record<string, Record<string, unknown>>,
      coverage: (data.knowledgeState._coverage as Record<string, DomainCoverage>) ?? defaultCoverage,
      phase: 'DISCOVERY',
      questionsAsked: data.exchanges.length,
      synthesisReady: false,
      questionStack: [],
      currentDomain: (data.currentDomain ?? null) as import('../lib/api/types').Domain | null,
      domainCompletion,
      domainQuestions: (data.domainQuestions ?? {}) as Record<string, Array<{ id: string; text: string; intent: string; drillingHints?: string[]; ladderingTarget?: string }>>,
      domainQuestionsDelivered,
      domainFollowUpsDelivered: data.domainFollowUpsDelivered ?? 0,
    };

    (roleDiscoveryAdapter as { hydrateInterviewState(state: InterviewState): void }).hydrateInterviewState(reconstructedState);

    conv.hydrateInterviewing({
      exchanges: data.exchanges,
      knowledgeState: data.knowledgeState,
      currentDomain: data.currentDomain,
      domainCompletion,
    });
  }, [conv, roleDiscoveryAdapter]);

  const reset = useCallback((): void => {
    contextIdRef.current = null;
    participantIdRef.current = null;
    participantRoleRef.current = null;
    baselineRef.current = null;
    setOverridePhase(null);
    setHydratedPersona(null);
    setHydratedJobDescription(null);
    setHydratedRcd(null);
    (roleDiscoveryAdapter as { resetInterviewState(): void }).resetInterviewState();
    conv.reset();
  }, [conv, roleDiscoveryAdapter]);

  const flagAttribute = useCallback(
    async (flagType: string, domain: string, attribute: string, note?: string): Promise<FlagAttributeResponse> => {
      const contextId = contextIdRef.current;
      if (!contextId) throw new Error('No context created');
      return api.post<FlagAttributeResponse>(`/api/v1/role-contexts/${contextId}/calibrate`, {
        flagType,
        domain,
        attribute,
        note,
      });
    },
    [api],
  );

  const submitGapAnswer = useCallback(
    async (answer: string): Promise<SubmitGapAnswerResponse> => {
      const contextId = contextIdRef.current;
      if (!contextId) throw new Error('No context created');
      const res = await api.post<SubmitGapAnswerResponse>(`/api/v1/role-contexts/${contextId}/calibrate/respond`, {
        answer,
      });
      if (res.rcd) setHydratedRcd(res.rcd);
      return res;
    },
    [api],
  );

  const refreshRcd = useCallback(async (): Promise<void> => {
    const contextId = contextIdRef.current;
    if (!contextId) return;
    try {
      const ctx = await api.get<RoleContextFullState>(`/api/v1/role-contexts/${contextId}`);
      setHydratedRcd(ctx.rcd ?? null);
    } catch {
      // Non-fatal — RCD may not exist yet
    }
  }, [api]);

  // Fetch RCD when conversation naturally reaches COMPLETE (backend may not
  // include it in the synthesis response yet).
  useEffect(() => {
    if (conv.phase !== 'COMPLETE') return;
    if (hydratedRcd) return;
    void refreshRcd();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.phase]);

  return {
    phase: (overridePhase ?? conv.phase) as DiscoveryPhase,
    contextId: contextIdRef.current,
    participantId: participantIdRef.current,
    participantRole: participantRoleRef.current,
    adapter: roleDiscoveryAdapter,
    conv,
    acknowledgment: conv.acknowledgment,
    currentQuestion: conv.currentQuestion,
    progress: conv.progress,
    pastExchanges: conv.pastExchanges,
    streamingText: conv.streamingText,
    baseline: baselineRef.current,
    persona: hydratedPersona ?? conv.persona,
    jobDescription: hydratedJobDescription ?? conv.jobDescription,
    synthesis: conv.synthesis,
    rcd: hydratedRcd,
    currentDomain: interviewStateRef.current?.currentDomain ?? null,
    domainCompletion: interviewStateRef.current?.domainCompletion,
    isLoading: conv.isLoading,
    error: conv.error,
    createAndStart,
    respond: conv.respond,
    completeEarly: conv.completeEarly,
    submitFeedback: conv.submitFeedback,
    hydrateComplete,
    hydrateInterviewing,
    reset,
    flagAttribute,
    submitGapAnswer,
    refreshRcd,
  };
}
