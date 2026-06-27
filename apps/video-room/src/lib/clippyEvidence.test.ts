import { describe, expect, it } from 'vitest';
import { buildClippyUiActionEvidence } from './clippyEvidence';

describe('clippy evidence', () => {
  it('captures tray opens as human UI actions without claiming a Devin response', () => {
    expect(buildClippyUiActionEvidence({
      actionId: 'open-clippy-chat',
      origin: 'tray',
      actor: 'guest',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      agentWorkspaceReady: true,
    })).toEqual({
      text: 'Clippy chat opened from the Win95 taskbar tray',
      properties: {
        source: 'clippy_tray_ui',
        actionId: 'open-clippy-chat',
        origin: 'tray',
        executedBy: 'guest',
        actionSource: 'win95_taskbar_tray',
        executionStatus: 'opened',
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        agent: 'devin',
        agentWorkspaceReady: true,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures prompt dismissals separately from agent actions', () => {
    expect(buildClippyUiActionEvidence({
      actionId: 'dismiss-clippy',
      origin: 'prompt',
      actor: 'host',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: null,
      workspaceSessionId: null,
      agentWorkspaceReady: false,
    })).toMatchObject({
      text: 'Clippy prompt dismissed',
      properties: {
        source: 'clippy_prompt_ui',
        actionId: 'dismiss-clippy',
        origin: 'prompt',
        actionSource: 'clippy_prompt_ui',
        executionStatus: 'dismissed',
        agentResponseClaimed: false,
      },
    });
  });
});
