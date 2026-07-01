import { useCallback, useState } from 'react';
import type { BatchRematchResult } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseBatchRematchResult {
  result: BatchRematchResult | null;
  isLoading: boolean;
  error: Error | null;
  runBatch: (candidateIds: string[]) => Promise<void>;
}

export function useBatchRematch(): UseBatchRematchResult {
  const api = useApiClient();
  const [result, setResult] = useState<BatchRematchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const runBatch = useCallback(async (candidateIds: string[]): Promise<void> => {
    if (candidateIds.length === 0) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.post<BatchRematchResult>(
        '/api/v1/candidates/batch-rematch',
        { candidateIds },
      );
      setResult(response);
    } catch (cause) {
      console.error('[useBatchRematch] batch rematch failed:', { candidateIds, cause });
      setError(cause instanceof Error ? cause : new Error('Batch rematch failed'));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  return { result, isLoading, error, runBatch };
}
