import { useCallback, useEffect, useState } from 'react';
import type { EvidenceGapReport } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseEvidenceGapsResult {
  report: EvidenceGapReport | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useEvidenceGaps(
  candidateId: string | null,
  challengePacketId: string | null,
): UseEvidenceGapsResult {
  const api = useApiClient();
  const [report, setReport] = useState<EvidenceGapReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId || !challengePacketId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ candidateId, challengePacketId });
      const response = await api.get<EvidenceGapReport>(
        `/api/v1/internal/evidence-gap-analysis?${params.toString()}`,
      );
      setReport(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load evidence gap analysis'));
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
