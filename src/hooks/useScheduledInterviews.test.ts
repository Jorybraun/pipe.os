import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../lib/api/client';
import { useScheduledInterviews } from './useScheduledInterviews';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
}));

const mockApiClient: ApiClient = {
  get: apiMocks.get,
  post: apiMocks.post,
  patch: apiMocks.patch,
  put: vi.fn(),
  del: vi.fn(),
  postStream: vi.fn(),
};

vi.mock('./useApiClient', () => ({
  useApiClient: () => mockApiClient,
}));

vi.mock('./useRoomStatusNotifications', () => ({
  useRoomStatusNotifications: () => ({ updates: [] }),
}));

function apiInterview(id: string, createdAt: string): Record<string, unknown> {
  return {
    id,
    candidateId: null,
    pipelineId: null,
    stageId: null,
    interviewType: 'OPEN_SOURCE_BUG_FIX',
    meetingType: 'DIRECT_VIDEO_CALL',
    status: 'INVITED',
    scheduledAt: null,
    meetingUrl: null,
    schedulingProvider: null,
    schedulingUrl: null,
    externalEventId: null,
    recruiterNotes: null,
    syncSource: 'MANUAL',
    lastSyncedAt: null,
    inviteLinkSentAt: null,
    emailSentAt: null,
    bookingConfirmationSentAt: null,
    recipientName: `Candidate ${id}`,
    recipientEmail: `${id}@example.com`,
    matchedRepoId: null,
    githubRepoUrl: null,
    githubPrNumber: null,
    assessmentSetup: null,
    assessmentProgress: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
    candidateName: null,
    candidateEmail: null,
    pipelineTitle: null,
    stageTitle: null,
    meetingId: null,
    meetingSchedulingProvider: null,
    meetingExternalEventId: null,
    roomStatus: null,
    guestWaiting: false,
    workspaceSession: null,
  };
}

describe('useScheduledInterviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches a bounded newest-first page and uses nextOffset when loading more', async () => {
    apiMocks.get
      .mockResolvedValueOnce({
        interviews: [apiInterview('first-page-1', '2026-07-01T10:00:00.000Z')],
        pagination: {
          total: 45,
          limit: 20,
          offset: 0,
          nextOffset: 20,
          hasMore: true,
        },
      })
      .mockResolvedValueOnce({
        interviews: [apiInterview('second-page-1', '2026-06-30T10:00:00.000Z')],
        pagination: {
          total: 45,
          limit: 20,
          offset: 20,
          nextOffset: 40,
          hasMore: true,
        },
      });

    const { result } = renderHook(() => useScheduledInterviews());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(apiMocks.get).toHaveBeenNthCalledWith(
      1,
      '/api/v1/scheduling/interviews?limit=20&offset=0&sort=created_desc',
    );
    expect(result.current.interviews.map((interview) => interview.id)).toEqual(['first-page-1']);
    expect(result.current.total).toBe(45);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(apiMocks.get).toHaveBeenNthCalledWith(
      2,
      '/api/v1/scheduling/interviews?limit=20&offset=20&sort=created_desc',
    );
    expect(result.current.interviews.map((interview) => interview.id)).toEqual([
      'first-page-1',
      'second-page-1',
    ]);
  });

  it('requests the selected server sort for first page and load-more calls', async () => {
    apiMocks.get
      .mockResolvedValueOnce({
        interviews: [apiInterview('oldest-page-1', '2026-06-01T10:00:00.000Z')],
        pagination: {
          total: 21,
          limit: 20,
          offset: 0,
          sort: 'created_asc',
          nextOffset: 20,
          hasMore: true,
        },
      })
      .mockResolvedValueOnce({
        interviews: [apiInterview('oldest-page-2', '2026-06-02T10:00:00.000Z')],
        pagination: {
          total: 21,
          limit: 20,
          offset: 20,
          sort: 'created_asc',
          nextOffset: null,
          hasMore: false,
        },
      });

    const { result } = renderHook(() => useScheduledInterviews({ sort: 'created_asc' }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(apiMocks.get).toHaveBeenNthCalledWith(
      1,
      '/api/v1/scheduling/interviews?limit=20&offset=0&sort=created_asc',
    );

    await act(async () => {
      await result.current.loadMore();
    });

    expect(apiMocks.get).toHaveBeenNthCalledWith(
      2,
      '/api/v1/scheduling/interviews?limit=20&offset=20&sort=created_asc',
    );
    expect(result.current.interviews.map((interview) => interview.id)).toEqual([
      'oldest-page-1',
      'oldest-page-2',
    ]);
  });
});
