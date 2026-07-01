import { useCallback, useEffect, useState } from 'react';
import type { CandidateComparisonReport } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseCandidateComparisonResult {
  report: CandidateComparisonReport | null;
  isLoading: boolean;
  error: Error | null;
  compare: (candidateIds: string[], pipelineId?: string) => Promise<void>;
}

export function useCandidateComparison(
  candidateIds: string[] | null,
  pipelineId?: string,
): UseCandidateComparisonResult {
  const api = useApiClient();
  const [report, setReport] = useState<CandidateComparisonReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const compare = useCallback(async (ids: string[], pipeline?: string): Promise<void> => {
    if (ids.length < 2) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.post<CandidateComparisonReport>(
        '/api/v1/candidates/compare',
        { candidateIds: ids, pipelineId: pipeline },
      );
      setReport(response);
    } catch (cause) {
      console.error('[useCandidateComparison] compare failed:', { ids, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to compare candidates'));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (candidateIds && candidateIds.length >= 2) {
      void compare(candidateIds, pipelineId);
    } else {
      setReport(null);
    }
  }, [compare, candidateIds, pipelineId]);

  return { report, isLoading, error, compare };
}
