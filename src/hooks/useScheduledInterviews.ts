import { useState, useEffect, useCallback, useRef } from 'react';
import { useApiClient } from './useApiClient';
import type { ApiClient } from '../lib/api/client';
import type {
  AssessmentProgressSnapshot,
  AssessmentSetupProjection,
  ScheduledInterview,
  InterviewStatus,
  WorkspaceSessionSummary,
} from '../lib/scheduling/types';
import { useRoomStatusNotifications } from './useRoomStatusNotifications';

const INTERVIEW_PAGE_LIMIT = 20;

interface ScheduledInterviewsPagination {
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
}

interface UseScheduledInterviewsResult {
  interviews: ScheduledInterview[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  total: number;
  hasMore: boolean;
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
  loadMore: () => Promise<void>;
}

/**
 * useScheduledInterviews — fetches paged ScheduledInterviews
 * owned by the authenticated recruiter via Cloudflare Worker API.
 */
export function useScheduledInterviews(): UseScheduledInterviewsResult {
  const api: ApiClient = useApiClient();
  const { updates: roomStatusUpdates } = useRoomStatusNotifications();

  const [interviews, setInterviews] = useState<ScheduledInterview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pagination, setPagination] = useState<ScheduledInterviewsPagination | null>(null);
  const processedRoomStatusKeysRef = useRef<Set<string>>(new Set());
  const interviewsRef = useRef<ScheduledInterview[]>([]);
  const paginationRef = useRef<ScheduledInterviewsPagination | null>(null);

  const fetchInterviews = useCallback(async (options: { append?: boolean } = {}) => {
    const append = options.append === true;
    const offset = append
      ? paginationRef.current?.nextOffset ?? interviewsRef.current.length
      : 0;
    if (append && paginationRef.current?.hasMore === false) return;

    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
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
          bookingConfirmationSentAt: string | null;
          recipientName: string | null;
          recipientEmail: string | null;
          matchedRepoId: number | null;
          githubRepoUrl: string | null;
          githubPrNumber: number | null;
          assessmentSetup?: AssessmentSetupProjection | null;
          assessmentProgress?: AssessmentProgressSnapshot | null;
          completedAt: string | null;
          createdAt: string;
          updatedAt: string;
          candidateName: string | null;
          candidateEmail: string | null;
          pipelineTitle: string | null;
          stageTitle: string | null;
          meetingId?: string | null;
          meetingSchedulingProvider?: string | null;
          meetingExternalEventId?: string | null;
          roomStatus?: string | null;
          guestWaiting?: boolean;
          workspaceSession?: WorkspaceSessionSummary | null;
        }>;
        pagination?: ScheduledInterviewsPagination;
      }>(`/api/v1/scheduling/interviews?limit=${INTERVIEW_PAGE_LIMIT}&offset=${offset}`);

      const nextPage = result.interviews.map((r) => ({
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
          bookingConfirmationSentAt: r.bookingConfirmationSentAt,
          recipientName: r.recipientName,
          recipientEmail: r.recipientEmail,
          matchedRepoId: r.matchedRepoId,
          githubRepoUrl: r.githubRepoUrl,
          githubPrNumber: r.githubPrNumber,
          assessmentSetup: r.assessmentSetup ?? null,
          assessmentProgress: r.assessmentProgress ?? null,
          completedAt: r.completedAt,
          candidateName: r.candidateName,
          candidateEmail: r.candidateEmail,
          pipelineTitle: r.pipelineTitle,
          stageTitle: r.stageTitle,
          meetingId: r.meetingId ?? null,
          meetingSchedulingProvider: r.meetingSchedulingProvider ?? null,
          meetingExternalEventId: r.meetingExternalEventId ?? null,
          roomStatus: r.roomStatus ?? null,
          guestWaiting: r.guestWaiting ?? false,
          workspaceSession: r.workspaceSession ?? null,
      }));
      const merged = append
        ? [
            ...interviewsRef.current,
            ...nextPage.filter((item) => !interviewsRef.current.some((existing) => existing.id === item.id)),
          ]
        : nextPage;
      const nextPagination = result.pagination ?? {
        total: merged.length,
        limit: INTERVIEW_PAGE_LIMIT,
        offset,
        nextOffset: null,
        hasMore: false,
      };

      interviewsRef.current = merged;
      paginationRef.current = nextPagination;
      setInterviews(merged);
      setPagination(nextPagination);
      setError(null);
    } catch (err) {
      console.error('[useScheduledInterviews] fetch error:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch interviews'));
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [api]);

  // Load interviews immediately. Calendly bookings arrive from provider webhooks;
  // live room presence/status updates arrive through useRoomStatusNotifications.
  useEffect(() => {
    void fetchInterviews();
  }, [fetchInterviews]);

  useEffect(() => {
    const freshUpdates = roomStatusUpdates.filter((update) => {
      const key = [
        update.interviewId,
        update.meetingId ?? '',
        update.meetingStatus ?? '',
        update.roomStatus ?? '',
        update.guestJoinedAt ?? '',
        update.guestLeftAt ?? '',
        update.guestWaiting ? 'waiting' : 'not-waiting',
        update.updatedAt,
      ].join('|');
      if (processedRoomStatusKeysRef.current.has(key)) return false;
      processedRoomStatusKeysRef.current.add(key);
      return true;
    });

    if (freshUpdates.length === 0) return;

    setInterviews((prev) => {
      const byInterviewId = new Map(freshUpdates.map((update) => [update.interviewId, update]));
      const next = prev.map((interview) => {
        const update = byInterviewId.get(interview.id);
        if (!update) return interview;
        return {
          ...interview,
          meetingId: update.meetingId ?? interview.meetingId ?? null,
          roomStatus: update.roomStatus,
          guestWaiting: update.guestWaiting,
          updatedAt: update.updatedAt,
        };
      });
      interviewsRef.current = next;
      return next;
    });
  }, [roomStatusUpdates]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (isLoadingMore || paginationRef.current?.hasMore === false) return;
    await fetchInterviews({ append: true });
  }, [fetchInterviews, isLoadingMore]);

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

  return {
    interviews,
    isLoading,
    isLoadingMore,
    error,
    total: pagination?.total ?? interviews.length,
    hasMore: pagination?.hasMore ?? false,
    updateStatus,
    sendInvite,
    refetch: fetchInterviews,
    loadMore,
  };
}
