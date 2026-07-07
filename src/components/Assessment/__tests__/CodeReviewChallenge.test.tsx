import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CodeReviewChallenge } from '../CodeReviewChallenge';
import type { DiffJson } from '../DiffPanel';

vi.mock('../DiffPanel', () => ({
  DiffPanel: () => <div data-testid="diff-panel" />,
}));

const diff: DiffJson = {
  files: [],
  stats: {
    filesChanged: 1,
    additions: 4,
    deletions: 2,
  },
};

const submission = {
  annotations: [],
  verdict: null,
  summary: '',
};

function renderChallenge(challengePacket: Record<string, unknown>): void {
  render(
    <CodeReviewChallenge
      challenge={{
        id: 'challenge-1',
        title: 'Code Review',
        instructions: 'Review this pull request as if a teammate opened it.',
        githubRepoUrl: 'https://github.com/acme/widgets',
        githubPrNumber: 42,
        githubPrTitle: 'Fix retry cleanup',
        challengePacket,
      }}
      diff={diff}
      isFetchingDiff={false}
      submission={submission}
      onSubmissionChange={() => undefined}
    />,
  );
}

describe('CodeReviewChallenge challenge packet', () => {
  it('renders a candidate-safe source-backed task packet', () => {
    renderChallenge({
      repositoryUrl: 'https://github.com/acme/widgets',
      pullRequestUrl: 'https://github.com/acme/widgets/pull/42',
      githubPrNumber: 42,
      baseCommitSha: '1111111111111111111111111111111111111111',
      headCommitSha: '2222222222222222222222222222222222222222',
      task: 'Review pull request #42: Fix retry cleanup',
      successCriteria: [
        'Leave line-level annotations tied to concrete code risks.',
        'Choose a verdict with a concise rationale.',
      ],
      expectedEvidence: [
        'Inline annotations with file and line references.',
        'Final review verdict and written summary.',
      ],
      constraints: [
        'Review only the assigned source-backed diff.',
      ],
      isComplete: true,
      missingFields: [],
      packetId: 'internal-packet-id',
      sourceSpanIds: ['repo-source-span-secret'],
    });

    const packet = screen.getByTestId('code-review-challenge-packet');
    expect(packet).toHaveTextContent('Your task');
    expect(packet).toHaveTextContent('acme/widgets');
    expect(packet).toHaveTextContent('111111111111');
    expect(packet).toHaveTextContent('Review pull request #42: Fix retry cleanup');
    expect(packet).toHaveTextContent('Leave line-level annotations tied to concrete code risks.');
    expect(packet).toHaveTextContent('Inline annotations with file and line references.');
    expect(packet).toHaveTextContent('Review only the assigned source-backed diff.');
    expect(packet).not.toHaveTextContent('internal-packet-id');
    expect(packet).not.toHaveTextContent('repo-source-span-secret');
  });

  it('shows missing packet diagnostics without inventing criteria', () => {
    renderChallenge({
      repositoryUrl: 'https://github.com/acme/widgets',
      githubPrNumber: 42,
      task: 'Review pull request #42: Fix retry cleanup',
      successCriteria: [],
      expectedEvidence: [],
      constraints: [],
      isComplete: false,
      missingFields: ['base commit SHA', 'success criteria', 'expected evidence'],
    });

    const packet = screen.getByTestId('code-review-challenge-packet');
    expect(packet).toHaveTextContent('Your task — being finalized');
    expect(packet).toHaveTextContent('base commit SHA');
    expect(packet).toHaveTextContent('success criteria');
    expect(packet).toHaveTextContent('expected evidence');
    expect(packet).not.toHaveTextContent('Line-level annotations tied to concrete code risks.');
  });
});
