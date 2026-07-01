import { useCallback, useEffect, useRef, useState } from 'react';
import { getIceServerConfig, roomWebSocketUrl } from '../lib/api';
import type {
  IceServerProvider,
  IceCandidatePayload,
  RoomPhase,
  RoomRole,
  SdpPayload,
} from '../types';
import { safeAgentEvidenceIdPart as safeEvidenceIdPart } from '../lib/agentPromptIdentity';
import {
  roomChatMessageFingerprint,
} from '../lib/chatEvidence';
import type { SessionEventType } from './useSessionEvents';

const ROOM_PHASES = new Set<RoomPhase>([
  'disconnected',
  'waiting',
  'peer_connected',
  'offer_received',
  'connecting',
  'connected',
  'peer_disconnected',
  'ended',
  'error',
]);

export type RoomSurface = 'standard';
export type RoomAgentInteractionEventType = Extract<
  SessionEventType,
  'ai_chat_user' | 'ai_chat_agent' | 'ai_agent_status'
>;
export type RoomCodeServerFileEventType = Extract<SessionEventType, 'code_editor_save' | 'file_change'>;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const CODE_SERVER_SAVE_ACTIONS = new Set(['created', 'modified', 'renamed']);
const CODE_SERVER_FILE_CHANGE_ID_RE = /^code-server-file:[a-zA-Z0-9:_-]+:\d+:[a-zA-Z0-9:_-]+:path_[0-9a-f]{8}:[a-f0-9]{16}$/;
const TERMINAL_FINGERPRINT_RE = /^terminal_[0-9a-f]{8}$/;
const TERMINAL_COMMAND_ID_RE = /^.+:command:(host|guest):\d+:\d+:terminal_[0-9a-f]{8}$/;
const ROOM_CHAT_MESSAGE_FINGERPRINT_RE = /^chat_[0-9a-f]{8}$/;
const AGENT_PROMPT_FINGERPRINT_RE = /^agent_[0-9a-f]{8}$/;
const BROWSER_PROMPT_ID_RE = /^[a-zA-Z0-9:_-]+:(host|guest):prompt:\d+:agent_[0-9a-f]{8}$/;
const AGENT_CHAT_RESPONSE_FINGERPRINT_RE = /^agent_[0-9a-f]{8}$/;
const AGENT_CHAT_RESPONSE_ID_RE = /^agent-chat:[a-zA-Z0-9:_-]+:\d+:CHAT_RESPONSE:agent_[0-9a-f]{8}$/;
const AGENT_STATUS_EVENT_ID_RE = /^agent-status:[a-zA-Z0-9:_-]+:\d+:[a-z_]+:[a-zA-Z0-9:_-]+:[a-zA-Z0-9:_-]+$/;
const AGENT_PROMPT_BLOCKED_REASONS = new Set([
  'workspace_required',
  'bridge_reconnecting',
  'agent_starting',
  'agent_auth_needed',
  'agent_disconnected',
  'agent_identity_missing',
  'agent_capabilities_missing',
]);
const AGENT_STATUSES = new Set(['starting', 'idle', 'thinking', 'working', 'auth_needed', 'disconnected']);
const AGENT_STATUS_MESSAGE_SOURCES = new Set([
  'agent_status',
  'agent_stdout',
  'agent_api_response',
  'bridge_diagnostic',
  'bridge_observation',
]);
const RECORDING_STATE_EVENT_ID_RE = /^recording:host:\d+:(start|stop):(recording|uploading|saved|failed)$/;
const RECORDING_FAILURE_STAGES = new Set(['stop_recorder', 'prepare_upload', 'upload_request']);
const RECORDING_FAILURE_SOURCES = new Set([
  'browser_media_recorder_exception',
  'browser_blob_builder_exception',
  'recording_upload_exception',
]);
const MAX_RECORDING_FAILURE_MESSAGE_LENGTH = 240;

export interface RoomAgentInteractionEvent {
  id: string;
  clientId: string;
  createdAt: number;
  eventType: RoomAgentInteractionEventType;
  actor: 'host' | 'guest' | 'agent' | 'system';
  text: string;
  evidence?: Record<string, unknown>;
}

export interface RoomAgentInteractionEventDraft {
  eventType: RoomAgentInteractionEventType;
  actor: 'host' | 'guest' | 'agent' | 'system';
  text: string;
  evidence?: Record<string, unknown>;
}

export interface RoomChatMessage {
  id: string;
  clientId: string;
  createdAt: number;
  role: RoomRole;
  text: string;
  deliveryStatus?: 'pending' | 'accepted' | 'rejected';
  evidence?: Record<string, unknown>;
}

export interface RoomChatRejection {
  clientMessageId: string | null;
  reason: string | null;
}

export type RoomMediaControlKind = 'microphone' | 'camera';

export interface RoomMediaControlEvent {
  id: string;
  clientId: string;
  createdAt: number;
  role: RoomRole;
  control: RoomMediaControlKind;
  previousEnabled: boolean;
  enabled: boolean;
  evidence?: Record<string, unknown>;
}

export interface RoomMediaControlEventDraft {
  control: RoomMediaControlKind;
  previousEnabled: boolean;
  enabled: boolean;
  evidence?: Record<string, unknown>;
}

export interface RoomMediaControlState {
  role: RoomRole;
  microphoneEnabled?: boolean;
  cameraEnabled?: boolean;
  updatedAt: number;
  evidence?: Record<string, unknown>;
}

export type RoomRecordingLifecycleKind = 'start' | 'stop';
export type RoomRecordingStatus = 'recording' | 'uploading' | 'saved' | 'failed';

export interface RoomRecordingStateEvent {
  id: string;
  clientId: string;
  createdAt: number;
  role: RoomRole;
  lifecycleKind: RoomRecordingLifecycleKind;
  status: RoomRecordingStatus;
  active: boolean;
  evidence?: Record<string, unknown>;
}

export interface RoomRecordingStateEventDraft {
  lifecycleKind: RoomRecordingLifecycleKind;
  status: RoomRecordingStatus;
  active: boolean;
  evidence?: Record<string, unknown>;
}

export interface RoomRecordingState {
  role: RoomRole;
  status: RoomRecordingStatus;
  active: boolean;
  updatedAt: number;
  evidence?: Record<string, unknown>;
}

export interface RoomCodeServerFileEvent {
  id: string;
  clientId: string;
  createdAt: number;
  eventType: RoomCodeServerFileEventType;
  actor: 'system';
  text: string;
  evidence?: Record<string, unknown>;
}

export interface RoomCodeServerFileEventDraft {
  eventType: RoomCodeServerFileEventType;
  actor: 'system';
  text: string;
  evidence?: Record<string, unknown>;
}

export type RoomTerminalEvent =
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'COMMAND';
      text: string;
      evidence?: Record<string, unknown>;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'OUTPUT';
      text: string;
      evidence?: Record<string, unknown>;
    };

export type RoomTerminalEventDraft =
  | {
      kind: 'COMMAND';
      text: string;
      evidence?: Record<string, unknown>;
    }
  | {
      kind: 'OUTPUT';
      text: string;
      evidence?: Record<string, unknown>;
    };

interface RoomConnection {
  phase: RoomPhase;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  iceProvider: IceServerProvider;
  roomSurface: RoomSurface;
  agentInteractionEvents: RoomAgentInteractionEvent[];
  chatMessages: RoomChatMessage[];
  mediaControlStates: RoomMediaControlState[];
  recordingState: RoomRecordingState | null;
  codeServerFileEvents: RoomCodeServerFileEvent[];
  terminalEvents: RoomTerminalEvent[];
  cameraEnabled: boolean;
  micEnabled: boolean;
  hasLocalCamera: boolean;
  hasLocalMicrophone: boolean;
  setLocalStream: (stream: MediaStream) => void;
  startCall: () => Promise<void>;
  acceptCall: () => Promise<void>;
  hangUp: () => void;
  toggleCamera: () => void;
  toggleMic: () => void;
  retryConnection: () => void;
  publishAgentInteractionEvent: (event: RoomAgentInteractionEventDraft) => void;
  publishChatMessage: (text: string) => RoomChatMessage | null;
  publishMediaControlEvent: (event: RoomMediaControlEventDraft) => void;
  publishRecordingStateEvent: (event: RoomRecordingStateEventDraft) => void;
  publishCodeServerFileEvent: (event: RoomCodeServerFileEventDraft) => void;
  publishTerminalEvent: (event: RoomTerminalEventDraft) => void;
}

interface UseRoomConnectionOptions {
  onChatDeliveryEvidence?: (message: RoomChatMessage) => void;
}

const FALLBACK_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const PEER_DISCONNECT_GRACE_MS = 15000;
const PEER_FAILED_GRACE_MS = 12000;
const PEER_RENEGOTIATE_DELAY_MS = 750;

export function addLocalMediaToPeer(peer: RTCPeerConnection, stream: MediaStream | null): void {
  const attachedKinds = new Set<string>();
  stream?.getTracks().forEach((track) => {
    attachedKinds.add(track.kind);
    peer.addTrack(track, stream);
  });
  if (!attachedKinds.has('audio')) {
    peer.addTransceiver('audio', { direction: 'recvonly' });
  }
  if (!attachedKinds.has('video')) {
    peer.addTransceiver('video', { direction: 'recvonly' });
  }
}

