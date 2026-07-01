import { useCallback, useState } from 'react';
import type { EvidenceSearchResult, SearchStrategy } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseEvidenceSearchResult {
  result: EvidenceSearchResult | null;
  isSearching: boolean;
  error: Error | null;
  search: (query: string, strategy?: SearchStrategy, limit?: number) => Promise<void>;
  clear: () => void;
}

export function useEvidenceSearch(
  candidateId: string | null,
): UseEvidenceSearchResult {
  const api = useApiClient();
  const [result, setResult] = useState<EvidenceSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const search = useCallback(async (
    query: string,
    strategy: SearchStrategy = 'hybrid',
    limit: number = 50,
  ): Promise<void> => {
    if (!candidateId || !query.trim()) return;
    setIsSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: query,
        strategy,
        limit: String(limit),
      });
      const response = await api.get<EvidenceSearchResult>(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/evidence-search?${params}`,
      );
      setResult(response);
    } catch (cause) {
      console.error('[useEvidenceSearch] search failed:', { candidateId, query, cause });
      setError(cause instanceof Error ? cause : new Error('Evidence search failed'));
    } finally {
      setIsSearching(false);
    }
  }, [api, candidateId]);

  const clear = useCallback((): void => {
    setResult(null);
    setError(null);
  }, []);

  return { result, isSearching, error, search, clear };
}
