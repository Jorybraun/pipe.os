/**
 * useConversation — generic conversation state machine.
 *
 * Extracts the phase transitions and exchange-archiving logic that was
 * previously embedded in useRoleDiscovery into a reusable hook that works
 * with any ConversationAdapter implementation.
 *
 * State machine: IDLE → CALIBRATING → INTERVIEWING → COMPLETE
 *
 * IDLE        — no session yet; waiting for initialize()
 * CALIBRATING — first question on screen (the adapter's calibration turn)
 * INTERVIEWING — subsequent questions after the first answer is submitted
 * COMPLETE    — synthesis received; currentQuestion is null
 */

import { useState, useCallback } from 'react';
import { ApiError } from '../lib/api/types';
import type {
  RoleContextQuestion,
  RoleContextProgress,
  RoleContextExchange,
  DomainCoverage,
  DomainCompletionStatus,
  CandidatePersona,
  GeneratedJobDescription,
} from '../lib/api/types';
import type {
  ConversationAdapter,
  AdapterConfig,
  PastExchange,
  RespondMedia,
  SynthesisResult,
} from '../components/AIChat/types';

// ─── Public types ─────────────────────────────────────────────────────────────

export type ConversationPhase = 'IDLE' | 'CALIBRATING' | 'INTERVIEWING' | 'COMPLETE';

export interface UseConversationResult {
  // Phase
  phase: ConversationPhase;

  // Current turn
  currentQuestion: RoleContextQuestion | null;
  acknowledgment: string | null;
  progress: RoleContextProgress | null;

  // History
  pastExchanges: PastExchange[];

  // Streaming (populated while response is being streamed)
  streamingText: string;

  // Synthesis outputs (populated when phase === 'COMPLETE')
  persona: CandidatePersona | null;
  jobDescription: GeneratedJobDescription | null;
  synthesis: string | null;
  transcript: Array<{ role: 'user' | 'model'; text: string; videoR2Key?: string }> | null;

  // Loading / error
  isLoading: boolean;
  error: string | null;

  // Actions
  initialize: (config: AdapterConfig) => Promise<void>;
  respond: (answer: string, questionId: string, media?: RespondMedia) => Promise<void>;
  completeEarly: () => Promise<void>;
  submitFeedback: (questionId: string, feedback: string) => Promise<void>;
  /**
   * Restore INTERVIEWING state from server exchanges — used when resuming a
   * mid-interview session. Skips adapter.initialize(); the adapter's refs
   * (contextId/participantId) must be set by the caller before calling this.
   */
  hydrateInterviewing: (data: {
    exchanges: RoleContextExchange[];
    knowledgeState: Record<string, unknown>;
    currentDomain?: string | null | undefined;
    domainCompletion?: Record<string, DomainCompletionStatus> | undefined;
  }) => void;
  /** Wipe all conversation state back to IDLE — used by step-nav back-buttons. */
  reset: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useConversation(adapter: ConversationAdapter): UseConversationResult {
  const [phase, setPhase] = useState<ConversationPhase>('IDLE');
  const [acknowledgment, setAcknowledgment] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<RoleContextQuestion | null>(null);
  const [progress, setProgress] = useState<RoleContextProgress | null>(null);
  const [pastExchanges, setPastExchanges] = useState<PastExchange[]>([]);
  const [persona, setPersona] = useState<CandidatePersona | null>(null);
  const [jobDescription, setJobDescription] = useState<GeneratedJobDescription | null>(null);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Array<{ role: 'user' | 'model'; text: string; videoR2Key?: string }> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');

  // ─── Error handling ──────────────────────────────────────────────────────

  const handleError = (err: unknown, context: string): void => {
    if (err instanceof ApiError) {
      console.error(`[useConversation] ${context}:`, err.code, err.message);
      setError(err.message);
    } else {
      const message = err instanceof Error ? err.message : `Failed to ${context}`;
      console.error(`[useConversation] ${context}:`, message);
      setError(message);
    }
  };

  // ─── Synthesis helper — shared by respond() and completeEarly() ──────────

  const applySynthesis = (result: SynthesisResult, resolvedProgress: RoleContextProgress): void => {
    setSynthesis(result.synthesis);
    setPersona(result.persona);
    setJobDescription(result.jobDescription);
    setTranscript(result.transcript ?? null);
    setProgress(resolvedProgress);
    setCurrentQuestion(null);
    setAcknowledgment(null);
    setPhase('COMPLETE');
  };

  // ─── Actions ─────────────────────────────────────────────────────────────

  const initialize = useCallback(
    async (config: AdapterConfig): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await adapter.initialize(config);
        setAcknowledgment(result.acknowledgment);
        setCurrentQuestion(result.question);
        setProgress(result.progress);
        setPhase('CALIBRATING');
      } catch (err) {
        handleError(err, 'initialize');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [adapter],
  );

  const respond = useCallback(
    async (answer: string, questionId: string, media?: RespondMedia): Promise<void> => {
      setIsLoading(true);
      setError(null);
      setStreamingText('');

      // Archive the current question before firing the network request so the
      // UI can optimistically reflect the submitted answer immediately.
      if (currentQuestion && acknowledgment) {
        const exchange: PastExchange = {
          questionId: currentQuestion.id,
          acknowledgment,
          questionText: currentQuestion.text,
          answer,
        };
        setPastExchanges((prev) => [...prev, exchange]);
      }

      try {
        // Use streaming if available
        console.log('[useConversation] respondStream available:', !!adapter.respondStream);
        if (adapter.respondStream) {
          for await (const event of adapter.respondStream(answer, questionId, media)) {
            if (event.event === 'chunk') {
              setStreamingText((prev) => prev + event.text);
            } else if (event.event === 'done') {
              setStreamingText('');
              const result = event.result;
              if (result.type === 'synthesis') {
                applySynthesis(result, result.progress);
              } else {
                setAcknowledgment(result.acknowledgment);
                setCurrentQuestion(result.question);
                setProgress(result.progress);
                setPhase('INTERVIEWING');
              }
            } else if (event.event === 'error') {
              setError(event.message);
            }
          }
        } else {
          // Non-streaming fallback
          const result = await adapter.respond(answer, questionId, media);

          if (result.type === 'synthesis') {
            applySynthesis(result, result.progress);
          } else {
            setAcknowledgment(result.acknowledgment);
            setCurrentQuestion(result.question);
            setProgress(result.progress);
            setPhase('INTERVIEWING');
          }
        }
      } catch (err) {
        handleError(err, 'respond');
        throw err;
      } finally {
        setIsLoading(false);
        setStreamingText('');
      }
    },
    [adapter, currentQuestion, acknowledgment],
  );

  const completeEarly = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await adapter.completeEarly();
      applySynthesis(result, result.progress);
    } catch (err) {
      handleError(err, 'complete early');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [adapter]);