function createPeerConfiguration(iceServers: RTCIceServer[]): RTCConfiguration {
  return {
    iceServers,
    // Keep TURN available, but do not force relay-only. When the relay path is
    // slow or blocked, browsers should still be allowed to use healthy direct
    // or STUN candidates.
    iceTransportPolicy: 'all',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRoomSurface(value: unknown): value is RoomSurface {
  return value === 'standard';
}

function isRoomRole(value: unknown): value is RoomRole {
  return value === 'HOST' || value === 'GUEST';
}

function isRoomAgentInteractionEventType(value: unknown): value is RoomAgentInteractionEventType {
  return value === 'ai_chat_user'
    || value === 'ai_chat_agent'
    || value === 'ai_agent_status';
}

function parseAgentInteractionEvent(value: unknown): RoomAgentInteractionEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt)
    || !isRoomAgentInteractionEventType(value.eventType)
    || (value.actor !== 'host' && value.actor !== 'guest' && value.actor !== 'agent' && value.actor !== 'system')
    || typeof value.text !== 'string'
    || value.text.trim().length === 0
  ) {
    return null;
  }
  return {
    id: value.id,
    clientId: value.clientId,
    createdAt: value.createdAt,
    eventType: value.eventType,
    actor: value.actor,
    text: value.text,
    evidence: recordOrUndefined(value.evidence),
  };
}

function hasOptionalBrowserPromptRef(evidence: Record<string, unknown>): boolean {
  const promptId = evidence.browserPromptId;
  const promptFingerprint = evidence.browserPromptFingerprint;
  const promptTimestamp = evidence.browserPromptTimestamp;
  const promptLength = evidence.browserPromptLength;
  const hasAny = promptId !== undefined
    || promptFingerprint !== undefined
    || promptTimestamp !== undefined
    || promptLength !== undefined;
  if (!hasAny) return true;
  return typeof promptId === 'string'
    && BROWSER_PROMPT_ID_RE.test(promptId)
    && typeof promptFingerprint === 'string'
    && AGENT_PROMPT_FINGERPRINT_RE.test(promptFingerprint)
    && typeof promptTimestamp === 'number'
    && Number.isInteger(promptTimestamp)
    && promptTimestamp >= 0
    && typeof promptLength === 'number'
    && Number.isInteger(promptLength)
    && promptLength >= 0;
}

export function hasSourceBackedAgentInteractionEvidence(
  event: RoomAgentInteractionEvent,
  role: RoomRole,
): boolean {
  const evidence = event.evidence;
  if (!isRecord(evidence) || evidence.durableObjectReplayExpected !== true) return false;
  const senderActor = role === 'HOST' ? 'host' : 'guest';

  if (event.eventType === 'ai_chat_user') {
    const promptTimestamp = typeof evidence.promptTimestamp === 'number' && Number.isFinite(evidence.promptTimestamp)
      ? evidence.promptTimestamp
      : null;
    const promptFingerprint = typeof evidence.promptFingerprint === 'string' ? evidence.promptFingerprint : null;
    const workspaceSessionId = typeof evidence.workspaceSessionId === 'string' && evidence.workspaceSessionId.trim().length > 0
      ? evidence.workspaceSessionId
      : null;
    const deliveryStatus = evidence.bridgeDeliveryStatus === 'blocked' ? 'blocked' : 'queued';
    const deliveryOk = deliveryStatus === 'blocked'
      ? evidence.browserQueuedBridgeMessage === false
        && AGENT_PROMPT_BLOCKED_REASONS.has(String(evidence.bridgeBlockedReason))
      : evidence.browserQueuedBridgeMessage === true
        && workspaceSessionId !== null
        && typeof evidence.workspaceStatus === 'string';
    const expectedPromptId = promptTimestamp !== null && promptFingerprint !== null
      ? `${safeEvidenceIdPart(workspaceSessionId)}:${event.actor}:prompt:${promptTimestamp}:${promptFingerprint}`
      : null;
    return (event.actor === 'host' || event.actor === 'guest')
      && event.actor === senderActor
      && evidence.actor === event.actor
      && evidence.source === 'agent_chat_client_submit'
      && evidence.agentChatEventSource === 'browser_agent_chat_panel'
      && evidence.bridgeMessageType === 'CHAT'
      && evidence.bridgeProtocol === 'agent_dev_container_ws'
      && (
        evidence.bridgeDeliveryStatus === deliveryStatus
        || (deliveryStatus === 'queued' && evidence.bridgeDeliveryStatus === undefined)
      )
      && deliveryOk
      && evidence.bridgeDeliveryConfirmed === false
      && evidence.deliveredToAgentBridge !== true
      && evidence.agentResponseClaimed === false
      && (evidence.agent === undefined || evidence.agent === null)
      && promptTimestamp !== null
      && promptTimestamp >= 0
      && promptFingerprint !== null
      && AGENT_PROMPT_FINGERPRINT_RE.test(promptFingerprint)
      && evidence.promptLength === event.text.length
      && evidence.promptId === expectedPromptId
      && isRoomSurface(evidence.surface)
      && typeof evidence.roomPhase === 'string'
      && (evidence.workspaceStatus === null || typeof evidence.workspaceStatus === 'string')
      && (evidence.repoUrl === null || typeof evidence.repoUrl === 'string');
  }

  if (event.eventType === 'ai_chat_agent') {
    const capturedAtMs = typeof evidence.capturedAtMs === 'number' && Number.isInteger(evidence.capturedAtMs)
      ? evidence.capturedAtMs
      : null;
    const agent = typeof evidence.agent === 'string' ? evidence.agent : null;
    const fingerprint = typeof evidence.responseFingerprint === 'string' ? evidence.responseFingerprint : null;
    const expectedId = capturedAtMs !== null && agent && fingerprint
      ? `agent-chat:${safeEvidenceIdPart(agent)}:${capturedAtMs}:CHAT_RESPONSE:${fingerprint}`
      : null;
    const persistedOk = evidence.bridgePersisted === true
      && typeof evidence.actionCount === 'number'
      && Number.isFinite(evidence.actionCount)
      && evidence.actionCount >= 0;
    const fallbackOk = evidence.bridgePersisted === false
      && evidence.persistenceFallback === 'browser_after_bridge_persist_failed'
      && isRoomSurface(evidence.surface)
      && typeof evidence.roomPhase === 'string'
      && typeof evidence.messageTimestamp === 'number'
      && Number.isFinite(evidence.messageTimestamp)
      && evidence.messageTimestamp >= 0
      && evidence.agentResponseClaimed === true;
    return event.actor === 'agent'
      && evidence.source === 'agent_bridge'
      && evidence.bridgeEventType === 'CHAT_RESPONSE'
      && (evidence.bridgeMessageSource === 'agent_stdout' || evidence.bridgeMessageSource === 'agent_api_response')
      && typeof evidence.observedAt === 'string'
      && capturedAtMs !== null
      && capturedAtMs >= 0
      && agent !== null
      && fingerprint !== null
      && AGENT_CHAT_RESPONSE_FINGERPRINT_RE.test(fingerprint)
      && evidence.responseLength === event.text.length
      && typeof evidence.agentChatResponseId === 'string'
      && AGENT_CHAT_RESPONSE_ID_RE.test(evidence.agentChatResponseId)
      && evidence.agentChatResponseId === expectedId
      && hasOptionalBrowserPromptRef(evidence)
      && (persistedOk || fallbackOk);
  }

  if (event.eventType === 'ai_agent_status') {
    const capturedAtMs = typeof evidence.capturedAtMs === 'number' && Number.isInteger(evidence.capturedAtMs)
      ? evidence.capturedAtMs
      : null;
    const agent = typeof evidence.agent === 'string' ? evidence.agent : null;
    const bridgeMessageSource = typeof evidence.bridgeMessageSource === 'string' ? evidence.bridgeMessageSource : null;
    const status = typeof evidence.status === 'string' ? evidence.status : null;
    const diagnosticSource = typeof evidence.diagnosticSource === 'string' ? evidence.diagnosticSource : null;
    const expectedId = capturedAtMs !== null && agent && bridgeMessageSource
      ? `agent-status:${safeEvidenceIdPart(agent)}:${capturedAtMs}:${bridgeMessageSource}:${safeEvidenceIdPart(status)}:${safeEvidenceIdPart(diagnosticSource)}`
      : null;
    const statusOk = status === null || AGENT_STATUSES.has(status);
    const browserObservationOk = evidence.agentStatusEventSource === 'browser_agent_ws'
      && isRoomSurface(evidence.surface)
      && typeof evidence.roomPhase === 'string'
      && typeof evidence.messageTimestamp === 'number'
      && Number.isFinite(evidence.messageTimestamp)
      && evidence.messageTimestamp >= 0
      && evidence.agentResponseClaimed === false
      && (
        (bridgeMessageSource === 'agent_status' && status !== null && AGENT_STATUSES.has(status))
        || (bridgeMessageSource !== 'agent_status' && diagnosticSource !== null)
      );
    const persistedDiagnosticOk = bridgeMessageSource === 'bridge_diagnostic'
      && evidence.bridgePersisted === true
      && diagnosticSource !== null;
    return event.actor === 'agent'
      && evidence.source === 'agent_bridge'
      && agent !== null
      && statusOk
      && typeof evidence.observedAt === 'string'
      && capturedAtMs !== null
      && capturedAtMs >= 0
      && bridgeMessageSource !== null
      && AGENT_STATUS_MESSAGE_SOURCES.has(bridgeMessageSource)
      && typeof evidence.agentStatusEventId === 'string'
      && AGENT_STATUS_EVENT_ID_RE.test(evidence.agentStatusEventId)
      && evidence.agentStatusEventId === expectedId
      && (browserObservationOk || persistedDiagnosticOk);
  }

  return false;
}

