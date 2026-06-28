// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatWindow } from './ChatWindow';

describe('ChatWindow', () => {
  it('keeps room chat human-only while exposing the real Clippy launcher', () => {
    const onSend = vi.fn();
    const onAskClippy = vi.fn();

    render(
      <ChatWindow
        messages={[]}
        onSend={onSend}
        currentUserRole="HOST"
        onAskClippy={onAskClippy}
      />,
    );

    fireEvent.click(screen.getByTestId('chat-ask-clippy'));
    expect(onAskClippy).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'hello candidate' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(onSend).toHaveBeenCalledWith('hello candidate');
    expect(onAskClippy).toHaveBeenCalledTimes(1);
  });
});
