import { useCallback, useEffect, useState } from 'react';
import type { RepoDecompositionOverlay } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseRepoDecompositionResult {
  overlay: RepoDecompositionOverlay | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useRepoDecomposition(
  candidateId: string | null,
  packetId: string | null,
): UseRepoDecompositionResult {
  const api = useApiClient();
  const [overlay, setOverlay] = useState<RepoDecompositionOverlay | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId || !packetId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<RepoDecompositionOverlay>(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/repo-decomposition?packetId=${encodeURIComponent(packetId)}`,
      );
      setOverlay(response);
    } catch (cause) {
      console.error('[useRepoDecomposition] fetch failed:', { candidateId, packetId, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load repo decomposition'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId, packetId]);

  useEffect(() => {
    if (candidateId && packetId) {
      void refetch();
    } else {
      setOverlay(null);
    }
  }, [refetch, candidateId, packetId]);

  return { overlay, isLoading, error, refetch };
}
