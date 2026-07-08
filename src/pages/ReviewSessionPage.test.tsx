import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DiffJson } from '../components/Assessment/DiffPanel';
import { ReviewSessionPage } from './ReviewSessionPage';

vi.mock('../hooks/useReviewSessionV2', () => ({
  useReviewSessionV2: () => ({
    sendMessage: vi.fn(),
    completeSession: vi.fn(),
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../components/Assessment/DiffPanel', () => ({
  DiffPanel: () => <div data-testid="diff-panel" />,
}));

vi.mock('../components/Panels/ConversationPanel', () => ({
  ConversationPanel: () => <div data-testid="conversation-panel" />,
}));

vi.mock('../components/Panels/ProblemPanel', () => ({
  MatchProofPanel: () => <div data-testid="match-proof-panel" />,
}));

vi.mock('../components/Assessment/CodeReviewChallenge', () => ({
  ReviewProfileCard: ({ children }: { children?: ReactNode }) => (
    <div data-testid="review-profile-card">{children}</div>
  ),
}));

const sampleDiff: DiffJson = {
  stats: {
    filesChanged: 1,
    additions: 1,
    deletions: 0,
  },
  files: [
    {
      path: 'packages/react/src/popover/root/usePopoverRoot.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      hunks: [
        {
          header: '@@ -1 +1 @@',
          lines: [
            {
              type: 'addition',
              num: 1,
              content: 'close: closeDelayWithDefault,',
            },
          ],
        },
      ],
    },
  ],
};

describe('ReviewSessionPage', () => {
  it('uses implementation-author wording in default candidate instructions', () => {
    render(
      <ReviewSessionPage
        sessionId="review-session-1"
        pr={{ diff: sampleDiff }}
        maxRounds={4}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText(/respond to the implementation author/i)).toBeInTheDocument();
    expect(screen.queryByText(/AI developer/i)).not.toBeInTheDocument();
  });

  it('shows completion pipeline copy when already complete', () => {
    render(
      <ReviewSessionPage
        sessionId="review-session-1"
        pr={{ diff: sampleDiff }}
        maxRounds={4}
        initialCompleted={true}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByTestId('review-session-completion')).toBeInTheDocument();
    expect(screen.getByText(/scored from the evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/hear back through your recruiter/i)).toBeInTheDocument();
  });
});
