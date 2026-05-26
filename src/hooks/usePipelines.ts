/**
 * usePipelines — fetches the authenticated user's pipeline list from the
 * Cloudflare Worker API with server-side pagination, filtering, and search.
 *
 * Uses Clerk's useAuth() hook to obtain the session JWT, then passes it to
 * the API client so the client itself stays Clerk-free.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import type { PipelineListItem, PipelinesResponse } from '../lib/api/types';
import { ApiError } from '../lib/api/types';

export interface UsePipelinesResult {
  pipelines: PipelineListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setStatusFilter: (status: string | null) => void;
  setSearchQuery: (query: string) => void;
}

const DEFAULT_LIMIT = 20;

export function usePipelines(): UsePipelinesResult {
  const { getToken } = useClerkAuth();

  const [pipelines, setPipelines] = useState<PipelineListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const fetchPipelines = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    const api = createApiClient({ getToken });

    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (statusFilter) params.set('status', statusFilter);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());

    try {
      const data = await api.get<PipelinesResponse>(
        `/api/v1/pipelines?${params.toString()}`
      );
      setPipelines(data.pipelines);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[usePipelines] API error:', err.code, err.message);
        setError(err.message);
      } else {
        const message = err instanceof Error ? err.message : 'Failed to load pipelines';
        console.error('[usePipelines] Unexpected error:', message);
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [getToken, page, limit, statusFilter, searchQuery]);

  useEffect(() => {
    void fetchPipelines();
  }, [fetchPipelines]);

  // Reset to page 1 when filters change.
  const handleSetStatusFilter = useCallback((status: string | null) => {
    setStatusFilter(status);
    setPage(1);
  }, []);

  const handleSetSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
    setPage(1);
  }, []);

  const handleSetLimit = useCallback((newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  }, []);

  return {
    pipelines,
    total,
    page,
    limit,
    totalPages,
    isLoading,
    error,
    refetch: fetchPipelines,
    setPage,
    setLimit: handleSetLimit,
    setStatusFilter: handleSetStatusFilter,
    setSearchQuery: handleSetSearchQuery,
  };
}