function isRoomChatDeliveryStatus(value: unknown): value is NonNullable<RoomChatMessage['deliveryStatus']> {
  return value === 'pending' || value === 'accepted' || value === 'rejected';
}

function parseChatMessage(value: unknown): RoomChatMessage | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt)
    || !isRoomRole(value.role)
    || typeof value.text !== 'string'
    || value.text.trim().length === 0
  ) {
    return null;
  }
  const deliveryStatus = isRoomChatDeliveryStatus(value.deliveryStatus) ? value.deliveryStatus : 'accepted';
  return {
    id: value.id,
    clientId: value.clientId,
    createdAt: value.createdAt,
    role: value.role,
    text: value.text,
    deliveryStatus,
    evidence: isRecord(value.evidence) ? value.evidence : undefined,
  };
}

function parseChatSnapshot(value: unknown): { messages: RoomChatMessage[] } | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) return null;
  return {
    messages: value.messages
      .map(parseChatMessage)
      .filter((entry): entry is RoomChatMessage => entry !== null),
  };
}

export function hasSourceBackedChatEvidence(
  message: RoomChatMessage,
  role: RoomRole,
  expectedStatus: NonNullable<RoomChatMessage['deliveryStatus']> = 'accepted',
): boolean {
  const evidence = message.evidence;
  if (!isRecord(evidence)) return false;
  const actor = role === 'HOST' ? 'host' : 'guest';
  const messageCreatedAt = evidence.messageCreatedAt;
  const messageLength = evidence.messageLength;
  const messageFingerprint = evidence.messageFingerprint;
  const deliveryStatus = message.deliveryStatus ?? expectedStatus;
  return message.role === role
    && evidence.source === 'room_chat_client_submit'
    && evidence.chatEventSource === 'browser_room_chat_panel'
    && evidence.actor === actor
    && evidence.roomMessageId === message.id
    && evidence.clientId === message.clientId
    && messageCreatedAt === message.createdAt
    && typeof messageCreatedAt === 'number'
    && Number.isFinite(messageCreatedAt)
    && messageCreatedAt >= 0
    && messageLength === message.text.length
    && typeof messageLength === 'number'
    && typeof messageFingerprint === 'string'
    && ROOM_CHAT_MESSAGE_FINGERPRINT_RE.test(messageFingerprint)
    && messageFingerprint === roomChatMessageFingerprint(message.text)
    && deliveryStatus === expectedStatus
    && evidence.deliveryStatus === expectedStatus
    && isRoomSurface(evidence.surface)
    && typeof evidence.roomPhase === 'string'
    && evidence.roomPhase.trim().length > 0
    && evidence.durableObjectReplayExpected === true
    && (
      expectedStatus !== 'rejected'
      || (
        typeof evidence.deliveryRejectionReason === 'string'
        && evidence.deliveryRejectionReason.trim().length > 0
      )
    );
}

function parseChatRejection(value: unknown, reason: unknown): RoomChatRejection {
  if (!isRecord(value)) return { clientMessageId: null, reason: null };
  return {
    clientMessageId: typeof value.clientMessageId === 'string' ? value.clientMessageId : null,
    reason: typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : null,
  };
}

function isRoomMediaControlKind(value: unknown): value is RoomMediaControlKind {
  return value === 'microphone' || value === 'camera';
}

function parseMediaControlEvent(value: unknown): RoomMediaControlEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt)
    || !isRoomRole(value.role)
    || !isRoomMediaControlKind(value.control)
    || typeof value.previousEnabled !== 'boolean'
    || typeof value.enabled !== 'boolean'
    || value.previousEnabled === value.enabled
  ) {
    return null;
  }
  return {
    id: value.id,
    clientId: value.clientId,
    createdAt: value.createdAt,
    role: value.role,
    control: value.control,
    previousEnabled: value.previousEnabled,
    enabled: value.enabled,
    evidence: recordOrUndefined(value.evidence),
  };
}

function parseMediaControlState(value: unknown): RoomMediaControlState | null {
  if (!isRecord(value)) return null;
  if (
    !isRoomRole(value.role)
    || typeof value.updatedAt !== 'number'
    || !Number.isFinite(value.updatedAt)
    || (value.microphoneEnabled !== undefined && typeof value.microphoneEnabled !== 'boolean')
    || (value.cameraEnabled !== undefined && typeof value.cameraEnabled !== 'boolean')
  ) {
    return null;
  }
  const state: RoomMediaControlState = {
    role: value.role,
    updatedAt: value.updatedAt,
    evidence: recordOrUndefined(value.evidence),
  };
  if (typeof value.microphoneEnabled === 'boolean') {
    state.microphoneEnabled = value.microphoneEnabled;
  }
  if (typeof value.cameraEnabled === 'boolean') {
    state.cameraEnabled = value.cameraEnabled;
  }
  return state;
}

function parseMediaControlSnapshot(value: unknown): { states: RoomMediaControlState[] } | null {
  if (!isRecord(value) || !Array.isArray(value.states)) return null;
  return {
    states: value.states
      .map(parseMediaControlState)
      .filter((entry): entry is RoomMediaControlState => entry !== null),
  };
}

export function applyRoomMediaControlEvent(
  previous: RoomMediaControlState[],
  event: RoomMediaControlEvent,
): RoomMediaControlState[] {
  const existing = previous.find((entry) => entry.role === event.role);
  const nextState: RoomMediaControlState = {
    role: event.role,
    updatedAt: event.createdAt,
    evidence: event.evidence,
  };
  if (event.control === 'microphone') {
    nextState.microphoneEnabled = event.enabled;
  } else if (existing?.microphoneEnabled !== undefined) {
    nextState.microphoneEnabled = existing.microphoneEnabled;
  }
  if (event.control === 'camera') {
    nextState.cameraEnabled = event.enabled;
  } else if (existing?.cameraEnabled !== undefined) {
    nextState.cameraEnabled = existing.cameraEnabled;
  }
  return [
    ...previous.filter((entry) => entry.role !== event.role),
    nextState,
  ];
}

export function hasSourceBackedMediaControlEvidence(
  event: RoomMediaControlEvent,
  role?: RoomRole,
): boolean {
  const evidence = event.evidence;
  if (!isRecord(evidence) || !role) return false;
  const actor = role === 'HOST' ? 'host' : 'guest';
  const action = event.enabled ? 'enabled' : 'disabled';
  const controlSurface = 'standard_video_call';
  return event.role === role
    && evidence.source === 'video_room_media_controls'
    && evidence.mediaControlEventSource === 'browser_video_control_button'
    && evidence.actor === actor
    && evidence.control === event.control
    && evidence.previousEnabled === event.previousEnabled
    && evidence.enabled === event.enabled
    && evidence.action === action
    && evidence.controlAction === 'toggle'
    && isRoomSurface(evidence.surface)
    && typeof evidence.roomPhase === 'string'
    && evidence.roomPhase.length > 0
    && evidence.controlSurface === controlSurface
    && evidence.mediaSource === 'local_media_stream'
    && evidence.rawMediaStreamPersisted === false
    && typeof evidence.capturedAtMs === 'number'
    && Number.isInteger(evidence.capturedAtMs)
    && evidence.capturedAtMs >= 0
    && event.id === evidence.mediaControlId
    && evidence.mediaControlId === `media:${actor}:${event.control}:${evidence.capturedAtMs}:${action}`;
}

export function hasSourceBackedMediaControlStateEvidence(state: RoomMediaControlState): boolean {
  const evidence = state.evidence;
  if (!isRecord(evidence)) return false;
  const role = evidence.actor === 'host'
    ? 'HOST'
    : evidence.actor === 'guest'
      ? 'GUEST'
      : null;
  const control = evidence.control;
  const previousEnabled = evidence.previousEnabled;
  const enabled = evidence.enabled;
  if (
    !role
    || (control !== 'microphone' && control !== 'camera')
    || typeof previousEnabled !== 'boolean'
    || typeof enabled !== 'boolean'
  ) {
    return false;
  }
  if (state.role !== role) return false;
  if (control === 'microphone' && state.microphoneEnabled !== enabled) return false;
  if (control === 'camera' && state.cameraEnabled !== enabled) return false;
  return hasSourceBackedMediaControlEvidence({
    id: typeof evidence.mediaControlId === 'string' ? evidence.mediaControlId : 'media-control-state',
    clientId: 'media-control-state-snapshot',
    createdAt: state.updatedAt,
    role,
    control,
    previousEnabled,
    enabled,
    evidence,
  }, role);
}

function isRoomRecordingLifecycleKind(value: unknown): value is RoomRecordingLifecycleKind {
  return value === 'start' || value === 'stop';
}

function isRoomRecordingStatus(value: unknown): value is RoomRecordingStatus {
  return value === 'recording'
    || value === 'uploading'
    || value === 'saved'
    || value === 'failed';
}

function parseRecordingStateEvent(value: unknown): RoomRecordingStateEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt)
    || !isRoomRole(value.role)
    || !isRoomRecordingLifecycleKind(value.lifecycleKind)
    || !isRoomRecordingStatus(value.status)
    || typeof value.active !== 'boolean'
  ) {
    return null;
  }
  if (value.lifecycleKind === 'start' && (value.status !== 'recording' || value.active !== true)) {
    return null;
  }
  if (value.lifecycleKind === 'stop' && (value.status === 'recording' || value.active !== false)) {
    return null;
  }
  return {
    id: value.id,
    clientId: value.clientId,
    createdAt: value.createdAt,
    role: value.role,
    lifecycleKind: value.lifecycleKind,
    status: value.status,
    active: value.active,
    evidence: recordOrUndefined(value.evidence),
  };
}

