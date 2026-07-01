import { useCallback, useEffect, useState } from 'react';
import type { GraphEntityType, GraphTraversalResult, GraphTraversalOptions } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseGraphTraversalResult {
  graph: GraphTraversalResult | null;
  isLoading: boolean;
  error: Error | null;
  traverse: (entityType: GraphEntityType, entityId: string, options?: GraphTraversalOptions) => Promise<void>;
}

export function useGraphTraversal(
  candidateId: string | null,
  initialEntityType?: GraphEntityType | null,
  initialEntityId?: string | null,
): UseGraphTraversalResult {
  const api = useApiClient();
  const [graph, setGraph] = useState<GraphTraversalResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const traverse = useCallback(async (
    entityType: GraphEntityType,
    entityId: string,
    options?: GraphTraversalOptions,
  ): Promise<void> => {
    if (!candidateId) return;
    setIsLoading(true);
    setError(null);
    try {
      let url = `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/graph-traversal?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`;
      if (options?.maxDepth !== undefined) {
        url += `&maxDepth=${options.maxDepth}`;
      }
      if (options?.maxNodes !== undefined) {
        url += `&maxNodes=${options.maxNodes}`;
      }
      if (options?.entityTypeFilter?.length) {
        url += `&entityTypeFilter=${options.entityTypeFilter.join(',')}`;
      }
      const response = await api.get<GraphTraversalResult>(url);
      setGraph(response);
    } catch (cause) {
      console.error('[useGraphTraversal] fetch failed:', { candidateId, entityType, entityId, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load graph traversal'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId]);

  useEffect(() => {
    if (candidateId && initialEntityType && initialEntityId) {
      void traverse(initialEntityType, initialEntityId);
    } else {
      setGraph(null);
    }
  }, [candidateId, initialEntityType, initialEntityId, traverse]);

  return { graph, isLoading, error, traverse };
}
