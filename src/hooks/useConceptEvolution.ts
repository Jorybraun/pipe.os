import { useCallback, useEffect, useState } from 'react';
import type {
  ConceptEvolutionTimeline,
  MergeConceptsResult,
  SplitConceptResult,
} from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseConceptEvolutionResult {
  timeline: ConceptEvolutionTimeline | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  merge: (input: {
    survivorConceptId: string;
    absorbedConceptIds: string[];
    reason?: string;
  }) => Promise<MergeConceptsResult>;
  split: (input: {
    sourceConceptId: string;
    newCanonicalKey: string;
    surfaceIdsToMove: string[];
    reason?: string;
  }) => Promise<SplitConceptResult>;
}

export function useConceptEvolution(
  candidateId: string | null,
  conceptKey: string | null,
): UseConceptEvolutionResult {
  const api = useApiClient();
  const [timeline, setTimeline] = useState<ConceptEvolutionTimeline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchTimeline = useCallback(async (): Promise<void> => {
    if (!candidateId || !conceptKey) {
      setTimeline(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const url = `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/concepts/evolution?conceptKey=${encodeURIComponent(conceptKey)}`;
      const result = await api.get<ConceptEvolutionTimeline>(url);
      setTimeline(result);
    } catch (cause) {
      console.error('[useConceptEvolution] fetch failed:', { candidateId, conceptKey, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load concept evolution'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId, conceptKey]);

  useEffect(() => {
    void fetchTimeline();
  }, [fetchTimeline]);

  const merge = useCallback(async (input: {
    survivorConceptId: string;
    absorbedConceptIds: string[];
    reason?: string;
  }): Promise<MergeConceptsResult> => {
    if (!candidateId) throw new Error('candidateId is required');
    const url = `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/concepts/merge`;
    const result = await api.post<MergeConceptsResult>(url, input);
    void fetchTimeline();
    return result;
  }, [api, candidateId, fetchTimeline]);

  const split = useCallback(async (input: {
    sourceConceptId: string;
    newCanonicalKey: string;
    surfaceIdsToMove: string[];
    reason?: string;
  }): Promise<SplitConceptResult> => {
    if (!candidateId) throw new Error('candidateId is required');
    const url = `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/concepts/split`;
    const result = await api.post<SplitConceptResult>(url, input);
    void fetchTimeline();
    return result;
  }, [api, candidateId, fetchTimeline]);

  return { timeline, isLoading, error, refetch: fetchTimeline, merge, split };
}
