// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssessmentTaskBrief } from './AssessmentTaskBrief';
import type { RoomAssessmentProgressSnapshot, RoomWorkspace, RoomWorkspaceChallengePacket } from '../types';

const packet: RoomWorkspaceChallengePacket = {
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

const workspace: RoomWorkspace = {
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
    packet,
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
};

const progress: RoomAssessmentProgressSnapshot = {
  mode: 'OPEN_SOURCE_BUG_FIX',
  state: 'FINAL_SUBMITTED',
  stage: 'READY_FOR_EVALUATION',
  nextAction: 'START_EVALUATION',
  nextActionLabel: 'Start source-backed AI or human evaluation.',
  hasChallengePacket: true,
  hasWorkEvidence: true,
  hasMessageEvidence: true,
  hasDevContainerEvidence: true,
  hasToolUsageEvidence: true,
  hasCommitSubmission: true,
  hasFinalSubmission: false,
  hasAiInteraction: true,
  hasTranscriptEvidence: false,
  hasTestEvidence: true,
  evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
  sourceRefCounts: [{ kind: 'test_run', count: 1 }],
  latestEvent: {
    kind: 'commit_submission',
    sequence: 4,
    occurredAt: '2026-06-29T22:00:00.000Z',
  },
  commit: {
    repositoryUrl: 'https://github.com/pipe/source-backed-worker',
    forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
    branchName: 'pipe-assessment/retry-path',
    baseCommitSha: 'd'.repeat(40),
    commitSha: 'c'.repeat(40),
    commitUrl: `https://github.com/candidate/source-backed-worker/commit/${'c'.repeat(40)}`,
    changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
    occurredAt: '2026-06-29T22:00:00.000Z',
  },
  evaluation: null,
};

describe('AssessmentTaskBrief', () => {
  it('keeps the real task, success criteria, expected evidence, and submit path visible', () => {
    const onOpenWorkspace = vi.fn();
    const onOpenSubmission = vi.fn();

    render(
      <AssessmentTaskBrief
        packet={packet}
        workspace={workspace}
        progress={progress}
        workspaceReady
        onOpenWorkspace={onOpenWorkspace}
        onOpenSubmission={onOpenSubmission}
      />,
    );

    const brief = screen.getByTestId('assessment-task-brief');
    const briefText = brief.textContent ?? '';
    expect(briefText).toContain('Assessment task');
    expect(briefText).toContain('Open-source implementation');
    expect(briefText).toContain('pipe/source-backed-worker');
    expect(briefText).toContain('#144');
    expect(briefText).toContain('dddddddddd');
    expect(briefText).toContain('pipe-assessment/retry-path');
    expect(briefText).toContain('Start source-backed AI or human evaluation.');
    expect(briefText).toContain('Fix the source-backed worker retry path.');
    expect(briefText).toContain('Retry order remains deterministic');
    expect(briefText).toContain('Existing worker tests pass');
    expect(briefText).toContain('Commit SHA on assessment branch');
    expect(briefText).toContain('Test command output');
    expect(briefText).toContain('Commit cccccccccc');
    expect(briefText).not.toContain('sha256:packet-content-hash');

    fireEvent.click(screen.getByTestId('assessment-brief-open-workspace'));
    fireEvent.click(screen.getByTestId('assessment-brief-open-submission'));
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
    expect(onOpenSubmission).toHaveBeenCalledTimes(1);
  });

  it('shows a diagnostic instead of inventing a task when the packet is missing', () => {
    render(
      <AssessmentTaskBrief
        packet={null}
        workspace={{ ...workspace, challenge: { ...workspace.challenge, packet: null } }}
        workspaceReady={false}
      />,
    );

    expect(screen.getByText('The host still needs to attach a source-backed task packet before this assessment can be trusted.')).not.toBeNull();
    expect(screen.queryByTestId('assessment-brief-open-submission')).toBeNull();
  });
});
