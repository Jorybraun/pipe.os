import { useCallback, useEffect, useState } from 'react';
import type { PersonEvidenceTimeline } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseEvidenceTimelineResult {
  timeline: PersonEvidenceTimeline | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useEvidenceTimeline(
  candidateId: string | null,
): UseEvidenceTimelineResult {
  const api = useApiClient();
  const [timeline, setTimeline] = useState<PersonEvidenceTimeline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<PersonEvidenceTimeline>(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/timeline`,
      );
      setTimeline(response);
    } catch (cause) {
      console.error('[useEvidenceTimeline] fetch failed:', { candidateId, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load evidence timeline'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId]);

  useEffect(() => {
    if (candidateId) {
      void refetch();
    } else {
      setTimeline(null);
    }
  }, [refetch, candidateId]);

  return { timeline, isLoading, error, refetch };
}
