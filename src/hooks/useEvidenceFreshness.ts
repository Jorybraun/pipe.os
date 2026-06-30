import { useCallback, useEffect, useState } from 'react';
import type { EvidenceFreshnessResponse } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseEvidenceFreshnessResult {
  freshness: EvidenceFreshnessResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useEvidenceFreshness(
  candidateId: string | null,
): UseEvidenceFreshnessResult {
  const api = useApiClient();
  const [freshness, setFreshness] = useState<EvidenceFreshnessResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ candidateId });
      const response = await api.get<EvidenceFreshnessResponse>(
        `/api/v1/internal/candidate-evidence-freshness?${params.toString()}`,
      );
      setFreshness(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load evidence freshness'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId]);

  useEffect(() => {
    if (candidateId) {
      void refetch();
    } else {
      setFreshness(null);
    }
  }, [refetch, candidateId]);

  return { freshness, isLoading, error, refetch };
}
