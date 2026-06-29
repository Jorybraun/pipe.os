// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AssessmentStatusStrip,
  assessmentModeForRoom,
  assessmentModeLabel,
} from './AssessmentStatusStrip';
import type { RoomWorkspace } from '../types';

const challengePacket = {
  sourceRefType: 'open_source_challenge_packet',
  evidenceRole: 'assigned_challenge',
  exactText: [
    'Repo: https://github.com/pipe/source-backed-worker',
    'Base commit: dddddddddddddddddddddddddddddddddddddddd',
    'Task: Fix the source-backed worker retry path.',
    'Success criteria:',
    '- Retry order remains deterministic',
    '- Existing worker tests pass',
    'Expected evidence:',
    '- Commit SHA on assessment branch',
    '- Test command output',
  ].join('\n'),
  locator: {
    repositoryUrl: 'https://github.com/pipe/source-backed-worker',
    githubPrNumber: 144,
    baseCommitSha: 'dddddddddddddddddddddddddddddddddddddddd',
  },
  contentHash: 'sha256:packet-content-hash',
};

function workspace(overrides: Partial<RoomWorkspace> = {}): RoomWorkspace {
  return {
    enabled: true,
    canLaunch: false,
    repoUrl: 'https://github.com/pipe/source-backed-worker',
    githubPrNumber: 144,
    matchedRepoId: 12,
    challenge: {
      status: 'github_pr_assigned',
      kind: 'github_pr',
      source: 'scheduled_interview.github_pr_number',
      message: null,
      packet: challengePacket,
    },
    session: {
      sessionId: 'workspace-session-1',
      status: 'READY',
      ttlSeconds: 3600,
      ttlSource: 'container',
      expiresAt: '2026-06-30T00:00:00.000Z',
      warnedAt: null,
      expiringSoon: false,
      proxyPath: '/workspace',
      errorMessage: null,
    },
    ...overrides,
  };
}

describe('AssessmentStatusStrip', () => {
  it('classifies standard, code review, and dev-container assessment modes', () => {
    expect(assessmentModeForRoom({ meetingType: 'DIRECT_VIDEO_CALL', workspaceEnabled: false })).toBe('standard_call');
    expect(assessmentModeForRoom({ meetingType: 'CODE_REVIEW', workspaceEnabled: false })).toBe('code_review');
    expect(assessmentModeForRoom({ meetingType: 'INTERVIEW', workspaceEnabled: true })).toBe('dev_container_assessment');
    expect(assessmentModeLabel('dev_container_assessment')).toBe('Dev-container assessment');
  });

  it('shows the concrete repo challenge and ready workspace actions', () => {
    const onOpenWorkspace = vi.fn();
    const onOpenSubmission = vi.fn();
    render(
      <AssessmentStatusStrip
        meetingType="INTERVIEW"
        workspace={workspace()}
        onOpenWorkspace={onOpenWorkspace}
        onOpenSubmission={onOpenSubmission}
      />,
    );

    expect(screen.getByTestId('assessment-status-strip').getAttribute('data-assessment-mode')).toBe('dev_container_assessment');
    expect(screen.getByText('Dev-container assessment')).not.toBeNull();
    expect(screen.getByTestId('assessment-workspace-status').textContent).toContain('Workspace ready');
    expect(screen.getByTestId('assessment-repo').textContent).toBe('pipe/source-backed-worker');
    expect(screen.getByTestId('assessment-pr').textContent).toContain('PR #144');
    expect(screen.getByTestId('assessment-base-commit').textContent).toContain('Base dddddddd');
    expect(screen.getByTestId('assessment-next-action').textContent).toContain('Fix the source-backed worker retry path.');
    expect(screen.getByText('2 evidence items')).not.toBeNull();

    fireEvent.click(screen.getByTestId('assessment-open-workspace'));
    fireEvent.click(screen.getByTestId('assessment-open-submission'));

    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
    expect(onOpenSubmission).toHaveBeenCalledTimes(1);
  });

  it('shows a launch action when the host can start the controlled workspace', () => {
    const onLaunchWorkspace = vi.fn();
    render(
      <AssessmentStatusStrip
        meetingType="DEV_CONTAINER_CHALLENGE"
        workspace={workspace({
          canLaunch: true,
          session: null,
        })}
        canLaunchWorkspace
        onLaunchWorkspace={onLaunchWorkspace}
      />,
    );

    expect(screen.getByTestId('assessment-workspace-status').textContent).toContain('Workspace not launched');
    expect(screen.getByText('Launch the controlled workspace')).not.toBeNull();

    fireEvent.click(screen.getByTestId('assessment-launch-workspace'));
    expect(onLaunchWorkspace).toHaveBeenCalledTimes(1);
  });

  it('keeps code review rooms legible without pretending a dev container exists', () => {
    render(
      <AssessmentStatusStrip
        meetingType="CODE_REVIEW"
        workspace={null}
      />,
    );

    expect(screen.getByTestId('assessment-status-strip').getAttribute('data-assessment-mode')).toBe('code_review');
    expect(screen.getByText('Code review')).not.toBeNull();
    expect(screen.getByTestId('assessment-workspace-status').textContent).toContain('No dev workspace');
    expect(screen.getByText('Review the assigned code with source-backed notes')).not.toBeNull();
    expect(screen.queryByTestId('assessment-launch-workspace')).toBeNull();
    expect(screen.queryByTestId('assessment-open-submission')).toBeNull();
  });

  it('surfaces missing challenge setup instead of showing a random repo assignment', () => {
    render(
      <AssessmentStatusStrip
        meetingType="DEV_CONTAINER_CHALLENGE"
        workspace={workspace({
          challenge: {
            status: 'missing_reviewable_task',
            kind: 'repo_only',
            source: 'matched_repo_without_pr',
            message: 'Repo matched, but no reviewable PR or task is configured.',
            packet: null,
          },
          session: null,
        })}
      />,
    );

    expect(screen.getByTestId('assessment-next-action').textContent).toContain(
      'Repo matched, but no reviewable PR or task is configured.',
    );
  });
});
