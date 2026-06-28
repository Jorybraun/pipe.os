import type { RoomSurface } from '../hooks/useRoomConnection';
import type { AgentChatMessage, AgentRoomAction, AgentStatus } from '../hooks/useAgentConnection';
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

export interface ClippyUserChatEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface ClippyAgentChatFallbackEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface ClippyAgentStatusEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface ClippyAgentMessageSessionEvidence {
  eventType: 'ai_chat_agent' | 'ai_agent_status';
  text: string;
  properties: Record<string, unknown>;
}

type ClippyAgentBridgeMessageSource = Exclude<NonNullable<AgentChatMessage['source']>, 'user_submit'>;
type ClippyAgentStatusBridgeMessageSource = 'agent_status' | ClippyAgentBridgeMessageSource;

const FNV_32_OFFSET = 0x811c9dc5;
const FNV_32_PRIME = 0x01000193;

function safeEvidenceIdPart(value: string | null): string {
  const normalized = (value ?? 'none')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'none';
}

export function clippyTextFingerprint(text: string): string {
  let hash = FNV_32_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_32_PRIME);
  }
  return `clippy_${(hash >>> 0).toString(16).padStart(8, '0')}`;
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

export function buildClippyActionEventId(input: {
  actor: ClippyEvidenceActor | 'agent';
  capturedAtMs: number;
  source: 'clippy_tray_ui' | 'clippy_prompt_ui' | 'clippy_agent_bridge';
  origin: ClippyUiActionOrigin | ClippyRoomActionOrigin;
  executionStatus: 'opened' | 'dismissed' | 'executed' | 'suggested';
  actionId: string;
}): string {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  return [
    'clippy-action',
    input.actor,
    String(capturedAtMs),
    input.source,
    input.origin,
    input.executionStatus,
    safeEvidenceIdPart(input.actionId),
  ].join(':');
}

export function buildClippyAgentStatusEventId(input: {
  agentName: string | null;
  capturedAtMs: number;
  bridgeMessageSource: string | null;
  status: string | null;
  diagnosticSource?: string | null;
}): string {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const agent = safeEvidenceIdPart(input.agentName);
  const bridgeMessageSource = safeEvidenceIdPart(input.bridgeMessageSource);
  const status = safeEvidenceIdPart(input.status);
  const diagnosticSource = safeEvidenceIdPart(input.diagnosticSource ?? null);
  return `agent-status:${agent}:${capturedAtMs}:${bridgeMessageSource}:${status}:${diagnosticSource}`;
}

