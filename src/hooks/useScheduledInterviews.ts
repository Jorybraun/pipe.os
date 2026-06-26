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
      scheduledAt?: string | undefined;
      meetingUrl?: string | undefined;
      recruiterNotes?: string | undefined;
    }
  ) => Promise<void>;
  sendInvite: (id: string, email: string, message?: string) => Promise<void>;
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
          candidateId: string | null;
          pipelineId: string | null;
          stageId: string | null;
          interviewType: string | null;
          meetingType: string | null;
          status: InterviewStatus;
          scheduledAt: string | null;
          meetingUrl: string | null;
          schedulingProvider: string | null;
          schedulingUrl: string | null;
          externalEventId: string | null;
          recruiterNotes: string | null;
          syncSource: string | null;
          lastSyncedAt: string | null;
          inviteLinkSentAt: string | null;
          emailSentAt: string | null;
          recipientName: string | null;
          recipientEmail: string | null;
          matchedRepoId: number | null;
          githubRepoUrl: string | null;
          githubPrNumber: number | null;
          completedAt: string | null;
          createdAt: string;
          updatedAt: string;
          candidateName: string | null;
          candidateEmail: string | null;
          pipelineTitle: string | null;
          stageTitle: string | null;
          meetingId?: string | null;
          roomStatus?: string | null;
          guestWaiting?: boolean;
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
          interviewType: (r.interviewType as ScheduledInterview['interviewType']) ?? null,
          meetingType: (r.meetingType as ScheduledInterview['meetingType']) ?? null,
          status: r.status,
          scheduledAt: r.scheduledAt,
          meetingUrl: r.meetingUrl,
          schedulingProvider: (r.schedulingProvider as ScheduledInterview['schedulingProvider']) ?? null,
          schedulingUrl: r.schedulingUrl,
          externalEventId: r.externalEventId,
          recruiterNotes: r.recruiterNotes,
          syncSource: (r.syncSource as ScheduledInterview['syncSource']) ?? null,
          lastSyncedAt: r.lastSyncedAt,
          inviteLinkSentAt: r.inviteLinkSentAt,
          emailSentAt: r.emailSentAt,
          recipientName: r.recipientName,
          recipientEmail: r.recipientEmail,
          matchedRepoId: r.matchedRepoId,
          githubRepoUrl: r.githubRepoUrl,
          githubPrNumber: r.githubPrNumber,
          completedAt: r.completedAt,
          candidateName: r.candidateName,
          candidateEmail: r.candidateEmail,
          pipelineTitle: r.pipelineTitle,
          stageTitle: r.stageTitle,
          meetingId: r.meetingId ?? null,
          roomStatus: r.roomStatus ?? null,
          guestWaiting: r.guestWaiting ?? false,
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

    // Poll every 10s for near real-time room status updates (guest waiting, etc.)
    const pollInterval = setInterval(() => {
      void fetchInterviews();
    }, 10_000);

    return () => clearInterval(pollInterval);
  }, [fetchInterviews, api]);

  const updateStatus = useCallback(
    async (
      id: string,
      patch: {
        status: InterviewStatus;
        scheduledAt?: string | undefined;
        meetingUrl?: string | undefined;
        recruiterNotes?: string | undefined;
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

  const sendInvite = useCallback(
    async (id: string, email: string, message?: string): Promise<void> => {
      try {
        await api.post(`/api/v1/scheduling/interviews/${id}/invite`, {
          email,
          ...(message ? { message } : {}),
        });
        await fetchInterviews();
      } catch (err) {
        console.error('[useScheduledInterviews] sendInvite failed:', err);
        throw err instanceof Error ? err : new Error('Failed to send invite');
      }
    },
    [api, fetchInterviews],
  );

  return { interviews, isLoading, error, updateStatus, sendInvite, refetch: fetchInterviews };
}
