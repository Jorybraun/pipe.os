/**
 * usePipelineIngestion — fetches enrichment ingestion data for all candidates
 * in a pipeline. Used to overlay match indicators on candidate list views.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import { ApiError } from '../lib/api/types';

export interface PipelineIngestionItem {
  candidateId: string;
  candidateName: string | null;
  status: 'pending' | 'profile_generated' | 'embedded' | 'matched' | 'failed';
  candidateSearchableProfile: string | null;
  matchedRepoName: string | null;
  triangulatedScore: number | null;
  roleCandidateCosine: number | null;
  matchPhilosophy: string | null;
  errorText: string | null;
}

export interface PipelineIngestionRetryResult {
  scanned: number;
  queued: number;
  skipped: number;
  failed: number;
}

export interface UsePipelineIngestionResult {
  items: PipelineIngestionItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  retryFailed: (limit?: number) => Promise<PipelineIngestionRetryResult>;
  isRetrying: boolean;
  retryError: Error | null;
  lastRetryResult: PipelineIngestionRetryResult | null;
}

/**
 * Fetches pipeline-level ingestion data for the given pipeline ID.
 *
 * @param pipelineId - The pipeline ID from the URL param.
 */
export function usePipelineIngestion(
  pipelineId: string | undefined,
): UsePipelineIngestionResult {
  const { getToken } = useClerkAuth();

  const [items, setItems] = useState<PipelineIngestionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<Error | null>(null);
  const [lastRetryResult, setLastRetryResult] = useState<PipelineIngestionRetryResult | null>(null);

  const fetchIngestion = useCallback(async (): Promise<void> => {
    if (!pipelineId) return;

    setIsLoading(true);
    setError(null);

    const api = createApiClient({ getToken });

    try {
      const data = await api.get<{ results: PipelineIngestionItem[] }>(
        `/api/v1/pipelines/${pipelineId}/ingestion`,
      );
      setItems(data.results ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[usePipelineIngestion] API error:', err.code, err.message);
        setError(new Error(err.message));
      } else {
        const message =
          err instanceof Error ? err.message : 'Failed to load ingestion data';
        console.error('[usePipelineIngestion] Unexpected error:', message);
        setError(new Error(message));
      }
    } finally {
      setIsLoading(false);
    }
  }, [pipelineId, getToken]);

  useEffect(() => {
    void fetchIngestion();
  }, [fetchIngestion]);

  const retryFailed = useCallback(async (limit?: number): Promise<PipelineIngestionRetryResult> => {
    if (!pipelineId) {
      throw new Error('Pipeline id is required to retry failed ingestion.');
    }

    setIsRetrying(true);
    setRetryError(null);

    const api = createApiClient({ getToken });

    try {
      const payload = limit === undefined ? {} : { limit };
      const data = await api.post<{
        success: boolean;
        result: PipelineIngestionRetryResult;
      }>(`/api/v1/pipelines/${pipelineId}/ingestion/retry-failed`, payload);
      setLastRetryResult(data.result);
      await fetchIngestion();
      return data.result;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to retry candidate ingestion';
      const retryFailure = new Error(message);
      console.error('[usePipelineIngestion] Retry failed:', message);
      setRetryError(retryFailure);
      throw retryFailure;
    } finally {
      setIsRetrying(false);
    }
  }, [fetchIngestion, getToken, pipelineId]);

  return {
    items,
    isLoading,
    error,
    refetch: fetchIngestion,
    retryFailed,
    isRetrying,
    retryError,
    lastRetryResult,
  };
}
