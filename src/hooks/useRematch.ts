import { useCallback, useState } from 'react';
import { useApiClient } from './useApiClient';

export interface RematchResult {
  candidateId: string;
  status: string;
  matchRunId: string | null;
  repoId: string | null;
  prNumber: number | null;
  evaluatedCount: number;
  topChallenge: {
    repoId: string;
    prNumber: number;
    rank: number;
    compositeScore: number;
  } | null;
  reason?: string;
}

export interface UseRematchReturn {
  triggerRematch: () => Promise<RematchResult | null>;
  result: RematchResult | null;
  isLoading: boolean;
  error: Error | null;
}

export function useRematch(candidateId: string): UseRematchReturn {
  const api = useApiClient();
  const [result, setResult] = useState<RematchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const triggerRematch = useCallback(async (): Promise<RematchResult | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.post<RematchResult>(
        `/api/v1/candidates/${candidateId}/living-context/rematch`,
        {},
      );
      setResult(response);
      return response;
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      setError(wrapped);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId]);

  return { triggerRematch, result, isLoading, error };
}
