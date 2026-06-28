import { describe, expect, it } from 'vitest';
import {
  buildClippyAgentChatFallbackEvidence,
  buildClippyRoomActionExecutionEvidence,
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

  it('captures prompt-button executions as source-backed UI evidence', () => {
    expect(buildClippyRoomActionExecutionEvidence({
      actionId: 'start-recording',
      text: 'Clippy action: start recording',
      origin: 'prompt',
      actor: 'host',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toEqual({
      text: 'Clippy action: start recording',
      properties: {
        source: 'clippy_prompt_ui',
        actionId: 'start-recording',
        origin: 'prompt',
        executedBy: 'host',
        actionSource: 'clippy_prompt_ui',
        agent: 'devin',
        agentActionLabel: null,
        agentActionText: null,
        bridgeEventType: null,
        actionProtocol: null,
        agentActionObservedAt: null,
        agentActionBridgePersisted: null,
        executionStatus: 'executed',
        autoExecute: null,
        url: null,
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        agentResponseClaimed: false,
      },
    });
  });

  it('links executed agent suggestions back to the real bridge action', () => {
    expect(buildClippyRoomActionExecutionEvidence({
      actionId: 'open-terminal',
      text: 'Agent action: open terminal',
      origin: 'agent',
      actor: 'guest',
      agentAction: {
        id: 'open-terminal',
        label: 'Open Terminal',
        text: 'Open a terminal to inspect the failing tests.',
        source: 'agent_stdout_action',
        agentName: 'devin',
        bridgeEventType: 'ROOM_ACTION',
        protocol: 'clippy_room_action_tag',
        observedAt: '2026-06-27T21:10:00.000Z',
        persisted: true,
        autoExecute: false,
      },
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toMatchObject({
      text: 'Agent action: open terminal',
      properties: {
        source: 'clippy_agent_bridge',
        origin: 'agent',
        executedBy: 'guest',
        actionSource: 'agent_stdout_action',
        bridgeEventType: 'ROOM_ACTION',
        actionProtocol: 'clippy_room_action_tag',
        agentActionObservedAt: '2026-06-27T21:10:00.000Z',
        agentActionBridgePersisted: true,
        executionStatus: 'executed',
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
