import type { RoomSurface } from '../hooks/useRoomConnection';
import type {
  AgentChatMessage,
  AgentPromptBlockedReason,
  AgentRoomAction,
  AgentStatus,
} from '../hooks/useAgentConnection';
import type { RoomPhase } from '../types';
import {
  buildAgentPromptId,
  agentTextFingerprint,
  normalizedAgentPromptTimestamp,
  safeAgentEvidenceIdPart as safeEvidenceIdPart,
} from './agentPromptIdentity';
import { redactAgentDiagnosticText } from './agentDiagnosticRedaction';

export { agentTextFingerprint } from './agentPromptIdentity';

export type AgentUiActionId = 'open-agent-chat' | 'close-agent-chat' | 'open-devin-auth-browser' | 'check-devin-auth';
export type AgentUiActionOrigin = 'tray' | 'chat' | 'call';
export type AgentRoomActionOrigin = 'chat' | 'agent';
export type AgentEvidenceActor = 'host' | 'guest';
type AgentUiActionSource = 'agent_tray_ui' | 'agent_chat_ui' | 'agent_call_controls_ui';
type AgentActionExecutionStatus = 'opened' | 'closed' | 'dismissed' | 'executed' | 'suggested';

export interface AgentUiActionEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface AgentRoomActionExecutionEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface AgentUserChatEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface AgentChatFallbackEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface AgentStatusEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface AgentMessageSessionEvidence {
  eventType: 'ai_chat_agent' | 'ai_agent_status';
  text: string;
  properties: Record<string, unknown>;
}

type AgentBridgeMessageSource = Exclude<NonNullable<AgentChatMessage['source']>, 'user_submit'>;
type AgentStatusBridgeMessageSource = 'agent_status' | AgentBridgeMessageSource;
const AGENT_PROMPT_BLOCKED_REASONS = new Set<AgentPromptBlockedReason>([
  'workspace_required',
  'bridge_reconnecting',
  'agent_starting',
  'agent_auth_needed',
  'agent_disconnected',
  'agent_identity_missing',
  'agent_capabilities_missing',
]);

const FNV_32_OFFSET = 0x811c9dc5;
const FNV_32_PRIME = 0x01000193;

function agentUiActionText(actionId: AgentUiActionId, origin: AgentUiActionOrigin): string {
  switch (actionId) {
    case 'open-agent-chat':
      if (origin === 'chat') return 'AI assistant opened from the room chat panel';
      if (origin === 'call') return 'AI assistant opened from the video call controls';
      return 'AI assistant opened from the room controls';
    case 'close-agent-chat':
      return 'AI assistant chat panel closed';
    case 'open-devin-auth-browser':
      return 'AI assistant opened Devin browser authentication';
    case 'check-devin-auth':
      return 'AI assistant requested a real Devin CLI auth recheck';
    default:
      return 'AI assistant UI action';
  }
}

function agentUiActionStatus(actionId: AgentUiActionId): string {
  if (actionId === 'open-agent-chat') return 'opened';
  if (actionId === 'close-agent-chat') return 'closed';
  return 'executed';
}

export function buildAgentActionEventId(input: {
  actor: AgentEvidenceActor | 'agent';
  capturedAtMs: number;
  source: AgentUiActionSource | 'agent_bridge';
  origin: AgentUiActionOrigin | AgentRoomActionOrigin;
  executionStatus: AgentActionExecutionStatus;
  actionId: string;
}): string {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  return [
    'agent-action',
    input.actor,
    String(capturedAtMs),
    input.source,
    input.origin,
    input.executionStatus,
    safeEvidenceIdPart(input.actionId),
  ].join(':');
}