export function clippyAgentResponseFingerprint(text: string): string {
  let hash = FNV_32_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_32_PRIME);
  }
  return `agent_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildClippyAgentChatResponseId(input: {
  agentName: string | null;
  capturedAtMs: number;
  responseFingerprint: string;
}): string {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const agent = safeEvidenceIdPart(input.agentName);
  return `agent-chat:${agent}:${capturedAtMs}:CHAT_RESPONSE:${input.responseFingerprint}`;
}

function isClippyAgentBridgeMessageSource(value: unknown): value is ClippyAgentBridgeMessageSource {
  return value === 'agent_stdout'
    || value === 'bridge_diagnostic'
    || value === 'bridge_observation';
}

function normalizedTimestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function observedAtFromMessageTimestamp(value: number): string {
  return new Date(normalizedTimestamp(value)).toISOString();
}

function isSourceBackedAgentRoomAction(
  action: AgentRoomAction | undefined,
  actionId: string,
): action is AgentRoomAction & {
  source: 'agent_stdout_action';
  agentName: string;
  bridgeEventType: 'ROOM_ACTION';
  protocol: 'clippy_room_action_tag';
  observedAt: string;
  persisted: boolean;
} {
  return Boolean(action)
    && action?.id === actionId
    && action.source === 'agent_stdout_action'
    && typeof action.agentName === 'string'
    && action.agentName.trim().length > 0
    && action.bridgeEventType === 'ROOM_ACTION'
    && action.protocol === 'clippy_room_action_tag'
    && typeof action.observedAt === 'string'
    && action.observedAt.trim().length > 0
    && typeof action.persisted === 'boolean';
}

export function buildClippyUiActionEvidence(input: {
  actionId: ClippyUiActionId;
  origin: ClippyUiActionOrigin;
  actor: ClippyEvidenceActor;
  capturedAtMs: number;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  agentWorkspaceReady: boolean;
}): ClippyUiActionEvidence {
  const source = input.origin === 'tray' ? 'clippy_tray_ui' : 'clippy_prompt_ui';
  const executionStatus = clippyUiActionStatus(input.actionId) as 'opened' | 'dismissed';
  const capturedAtMs = Number.isFinite(input.capturedAtMs) ? Math.max(0, Math.round(input.capturedAtMs)) : 0;
  return {
    text: clippyUiActionText(input.actionId),
    properties: {
      source,
      actionId: input.actionId,
      origin: input.origin,
      executedBy: input.actor,
      actionSource: input.origin === 'tray' ? 'win95_taskbar_tray' : 'clippy_prompt_ui',
      executionStatus,
      capturedAtMs,
      clippyActionEventId: buildClippyActionEventId({
        actor: input.actor,
        capturedAtMs,
        source,
        origin: input.origin,
        executionStatus,
        actionId: input.actionId,
      }),
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      agent: null,
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
  capturedAtMs: number;
  agentAction?: AgentRoomAction;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
}): ClippyRoomActionExecutionEvidence | null {
  if (input.origin === 'agent' && !isSourceBackedAgentRoomAction(input.agentAction, input.actionId)) {
    return null;
  }
  const agent = input.origin === 'agent' ? input.agentAction?.agentName ?? null : null;
  const source = input.origin === 'agent' ? 'clippy_agent_bridge' : 'clippy_prompt_ui';
  const capturedAtMs = Number.isFinite(input.capturedAtMs) ? Math.max(0, Math.round(input.capturedAtMs)) : 0;
  return {
    text: input.text,
    properties: {
      source,
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
      capturedAtMs,
      clippyActionEventId: buildClippyActionEventId({
        actor: input.actor,
        capturedAtMs,
        source,
        origin: input.origin,
        executionStatus: 'executed',
        actionId: input.actionId,
      }),
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

export function buildClippyUserChatEvidence(input: {
  message: AgentChatMessage;
  actor: ClippyEvidenceActor;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  repoUrl: string | null;
}): ClippyUserChatEvidence {
  const promptFingerprint = clippyTextFingerprint(input.message.text);
  const workspacePart = safeEvidenceIdPart(input.workspaceSessionId);
  const promptId = `${workspacePart}:${input.actor}:prompt:${input.message.timestamp}:${promptFingerprint}`;
  return {
    text: input.message.text,
    properties: {
      source: 'clippy_agent_chat_client_submit',
      agentChatEventSource: 'browser_clippy_chat_window',
      bridgeMessageType: 'CHAT',
      bridgeProtocol: 'clippy_dev_container_ws',
      promptId,
      promptFingerprint,
      promptLength: input.message.text.length,
      promptTimestamp: input.message.timestamp,
      deliveredToAgentBridge: true,
      agent: null,
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      repoUrl: input.repoUrl,
      agentResponseClaimed: false,
    },
  };
}

export function buildClippyAgentStatusEvidence(input: {
  text: string;
  agentName: string | null;
  status: AgentStatus | null;
  bridgeMessageSource: ClippyAgentStatusBridgeMessageSource;
  observedAt: string;
  capturedAtMs: number;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  diagnosticSource?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  truncated?: boolean | null;
  bridgePersisted?: boolean | null;
  promptType?: string | null;
  deliveredToAgent?: boolean | null;
  promptLength?: number | null;
  promptFingerprint?: string | null;
  roomContextStatus?: number | null;
  roomContextLength?: number | null;
  roomContextFingerprint?: string | null;
  userMessageLength?: number | null;
  userMessageFingerprint?: string | null;
  contextTruncated?: boolean | null;
  messageTimestamp?: number | null;
}): ClippyAgentStatusEvidence {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const agent = input.agentName?.trim() || 'devin';
  return {
    text: input.text,
    properties: {
      source: 'clippy_agent_bridge',
      agentStatusEventSource: 'browser_clippy_agent_ws',
      agent,
      status: input.status,
      diagnosticSource: input.diagnosticSource ?? null,
      bridgeMessageSource: input.bridgeMessageSource,
      observedAt: input.observedAt,
      capturedAtMs,
      agentStatusEventId: buildClippyAgentStatusEventId({
        agentName: agent,
        capturedAtMs,
        bridgeMessageSource: input.bridgeMessageSource,
        status: input.status,
        diagnosticSource: input.diagnosticSource ?? null,
      }),
      exitCode: input.exitCode ?? null,
      signal: input.signal ?? null,
      truncated: input.truncated ?? null,
      bridgePersisted: input.bridgePersisted ?? null,
      promptType: input.promptType ?? null,
      deliveredToAgent: input.deliveredToAgent ?? null,
      promptLength: input.promptLength ?? null,
      promptFingerprint: input.promptFingerprint ?? null,
      roomContextStatus: input.roomContextStatus ?? null,
      roomContextLength: input.roomContextLength ?? null,
      roomContextFingerprint: input.roomContextFingerprint ?? null,
      userMessageLength: input.userMessageLength ?? null,
      userMessageFingerprint: input.userMessageFingerprint ?? null,
      contextTruncated: input.contextTruncated ?? null,
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      messageTimestamp: input.messageTimestamp ?? capturedAtMs,
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
  const observedAtMs = Date.parse(input.observedAt);
  const capturedAtMs = Number.isFinite(observedAtMs) ? observedAtMs : input.messageTimestamp;
  const responseFingerprint = clippyAgentResponseFingerprint(input.text);
  return {
    text: input.text,
    properties: {
      source: 'clippy_agent_bridge',
      agent,
      bridgeEventType: 'CHAT_RESPONSE',
      bridgeMessageSource: 'agent_stdout',
      observedAt: input.observedAt,
      capturedAtMs,
      agentChatResponseId: buildClippyAgentChatResponseId({
        agentName: agent,
        capturedAtMs,
        responseFingerprint,
      }),
      responseFingerprint,
      responseLength: input.text.length,
      bridgePersisted: false,
      persistenceFallback: 'browser_after_bridge_persist_failed',
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      messageTimestamp: input.messageTimestamp,
      agentResponseClaimed: true,
    },
  };
}

export function buildClippyAgentMessageSessionEvidence(input: {
  text: string;
  source?: AgentChatMessage['source'];
  agentName?: string | null;
  agentStatus?: AgentStatus | null;
  diagnosticSource?: string | null;
  observedAt?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  truncated?: boolean | null;
  persisted?: boolean | null;
  promptType?: string | null;
  deliveredToAgent?: boolean | null;
  promptLength?: number | null;
  promptFingerprint?: string | null;
  roomContextStatus?: number | null;
  roomContextLength?: number | null;
  roomContextFingerprint?: string | null;
  userMessageLength?: number | null;
  userMessageFingerprint?: string | null;
  contextTruncated?: boolean | null;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  messageTimestamp: number;
}): ClippyAgentMessageSessionEvidence | null {
  if (input.persisted) return null;
  if (!input.text.trim()) return null;
  const agentName = input.agentName?.trim();
  if (!agentName) return null;
  const isAgentResponse = input.source === 'agent_stdout';
  if (isAgentResponse && input.observedAt) {
    const evidence = buildClippyAgentChatFallbackEvidence({
      text: input.text,
      agentName,
      observedAt: input.observedAt,
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      messageTimestamp: input.messageTimestamp,
    });
    return {
      eventType: 'ai_chat_agent',
      text: evidence.text,
      properties: evidence.properties,
    };
  }
  if (!isClippyAgentBridgeMessageSource(input.source)) return null;
  const observedAt = input.observedAt ?? observedAtFromMessageTimestamp(input.messageTimestamp);
  const observedAtMs = Date.parse(observedAt);
  const capturedAtMs = Number.isFinite(observedAtMs)
    ? observedAtMs
    : normalizedTimestamp(input.messageTimestamp);
  const diagnosticSource = isAgentResponse
    ? 'agent_response_missing_source_metadata'
    : input.diagnosticSource ?? input.source;
  const evidence = buildClippyAgentStatusEvidence({
    text: isAgentResponse
      ? 'Clippy/Devin response was not recorded as agent evidence because bridge source metadata was missing.'
      : input.text,
    agentName,
    status: input.agentStatus ?? null,
    diagnosticSource,
    bridgeMessageSource: input.source,
    observedAt,
    capturedAtMs,
    exitCode: input.exitCode ?? null,
    signal: input.signal ?? null,
    truncated: input.truncated ?? null,
    bridgePersisted: input.persisted ?? null,
    promptType: input.promptType ?? null,
    deliveredToAgent: input.deliveredToAgent ?? null,
    promptLength: input.promptLength ?? null,
    promptFingerprint: input.promptFingerprint ?? null,
    roomContextStatus: input.roomContextStatus ?? null,
    roomContextLength: input.roomContextLength ?? null,
    roomContextFingerprint: input.roomContextFingerprint ?? null,
    userMessageLength: input.userMessageLength ?? null,
    userMessageFingerprint: input.userMessageFingerprint ?? null,
    contextTruncated: input.contextTruncated ?? null,
    surface: input.surface,
    roomPhase: input.roomPhase,
    workspaceStatus: input.workspaceStatus,
    workspaceSessionId: input.workspaceSessionId,
    messageTimestamp: input.messageTimestamp,
  });
  return {
    eventType: 'ai_agent_status',
    text: evidence.text,
    properties: evidence.properties,
  };
}
