// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
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
  it('renders peer cursors with desktop-relative clamped positions', () => {
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

    expect(guestCursor.style.getPropertyValue('--peer-cursor-x')).toBe('1.5vw');
    expect(guestCursor.style.getPropertyValue('--peer-cursor-y')).toBe('96dvh');
    expect(hostCursor.style.getPropertyValue('--peer-cursor-x')).toBe('50vw');
    expect(hostCursor.style.getPropertyValue('--peer-cursor-y')).toBe('25dvh');
  });

  it('renders Clippy as a system tray button beside the clock', () => {
    const onClippyClick = vi.fn();
    render(
      <Win95Desktop
        wm={makeWindowManager()}
        renderWindowContent={() => null}
        onClippyClick={onClippyClick}
        clippyActive
        clippyStatus="auth_needed"
      />,
    );

    const tray = screen.getByTestId('win95-taskbar');
    const clippy = screen.getByTestId('win95-tray-clippy');
    const clock = screen.getByTestId('win95-tray-clock');

    expect(tray.contains(clippy)).toBe(true);
    expect(tray.contains(clock)).toBe(true);
    expect(clippy.compareDocumentPosition(clock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(clippy.classList.contains('is-active')).toBe(true);
    expect(clippy.getAttribute('data-clippy-status')).toBe('auth_needed');
    expect(clippy.getAttribute('title')).toBe('Ask Clippy - Authentication required');
    expect(screen.getByTestId('win95-tray-clippy-status').classList.contains('auth_needed')).toBe(true);

    fireEvent.click(clippy);
    expect(onClippyClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the Clippy tray entry available without marking chat active', () => {
    render(
      <Win95Desktop
        wm={makeWindowManager()}
        renderWindowContent={() => null}
        onClippyClick={vi.fn()}
        clippyActive={false}
        clippyStatus="idle"
      />,
    );

    const clippy = screen.getByTestId('win95-tray-clippy');
    expect(clippy.classList.contains('is-active')).toBe(false);
    expect(clippy.getAttribute('title')).toBe('Ask Clippy - Ready');
  });

  it('reports taskbar window restores with taskbar provenance', () => {
    const wm = makeWindowManager();
    wm.windows = [{
      id: 'browser',
      windowType: 'browser',
      title: 'Microsoft Edge',
      x: 100,
      y: 80,
      width: 640,
      height: 420,
      zIndex: 4,
      minimized: true,
      maximized: false,
      focused: false,
    }];
    const onWindowRestore = vi.fn();

    render(
      <Win95Desktop
        wm={wm}
        renderWindowContent={() => null}
        onWindowRestore={onWindowRestore}
      />,
    );

    fireEvent.click(within(screen.getByTestId('win95-taskbar')).getByTitle('Microsoft Edge'));
    expect(onWindowRestore).toHaveBeenCalledWith('browser', 'win95_taskbar');
  });

  it('reports Start menu app launches with Start menu provenance', () => {
    const onIconDoubleClick = vi.fn();
    const onStartMenuStateChange = vi.fn();

    render(
      <Win95Desktop
        wm={makeWindowManager()}
        renderWindowContent={() => null}
        onIconDoubleClick={onIconDoubleClick}
        onStartMenuStateChange={onStartMenuStateChange}
      />,
    );

    fireEvent.click(screen.getByTestId('win95-start-btn'));
    fireEvent.click(within(screen.getByTestId('win95-start-menu')).getByRole('button', { name: 'Notepad' }));

    expect(onIconDoubleClick).toHaveBeenCalledWith('notepad', 'win95_start_menu');
    expect(onStartMenuStateChange).toHaveBeenNthCalledWith(1, true, 'win95_start_button');
    expect(onStartMenuStateChange).toHaveBeenNthCalledWith(2, false, 'win95_start_menu_item');
  });

  it('reports desktop-click Start menu closes with desktop provenance', () => {
    const onStartMenuStateChange = vi.fn();

    render(
      <Win95Desktop
        wm={makeWindowManager()}
        renderWindowContent={() => null}
        onStartMenuStateChange={onStartMenuStateChange}
      />,
    );

    fireEvent.click(screen.getByTestId('win95-start-btn'));
    fireEvent.click(screen.getByTestId('win95-desktop'));

    expect(onStartMenuStateChange).toHaveBeenNthCalledWith(1, true, 'win95_start_button');
    expect(onStartMenuStateChange).toHaveBeenNthCalledWith(2, false, 'win95_desktop_click');
  });

  it('applies shared Start menu state from the room', () => {
    const { rerender } = render(
      <Win95Desktop
        wm={makeWindowManager()}
        renderWindowContent={() => null}
        startMenuState={{ open: false, eventId: 'snapshot:false' }}
      />,
    );

    expect(screen.queryByTestId('win95-start-menu')).toBeNull();

    rerender(
      <Win95Desktop
        wm={makeWindowManager()}
        renderWindowContent={() => null}
        startMenuState={{ open: true, eventId: 'evt-remote-start-open' }}
      />,
    );

    expect(screen.getByTestId('win95-start-menu')).not.toBeNull();
  });
});
