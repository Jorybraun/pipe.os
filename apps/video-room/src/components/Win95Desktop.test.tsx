// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Win95Desktop } from './Win95Desktop';
import type { WindowManagerApi, WindowType } from '../hooks/useWindowManager';

function makeWindowManager(): WindowManagerApi {
  return {
    windows: [],
    openWindow: vi.fn(() => 'window-id'),
    closeWindow: vi.fn(),
    focusWindow: vi.fn(),
    minimizeWindow: vi.fn(),
    toggleMaximize: vi.fn(),
    moveWindow: vi.fn(),
    resizeWindow: vi.fn(),
    updateWindowData: vi.fn(),
    applyWindowState: vi.fn(),
    restoreWindow: vi.fn(),
    isWindowOpen: vi.fn((_windowType: WindowType) => false),
    getWindowByType: vi.fn((_windowType: WindowType) => undefined),
  };
}

describe('Win95Desktop', () => {
  it('renders peer cursors with clamped transform inputs instead of left/top trails', () => {
    render(
      <Win95Desktop
        wm={makeWindowManager()}
        renderWindowContent={() => null}
        peerCursors={[
          {
            clientId: 'guest-active',
            role: 'GUEST',
            x: -2,
            y: 1.4,
            updatedAt: 1000,
          },
          {
            clientId: 'host-active',
            role: 'HOST',
            x: 0.5,
            y: 0.25,
            updatedAt: 1000,
          },
        ]}
      />,
    );

    const guestCursor = screen.getByTestId('room-peer-cursor-guest');
    const hostCursor = screen.getByTestId('room-peer-cursor-host');

    expect(guestCursor.style.left).toBe('');
    expect(guestCursor.style.top).toBe('');
    expect(guestCursor.style.getPropertyValue('--room-cursor-x')).toBe('1.5vw');
    expect(guestCursor.style.getPropertyValue('--room-cursor-y')).toBe('96dvh');
    expect(hostCursor.style.getPropertyValue('--room-cursor-x')).toBe('50vw');
    expect(hostCursor.style.getPropertyValue('--room-cursor-y')).toBe('25dvh');
  });
});
