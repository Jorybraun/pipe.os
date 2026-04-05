/**
 * useRoleDiscovery — manages the full role discovery interview flow.
 *
 * State machine: IDLE → BASELINE → INTERVIEWING → COMPLETE
 *
 * Replaces the Amplify-era hook. Calls the Cloudflare Worker API
 * via useApiClient (Clerk JWT auth).
 *
 * Usage:
 *   const rd = useRoleDiscovery();
 *   await rd.createContext(baseline, budget);  // → BASELINE
 *   await rd.startInterview();                 // → INTERVIEWING (first question)
 *   await rd.respond(answer, questionId);      // → next question or COMPLETE
 *   await rd.completeEarly();                  // → COMPLETE (force synthesis)
 */

import { useState, useCallback } from 'react';
import { useApiClient } from './useApiClient';
import { ApiError } from '../lib/api/types';
import type {
  RoleContextBaseline,
  RoleContextQuestion,
  RoleContextProgress,
  CreateRoleContextResponse,
  StartRoleContextResponse,
  RespondRoleContextResponse,
  RespondSynthesisResponse,
} from '../lib/api/types';

export type DiscoveryPhase = 'IDLE' | 'BASELINE' | 'INTERVIEWING' | 'COMPLETE';

export interface PastExchange {
  questionId: string;
  acknowledgment: string;
  questionText: string;
  answer: string;
}

export interface UseRoleDiscoveryResult {
  phase: DiscoveryPhase;
  contextId: string | null;

  // Current turn
  acknowledgment: string | null;
  currentQuestion: RoleContextQuestion | null;
  progress: RoleContextProgress | null;

  // History
  pastExchanges: PastExchange[];

  // Synthesis (when COMPLETE)
  synthesis: string | null;

  // Loading & error
  isLoading: boolean;
  error: string | null;

  // Actions
  createAndStart: (baseline: RoleContextBaseline, questionBudget?: number) => Promise<void>;
  respond: (answer: string, questionId: string) => Promise<void>;
  completeEarly: () => Promise<void>;
}

export function useRoleDiscovery(): UseRoleDiscoveryResult {
  const api = useApiClient();

  const [phase, setPhase] = useState<DiscoveryPhase>('IDLE');
  const [contextId, setContextId] = useState<string | null>(null);
  const [acknowledgment, setAcknowledgment] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<RoleContextQuestion | null>(null);
  const [progress, setProgress] = useState<RoleContextProgress | null>(null);
  const [pastExchanges, setPastExchanges] = useState<PastExchange[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleError = (err: unknown, context: string): void => {
    if (err instanceof ApiError) {
      console.error(`[useRoleDiscovery] ${context}:`, err.code, err.message);
      setError(err.message);
    } else {
      const message = err instanceof Error ? err.message : `Failed to ${context}`;
      console.error(`[useRoleDiscovery] ${context}:`, message);
      setError(message);
    }
  };

  const createAndStart = useCallback(
    async (baseline: RoleContextBaseline, questionBudget = 10): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        // Step 1: Create
        const created = await api.post<CreateRoleContextResponse>(
          '/api/v1/role-contexts',
          { baseline, questionBudget },
        );
        const newId = created.id;
        setContextId(newId);

        // Step 2: Start (use newId directly — don't rely on React state)
        const started = await api.post<StartRoleContextResponse>(
          `/api/v1/role-contexts/${newId}/start`,
          {},
        );
        setAcknowledgment(started.acknowledgment);
        setCurrentQuestion(started.question);
        setProgress(started.progress);
        setPhase('INTERVIEWING');
      } catch (err) {
        handleError(err, 'create and start');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api],
  );

  const respond = useCallback(
    async (answer: string, questionId: string): Promise<void> => {
      if (!contextId) throw new Error('No context created');
      setIsLoading(true);
      setError(null);

      // Archive current question before sending
      if (currentQuestion && acknowledgment) {
        setPastExchanges((prev) => [
          ...prev,
          {
            questionId: currentQuestion.id,
            acknowledgment,
            questionText: currentQuestion.text,
            answer,
          },
        ]);
      }

      try {
        const data = await api.post<RespondRoleContextResponse>(
          `/api/v1/role-contexts/${contextId}/respond`,
          { answer, questionId },
        );

        setProgress(data.progress);

        if (data.status === 'COMPLETE') {
          const synthData = data as RespondSynthesisResponse;
          setSynthesis(synthData.synthesis);
          setCurrentQuestion(null);
          setAcknowledgment(null);
          setPhase('COMPLETE');
        } else {
          setAcknowledgment(data.acknowledgment);
          setCurrentQuestion(data.question);
        }
      } catch (err) {
        handleError(err, 'respond');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api, contextId, currentQuestion, acknowledgment],
  );

  const completeEarly = useCallback(async (): Promise<void> => {
    if (!contextId) throw new Error('No context created');
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.post<RespondSynthesisResponse>(
        `/api/v1/role-contexts/${contextId}/complete`,
        {},
      );
      setSynthesis(data.synthesis);
      setProgress(data.progress);
      setCurrentQuestion(null);
      setAcknowledgment(null);
      setPhase('COMPLETE');
    } catch (err) {
      handleError(err, 'complete');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [api, contextId]);

  return {
    phase,
    contextId,
    acknowledgment,
    currentQuestion,
    progress,
    pastExchanges,
    synthesis,
    isLoading,
    error,
    createAndStart,
    respond,
    completeEarly,
  };
}
