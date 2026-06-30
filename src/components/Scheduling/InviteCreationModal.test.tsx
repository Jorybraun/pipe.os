import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InviteCreationModal } from './InviteCreationModal';

const mocks = vi.hoisted(() => ({
  useSchedulingConnection: vi.fn(),
}));

vi.mock('../../hooks/useSchedulingConnection', () => ({
  useSchedulingConnection: mocks.useSchedulingConnection,
}));

describe('InviteCreationModal open-source challenge packets', () => {
  it('prefills person context when opened from a profile next action', () => {
    mocks.useSchedulingConnection.mockReturnValue({
      connection: null,
    });

    render(
      <InviteCreationModal
        isOpen
        onClose={vi.fn()}
        onCreateInvite={vi.fn()}
        initialRecipientName="Ada Reviewer"
        initialRecipientEmail="ada@example.com"
        initialInterviewType="VIDEO"
        initialRecruiterNotes="Probe source-backed repo matching confidence."
      />,
    );

    expect(screen.getByPlaceholderText('Jane Doe')).toHaveValue('Ada Reviewer');
    expect(screen.getByPlaceholderText('jane@example.com')).toHaveValue('ada@example.com');
    expect(screen.getByPlaceholderText('Why are we running this interview, and what should it clarify?')).toHaveValue(
      'Probe source-backed repo matching confidence.',
    );
    expect(screen.getByRole('button', { name: /Video/i })).toHaveStyle({
      color: '#60a5fa',
    });
  });

  it('submits a complete manual open-source challenge packet for assessment invites', async () => {
    mocks.useSchedulingConnection.mockReturnValue({
      connection: null,
    });
    const onCreateInvite = vi.fn().mockResolvedValue({
      id: 'interview-open-source-1',
      meetingUrl: 'https://room-dev.hire-pipe.com/room/token',
      emailSent: true,
    });

    render(
      <InviteCreationModal
        isOpen
        onClose={vi.fn()}
        onCreateInvite={onCreateInvite}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open-source bug fix/i }));
    fireEvent.change(screen.getByPlaceholderText('Jane Doe'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.change(screen.getByPlaceholderText('jane@example.com'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Why are we running this interview, and what should it clarify?'), {
      target: { value: 'Confirm the manual challenge is fair before treating the result as signal.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Specify repo manually' }));
    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/sourcegraph/sourcegraph' },
    });
    fireEvent.change(screen.getByPlaceholderText('PR number'), {
      target: { value: '42' },
    });
    fireEvent.change(screen.getByPlaceholderText('40-character base commit SHA'), {
      target: { value: '1111111111111111111111111111111111111111' },
    });
    fireEvent.change(screen.getByPlaceholderText('Fix streaming transcript ordering'), {
      target: { value: 'Fix event ordering in the transcript stream' },
    });
    fireEvent.change(screen.getByPlaceholderText('Describe the exact bug, task, and boundaries.'), {
      target: { value: 'Investigate and fix transcript segments arriving out of order after reconnect.' },
    });
    fireEvent.change(screen.getByPlaceholderText('One success criterion per line'), {
      target: {
        value: 'Segments remain ordered by timestamp\nReconnect does not duplicate final segments',
      },
    });
    fireEvent.change(screen.getByPlaceholderText('One required evidence item per line'), {
      target: {
        value: 'Commit SHA on assessment branch\nTest command output\nCandidate explanation',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'CREATE ASSESSMENT INVITE' }));

    await waitFor(() => expect(onCreateInvite).toHaveBeenCalledTimes(1));
    expect(onCreateInvite).toHaveBeenCalledWith(expect.objectContaining({
      recipientName: 'Ada Lovelace',
      recipientEmail: 'ada@example.com',
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      recruiterNotes: 'Confirm the manual challenge is fair before treating the result as signal.',
      githubRepoUrl: 'https://github.com/sourcegraph/sourcegraph',
      githubPrNumber: 42,
      challengeBaseCommitSha: '1111111111111111111111111111111111111111',
      challengeTitle: 'Fix event ordering in the transcript stream',
      challengeInstructions: 'Investigate and fix transcript segments arriving out of order after reconnect.',
      challengeSuccessCriteria: [
        'Segments remain ordered by timestamp',
        'Reconnect does not duplicate final segments',
      ],
      challengeExpectedEvidence: [
        'Commit SHA on assessment branch',
        'Test command output',
        'Candidate explanation',
      ],
    }));
  });

  it('keeps manual open-source packets blocked until the base commit is a 40-character hex SHA', () => {
    mocks.useSchedulingConnection.mockReturnValue({
      connection: null,
    });
    const onCreateInvite = vi.fn();

    render(
      <InviteCreationModal
        isOpen
        onClose={vi.fn()}
        onCreateInvite={onCreateInvite}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open-source bug fix/i }));
    fireEvent.change(screen.getByPlaceholderText('Jane Doe'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.change(screen.getByPlaceholderText('jane@example.com'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Specify repo manually' }));
    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/sourcegraph/sourcegraph' },
    });
    fireEvent.change(screen.getByPlaceholderText('PR number'), {
      target: { value: '42' },
    });
    fireEvent.change(screen.getByPlaceholderText('40-character base commit SHA'), {
      target: { value: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' },
    });
    fireEvent.change(screen.getByPlaceholderText('Fix streaming transcript ordering'), {
      target: { value: 'Fix event ordering in the transcript stream' },
    });
    fireEvent.change(screen.getByPlaceholderText('Describe the exact bug, task, and boundaries.'), {
      target: { value: 'Investigate and fix transcript segments arriving out of order after reconnect.' },
    });
    fireEvent.change(screen.getByPlaceholderText('One success criterion per line'), {
      target: { value: 'Segments remain ordered by timestamp' },
    });
    fireEvent.change(screen.getByPlaceholderText('One required evidence item per line'), {
      target: { value: 'Commit SHA on assessment branch' },
    });

    expect(screen.getByRole('button', { name: 'CREATE ASSESSMENT INVITE' })).toBeDisabled();
    expect(onCreateInvite).not.toHaveBeenCalled();
  });
});
