import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { resolveInviteCreationGuestLink, SchedulingDashboard } from './SchedulingDashboard';
import type { ScheduledInterview } from '../../lib/scheduling/types';

const mocks = vi.hoisted(() => ({
  useScheduledInterviews: vi.fn(),
  useBookingNotifications: vi.fn(),
  api: {
    post: vi.fn(),
  },
}));

vi.mock('../../hooks/useScheduledInterviews', () => ({
  useScheduledInterviews: mocks.useScheduledInterviews,
}));

vi.mock('../../hooks/useBookingNotifications', () => ({
  useBookingNotifications: mocks.useBookingNotifications,
}));

vi.mock('../../hooks/useApiClient', () => ({
  useApiClient: () => mocks.api,
}));

vi.mock('./InterviewCard', () => ({
  InterviewCard: (props: {
    interview: Pick<ScheduledInterview, 'id' | 'createdAt'>;
    candidateName: string;
    candidateEmail?: string | null;
    startAssessmentEvaluation?: (id: string) => Promise<unknown>;
  }) => (
    <div
      data-testid="interview-card"
      data-interview-id={props.interview.id}
      data-created-at={props.interview.createdAt}
      data-candidate-email={props.candidateEmail ?? ''}
    >
      {props.candidateName}
      <button
        type="button"
        aria-label={`Evaluate ${props.interview.id}`}
        onClick={() => void props.startAssessmentEvaluation?.(props.interview.id)}
      />
    </div>
  ),
}));

vi.mock('./InviteCreationModal', () => ({
  InviteCreationModal: (props: {
    isOpen: boolean;
    initialRecipientName?: string;
    initialRecipientEmail?: string;
    initialInterviewType?: string;
    initialRecruiterNotes?: string;
  }) => props.isOpen ? (
    <div
      data-testid="invite-modal"
      data-recipient-name={props.initialRecipientName ?? ''}
      data-recipient-email={props.initialRecipientEmail ?? ''}
      data-interview-type={props.initialInterviewType ?? ''}
      data-recruiter-notes={props.initialRecruiterNotes ?? ''}
    />
  ) : null,
}));

function makeInterview(overrides: Partial<ScheduledInterview> & {
  id: string;
  createdAt: string;
  recipientName: string;
}): ScheduledInterview {
  return {
    updatedAt: overrides.createdAt,
    status: 'INVITED',
    interviewType: 'VIDEO',
    meetingType: 'DIRECT_VIDEO_CALL',
    scheduledAt: null,
    ...overrides,
  };
}

function makeAssessmentProgress(
  overrides: Partial<NonNullable<ScheduledInterview['assessmentProgress']>>,
): NonNullable<ScheduledInterview['assessmentProgress']> {
  return {
    session: {
      id: 'assessment-session',
      ingestionKey: 'assessment-session:key',
      interviewId: 'interview',
      candidateId: null,
      workspaceId: null,
      workspacePersonId: null,
      applicationId: null,
      mode: 'OPEN_SOURCE_BUG_FIX',
      state: 'CHALLENGE_ASSIGNED',
      createdAt: '2026-06-28T10:00:00.000Z',
      updatedAt: '2026-06-28T10:00:00.000Z',
    },
    stage: 'CHALLENGE_READY',
    nextAction: 'OPEN_ROOM_OR_WORKSPACE',
    nextActionLabel: 'Open the room and launch the controlled workspace.',
    hasChallengePacket: true,
    hasWorkEvidence: false,
    hasMessageEvidence: false,
    hasDevContainerEvidence: false,
    hasToolUsageEvidence: false,
    hasCommitSubmission: false,
    hasFinalSubmission: false,
    hasAiInteraction: false,
    hasTranscriptEvidence: false,
    hasTestEvidence: false,
    evidenceCounts: [],
    sourceRefCounts: [],
    challenge: null,
    latestEvent: null,
    commit: null,
    evaluation: null,
    ...overrides,
  };
}

function cardNames(): string[] {
  return screen.getAllByTestId('interview-card').map((card) => card.textContent ?? '');
}

