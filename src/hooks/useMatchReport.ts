import { useCallback, useEffect, useState } from 'react';
import type { UnifiedMatchReport } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseMatchReportResult {
  report: UnifiedMatchReport | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useMatchReport(
  candidateId: string | null,
  packetId: string | null,
  matchRunId?: string | null,
): UseMatchReportResult {
  const api = useApiClient();
  const [report, setReport] = useState<UnifiedMatchReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId || !packetId) return;
    setIsLoading(true);
    setError(null);
    try {
      let url = `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/match-report?packetId=${encodeURIComponent(packetId)}`;
      if (matchRunId) {
        url += `&matchRunId=${encodeURIComponent(matchRunId)}`;
      }
      const response = await api.get<UnifiedMatchReport>(url);
      setReport(response);
    } catch (cause) {
      console.error('[useMatchReport] fetch failed:', { candidateId, packetId, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load match report'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId, packetId, matchRunId]);

  useEffect(() => {
    if (candidateId && packetId) {
      void refetch();
    } else {
      setReport(null);
    }
  }, [refetch, candidateId, packetId]);

  return { report, isLoading, error, refetch };
}
