// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AssessmentStatusStrip,
  assessmentModeForRoom,
  assessmentModeLabel,
} from './AssessmentStatusStrip';
import type { RoomAssessmentProgressSnapshot, RoomWorkspace } from '../types';

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
  readiness: {
    status: 'READY_FOR_EVALUATION',
    label: 'Ready for evaluation',
    detail: 'Required challenge, work, commit, and source evidence are captured.',
    isReadyForEvaluation: true,
    isUsableHiringSignal: false,
    missingRequiredCount: 0,
    required: [
      {
        id: 'challenge_packet',
        label: 'Complete challenge packet',
        required: true,
        satisfied: true,
        sourceRefTypes: ['open_source_challenge_packet'],
        missingImpact: 'Assign a source-backed challenge packet.',
      },
    ],
    confidence: [],
  },
};

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
    expect(screen.getByTestId('assessment-open-submission').textContent).toContain('Submit Work');

    fireEvent.click(screen.getByTestId('assessment-open-workspace'));
    fireEvent.click(screen.getByTestId('assessment-open-submission'));

    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
    expect(onOpenSubmission).toHaveBeenCalledTimes(1);
  });

  it('surfaces durable assessment progress after commit submission', () => {
    render(
      <AssessmentStatusStrip
        meetingType="DEV_CONTAINER_CHALLENGE"
        workspace={workspace()}
        assessmentProgress={{
          ...progress,
          sourceRefCounts: [
            { kind: 'ai_user_prompt', count: 1 },
            { kind: 'ai_agent_response', count: 1 },
            { kind: 'test_run', count: 1 },
          ],
        }}
      />,
    );

    expect(screen.getByTestId('assessment-progress-stage').textContent).toContain('Ready For Evaluation');
    expect(screen.getByTestId('assessment-readiness').textContent).toContain('Ready to evaluate');
    expect(screen.getByTestId('assessment-progress-commit').textContent).toContain('Commit cccccccc');
    expect(screen.getByTestId('assessment-ai-usage-state').textContent).toContain('AI response captured');
    expect(screen.getByText('Start source-backed AI or human evaluation.')).not.toBeNull();
    expect(screen.getByTestId('assessment-progress-coverage').textContent).toContain('challenge, chat, workspace, tool activity, commit, AI response, tests');
  });

  it('makes the absence of AI usage visible instead of implying it was captured', () => {
    render(
      <AssessmentStatusStrip
        meetingType="DEV_CONTAINER_CHALLENGE"
        workspace={workspace()}
        assessmentProgress={{
          ...progress,
          hasAiInteraction: false,
        }}
      />,
    );

    expect(screen.getByTestId('assessment-ai-usage-state').textContent).toContain('No AI use captured');
    expect(screen.getByTestId('assessment-progress-coverage').textContent).toContain(
      'challenge, chat, workspace, tool activity, commit, tests',
    );
    expect(screen.getByTestId('assessment-progress-coverage').textContent).not.toContain('AI use');
  });

  it('shows blocked AI prompts as diagnostics instead of completed AI help', () => {
    render(
      <AssessmentStatusStrip
        meetingType="DEV_CONTAINER_CHALLENGE"
        workspace={workspace()}
        assessmentProgress={{
          ...progress,
          hasAiInteraction: true,
          sourceRefCounts: [
            { kind: 'ai_user_prompt_blocked', count: 1 },
            { kind: 'test_run', count: 1 },
          ],
        }}
      />,
    );

    expect(screen.getByTestId('assessment-ai-usage-state').textContent).toContain('AI prompt blocked');
    expect(screen.getByTestId('assessment-ai-usage-state').getAttribute('title')).toBe(
      '1 blocked prompt captured. A prompt was blocked or the bridge was unavailable; no agent response is counted as assistance.',
    );
    expect(screen.getByTestId('assessment-ai-usage-state').textContent).not.toContain('AI use captured');
    expect(screen.getByTestId('assessment-progress-coverage').textContent).toContain(
      'challenge, chat, workspace, tool activity, commit, AI prompt blocked, tests',
    );
  });

  it('surfaces agent bridge status without counting it as completed AI help', () => {
    render(
      <AssessmentStatusStrip
        meetingType="DEV_CONTAINER_CHALLENGE"
        workspace={workspace()}
        assessmentProgress={{
          ...progress,
          hasAiInteraction: true,
          sourceRefCounts: [
            { kind: 'agent_status', count: 1 },
            { kind: 'test_run', count: 1 },
          ],
        }}
      />,
    );

    expect(screen.getByTestId('assessment-ai-usage-state').textContent).toContain('AI bridge status');
    expect(screen.getByTestId('assessment-ai-usage-state').getAttribute('title')).toBe(
      '1 bridge status captured; no agent response is counted as assistance.',
    );
    expect(screen.getByTestId('assessment-ai-usage-state').textContent).not.toContain('AI response captured');
    expect(screen.getByTestId('assessment-progress-coverage').textContent).toContain(
      'challenge, chat, workspace, tool activity, commit, AI bridge status, tests',
    );
  });

  it('surfaces verification gaps in live room progress coverage', () => {
    render(
      <AssessmentStatusStrip
        meetingType="DEV_CONTAINER_CHALLENGE"
        workspace={workspace()}
        assessmentProgress={{
          ...progress,
          hasTestEvidence: false,
          hasVerificationGap: true,
          sourceRefCounts: [
            { kind: 'git_commit', count: 1 },
            { kind: 'code_diff', count: 1 },
            { kind: 'verification_gap', count: 1 },
          ],
          readiness: {
            ...progress.readiness!,
            detail: 'Required proof is captured, but passing test output is missing.',
            confidence: [
              {
                id: 'test_or_verification',
                label: 'Tests or verification note',
                required: false,
                satisfied: true,
                sourceRefTypes: ['test_run', 'verification_gap'],
                missingImpact: 'Missing test evidence lowers confidence; an explicit verification gap is better than silence.',
              },
            ],
          },
        }}
      />,
    );

    const coverage = screen.getByTestId('assessment-progress-coverage');
    expect(coverage.textContent).toContain('challenge, chat, workspace, tool activity, commit, AI trace, verification gap');
    expect(coverage.textContent).not.toContain('tests');
  });

  it('surfaces evaluation diagnostics in the room status strip', () => {
    render(
      <AssessmentStatusStrip
        meetingType="DEV_CONTAINER_CHALLENGE"
        workspace={workspace()}
        assessmentProgress={{
          ...progress,
          stage: 'NEEDS_ATTENTION',
          nextAction: 'RESOLVE_DIAGNOSTIC',
          nextActionLabel: 'Resolve the blocking diagnostic before continuing.',
          evaluation: {
            status: 'AI_DEVELOPER_UNAVAILABLE',
            summary: 'Workers AI is not configured for source-backed repo-task evaluation.',
            recommendation: 'insufficient_evidence',
            createdAt: '2026-06-29T22:03:00.000Z',
            diagnostics: [
              {
                id: 'diagnostic-ai-unavailable',
                code: 'AI_DEVELOPER_UNAVAILABLE',
                severity: 'blocking',
                message: 'Workers AI is not configured for source-backed repo-task evaluation.',
                sourceRefCount: 1,
                sourceRefTypes: ['assessment_evaluation_request'],
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByTestId('assessment-progress-stage').textContent).toContain('Needs Attention');
    expect(screen.getByTestId('assessment-evaluation-diagnostic').textContent).toContain('AI Developer Unavailable');
    expect(screen.getByTestId('assessment-evaluation-diagnostic').getAttribute('title')).toBe(
      'Workers AI is not configured for source-backed repo-task evaluation.',
    );
    expect(screen.getByTestId('assessment-evaluation-diagnostic-detail').textContent).toContain(
      'Workers AI is not configured for source-backed repo-task evaluation.',
    );
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

  it('offers a relaunch action when the latest controlled workspace failed', () => {
    const onLaunchWorkspace = vi.fn();
    render(
      <AssessmentStatusStrip
        meetingType="DEV_CONTAINER_CHALLENGE"
        workspace={workspace({
          canLaunch: true,
          session: {
            sessionId: 'workspace-session-failed',
            status: 'ERROR',
            ttlSeconds: 3600,
            ttlSource: 'container',
            expiresAt: '2026-06-30T00:00:00.000Z',
            warnedAt: null,
            expiringSoon: false,
            proxyPath: null,
            errorMessage: 'Container stopped unexpectedly (exit code 0, reason exit).',
          },
        })}
        canLaunchWorkspace
        onLaunchWorkspace={onLaunchWorkspace}
      />,
    );

    expect(screen.getByTestId('assessment-workspace-status').textContent).toContain(
      'Container stopped unexpectedly',
    );
    expect(screen.getByText('Relaunch the controlled workspace')).not.toBeNull();
    expect(screen.getByTestId('assessment-launch-workspace').textContent).toContain('Relaunch');

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
    expect(screen.getByText('Assign a GitHub PR or complete source-backed task packet before launching')).not.toBeNull();
    expect(screen.queryByTestId('assessment-launch-workspace')).toBeNull();
  });

  it('prioritizes incomplete packet fields over a generic progress action', () => {
    render(
      <AssessmentStatusStrip
        meetingType="DEV_CONTAINER_CHALLENGE"
        workspace={workspace({
          canLaunch: false,
          challenge: {
            status: 'repo_task_assigned',
            kind: 'repo_only',
            source: 'scheduled_interview.challenge_packet',
            message: null,
            packet: {
              ...challengePacket,
              exactText: [
                'Repo: https://github.com/pipe/source-backed-worker',
                'Base commit: dddddddddddddddddddddddddddddddddddddddd',
                'Task: Fix the source-backed worker retry path.',
                'Success criteria:',
                '- Retry order remains deterministic',
              ].join('\n'),
            },
          },
          session: null,
        })}
        assessmentProgress={{
          ...progress,
          stage: 'WAITING_FOR_CHALLENGE',
          nextAction: 'ASSIGN_CHALLENGE',
          nextActionLabel: 'Assign a concrete repo challenge packet.',
          challengePacketContract: {
            schemaVersion: 'challenge-packet-contract-v1',
            isComplete: false,
            missingFields: ['expected evidence'],
            hasRepositoryUrl: true,
            hasBaseCommitSha: true,
            hasTask: true,
            hasSuccessCriteria: true,
            hasExpectedEvidence: false,
          },
          readiness: {
            ...progress.readiness!,
            status: 'WAITING_FOR_CHALLENGE',
            label: 'Waiting for challenge',
            detail: 'Assign expected evidence before candidate work starts.',
            isReadyForEvaluation: false,
            missingRequiredCount: 1,
          },
        }}
      />,
    );

    expect(screen.getByText('Complete challenge packet: missing expected evidence')).not.toBeNull();
    expect(screen.queryByText('Assign a concrete repo challenge packet.')).toBeNull();
    expect(screen.queryByTestId('assessment-launch-workspace')).toBeNull();
  });
});