function parseRecordingState(value: unknown): RoomRecordingState | null {
  if (!isRecord(value)) return null;
  if (
    !isRoomRole(value.role)
    || !isRoomRecordingStatus(value.status)
    || typeof value.active !== 'boolean'
    || typeof value.updatedAt !== 'number'
    || !Number.isFinite(value.updatedAt)
  ) {
    return null;
  }
  return {
    role: value.role,
    status: value.status,
    active: value.active,
    updatedAt: value.updatedAt,
    evidence: recordOrUndefined(value.evidence),
  };
}

function parseRecordingStateSnapshot(value: unknown): { state: RoomRecordingState | null } | null {
  if (!isRecord(value) || !('state' in value)) return null;
  return { state: value.state === null ? null : parseRecordingState(value.state) };
}

export function applyRoomRecordingStateEvent(
  _previous: RoomRecordingState | null,
  event: RoomRecordingStateEvent,
): RoomRecordingState {
  return {
    role: event.role,
    status: event.status,
    active: event.active,
    updatedAt: event.createdAt,
    evidence: event.evidence,
  };
}

export function hasSourceBackedRecordingStateEvidence(
  event: RoomRecordingStateEvent,
  role?: RoomRole,
): boolean {
  if (role !== 'HOST' || event.role !== role) return false;
  const evidence = event.evidence;
  if (!isRecord(evidence)) return false;
  const capturedAtMs = evidence.capturedAtMs;
  const recordingStateEventId = evidence.recordingStateEventId;
  const speakerChannels = evidence.speakerChannels;
  const baseOk = evidence.source === 'video_room_recording'
    && evidence.recordingEventSource === 'browser_media_recorder'
    && evidence.recordingStateEventSource === 'browser_media_recorder_state_sync'
    && evidence.actor === 'host'
    && evidence.recordingLifecycleKind === event.lifecycleKind
    && evidence.recordingStatus === event.status
    && evidence.recordingActive === event.active
    && typeof capturedAtMs === 'number'
    && Number.isInteger(capturedAtMs)
    && capturedAtMs >= 0
    && typeof recordingStateEventId === 'string'
    && RECORDING_STATE_EVENT_ID_RE.test(recordingStateEventId)
    && event.id === recordingStateEventId
    && recordingStateEventId === `recording:host:${capturedAtMs}:${event.lifecycleKind}:${event.status}`
    && isRoomSurface(evidence.surface)
    && typeof evidence.roomPhase === 'string'
    && evidence.roomPhase.length > 0
    && evidence.durableObjectReplayExpected === true
    && typeof evidence.iceProvider === 'string'
    && typeof evidence.hasTranscriptionAudio === 'boolean'
    && typeof evidence.speakerMetadataVersion === 'number'
    && Number.isInteger(evidence.speakerMetadataVersion)
    && typeof evidence.speakerChannelLayout === 'string'
    && typeof evidence.speakerChannelCount === 'number'
    && Number.isInteger(evidence.speakerChannelCount)
    && Array.isArray(speakerChannels)
    && speakerChannels.length === evidence.speakerChannelCount
    && speakerChannels.every((channel) => (
      isRecord(channel)
      && typeof channel.channel === 'number'
      && Number.isInteger(channel.channel)
      && (channel.role === 'host' || channel.role === 'guest')
      && (channel.source === 'local' || channel.source === 'remote')
    ));
  if (!baseOk) return false;
  if (event.lifecycleKind === 'start') return event.status === 'recording' && event.active;
  if (event.status === 'uploading' || event.status === 'saved') {
    const expectedUploadStatus = event.status === 'uploading' ? 'attempting' : 'accepted';
    return evidence.uploadStatus === expectedUploadStatus
      && typeof evidence.recordingBytes === 'number'
      && Number.isFinite(evidence.recordingBytes)
      && evidence.recordingBytes >= 0
      && typeof evidence.recordingMimeType === 'string'
      && evidence.recordingMimeType.length > 0
      && typeof evidence.transcriptionBytes === 'number'
      && Number.isFinite(evidence.transcriptionBytes)
      && evidence.transcriptionBytes >= 0
      && (
        evidence.hasTranscriptionAudio === false
        || (typeof evidence.transcriptionMimeType === 'string' && evidence.transcriptionMimeType.length > 0)
      );
  }
  const recordingBytesOk = evidence.recordingBytes === undefined
    || (typeof evidence.recordingBytes === 'number'
      && Number.isFinite(evidence.recordingBytes)
      && evidence.recordingBytes >= 0);
  const transcriptionBytesOk = evidence.transcriptionBytes === undefined
    || (typeof evidence.transcriptionBytes === 'number'
      && Number.isFinite(evidence.transcriptionBytes)
      && evidence.transcriptionBytes >= 0);
  const recordingMimeTypeOk = evidence.recordingMimeType === undefined
    || (typeof evidence.recordingMimeType === 'string' && evidence.recordingMimeType.length > 0);
  const transcriptionMimeTypeOk = evidence.transcriptionMimeType === undefined
    || (typeof evidence.transcriptionMimeType === 'string' && evidence.transcriptionMimeType.length > 0);
  return event.lifecycleKind === 'stop'
    && event.status === 'failed'
    && !event.active
    && evidence.uploadStatus === 'failed'
    && RECORDING_FAILURE_STAGES.has(String(evidence.recordingFailureStage))
    && RECORDING_FAILURE_SOURCES.has(String(evidence.recordingFailureSource))
    && typeof evidence.recordingFailureMessage === 'string'
    && evidence.recordingFailureMessage.length > 0
    && evidence.recordingFailureMessage.length <= MAX_RECORDING_FAILURE_MESSAGE_LENGTH
    && recordingBytesOk
    && transcriptionBytesOk
    && recordingMimeTypeOk
    && transcriptionMimeTypeOk;
}

export function hasSourceBackedRecordingStateSnapshotEvidence(state: RoomRecordingState): boolean {
  const evidence = state.evidence;
  if (!isRecord(evidence)) return false;
  const lifecycleKind = evidence.recordingLifecycleKind;
  if (!isRoomRecordingLifecycleKind(lifecycleKind)) return false;
  return hasSourceBackedRecordingStateEvidence({
    id: typeof evidence.recordingStateEventId === 'string' ? evidence.recordingStateEventId : 'recording-state-snapshot',
    clientId: 'recording-state-snapshot',
    createdAt: state.updatedAt,
    role: state.role,
    lifecycleKind,
    status: state.status,
    active: state.active,
    evidence,
  }, state.role);
}

function isRoomCodeServerFileEventType(value: unknown): value is RoomCodeServerFileEventType {
  return value === 'code_editor_save' || value === 'file_change';
}

function parseCodeServerFileEvent(value: unknown): RoomCodeServerFileEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt)
    || !isRoomCodeServerFileEventType(value.eventType)
    || value.actor !== 'system'
    || typeof value.text !== 'string'
    || value.text.trim().length === 0
  ) {
    return null;
  }
  return {
    id: value.id,
    clientId: value.clientId,
    createdAt: value.createdAt,
    eventType: value.eventType,
    actor: 'system',
    text: value.text,
    evidence: recordOrUndefined(value.evidence),
  };
}

export function hasSourceBackedCodeServerFileEvidence(event: RoomCodeServerFileEvent): boolean {
  const evidence = event.evidence;
  if (!isRecord(evidence)) return false;
  const codeServerFileChangeId = evidence.codeServerFileChangeId;
  const commonOk = event.actor === 'system'
    && typeof codeServerFileChangeId === 'string'
    && CODE_SERVER_FILE_CHANGE_ID_RE.test(codeServerFileChangeId)
    && event.id === codeServerFileChangeId
    && evidence.source === 'code_server_workspace'
    && evidence.observedBy === 'agent_bridge'
    && evidence.bridgeEventType === 'FILE_CHANGED'
    && evidence.editorSurface === 'code-server'
    && typeof evidence.path === 'string'
    && evidence.path.trim().length > 0
    && event.text === evidence.path
    && typeof evidence.contentHash === 'string'
    && SHA256_HEX_RE.test(evidence.contentHash)
    && typeof evidence.sizeBytes === 'number'
    && Number.isFinite(evidence.sizeBytes)
    && evidence.sizeBytes >= 0
    && typeof evidence.observedAt === 'string'
    && evidence.observedAt.trim().length > 0
    && evidence.bridgePersisted === false
    && isRoomSurface(evidence.surface)
    && typeof evidence.roomPhase === 'string'
    && typeof evidence.workspaceStatus === 'string'
    && typeof evidence.workspaceSessionId === 'string'
    && (evidence.repoUrl === null || typeof evidence.repoUrl === 'string')
    && evidence.durableObjectReplayExpected === true;
  if (!commonOk) return false;
  if (event.eventType === 'code_editor_save') {
    return typeof evidence.action === 'string' && CODE_SERVER_SAVE_ACTIONS.has(evidence.action);
  }
  return evidence.action === 'deleted';
}

function parseTerminalEvent(value: unknown): RoomTerminalEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt)
    || typeof value.text !== 'string'
    || value.text.length === 0
  ) {
    return null;
  }
  if (value.kind === 'COMMAND') {
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'COMMAND',
      text: value.text,
      evidence: recordOrUndefined(value.evidence),
    };
  }
  if (value.kind === 'OUTPUT') {
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'OUTPUT',
      text: value.text,
      evidence: recordOrUndefined(value.evidence),
    };
  }
  return null;
}

