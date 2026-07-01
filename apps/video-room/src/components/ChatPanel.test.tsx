// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';

describe('ChatPanel', () => {
  it('keeps room chat human-only without an assistant launcher', () => {
    const onSend = vi.fn();

    render(
      <ChatPanel
        messages={[]}
        onSend={onSend}
        currentUserRole="HOST"
      />,
    );

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'hello candidate' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(onSend).toHaveBeenCalledWith('hello candidate');
  });

  it('keeps the real server rejection reason on failed sends', () => {
    render(
      <ChatPanel
        messages={[{
          id: 'chat-rejected-1',
          role: 'host',
          text: 'hello candidate',
          timestamp: 1782604680000,
          deliveryStatus: 'rejected',
          deliveryRejectionReason: 'INVALID_EVIDENCE',
        }]}
        onSend={vi.fn()}
        currentUserRole="HOST"
      />,
    );

    expect(screen.getByText('Not sent').getAttribute('title')).toBe('INVALID_EVIDENCE');
  });
});
