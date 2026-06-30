import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from './useApiClient';

interface PipelineSiblingsResponse {
  pipelineId: string | null;
  siblingIds: string[];
}

export interface UsePipelineSiblingsResult {
  siblingIds: string[];
  pipelineId: string | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function usePipelineSiblings(
  candidateId: string | null,
): UsePipelineSiblingsResult {
  const api = useApiClient();
  const [siblingIds, setSiblingIds] = useState<string[]>([]);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<PipelineSiblingsResponse>(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/pipeline-siblings`,
      );
      setSiblingIds(response.siblingIds);
      setPipelineId(response.pipelineId);
    } catch (cause) {
      console.error('[usePipelineSiblings] fetch failed:', { candidateId, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load pipeline siblings'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId]);

  useEffect(() => {
    if (candidateId) {
      void refetch();
    } else {
      setSiblingIds([]);
      setPipelineId(null);
    }
  }, [refetch, candidateId]);

  return { siblingIds, pipelineId, isLoading, error, refetch };
}
