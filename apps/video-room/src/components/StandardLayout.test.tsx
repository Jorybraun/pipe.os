// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StandardLayout } from './StandardLayout';
import type { WindowManagerApi, WindowType } from '../hooks/useWindowManager';

function makeWindowManager(): WindowManagerApi {
  return {
    windows: [{
      id: 'video',
      windowType: 'video',
      title: 'Video Call',
      x: 0,
      y: 0,
      width: 480,
      height: 360,
      zIndex: 1,
      minimized: false,
      maximized: false,
      focused: true,
    }],
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
});
