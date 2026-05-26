/**
 * useOverviewData — fetches the full pipeline overview from the Cloudflare
 * Worker API in a single round-trip.
 *
 * Replaces the ~20 individual Amplify calls that the legacy OverviewPage made.
 * The Worker pre-joins pipeline, stages, candidates, and interviews server-side.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';
import type {
  OverviewResponse,
  OverviewPipeline,
  OverviewStage,
  OverviewCandidate,
  OverviewRoleContext,
  OverviewMatchConfig,
} from '../lib/api/types';
import { ApiError } from '../lib/api/types';

export interface UseOverviewDataResult {
  pipeline: OverviewPipeline | null;
  stages: OverviewStage[];
  candidates: OverviewCandidate[];
  interviews: unknown[];
  roleContext: OverviewRoleContext | null;
  matchConfig: OverviewMatchConfig | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  publishPipeline: () => Promise<void>;
  unpublishPipeline: () => Promise<void>;
  updatePipeline: (updates: { title?: string; level?: string | null; stack?: string[]; description?: string | null }) => Promise<void>;
}

/**
 * Fetches the pipeline overview for the given pipeline ID.
 *
 * @param pipelineId - The pipeline ID from the URL param.
 */
export function useOverviewData(pipelineId: string | undefined): UseOverviewDataResult {
  const { getToken } = useClerkAuth();

  const [pipeline, setPipeline] = useState<OverviewPipeline | null>(null);
  const [stages, setStages] = useState<OverviewStage[]>([]);
  const [candidates, setCandidates] = useState<OverviewCandidate[]>([]);
  const [interviews, setInterviews] = useState<unknown[]>([]);
  const [roleContext, setRoleContext] = useState<OverviewRoleContext | null>(null);
  const [matchConfig, setMatchConfig] = useState<OverviewMatchConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchOverview = useCallback(async (): Promise<void> => {
    if (!pipelineId) return;

    setIsLoading(true);
    setError(null);

    const api = createApiClient({ getToken });

    try {
      const data = await api.get<OverviewResponse>(
        `/api/v1/pipelines/${pipelineId}/overview`,
      );
      setPipeline(data.pipeline);
      setStages(data.stages);
      setCandidates(data.candidates);
      setInterviews(data.interviews);
      setRoleContext(data.roleContext);
      setMatchConfig(data.matchConfig);
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[useOverviewData] API error:', err.code, err.message);
        setError(new Error(err.message));
      } else {
        const message = err instanceof Error ? err.message : 'Failed to load overview';
        console.error('[useOverviewData] Unexpected error:', message);
        setError(new Error(message));
      }
    } finally {
      setIsLoading(false);
    }
  }, [pipelineId, getToken]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const publishPipeline = useCallback(async (): Promise<void> => {
    if (!pipelineId) return;

    const api = createApiClient({ getToken });

    try {
      await api.patch(`/api/v1/pipelines/${pipelineId}`, { status: 'ACTIVE' });
      await fetchOverview();
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[useOverviewData] Publish failed:', err.code, err.message);
        throw new Error(err.message);
      }
      const message = err instanceof Error ? err.message : 'Failed to publish pipeline';
      console.error('[useOverviewData] Publish error:', message);
      throw new Error(message);
    }
  }, [pipelineId, getToken, fetchOverview]);

  const unpublishPipeline = useCallback(async (): Promise<void> => {
    if (!pipelineId) return;

    const api = createApiClient({ getToken });

    try {
      await api.patch(`/api/v1/pipelines/${pipelineId}`, { status: 'DRAFT' });
      await fetchOverview();
    } catch (err) {
      if (err instanceof ApiError) {
        console.error('[useOverviewData] Unpublish failed:', err.code, err.message);
        throw new Error(err.message);
      }
      const message = err instanceof Error ? err.message : 'Failed to unpublish pipeline';
      console.error('[useOverviewData] Unpublish error:', message);
      throw new Error(message);
    }
  }, [pipelineId, getToken, fetchOverview]);

  const updatePipeline = useCallback(
    async (updates: {
      title?: string;
      level?: string | null;
      stack?: string[];
      description?: string | null;
    }): Promise<void> => {
      if (!pipelineId) return;

      const api = createApiClient({ getToken });

      try {
        await api.patch(`/api/v1/pipelines/${pipelineId}`, updates);
        await fetchOverview();
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('[useOverviewData] Update failed:', err.code, err.message);
          throw new Error(err.message);
        }
        const message = err instanceof Error ? err.message : 'Failed to update pipeline';
        console.error('[useOverviewData] Update error:', message);
        throw new Error(message);
      }
    },
    [pipelineId, getToken, fetchOverview],
  );

  return {
    pipeline,
    stages,
    candidates,
    interviews,
    roleContext,
    matchConfig,
    isLoading,
    error,
    refetch: fetchOverview,
    publishPipeline,
    unpublishPipeline,
    updatePipeline,
  };
}
