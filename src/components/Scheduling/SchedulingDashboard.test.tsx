import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SchedulingDashboard } from './SchedulingDashboard';
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
  }) => (
    <div
      data-testid="interview-card"
      data-interview-id={props.interview.id}
      data-created-at={props.interview.createdAt}
      data-candidate-email={props.candidateEmail ?? ''}
    >
      {props.candidateName}
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

function cardNames(): string[] {
  return screen.getAllByTestId('interview-card').map((card) => card.textContent ?? '');
}

function renderDashboard(interviews: ScheduledInterview[], initialEntry = '/interviews'): void {
  mocks.useScheduledInterviews.mockReturnValue({
    interviews,
    isLoading: false,
    error: null,
    updateStatus: vi.fn(),
    sendInvite: vi.fn(),
    refetch: vi.fn(),
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
