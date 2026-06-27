import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import InterviewDetailPage from './InterviewDetailPage';
import type { ScheduledInterviewDetail } from '../lib/scheduling/types';

const mocks = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../hooks/useApiClient', () => ({
  useApiClient: () => mocks.api,
}));

function makeInterview(
  overrides: Partial<ScheduledInterviewDetail> = {},
): ScheduledInterviewDetail {
  return {
    id: 'interview-1',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    candidateId: null,
    contactId: 'person-1',
    pipelineId: null,
    stageId: null,
    interviewType: 'VIDEO',
    meetingType: 'DIRECT_VIDEO_CALL',
    status: 'INVITED',
    scheduledAt: null,
    meetingUrl: null,
    schedulingProvider: 'MANUAL',
    schedulingUrl: null,
    externalEventId: null,
    recruiterNotes: null,
    syncSource: 'MANUAL',
    lastSyncedAt: null,
    inviteLinkSentAt: '2026-06-23T00:00:00.000Z',
    emailSentAt: '2026-06-23T00:00:00.000Z',
    owner: 'user-1',
    recipientName: 'Ada Candidate',
    recipientEmail: 'ada@example.com',
    candidateName: null,
    candidateEmail: null,
    pipelineTitle: null,
    stageTitle: null,
    matchedRepoId: null,
    githubRepoUrl: null,
    githubPrNumber: null,
    submissionJson: null,
    completedAt: null,
    transcriptArtifact: null,
    linkedMeeting: null,
    livingContext: null,
    ...overrides,
  };
}

function renderDetail(): void {
  render(
    <MemoryRouter initialEntries={['/interviews/interview-1']}>
      <Routes>
        <Route path="/interviews/:interviewId" element={<InterviewDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function flushAsyncUpdates(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('InterviewDetailPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.api.get.mockReset();
    mocks.api.post.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the interview visible while transcript polling refreshes in the background', async () => {
    let resolveBackground:
      | ((value: { interview: ScheduledInterviewDetail }) => void)
      | undefined;
    const backgroundRefresh = new Promise<{ interview: ScheduledInterviewDetail }>((resolve) => {
      resolveBackground = resolve;
    });

    mocks.api.get
      .mockResolvedValueOnce({
        interview: makeInterview({
          linkedMeeting: {
            id: 'meeting-1',
            title: 'Ada Candidate interview',
            description: null,
            status: 'ACTIVE',
            scheduledAt: null,
            startedAt: null,
            endedAt: null,
            durationSecs: null,
            meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
            meetingType: 'INTERVIEW',
            transcriptStatus: 'PROCESSING',
            transcriptSummary: null,
            transcriptJson: null,
            transcriptAnalysisJson: null,
            transcriptError: null,
            recordingR2Key: null,
            room: null,
            createdAt: '2026-06-23T00:00:00.000Z',
            updatedAt: '2026-06-23T00:00:00.000Z',
          },
        }),
      })
      .mockReturnValueOnce(backgroundRefresh);

    renderDetail();

    await flushAsyncUpdates();
    expect(screen.getByText('Ada Candidate')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mocks.api.get).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Ada Candidate')).toBeTruthy();
    expect(screen.getByText('Processing transcript')).toBeTruthy();

    resolveBackground?.({
      interview: makeInterview({
        linkedMeeting: {
          id: 'meeting-1',
          title: 'Ada Candidate interview',
          description: null,
          status: 'ACTIVE',
          scheduledAt: null,
          startedAt: null,
          endedAt: null,
          durationSecs: null,
          meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
          meetingType: 'INTERVIEW',
          transcriptStatus: 'PROCESSING',
          transcriptSummary: 'Call is being processed.',
          transcriptJson: null,
          transcriptAnalysisJson: null,
          transcriptError: null,
          recordingR2Key: null,
          room: null,
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
      }),
    });

    await flushAsyncUpdates();
    expect(screen.getByText('Call is being processed.')).toBeTruthy();
  });

  it('does not poll forever for pending local transcript artifacts', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        transcriptArtifact: {
          id: 'artifact-1',
          interviewId: 'interview-1',
          status: 'PENDING',
          transcriptJson: null,
          errorMessage: null,
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    expect(screen.getByText('Ada Candidate')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(mocks.api.get).toHaveBeenCalledTimes(1);
  });

  it('shows Calendly event linkage on the interview detail', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        status: 'SCHEDULED',
        scheduledAt: '2026-07-03T19:00:00.000Z',
        schedulingProvider: 'CALENDLY',
        externalEventId: 'https://api.calendly.com/scheduled_events/event-katherine',
        linkedMeeting: {
          id: 'meeting-katherine',
          title: 'Katherine Johnson interview',
          description: null,
          status: 'SCHEDULED',
          scheduledAt: '2026-07-03T19:00:00.000Z',
          startedAt: null,
          endedAt: null,
          durationSecs: null,
          meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
          meetingType: 'INTERVIEW',
          schedulingProvider: 'CALENDLY',
          externalEventId: 'https://api.calendly.com/scheduled_events/event-katherine',
          transcriptStatus: 'NONE',
          transcriptSummary: null,
          transcriptJson: null,
          transcriptAnalysisJson: null,
          transcriptError: null,
          recordingR2Key: null,
          room: null,
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    expect(screen.getByText('Scheduling')).toBeTruthy();
    expect(screen.getByText('CALENDLY')).toBeTruthy();
    expect(screen.getByText('event-katherine')).toBeTruthy();
    expect(screen.getByText('meeting-katherine')).toBeTruthy();
  });

  it('does not poll forever for stale recording state after a disconnected call', async () => {
    vi.setSystemTime(new Date('2026-06-23T12:00:00.000Z'));
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        linkedMeeting: {
          id: 'meeting-1',
          title: 'Ada Candidate interview',
          description: null,
          status: 'COMPLETED',
          scheduledAt: null,
          startedAt: '2026-06-22T12:00:00.000Z',
          endedAt: null,
          durationSecs: null,
          meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
          meetingType: 'INTERVIEW',
          transcriptStatus: 'RECORDING',
          transcriptSummary: null,
          transcriptJson: null,
          transcriptAnalysisJson: null,
          transcriptError: null,
          recordingR2Key: null,
          room: { id: 'room-1', sessionId: 'session-1', status: 'ENDED' },
          createdAt: '2026-06-22T12:00:00.000Z',
          updatedAt: '2026-06-22T12:00:00.000Z',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    expect(screen.getByText('Ada Candidate')).toBeTruthy();
    expect(screen.getByText('Not recorded yet')).toBeTruthy();
    expect(screen.getByText('The call ended or disconnected before a recording was saved. Start a fresh room to collect transcript evidence.')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(mocks.api.get).toHaveBeenCalledTimes(1);
  });
});
