import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EvidenceNodeBadge } from './EvidenceNodeBadge';

describe('EvidenceNodeBadge', () => {
  it('renders previously unseen node types without a semantic icon map', () => {
    render(
      <EvidenceNodeBadge
        sourceType="transcript_context_record"
        nodeType="PreviouslyUnseenCapability"
      />,
    );

    expect(screen.getByTitle('PreviouslyUnseenCapability from transcript_context_record'))
      .toBeInTheDocument();
    expect(screen.getByText('PU')).toBeInTheDocument();
  });
});
