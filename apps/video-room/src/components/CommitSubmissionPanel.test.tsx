import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommitSubmissionPanel } from './CommitSubmissionPanel';
import type {
  RoomAssessmentProgressSnapshot,
  RoomCommitSubmissionRequest,
  RoomCommitSubmissionResponse,
  RoomWorkspaceChallengePacket,
  RoomWorkspaceFinalizeResponse,
} from '../types';

const packet: RoomWorkspaceChallengePacket = {
  sourceRefType: 'open_source_challenge_packet',
  evidenceRole: 'assigned_challenge',
  exactText: 'Repo: https://github.com/pipe/source-backed-worker',
  contentHash: 'sha256:packet-content-hash',
  locator: {
    repositoryUrl: 'https://github.com/pipe/source-backed-worker',
    baseCommitSha: 'd'.repeat(40),
  },
};

const richPacket: RoomWorkspaceChallengePacket = {
  ...packet,
  exactText: [
    'Repo: https://github.com/pipe/source-backed-worker',
    `Base commit: ${'d'.repeat(40)}`,
    'Task: Fix the source-backed worker retry path.',
    'Match proof:',
    '- Review packet quality 92% from source-backed repo analysis.',
    '- 2 source-backed repo demands in the selected PR packet.',
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
    baseCommitSha: 'd'.repeat(40),
  },
};

const loadedProgress: RoomAssessmentProgressSnapshot = {
  mode: 'OPEN_SOURCE_BUG_FIX',
  state: 'IN_PROGRESS',
  stage: 'WORK_IN_PROGRESS',
  nextAction: 'SUBMIT_COMMIT',
  nextActionLabel: 'Submit the assessment branch commit.',
  hasChallengePacket: true,
  challengePacketContract: {
    schemaVersion: 'challenge-packet-contract-v1',
    isComplete: true,
    missingFields: [],
    hasRepositoryUrl: true,
    hasBaseCommitSha: true,
    hasTask: true,
    hasSuccessCriteria: true,
    hasExpectedEvidence: true,
  },
  hasWorkEvidence: true,
  hasMessageEvidence: true,
  hasDevContainerEvidence: true,
  hasToolUsageEvidence: true,
  hasCommitSubmission: false,
  hasFinalSubmission: false,
  hasAiInteraction: true,
  hasTranscriptEvidence: false,
  hasTestEvidence: false,
  evidenceCounts: [
    { kind: 'challenge_packet', count: 1 },
    { kind: 'terminal_command', count: 3 },
    { kind: 'ai_interaction', count: 2 },
  ],
  sourceRefCounts: [
    { kind: 'open_source_challenge_packet', count: 1 },
  ],
  latestEvent: {
    kind: 'terminal_command',
    sequence: 7,
    occurredAt: '2026-06-29T20:00:00.000Z',
  },
  commit: null,
  evaluation: null,
  readiness: {
    status: 'WORK_IN_PROGRESS',
    label: 'Work evidence in progress',
    detail: 'Submit a real commit from a pipe-assessment branch or fork before evaluation.',
    isReadyForEvaluation: false,
    isUsableHiringSignal: false,
    missingRequiredCount: 1,
    required: [
      {
        id: 'challenge_packet',
        label: 'Complete challenge packet',
        required: true,
        satisfied: true,
        sourceRefTypes: ['open_source_challenge_packet'],
        missingImpact: 'Assign a source-backed challenge packet.',
      },
      {
        id: 'commit_submission',
        label: 'Assessment branch commit',
        required: true,
        satisfied: false,
        sourceRefTypes: ['git_commit', 'code_diff'],
        missingImpact: 'Submit a real commit from a pipe-assessment branch or fork before evaluation.',
      },
    ],
    confidence: [],
  },
};

