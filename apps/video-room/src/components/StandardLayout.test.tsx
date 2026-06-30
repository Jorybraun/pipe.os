// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StandardLayout } from './StandardLayout';
import type { WindowManagerApi, WindowState, WindowType } from '../hooks/useWindowManager';

function roomWindow(input: Partial<WindowState> & Pick<WindowState, 'id' | 'windowType' | 'title'>): WindowState {
  return {
    x: 0,
    y: 0,
    width: 480,
    height: 360,
    zIndex: 1,
    minimized: false,
    maximized: false,
    focused: false,
    ...input,
  };
}

function makeWindowManager(windows: WindowState[] = [
  roomWindow({
    id: 'video',
    windowType: 'video',
    title: 'Video Call',
    focused: true,
  }),
]): WindowManagerApi {
  return {
    windows,
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

describe('StandardLayout', () => {
  it('renders the room mode label instead of always saying standard call', () => {
    render(
      <StandardLayout
        wm={makeWindowManager()}
        renderWindowContent={() => <div>video</div>}
        modeLabel="Dev-container assessment"
      />,
    );

    expect(screen.getByTestId('standard-controls').textContent).toContain('Dev-container assessment');
    expect(screen.getByTestId('standard-controls').textContent).not.toContain('Standard call');
  });

  it('uses the workspace as the primary pane for dev-container assessments', () => {
    const wm = makeWindowManager([
      roomWindow({ id: 'video', windowType: 'video', title: 'Video Call' }),
      roomWindow({ id: 'workspace', windowType: 'workspace', title: 'VS Code', focused: true }),
    ]);

    render(
      <StandardLayout
        wm={wm}
        assessmentHeader={<div>assessment status header</div>}
        renderWindowContent={(win) => <div>{win.windowType === 'workspace' ? 'code workspace' : 'video call'}</div>}
        modeLabel="Dev-container assessment"
        primarySurface="workspace"
      />,
    );

    expect(screen.getByTestId('standard-primary-workspace').textContent).toContain('code workspace');
    expect(screen.getByTestId('standard-video-pip').textContent).toContain('video call');
    expect(screen.getByTestId('standard-assessment-header').textContent).toContain('assessment status header');
    expect(screen.queryByTitle('Toggle workspace')).toBeNull();
  });

  it('keeps the legacy desktop as an optional control', () => {
    render(
      <StandardLayout
        wm={makeWindowManager()}
        renderWindowContent={() => <div>video</div>}
        canEnterDesktop
        onEnterDesktop={vi.fn()}
      />,
    );

    expect(screen.getByTestId('enter-win95-desktop').getAttribute('aria-label')).toBe('Open legacy desktop');
    expect(screen.queryByLabelText('Launch 95 desktop')).toBeNull();
  });
});
