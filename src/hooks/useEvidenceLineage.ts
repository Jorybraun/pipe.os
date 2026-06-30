import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EvidenceLineageResponse } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseEvidenceLineageResult {
  lineage: EvidenceLineageResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useEvidenceLineage(
  candidateId: string | null,
  conceptKeys?: string[],
): UseEvidenceLineageResult {
  const api = useApiClient();
  const [lineage, setLineage] = useState<EvidenceLineageResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const conceptKeysKey = useMemo(
    () => conceptKeys?.join(',') ?? '',
    [conceptKeys],
  );

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ candidateId });
      if (conceptKeysKey) {
        params.set('conceptKeys', conceptKeysKey);
      }
      const response = await api.get<EvidenceLineageResponse>(
        `/api/v1/internal/evidence-lineage?${params.toString()}`,
      );
      setLineage(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load evidence lineage'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId, conceptKeysKey]);

  useEffect(() => {
    if (candidateId) {
      void refetch();
    } else {
      setLineage(null);
    }
  }, [refetch, candidateId]);

  return { lineage, isLoading, error, refetch };
}
