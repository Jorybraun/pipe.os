import { useCallback, useEffect, useState } from 'react';
import type { MatchProvenanceResponse } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseMatchProvenanceResult {
  provenance: MatchProvenanceResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useMatchProvenance(
  matchRunId: string | null,
): UseMatchProvenanceResult {
  const api = useApiClient();
  const [provenance, setProvenance] = useState<MatchProvenanceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!matchRunId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ matchRunId });
      const response = await api.get<MatchProvenanceResponse>(
        `/api/v1/internal/match-provenance-chain?${params.toString()}`,
      );
      setProvenance(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load match provenance chain'));
    } finally {
      setIsLoading(false);
    }
  }, [api, matchRunId]);

  useEffect(() => {
    if (matchRunId) {
      void refetch();
    } else {
      setProvenance(null);
    }
  }, [refetch, matchRunId]);

  return { provenance, isLoading, error, refetch };
}
