import { useCallback, useEffect, useState } from 'react';
import type { LivingContextReadModel, LivingContextResponse } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseLivingContextResult {
  livingContext: LivingContextReadModel | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export interface UseLivingContextOptions {
  endpoint: string;
  initialLivingContext?: LivingContextReadModel | null;
}

function unwrapLivingContext(
  response: LivingContextResponse | LivingContextReadModel | { interview?: { livingContext?: LivingContextReadModel | null } },
): LivingContextReadModel {
  if (
    response
    && typeof response === 'object'
    && 'livingContext' in response
    && response.livingContext
  ) {
    return response.livingContext;
  }
  if (
    response
    && typeof response === 'object'
    && 'interview' in response
    && response.interview
    && typeof response.interview === 'object'
    && 'livingContext' in response.interview
    && response.interview.livingContext
  ) {
    return response.interview.livingContext;
  }
  return response as LivingContextReadModel;
}

export function useLivingContext(
  candidateIdOrOptions: string | UseLivingContextOptions,
): UseLivingContextResult {
  const api = useApiClient();
  const endpoint = typeof candidateIdOrOptions === 'string'
    ? `/api/v1/candidates/${candidateIdOrOptions}/living-context`
    : candidateIdOrOptions.endpoint;
  const initialLivingContext = typeof candidateIdOrOptions === 'string'
    ? null
    : candidateIdOrOptions.initialLivingContext ?? null;
  const [livingContext, setLivingContext] = useState<LivingContextReadModel | null>(initialLivingContext);
  const [isLoading, setIsLoading] = useState(initialLivingContext === null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLivingContext(initialLivingContext);
    setIsLoading(initialLivingContext === null);
    setError(null);
  }, [endpoint, initialLivingContext]);

  const refetch = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<
        LivingContextResponse
        | LivingContextReadModel
        | { interview?: { livingContext?: LivingContextReadModel | null } }
      >(endpoint);
      setLivingContext(unwrapLivingContext(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load living context'));
    } finally {
      setIsLoading(false);
    }
  }, [api, endpoint]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { livingContext, isLoading, error, refetch };
}