function renderDashboard(
  interviews: ScheduledInterview[],
  initialEntry = '/interviews',
  options: {
    refetch?: () => Promise<void>;
    loadMore?: () => Promise<void>;
    total?: number;
    hasMore?: boolean;
    isLoadingMore?: boolean;
  } = {},
): { refetch: () => Promise<void>; loadMore: () => Promise<void> } {
  const refetch = options.refetch ?? vi.fn().mockResolvedValue(undefined);
  const loadMore = options.loadMore ?? vi.fn().mockResolvedValue(undefined);
  mocks.useScheduledInterviews.mockReturnValue({
    interviews,
    isLoading: false,
    isLoadingMore: options.isLoadingMore ?? false,
    error: null,
    total: options.total ?? interviews.length,
    hasMore: options.hasMore ?? false,
    updateStatus: vi.fn(),
    sendInvite: vi.fn(),
    refetch,
    loadMore,
  });
  mocks.useBookingNotifications.mockReturnValue({
    notifications: [],
    isConnected: false,
    clearNotifications: vi.fn(),
  });

  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SchedulingDashboard />
    </MemoryRouter>,
  );
  return { refetch, loadMore };
}

describe('SchedulingDashboard interview ordering', () => {
  const interviews = [
    makeInterview({
      id: 'oldest-interview',
      createdAt: '2026-06-20T10:00:00.000Z',
      recipientName: 'Oldest invite',
      scheduledAt: '2026-06-30T18:00:00.000Z',
    }),
    makeInterview({
      id: 'newest-interview',
      createdAt: '2026-06-28T10:00:00.000Z',
      recipientName: 'Newest invite',
      scheduledAt: null,
    }),
    makeInterview({
      id: 'middle-interview',
      createdAt: '2026-06-24T10:00:00.000Z',
      recipientName: 'Middle invite',
      scheduledAt: '2026-06-29T18:00:00.000Z',
    }),
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'));
    mocks.useScheduledInterviews.mockReset();
    mocks.useBookingNotifications.mockReset();
    mocks.api.post.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to most recently created interviews and can switch back to timeline ordering', () => {
    renderDashboard(interviews);

    expect(screen.getByText('NEWEST CREATED')).toBeInTheDocument();
    expect(cardNames()).toEqual(['Newest invite', 'Middle invite', 'Oldest invite']);

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));

    expect(screen.getByText('TODAY')).toBeInTheDocument();
    expect(screen.getByText('TOMORROW')).toBeInTheDocument();
    expect(screen.getByText('UNSCHEDULED')).toBeInTheDocument();
    expect(cardNames()).toEqual(['Middle invite', 'Oldest invite', 'Newest invite']);
  });

  it('supports oldest-created ordering for backtracking invite history', () => {
    renderDashboard(interviews);

    fireEvent.click(screen.getByRole('button', { name: 'Oldest' }));

    expect(screen.getByText('OLDEST CREATED')).toBeInTheDocument();
    expect(cardNames()).toEqual(['Oldest invite', 'Middle invite', 'Newest invite']);
  });

  it('shows paged interview counts and loads more history on demand', () => {
    const loadMore = vi.fn().mockResolvedValue(undefined);

    renderDashboard(interviews.slice(0, 2), '/interviews', {
      total: 137,
      hasMore: true,
      loadMore,
    });

    expect(screen.getByText('2 loaded · 137 total')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'LOAD MORE (135 REMAINING)' });
    fireEvent.click(button);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('uses the per-interview recipient label before the canonical person name', () => {
    renderDashboard([
      makeInterview({
        id: 'same-email-followup',
        createdAt: '2026-06-28T10:00:00.000Z',
        recipientName: 'Hannah follow-up',
        recipientEmail: 'shared@example.com',
        candidateName: 'First saved name',
        candidateEmail: 'canonical@example.com',
      }),
    ]);

    const card = screen.getByTestId('interview-card');
    expect(card).toHaveTextContent('Hannah follow-up');
    expect(card).not.toHaveTextContent('First saved name');
    expect(card).toHaveAttribute('data-candidate-email', 'shared@example.com');
  });

  it('starts source-backed evaluation from a list card and refreshes interviews', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.api.post.mockResolvedValue({
      progress: null,
      diagnostic: null,
      report: {
        id: 'evaluation-report-1',
        sessionId: 'assessment-session-1',
        status: 'EVALUATED',
        contextRecordId: null,
      },
    });

    renderDashboard([
      makeInterview({
        id: 'ready-evaluation-interview',
        createdAt: '2026-06-28T10:00:00.000Z',
        recipientName: 'Ready evaluation',
        interviewType: 'OPEN_SOURCE_BUG_FIX',
      }),
    ], '/interviews', { refetch });

    fireEvent.click(screen.getByRole('button', { name: 'Evaluate ready-evaluation-interview' }));

    expect(mocks.api.post).toHaveBeenCalledWith(
      '/api/v1/scheduling/interviews/ready-evaluation-interview/assessment/start-evaluation',
      {},
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(refetch).toHaveBeenCalled();
  });

  it('filters assessment interviews by recruiter action state', () => {
    renderDashboard([
      makeInterview({
        id: 'ready-to-evaluate',
        createdAt: '2026-06-28T10:00:00.000Z',
        recipientName: 'Ready to evaluate',
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        assessmentProgress: makeAssessmentProgress({
          stage: 'READY_FOR_EVALUATION',
          nextAction: 'START_EVALUATION',
          nextActionLabel: 'Start source-backed AI or human evaluation.',
          readiness: {
            status: 'READY_FOR_EVALUATION',
            label: 'Ready for evaluation',
            detail: 'Required source-backed evidence is captured.',
            isReadyForEvaluation: true,
            isUsableHiringSignal: false,
            missingRequiredCount: 0,
            required: [],
            confidence: [],
          },
        }),
      }),
      makeInterview({
        id: 'needs-attention',
        createdAt: '2026-06-27T10:00:00.000Z',
        recipientName: 'Needs attention',
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        assessmentProgress: makeAssessmentProgress({
          stage: 'NEEDS_ATTENTION',
          nextAction: 'RESOLVE_DIAGNOSTIC',
          nextActionLabel: 'Resolve evaluator diagnostic.',
          readiness: {
            status: 'NEEDS_ATTENTION',
            label: 'Needs attention',
            detail: 'Resolve evaluator diagnostic.',
            isReadyForEvaluation: false,
            isUsableHiringSignal: false,
            missingRequiredCount: 1,
            required: [],
            confidence: [],
          },
        }),
      }),
      makeInterview({
        id: 'evaluated',
        createdAt: '2026-06-26T10:00:00.000Z',
        recipientName: 'Evaluated',
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        assessmentProgress: makeAssessmentProgress({
          stage: 'EVALUATED',
          nextAction: 'REVIEW_EVALUATION',
          nextActionLabel: 'Review evaluation.',
          readiness: {
            status: 'EVALUATED',
            label: 'Evaluated',
            detail: 'Source-backed report ready.',
            isReadyForEvaluation: true,
            isUsableHiringSignal: false,
            missingRequiredCount: 0,
            required: [],
            confidence: [],
          },
          evaluation: {
            id: 'evaluation-1',
            status: 'EVALUATED',
            summary: 'Source-backed report ready.',
            recommendation: 'advance',
            createdAt: '2026-06-28T10:30:00.000Z',
            evidenceCoverage: null,
            claims: [],
          },
        }),
      }),
      makeInterview({
        id: 'standard-call',
        createdAt: '2026-06-25T10:00:00.000Z',
        recipientName: 'Standard call',
        interviewType: 'VIDEO',
      }),
    ]);

    expect(screen.getByRole('button', { name: /Action needed\s*2/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ready to evaluate\s*1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Needs attention\s*1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Evaluated\s*1/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ready to evaluate\s*1/i }));
    expect(cardNames()).toEqual(['Ready to evaluate']);
    expect(screen.getByText('1 shown · 4 total')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Action needed\s*2/i }));
    expect(cardNames()).toEqual(['Ready to evaluate', 'Needs attention']);

    fireEvent.click(screen.getByRole('button', { name: /Evaluated\s*1/i }));
    expect(cardNames()).toEqual(['Evaluated']);
  });

  it('opens the invite modal from a person next-action URL with prefilled context', () => {
    renderDashboard(
      interviews,
      '/interviews?new=1&recipientName=Ada+Reviewer&recipientEmail=ada%40example.com&interviewType=VIDEO&recruiterNotes=Probe+repo+matching+confidence',
    );

    const modal = screen.getByTestId('invite-modal');
    expect(modal).toHaveAttribute('data-recipient-name', 'Ada Reviewer');
    expect(modal).toHaveAttribute('data-recipient-email', 'ada@example.com');
    expect(modal).toHaveAttribute('data-interview-type', 'VIDEO');
    expect(modal).toHaveAttribute('data-recruiter-notes', 'Probe repo matching confidence');
  });
});

describe('resolveInviteCreationGuestLink', () => {
  it('returns the Pipe room URL instead of a provider scheduling URL', () => {
    expect(resolveInviteCreationGuestLink({
      meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
      schedulingUrl: 'https://calendly.com/pipe/interview?a1=abc',
      deliveredUrl: 'https://calendly.com/pipe/interview?a1=abc',
    })).toBe('https://room-dev.hire-pipe.com/room/guest-token');
  });
});
