import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from './useApiClient';
import type { ApiClient } from '../lib/api/client';
import type { ScheduledInterview, InterviewStatus } from '../lib/scheduling/types';

interface UseScheduledInterviewsResult {
  interviews: ScheduledInterview[];
  isLoading: boolean;
  error: Error | null;
  updateStatus: (
    id: string,
    patch: {
      status: InterviewStatus;
      scheduledAt?: string;
      meetingUrl?: string;
      recruiterNotes?: string;
    }
  ) => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * useScheduledInterviews — fetches all ScheduledInterviews
 * owned by the authenticated recruiter via Cloudflare Worker API.
 */
export function useScheduledInterviews(): UseScheduledInterviewsResult {
  const api: ApiClient = useApiClient();

  const [interviews, setInterviews] = useState<ScheduledInterview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchInterviews = useCallback(async () => {
    try {
      const result = await api.get<{
        interviews: Array<{
          id: string;
          candidateId: string;
          pipelineId: string;
          stageId: string;
          status: InterviewStatus;
          scheduledAt: string | null;
          meetingUrl: string | null;
          schedulingProvider: string | null;
          schedulingUrl: string | null;
          recruiterNotes: string | null;
          syncSource: string | null;
          lastSyncedAt: string | null;
          createdAt: string;
          updatedAt: string;
          candidateName: string | null;
          candidateEmail: string | null;
          pipelineTitle: string | null;
          stageTitle: string | null;
        }>;
      }>('/api/v1/scheduling/interviews');

      setInterviews(
        result.interviews.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          candidateId: r.candidateId,
          pipelineId: r.pipelineId,
          stageId: r.stageId,
          status: r.status,
          scheduledAt: r.scheduledAt,
          meetingUrl: r.meetingUrl,
          schedulingProvider: (r.schedulingProvider as ScheduledInterview['schedulingProvider']) ?? null,
          schedulingUrl: r.schedulingUrl,
          recruiterNotes: r.recruiterNotes,
          syncSource: r.syncSource as ScheduledInterview['syncSource'],
          lastSyncedAt: r.lastSyncedAt,
          candidateName: r.candidateName,
          candidateEmail: r.candidateEmail,
          pipelineTitle: r.pipelineTitle,
          stageTitle: r.stageTitle,
        })),
      );
    } catch (err) {
      console.error('[useScheduledInterviews] fetch error:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch interviews'));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  // Load interviews immediately, then sync with provider in background and refetch
  useEffect(() => {
    void fetchInterviews();

    // Background sync — don't block initial render
    const syncThenRefresh = async (): Promise<void> => {
      try {
        await api.post('/api/v1/scheduling/interviews/sync', {});
        // Refetch to pick up any newly synced data
        await fetchInterviews();
      } catch {
        // Best-effort — fails gracefully if no connection
      }
    };
    void syncThenRefresh();
  }, [fetchInterviews, api]);

  const updateStatus = useCallback(
    async (
      id: string,
      patch: {
        status: InterviewStatus;
        scheduledAt?: string;
        meetingUrl?: string;
        recruiterNotes?: string;
      }
    ): Promise<void> => {
      try {
        await api.patch(`/api/v1/scheduling/interviews/${id}`, patch);
        // Refetch to get updated data
        await fetchInterviews();
      } catch (err) {
        console.error('[useScheduledInterviews] updateStatus failed:', err);
        throw err instanceof Error ? err : new Error('Update failed');
      }
    },
    [api, fetchInterviews],
  );

  return { interviews, isLoading, error, updateStatus, refetch: fetchInterviews };
}
