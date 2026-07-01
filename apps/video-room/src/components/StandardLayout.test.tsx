// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StandardLayout } from './StandardLayout';
import type { ToolSurfaceManagerApi, ToolSurfaceState, ToolSurfaceType } from '../hooks/useToolSurfaceManager';

function roomSurface(input: Partial<ToolSurfaceState> & Pick<ToolSurfaceState, 'id' | 'surfaceType' | 'title'>): ToolSurfaceState {
  return {
    active: false,
    ...input,
  };
}

function makeSurfaceManager(surfaces: ToolSurfaceState[] = [
  roomSurface({
    id: 'video',
    surfaceType: 'video',
    title: 'Video Call',
    active: true,
  }),
]): ToolSurfaceManagerApi {
  return {
    surfaces,
    openSurface: vi.fn(() => 'surface-id'),
    closeSurface: vi.fn(),
    focusSurface: vi.fn(),
    updateSurfaceData: vi.fn(),
    isSurfaceOpen: vi.fn((_surfaceType: ToolSurfaceType) => false),
    getSurfaceByType: vi.fn((_surfaceType: ToolSurfaceType) => undefined),
  };
}

describe('StandardLayout', () => {
  it('renders the room mode label instead of always saying standard call', () => {
    render(
      <StandardLayout
        toolSurfaces={makeSurfaceManager()}
        renderSurfaceContent={() => <div>video</div>}
        modeLabel="Dev-container assessment"
      />,
    );

    expect(screen.getByTestId('standard-controls').textContent).toContain('Dev-container assessment');
    expect(screen.getByTestId('standard-controls').textContent).not.toContain('Standard call');
  });

  it('uses the workspace as the primary pane for dev-container assessments', () => {
    const toolSurfaces = makeSurfaceManager([
      roomSurface({ id: 'video', surfaceType: 'video', title: 'Video Call' }),
      roomSurface({ id: 'workspace', surfaceType: 'workspace', title: 'VS Code', active: true }),
    ]);

    render(
      <StandardLayout
        toolSurfaces={toolSurfaces}
        assessmentHeader={<div>assessment status header</div>}
        renderSurfaceContent={(surface) => <div>{surface.surfaceType === 'workspace' ? 'code workspace' : 'video call'}</div>}
        modeLabel="Dev-container assessment"
        primarySurface="workspace"
      />,
    );

    expect(screen.getByTestId('standard-primary-workspace').textContent).toContain('code workspace');
    expect(screen.getByTestId('standard-video-pip').textContent).toContain('video call');
    expect(screen.getByTestId('standard-assessment-header').textContent).toContain('assessment status header');
    expect(screen.queryByTitle('Toggle workspace')).toBeNull();
  });

  it('keeps the assessment brief persistently beside the primary workspace', () => {
    const toolSurfaces = makeSurfaceManager([
      roomSurface({ id: 'video', surfaceType: 'video', title: 'Video Call' }),
      roomSurface({ id: 'workspace', surfaceType: 'workspace', title: 'VS Code', active: true }),
    ]);

    render(
      <StandardLayout
        toolSurfaces={toolSurfaces}
        assessmentAside={<div>source-backed task brief</div>}
        renderSurfaceContent={(surface) => <div>{surface.surfaceType === 'workspace' ? 'code workspace' : 'video call'}</div>}
        modeLabel="Dev-container assessment"
        primarySurface="workspace"
      />,
    );

    expect(screen.getByTestId('standard-primary-workspace').textContent).toContain('code workspace');
    expect(screen.getByTestId('standard-assessment-aside').textContent).toContain('source-backed task brief');
  });

  it('keeps standard calls in a single primary product layout', () => {
    render(
      <StandardLayout
        toolSurfaces={makeSurfaceManager()}
        renderSurfaceContent={() => <div>video</div>}
      />,
    );

    expect(screen.getByTestId('standard-primary-video').textContent).toContain('video');
    expect(screen.queryByTestId('standard-tools-panel')).toBeNull();
    expect(screen.queryByTestId('standard-workspace')).toBeNull();
  });

  it('renders utility tools as an assessment panel', () => {
    const toolSurfaces = makeSurfaceManager([
      roomSurface({ id: 'video', surfaceType: 'video', title: 'Video Call' }),
      roomSurface({ id: 'terminal', surfaceType: 'terminal', title: 'Container terminal', active: true }),
      roomSurface({ id: 'submission', surfaceType: 'submission', title: 'Submit Work' }),
    ]);

    render(
      <StandardLayout
        toolSurfaces={toolSurfaces}
        renderSurfaceContent={(surface) => <div>{surface.surfaceType} surface</div>}
      />,
    );

    expect(screen.getByTestId('standard-tools-panel').textContent).toContain('terminal surface');
    expect(screen.getByRole('button', { name: 'Close Container terminal' })).toBeTruthy();
  });

  it('keeps Submit Work visible in the control bar for workspace assessments', () => {
    const toolSurfaces = makeSurfaceManager([
      roomSurface({ id: 'video', surfaceType: 'video', title: 'Video Call' }),
      roomSurface({ id: 'workspace', surfaceType: 'workspace', title: 'VS Code', active: true }),
      roomSurface({ id: 'terminal', surfaceType: 'terminal', title: 'Container terminal', active: true }),
      roomSurface({ id: 'submission', surfaceType: 'submission', title: 'Submit Work' }),
    ]);

    render(
      <StandardLayout
        toolSurfaces={toolSurfaces}
        renderSurfaceContent={(surface) => <div>{surface.surfaceType} surface</div>}
        modeLabel="Dev-container assessment"
        primarySurface="workspace"
      />,
    );

    const submitButton = screen.getByRole('button', { name: 'Open Submit Work' });
    expect(submitButton).toBeTruthy();
    expect(screen.getByTestId('standard-tool-terminal').textContent).toContain('terminal surface');

    fireEvent.click(submitButton);

    expect(toolSurfaces.focusSurface).toHaveBeenCalledWith('submission');
    expect(screen.getByTestId('standard-tool-submission').textContent).toContain('submission surface');
  });
});
