import { useCallback, useEffect, useState } from 'react';
import type { EvidenceConflictReport } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseEvidenceConflictsResult {
  report: EvidenceConflictReport | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useEvidenceConflicts(
  candidateId: string | null,
): UseEvidenceConflictsResult {
  const api = useApiClient();
  const [report, setReport] = useState<EvidenceConflictReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<EvidenceConflictReport>(
        `/api/v1/candidates/${candidateId}/living-context/evidence-conflicts`,
      );
      setReport(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load evidence conflicts'));
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
