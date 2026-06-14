import { useCallback, useEffect, useState } from 'react';
import type { LivingContextReadModel, LivingContextResponse } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseLivingContextResult {
  livingContext: LivingContextReadModel | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useLivingContext(candidateId: string): UseLivingContextResult {
  const api = useApiClient();
  const [livingContext, setLivingContext] = useState<LivingContextReadModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<LivingContextResponse>(
        `/api/v1/candidates/${candidateId}/living-context`,
      );
      setLivingContext(response.livingContext);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load living context'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { livingContext, isLoading, error, refetch };
}
