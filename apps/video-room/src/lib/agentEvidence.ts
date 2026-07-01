import type { RoomSurface } from '../hooks/useRoomConnection';
import type {
  AgentChatMessage,
  AgentStatus,
} from '../hooks/useAgentConnection';
import type { RoomPhase } from '../types';
import {
  safeAgentEvidenceIdPart as safeEvidenceIdPart,
} from './agentPromptIdentity';
import { redactAgentDiagnosticText } from './agentDiagnosticRedaction';

export { agentTextFingerprint } from './agentPromptIdentity';

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

const FNV_32_OFFSET = 0x811c9dc5;
const FNV_32_PRIME = 0x01000193;

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
      ? 'Agent bridge response was not recorded as evidence because bridge source metadata was missing.'
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
