/**
 * usePipelineCreate — creates a new pipeline via the Cloudflare Worker API.
 *
 * Replaces the Amplify-backed version of this hook. Uses Clerk's useAuth()
 * hook to obtain the session JWT, then delegates to the API client.
 *
 * Returns the created pipeline ID so the caller can navigate to the new
 * pipeline immediately.
 *
 * Usage:
 *   const { create, isCreating, error } = usePipelineCreate();
 *   const id = await create({ title: 'Senior Frontend Engineer', level: 'Senior' });
 *   navigate(`/pipeline/${id}`);
 */

import { useState, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import type { CreatePipelineRequest, CreatePipelineResponse } from '../lib/api/types';
import { ApiError } from '../lib/api/types';

// Re-export PipelineLevel so existing call sites can import from this module.
export type { PipelineLevel } from '../lib/api/types';

export interface UsePipelineCreateResult {
  /**
   * Submit a create request.
   * Resolves with the new pipeline ID on success.
   * Throws on failure — callers that need to suppress the throw should catch it
   * themselves; the hook also sets `error` for UI consumption.
   */
  create: (input: CreatePipelineRequest) => Promise<string>;
  isCreating: boolean;
  error: string | null;
}

export function usePipelineCreate(): UsePipelineCreateResult {
  const { getToken } = useClerkAuth();

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (input: CreatePipelineRequest): Promise<string> => {
      setIsCreating(true);
      setError(null);

      const api = createApiClient({ getToken });

      try {
        const data = await api.post<CreatePipelineResponse>('/api/v1/pipelines', input);
        const id = data.pipeline.id;
        console.log('[usePipelineCreate] Pipeline created:', id);
        return id;
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('[usePipelineCreate] API error:', err.code, err.message);
          setError(err.message);
        } else {
          const message = err instanceof Error ? err.message : 'Failed to create pipeline';
          console.error('[usePipelineCreate] Unexpected error:', message);
          setError(message);
        }
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [getToken],
  );

  return { create, isCreating, error };
}