export function buildAgentStatusEventId(input: {
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

export function agentResponseFingerprint(text: string): string {
  let hash = FNV_32_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_32_PRIME);
  }
  return `agent_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildAgentChatResponseId(input: {
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

function isAgentBridgeMessageSource(value: unknown): value is AgentBridgeMessageSource {
  return value === 'agent_stdout'
    || value === 'agent_api_response'
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
  source: 'agent_stdout_action' | 'agent_api_response_action';
  agentName: string;
  bridgeEventType: 'ROOM_ACTION';
  protocol: 'agent_room_action_tag';
  observedAt: string;
  persisted: boolean;
} {
  return Boolean(action)
    && action?.id === actionId
    && (action.source === 'agent_stdout_action' || action.source === 'agent_api_response_action')
    && typeof action.agentName === 'string'
    && action.agentName.trim().length > 0
    && action.bridgeEventType === 'ROOM_ACTION'
    && action.protocol === 'agent_room_action_tag'
    && typeof action.observedAt === 'string'
    && action.observedAt.trim().length > 0
    && typeof action.persisted === 'boolean';
}

export function buildAgentUiActionEvidence(input: {
  actionId: AgentUiActionId;
  origin: AgentUiActionOrigin;
  actor: AgentEvidenceActor;
  capturedAtMs: number;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  agentWorkspaceReady: boolean;
}): AgentUiActionEvidence {
  const source: AgentUiActionSource = input.origin === 'tray'
    ? 'agent_tray_ui'
    : input.origin === 'chat'
      ? 'agent_chat_ui'
      : 'agent_call_controls_ui';
  const actionSource = input.origin === 'tray'
    ? 'assessment_agent_tray'
    : input.origin === 'chat'
      ? 'agent_chat_panel'
      : 'video_call_controls';
  const executionStatus = agentUiActionStatus(input.actionId) as AgentActionExecutionStatus;
  const capturedAtMs = Number.isFinite(input.capturedAtMs) ? Math.max(0, Math.round(input.capturedAtMs)) : 0;
  return {
    text: agentUiActionText(input.actionId, input.origin),
    properties: {
      source,
      actionId: input.actionId,
      origin: input.origin,
      executedBy: input.actor,
      actionSource,
      executionStatus,
      capturedAtMs,
      agentActionEventId: buildAgentActionEventId({
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

export function buildAgentRoomActionExecutionEvidence(input: {
  actionId: string;
  text: string;
  origin: AgentRoomActionOrigin;
  actor: AgentEvidenceActor;
  capturedAtMs: number;
  agentAction?: AgentRoomAction;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
}): AgentRoomActionExecutionEvidence | null {
  if (input.origin === 'agent' && !isSourceBackedAgentRoomAction(input.agentAction, input.actionId)) {
    return null;
  }
  const agent = input.origin === 'agent' ? input.agentAction?.agentName ?? null : null;
  const source = input.origin === 'agent' ? 'agent_bridge' : 'agent_chat_ui';
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
        : 'agent_chat_panel',
      agent,
      agentActionLabel: input.agentAction?.label ?? null,
      agentActionText: input.agentAction?.text ?? null,
      bridgeEventType: input.agentAction?.bridgeEventType ?? null,
      actionProtocol: input.agentAction?.protocol ?? null,
      agentActionObservedAt: input.agentAction?.observedAt ?? null,
      agentActionBridgePersisted: input.agentAction?.persisted ?? null,
      ...(input.agentAction?.browserPromptId ? { browserPromptId: input.agentAction.browserPromptId } : {}),
      ...(input.agentAction?.browserPromptFingerprint
        ? { browserPromptFingerprint: input.agentAction.browserPromptFingerprint }
        : {}),
      ...(input.agentAction?.browserPromptTimestamp !== undefined
        ? { browserPromptTimestamp: input.agentAction.browserPromptTimestamp }
        : {}),
      ...(input.agentAction?.browserPromptLength !== undefined
        ? { browserPromptLength: input.agentAction.browserPromptLength }
        : {}),
      executionStatus: 'executed',
      capturedAtMs,
      agentActionEventId: buildAgentActionEventId({
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

export function buildAgentUserChatEvidence(input: {
  message: AgentChatMessage;
  actor: AgentEvidenceActor;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  repoUrl: string | null;
}): AgentUserChatEvidence {
  const promptFingerprint = input.message.browserPromptFingerprint ?? agentTextFingerprint(input.message.text);
  const promptTimestamp = input.message.browserPromptTimestamp
    ?? normalizedAgentPromptTimestamp(input.message.timestamp);
  const promptId = input.message.browserPromptId ?? buildAgentPromptId({
    workspaceSessionId: input.workspaceSessionId,
    actor: input.actor,
    timestamp: promptTimestamp,
    promptFingerprint,
  });
  const promptLength = input.message.browserPromptLength ?? input.message.text.length;
  const blockedReason = input.message.deliveryStatus === 'blocked'
    && input.message.blockedReason
    && AGENT_PROMPT_BLOCKED_REASONS.has(input.message.blockedReason)
    ? input.message.blockedReason
    : null;
  const deliveryStatus = blockedReason ? 'blocked' : 'queued';
  return {
    text: input.message.text,
    properties: {
      source: 'agent_chat_client_submit',
      agentChatEventSource: 'browser_agent_chat_panel',
      bridgeMessageType: 'CHAT',
      bridgeProtocol: 'agent_dev_container_ws',
      bridgeDeliveryStatus: deliveryStatus,
      promptId,
      promptFingerprint,
      promptLength,
      promptTimestamp,
      browserQueuedBridgeMessage: deliveryStatus === 'queued',
      bridgeDeliveryConfirmed: false,
      ...(blockedReason ? { bridgeBlockedReason: blockedReason } : {}),
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

export function buildAgentStatusEvidence(input: {
  text: string;
  agentName: string | null;
  status: AgentStatus | null;
  bridgeMessageSource: AgentStatusBridgeMessageSource;
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
  browserPromptId?: string | null;
  browserPromptFingerprint?: string | null;
  browserPromptTimestamp?: number | null;
  browserPromptLength?: number | null;
  agentRuntime?: string | null;
  agentRunProvider?: string | null;
  agentRunId?: string | null;
  agentRunExternalSessionHash?: string | null;
  messageTimestamp?: number | null;
}): AgentStatusEvidence | null {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const agent = input.agentName?.trim();
  if (!agent) return null;
  const text = redactAgentDiagnosticText(input.text);
  if (!text) return null;
  return {
    text,
    properties: {
      source: 'agent_bridge',
      agentStatusEventSource: 'browser_agent_ws',
      agent,
      status: input.status,
      diagnosticSource: input.diagnosticSource ?? null,
      bridgeMessageSource: input.bridgeMessageSource,
      observedAt: input.observedAt,
      capturedAtMs,
      agentStatusEventId: buildAgentStatusEventId({
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
      ...(input.browserPromptId ? { browserPromptId: input.browserPromptId } : {}),
      ...(input.browserPromptFingerprint ? { browserPromptFingerprint: input.browserPromptFingerprint } : {}),
      ...(input.browserPromptTimestamp !== null && input.browserPromptTimestamp !== undefined
        ? { browserPromptTimestamp: input.browserPromptTimestamp }
        : {}),
      ...(input.browserPromptLength !== null && input.browserPromptLength !== undefined
        ? { browserPromptLength: input.browserPromptLength }
        : {}),
      ...(input.agentRuntime ? { agentRuntime: input.agentRuntime } : {}),
      ...(input.agentRunProvider ? { agentRunProvider: input.agentRunProvider } : {}),
      ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
      ...(input.agentRunExternalSessionHash
        ? { agentRunExternalSessionHash: input.agentRunExternalSessionHash }
        : {}),
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      messageTimestamp: input.messageTimestamp ?? capturedAtMs,
      agentResponseClaimed: false,
    },
  };
}

export function buildAgentChatFallbackEvidence(input: {
  text: string;
  agentName: string | null;
  bridgeMessageSource?: 'agent_stdout' | 'agent_api_response';
  observedAt: string;
  browserPromptId?: string | null;
  browserPromptFingerprint?: string | null;
  browserPromptTimestamp?: number | null;
  browserPromptLength?: number | null;
  agentRuntime?: string | null;
  agentRunProvider?: string | null;
  agentRunId?: string | null;
  agentRunExternalSessionHash?: string | null;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  messageTimestamp: number;
}): AgentChatFallbackEvidence | null {
  const agent = input.agentName?.trim();
  if (!agent) return null;
  const text = redactAgentDiagnosticText(input.text);
  if (!text) return null;
  const observedAtMs = Date.parse(input.observedAt);
  const capturedAtMs = Number.isFinite(observedAtMs) ? observedAtMs : input.messageTimestamp;
  const responseFingerprint = agentResponseFingerprint(text);
  return {
    text,
    properties: {
      source: 'agent_bridge',
      agent,
      bridgeEventType: 'CHAT_RESPONSE',
      bridgeMessageSource: input.bridgeMessageSource ?? 'agent_stdout',
      observedAt: input.observedAt,
      capturedAtMs,
      agentChatResponseId: buildAgentChatResponseId({
        agentName: agent,
        capturedAtMs,
        responseFingerprint,
      }),
      responseFingerprint,
      responseLength: text.length,
      bridgePersisted: false,
      persistenceFallback: 'browser_after_bridge_persist_failed',
      ...(input.browserPromptId ? { browserPromptId: input.browserPromptId } : {}),
      ...(input.browserPromptFingerprint ? { browserPromptFingerprint: input.browserPromptFingerprint } : {}),
      ...(input.browserPromptTimestamp !== null && input.browserPromptTimestamp !== undefined
        ? { browserPromptTimestamp: input.browserPromptTimestamp }
        : {}),
      ...(input.browserPromptLength !== null && input.browserPromptLength !== undefined
        ? { browserPromptLength: input.browserPromptLength }
        : {}),
      ...(input.agentRuntime ? { agentRuntime: input.agentRuntime } : {}),
      ...(input.agentRunProvider ? { agentRunProvider: input.agentRunProvider } : {}),
      ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
      ...(input.agentRunExternalSessionHash
        ? { agentRunExternalSessionHash: input.agentRunExternalSessionHash }
        : {}),
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      messageTimestamp: input.messageTimestamp,
      agentResponseClaimed: true,
    },
  };
}

export function buildAgentMessageSessionEvidence(input: {
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
  browserPromptId?: string | null;
  browserPromptFingerprint?: string | null;
  browserPromptTimestamp?: number | null;
  browserPromptLength?: number | null;
  agentRuntime?: string | null;
  agentRunProvider?: string | null;
  agentRunId?: string | null;
  agentRunExternalSessionHash?: string | null;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  workspaceStatus: string | null;
  workspaceSessionId: string | null;
  messageTimestamp: number;
}): AgentMessageSessionEvidence | null {
  if (input.persisted) return null;
  const text = redactAgentDiagnosticText(input.text);
  if (!text) return null;
  const agentName = input.agentName?.trim();
  if (!agentName) return null;
  const isAgentResponse = input.source === 'agent_stdout' || input.source === 'agent_api_response';
  if (isAgentResponse && input.observedAt) {
    const evidence = buildAgentChatFallbackEvidence({
      text,
      agentName,
      bridgeMessageSource: input.source === 'agent_api_response' ? 'agent_api_response' : 'agent_stdout',
      observedAt: input.observedAt,
      browserPromptId: input.browserPromptId ?? null,
      browserPromptFingerprint: input.browserPromptFingerprint ?? null,
      browserPromptTimestamp: input.browserPromptTimestamp ?? null,
      browserPromptLength: input.browserPromptLength ?? null,
      agentRuntime: input.agentRuntime ?? null,
      agentRunProvider: input.agentRunProvider ?? null,
      agentRunId: input.agentRunId ?? null,
      agentRunExternalSessionHash: input.agentRunExternalSessionHash ?? null,
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: input.workspaceStatus,
      workspaceSessionId: input.workspaceSessionId,
      messageTimestamp: input.messageTimestamp,
    });
    if (!evidence) return null;
    return {
      eventType: 'ai_chat_agent',
      text: evidence.text,
      properties: evidence.properties,
    };
  }
  if (!isAgentBridgeMessageSource(input.source)) return null;
  const observedAt = input.observedAt ?? observedAtFromMessageTimestamp(input.messageTimestamp);
  const observedAtMs = Date.parse(observedAt);
  const capturedAtMs = Number.isFinite(observedAtMs)
    ? observedAtMs
    : normalizedTimestamp(input.messageTimestamp);
  const diagnosticSource = isAgentResponse
    ? 'agent_response_missing_source_metadata'
    : input.diagnosticSource ?? input.source;
  const evidence = buildAgentStatusEvidence({
    text: isAgentResponse
      ? 'AI assistant/Devin response was not recorded as agent evidence because bridge source metadata was missing.'
      : text,
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
    browserPromptId: input.browserPromptId ?? null,
    browserPromptFingerprint: input.browserPromptFingerprint ?? null,
    browserPromptTimestamp: input.browserPromptTimestamp ?? null,
    browserPromptLength: input.browserPromptLength ?? null,
    agentRuntime: input.agentRuntime ?? null,
    agentRunProvider: input.agentRunProvider ?? null,
    agentRunId: input.agentRunId ?? null,
    agentRunExternalSessionHash: input.agentRunExternalSessionHash ?? null,
    surface: input.surface,
    roomPhase: input.roomPhase,
    workspaceStatus: input.workspaceStatus,
    workspaceSessionId: input.workspaceSessionId,
    messageTimestamp: input.messageTimestamp,
  });
  if (!evidence) return null;
  return {
    eventType: 'ai_agent_status',
    text: evidence.text,
    properties: evidence.properties,
  };
}
