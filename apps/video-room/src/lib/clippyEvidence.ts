import type { RoomSurface } from '../hooks/useRoomConnection';
import type { AgentRoomAction } from '../hooks/useAgentConnection';
import type { RoomPhase } from '../types';

export type ClippyUiActionId = 'open-clippy-chat' | 'dismiss-clippy';
export type ClippyUiActionOrigin = 'tray' | 'prompt';
export type ClippyRoomActionOrigin = 'prompt' | 'agent';
export type ClippyEvidenceActor = 'host' | 'guest';

export interface ClippyUiActionEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface ClippyRoomActionExecutionEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface ClippyAgentChatFallbackEvidence {
  text: string;
  properties: Record<string, unknown>;
}

function clippyUiActionText(actionId: ClippyUiActionId): string {
  switch (actionId) {
    case 'open-clippy-chat':
      return 'Clippy chat opened from the Win95 taskbar tray';
    case 'dismiss-clippy':
      return 'Clippy prompt dismissed';
    default:
      return 'Clippy UI action';
  }
}

function clippyUiActionStatus(actionId: ClippyUiActionId): string {
  return actionId === 'open-clippy-chat' ? 'opened' : 'dismissed';
}

export function buildClippyUiActionEvidence(input: {
  actionId: ClippyUiActionId;
  origin: ClippyUiActionOrigin;
  actor: ClippyEvidenceActor;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  agentWorkspaceReady: boolean;
}): ClippyUiActionEvidence {
  return {
    text: clippyUiActionText(input.actionId),
    properties: {
      source: input.origin === 'tray' ? 'clippy_tray_ui' : 'clippy_prompt_ui',
      actionId: input.actionId,
      origin: input.origin,
      executedBy: input.actor,
      actionSource: input.origin === 'tray' ? 'win95_taskbar_tray' : 'clippy_prompt_ui',
      executionStatus: clippyUiActionStatus(input.actionId),
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      agent: 'devin',
      agentWorkspaceReady: input.agentWorkspaceReady,
      agentResponseClaimed: false,
    },
  };
}

export function buildClippyRoomActionExecutionEvidence(input: {
  actionId: string;
  text: string;
  origin: ClippyRoomActionOrigin;
  actor: ClippyEvidenceActor;
  agentAction?: AgentRoomAction;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
}): ClippyRoomActionExecutionEvidence {
  const agent = input.agentAction?.agentName ?? 'devin';
  return {
    text: input.text,
    properties: {
      source: input.origin === 'agent' ? 'clippy_agent_bridge' : 'clippy_prompt_ui',
      actionId: input.actionId,
      origin: input.origin,
      executedBy: input.actor,
      actionSource: input.origin === 'agent'
        ? input.agentAction?.source ?? 'agent_stdout_action'
        : 'clippy_prompt_ui',
      agent,
      agentActionLabel: input.agentAction?.label ?? null,
      agentActionText: input.agentAction?.text ?? null,
      bridgeEventType: input.agentAction?.bridgeEventType ?? null,
      actionProtocol: input.agentAction?.protocol ?? null,
      agentActionObservedAt: input.agentAction?.observedAt ?? null,
      agentActionBridgePersisted: input.agentAction?.persisted ?? null,
      executionStatus: 'executed',
      autoExecute: input.agentAction?.autoExecute ?? null,
      url: input.agentAction?.url ?? null,
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      agentResponseClaimed: false,
    },
  };
}

export function buildClippyAgentChatFallbackEvidence(input: {
  text: string;
  agentName: string | null;
  observedAt: string;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  messageTimestamp: number;
}): ClippyAgentChatFallbackEvidence {
  const agent = input.agentName?.trim() || 'devin';
  return {
    text: input.text,
    properties: {
      source: 'clippy_agent_bridge',
      agent,
      bridgeEventType: 'CHAT_RESPONSE',
      bridgeMessageSource: 'agent_stdout',
      observedAt: input.observedAt,
      bridgePersisted: false,
      persistenceFallback: 'browser_after_bridge_persist_failed',
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      messageTimestamp: input.messageTimestamp,
    },
  };
}
