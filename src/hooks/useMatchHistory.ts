import { useCallback, useEffect, useState } from 'react';
import type { MatchHistoryResponse } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseMatchHistoryResult {
  history: MatchHistoryResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useMatchHistory(candidateId: string, limit = 20): UseMatchHistoryResult {
  const api = useApiClient();
  const [history, setHistory] = useState<MatchHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<MatchHistoryResponse>(
        `/api/v1/candidates/${candidateId}/living-context/match-history?limit=${limit}`,
      );
      setHistory(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load match history'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId, limit]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { history, isLoading, error, refetch };
}
