import { useCallback, useEffect, useState } from 'react';
import type { ConceptGraphResponse } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseConceptGraphOptions {
  namespace?: string;
  query?: string;
  minObs?: number;
  limit?: number;
  withAdjacencies?: boolean;
}

export interface UseConceptGraphResult {
  graph: ConceptGraphResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useConceptGraph(
  options?: UseConceptGraphOptions,
): UseConceptGraphResult {
  const api = useApiClient();
  const [graph, setGraph] = useState<ConceptGraphResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const namespace = options?.namespace;
  const query = options?.query;
  const minObs = options?.minObs;
  const limit = options?.limit;
  const withAdjacencies = options?.withAdjacencies;

  const refetch = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (namespace) params.set('namespace', namespace);
      if (query) params.set('q', query);
      if (minObs !== undefined) params.set('minObs', String(minObs));
      if (limit !== undefined) params.set('limit', String(limit));
      if (withAdjacencies) params.set('withAdj', 'true');
      const qs = params.toString();
      const url = `/api/v1/internal/concept-graph${qs ? `?${qs}` : ''}`;
      const response = await api.get<ConceptGraphResponse>(url);
      setGraph(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load concept graph'));
    } finally {
      setIsLoading(false);
    }
  }, [api, namespace, query, minObs, limit, withAdjacencies]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { graph, isLoading, error, refetch };
}
