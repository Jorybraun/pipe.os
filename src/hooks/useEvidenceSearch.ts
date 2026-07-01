import { useCallback, useState } from 'react';
import type {
  EvidenceSearchResult,
  EvidenceSearchOptions,
} from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseEvidenceSearchResult {
  result: EvidenceSearchResult | null;
  isLoading: boolean;
  error: Error | null;
  search: (query: string, options?: EvidenceSearchOptions) => Promise<void>;
  clear: () => void;
}

export function useEvidenceSearch(
  candidateId: string | null,
): UseEvidenceSearchResult {
  const api = useApiClient();
  const [result, setResult] = useState<EvidenceSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const search = useCallback(async (
    query: string,
    options?: EvidenceSearchOptions,
  ): Promise<void> => {
    if (!candidateId || !query) return;
    setIsLoading(true);
    setError(null);
    try {
      let url = `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/evidence-search?q=${encodeURIComponent(query)}`;
      if (options?.strategy) {
        url += `&strategy=${encodeURIComponent(options.strategy)}`;
      }
      if (options?.limit !== undefined) {
        url += `&limit=${options.limit}`;
      }
      if (options?.minConfidence !== undefined) {
        url += `&minConfidence=${options.minConfidence}`;
      }
      if (options?.interactionTypes?.length) {
        url += `&interactionTypes=${options.interactionTypes.join(',')}`;
      }
      const data = await api.get<EvidenceSearchResult>(url);
      setResult(data);
    } catch (cause) {
      console.error('[useEvidenceSearch] search failed:', { candidateId, query, cause });
      setError(cause instanceof Error ? cause : new Error('Evidence search failed'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId]);

  const clear = useCallback((): void => {
    setResult(null);
    setError(null);
  }, []);

  return { result, isLoading, error, search, clear };
}
