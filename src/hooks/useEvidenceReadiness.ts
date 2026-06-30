import { useCallback, useEffect, useState } from 'react';
import type { EvidenceReadinessReport } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseEvidenceReadinessResult {
  report: EvidenceReadinessReport | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useEvidenceReadiness(
  candidateId: string | null,
): UseEvidenceReadinessResult {
  const api = useApiClient();
  const [report, setReport] = useState<EvidenceReadinessReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<EvidenceReadinessReport>(
        `/api/v1/candidates/${candidateId}/living-context/evidence-readiness`,
      );
      setReport(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load evidence readiness'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId]);

  useEffect(() => {
    if (candidateId) {
      void refetch();
    } else {
      setReport(null);
    }
  }, [refetch, candidateId]);

  return { report, isLoading, error, refetch };
}
