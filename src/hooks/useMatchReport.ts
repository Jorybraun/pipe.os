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
  challengePacketId: string | null,
): UseMatchReportResult {
  const api = useApiClient();
  const [report, setReport] = useState<UnifiedMatchReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId || !challengePacketId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<UnifiedMatchReport>(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/match-report?challengePacketId=${encodeURIComponent(challengePacketId)}`,
      );
      setReport(response);
    } catch (cause) {
      console.error('[useMatchReport] fetch failed:', { candidateId, challengePacketId, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load match report'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId, challengePacketId]);

  useEffect(() => {
    if (candidateId && challengePacketId) {
      void refetch();
    } else {
      setReport(null);
    }
  }, [refetch, candidateId, challengePacketId]);

  return { report, isLoading, error, refetch };
}