export function hasSourceBackedTerminalEvidence(
  event: RoomTerminalEvent,
  role?: RoomRole,
): boolean {
  const evidence = event.evidence;
  if (!isRecord(evidence)) return false;
  const terminalSessionId = typeof evidence.terminalSessionId === 'string'
    && evidence.terminalSessionId.trim().length > 0
    ? evidence.terminalSessionId
    : null;
  const capturedAtMs = typeof evidence.capturedAtMs === 'number'
    && Number.isInteger(evidence.capturedAtMs)
    && evidence.capturedAtMs >= 0
    ? evidence.capturedAtMs
    : null;
  const commonOk = evidence.source === 'container_terminal'
    && evidence.terminalEventSource === 'browser_terminal_ws'
    && terminalSessionId !== null
    && capturedAtMs !== null
    && isRoomSurface(evidence.surface)
    && typeof evidence.roomPhase === 'string'
    && evidence.roomPhase.trim().length > 0
    && typeof evidence.workspaceStatus === 'string'
    && evidence.workspaceStatus.trim().length > 0
    && typeof evidence.workspaceSessionId === 'string'
    && evidence.workspaceSessionId.trim().length > 0
    && (evidence.repoUrl === null || typeof evidence.repoUrl === 'string')
    && evidence.durableObjectReplayExpected === true;
  if (!commonOk) return false;

  if (event.kind === 'COMMAND') {
    const actor = role === 'HOST' ? 'host' : role === 'GUEST' ? 'guest' : evidence.actor;
    const sequence = evidence.terminalCommandSequence;
    const fingerprint = evidence.commandFingerprint;
    const expectedCommandId = `${terminalSessionId}:command:${actor}:${capturedAtMs}:${sequence}:${fingerprint}`;
    return evidence.actor === actor
      && (actor === 'host' || actor === 'guest')
      && typeof sequence === 'number'
      && Number.isInteger(sequence)
      && sequence > 0
      && typeof fingerprint === 'string'
      && TERMINAL_FINGERPRINT_RE.test(fingerprint)
      && evidence.commandLength === event.text.length
      && evidence.terminalCommandId === expectedCommandId
      && event.id === expectedCommandId;
  }

  const sequence = evidence.terminalOutputSequence;
  const fingerprint = evidence.outputFingerprint;
  const commandId = evidence.terminalCommandId;
  const expectedOutputId = `${terminalSessionId}:output:system:${capturedAtMs}:${sequence}:${fingerprint}`;
  return evidence.actor === 'system'
    && typeof sequence === 'number'
    && Number.isInteger(sequence)
    && sequence > 0
    && typeof fingerprint === 'string'
    && TERMINAL_FINGERPRINT_RE.test(fingerprint)
    && evidence.outputLength === event.text.length
    && evidence.terminalOutputChunkId === expectedOutputId
    && event.id === expectedOutputId
    && (
      commandId === null
      || (
        typeof commandId === 'string'
        && commandId.startsWith(`${terminalSessionId}:command:`)
        && TERMINAL_COMMAND_ID_RE.test(commandId)
      )
    );
}

export function mergeRoomChatMessage(
  previous: RoomChatMessage[],
  message: RoomChatMessage,
): RoomChatMessage[] {
  return sortChatMessages([
    ...previous.filter((entry) => entry.id !== message.id),
    message,
  ]);
}

export function applyRoomChatRejection(
  previous: RoomChatMessage[],
  rejection: RoomChatRejection,
): RoomChatMessage[] {
  if (!rejection.clientMessageId) return previous;
  return previous.map((entry) => {
    if (entry.id !== rejection.clientMessageId) return entry;
    return {
      ...entry,
      deliveryStatus: 'rejected',
      evidence: {
        ...(entry.evidence ?? {}),
        deliveryStatus: 'rejected',
        ...(rejection.reason ? { deliveryRejectionReason: rejection.reason } : {}),
      },
    };
  });
}

