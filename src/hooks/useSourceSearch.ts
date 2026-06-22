import { useCallback, useRef, useState } from 'react';
import type { SourceContentSearchResult, SourceContentSearchResponse } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseSourceSearchResult {
  results: SourceContentSearchResult[];
  isSearching: boolean;
  searchError: Error | null;
  search: (query: string) => Promise<void>;
  clear: () => void;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export function useSourceSearch(candidateId: string): UseSourceSearchResult {
  const api = useApiClient();
  const [results, setResults] = useState<SourceContentSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<Error | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (query: string): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    await new Promise<void>((resolve) => {
      timerRef.current = setTimeout(resolve, DEBOUNCE_MS);
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.get<SourceContentSearchResponse>(
        `/api/v1/candidates/${candidateId}/living-context/search?q=${encodeURIComponent(trimmed)}`,
      );
      if (!controller.signal.aborted) {
        setResults(response.results);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setSearchError(cause instanceof Error ? cause : new Error('Source search failed'));
        setResults([]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, [api, candidateId]);

  const clear = useCallback((): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    setResults([]);
    setIsSearching(false);
    setSearchError(null);
  }, []);

  return { results, isSearching, searchError, search, clear };
}
