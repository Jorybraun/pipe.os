import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Thread } from '../../types/conversation';
import { ConversationPanel } from './ConversationPanel';

const authorReplyThread: Thread = {
  comment_id: 1,
  comment: {
    id: 1,
    file: 'packages/react/src/popover/root/usePopoverRoot.ts',
    line: 66,
    category: null,
    severity: 'major',
    what: 'This timing threshold can hide a real click.',
    why: 'Users can click while the hover-open transition is settling.',
    positive: false,
  },
  exchanges: [
    {
      actor: 'implementer',
      move: 'pushback',
      content: 'Can you point to a user-visible failure?',
      round: 1,
    },
  ],
  resolution: 'dangling',
};

describe('ConversationPanel', () => {
  it('renders implementer pushback moves as author replies', () => {
    render(
      <ConversationPanel
        threads={[authorReplyThread]}
        currentRound={2}
        maxRounds={4}
        verdict={null}
        summary=""
        isAwaitingResponse={false}
        onVerdictChange={vi.fn()}
        onSummaryChange={vi.fn()}
        onSubmitRound={vi.fn()}
        onSubmitVerdict={vi.fn()}
      />,
    );

    expect(screen.getByText('AUTHOR REPLY')).toBeInTheDocument();
    expect(screen.queryByText('PUSHBACK')).not.toBeInTheDocument();
  });
});
