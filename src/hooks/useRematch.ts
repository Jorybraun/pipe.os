import { useCallback, useState } from 'react';
import type { RematchResult } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseRematchResult {
  rematch: () => Promise<RematchResult | null>;
  result: RematchResult | null;
  isRunning: boolean;
  error: Error | null;
}

export function useRematch(candidateId: string | null): UseRematchResult {
  const api = useApiClient();
  const [result, setResult] = useState<RematchResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const rematch = useCallback(async (): Promise<RematchResult | null> => {
    if (!candidateId) return null;
    setIsRunning(true);
    setError(null);
    try {
      const response = await api.post<RematchResult>(
        `/api/v1/candidates/${candidateId}/living-context/rematch`,
        {},
      );
      setResult(response);
      return response;
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error('Rematch failed');
      setError(err);
      return null;
    } finally {
      setIsRunning(false);
    }
  }, [api, candidateId]);

  return { rematch, result, isRunning, error };
}
