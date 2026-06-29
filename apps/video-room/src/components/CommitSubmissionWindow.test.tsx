import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommitSubmissionWindow } from './CommitSubmissionWindow';
import type { RoomWorkspaceChallengePacket } from '../types';

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
});