describe('CommitSubmissionPanel', () => {
  it('shows the assigned challenge contract and reloaded evidence status before submission', () => {
    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={richPacket}
        assessmentProgress={loadedProgress}
        onSubmit={vi.fn()}
      />,
    );

    const completion = screen.getByTestId('commit-submission-completion');
    expect(completion.textContent).toContain('Assigned open-source challenge');
    expect(completion.textContent).toContain('Submit the assessment branch commit.');
    expect(completion.textContent).toContain('https://github.com/pipe/source-backed-worker');
    expect(completion.textContent).toContain('PR');
    expect(completion.textContent).toContain('#144');
    expect(completion.textContent).toContain('Fix the source-backed worker retry path.');
    expect(completion.textContent).toContain('Match proof');
    expect(completion.textContent).toContain('Review packet quality 92% from source-backed repo analysis.');
    expect(completion.textContent).toContain('2 source-backed repo demands in the selected PR packet.');
    expect(completion.textContent).toContain('Retry order remains deterministic');
    expect(completion.textContent).toContain('Commit SHA on assessment branch');

    const flags = screen.getByTestId('commit-submission-completion-flags');
    expect(flags.textContent).toContain('Complete challenge packet: Captured');
    expect(flags.textContent).toContain('Work evidence: Captured');
    expect(flags.textContent).toContain('Chat evidence: Captured');
    expect(flags.textContent).toContain('Workspace telemetry: Captured');
    expect(flags.textContent).toContain('Tool activity: Captured');
    expect(flags.textContent).not.toContain(['Room', 'actions'].join(' '));
    expect(flags.textContent).toContain('Commit submission: Missing');
    expect(flags.textContent).toContain('Test evidence: Missing');
    expect(flags.textContent).toContain('AI interaction: Captured');

    const progress = screen.getByTestId('commit-submission-progress');
    expect(progress.textContent).toContain('Submit the assessment branch commit.');
    expect(progress.textContent).toContain('Terminal Command #7');
    const readiness = screen.getByTestId('commit-submission-readiness');
    expect(readiness.textContent).toContain('Work evidence in progress');
    expect(readiness.textContent).toContain('Assessment branch commit');
    const finalizerContract = screen.getByTestId('workspace-finalize-trust-contract');
    expect(finalizerContract.textContent).toContain('Trusted finalizer path');
    expect(finalizerContract.textContent).toContain('Reads the current git HEAD inside the controlled workspace.');
    expect(finalizerContract.textContent).toContain('Verifies repository and base commit against the assigned challenge packet.');
    expect(finalizerContract.textContent).toContain('Captures changed files, source diff, and configured verification output or an explicit gap.');
    expect(finalizerContract.textContent).toContain('Stores source refs for the commit, diff, tests, and workspace state before evaluation.');
  });

  it('prefills source-backed repo, base commit, and assessment branch without inventing commit evidence', () => {
    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={richPacket}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId('commit-submission-repository-url')).toHaveProperty(
      'value',
      'https://github.com/pipe/source-backed-worker',
    );
    expect(screen.getByTestId('commit-submission-base-sha')).toHaveProperty(
      'value',
      'd'.repeat(40),
    );
    expect(screen.getByTestId('commit-submission-branch')).toHaveProperty('value', 'pipe-assessment');
    expect(screen.getByTestId('commit-submission-commit-sha')).toHaveProperty('value', '');
    expect(screen.getByTestId('commit-submission-changed-files')).toHaveProperty('value', '');
    expect(screen.getByTestId('commit-submission-diff')).toHaveProperty('value', '');
  });

  it('blocks manual submit and workspace finalization until the challenge packet is complete', () => {
    const onSubmit = vi.fn();
    const onFinalizeWorkspace = vi.fn();

    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={packet}
        onSubmit={onSubmit}
        workspaceFinalizeAvailable
        onFinalizeWorkspace={onFinalizeWorkspace}
      />,
    );

    const completion = screen.getByTestId('commit-submission-completion');
    expect(completion.textContent).toContain('Complete packet before submission');
    expect(screen.getByTestId('commit-submission-challenge-warning').textContent).toContain(
      'Challenge packet incomplete',
    );
    expect(screen.getByTestId('commit-submission-challenge-warning').textContent).toContain(
      'missing task, success criteria, expected evidence',
    );
    expect(screen.getByTestId('commit-submission-disabled').textContent).toContain(
      'Complete the source-backed challenge packet before submitting work.',
    );
    expect(screen.getByTestId('workspace-finalize-submit')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('commit-submission-submit')).toHaveProperty('disabled', true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onFinalizeWorkspace).not.toHaveBeenCalled();
  });

  it('locks duplicate commit submission once source-backed commit evidence is captured', () => {
    const commitSha = 'e'.repeat(40);
    const submittedProgress: RoomAssessmentProgressSnapshot = {
      ...loadedProgress,
      state: 'SUBMITTED',
      stage: 'READY_FOR_EVALUATION',
      nextAction: 'START_EVALUATION',
      nextActionLabel: 'Start source-backed evaluation.',
      hasCommitSubmission: true,
      hasTestEvidence: true,
      evidenceCounts: [
        { kind: 'challenge_packet', count: 1 },
        { kind: 'git_commit', count: 1 },
        { kind: 'code_diff', count: 1 },
        { kind: 'test_run', count: 1 },
      ],
      sourceRefCounts: [
        { kind: 'git_commit', count: 1 },
        { kind: 'code_diff', count: 1 },
        { kind: 'test_run', count: 1 },
      ],
      latestEvent: {
        kind: 'commit_submission',
        sequence: 9,
        occurredAt: '2026-06-29T20:03:00.000Z',
      },
      commit: {
        repositoryUrl: 'https://github.com/pipe/source-backed-worker',
        forkRepositoryUrl: null,
        branchName: 'pipe-assessment',
        baseCommitSha: 'd'.repeat(40),
        commitSha,
        commitUrl: null,
        upstreamPullRequestUrl: null,
        upstreamPrConsent: false,
        submissionSource: 'live_workspace',
        submissionSourceLabel: 'Live workspace finalizer',
        integrity: {
          status: 'workspace_captured',
          label: 'Workspace-captured commit',
          detail: 'Captured by the live dev-container finalizer from the workspace HEAD and exact source refs.',
          tone: 'verified',
        },
        challengeBinding: {
          status: 'bound_to_assigned_challenge',
          label: 'Bound to assigned challenge',
          detail: 'Submitted repository and base commit match the assigned source-backed challenge packet.',
          tone: 'verified',
        },
        changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
        occurredAt: '2026-06-29T20:03:00.000Z',
      },
    };
    const onSubmit = vi.fn();
    const onFinalizeWorkspace = vi.fn();

    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={richPacket}
        assessmentProgress={submittedProgress}
        onSubmit={onSubmit}
        workspaceFinalizeAvailable
        onFinalizeWorkspace={onFinalizeWorkspace}
      />,
    );

    expect(screen.getByTestId('commit-submission-disabled').textContent).toContain(
      'Submission is captured. The assessment commit is locked for source-backed evaluation.',
    );
    expect(screen.getByTestId('workspace-finalize-disabled').textContent).toContain(
      'Submission is captured. The assessment commit is locked for source-backed evaluation.',
    );
    expect(screen.getByTestId('commit-submission-submit')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('commit-submission-submit').textContent).toContain('Submission captured');
    expect(screen.getByTestId('workspace-finalize-submit')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('commit-submission-commit-sha')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('commit-submission-diff')).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByTestId('commit-submission-submit'));
    fireEvent.click(screen.getByTestId('workspace-finalize-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onFinalizeWorkspace).not.toHaveBeenCalled();
  });

  it('submits the current live workspace HEAD through the real finalizer path', async () => {
    const commitSha = 'b'.repeat(40);
    const onSubmit = vi.fn();
    const onProgressChange = vi.fn();
    const finalizeResponse: RoomWorkspaceFinalizeResponse = {
      ok: true,
      submitted: true,
      commit: {
        repositoryUrl: 'https://github.com/pipe/source-backed-worker',
        branchName: 'pipe-assessment',
        baseCommitSha: 'd'.repeat(40),
        commitSha,
        changedFiles: [{ path: 'src/retry.ts', status: 'modified' as const }],
        sourceRefTypes: ['git_commit', 'code_diff', 'test_run'],
      },
      submission: {
        accepted: true,
        repositoryUrl: 'https://github.com/pipe/source-backed-worker',
        branchName: 'pipe-assessment',
        commitSha,
        commitUrl: null,
      },
      progress: {
        ...loadedProgress,
        stage: 'READY_FOR_EVALUATION',
        nextAction: 'START_EVALUATION',
        nextActionLabel: 'Start source-backed evaluation.',
        hasCommitSubmission: true,
        hasTestEvidence: true,
        latestEvent: {
          kind: 'commit_submission',
          sequence: 8,
          occurredAt: '2026-06-29T20:02:00.000Z',
        },
        commit: {
          repositoryUrl: 'https://github.com/pipe/source-backed-worker',
          forkRepositoryUrl: null,
          branchName: 'pipe-assessment',
          baseCommitSha: 'd'.repeat(40),
          commitSha,
          commitUrl: null,
          upstreamPullRequestUrl: 'https://github.com/pipe/source-backed-worker/pull/42',
          upstreamPrConsent: true,
          submissionSource: 'live_workspace',
          submissionSourceLabel: 'Live workspace finalizer',
          integrity: {
            status: 'workspace_captured',
            label: 'Workspace-captured commit',
            detail: 'Captured by the live dev-container finalizer from the workspace HEAD and exact source refs.',
            tone: 'verified',
          },
          challengeBinding: {
            status: 'bound_to_assigned_challenge',
            label: 'Bound to assigned challenge',
            detail: 'Submitted repository and base commit match the assigned source-backed challenge packet.',
            tone: 'verified',
          },
          changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
          occurredAt: '2026-06-29T20:02:00.000Z',
        },
      },
    };
    const onFinalizeWorkspace = vi.fn(async () => finalizeResponse);

    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={richPacket}
        assessmentProgress={loadedProgress}
        onSubmit={onSubmit}
        onProgressChange={onProgressChange}
        workspaceFinalizeAvailable
        onFinalizeWorkspace={onFinalizeWorkspace}
      />,
    );

    fireEvent.change(screen.getByTestId('workspace-finalize-narrative'), {
      target: { value: 'Submitted retry fix from the assessment branch.' },
    });
    fireEvent.change(screen.getByTestId('workspace-finalize-test-command'), {
      target: { value: 'npm test -- retry' },
    });
    fireEvent.change(screen.getByTestId('workspace-finalize-verification-notes'), {
      target: { value: 'Targeted retry test passed in the workspace.' },
    });
    expect(screen.getByTestId('workspace-finalize-trust-contract').textContent).toContain(
      'Verifies repository and base commit against the assigned challenge packet.',
    );
    fireEvent.click(screen.getByTestId('workspace-finalize-submit'));

    await waitFor(() => expect(onFinalizeWorkspace).toHaveBeenCalledTimes(1));
    expect(onFinalizeWorkspace).toHaveBeenCalledWith({
      narrative: 'Submitted retry fix from the assessment branch.',
      testCommand: 'npm test -- retry',
      verificationNotes: 'Targeted retry test passed in the workspace.',
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onProgressChange).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'READY_FOR_EVALUATION',
      hasCommitSubmission: true,
      commit: expect.objectContaining({
        commitSha,
        submissionSource: 'live_workspace',
        submissionSourceLabel: 'Live workspace finalizer',
        integrity: expect.objectContaining({
          status: 'workspace_captured',
          label: 'Workspace-captured commit',
        }),
        challengeBinding: expect.objectContaining({
          status: 'bound_to_assigned_challenge',
          label: 'Bound to assigned challenge',
        }),
      }),
    }));
    expect(screen.getByTestId('workspace-finalize-success').textContent).toContain(commitSha.slice(0, 12));
    expect(screen.getByTestId('commit-submission-progress').textContent).toContain('Ready For Evaluation');
    expect(screen.getByTestId('commit-submission-progress-source').textContent).toContain('Workspace-captured commit');
    expect(screen.getByTestId('commit-submission-progress-source').textContent).toContain(
      'Captured by the live dev-container finalizer from the workspace HEAD and exact source refs.',
    );
    expect(screen.getByTestId('commit-submission-progress-challenge-binding').textContent).toContain(
      'Bound to assigned challenge',
    );
    expect(screen.getByTestId('commit-submission-progress-upstream-pr').textContent).toContain(
      'https://github.com/pipe/source-backed-worker/pull/42 · candidate-approved tracking',
    );
  });

  it('keeps workspace finalization blocked until the live workspace is ready', () => {
    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={richPacket}
        onSubmit={vi.fn()}
        workspaceFinalizeDisabledReason="Launch the workspace before finalizing the assessment commit."
        onFinalizeWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByTestId('workspace-finalize-disabled').textContent).toContain(
      'Launch the workspace before finalizing the assessment commit.',
    );
    expect(screen.getByTestId('workspace-finalize-submit')).toHaveProperty('disabled', true);
  });

  it('shows dirty-worktree recovery commands when live workspace finalization is blocked', async () => {
    const onSubmit = vi.fn();
    const onFinalizeWorkspace = vi.fn(async () => {
      throw new Error('Cannot finalize assessment: commit or discard uncommitted workspace changes before submitting HEAD.');
    });

    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={richPacket}
        onSubmit={onSubmit}
        workspaceFinalizeAvailable
        onFinalizeWorkspace={onFinalizeWorkspace}
      />,
    );

    fireEvent.click(screen.getByTestId('workspace-finalize-submit'));

    await waitFor(() => expect(onFinalizeWorkspace).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('commit-submission-error').textContent).toContain(
      'commit or discard uncommitted workspace changes',
    );
    const recovery = screen.getByTestId('workspace-finalize-recovery');
    expect(recovery.textContent).toContain('Commit workspace changes first');
    expect(recovery.textContent).toContain('git status --short');
    expect(recovery.textContent).toContain('git add <files>');
    expect(recovery.textContent).toContain('git commit -m "pipe assessment submission"');
    expect(recovery.textContent).toContain('Finalize from workspace');
  });

  it('makes upstream PR tracking an explicit opt-in before submitting', async () => {
    const commitSha = 'c'.repeat(40);
    const onSubmit = vi.fn(async (_payload: RoomCommitSubmissionRequest): Promise<RoomCommitSubmissionResponse> => {
      throw new Error('submit should not be called without upstream consent');
    });

    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={richPacket}
        onSubmit={onSubmit}
      />,
    );

    const boundary = screen.getByTestId('commit-submission-boundary');
    expect(boundary.textContent).toContain('Assessment branch first');
    expect(boundary.textContent).toContain('Upstream PR tracking is optional');
    const checklist = screen.getByTestId('commit-submission-checklist');
    expect(checklist.textContent).toContain('git rev-parse HEAD');
    expect(checklist.textContent).toContain('git show --stat --no-patch HEAD');
    expect(checklist.textContent).toContain('git diff BASE..HEAD');

    fireEvent.change(screen.getByTestId('commit-submission-changed-files'), {
      target: { value: 'modified src/retry.ts' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-commit-sha'), {
      target: { value: commitSha },
    });
    fireEvent.change(screen.getByTestId('commit-submission-upstream-pr-url'), {
      target: { value: 'https://github.com/pipe/source-backed-worker/pull/42' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-narrative'), {
      target: { value: 'Submitted retry fix; tests pass locally.' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-commit-evidence'), {
      target: { value: `commit ${commitSha}\nAuthor: Candidate` },
    });
    fireEvent.change(screen.getByTestId('commit-submission-diff'), {
      target: { value: 'diff --git a/src/retry.ts b/src/retry.ts' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-verification-notes'), {
      target: { value: 'Focused upstream PR consent check; test output is not part of this fixture.' },
    });
    fireEvent.click(screen.getByTestId('commit-submission-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('commit-submission-error').textContent).toContain(
        'Upstream PR URL requires explicit candidate approval.',
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks non-GitHub repositories before the source-backed assessment submit', async () => {
    const commitSha = 'c'.repeat(40);
    const onSubmit = vi.fn(async (_payload: RoomCommitSubmissionRequest): Promise<RoomCommitSubmissionResponse> => {
      throw new Error('submit should not be called with fake repository evidence');
    });

    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={richPacket}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByTestId('commit-submission-repository-url'), {
      target: { value: 'https://example.com/not/github' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-changed-files'), {
      target: { value: 'modified src/retry.ts' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-commit-sha'), {
      target: { value: commitSha },
    });
    fireEvent.change(screen.getByTestId('commit-submission-narrative'), {
      target: { value: 'Submitted retry fix; tests pass locally.' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-commit-evidence'), {
      target: { value: `commit ${commitSha}\nAuthor: Candidate` },
    });
    fireEvent.change(screen.getByTestId('commit-submission-diff'), {
      target: { value: 'diff --git a/src/retry.ts b/src/retry.ts' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-test-evidence'), {
      target: { value: 'npm test -- retry\nPASS src/retry.test.ts' },
    });
    fireEvent.click(screen.getByTestId('commit-submission-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('commit-submission-error').textContent).toContain(
        'Repository URL must be a GitHub URL.',
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('requires either real test output or a source-backed missing-test note before submitting', async () => {
    const commitSha = 'c'.repeat(40);
    const onProgressChange = vi.fn();
    const onSubmit = vi.fn(async (_payload: RoomCommitSubmissionRequest): Promise<RoomCommitSubmissionResponse> => {
      return {
        submission: {
          accepted: true,
          repositoryUrl: 'https://github.com/pipe/source-backed-worker',
          branchName: 'pipe-assessment',
          commitSha,
          commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
        },
        progress: {
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'SUBMITTED',
          stage: 'READY_FOR_EVALUATION',
          nextAction: 'START_EVALUATION',
          nextActionLabel: 'Start source-backed evaluation.',
          hasChallengePacket: true,
          hasWorkEvidence: true,
          hasCommitSubmission: true,
          hasFinalSubmission: false,
          hasAiInteraction: false,
          hasTranscriptEvidence: false,
          hasTestEvidence: false,
          hasVerificationGap: true,
          evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
          sourceRefCounts: [
            { kind: 'git_commit', count: 1 },
            { kind: 'code_diff', count: 1 },
            { kind: 'verification_gap', count: 1 },
          ],
          latestEvent: {
            kind: 'COMMIT_SUBMITTED',
            sequence: 2,
            occurredAt: '2026-06-29T19:00:00.000Z',
          },
          commit: {
            repositoryUrl: 'https://github.com/pipe/source-backed-worker',
            forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
            branchName: 'pipe-assessment',
            baseCommitSha: 'd'.repeat(40),
            commitSha,
            commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
            changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
            occurredAt: '2026-06-29T19:00:00.000Z',
          },
          evaluation: null,
        },
      };
    });

    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={richPacket}
        onSubmit={onSubmit}
        onProgressChange={onProgressChange}
      />,
    );

    fireEvent.change(screen.getByTestId('commit-submission-changed-files'), {
      target: { value: 'modified src/retry.ts' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-commit-sha'), {
      target: { value: commitSha },
    });
    fireEvent.change(screen.getByTestId('commit-submission-narrative'), {
      target: { value: 'Submitted retry fix; verification is still pending.' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-commit-evidence'), {
      target: { value: `commit ${commitSha}\nAuthor: Candidate` },
    });
    fireEvent.change(screen.getByTestId('commit-submission-diff'), {
      target: { value: 'diff --git a/src/retry.ts b/src/retry.ts' },
    });
    fireEvent.click(screen.getByTestId('commit-submission-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('commit-submission-error').textContent).toContain(
        'Paste test output or explain why test evidence is missing.',
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('commit-submission-verification-notes'), {
      target: { value: 'Tests were not run because dependency installation failed before the suite could start.' },
    });
    fireEvent.click(screen.getByTestId('commit-submission-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submittedPayload = onSubmit.mock.calls[0]?.[0];
    if (!submittedPayload) throw new Error('Expected commit submission payload.');
    expect(submittedPayload.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRefType: 'verification_gap',
        evidenceRole: 'missing_test_evidence_note',
        exactText: expect.stringContaining('Tests were not run because'),
      }),
    ]));
    const progress = await screen.findByTestId('commit-submission-progress');
    expect(progress.textContent).toContain('Test evidence: Missing');
    expect(progress.textContent).toContain('Verification gap: Captured');
    expect(progress.textContent).toContain('verification gap source');
    expect(onProgressChange).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'READY_FOR_EVALUATION',
      hasCommitSubmission: true,
      commit: expect.objectContaining({ commitSha }),
    }));
  });

  it('keeps candidate-entered values when packet defaults refresh', () => {
    const { rerender } = render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={null}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('commit-submission-base-sha'), {
      target: { value: 'a'.repeat(40) },
    });
    fireEvent.change(screen.getByTestId('commit-submission-branch'), {
      target: { value: 'candidate/custom-branch' },
    });

    rerender(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={packet}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId('commit-submission-base-sha')).toHaveProperty(
      'value',
      'a'.repeat(40),
    );
    expect(screen.getByTestId('commit-submission-branch')).toHaveProperty(
      'value',
      'candidate/custom-branch',
    );
  });

  it('renders accepted assessment progress from the source-backed submission response', async () => {
    const commitSha = 'c'.repeat(40);
    const response: RoomCommitSubmissionResponse = {
      submission: {
        accepted: true,
        repositoryUrl: 'https://github.com/pipe/source-backed-worker',
        branchName: 'pipe-assessment',
        commitSha,
        commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
      },
      progress: {
        mode: 'OPEN_SOURCE_BUG_FIX',
        state: 'SUBMITTED',
        stage: 'READY_FOR_EVALUATION',
        nextAction: 'START_EVALUATION',
        nextActionLabel: 'Start source-backed evaluation.',
        hasChallengePacket: true,
        hasWorkEvidence: true,
        hasCommitSubmission: true,
        hasFinalSubmission: false,
        hasAiInteraction: true,
        hasTranscriptEvidence: false,
        hasTestEvidence: true,
        evidenceCounts: [
          { kind: 'challenge_packet', count: 1 },
          { kind: 'git_commit', count: 1 },
          { kind: 'code_diff', count: 1 },
        ],
        sourceRefCounts: [
          { kind: 'git_commit', count: 1 },
          { kind: 'code_diff', count: 1 },
          { kind: 'test_run', count: 1 },
        ],
        latestEvent: {
          kind: 'COMMIT_SUBMITTED',
          sequence: 4,
          occurredAt: '2026-06-29T19:00:00.000Z',
        },
        commit: {
          repositoryUrl: 'https://github.com/pipe/source-backed-worker',
          forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
          branchName: 'pipe-assessment',
          baseCommitSha: 'd'.repeat(40),
          commitSha,
          commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
          changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
          occurredAt: '2026-06-29T19:00:00.000Z',
        },
        evaluation: {
          status: 'PENDING',
          summary: 'Waiting for evaluator.',
          createdAt: '2026-06-29T19:01:00.000Z',
        },
      },
    };
    const onSubmit = vi.fn(async (_payload: RoomCommitSubmissionRequest): Promise<RoomCommitSubmissionResponse> => response);

    render(
      <CommitSubmissionPanel
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={richPacket}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByTestId('commit-submission-changed-files'), {
      target: { value: 'modified src/retry.ts' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-commit-sha'), {
      target: { value: commitSha },
    });
    fireEvent.change(screen.getByTestId('commit-submission-narrative'), {
      target: { value: 'Submitted retry fix; tests pass locally.' },
    });
    fireEvent.change(screen.getByTestId('commit-submission-commit-evidence'), {
      target: { value: `commit ${commitSha}\nAuthor: Candidate` },
    });
    fireEvent.change(screen.getByTestId('commit-submission-diff'), {
      target: { value: `diff --git a/src/retry.ts b/src/retry.ts\n+// commit ${commitSha}` },
    });
    fireEvent.change(screen.getByTestId('commit-submission-test-evidence'), {
      target: { value: 'npm test -- retry\nPASS src/retry.test.ts' },
    });
    fireEvent.click(screen.getByTestId('commit-submission-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submittedPayload = onSubmit.mock.calls[0]?.[0];
    expect(submittedPayload).toBeDefined();
    if (!submittedPayload) throw new Error('Expected commit submission payload.');
    expect(submittedPayload.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRefType: 'test_run',
        exactText: expect.stringContaining('PASS src/retry.test.ts'),
      }),
    ]));

    const progress = screen.getByTestId('commit-submission-progress');
    expect(progress.textContent).toContain('Open Source Bug Fix');
    expect(progress.textContent).toContain('Ready For Evaluation');
    expect(progress.textContent).toContain('Submitted');
    expect(progress.textContent).toContain('Start source-backed evaluation.');
    expect(progress.textContent).toContain(commitSha.slice(0, 12));
    expect(progress.textContent).toContain('pipe-assessment');
    expect(progress.textContent).toContain('challenge packet');
    expect(progress.textContent).toContain('git commit');
    expect(progress.textContent).toContain('code diff');
    expect(progress.textContent).toContain('AI interaction');
    expect(progress.textContent).toContain('Transcript evidence');
    expect(progress.textContent).toContain('Test evidence');
    expect(progress.textContent).toContain('test run source');
    expect(progress.textContent).toContain('Pending');
    expect(progress.textContent).toContain('Commit Submitted #4');
  });
});
