import { useState, useEffect, useCallback } from 'react';
import type { MatchDecisionHistory, MatchDecisionVerdict } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseMatchDecisionsResult {
  history: MatchDecisionHistory | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  recordDecision: (params: RecordDecisionParams) => Promise<void>;
  isRecording: boolean;
}

export interface RecordDecisionParams {
  matchRunId: string;
  challengeId: string;
  repoId: string;
  prNumber: number;
  verdict: MatchDecisionVerdict;
  reason?: string;
  citedAlignmentIds?: string[];
  notes?: string;
}

export function useMatchDecisions(
  candidateId: string | null,
): UseMatchDecisionsResult {
  const api = useApiClient();
  const [history, setHistory] = useState<MatchDecisionHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<MatchDecisionHistory>(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/match-decisions`,
      );
      setHistory(response);
    } catch (cause) {
      console.error('[useMatchDecisions] fetch failed:', { candidateId, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load match decisions'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId]);

  useEffect(() => {
    if (candidateId) {
      void refetch();
    } else {
      setHistory(null);
    }
  }, [refetch, candidateId]);

  const recordDecision = useCallback(async (params: RecordDecisionParams): Promise<void> => {
    if (!candidateId) return;
    setIsRecording(true);
    try {
      await api.post(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/match-decision`,
        params,
      );
      await refetch();
    } catch (cause) {
      console.error('[useMatchDecisions] record failed:', { candidateId, cause });
      throw cause instanceof Error ? cause : new Error('Failed to record decision');
    } finally {
      setIsRecording(false);
    }
  }, [api, candidateId, refetch]);

  return { history, isLoading, error, refetch, recordDecision, isRecording };
}
