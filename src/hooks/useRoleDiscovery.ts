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
  CreateRoleContextResponse,
  StartRoleContextResponse,
  RespondRoleContextResponse,
  RespondSynthesisResponse,
  RespondQuestionResponse,
  FlagAttributeResponse,
  SubmitGapAnswerResponse,
} from '../lib/api/types';
import type {
  ConversationAdapter,
  AdapterConfig,
  QuestionTurnResult,
  SynthesisResult,
  TurnResult,
  StreamEvent,
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

  // Loading & error
  isLoading: boolean;
  error: string | null;

  // Actions
  createAndStart: (baseline: RoleContextBaseline, questionBudget?: number) => Promise<void>;
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
    questionsAsked: number;
    questionBudget: number;
    knowledgeState: Record<string, unknown>;
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

  // Override state for hydrateComplete — bypasses useConversation when resuming
  // a COMPLETE context directly from the server without re-running the interview.
  const [overridePhase, setOverridePhase] = useState<DiscoveryPhase | null>(null);
  const [hydratedPersona, setHydratedPersona] = useState<CandidatePersona | null>(null);
  const [hydratedJobDescription, setHydratedJobDescription] = useState<GeneratedJobDescription | null>(null);
  const [hydratedRcd, setHydratedRcd] = useState<RoleContextDocument | null>(null);

  const roleDiscoveryAdapter: ConversationAdapter = useMemo<ConversationAdapter>(
    () => ({
      async initialize(config: AdapterConfig): Promise<QuestionTurnResult> {
        const baseline = config.baseline as unknown as RoleContextBaseline;
        const questionBudget = config.questionBudget ?? 10;

        // Step 1: Create role context — returns id + participantId for creator.
        const created = await api.post<CreateRoleContextResponse>(
          '/api/v1/role-contexts',
          { baseline, questionBudget },
        );
        contextIdRef.current = created.id;
        participantIdRef.current = created.participantId;
        baselineRef.current = baseline;

        // Step 2: Start → returns the hardcoded calibration question.
        const started = await api.post<StartRoleContextResponse>(
          `/api/v1/role-contexts/${created.id}/start`,
          { participantId: created.participantId },
        );

        return {
          type: 'question',
          acknowledgment: started.acknowledgment,
          question: started.question,
          progress: started.progress,
        };
      },

      async respond(answer: string, questionId: string): Promise<TurnResult> {
        const contextId = contextIdRef.current;
        const participantId = participantIdRef.current;
        if (!contextId || !participantId) {
          throw new Error('No context created');
        }

        const data = await api.post<RespondRoleContextResponse>(
          `/api/v1/role-contexts/${contextId}/respond`,
          { answer, questionId, participantId },
        );

        if (data.status === 'COMPLETE') {
          const synth = data as RespondSynthesisResponse;
          if (synth.rcd) setHydratedRcd(synth.rcd);
          const result: SynthesisResult = {
            type: 'synthesis',
            synthesis: synth.synthesis,
            persona: synth.persona,
            jobDescription: synth.jobDescription,
            progress: synth.progress,
          };
          return result;
        }

        // INTERVIEWING turn — capture participantRole on first answer.
        const question = data as RespondQuestionResponse;
        if (question.participantRole) {
          participantRoleRef.current = question.participantRole;
        }

        const result: QuestionTurnResult = {
          type: 'question',
          acknowledgment: question.acknowledgment,
          question: question.question,
          progress: question.progress,
        };
        return result;
      },

      async *respondStream(answer: string, questionId: string): AsyncGenerator<StreamEvent> {
        const contextId = contextIdRef.current;
        const participantId = participantIdRef.current;
        if (!contextId || !participantId) {
          yield { event: 'error', message: 'No context created' };
          return;
        }

        // Type for the streaming done payload (matches backend SSE done event)
        interface StreamDonePayload {
          participantId: string;
          synthesis?: string;
          persona?: RespondSynthesisResponse['persona'];
          jobDescription?: string;
          rcd?: RoleContextDocument;
          acknowledgment?: string;
          question?: RespondQuestionResponse['question'];
          knowledgeState?: Record<string, unknown>;
          progress: RespondRoleContextResponse['progress'];
        }

        for await (const event of api.postStream<StreamDonePayload>(
          `/api/v1/role-contexts/${contextId}/respond`,
          { answer, questionId, participantId },
        )) {
          if (event.event === 'chunk') {
            yield { event: 'chunk', text: event.text };
          } else if (event.event === 'done') {
            const data = event.data;
            // Check if synthesis (has synthesis field) or question (has question field)
            if (data.synthesis !== undefined) {
              if (data.rcd) setHydratedRcd(data.rcd);
              const result: SynthesisResult = {
                type: 'synthesis',
                synthesis: data.synthesis,
                persona: data.persona ?? null,
                jobDescription: data.jobDescription ?? null,
                progress: data.progress,
              };
              yield { event: 'done', result };
            } else if (data.question) {
              const result: QuestionTurnResult = {
                type: 'question',
                acknowledgment: data.acknowledgment ?? '',
                question: data.question,
                progress: data.progress,
              };
              yield { event: 'done', result };
            }
          } else if (event.event === 'error') {
            yield { event: 'error', message: event.message };
          }
        }
      },

      async completeEarly(): Promise<SynthesisResult> {
        const contextId = contextIdRef.current;
        const participantId = participantIdRef.current;
        if (!contextId || !participantId) {
          throw new Error('No context created');
        }

        const data = await api.post<RespondSynthesisResponse>(
          `/api/v1/role-contexts/${contextId}/complete`,
          { participantId },
        );

        if (data.rcd) setHydratedRcd(data.rcd);

        return {
          type: 'synthesis',
          synthesis: data.synthesis,
          persona: data.persona,
          jobDescription: data.jobDescription,
          progress: data.progress,
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
    }),
    [api],
  );

  const conv = useConversation(roleDiscoveryAdapter);

  const createAndStart = useCallback(
    async (baseline: RoleContextBaseline, questionBudget = 10): Promise<void> => {
      // Starting a fresh interview — clear any prior hydration so stale persona
      // from a previous COMPLETE session can't leak into the new one.
      setOverridePhase(null);
      setHydratedPersona(null);
      setHydratedJobDescription(null);
      await conv.initialize({ baseline: baseline as unknown as Record<string, unknown>, questionBudget });
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
    questionsAsked: number;
    questionBudget: number;
    knowledgeState: Record<string, unknown>;
  }): void => {
    contextIdRef.current = data.id;
    participantIdRef.current = data.participantId;
    participantRoleRef.current = data.participantRole;
    baselineRef.current = data.baseline;
    conv.hydrateInterviewing({
      exchanges: data.exchanges,
      questionsAsked: data.questionsAsked,
      questionBudget: data.questionBudget,
      knowledgeState: data.knowledgeState,
    });
  }, [conv]);

  const reset = useCallback((): void => {
    contextIdRef.current = null;
    participantIdRef.current = null;
    participantRoleRef.current = null;
    baselineRef.current = null;
    setOverridePhase(null);
    setHydratedPersona(null);
    setHydratedJobDescription(null);
    setHydratedRcd(null);
    conv.reset();
  }, [conv]);

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