  const submitFeedback = useCallback(
    async (questionId: string, feedback: string): Promise<void> => {
      if (!adapter.submitFeedback) return;
      try {
        await adapter.submitFeedback(questionId, feedback);
        setPastExchanges((prev) =>
          prev.map((ex) =>
            ex.questionId === questionId ? { ...ex, feedback } : ex,
          ),
        );
      } catch (err) {
        // Feedback failures are non-fatal — log but do not surface to the user.
        console.error('[useConversation] submitFeedback failed:', err);
      }
    },
    [adapter],
  );

  const hydrateInterviewing = useCallback((data: {
    exchanges: RoleContextExchange[];
    knowledgeState: Record<string, unknown>;
    currentDomain?: string | null | undefined;
    domainCompletion?: Record<string, DomainCompletionStatus> | undefined;
  }): void => {
    const { exchanges, knowledgeState, currentDomain, domainCompletion } = data;

    // Last exchange without an answer is the current question awaiting response.
    const lastExchange = exchanges[exchanges.length - 1];
    const hasCurrentQuestion = !!lastExchange && !lastExchange.answer;
    const currentExchange = hasCurrentQuestion ? lastExchange : null;
    const answeredExchanges = hasCurrentQuestion ? exchanges.slice(0, -1) : exchanges;

    const restored: PastExchange[] = answeredExchanges
      .filter((ex) => ex.questionId !== 'q-calibration' && ex.answer !== undefined)
      .map((ex) => ({
        questionId: ex.questionId,
        acknowledgment: ex.acknowledgment,
        questionText: ex.question,
        answer: ex.answer as string,
      }));

    const restoredQuestion: RoleContextQuestion | null = currentExchange
      ? { id: currentExchange.questionId, text: currentExchange.question, input: currentExchange.input }
      : null;

    const defaultDomains: Record<string, DomainCoverage> = { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' };
    const coverage = (knowledgeState['_coverage'] as Record<string, DomainCoverage> | undefined) ?? defaultDomains;

    setPastExchanges(restored);
    setCurrentQuestion(restoredQuestion);
    setAcknowledgment(currentExchange?.acknowledgment ?? null);
    setProgress({ asked: exchanges.length, budget: 0, domains: coverage, currentDomain, domainCompletion });
    setPhase('INTERVIEWING');
    setIsLoading(false);
    setError(null);
    setStreamingText('');
  }, []);

  const reset = useCallback((): void => {
    setPhase('IDLE');
    setAcknowledgment(null);
    setCurrentQuestion(null);
    setProgress(null);
    setPastExchanges([]);
    setPersona(null);
    setJobDescription(null);
    setSynthesis(null);
    setIsLoading(false);
    setError(null);
    setStreamingText('');
  }, []);

  // ─── Result ───────────────────────────────────────────────────────────────

  return {
    phase,
    currentQuestion,
    acknowledgment,
    progress,
    pastExchanges,
    streamingText,
    persona,
    jobDescription,
    synthesis,
    transcript,
    isLoading,
    error,
    initialize,
    respond,
    completeEarly,
    submitFeedback,
    hydrateInterviewing,
    reset,
  };
}
