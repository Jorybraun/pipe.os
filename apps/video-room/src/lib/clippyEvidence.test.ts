import { describe, expect, it } from 'vitest';
import {
  buildClippyAgentChatFallbackEvidence,
  buildClippyUiActionEvidence,
} from './clippyEvidence';

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

  it('marks browser fallback Devin replies as bridge-sourced evidence, not local chat claims', () => {
    expect(buildClippyAgentChatFallbackEvidence({
      text: 'I inspected the failing test.',
      agentName: 'devin',
      observedAt: '2026-06-27T21:05:00.000Z',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toEqual({
      text: 'I inspected the failing test.',
      properties: {
        source: 'clippy_agent_bridge',
        agent: 'devin',
        bridgeEventType: 'CHAT_RESPONSE',
        bridgeMessageSource: 'agent_stdout',
        observedAt: '2026-06-27T21:05:00.000Z',
        bridgePersisted: false,
        persistenceFallback: 'browser_after_bridge_persist_failed',
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        messageTimestamp: 1782603900000,
      },
    });
  });
});
