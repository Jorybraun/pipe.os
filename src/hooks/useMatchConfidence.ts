import { useCallback, useEffect, useState } from 'react';
import type { MatchConfidenceReport } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseMatchConfidenceResult {
  report: MatchConfidenceReport | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useMatchConfidence(
  candidateId: string | null,
  packetId: string | null,
): UseMatchConfidenceResult {
  const api = useApiClient();
  const [report, setReport] = useState<MatchConfidenceReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId || !packetId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<MatchConfidenceReport>(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/match-confidence?packetId=${encodeURIComponent(packetId)}`,
      );
      setReport(response);
    } catch (cause) {
      console.error('[useMatchConfidence] fetch failed:', { candidateId, packetId, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load match confidence'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId, packetId]);

  useEffect(() => {
    if (candidateId && packetId) {
      void refetch();
    } else {
      setReport(null);
    }
  }, [refetch, candidateId, packetId]);

  return { report, isLoading, error, refetch };
}
