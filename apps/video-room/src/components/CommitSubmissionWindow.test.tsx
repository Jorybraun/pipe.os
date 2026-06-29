import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommitSubmissionWindow } from './CommitSubmissionWindow';
import type { RoomCommitSubmissionResponse, RoomWorkspaceChallengePacket } from '../types';

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

describe('CommitSubmissionWindow', () => {
  it('prefills source-backed repo, base commit, and assessment branch without inventing commit evidence', () => {
    render(
      <CommitSubmissionWindow
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={packet}
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

  it('keeps candidate-entered values when packet defaults refresh', () => {
    const { rerender } = render(
      <CommitSubmissionWindow
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
      <CommitSubmissionWindow
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
        evidenceCounts: [
          { kind: 'challenge_packet', count: 1 },
          { kind: 'git_commit', count: 1 },
          { kind: 'code_diff', count: 1 },
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
    const onSubmit = vi.fn(async () => response);

    render(
      <CommitSubmissionWindow
        defaultRepositoryUrl="https://github.com/fallback/repo"
        challengePacket={packet}
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
    fireEvent.click(screen.getByTestId('commit-submission-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

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
    expect(progress.textContent).toContain('Pending');
    expect(progress.textContent).toContain('Commit Submitted #4');
  });
});
