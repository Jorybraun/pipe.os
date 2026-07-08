/**
 * usePipelineDelete — deletes a pipeline by ID via the Cloudflare Worker API.
 *
 * The Worker verifies ownership server-side before deleting; the hook surfaces
 * any error as a human-readable string for UI display.
 *
 * Usage:
 *   const { deletePipeline, isDeleting, error } = usePipelineDelete();
 *   await deletePipeline('abc123');
 */

import { useState, useCallback } from 'react';
import { useClerkAuth } from '../providers/clerk';
import { createApiClient } from '../lib/api/client';
import { ApiError } from '../lib/api/types';

export interface UsePipelineDeleteResult {
  deletePipeline: (id: string) => Promise<void>;
  isDeleting: boolean;
  error: string | null;
}

export function usePipelineDelete(): UsePipelineDeleteResult {
  const { getToken } = useClerkAuth();

  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deletePipeline = useCallback(
    async (id: string): Promise<void> => {
      setIsDeleting(true);
      setError(null);

      const api = createApiClient({ getToken });

      try {
        await api.del(`/api/v1/pipelines/${id}`);
        console.log('[usePipelineDelete] Pipeline deleted:', id);
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('[usePipelineDelete] API error:', err.code, err.message);
          setError(err.message);
        } else {
          const message = err instanceof Error ? err.message : 'Failed to delete pipeline';
          console.error('[usePipelineDelete] Unexpected error:', message);
          setError(message);
        }
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [getToken],
  );

  return { deletePipeline, isDeleting, error };
}