function sortChatMessages(messages: RoomChatMessage[]): RoomChatMessage[] {
  return [...messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function useRoomConnection(
  token: string,
  role: RoomRole,
  active: boolean,
  options: UseRoomConnectionOptions = {},
): RoomConnection {
  const [phase, setPhase] = useState<RoomPhase>('disconnected');
  const [localStream, setLocalStreamState] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [iceProvider, setIceProvider] = useState<IceServerProvider>('unknown');
  const roomSurface: RoomSurface = 'standard';
  const [agentInteractionEvents, setAgentInteractionEvents] = useState<RoomAgentInteractionEvent[]>([]);
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
  const chatMessagesRef = useRef<RoomChatMessage[]>([]);
  const [mediaControlStates, setMediaControlStates] = useState<RoomMediaControlState[]>([]);
  const [recordingState, setRecordingState] = useState<RoomRecordingState | null>(null);
  const [codeServerFileEvents, setCodeServerFileEvents] = useState<RoomCodeServerFileEvent[]>([]);
  const [terminalEvents, setTerminalEvents] = useState<RoomTerminalEvent[]>([]);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const offerRef = useRef<SdpPayload | null>(null);
  const pendingIceRef = useRef<IceCandidatePayload[]>([]);
  const remoteReadyRef = useRef(false);
  const phaseRef = useRef<RoomPhase>('disconnected');
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const peerDisconnectTimerRef = useRef<number | null>(null);
  const peerRenegotiateTimerRef = useRef<number | null>(null);
  const startingCallRef = useRef(false);
  const startCallRef = useRef<RoomConnection['startCall'] | null>(null);
  const autoStartTimerRef = useRef<number | null>(null);
  const agentInteractionOutboxRef = useRef<RoomAgentInteractionEvent[]>([]);
  const chatOutboxRef = useRef<RoomChatMessage[]>([]);
  const mediaControlOutboxRef = useRef<RoomMediaControlEvent[]>([]);
  const recordingStateOutboxRef = useRef<RoomRecordingStateEvent[]>([]);
  const codeServerFileOutboxRef = useRef<RoomCodeServerFileEvent[]>([]);
  const terminalOutboxRef = useRef<RoomTerminalEvent[]>([]);
  const chatDeliveryEvidenceRef = useRef(options.onChatDeliveryEvidence);
  const roomClientIdRef = useRef(
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `room-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  chatDeliveryEvidenceRef.current = options.onChatDeliveryEvidence;
  chatMessagesRef.current = chatMessages;
  phaseRef.current = phase;

  const setConnectionPhase = useCallback((nextPhase: RoomPhase): void => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  useEffect(() => {
    remoteRef.current = remoteStream;
  }, [remoteStream]);

  const hasOpenSignal = useCallback((): boolean => (
    wsRef.current?.readyState === WebSocket.OPEN
  ), []);

  const send = useCallback((type: string, payload: unknown): boolean => {
    if (!hasOpenSignal()) return false;
    wsRef.current!.send(JSON.stringify({ type, payload }));
    return true;
  }, [hasOpenSignal]);

  const sendStatus = useCallback((status: string): boolean => {
    if (!hasOpenSignal()) return false;
    wsRef.current!.send(JSON.stringify({ type: 'STATUS_UPDATE', status }));
    return true;
  }, [hasOpenSignal]);

  const sendAgentInteractionEvent = useCallback((event: RoomAgentInteractionEvent): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_AGENT_INTERACTION', payload: event }));
    return true;
  }, []);

  const sendChatMessage = useCallback((message: RoomChatMessage): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_CHAT_MESSAGE', payload: message }));
    return true;
  }, []);

  const sendMediaControlEvent = useCallback((event: RoomMediaControlEvent): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_MEDIA_CONTROL', payload: event }));
    return true;
  }, []);

  const sendRecordingStateEvent = useCallback((event: RoomRecordingStateEvent): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_RECORDING_STATE', payload: event }));
    return true;
  }, []);

  const sendCodeServerFileEvent = useCallback((event: RoomCodeServerFileEvent): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_CODE_SERVER_FILE_EVENT', payload: event }));
    return true;
  }, []);

  const sendTerminalEvent = useCallback((event: RoomTerminalEvent): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_TERMINAL_EVENT', payload: event }));
    return true;
  }, []);

  const flushAgentInteractionOutbox = useCallback((): void => {
    if (agentInteractionOutboxRef.current.length === 0) return;
    const pending = agentInteractionOutboxRef.current.splice(0);
    for (const event of pending) {
      if (!sendAgentInteractionEvent(event)) {
        agentInteractionOutboxRef.current.unshift(event, ...pending.slice(pending.indexOf(event) + 1));
        return;
      }
    }
  }, [sendAgentInteractionEvent]);

  const flushChatOutbox = useCallback((): void => {
    if (chatOutboxRef.current.length === 0) return;
    const pending = chatOutboxRef.current.splice(0);
    for (const message of pending) {
      if (!sendChatMessage(message)) {
        chatOutboxRef.current.unshift(message, ...pending.slice(pending.indexOf(message) + 1));
        return;
      }
    }
  }, [sendChatMessage]);

  const flushMediaControlOutbox = useCallback((): void => {
    if (mediaControlOutboxRef.current.length === 0) return;
    const pending = mediaControlOutboxRef.current.splice(0);
    for (const event of pending) {
      if (!sendMediaControlEvent(event)) {
        mediaControlOutboxRef.current.unshift(event, ...pending.slice(pending.indexOf(event) + 1));
        return;
      }
    }
  }, [sendMediaControlEvent]);

  const flushRecordingStateOutbox = useCallback((): void => {
    if (recordingStateOutboxRef.current.length === 0) return;
    const pending = recordingStateOutboxRef.current.splice(0);
    for (const event of pending) {
      if (!sendRecordingStateEvent(event)) {
        recordingStateOutboxRef.current.unshift(event, ...pending.slice(pending.indexOf(event) + 1));
        return;
      }
    }
  }, [sendRecordingStateEvent]);

  const flushCodeServerFileOutbox = useCallback((): void => {
    if (codeServerFileOutboxRef.current.length === 0) return;
    const pending = codeServerFileOutboxRef.current.splice(0);
    for (const event of pending) {
      if (!sendCodeServerFileEvent(event)) {
        codeServerFileOutboxRef.current.unshift(event, ...pending.slice(pending.indexOf(event) + 1));
        return;
      }
    }
  }, [sendCodeServerFileEvent]);

  const flushTerminalOutbox = useCallback((): void => {
    if (terminalOutboxRef.current.length === 0) return;
    const pending = terminalOutboxRef.current.splice(0);
    for (const event of pending) {
      if (!sendTerminalEvent(event)) {
        terminalOutboxRef.current.unshift(event, ...pending.slice(pending.indexOf(event) + 1));
        return;
      }
    }
  }, [sendTerminalEvent]);

  const drainIce = useCallback(async (): Promise<void> => {
    const peer = peerRef.current;
    if (!peer) return;
    for (const candidate of pendingIceRef.current.splice(0)) {
      await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
    }
  }, []);

  const clearPeerDisconnectTimer = useCallback((): void => {
    if (peerDisconnectTimerRef.current !== null) {
      window.clearTimeout(peerDisconnectTimerRef.current);
      peerDisconnectTimerRef.current = null;
    }
  }, []);

  const clearPeerRenegotiateTimer = useCallback((): void => {
    if (peerRenegotiateTimerRef.current !== null) {
      window.clearTimeout(peerRenegotiateTimerRef.current);
      peerRenegotiateTimerRef.current = null;
    }
  }, []);

  const closePeer = useCallback((nextPhase?: RoomPhase): void => {
    clearPeerDisconnectTimer();
    clearPeerRenegotiateTimer();
    const peer = peerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
    }
    peerRef.current = null;
    pendingIceRef.current = [];
    remoteReadyRef.current = false;
    setRemoteStream(null);
    if (nextPhase) {
      setConnectionPhase(nextPhase);
    }
  }, [clearPeerDisconnectTimer, clearPeerRenegotiateTimer, setConnectionPhase]);

  const handleSignalUnavailable = useCallback((): void => {
    if (phaseRef.current === 'ended') return;
    closePeer('peer_disconnected');
  }, [closePeer]);

  const scheduleHostRenegotiation = useCallback((): void => {
    if (role !== 'HOST' || phaseRef.current === 'ended') return;
    if (!localRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;
    if (peerRenegotiateTimerRef.current !== null) return;

    peerRenegotiateTimerRef.current = window.setTimeout(() => {
      peerRenegotiateTimerRef.current = null;
      if (role !== 'HOST' || phaseRef.current === 'ended') return;
      if (!localRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;
      void startCallRef.current?.();
    }, PEER_RENEGOTIATE_DELAY_MS);
  }, [role]);

  const schedulePeerClose = useCallback((
    peer: RTCPeerConnection,
    delayMs: number,
    options: { retryHost?: boolean } = {},
  ): void => {
    if (phaseRef.current === 'ended') return;
    setConnectionPhase('peer_disconnected');
    if (peerDisconnectTimerRef.current !== null) return;
    peerDisconnectTimerRef.current = window.setTimeout(() => {
      peerDisconnectTimerRef.current = null;
      if (peerRef.current !== peer || phaseRef.current === 'ended') return;
      if (peer.connectionState === 'connected') {
        setConnectionPhase('connected');
        return;
      }
      closePeer('peer_disconnected');
      if (options.retryHost) scheduleHostRenegotiation();
    }, delayMs);
  }, [closePeer, scheduleHostRenegotiation, setConnectionPhase]);

  const createPeer = useCallback((iceServers: RTCIceServer[]): RTCPeerConnection => {
    closePeer();
    pendingIceRef.current = [];
    remoteReadyRef.current = false;
    const peer = new RTCPeerConnection(createPeerConfiguration(iceServers));
    peerRef.current = peer;
    addLocalMediaToPeer(peer, localRef.current);
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      send('ICE_CANDIDATE', {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    };
    peer.ontrack = ({ streams }) => {
      if (streams[0]) {
        clearPeerDisconnectTimer();
        setRemoteStream(streams[0]);
        setConnectionPhase('connected');
      }
    };
    peer.onconnectionstatechange = () => {
      if (peerRef.current !== peer) return;
      if (peer.connectionState === 'connected') {
        clearPeerDisconnectTimer();
        setConnectionPhase('connected');
      } else if (peer.connectionState === 'disconnected') {
        schedulePeerClose(peer, PEER_DISCONNECT_GRACE_MS, { retryHost: true });
      } else if (peer.connectionState === 'failed') {
        schedulePeerClose(peer, PEER_FAILED_GRACE_MS, { retryHost: true });
      } else if (peer.connectionState === 'closed' && phaseRef.current !== 'ended') {
        closePeer('peer_disconnected');
      }
    };
    peer.oniceconnectionstatechange = () => {
      if (peerRef.current !== peer) return;
      if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
        clearPeerDisconnectTimer();
        setConnectionPhase('connected');
      } else if (peer.iceConnectionState === 'disconnected') {
        schedulePeerClose(peer, PEER_DISCONNECT_GRACE_MS, { retryHost: true });
      } else if (peer.iceConnectionState === 'failed') {
        schedulePeerClose(peer, PEER_FAILED_GRACE_MS, { retryHost: true });
      } else if (peer.iceConnectionState === 'closed' && phaseRef.current !== 'ended') {
        closePeer('peer_disconnected');
      }
    };
    return peer;
  }, [clearPeerDisconnectTimer, closePeer, schedulePeerClose, send, setConnectionPhase]);

  useEffect(() => {
    if (!active) return undefined;

    let disposed = false;
    const clearReconnect = (): void => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = (): void => {
      if (disposed) return;
      clearReconnect();
      const ws = new WebSocket(roomWebSocketUrl(token));
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        flushAgentInteractionOutbox();
        flushChatOutbox();
        flushMediaControlOutbox();
        flushRecordingStateOutbox();
        flushCodeServerFileOutbox();
        flushTerminalOutbox();
        const peer = peerRef.current;
        if (
          remoteRef.current ||
          peer?.connectionState === 'connected' ||
          peer?.iceConnectionState === 'connected' ||
          peer?.iceConnectionState === 'completed'
        ) {
          clearPeerDisconnectTimer();
          setConnectionPhase('connected');
          sendStatus('ACTIVE');
          return;
        }
        if (phaseRef.current === 'disconnected') {
          setConnectionPhase('waiting');
        } else if (phaseRef.current === 'peer_disconnected' && role === 'HOST') {
          scheduleHostRenegotiation();
        }
      };
      ws.onmessage = (event) => {
        let message: {
          type: string;
          role?: RoomRole;
          status?: string;
          peers?: number;
          reason?: unknown;
          payload?: unknown;
        };
        try {
          message = JSON.parse(event.data as string) as typeof message;
        } catch {
          return;
        }
        if (message.type === 'STATUS_UPDATE') {
          if (message.status === 'ENDED') {
            setConnectionPhase('ended');
          } else if ((message.peers ?? 0) > 1 && !remoteRef.current && phaseRef.current !== 'connected') {
            setConnectionPhase('peer_connected');
          } else if (
            phaseRef.current === 'disconnected' ||
            phaseRef.current === 'error'
          ) {
            setConnectionPhase('waiting');
          }
        } else if (message.type === 'PEER_CONNECTED') {
          const peer = peerRef.current;
          if (role === 'HOST' && message.role !== role && localRef.current) {
            clearPeerDisconnectTimer();
            closePeer('peer_connected');
            scheduleHostRenegotiation();
            return;
          }
          if (peer?.connectionState === 'failed' || peer?.connectionState === 'closed') {
            closePeer('peer_connected');
          } else if (remoteRef.current || peer?.connectionState === 'connected') {
            clearPeerDisconnectTimer();
            setConnectionPhase('connected');
          } else if (phaseRef.current !== 'connected') {
            clearPeerDisconnectTimer();
            setConnectionPhase('peer_connected');
          }
        } else if (message.type === 'PEER_DISCONNECTED') {
          const peer = peerRef.current;
          if (peer && remoteRef.current) {
            schedulePeerClose(peer, PEER_DISCONNECT_GRACE_MS);
          } else {
            closePeer('peer_disconnected');
          }
        } else if (message.type === 'OFFER' && message.role !== role) {
          offerRef.current = message.payload as SdpPayload;
          setIceProvider(offerRef.current.iceProvider ?? 'unknown');
          setConnectionPhase('offer_received');
        } else if (message.type === 'ANSWER' && message.role !== role && peerRef.current) {
          void peerRef.current
            .setRemoteDescription(new RTCSessionDescription(message.payload as SdpPayload))
            .then(async () => {
              remoteReadyRef.current = true;
              await drainIce();
            })
            .catch(() => {
              if (phaseRef.current !== 'ended') closePeer('peer_disconnected');
            });
        } else if (message.type === 'ICE_CANDIDATE' && message.role !== role) {
          const candidate = message.payload as IceCandidatePayload;
          if (!remoteReadyRef.current) pendingIceRef.current.push(candidate);
          else void peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
        } else if (message.type === 'HANGUP') {
          closePeer('ended');
        } else if (message.type === 'ROOM_AGENT_INTERACTION') {
          const event = parseAgentInteractionEvent(message.payload);
          const eventRole = isRoomRole(message.role)
            ? message.role
            : event?.actor === 'guest'
              ? 'GUEST'
              : 'HOST';
          if (
            !event
            || event.clientId === roomClientIdRef.current
            || !hasSourceBackedAgentInteractionEvidence(event, eventRole)
          ) return;
          setAgentInteractionEvents((prev) => [...prev.slice(-199), event]);
        } else if (message.type === 'ROOM_CHAT_MESSAGE') {
          const chatMessage = parseChatMessage(message.payload);
          if (
            !chatMessage
            || chatMessage.clientId === roomClientIdRef.current
            || !hasSourceBackedChatEvidence(chatMessage, isRoomRole(message.role) ? message.role : chatMessage.role)
          ) return;
          setChatMessages((prev) => mergeRoomChatMessage(prev, chatMessage));
        } else if (message.type === 'ROOM_CHAT_MESSAGE_ACK') {
          const chatMessage = parseChatMessage(message.payload);
          if (
            !chatMessage
            || !hasSourceBackedChatEvidence(chatMessage, isRoomRole(message.role) ? message.role : chatMessage.role)
          ) return;
          setChatMessages((prev) => mergeRoomChatMessage(prev, chatMessage));
          chatDeliveryEvidenceRef.current?.(chatMessage);
        } else if (message.type === 'ROOM_CHAT_MESSAGE_REJECTED') {
          const rejection = parseChatRejection(message.payload, message.reason);
          if (!rejection.clientMessageId) return;
          const rejectedMessage = applyRoomChatRejection(
            chatMessagesRef.current,
            rejection,
          ).find((entry) => entry.id === rejection.clientMessageId);
          if (rejectedMessage) {
            chatDeliveryEvidenceRef.current?.(rejectedMessage);
          }
          setChatMessages((prev) => applyRoomChatRejection(prev, rejection));
        } else if (message.type === 'ROOM_CHAT_STATE') {
          const snapshot = parseChatSnapshot(message.payload);
          if (!snapshot) return;
          setChatMessages(sortChatMessages(
            snapshot.messages.filter((entry) => hasSourceBackedChatEvidence(entry, entry.role)),
          ));
        } else if (message.type === 'ROOM_MEDIA_CONTROL') {
          const event = parseMediaControlEvent(message.payload);
          if (
            !event
            || event.clientId === roomClientIdRef.current
            || !hasSourceBackedMediaControlEvidence(event, isRoomRole(message.role) ? message.role : event.role)
          ) return;
          setMediaControlStates((prev) => applyRoomMediaControlEvent(prev, event));
        } else if (message.type === 'ROOM_MEDIA_CONTROL_ACK') {
          const event = parseMediaControlEvent(message.payload);
          if (!event || !hasSourceBackedMediaControlEvidence(event, isRoomRole(message.role) ? message.role : event.role)) return;
          setMediaControlStates((prev) => applyRoomMediaControlEvent(prev, event));
        } else if (message.type === 'ROOM_MEDIA_CONTROL_STATE') {
          const snapshot = parseMediaControlSnapshot(message.payload);
          if (!snapshot) return;
          setMediaControlStates(snapshot.states.filter(hasSourceBackedMediaControlStateEvidence));
        } else if (message.type === 'ROOM_RECORDING_STATE') {
          const event = parseRecordingStateEvent(message.payload);
          if (
            !event
            || event.clientId === roomClientIdRef.current
            || !hasSourceBackedRecordingStateEvidence(event, isRoomRole(message.role) ? message.role : event.role)
          ) return;
          setRecordingState((prev) => applyRoomRecordingStateEvent(prev, event));
        } else if (message.type === 'ROOM_RECORDING_STATE_ACK') {
          const event = parseRecordingStateEvent(message.payload);
          if (!event || !hasSourceBackedRecordingStateEvidence(event, isRoomRole(message.role) ? message.role : event.role)) return;
          setRecordingState((prev) => applyRoomRecordingStateEvent(prev, event));
        } else if (message.type === 'ROOM_RECORDING_STATE_SNAPSHOT') {
          const snapshot = parseRecordingStateSnapshot(message.payload);
          if (!snapshot) return;
          if (snapshot.state === null) {
            setRecordingState(null);
            return;
          }
          if (!hasSourceBackedRecordingStateSnapshotEvidence(snapshot.state)) return;
          setRecordingState(snapshot.state);
        } else if (message.type === 'ROOM_CODE_SERVER_FILE_EVENT') {
          const event = parseCodeServerFileEvent(message.payload);
          if (
            !event
            || event.clientId === roomClientIdRef.current
            || !hasSourceBackedCodeServerFileEvidence(event)
          ) return;
          setCodeServerFileEvents((prev) => [...prev.slice(-199), event]);
        } else if (message.type === 'ROOM_TERMINAL_EVENT') {
          const terminalEvent = parseTerminalEvent(message.payload);
          if (
            !terminalEvent
            || terminalEvent.clientId === roomClientIdRef.current
            || !hasSourceBackedTerminalEvidence(
              terminalEvent,
              isRoomRole(message.role) ? message.role : undefined,
            )
          ) return;
          setTerminalEvents((prev) => [...prev.slice(-199), terminalEvent]);
        }
      };
      ws.onerror = () => {
        if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
          ws.close();
        }
      };
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        if (disposed || phaseRef.current === 'ended') return;
        reconnectAttemptRef.current += 1;
        const delayMs = Math.min(500 * 2 ** Math.min(reconnectAttemptRef.current - 1, 4), 5000);
        const nextPhase = phaseRef.current === 'connected'
          ? 'peer_disconnected'
          : 'disconnected';
        setConnectionPhase(nextPhase);
        reconnectTimerRef.current = window.setTimeout(connect, delayMs);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearReconnect();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [
    active,
    clearPeerDisconnectTimer,
    closePeer,
    drainIce,
    flushAgentInteractionOutbox,
    flushChatOutbox,
    flushCodeServerFileOutbox,
    flushMediaControlOutbox,
    flushRecordingStateOutbox,
    flushTerminalOutbox,
    role,
    scheduleHostRenegotiation,
    schedulePeerClose,
    sendStatus,
    setConnectionPhase,
    token,
  ]);

  useEffect(() => () => {
    if (peerDisconnectTimerRef.current !== null) {
      window.clearTimeout(peerDisconnectTimerRef.current);
      peerDisconnectTimerRef.current = null;
    }
    if (autoStartTimerRef.current !== null) {
      window.clearTimeout(autoStartTimerRef.current);
      autoStartTimerRef.current = null;
    }
    clearPeerRenegotiateTimer();
    const peer = peerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
    }
    localRef.current?.getTracks().forEach((track) => track.stop());
  }, [clearPeerRenegotiateTimer]);

  const setLocalStream = useCallback((stream: MediaStream): void => {
    localRef.current = stream;
    setLocalStreamState(stream);
    setMicEnabled(stream.getAudioTracks().some((track) => track.enabled));
    setCameraEnabled(stream.getVideoTracks().some((track) => track.enabled));
  }, []);

  const startCall = useCallback(async (): Promise<void> => {
    if (role !== 'HOST') return;
    if (startingCallRef.current) return;
    startingCallRef.current = true;
    setConnectionPhase('connecting');
    try {
      if (!localRef.current || !hasOpenSignal()) {
        handleSignalUnavailable();
        return;
      }
      const config = await getIceServerConfig(token).catch(() => ({
        iceServers: FALLBACK_ICE,
        provider: 'fallback' as const,
      }));
      if (!localRef.current || !hasOpenSignal()) {
        handleSignalUnavailable();
        return;
      }
      setIceProvider(config.provider);
      const peer = createPeer(config.iceServers);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const offered = send('OFFER', {
        type: offer.type,
        sdp: offer.sdp,
        iceServers: config.iceServers,
        iceProvider: config.provider,
      });
      if (!offered) {
        handleSignalUnavailable();
        return;
      }
      sendStatus('CALLING');
    } catch {
      closePeer('error');
    } finally {
      startingCallRef.current = false;
    }
  }, [
    closePeer,
    createPeer,
    handleSignalUnavailable,
    hasOpenSignal,
    role,
    send,
    sendStatus,
    setConnectionPhase,
    token,
  ]);
  startCallRef.current = startCall;

  const acceptCall = useCallback(async (): Promise<void> => {
    const offer = offerRef.current;
    if (role !== 'GUEST' || !offer) return;
    setConnectionPhase('connecting');
    setIceProvider(offer.iceProvider ?? 'unknown');
    try {
      if (!localRef.current || !hasOpenSignal()) {
        handleSignalUnavailable();
        return;
      }
      const peer = createPeer(offer.iceServers ?? FALLBACK_ICE);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      remoteReadyRef.current = true;
      await drainIce();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const answered = send('ANSWER', { type: answer.type, sdp: answer.sdp });
      if (!answered) {
        handleSignalUnavailable();
        return;
      }
      sendStatus('ACTIVE');
    } catch {
      closePeer('error');
    }
  }, [
    closePeer,
    createPeer,
    drainIce,
    handleSignalUnavailable,
    hasOpenSignal,
    role,
    send,
    sendStatus,
    setConnectionPhase,
  ]);

  const retryConnection = useCallback((): void => {
    if (phaseRef.current === 'ended') return;
    clearPeerRenegotiateTimer();
    clearPeerDisconnectTimer();
    if (role === 'HOST') {
      closePeer('connecting');
      void startCallRef.current?.();
      return;
    }
    if (offerRef.current) {
      closePeer('offer_received');
      void acceptCall();
      return;
    }
    closePeer('waiting');
  }, [
    acceptCall,
    clearPeerDisconnectTimer,
    clearPeerRenegotiateTimer,
    closePeer,
    role,
  ]);

  const hangUp = useCallback((): void => {
    setConnectionPhase('ended');
    if (autoStartTimerRef.current !== null) {
      window.clearTimeout(autoStartTimerRef.current);
      autoStartTimerRef.current = null;
    }
    clearPeerRenegotiateTimer();
    if (role === 'HOST') {
      send('HANGUP', {});
      sendStatus('ENDED');
    } else {
      sendStatus('LEFT');
    }
    closePeer('ended');
  }, [clearPeerRenegotiateTimer, closePeer, role, send, sendStatus, setConnectionPhase]);

  const toggleCamera = useCallback((): void => {
    const tracks = localRef.current?.getVideoTracks() ?? [];
    if (tracks.length === 0) {
      setCameraEnabled(false);
      return;
    }
    tracks.forEach((track) => {
      track.enabled = !track.enabled;
    });
    setCameraEnabled((value) => !value);
  }, []);

  const toggleMic = useCallback((): void => {
    const tracks = localRef.current?.getAudioTracks() ?? [];
    if (tracks.length === 0) {
      setMicEnabled(false);
      return;
    }
    tracks.forEach((track) => {
      track.enabled = !track.enabled;
    });
    setMicEnabled((value) => !value);
  }, []);

  const publishAgentInteractionEvent = useCallback((draft: RoomAgentInteractionEventDraft): void => {
    if (!draft.text.trim()) return;
    const createdAt = Date.now();
    const event: RoomAgentInteractionEvent = {
      ...draft,
      id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `agent-interaction-${createdAt}-${Math.random().toString(36).slice(2)}`,
      clientId: roomClientIdRef.current,
      createdAt,
    };
    if (!hasSourceBackedAgentInteractionEvidence(event, role)) {
      console.error('[publishAgentInteractionEvent] rejected interaction without source-backed evidence:', {
        role,
        eventType: event.eventType,
        actor: event.actor,
        source: event.evidence?.source,
      });
      return;
    }
    setAgentInteractionEvents((prev) => [...prev.slice(-199), event]);
    if (!sendAgentInteractionEvent(event)) {
      agentInteractionOutboxRef.current.push(event);
    }
  }, [role, sendAgentInteractionEvent]);

  const publishChatMessage = useCallback((text: string): RoomChatMessage | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const id = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = Date.now();
    const message: RoomChatMessage = {
      id,
      clientId: roomClientIdRef.current,
      createdAt,
      role,
      text: trimmed,
      deliveryStatus: 'pending',
      evidence: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_panel',
        actor: role === 'HOST' ? 'host' : 'guest',
        roomMessageId: id,
        clientId: roomClientIdRef.current,
        messageCreatedAt: createdAt,
        messageLength: trimmed.length,
        messageFingerprint: roomChatMessageFingerprint(trimmed),
        deliveryStatus: 'pending',
        surface: roomSurface,
        roomPhase: phaseRef.current,
        durableObjectReplayExpected: true,
      },
    };
    if (!hasSourceBackedChatEvidence(message, role, 'pending')) {
      console.error('[useRoomConnection] refused source-thin chat message:', {
        role,
        messageId: message.id,
      });
      return null;
    }
    setChatMessages((prev) => mergeRoomChatMessage(prev, message));
    if (!sendChatMessage(message)) {
      chatOutboxRef.current.push(message);
    }
    return message;
  }, [role, roomSurface, sendChatMessage]);

  const publishMediaControlEvent = useCallback((draft: RoomMediaControlEventDraft): void => {
    const createdAt = Date.now();
    const evidenceMediaControlId = typeof draft.evidence?.mediaControlId === 'string'
      ? draft.evidence.mediaControlId
      : null;
    const event: RoomMediaControlEvent = {
      ...draft,
      id: evidenceMediaControlId ?? (typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `media-${createdAt}-${Math.random().toString(36).slice(2)}`),
      clientId: roomClientIdRef.current,
      createdAt,
      role,
    };
    if (!hasSourceBackedMediaControlEvidence(event, role)) {
      console.error('[publishMediaControlEvent] rejected media control event without source-backed evidence:', {
        control: event.control,
        role,
        source: event.evidence?.source,
      });
      return;
    }
    setMediaControlStates((prev) => applyRoomMediaControlEvent(prev, event));
    if (!sendMediaControlEvent(event)) {
      mediaControlOutboxRef.current.push(event);
    }
  }, [role, sendMediaControlEvent]);

  const publishRecordingStateEvent = useCallback((draft: RoomRecordingStateEventDraft): void => {
    if (role !== 'HOST') return;
    const createdAt = Date.now();
    const evidenceRecordingStateEventId = typeof draft.evidence?.recordingStateEventId === 'string'
      ? draft.evidence.recordingStateEventId
      : null;
    const event: RoomRecordingStateEvent = {
      ...draft,
      id: evidenceRecordingStateEventId ?? (typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `recording-${createdAt}-${Math.random().toString(36).slice(2)}`),
      clientId: roomClientIdRef.current,
      createdAt,
      role,
    };
    if (!hasSourceBackedRecordingStateEvidence(event, role)) {
      console.error('[publishRecordingStateEvent] rejected recording state event without source-backed evidence:', {
        lifecycleKind: event.lifecycleKind,
        status: event.status,
        role,
        source: event.evidence?.source,
      });
      return;
    }
    setRecordingState((prev) => applyRoomRecordingStateEvent(prev, event));
    if (!sendRecordingStateEvent(event)) {
      recordingStateOutboxRef.current.push(event);
    }
  }, [role, sendRecordingStateEvent]);

  const publishCodeServerFileEvent = useCallback((draft: RoomCodeServerFileEventDraft): void => {
    if (!draft.text.trim()) return;
    const createdAt = Date.now();
    const codeServerFileChangeId = isRecord(draft.evidence) && typeof draft.evidence.codeServerFileChangeId === 'string'
      ? draft.evidence.codeServerFileChangeId
      : null;
    const event: RoomCodeServerFileEvent = {
      ...draft,
      id: codeServerFileChangeId ?? (typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `code-file-${createdAt}-${Math.random().toString(36).slice(2)}`),
      clientId: roomClientIdRef.current,
      createdAt,
    };
    if (!hasSourceBackedCodeServerFileEvidence(event)) {
      console.error('[publishCodeServerFileEvent] rejected code-server file event without source-backed evidence:', {
        eventType: event.eventType,
        path: event.text,
        source: event.evidence?.source,
      });
      return;
    }
    setCodeServerFileEvents((prev) => [...prev.slice(-199), event]);
    if (!sendCodeServerFileEvent(event)) {
      codeServerFileOutboxRef.current.push(event);
    }
  }, [sendCodeServerFileEvent]);

  const publishTerminalEvent = useCallback((draft: RoomTerminalEventDraft): void => {
    if (draft.text.length === 0) return;
    const createdAt = Date.now();
    const sourceBackedTerminalEventId = isRecord(draft.evidence)
      ? draft.kind === 'COMMAND' && typeof draft.evidence.terminalCommandId === 'string'
        ? draft.evidence.terminalCommandId
        : draft.kind === 'OUTPUT' && typeof draft.evidence.terminalOutputChunkId === 'string'
          ? draft.evidence.terminalOutputChunkId
          : null
      : null;
    const event: RoomTerminalEvent = {
      ...draft,
      id: sourceBackedTerminalEventId ?? (typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `terminal-${createdAt}-${Math.random().toString(36).slice(2)}`),
      clientId: roomClientIdRef.current,
      createdAt,
    };
    if (!hasSourceBackedTerminalEvidence(event, role)) {
      console.error('[publishTerminalEvent] rejected terminal event without source-backed evidence:', {
        kind: event.kind,
        actor: role,
        source: event.evidence?.source,
      });
      return;
    }
    setTerminalEvents((prev) => [...prev.slice(-199), event]);
    if (!sendTerminalEvent(event)) {
      terminalOutboxRef.current.push(event);
    }
  }, [role, sendTerminalEvent]);

  useEffect(() => {
    if (
      !active ||
      role !== 'HOST' ||
      !localStream ||
      phase !== 'peer_connected' ||
      startingCallRef.current ||
      autoStartTimerRef.current !== null ||
      peerRenegotiateTimerRef.current !== null
    ) {
      return undefined;
    }

    autoStartTimerRef.current = window.setTimeout(() => {
      autoStartTimerRef.current = null;
      if (phaseRef.current === 'peer_connected' && localRef.current) {
        void startCall();
      }
    }, 350);

    return () => {
      if (autoStartTimerRef.current !== null) {
        window.clearTimeout(autoStartTimerRef.current);
        autoStartTimerRef.current = null;
      }
    };
  }, [active, localStream, phase, role, startCall]);

  return {
    phase,
    localStream,
    remoteStream,
    iceProvider,
    roomSurface,
    agentInteractionEvents,
    chatMessages,
    mediaControlStates,
    recordingState,
    codeServerFileEvents,
    terminalEvents,
    cameraEnabled,
    micEnabled,
    hasLocalCamera: Boolean(localStream?.getVideoTracks().length),
    hasLocalMicrophone: Boolean(localStream?.getAudioTracks().length),
    setLocalStream,
    startCall,
    acceptCall,
    hangUp,
    toggleCamera,
    toggleMic,
    retryConnection,
    publishAgentInteractionEvent,
    publishChatMessage,
    publishMediaControlEvent,
    publishRecordingStateEvent,
    publishCodeServerFileEvent,
    publishTerminalEvent,
  };
}
