import { useCallback, useEffect, useState } from 'react';
import type {
  MatchDecisionHistory,
  MatchDecisionResult,
  MatchDecisionVerdict,
} from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseMatchDecisionsResult {
  history: MatchDecisionHistory | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  recordDecision: (input: RecordDecisionInput) => Promise<MatchDecisionResult>;
}

export interface RecordDecisionInput {
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

  const recordDecision = useCallback(async (input: RecordDecisionInput): Promise<MatchDecisionResult> => {
    if (!candidateId) throw new Error('candidateId required');
    const result = await api.post<MatchDecisionResult>(
      `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/match-decisions`,
      input,
    );
    void refetch();
    return result;
  }, [api, candidateId, refetch]);

  useEffect(() => {
    if (candidateId) {
      void refetch();
    } else {
      setHistory(null);
    }
  }, [refetch, candidateId]);

  return { history, isLoading, error, refetch, recordDecision };
}
