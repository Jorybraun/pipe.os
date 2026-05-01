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
  triangulatedScore: number | null;
  roleCandidateCosine: number | null;
  matchPhilosophy: string | null;
}

export interface UsePipelineIngestionResult {
  items: PipelineIngestionItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
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

  return {
    items,
    isLoading,
    error,
    refetch: fetchIngestion,
  };
}
