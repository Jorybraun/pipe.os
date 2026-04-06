/**
 * useRoleDiscovery — manages the full role discovery interview flow (ADR-028).
 *
 * State machine: IDLE → BASELINE → CALIBRATING → INTERVIEWING → COMPLETE
 *
 * Now participant-aware: tracks participantId and sends it with every request.
 * The calibration question is always first (hardcoded, not agent-generated).
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
  ParticipantRole,
} from '../lib/api/types';

export type DiscoveryPhase = 'IDLE' | 'BASELINE' | 'CALIBRATING' | 'INTERVIEWING' | 'COMPLETE';

export interface PastExchange {
  questionId: string;
  acknowledgment: string;
  questionText: string;
  answer: string;
  feedback?: string;
}

export interface UseRoleDiscoveryResult {
  phase: DiscoveryPhase;
  contextId: string | null;
  participantId: string | null;
  participantRole: ParticipantRole | null;

  // Current turn
  acknowledgment: string | null;
  currentQuestion: RoleContextQuestion | null;
  progress: RoleContextProgress | null;

  // History
  pastExchanges: PastExchange[];

  // Baseline (stored for pipeline creation)
  baseline: RoleContextBaseline | null;

  // Synthesis (when COMPLETE)
  synthesis: string | null;

  // Loading & error
  isLoading: boolean;
  error: string | null;

  // Actions
  createAndStart: (baseline: RoleContextBaseline, questionBudget?: number) => Promise<void>;
  respond: (answer: string, questionId: string) => Promise<void>;
  completeEarly: () => Promise<void>;
  submitFeedback: (questionId: string, feedback: string) => Promise<void>;
}

export function useRoleDiscovery(): UseRoleDiscoveryResult {
  const api = useApiClient();

  const [phase, setPhase] = useState<DiscoveryPhase>('IDLE');
  const [contextId, setContextId] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participantRole, setParticipantRole] = useState<ParticipantRole | null>(null);
  const [acknowledgment, setAcknowledgment] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<RoleContextQuestion | null>(null);
  const [progress, setProgress] = useState<RoleContextProgress | null>(null);
  const [pastExchanges, setPastExchanges] = useState<PastExchange[]>([]);
  const [baseline, setBaseline] = useState<RoleContextBaseline | null>(null);
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
        // Step 1: Create (returns participantId for the creator)
        const created = await api.post<CreateRoleContextResponse>(
          '/api/v1/role-contexts',
          { baseline, questionBudget },
        );
        const newId = created.id;
        const newParticipantId = created.participantId;
        setContextId(newId);
        setParticipantId(newParticipantId);
        setBaseline(baseline);

        // Step 2: Start → returns the hardcoded calibration question
        const started = await api.post<StartRoleContextResponse>(
          `/api/v1/role-contexts/${newId}/start`,
          { participantId: newParticipantId },
        );
        setAcknowledgment(started.acknowledgment);
        setCurrentQuestion(started.question);
        setProgress(started.progress);
        setPhase('CALIBRATING');
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
      if (!contextId || !participantId) throw new Error('No context created');
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
          { answer, questionId, participantId },
        );

        setProgress(data.progress);

        if (data.status === 'COMPLETE') {
          const synthData = data as RespondSynthesisResponse;
          setSynthesis(synthData.synthesis);
          setCurrentQuestion(null);
          setAcknowledgment(null);
          setPhase('COMPLETE');
        } else {
          // After calibration response, the agent returns participantRole
          if ('participantRole' in data && data.participantRole) {
            setParticipantRole(data.participantRole);
          }
          setAcknowledgment(data.acknowledgment);
          setCurrentQuestion(data.question);
          setPhase('INTERVIEWING');
        }
      } catch (err) {
        handleError(err, 'respond');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [api, contextId, participantId, currentQuestion, acknowledgment],
  );

  const completeEarly = useCallback(async (): Promise<void> => {
    if (!contextId || !participantId) throw new Error('No context created');
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.post<RespondSynthesisResponse>(
        `/api/v1/role-contexts/${contextId}/complete`,
        { participantId },
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
  }, [api, contextId, participantId]);

  const submitFeedback = useCallback(
    async (questionId: string, feedback: string): Promise<void> => {
      if (!contextId || !participantId) return;
      try {
        await api.post(`/api/v1/role-contexts/${contextId}/feedback`, {
          participantId,
          questionId,
          feedback,
        });
        // Update local state to reflect feedback
        setPastExchanges((prev) =>
          prev.map((ex) =>
            ex.questionId === questionId ? { ...ex, feedback } : ex,
          ),
        );
      } catch (err) {
        console.error('[useRoleDiscovery] feedback failed:', err);
      }
    },
    [api, contextId, participantId],
  );

  return {
    phase,
    contextId,
    participantId,
    participantRole,
    acknowledgment,
    currentQuestion,
    progress,
    pastExchanges,
    baseline,
    synthesis,
    isLoading,
    error,
    createAndStart,
    respond,
    completeEarly,
    submitFeedback,
  };
}
