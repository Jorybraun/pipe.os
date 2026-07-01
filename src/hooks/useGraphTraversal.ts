import { useCallback, useEffect, useState } from 'react';
import type { GraphTraversalResult, GraphEntityType } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseGraphTraversalResult {
  graph: GraphTraversalResult | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useGraphTraversal(
  candidateId: string | null,
  startId: string | null,
  startType: GraphEntityType = 'person',
  depth: number = 3,
): UseGraphTraversalResult {
  const api = useApiClient();
  const [graph, setGraph] = useState<GraphTraversalResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId || !startId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        startId,
        startType,
        depth: String(depth),
      });
      const response = await api.get<GraphTraversalResult>(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/graph?${params}`,
      );
      setGraph(response);
    } catch (cause) {
      console.error('[useGraphTraversal] fetch failed:', { candidateId, startId, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load graph'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId, startId, startType, depth]);

  useEffect(() => {
    if (candidateId && startId) {
      void refetch();
    } else {
      setGraph(null);
    }
  }, [refetch, candidateId, startId]);

  return { graph, isLoading, error, refetch };
}
