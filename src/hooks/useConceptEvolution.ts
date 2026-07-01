import { useCallback, useEffect, useState } from 'react';
import type { ConceptEvolutionTimeline } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseConceptEvolutionResult {
  timeline: ConceptEvolutionTimeline | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useConceptEvolution(
  candidateId: string | null,
  conceptKey: string | null,
): UseConceptEvolutionResult {
  const api = useApiClient();
  const [timeline, setTimeline] = useState<ConceptEvolutionTimeline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId || !conceptKey) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<ConceptEvolutionTimeline>(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/concepts/evolution?conceptKey=${encodeURIComponent(conceptKey)}`,
      );
      setTimeline(response);
    } catch (cause) {
      console.error('[useConceptEvolution] fetch failed:', { candidateId, conceptKey, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load concept evolution'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId, conceptKey]);

  useEffect(() => {
    if (candidateId && conceptKey) {
      void refetch();
    } else {
      setTimeline(null);
    }
  }, [refetch, candidateId, conceptKey]);

  return { timeline, isLoading, error, refetch };
}
