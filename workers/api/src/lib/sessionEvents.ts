/**
 * sessionEvents.ts — Capture meeting session events as source-backed evidence.
 *
 * Every source-backed event during a meeting (AI chat, terminal I/O, file changes,
 * workspace state, media, recording, and editor activity) is preserved as both the legacy
 * candidate_node compatibility projection and a first-class
 * meeting_session_event context_record for the evidence hypergraph.
 *
 * The agent (Devin) can query this brain via the /context endpoint
 * on the agent bridge, giving it full context about the person
 * it's pair-programming with.
 */

import type { CandidateNode } from '../types';
import { insertCandidateNode } from './candidateDiscovery/candidateNodes';
import {
  deterministicEntityId,
  ensureCandidateLivingContext,
  LivingContextStore,
  stableJson,
  type ContextRecordEntityInput,
  type ContextRecordSourceInput,
  type JsonObject,
  type JsonValue,
} from './livingContext';
import { writeCandidateGraphFireAndForget } from './neo4j/writeCandidateGraph';
import {
  AssessmentLayerStore,
  type AssessmentActorType,
  type AssessmentEvidenceSourceRefInput,
  type AssessmentSessionState,
} from './assessmentLayer/persistence';

export type SessionEventType =
  | 'chat_message'
  | 'ai_chat_user'
  | 'ai_chat_agent'
  | 'ai_agent_status'
  | 'terminal_command'
  | 'terminal_output'
  | 'file_change'
  | 'media_control'
  | 'workspace_state'
  | 'participant_join'
  | 'participant_leave'
  | 'recording_start'
  | 'recording_stop'
  | 'code_editor_open'
  | 'code_editor_save';

export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  candidateId: string;
  timestamp: number;
  actor: 'host' | 'guest' | 'agent' | 'system';
  text: string;
  properties?: Record<string, unknown>;
}

type RoomActivityRole = 'RECRUITER' | 'CANDIDATE' | 'HOST' | 'GUEST';
const WORKSPACE_STATE_SOURCES = new Set(['initial_load', 'launch', 'refresh', 'error']);
const TERMINAL_FINGERPRINT_RE = /^terminal_[a-f0-9]{8}$/;
const TERMINAL_COMMAND_ID_RE = /^.+:command:(host|guest):\d+:\d+:terminal_[a-f0-9]{8}$/;
const AGENT_PROMPT_FINGERPRINT_RE = /^agent_[a-f0-9]{8}$/;
const BROWSER_PROMPT_ID_RE = /^[a-zA-Z0-9:_-]+:(host|guest):prompt:\d+:agent_[a-f0-9]{8}$/;
const AGENT_CHAT_RESPONSE_FINGERPRINT_RE = /^agent_[a-f0-9]{8}$/;
const AGENT_CHAT_RESPONSE_ID_RE = /^agent-chat:[a-zA-Z0-9:_-]+:\d+:CHAT_RESPONSE:agent_[a-f0-9]{8}$/;
const AGENT_STATUS_EVENT_ID_RE = /^agent-status:[a-zA-Z0-9:_-]+:\d+:[a-z_]+:[a-zA-Z0-9:_-]+:[a-zA-Z0-9:_-]+$/;
const AGENT_STATUSES = new Set(['starting', 'idle', 'thinking', 'working', 'auth_needed', 'disconnected']);
const AGENT_STATUS_MESSAGE_SOURCES = new Set(['agent_status', 'agent_stdout', 'agent_api_response', 'bridge_diagnostic', 'bridge_observation']);
const CHAT_DELIVERY_STATUSES = new Set(['pending', 'accepted', 'rejected']);
const AGENT_PROMPT_BLOCKED_REASONS = new Set([
  'workspace_required',
  'bridge_reconnecting',
  'agent_starting',
  'agent_auth_needed',
  'agent_disconnected',
  'agent_identity_missing',
  'agent_capabilities_missing',
]);
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const CODE_SERVER_SAVE_ACTIONS = new Set(['created', 'modified', 'saved', 'renamed']);
const CODE_SERVER_FILE_CHANGE_ID_RE = /^code-server-file:[a-zA-Z0-9:_-]+:\d+:[a-zA-Z0-9:_-]+:path_[0-9a-f]{8}:[a-f0-9]{16}$/;
const MEDIA_CONTROL_ID_RE = /^media:(host|guest):(microphone|camera):\d+:(enabled|disabled)$/;
const RECORDING_STATE_EVENT_ID_RE = /^recording:host:\d+:(start|stop):(recording|uploading|saved|failed)$/;
const RECORDING_FAILURE_STAGES = new Set(['stop_recorder', 'prepare_upload', 'upload_request']);
const RECORDING_FAILURE_SOURCES = new Set([
  'browser_media_recorder_exception',
  'browser_blob_builder_exception',
  'recording_upload_exception',
]);
const MAX_RECORDING_FAILURE_MESSAGE_LENGTH = 240;
const CODE_EDITOR_OPEN_ID_RE = /^code-editor-open:(host|guest):\d+:[a-zA-Z0-9:_-]+$/;
const AGENT_DIAGNOSTIC_REDACTED_SECRET = '[REDACTED_SECRET]';
const AGENT_BARE_SECRET_RE = /\b(?:cog|ghp|gho|ghu|ghs|ghr|devin)_[A-Za-z0-9_-]{20,}\b/g;
const AGENT_GITHUB_PAT_RE = /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g;
const AGENT_OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const AGENT_BEARER_TOKEN_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const AGENT_ENV_SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_]*(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD))=([^\s"'`]+)/gi;
const AGENT_SECRET_QUERY_RE = /([?&](?:api_key|key|token|secret|password)=)[^&\s]+/gi;
const AGENT_ROOM_TOKEN_PATH_RE = /(\/api\/v1\/meeting-rooms\/)[^/\s?]+/g;

interface RoomActivitySyncEnv {
  VIDEO_ROOM?: DurableObjectNamespace;
  NEO4J_URI?: string;
  NEO4J_USER?: string;
  NEO4J_PASSWORD?: string;
}

interface RoomActivitySyncInput {
  candidateId: string;
  sessionId: string;
  assessmentInterviewId?: string | null;
}

interface RoomActivitySyncResult {
  captured: number;
  failed: number;
  events: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unitNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function isRoomActivityRole(value: unknown): value is RoomActivityRole {
  return value === 'RECRUITER' || value === 'CANDIDATE' || value === 'HOST' || value === 'GUEST';
}

function actorFromRoomRole(value: unknown): SessionEvent['actor'] {
  if (value === 'HOST' || value === 'RECRUITER') return 'host';
  if (value === 'GUEST' || value === 'CANDIDATE') return 'guest';
  return 'system';
}

function isHostRoomRole(value: unknown): boolean {
  return value === 'HOST' || value === 'RECRUITER';
}

function unixTimestampFromActivity(primary: unknown, fallback: unknown): number {
  const value = numberOrNull(primary) ?? numberOrNull(fallback) ?? Date.now();
  return Math.floor(value > 10_000_000_000 ? value / 1000 : value);
}

function redactAgentDiagnosticText(value: string, maxLength = 8000): string | null {
  if (!value.trim()) return null;
  const redacted = value
    .replace(AGENT_BARE_SECRET_RE, AGENT_DIAGNOSTIC_REDACTED_SECRET)
    .replace(AGENT_GITHUB_PAT_RE, AGENT_DIAGNOSTIC_REDACTED_SECRET)
    .replace(AGENT_OPENAI_KEY_RE, AGENT_DIAGNOSTIC_REDACTED_SECRET)
    .replace(AGENT_BEARER_TOKEN_RE, (_match, prefix: string) => `${prefix}${AGENT_DIAGNOSTIC_REDACTED_SECRET}`)
    .replace(AGENT_ENV_SECRET_ASSIGNMENT_RE, (_match, name: string) => `${name}=${AGENT_DIAGNOSTIC_REDACTED_SECRET}`)
    .replace(AGENT_SECRET_QUERY_RE, (_match, prefix: string) => `${prefix}${AGENT_DIAGNOSTIC_REDACTED_SECRET}`)
    .replace(AGENT_ROOM_TOKEN_PATH_RE, (_match, prefix: string) => `${prefix}${AGENT_DIAGNOSTIC_REDACTED_SECRET}`);
  return redacted.length > maxLength ? redacted.slice(0, maxLength) : redacted;
}

function sanitizedAgentBridgeSessionEvent(event: SessionEvent): SessionEvent | null {
  if (event.type !== 'ai_chat_agent' && event.type !== 'ai_agent_status') return event;
  const redactedText = redactAgentDiagnosticText(event.text);
  if (!redactedText) return null;
  if (event.type === 'ai_chat_agent' && redactedText !== event.text) return null;
  return redactedText === event.text ? event : { ...event, text: redactedText };
}

function safeEvidenceIdPart(value: unknown): string {
  const raw = typeof value === 'string' ? value : 'none';
  const normalized = raw
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'none';
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
    && promptLength > 0
    && promptId.endsWith(`:${promptTimestamp}:${promptFingerprint}`);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
  ).bind(tableName).first<{ name: string }>();
  return Boolean(row);
}

function roomActivityBaseProperties(
  kind: string,
  role: unknown,
  recordedAt: unknown,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    roomActivitySource: 'durable_object',
    roomActivityKind: kind,
  };
  if (isRoomActivityRole(role)) properties.roomRole = role;
  const recordedAtNumber = numberOrNull(recordedAt);
  if (recordedAtNumber !== null) properties.recordedAt = recordedAtNumber;
  return properties;
}

function createSessionEvent(
  input: RoomActivitySyncInput,
  event: {
    type: SessionEventType;
    timestamp: number;
    actor: SessionEvent['actor'];
    text: string;
    properties?: Record<string, unknown>;
  },
): SessionEvent {
  const properties = {
    ...(event.properties ?? {}),
    ...(input.assessmentInterviewId ? { scheduledInterviewId: input.assessmentInterviewId } : {}),
  };
  return {
    type: event.type,
    sessionId: input.sessionId,
    candidateId: input.candidateId,
    timestamp: event.timestamp,
    actor: event.actor,
    text: event.text,
    properties,
  };
}

function hasSourceBackedWorkspaceStateEvidence(
  event: Record<string, unknown>,
  actor: SessionEvent['actor'],
  status: string,
): boolean {
  const source = stringOrNull(event.source);
  const workspaceEventSource = stringOrNull(event.workspaceEventSource);
  const workspaceStateSource = stringOrNull(event.workspaceStateSource);
  const workspaceStateEventId = stringOrNull(event.workspaceStateEventId);
  const capturedAtMs = numberOrNull(event.capturedAtMs);
  const workspaceSessionId = stringOrNull(event.workspaceSessionId);
  const stateIdSession = workspaceSessionId ?? 'no-session';
  return (actor === 'host' || actor === 'guest')
    && event.actor === actor
    && source === 'browser_workspace_state_observer'
    && workspaceEventSource === 'browser_workspace_state_observer'
    && workspaceStateSource !== null
    && WORKSPACE_STATE_SOURCES.has(workspaceStateSource)
    && capturedAtMs !== null
    && Number.isInteger(capturedAtMs)
    && capturedAtMs >= 0
    && workspaceStateEventId === `workspace-state:${actor}:${capturedAtMs}:${workspaceStateSource}:${stateIdSession}:${status}`
    && (status === 'ERROR' || workspaceSessionId !== null)
    && event.workspaceTelemetryPersisted === true
    && event.proxyUrlPersisted === false;
}

function chatActivityToSessionEvent(input: RoomActivitySyncInput, value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isRecord(value.message)) return null;
  const message = value.message;
  const evidence = isRecord(message.evidence) ? message.evidence : null;
  if (!evidence) return null;
  const role = isRoomActivityRole(value.role)
    ? value.role
    : isRoomActivityRole(message.role)
      ? message.role
      : null;
  const text = stringOrNull(message.text);
  if (!text) return null;
  const actor = actorFromRoomRole(role);
  if (!isSourceBackedChatEvidence(message, evidence, actor, text)) return null;
  const properties = {
    ...roomActivityBaseProperties('chat', role, value.recordedAt),
    ...evidence,
  };
  const messageId = stringOrNull(message.id);
  const clientId = stringOrNull(message.clientId);
  if (messageId) properties.roomMessageId = messageId;
  if (clientId) properties.clientId = clientId;
  properties.messageCreatedAt = numberOrNull(message.createdAt) ?? properties.messageCreatedAt;
  properties.messageLength = text.length;
  if (message.deliveryStatus === 'pending' || message.deliveryStatus === 'accepted' || message.deliveryStatus === 'rejected') {
    properties.deliveryStatus = message.deliveryStatus;
  }
  return createSessionEvent(input, {
    type: 'chat_message',
    timestamp: unixTimestampFromActivity(message.createdAt, value.recordedAt),
    actor,
    text,
    properties,
  });
}

function isSourceBackedChatEvidence(
  message: Record<string, unknown>,
  evidence: Record<string, unknown>,
  actor: SessionEvent['actor'],
  text: string,
): boolean {
  if (actor !== 'host' && actor !== 'guest') return false;
  const messageId = stringOrNull(message.id);
  const clientId = stringOrNull(message.clientId);
  const createdAt = numberOrNull(message.createdAt);
  const messageDeliveryStatus = stringOrNull(message.deliveryStatus);
  const evidenceDeliveryStatus = stringOrNull(evidence.deliveryStatus);
  if (
    !messageId
    || !clientId
    || createdAt === null
    || !messageDeliveryStatus
    || !CHAT_DELIVERY_STATUSES.has(messageDeliveryStatus)
  ) {
    return false;
  }
  return evidence.source === 'room_chat_client_submit'
    && evidence.chatEventSource === 'browser_room_chat_panel'
    && evidence.actor === actor
    && evidence.roomMessageId === messageId
    && evidence.clientId === clientId
    && evidence.messageCreatedAt === createdAt
    && evidence.messageLength === text.length
    && evidenceDeliveryStatus === messageDeliveryStatus
    && CHAT_DELIVERY_STATUSES.has(evidenceDeliveryStatus)
    && evidence.surface === 'standard'
    && stringOrNull(evidence.roomPhase) !== null
    && evidence.durableObjectReplayExpected === true;
}

function mediaControlText(actor: SessionEvent['actor'], control: string, enabled: boolean): string {
  const actorLabel = actor === 'host' ? 'Host' : 'Guest';
  const nextState = enabled ? 'on' : 'off';
  return `${actorLabel} turned ${control} ${nextState}`;
}

function isSourceBackedMediaControlEvidence(
  evidence: Record<string, unknown> | null,
  actor: SessionEvent['actor'],
  control: unknown,
  previousEnabled: unknown,
  enabled: unknown,
): evidence is Record<string, unknown> {
  if (evidence === null) return false;
  if (actor !== 'host' && actor !== 'guest') return false;
  if (control !== 'microphone' && control !== 'camera') return false;
  if (typeof previousEnabled !== 'boolean' || typeof enabled !== 'boolean' || previousEnabled === enabled) {
    return false;
  }
  const action = enabled ? 'enabled' : 'disabled';
  const capturedAtMs = numberOrNull(evidence.capturedAtMs);
  const mediaControlId = stringOrNull(evidence.mediaControlId);
  const expectedControlSurface = 'standard_video_call';
  return evidence.source === 'video_room_media_controls'
    && evidence.mediaControlEventSource === 'browser_video_control_button'
    && evidence.actor === actor
    && evidence.control === control
    && evidence.previousEnabled === previousEnabled
    && evidence.enabled === enabled
    && evidence.action === action
    && evidence.controlAction === 'toggle'
    && evidence.surface === 'standard'
    && stringOrNull(evidence.roomPhase) !== null
    && evidence.controlSurface === expectedControlSurface
    && evidence.mediaSource === 'local_media_stream'
    && evidence.rawMediaStreamPersisted === false
    && capturedAtMs !== null
    && Number.isInteger(capturedAtMs)
    && capturedAtMs >= 0
    && mediaControlId !== null
    && MEDIA_CONTROL_ID_RE.test(mediaControlId)
    && mediaControlId === `media:${actor}:${control}:${capturedAtMs}:${action}`;
}

function mediaControlActivityToSessionEvent(input: RoomActivitySyncInput, value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isRecord(value.event)) return null;
  const event = value.event;
  const role = isRoomActivityRole(value.role)
    ? value.role
    : isRoomActivityRole(event.role)
      ? event.role
      : null;
  if (!role) return null;
  if (isRoomActivityRole(event.role) && event.role !== role) return null;
  const actor = actorFromRoomRole(role);
  const control = stringOrNull(event.control);
  if (control !== 'microphone' && control !== 'camera') return null;
  const previousEnabled = typeof event.previousEnabled === 'boolean' ? event.previousEnabled : null;
  const enabled = typeof event.enabled === 'boolean' ? event.enabled : null;
  if (previousEnabled === null || enabled === null) return null;
  const evidence = isRecord(event.evidence) ? event.evidence : null;
  if (!isSourceBackedMediaControlEvidence(evidence, actor, control, previousEnabled, enabled)) return null;
  const properties = {
    ...roomActivityBaseProperties('media_control', role, value.recordedAt),
    ...evidence,
  };
  const eventId = stringOrNull(event.id);
  const clientId = stringOrNull(event.clientId);
  if (eventId) properties.roomEventId = eventId;
  if (clientId) properties.clientId = clientId;
  return createSessionEvent(input, {
    type: 'media_control',
    timestamp: unixTimestampFromActivity(event.createdAt, value.recordedAt),
    actor,
    text: mediaControlText(actor, control, enabled),
    properties,
  });
}

function isRecordingStateStatus(value: unknown): value is 'recording' | 'uploading' | 'saved' | 'failed' {
  return value === 'recording'
    || value === 'uploading'
    || value === 'saved'
    || value === 'failed';
}

function recordingStateText(lifecycleKind: 'start' | 'stop', status: string): string {
  if (lifecycleKind === 'start') return 'Recording started';
  if (status === 'saved') return 'Recording saved';
  if (status === 'failed') return 'Recording save failed';
  return 'Recording stopped';
}

function isSourceBackedRecordingStateEvidence(
  evidence: Record<string, unknown> | null,
  lifecycleKind: 'start' | 'stop',
  status: 'recording' | 'uploading' | 'saved' | 'failed',
  active: boolean,
): evidence is Record<string, unknown> {
  if (evidence === null) return false;
  const capturedAtMs = numberOrNull(evidence.capturedAtMs);
  const recordingStateEventId = stringOrNull(evidence.recordingStateEventId);
  const speakerChannels = Array.isArray(evidence.speakerChannels) ? evidence.speakerChannels : null;
  const speakerChannelCount = numberOrNull(evidence.speakerChannelCount);
  const baseOk = evidence.source === 'video_room_recording'
    && evidence.recordingEventSource === 'browser_media_recorder'
    && evidence.recordingStateEventSource === 'browser_media_recorder_state_sync'
    && evidence.actor === 'host'
    && evidence.recordingLifecycleKind === lifecycleKind
    && evidence.recordingStatus === status
    && evidence.recordingActive === active
    && capturedAtMs !== null
    && Number.isInteger(capturedAtMs)
    && capturedAtMs >= 0
    && recordingStateEventId !== null
    && RECORDING_STATE_EVENT_ID_RE.test(recordingStateEventId)
    && recordingStateEventId === `recording:host:${capturedAtMs}:${lifecycleKind}:${status}`
    && evidence.surface === 'standard'
    && stringOrNull(evidence.roomPhase) !== null
    && evidence.durableObjectReplayExpected === true
    && stringOrNull(evidence.iceProvider) !== null
    && typeof evidence.hasTranscriptionAudio === 'boolean'
    && numberOrNull(evidence.speakerMetadataVersion) !== null
    && stringOrNull(evidence.speakerChannelLayout) !== null
    && speakerChannelCount !== null
    && Number.isInteger(speakerChannelCount)
    && speakerChannels !== null
    && speakerChannels.length === speakerChannelCount
    && speakerChannels.every((channel) => (
      isRecord(channel)
      && numberOrNull(channel.channel) !== null
      && Number.isInteger(numberOrNull(channel.channel))
      && (channel.role === 'host' || channel.role === 'guest')
      && (channel.source === 'local' || channel.source === 'remote')
    ));
  if (!baseOk) return false;
  if (lifecycleKind === 'start') return status === 'recording' && active;
  if (status === 'uploading' || status === 'saved') {
    const expectedUploadStatus = status === 'uploading' ? 'attempting' : 'accepted';
    return active === false
      && evidence.uploadStatus === expectedUploadStatus
      && numberOrNull(evidence.recordingBytes) !== null
      && stringOrNull(evidence.recordingMimeType) !== null
      && numberOrNull(evidence.transcriptionBytes) !== null
      && (
        evidence.hasTranscriptionAudio === false
        || stringOrNull(evidence.transcriptionMimeType) !== null
      );
  }
  const recordingFailureMessage = stringOrNull(evidence.recordingFailureMessage);
  const recordingBytes = numberOrNull(evidence.recordingBytes);
  const transcriptionBytes = numberOrNull(evidence.transcriptionBytes);
  const recordingMimeType = stringOrNull(evidence.recordingMimeType);
  const transcriptionMimeType = stringOrNull(evidence.transcriptionMimeType);
  return lifecycleKind === 'stop'
    && status === 'failed'
    && active === false
    && evidence.uploadStatus === 'failed'
    && RECORDING_FAILURE_STAGES.has(String(evidence.recordingFailureStage))
    && RECORDING_FAILURE_SOURCES.has(String(evidence.recordingFailureSource))
    && recordingFailureMessage !== null
    && recordingFailureMessage.length <= MAX_RECORDING_FAILURE_MESSAGE_LENGTH
    && (evidence.recordingBytes === undefined || (recordingBytes !== null && recordingBytes >= 0))
    && (evidence.transcriptionBytes === undefined || (transcriptionBytes !== null && transcriptionBytes >= 0))
    && (evidence.recordingMimeType === undefined || recordingMimeType !== null)
    && (evidence.transcriptionMimeType === undefined || transcriptionMimeType !== null);
}

function recordingActivityToSessionEvent(input: RoomActivitySyncInput, value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isRecord(value.event)) return null;
  const event = value.event;
  const role = isRoomActivityRole(value.role)
    ? value.role
    : isRoomActivityRole(event.role)
      ? event.role
      : null;
  if (!role || !isHostRoomRole(role)) return null;
  if (isRoomActivityRole(event.role) && event.role !== role) return null;
  const lifecycleKind = event.lifecycleKind === 'start' || event.lifecycleKind === 'stop'
    ? event.lifecycleKind
    : null;
  if (!lifecycleKind || !isRecordingStateStatus(event.status) || typeof event.active !== 'boolean') {
    return null;
  }
  const evidence = isRecord(event.evidence) ? event.evidence : null;
  if (!isSourceBackedRecordingStateEvidence(evidence, lifecycleKind, event.status, event.active)) return null;
  const properties = {
    ...roomActivityBaseProperties('recording_state', role, value.recordedAt),
    ...evidence,
  };
  const eventId = stringOrNull(event.id);
  const clientId = stringOrNull(event.clientId);
  if (eventId) properties.roomEventId = eventId;
  if (clientId) properties.clientId = clientId;
  return createSessionEvent(input, {
    type: lifecycleKind === 'start' ? 'recording_start' : 'recording_stop',
    timestamp: unixTimestampFromActivity(event.createdAt, value.recordedAt),
    actor: 'host',
    text: recordingStateText(lifecycleKind, event.status),
    properties,
  });
}

function isSourceBackedCodeServerFileEvidence(
  eventType: unknown,
  text: string,
  evidence: Record<string, unknown> | null,
): evidence is Record<string, unknown> {
  if (evidence === null) return false;
  const commonOk = evidence.source === 'code_server_workspace'
    && evidence.observedBy === 'agent_bridge'
    && evidence.bridgeEventType === 'FILE_CHANGED'
    && evidence.editorSurface === 'code-server'
    && typeof evidence.path === 'string'
    && evidence.path.trim().length > 0
    && text === evidence.path
    && typeof evidence.contentHash === 'string'
    && SHA256_HEX_RE.test(evidence.contentHash)
    && typeof evidence.sizeBytes === 'number'
    && Number.isFinite(evidence.sizeBytes)
    && evidence.sizeBytes >= 0
    && stringOrNull(evidence.observedAt) !== null
    && evidence.bridgePersisted === false
    && evidence.surface === 'standard'
    && stringOrNull(evidence.roomPhase) !== null
    && stringOrNull(evidence.workspaceStatus) !== null
    && stringOrNull(evidence.workspaceSessionId) !== null
    && (evidence.repoUrl === null || evidence.repoUrl === undefined || typeof evidence.repoUrl === 'string')
    && evidence.durableObjectReplayExpected === true;
  if (!commonOk) return false;
  if (eventType === 'code_editor_save') {
    return typeof evidence.action === 'string' && CODE_SERVER_SAVE_ACTIONS.has(evidence.action);
  }
  return eventType === 'file_change' && evidence.action === 'deleted';
}

function codeServerFileActivityToSessionEvent(input: RoomActivitySyncInput, value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isRecord(value.event)) return null;
  const event = value.event;
  const eventType = stringOrNull(event.eventType) as SessionEventType | null;
  if (eventType !== 'code_editor_save' && eventType !== 'file_change') return null;
  const text = stringOrNull(event.text);
  if (!text) return null;
  const evidence = isRecord(event.evidence) ? event.evidence : null;
  if (!isSourceBackedCodeServerFileEvidence(eventType, text, evidence)) return null;
  const role = isRoomActivityRole(value.role) ? value.role : null;
  const properties = {
    ...roomActivityBaseProperties('code_server_file', role, value.recordedAt),
    ...evidence,
  };
  const eventId = stringOrNull(event.id);
  const clientId = stringOrNull(event.clientId);
  if (eventId) properties.roomEventId = eventId;
  if (clientId) properties.clientId = clientId;
  return createSessionEvent(input, {
    type: eventType,
    timestamp: unixTimestampFromActivity(event.createdAt, value.recordedAt),
    actor: 'system',
    text,
    properties,
  });
}

function isSourceBackedTerminalEvidence(
  evidence: Record<string, unknown> | null,
  actor: SessionEvent['actor'],
  kind: 'COMMAND' | 'OUTPUT',
  text: string,
): evidence is Record<string, unknown> {
  if (evidence === null) return false;
  const terminalSessionId = stringOrNull(evidence.terminalSessionId);
  const capturedAtMs = numberOrNull(evidence.capturedAtMs);
  const commonOk = evidence.source === 'container_terminal'
    && evidence.terminalEventSource === 'browser_terminal_ws'
    && terminalSessionId !== null
    && capturedAtMs !== null
    && Number.isInteger(capturedAtMs)
    && capturedAtMs >= 0
    && evidence.surface === 'standard'
    && stringOrNull(evidence.roomPhase) !== null
    && stringOrNull(evidence.workspaceStatus) !== null
    && stringOrNull(evidence.workspaceSessionId) !== null
    && (evidence.repoUrl === null || evidence.repoUrl === undefined || typeof evidence.repoUrl === 'string');
  if (!commonOk) return false;

  if (kind === 'COMMAND') {
    const commandSequence = numberOrNull(evidence.terminalCommandSequence);
    const fingerprint = stringOrNull(evidence.commandFingerprint);
    return (actor === 'host' || actor === 'guest')
      && evidence.actor === actor
      && commandSequence !== null
      && Number.isInteger(commandSequence)
      && commandSequence > 0
      && fingerprint !== null
      && TERMINAL_FINGERPRINT_RE.test(fingerprint)
      && evidence.commandLength === text.length
      && evidence.terminalCommandId === `${terminalSessionId}:command:${actor}:${capturedAtMs}:${commandSequence}:${fingerprint}`;
  }

  const outputSequence = numberOrNull(evidence.terminalOutputSequence);
  const fingerprint = stringOrNull(evidence.outputFingerprint);
  const commandId = evidence.terminalCommandId;
  return actor === 'system'
    && evidence.actor === 'system'
    && outputSequence !== null
    && Number.isInteger(outputSequence)
    && outputSequence > 0
    && fingerprint !== null
    && TERMINAL_FINGERPRINT_RE.test(fingerprint)
    && evidence.outputLength === text.length
    && evidence.terminalOutputChunkId === `${terminalSessionId}:output:system:${capturedAtMs}:${outputSequence}:${fingerprint}`
    && (
      commandId === null
      || (
        typeof commandId === 'string'
        && commandId.startsWith(`${terminalSessionId}:command:`)
        && TERMINAL_COMMAND_ID_RE.test(commandId)
      )
    );
}

function terminalActivityToSessionEvent(input: RoomActivitySyncInput, value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isRecord(value.event)) return null;
  const event = value.event;
  const kind = event.kind === 'COMMAND' || event.kind === 'OUTPUT' ? event.kind : null;
  const text = typeof event.text === 'string' && event.text.length > 0 ? event.text : null;
  if (!kind || !text) return null;
  const role = isRoomActivityRole(value.role) ? value.role : null;
  const actor = kind === 'OUTPUT' ? 'system' : actorFromRoomRole(role);
  const evidence = isRecord(event.evidence) ? event.evidence : null;
  if (!isSourceBackedTerminalEvidence(evidence, actor, kind, text)) return null;

  const properties = {
    ...roomActivityBaseProperties('terminal', role, value.recordedAt),
    ...evidence,
  };
  const eventId = stringOrNull(event.id);
  const clientId = stringOrNull(event.clientId);
  if (eventId) properties.roomEventId = eventId;
  if (clientId) properties.clientId = clientId;

  return createSessionEvent(input, {
    type: kind === 'COMMAND' ? 'terminal_command' : 'terminal_output',
    timestamp: unixTimestampFromActivity(event.createdAt, value.recordedAt),
    actor,
    text,
    properties,
  });
}

function isSourceBackedAgentInteractionEvidence(
  eventType: unknown,
  actor: SessionEvent['actor'],
  text: string,
  evidence: Record<string, unknown> | null,
): evidence is Record<string, unknown> {
  if (evidence === null || evidence.durableObjectReplayExpected !== true) return false;

  if (eventType === 'ai_chat_user') {
    const promptTimestamp = numberOrNull(evidence.promptTimestamp);
    const promptFingerprint = stringOrNull(evidence.promptFingerprint);
    const workspaceSessionId = stringOrNull(evidence.workspaceSessionId);
    const workspacePart = safeEvidenceIdPart(workspaceSessionId);
    const deliveryStatus = evidence.bridgeDeliveryStatus === 'blocked' ? 'blocked' : 'queued';
    const deliveryOk = deliveryStatus === 'blocked'
      ? evidence.browserQueuedBridgeMessage === false
        && AGENT_PROMPT_BLOCKED_REASONS.has(String(evidence.bridgeBlockedReason))
      : evidence.browserQueuedBridgeMessage === true
        && workspaceSessionId !== null
        && stringOrNull(evidence.workspaceStatus) !== null;
    return (actor === 'host' || actor === 'guest')
      && evidence.actor === actor
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
      && evidence.promptLength === text.length
      && evidence.promptId === `${workspacePart}:${actor}:prompt:${promptTimestamp}:${promptFingerprint}`
      && evidence.surface === 'standard'
      && stringOrNull(evidence.roomPhase) !== null
      && (evidence.workspaceStatus === null || evidence.workspaceStatus === undefined || stringOrNull(evidence.workspaceStatus) !== null)
      && (evidence.repoUrl === null || evidence.repoUrl === undefined || typeof evidence.repoUrl === 'string');
  }

  if (eventType === 'ai_chat_agent') {
    const capturedAtMs = numberOrNull(evidence.capturedAtMs);
    const agent = stringOrNull(evidence.agent);
    const fingerprint = stringOrNull(evidence.responseFingerprint);
    const expectedId = capturedAtMs !== null && agent && fingerprint
      ? `agent-chat:${safeEvidenceIdPart(agent)}:${capturedAtMs}:CHAT_RESPONSE:${fingerprint}`
      : null;
    const persistedOk = evidence.bridgePersisted === true
      && typeof evidence.actionCount === 'number'
      && Number.isFinite(evidence.actionCount)
      && evidence.actionCount >= 0;
    const fallbackOk = evidence.bridgePersisted === false
      && evidence.persistenceFallback === 'browser_after_bridge_persist_failed'
      && evidence.surface === 'standard'
      && stringOrNull(evidence.roomPhase) !== null
      && numberOrNull(evidence.messageTimestamp) !== null
      && evidence.agentResponseClaimed === true;
    return actor === 'agent'
      && evidence.source === 'agent_bridge'
      && evidence.bridgeEventType === 'CHAT_RESPONSE'
      && (
        evidence.bridgeMessageSource === 'agent_stdout'
        || evidence.bridgeMessageSource === 'agent_api_response'
      )
      && stringOrNull(evidence.observedAt) !== null
      && capturedAtMs !== null
      && Number.isInteger(capturedAtMs)
      && capturedAtMs >= 0
      && agent !== null
      && fingerprint !== null
      && AGENT_CHAT_RESPONSE_FINGERPRINT_RE.test(fingerprint)
      && evidence.responseLength === text.length
      && typeof evidence.agentChatResponseId === 'string'
      && AGENT_CHAT_RESPONSE_ID_RE.test(evidence.agentChatResponseId)
      && evidence.agentChatResponseId === expectedId
      && hasOptionalBrowserPromptRef(evidence)
      && (persistedOk || fallbackOk);
  }

  if (eventType === 'ai_agent_status') {
    const capturedAtMs = numberOrNull(evidence.capturedAtMs);
    const agent = stringOrNull(evidence.agent);
    const bridgeMessageSource = stringOrNull(evidence.bridgeMessageSource);
    const status = stringOrNull(evidence.status);
    const diagnosticSource = stringOrNull(evidence.diagnosticSource);
    const expectedId = capturedAtMs !== null && agent && bridgeMessageSource
      ? `agent-status:${safeEvidenceIdPart(agent)}:${capturedAtMs}:${bridgeMessageSource}:${safeEvidenceIdPart(status)}:${safeEvidenceIdPart(diagnosticSource)}`
      : null;
    const statusOk = status === null || AGENT_STATUSES.has(status);
    const browserObservationOk = evidence.agentStatusEventSource === 'browser_agent_ws'
      && evidence.surface === 'standard'
      && stringOrNull(evidence.roomPhase) !== null
      && numberOrNull(evidence.messageTimestamp) !== null
      && evidence.agentResponseClaimed === false
      && (
        (bridgeMessageSource === 'agent_status' && status !== null && AGENT_STATUSES.has(status))
        || (bridgeMessageSource !== 'agent_status' && diagnosticSource !== null)
      );
    const persistedDiagnosticOk = bridgeMessageSource === 'bridge_diagnostic'
      && evidence.bridgePersisted === true
      && diagnosticSource !== null;
    return actor === 'agent'
      && evidence.source === 'agent_bridge'
      && agent !== null
      && statusOk
      && stringOrNull(evidence.observedAt) !== null
      && capturedAtMs !== null
      && Number.isInteger(capturedAtMs)
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

function agentInteractionActivityToSessionEvent(input: RoomActivitySyncInput, value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isRecord(value.event)) return null;
  const event = value.event;
  const eventType = stringOrNull(event.eventType) as SessionEventType | null;
  if (
    eventType !== 'ai_chat_user'
    && eventType !== 'ai_chat_agent'
    && eventType !== 'ai_agent_status'
  ) {
    return null;
  }
  const rawText = stringOrNull(event.text);
  if (!rawText) return null;
  const text = eventType === 'ai_chat_agent' || eventType === 'ai_agent_status'
    ? redactAgentDiagnosticText(rawText)
    : rawText;
  if (!text) return null;
  const role = isRoomActivityRole(value.role) ? value.role : null;
  const eventActor = stringOrNull(event.actor);
  const actor = eventActor === 'host'
    || eventActor === 'guest'
    || eventActor === 'agent'
    || eventActor === 'system'
    ? eventActor
    : actorFromRoomRole(role);
  const evidence = isRecord(event.evidence) ? event.evidence : null;
  if (!isSourceBackedAgentInteractionEvidence(eventType, actor, text, evidence)) return null;
  const properties = {
    ...roomActivityBaseProperties('agent_interaction', role, value.recordedAt),
    ...evidence,
  };
  const eventId = stringOrNull(event.id);
  const clientId = stringOrNull(event.clientId);
  if (eventId) properties.roomEventId = eventId;
  if (clientId) properties.clientId = clientId;
  return createSessionEvent(input, {
    type: eventType,
    timestamp: unixTimestampFromActivity(event.createdAt, value.recordedAt),
    actor,
    text,
    properties,
  });
}

export async function roomActivitySnapshotToSessionEvents(
  snapshot: unknown,
  input: RoomActivitySyncInput,
): Promise<SessionEvent[]> {
  if (!isRecord(snapshot)) return [];
  const events: SessionEvent[] = [];
  const pushMapped = (event: SessionEvent | null): void => {
    if (event) events.push(event);
  };

  const chatActivityLog = Array.isArray(snapshot.chatActivityLog) ? snapshot.chatActivityLog : [];
  const codeServerFileActivityLog = Array.isArray(snapshot.codeServerFileActivityLog)
    ? snapshot.codeServerFileActivityLog
    : [];
  const terminalActivityLog = Array.isArray(snapshot.terminalActivityLog) ? snapshot.terminalActivityLog : [];
  const mediaControlActivityLog = Array.isArray(snapshot.mediaControlActivityLog)
    ? snapshot.mediaControlActivityLog
    : [];
  const recordingActivityLog = Array.isArray(snapshot.recordingActivityLog)
    ? snapshot.recordingActivityLog
    : [];
  const agentInteractionActivityLog = Array.isArray(snapshot.agentInteractionActivityLog)
    ? snapshot.agentInteractionActivityLog
    : [];

  chatActivityLog.forEach((entry) => pushMapped(chatActivityToSessionEvent(input, entry)));
  codeServerFileActivityLog.forEach((entry) => pushMapped(codeServerFileActivityToSessionEvent(input, entry)));
  terminalActivityLog.forEach((entry) => pushMapped(terminalActivityToSessionEvent(input, entry)));
  mediaControlActivityLog.forEach((entry) => pushMapped(mediaControlActivityToSessionEvent(input, entry)));
  recordingActivityLog.forEach((entry) => pushMapped(recordingActivityToSessionEvent(input, entry)));
  agentInteractionActivityLog.forEach((entry) => pushMapped(agentInteractionActivityToSessionEvent(input, entry)));

  return events.sort((a, b) => (
    a.timestamp - b.timestamp
    || a.type.localeCompare(b.type)
    || a.text.localeCompare(b.text)
  ));
}

/**
 * Convert a session event to a CandidateNode insertion payload.
 */
function eventToNodePayload(event: SessionEvent): Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'> {
  const nodeType = mapEventTypeToNodeType(event.type);
  const narrativeText = formatEventNarrative(event);
  const extractedProperties = event.properties
    ? JSON.stringify({ ...event.properties, actor: event.actor, sessionId: event.sessionId })
    : JSON.stringify({ actor: event.actor, sessionId: event.sessionId });

  return {
    candidate_id: event.candidateId,
    node_type: nodeType,
    narrative_text: narrativeText,
    extracted_properties_json: extractedProperties,
    embedding_json: null, // Embeddings generated lazily or by background job
    source_type: 'meeting_session',
    source_reference: event.sessionId,
    captured_at: event.timestamp,
    confidence: 1.0,
    supersedes: null,
    superseded_at: null,
    decomposition_version: 'session-v1',
  };
}

function sessionEventIngestionKey(event: SessionEvent): string {
  const properties = jsonObject(event.properties);
  return [
    'meeting_session_event_v2',
    event.candidateId,
    event.sessionId,
    event.type,
    event.actor,
    String(event.timestamp),
    event.text,
    stableJson(properties),
  ].join('\u0000');
}

function mapEventTypeToNodeType(type: SessionEventType): string {
  const mapping: Record<SessionEventType, string> = {
    chat_message: 'session_chat_message',
    ai_chat_user: 'session_chat_user',
    ai_chat_agent: 'session_chat_agent',
    ai_agent_status: 'session_agent_status',
    terminal_command: 'session_terminal_command',
    terminal_output: 'session_terminal_output',
    file_change: 'session_file_change',
    media_control: 'session_media_control',
    workspace_state: 'session_workspace_state',
    participant_join: 'session_participant_join',
    participant_leave: 'session_participant_leave',
    recording_start: 'session_recording_start',
    recording_stop: 'session_recording_stop',
    code_editor_open: 'session_code_editor_open',
    code_editor_save: 'session_code_editor_save',
  };
  return mapping[type] ?? 'session_event';
}

function formatEventNarrative(event: SessionEvent): string {
  const time = new Date(event.timestamp * 1000).toISOString();
  switch (event.type) {
    case 'chat_message':
      return `[${time}] Room chat message from ${event.actor}: "${event.text}"`;
    case 'ai_chat_user':
      return `[${time}] User asked: "${event.text}"`;
    case 'ai_chat_agent':
      return `[${time}] Agent responded: "${event.text}"`;
    case 'ai_agent_status':
      return `[${time}] Agent status: ${event.text}`;
    case 'terminal_command':
      return `[${time}] Terminal command: ${event.text}`;
    case 'terminal_output':
      return `[${time}] Terminal output: ${event.text.slice(0, 500)}`;
    case 'file_change':
      return `[${time}] File ${event.properties?.operation ?? event.properties?.action ?? 'changed'}: ${event.text}`;
    case 'media_control':
      return `[${time}] Media control changed: ${event.text}`;
    case 'workspace_state':
      return `[${time}] ${event.text}`;
    case 'participant_join':
      return `[${time}] Participant joined: ${event.text}`;
    case 'participant_leave':
      return `[${time}] Participant left: ${event.text}`;
    case 'recording_start':
      return `[${time}] Recording started`;
    case 'recording_stop':
      return `[${time}] Recording stopped`;
    case 'code_editor_open':
      return `[${time}] Opened in editor: ${event.text}`;
    case 'code_editor_save':
      return `[${time}] Saved in editor: ${event.text}`;
    default:
      return `[${time}] ${event.text}`;
  }
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const parsed = jsonValue(entry);
      return parsed === undefined ? [] : [parsed];
    });
  }
  if (typeof value === 'object') {
    const record: JsonObject = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const parsed = jsonValue(entry);
      if (parsed !== undefined) record[key] = parsed;
    }
    return record;
  }
  return undefined;
}

function jsonObject(value: Record<string, unknown> | undefined): JsonObject {
  const parsed = jsonValue(value ?? {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function stringProperty(record: JsonObject, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberProperty(record: JsonObject, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function promptCorrelationRef(
  properties: JsonObject,
  idKey: 'promptId' | 'browserPromptId',
  fingerprintKey: 'promptFingerprint' | 'browserPromptFingerprint',
  timestampKey: 'promptTimestamp' | 'browserPromptTimestamp',
  lengthKey: 'promptLength' | 'browserPromptLength',
): JsonObject | null {
  const promptId = stringProperty(properties, idKey);
  if (!promptId) return null;

  const ref: JsonObject = { promptId };
  const fingerprint = stringProperty(properties, fingerprintKey);
  if (fingerprint) ref.fingerprint = fingerprint;
  const timestamp = numberProperty(properties, timestampKey);
  if (timestamp !== null) ref.timestamp = timestamp;
  const length = numberProperty(properties, lengthKey);
  if (length !== null) ref.length = length;
  return ref;
}

function sessionEventCorrelationRefs(event: SessionEvent, properties: JsonObject): JsonObject | null {
  const refs: JsonObject = {};

  const prompt = promptCorrelationRef(
    properties,
    'promptId',
    'promptFingerprint',
    'promptTimestamp',
    'promptLength',
  );
  if (prompt) refs.prompt = prompt;

  const browserPrompt = promptCorrelationRef(
    properties,
    'browserPromptId',
    'browserPromptFingerprint',
    'browserPromptTimestamp',
    'browserPromptLength',
  );
  if (browserPrompt) refs.browserPrompt = browserPrompt;

  const agentChatResponseId = stringProperty(properties, 'agentChatResponseId');
  if (event.type === 'ai_chat_agent' && agentChatResponseId) {
    refs.agentResponse = { responseId: agentChatResponseId };
  }

  return Object.keys(refs).length > 0 ? refs : null;
}

function observedAtFromTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp < 0) return new Date(0).toISOString();
  return new Date(Math.round(timestamp) * 1000).toISOString();
}

async function findCandidateNodeSourceSpanId(
  db: D1Database,
  nodeId: string,
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT ss.id
       FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
       JOIN artifacts a ON a.id = av.artifact_id
      WHERE a.artifact_type = 'legacy_candidate_node'
        AND a.logical_key = ?1
        AND ss.stable_segment_id = ?1
      LIMIT 1`,
  ).bind(nodeId).first<{ id: string }>();
  return row?.id ?? null;
}

function sessionEventEntities(input: {
  event: SessionEvent;
  node: CandidateNode;
  workspacePersonId: string;
  properties: JsonObject;
}): ContextRecordEntityInput[] {
  const { event, node, workspacePersonId, properties } = input;
  const entities: ContextRecordEntityInput[] = [
    {
      entityType: 'workspace_person',
      entityId: workspacePersonId,
      relationship: 'subject',
    },
    {
      entityType: 'candidate',
      entityId: event.candidateId,
      relationship: 'legacy_candidate',
    },
    {
      entityType: 'meeting_session',
      entityId: event.sessionId,
      relationship: 'source_session',
    },
    {
      entityType: 'session_event',
      entityId: node.id,
      relationship: 'source_event',
      metadata: {
        eventType: event.type,
        actor: event.actor,
        nodeType: node.node_type,
      },
    },
    {
      entityType: 'session_actor',
      relationship: 'actor',
      value: { role: event.actor },
    },
  ];

  const surface = stringProperty(properties, 'surface');
  if (surface) {
    entities.push({
      entityType: 'room_surface',
      relationship: 'event_surface',
      value: { surface },
    });
  }

  const mediaControlId = stringProperty(properties, 'mediaControlId');
  if (mediaControlId) {
    entities.push({
      entityType: 'room_media_control',
      entityId: mediaControlId,
      relationship: 'source_media_control',
      metadata: {
        control: stringProperty(properties, 'control'),
        action: stringProperty(properties, 'action'),
        controlSurface: stringProperty(properties, 'controlSurface'),
      },
    });
  }

  const recordingStateEventId = stringProperty(properties, 'recordingStateEventId');
  if (recordingStateEventId) {
    entities.push({
      entityType: 'room_recording_state',
      entityId: recordingStateEventId,
      relationship: 'source_recording_state',
      metadata: {
        lifecycleKind: stringProperty(properties, 'recordingLifecycleKind'),
        recordingStatus: stringProperty(properties, 'recordingStatus'),
        hasTranscriptionAudio: properties.hasTranscriptionAudio === true,
      },
    });
  }

  const workspaceStateEventId = stringProperty(properties, 'workspaceStateEventId');
  if (workspaceStateEventId) {
    entities.push({
      entityType: 'workspace_state_event',
      entityId: workspaceStateEventId,
      relationship: 'source_workspace_state',
      metadata: {
        workspaceStatus: stringProperty(properties, 'workspaceStatus'),
        workspaceSessionId: stringProperty(properties, 'workspaceSessionId'),
        challengeStatus: stringProperty(properties, 'challengeStatus'),
      },
    });
  }

  const codeEditorOpenId = stringProperty(properties, 'codeEditorOpenId');
  if (codeEditorOpenId) {
    entities.push({
      entityType: 'code_editor_open',
      entityId: codeEditorOpenId,
      relationship: 'source_editor_open',
      metadata: {
        editor: stringProperty(properties, 'editor'),
        workspaceSessionId: stringProperty(properties, 'workspaceSessionId'),
        repoUrl: stringProperty(properties, 'repoUrl'),
      },
    });
  }

  const actionId = stringProperty(properties, 'actionId');
  if (actionId) {
    entities.push({
      entityType: 'room_action',
      entityId: actionId,
      relationship: 'requested_action',
    });
  }

  const roomMessageId = stringProperty(properties, 'roomMessageId');
  if (roomMessageId) {
    entities.push({
      entityType: 'room_message',
      entityId: roomMessageId,
      relationship: 'source_message',
      metadata: {
        actor: event.actor,
        clientId: stringProperty(properties, 'clientId'),
        deliveryStatus: stringProperty(properties, 'deliveryStatus'),
        messageLength: numberProperty(properties, 'messageLength'),
      },
    });
  }

  const promptId = stringProperty(properties, 'promptId');
  if (promptId) {
    entities.push({
      entityType: 'ai_user_prompt',
      entityId: promptId,
      relationship: event.type === 'ai_chat_user' ? 'source_prompt' : 'prompt_event',
      metadata: {
        actor: event.actor,
        promptLength: numberProperty(properties, 'promptLength'),
        workspaceSessionId: stringProperty(properties, 'workspaceSessionId'),
        bridgeDeliveryStatus: stringProperty(properties, 'bridgeDeliveryStatus'),
        bridgeBlockedReason: stringProperty(properties, 'bridgeBlockedReason'),
      },
    });
  }

  const browserPromptId = stringProperty(properties, 'browserPromptId');
  if (browserPromptId) {
    entities.push({
      entityType: 'ai_user_prompt',
      entityId: browserPromptId,
      relationship: 'linked_prompt',
      metadata: {
        promptLength: numberProperty(properties, 'browserPromptLength'),
        workspaceSessionId: stringProperty(properties, 'workspaceSessionId'),
      },
    });
  }

  const agentChatResponseId = stringProperty(properties, 'agentChatResponseId');
  if (agentChatResponseId) {
    entities.push({
      entityType: 'agent_chat_response',
      entityId: agentChatResponseId,
      relationship: 'source_response',
      metadata: {
        agent: stringProperty(properties, 'agent'),
        responseLength: numberProperty(properties, 'responseLength'),
        linkedPromptId: browserPromptId,
      },
    });
  }

  const terminalSessionId = stringProperty(properties, 'terminalSessionId');
  if (terminalSessionId) {
    entities.push({
      entityType: 'terminal_session',
      entityId: terminalSessionId,
      relationship: 'terminal_session',
      metadata: {
        workspaceSessionId: stringProperty(properties, 'workspaceSessionId'),
        repoUrl: stringProperty(properties, 'repoUrl'),
      },
    });
  }

  const terminalCommandId = stringProperty(properties, 'terminalCommandId');
  if (terminalCommandId) {
    entities.push({
      entityType: 'terminal_command',
      entityId: terminalCommandId,
      relationship: event.type === 'terminal_output' ? 'related_command' : 'source_command',
      metadata: {
        terminalSessionId,
      },
    });
  }

  const terminalOutputChunkId = stringProperty(properties, 'terminalOutputChunkId');
  if (terminalOutputChunkId) {
    entities.push({
      entityType: 'terminal_output_chunk',
      entityId: terminalOutputChunkId,
      relationship: 'source_output',
      metadata: {
        terminalSessionId,
        terminalCommandId,
      },
    });
  }

  const codeServerPath = stringProperty(properties, 'path');
  if (
    codeServerPath
    && properties.source === 'code_server_workspace'
    && properties.bridgeEventType === 'FILE_CHANGED'
  ) {
    const workspaceSessionId = stringProperty(properties, 'workspaceSessionId');
    entities.push({
      entityType: 'code_server_file',
      entityId: `${workspaceSessionId ?? event.sessionId}:${codeServerPath}`,
      relationship: 'affected_workspace_file',
      metadata: {
        path: codeServerPath,
        action: stringProperty(properties, 'action'),
        workspaceSessionId,
        workspaceRoot: stringProperty(properties, 'workspaceRoot'),
        repoUrl: stringProperty(properties, 'repoUrl'),
        codeServerFileChangeId: stringProperty(properties, 'codeServerFileChangeId'),
        contentHash: stringProperty(properties, 'contentHash'),
        sizeBytes: numberProperty(properties, 'sizeBytes'),
        observedAt: stringProperty(properties, 'observedAt'),
      },
    });
  }

  return entities;
}

function sessionEventSourcePayload(event: SessionEvent, node: CandidateNode): JsonObject {
  return {
    type: event.type,
    sessionId: event.sessionId,
    candidateId: event.candidateId,
    timestamp: event.timestamp,
    actor: event.actor,
    text: event.text,
    properties: jsonObject(event.properties),
    candidateNodeId: node.id,
  };
}

type SessionEventExactSourceRef = ContextRecordSourceInput & AssessmentEvidenceSourceRefInput;

async function chatTextSourceRef(input: {
  event: SessionEvent;
  node: CandidateNode;
  properties: JsonObject;
}): Promise<SessionEventExactSourceRef | null> {
  if (input.event.text.trim().length === 0) return null;

  if (input.event.type === 'chat_message') {
    if (input.properties.source !== 'room_chat_client_submit') return null;
    if (input.properties.chatEventSource !== 'browser_room_chat_panel') return null;
    if (input.event.actor !== 'host' && input.event.actor !== 'guest') return null;
    const roomMessageId = stringProperty(input.properties, 'roomMessageId');
    const clientId = stringProperty(input.properties, 'clientId');
    const deliveryStatus = stringProperty(input.properties, 'deliveryStatus');
    const deliveryRejectionReason = stringProperty(input.properties, 'deliveryRejectionReason');
    const messageLength = numberProperty(input.properties, 'messageLength');
    if (!roomMessageId || !clientId || !deliveryStatus || !CHAT_DELIVERY_STATUSES.has(deliveryStatus)) return null;
    if (messageLength !== input.event.text.length) return null;
    if (input.properties.durableObjectReplayExpected !== true) return null;
    return {
      sourceRefType: 'room_chat_message',
      sourceRefId: roomMessageId,
      evidenceRole: 'room_chat_message',
      locator: {
        sessionId: input.event.sessionId,
        candidateId: input.event.candidateId,
        candidateNodeId: input.node.id,
        actor: input.event.actor,
        roomMessageId,
        clientId,
        deliveryStatus,
        messageCreatedAt: numberProperty(input.properties, 'messageCreatedAt'),
        surface: stringProperty(input.properties, 'surface'),
        roomPhase: stringProperty(input.properties, 'roomPhase'),
        ...(deliveryStatus === 'rejected' && deliveryRejectionReason ? { deliveryRejectionReason } : {}),
      },
      exactText: input.event.text,
      contentHash: await sha256Hex(input.event.text),
      metadata: {
        sourceKind: 'room_chat.message',
        chatEventSource: 'browser_room_chat_panel',
        deliveryStatus,
        messageLength,
        ...(deliveryStatus === 'rejected' && deliveryRejectionReason ? { deliveryRejectionReason } : {}),
      },
    };
  }

  if (input.event.type === 'ai_chat_user') {
    if (input.properties.source !== 'agent_chat_client_submit') return null;
    if (input.properties.agentChatEventSource !== 'browser_agent_chat_panel') return null;
    if (input.event.actor !== 'host' && input.event.actor !== 'guest') return null;
    const promptId = stringProperty(input.properties, 'promptId');
    const promptTimestamp = numberProperty(input.properties, 'promptTimestamp');
    const promptFingerprint = stringProperty(input.properties, 'promptFingerprint');
    const workspaceSessionId = stringProperty(input.properties, 'workspaceSessionId');
    const workspacePart = safeEvidenceIdPart(workspaceSessionId);
    const promptLength = numberProperty(input.properties, 'promptLength');
    const deliveryStatus = input.properties.bridgeDeliveryStatus === 'blocked' ? 'blocked' : 'queued';
    const blockedReason = stringProperty(input.properties, 'bridgeBlockedReason');
    if (!promptId || promptLength !== input.event.text.length) return null;
    if (promptTimestamp === null || promptTimestamp < 0 || !Number.isInteger(promptTimestamp)) return null;
    if (!promptFingerprint || !AGENT_PROMPT_FINGERPRINT_RE.test(promptFingerprint)) return null;
    if (promptId !== `${workspacePart}:${input.event.actor}:prompt:${promptTimestamp}:${promptFingerprint}`) return null;
    if (deliveryStatus === 'queued' && !workspaceSessionId) return null;
    if (deliveryStatus === 'blocked' && (!blockedReason || !AGENT_PROMPT_BLOCKED_REASONS.has(blockedReason))) return null;
    if (input.properties.agentResponseClaimed !== false || input.properties.deliveredToAgentBridge === true) return null;
    return {
      sourceRefType: deliveryStatus === 'blocked' ? 'ai_user_prompt_blocked' : 'ai_user_prompt',
      sourceRefId: promptId,
      evidenceRole: deliveryStatus === 'blocked' ? 'ai_user_prompt_blocked' : 'ai_user_prompt',
      locator: {
        sessionId: input.event.sessionId,
        candidateId: input.event.candidateId,
        candidateNodeId: input.node.id,
        actor: input.event.actor,
        promptId,
        promptTimestamp,
        workspaceSessionId,
        repoUrl: stringProperty(input.properties, 'repoUrl'),
        surface: stringProperty(input.properties, 'surface'),
        roomPhase: stringProperty(input.properties, 'roomPhase'),
        bridgeDeliveryStatus: deliveryStatus,
        bridgeBlockedReason: blockedReason,
      },
      exactText: input.event.text,
      contentHash: await sha256Hex(input.event.text),
      metadata: {
        sourceKind: deliveryStatus === 'blocked'
          ? 'agent.user_prompt_blocked'
          : 'agent.user_prompt',
        agentChatEventSource: 'browser_agent_chat_panel',
        bridgeMessageType: stringProperty(input.properties, 'bridgeMessageType'),
        bridgeProtocol: stringProperty(input.properties, 'bridgeProtocol'),
        bridgeDeliveryStatus: deliveryStatus,
        bridgeBlockedReason: blockedReason,
        promptFingerprint,
        promptLength,
      },
    };
  }

  if (input.event.type === 'ai_chat_agent') {
    if (input.properties.source !== 'agent_bridge') return null;
    if (input.properties.bridgeEventType !== 'CHAT_RESPONSE') return null;
    const bridgeMessageSource = stringProperty(input.properties, 'bridgeMessageSource');
    if (bridgeMessageSource !== 'agent_stdout' && bridgeMessageSource !== 'agent_api_response') return null;
    if (input.event.actor !== 'agent') return null;
    const agent = stringProperty(input.properties, 'agent');
    const agentChatResponseId = stringProperty(input.properties, 'agentChatResponseId');
    const capturedAtMs = numberProperty(input.properties, 'capturedAtMs');
    const responseFingerprint = stringProperty(input.properties, 'responseFingerprint');
    const responseLength = numberProperty(input.properties, 'responseLength');
    if (!agent || !agentChatResponseId || responseLength !== input.event.text.length) return null;
    if (capturedAtMs === null || capturedAtMs < 0 || !Number.isInteger(capturedAtMs)) return null;
    if (!responseFingerprint || !AGENT_CHAT_RESPONSE_FINGERPRINT_RE.test(responseFingerprint)) return null;
    if (!AGENT_CHAT_RESPONSE_ID_RE.test(agentChatResponseId)) return null;
    if (agentChatResponseId !== `agent-chat:${safeEvidenceIdPart(agent)}:${capturedAtMs}:CHAT_RESPONSE:${responseFingerprint}`) return null;
    return {
      sourceRefType: 'agent_response',
      sourceRefId: agentChatResponseId,
      evidenceRole: 'agent_response',
      locator: {
        sessionId: input.event.sessionId,
        candidateId: input.event.candidateId,
        candidateNodeId: input.node.id,
        agent,
        agentChatResponseId,
        observedAt: stringProperty(input.properties, 'observedAt'),
        capturedAtMs,
        browserPromptId: stringProperty(input.properties, 'browserPromptId'),
        agentRuntime: stringProperty(input.properties, 'agentRuntime'),
        agentRunProvider: stringProperty(input.properties, 'agentRunProvider'),
        agentRunId: stringProperty(input.properties, 'agentRunId'),
      },
      exactText: input.event.text,
      contentHash: await sha256Hex(input.event.text),
      metadata: {
        sourceKind: bridgeMessageSource === 'agent_api_response'
          ? 'agent.agent_api_response'
          : 'agent.agent_stdout_response',
        bridgeMessageSource,
        responseFingerprint,
        responseLength,
        bridgePersisted: input.properties.bridgePersisted === true,
        persistenceFallback: stringProperty(input.properties, 'persistenceFallback'),
        agentRunExternalSessionHash: stringProperty(input.properties, 'agentRunExternalSessionHash'),
      },
    };
  }

  if (input.event.type === 'ai_agent_status') {
    if (input.properties.source !== 'agent_bridge') return null;
    if (input.event.actor !== 'agent') return null;
    const agent = stringProperty(input.properties, 'agent');
    const agentStatusEventId = stringProperty(input.properties, 'agentStatusEventId');
    const capturedAtMs = numberProperty(input.properties, 'capturedAtMs');
    const bridgeMessageSource = stringProperty(input.properties, 'bridgeMessageSource');
    const status = stringProperty(input.properties, 'status');
    const diagnosticSource = stringProperty(input.properties, 'diagnosticSource');
    const observedAt = stringProperty(input.properties, 'observedAt');
    if (!agent || !agentStatusEventId || !bridgeMessageSource || !observedAt) return null;
    if (capturedAtMs === null || capturedAtMs < 0 || !Number.isInteger(capturedAtMs)) return null;
    if (!AGENT_STATUS_MESSAGE_SOURCES.has(bridgeMessageSource)) return null;
    if (status !== null && !AGENT_STATUSES.has(status)) return null;
    if (!AGENT_STATUS_EVENT_ID_RE.test(agentStatusEventId)) return null;
    const expectedId = `agent-status:${safeEvidenceIdPart(agent)}:${capturedAtMs}:${bridgeMessageSource}:${safeEvidenceIdPart(status)}:${safeEvidenceIdPart(diagnosticSource)}`;
    if (agentStatusEventId !== expectedId) return null;

    const browserObservationOk = input.properties.agentStatusEventSource === 'browser_agent_ws'
      && (
        (bridgeMessageSource === 'agent_status' && status !== null && AGENT_STATUSES.has(status))
        || (bridgeMessageSource !== 'agent_status' && diagnosticSource !== null)
      );
    const persistedDiagnosticOk = bridgeMessageSource === 'bridge_diagnostic'
      && input.properties.bridgePersisted === true
      && diagnosticSource !== null;
    if (!browserObservationOk && !persistedDiagnosticOk) return null;

    const diagnosticBacked = bridgeMessageSource === 'bridge_diagnostic';
    return {
      sourceRefType: diagnosticBacked ? 'agent_diagnostic' : 'agent_status',
      sourceRefId: agentStatusEventId,
      evidenceRole: diagnosticBacked ? 'agent_diagnostic' : 'agent_status',
      locator: {
        sessionId: input.event.sessionId,
        candidateId: input.event.candidateId,
        candidateNodeId: input.node.id,
        agent,
        agentStatusEventId,
        observedAt,
        capturedAtMs,
        status,
        diagnosticSource,
        bridgeMessageSource,
        browserPromptId: stringProperty(input.properties, 'browserPromptId'),
        agentRuntime: stringProperty(input.properties, 'agentRuntime'),
        agentRunProvider: stringProperty(input.properties, 'agentRunProvider'),
        agentRunId: stringProperty(input.properties, 'agentRunId'),
      },
      exactText: input.event.text,
      contentHash: await sha256Hex(input.event.text),
      metadata: {
        sourceKind: diagnosticBacked ? 'agent.agent_diagnostic' : 'agent.agent_status',
        bridgeMessageSource,
        status,
        diagnosticSource,
        agentStatusEventSource: stringProperty(input.properties, 'agentStatusEventSource'),
        bridgePersisted: input.properties.bridgePersisted === true,
        promptType: stringProperty(input.properties, 'promptType'),
        deliveredToAgent: input.properties.deliveredToAgent === true,
        agentRunExternalSessionHash: stringProperty(input.properties, 'agentRunExternalSessionHash'),
      },
    };
  }

  return null;
}

async function terminalTextSourceRef(input: {
  event: SessionEvent;
  node: CandidateNode;
  properties: JsonObject;
}): Promise<SessionEventExactSourceRef | null> {
  if (input.event.type !== 'terminal_command' && input.event.type !== 'terminal_output') return null;
  if (input.properties.source !== 'container_terminal') return null;
  if (input.properties.terminalEventSource !== 'browser_terminal_ws') return null;
  const terminalSessionId = stringProperty(input.properties, 'terminalSessionId');
  if (!terminalSessionId || input.event.text.trim().length === 0) return null;
  const workspaceSessionId = stringProperty(input.properties, 'workspaceSessionId');
  const repoUrl = stringProperty(input.properties, 'repoUrl');
  const capturedAtMs = numberProperty(input.properties, 'capturedAtMs');

  if (input.event.type === 'terminal_command') {
    const terminalCommandId = stringProperty(input.properties, 'terminalCommandId');
    if (!terminalCommandId || (input.event.actor !== 'host' && input.event.actor !== 'guest')) return null;
    return {
      sourceRefType: 'terminal_command',
      sourceRefId: terminalCommandId,
      evidenceRole: 'terminal_command',
      locator: {
        sessionId: input.event.sessionId,
        candidateId: input.event.candidateId,
        candidateNodeId: input.node.id,
        terminalSessionId,
        terminalCommandId,
        workspaceSessionId,
        repoUrl,
        capturedAtMs,
        commandSequence: numberProperty(input.properties, 'terminalCommandSequence'),
      },
      exactText: input.event.text,
      contentHash: await sha256Hex(input.event.text),
      metadata: {
        sourceKind: 'container_terminal.command',
        terminalEventSource: 'browser_terminal_ws',
        actor: input.event.actor,
        commandFingerprint: stringProperty(input.properties, 'commandFingerprint'),
        commandLength: numberProperty(input.properties, 'commandLength') ?? input.event.text.length,
      },
    };
  }

  const terminalOutputChunkId = stringProperty(input.properties, 'terminalOutputChunkId');
  if (!terminalOutputChunkId || input.event.actor !== 'system') return null;
  return {
    sourceRefType: 'terminal_output',
    sourceRefId: terminalOutputChunkId,
    evidenceRole: 'terminal_output',
    locator: {
      sessionId: input.event.sessionId,
      candidateId: input.event.candidateId,
      candidateNodeId: input.node.id,
      terminalSessionId,
      terminalCommandId: stringProperty(input.properties, 'terminalCommandId'),
      terminalOutputChunkId,
      workspaceSessionId,
      repoUrl,
      capturedAtMs,
      outputSequence: numberProperty(input.properties, 'terminalOutputSequence'),
    },
    exactText: input.event.text,
    contentHash: await sha256Hex(input.event.text),
    metadata: {
      sourceKind: 'container_terminal.output',
      terminalEventSource: 'browser_terminal_ws',
      actor: 'system',
      outputFingerprint: stringProperty(input.properties, 'outputFingerprint'),
      outputLength: numberProperty(input.properties, 'outputLength') ?? input.event.text.length,
    },
  };
}

function codeServerFileObservationIsSourceBacked(
  event: SessionEvent,
  properties: JsonObject,
): boolean {
  if (event.type !== 'code_editor_save' && event.type !== 'file_change') return false;
  if (properties.source !== 'code_server_workspace') return false;
  if (properties.bridgeEventType !== 'FILE_CHANGED') return false;
  if (properties.editorSurface !== 'code-server') return false;
  const path = stringProperty(properties, 'path');
  if (!path || path !== event.text) return false;
  const action = stringProperty(properties, 'action');
  if (!action) return false;
  if (event.type === 'code_editor_save' && !CODE_SERVER_SAVE_ACTIONS.has(action)) return false;
  if (event.type === 'file_change' && action !== 'deleted') return false;
  const observedAt = stringProperty(properties, 'observedAt');
  if (!observedAt) return false;
  const contentHash = stringProperty(properties, 'contentHash');
  if (!contentHash || !SHA256_HEX_RE.test(contentHash)) return false;
  const sizeBytes = numberProperty(properties, 'sizeBytes');
  if (sizeBytes === null || sizeBytes < 0) return false;

  if (properties.bridgePersisted === true) {
    return properties.observedBy === 'agent_bridge'
      && Boolean(stringProperty(properties, 'workspaceRoot'));
  }

  if (properties.bridgePersisted === false) {
    const codeServerFileChangeId = stringProperty(properties, 'codeServerFileChangeId');
    return properties.observedBy === 'agent_bridge'
      && codeServerFileChangeId !== null
      && CODE_SERVER_FILE_CHANGE_ID_RE.test(codeServerFileChangeId)
      && properties.surface === 'standard'
      && Boolean(stringProperty(properties, 'roomPhase'))
      && Boolean(stringProperty(properties, 'workspaceStatus'))
      && Boolean(stringProperty(properties, 'workspaceSessionId'))
      && properties.durableObjectReplayExpected === true;
  }

  return false;
}

function codeEditorOpenIsSourceBacked(
  event: SessionEvent,
  properties: JsonObject,
): boolean {
  if (event.type !== 'code_editor_open') return false;
  if (properties.source !== 'code_server_workspace') return false;
  if (properties.editorEventSource !== 'browser_code_server_iframe') return false;
  if (properties.editor !== 'code-server') return false;
  if (properties.openStatus !== 'loaded') return false;
  if (properties.actor !== event.actor || (event.actor !== 'host' && event.actor !== 'guest')) return false;
  const codeEditorOpenId = stringProperty(properties, 'codeEditorOpenId');
  const capturedAtMs = numberProperty(properties, 'capturedAtMs');
  const workspaceSessionId = stringProperty(properties, 'workspaceSessionId');
  const workspaceStatus = stringProperty(properties, 'workspaceStatus');
  const roomPhase = stringProperty(properties, 'roomPhase');
  const surface = stringProperty(properties, 'surface');
  const repoUrl = stringProperty(properties, 'repoUrl');
  const expectedText = `VS Code workspace opened for ${repoUrl ?? 'workspace repository'}`;
  return codeEditorOpenId !== null
    && CODE_EDITOR_OPEN_ID_RE.test(codeEditorOpenId)
    && capturedAtMs !== null
    && Number.isInteger(capturedAtMs)
    && capturedAtMs >= 0
    && workspaceSessionId !== null
    && codeEditorOpenId === `code-editor-open:${event.actor}:${capturedAtMs}:${workspaceSessionId}`
    && workspaceStatus !== null
    && surface === 'standard'
    && roomPhase !== null
    && properties.proxyUrlPersisted === false
    && event.text === expectedText;
}

async function codeServerFileObservationSourceRef(input: {
  event: SessionEvent;
  node: CandidateNode;
  properties: JsonObject;
}): Promise<SessionEventExactSourceRef | null> {
  if (!codeServerFileObservationIsSourceBacked(input.event, input.properties)) return null;

  const action = stringProperty(input.properties, 'action')!;
  const path = stringProperty(input.properties, 'path')!;
  const observedAt = stringProperty(input.properties, 'observedAt')!;
  const fileContentHash = stringProperty(input.properties, 'contentHash')!;
  const codeServerFileChangeId = stringProperty(input.properties, 'codeServerFileChangeId');
  const sizeBytes = numberProperty(input.properties, 'sizeBytes')!;
  const workspaceSessionId = stringProperty(input.properties, 'workspaceSessionId');
  const workspaceRoot = stringProperty(input.properties, 'workspaceRoot');
  const repoUrl = stringProperty(input.properties, 'repoUrl');
  const contentPreview = typeof input.properties.contentPreview === 'string'
    ? input.properties.contentPreview
    : null;
  const observation = {
    sourceKind: 'code_server_workspace.file_observation',
    eventType: input.event.type,
    sessionId: input.event.sessionId,
    candidateId: input.event.candidateId,
    candidateNodeId: input.node.id,
    actor: input.event.actor,
    path,
    action,
    observedAt,
    fileContentHash,
    sizeBytes,
    contentPreview,
    observedBy: stringProperty(input.properties, 'observedBy'),
    bridgeEventType: 'FILE_CHANGED',
    editorSurface: 'code-server',
    codeServerFileChangeId,
    bridgePersisted: input.properties.bridgePersisted === true,
    workspaceSessionId,
    workspaceRoot,
    workspaceStatus: stringProperty(input.properties, 'workspaceStatus'),
    repoUrl,
    surface: stringProperty(input.properties, 'surface'),
    roomPhase: stringProperty(input.properties, 'roomPhase'),
  };
  const exactText = stableJson(observation);

  return {
    sourceRefType: 'code_server_file_observation',
    sourceRefId: codeServerFileChangeId ?? `${input.node.id}:${action}:${path}:${fileContentHash.slice(0, 16)}`,
    evidenceRole: input.event.type === 'file_change' ? 'workspace_file_delete' : 'workspace_file_save',
    locator: {
      sessionId: input.event.sessionId,
      candidateId: input.event.candidateId,
      candidateNodeId: input.node.id,
      eventType: input.event.type,
      path,
      action,
      observedAt,
      codeServerFileChangeId,
      workspaceSessionId,
      workspaceRoot,
      repoUrl,
    },
    exactText,
    contentHash: await sha256Hex(exactText),
    metadata: {
      sourceKind: 'code_server_workspace.file_observation',
      observedBy: stringProperty(input.properties, 'observedBy'),
      codeServerFileChangeId,
      bridgePersisted: input.properties.bridgePersisted === true,
      fileContentHash,
      sizeBytes,
      hasContentPreview: contentPreview !== null,
    },
  };
}

interface DirectRoomActivitySourceSpec {
  sourceRefType: string;
  sourceRefId: string;
  evidenceRole: string;
  sourceKind: string;
  locator: JsonObject;
  metadata?: JsonObject;
}

function directRoomActivitySourceSpec(
  event: SessionEvent,
  node: CandidateNode,
  properties: JsonObject,
): DirectRoomActivitySourceSpec | null {
  const baseLocator: JsonObject = {
    sessionId: event.sessionId,
    candidateId: event.candidateId,
    candidateNodeId: node.id,
    eventType: event.type,
    actor: event.actor,
    timestamp: event.timestamp,
    surface: stringProperty(properties, 'surface'),
    roomPhase: stringProperty(properties, 'roomPhase'),
    capturedAtMs: numberProperty(properties, 'capturedAtMs'),
    roomEventId: stringProperty(properties, 'roomEventId'),
    clientId: stringProperty(properties, 'clientId'),
  };

  if (event.type === 'media_control') {
    const control = stringProperty(properties, 'control');
    const previousEnabled = properties.previousEnabled;
    const enabled = properties.enabled;
    const mediaControlId = stringProperty(properties, 'mediaControlId');
    if (
      !control
      || typeof previousEnabled !== 'boolean'
      || typeof enabled !== 'boolean'
      || !mediaControlId
      || !isSourceBackedMediaControlEvidence(properties, event.actor, control, previousEnabled, enabled)
    ) {
      return null;
    }
    return {
      sourceRefType: 'room_media_control',
      sourceRefId: mediaControlId,
      evidenceRole: `${control}_${enabled ? 'enabled' : 'disabled'}`,
      sourceKind: 'video_room.media_control',
      locator: {
        ...baseLocator,
        mediaControlId,
        control,
        previousEnabled,
        enabled,
        action: stringProperty(properties, 'action'),
        controlSurface: stringProperty(properties, 'controlSurface'),
      },
      metadata: {
        mediaSource: stringProperty(properties, 'mediaSource'),
        rawMediaStreamPersisted: properties.rawMediaStreamPersisted === true,
      },
    };
  }

  if (event.type === 'recording_start' || event.type === 'recording_stop') {
    const lifecycleKind = stringProperty(properties, 'recordingLifecycleKind');
    const status = stringProperty(properties, 'recordingStatus');
    const active = properties.recordingActive;
    const recordingStateEventId = stringProperty(properties, 'recordingStateEventId');
    if (
      (lifecycleKind !== 'start' && lifecycleKind !== 'stop')
      || (status !== 'recording' && status !== 'uploading' && status !== 'saved' && status !== 'failed')
      || typeof active !== 'boolean'
      || !recordingStateEventId
      || !isSourceBackedRecordingStateEvidence(properties, lifecycleKind, status, active)
    ) {
      return null;
    }
    return {
      sourceRefType: 'room_recording_state',
      sourceRefId: recordingStateEventId,
      evidenceRole: event.type,
      sourceKind: 'video_room.recording_state',
      locator: {
        ...baseLocator,
        recordingStateEventId,
        lifecycleKind,
        recordingStatus: status,
        recordingActive: active,
        speakerChannelLayout: stringProperty(properties, 'speakerChannelLayout'),
        speakerChannelCount: numberProperty(properties, 'speakerChannelCount'),
      },
      metadata: {
        recordingEventSource: stringProperty(properties, 'recordingEventSource'),
        recordingStateEventSource: stringProperty(properties, 'recordingStateEventSource'),
        uploadStatus: stringProperty(properties, 'uploadStatus'),
        recordingFailureStage: stringProperty(properties, 'recordingFailureStage'),
        recordingFailureSource: stringProperty(properties, 'recordingFailureSource'),
        hasTranscriptionAudio: properties.hasTranscriptionAudio === true,
        speakerMetadataVersion: numberProperty(properties, 'speakerMetadataVersion'),
      },
    };
  }

  if (event.type === 'workspace_state') {
    const status = stringProperty(properties, 'workspaceStatus');
    const workspaceStateEventId = stringProperty(properties, 'workspaceStateEventId');
    if (!status || !workspaceStateEventId || !hasSourceBackedWorkspaceStateEvidence(properties, event.actor, status)) {
      return null;
    }
    return {
      sourceRefType: 'dev_container_workspace_state',
      sourceRefId: workspaceStateEventId,
      evidenceRole: 'workspace_state',
      sourceKind: 'dev_container.workspace_state',
      locator: {
        ...baseLocator,
        workspaceStateEventId,
        workspaceStatus: status,
        workspaceStateSource: stringProperty(properties, 'workspaceStateSource'),
        workspaceSessionId: stringProperty(properties, 'workspaceSessionId'),
        repoUrl: stringProperty(properties, 'repoUrl'),
        githubPrNumber: numberProperty(properties, 'githubPrNumber'),
        matchedRepoId: numberProperty(properties, 'matchedRepoId'),
        challengeStatus: stringProperty(properties, 'challengeStatus'),
        challengeKind: stringProperty(properties, 'challengeKind'),
      },
      metadata: {
        workspaceTelemetryPersisted: properties.workspaceTelemetryPersisted === true,
        proxyUrlPersisted: properties.proxyUrlPersisted === true,
        ttlSeconds: numberProperty(properties, 'ttlSeconds'),
        ttlSource: stringProperty(properties, 'ttlSource'),
        expiringSoon: properties.expiringSoon === true,
      },
    };
  }

  if (event.type === 'code_editor_open') {
    const codeEditorOpenId = stringProperty(properties, 'codeEditorOpenId');
    if (!codeEditorOpenId || !codeEditorOpenIsSourceBacked(event, properties)) return null;
    return {
      sourceRefType: 'code_server_editor_open',
      sourceRefId: codeEditorOpenId,
      evidenceRole: 'code_editor_open',
      sourceKind: 'code_server.editor_open',
      locator: {
        ...baseLocator,
        codeEditorOpenId,
        editor: stringProperty(properties, 'editor'),
        openStatus: stringProperty(properties, 'openStatus'),
        workspaceSessionId: stringProperty(properties, 'workspaceSessionId'),
        workspaceStatus: stringProperty(properties, 'workspaceStatus'),
        repoUrl: stringProperty(properties, 'repoUrl'),
        githubPrNumber: numberProperty(properties, 'githubPrNumber'),
        matchedRepoId: numberProperty(properties, 'matchedRepoId'),
        challengeStatus: stringProperty(properties, 'challengeStatus'),
        challengeKind: stringProperty(properties, 'challengeKind'),
      },
      metadata: {
        editorEventSource: stringProperty(properties, 'editorEventSource'),
        proxyUrlPersisted: properties.proxyUrlPersisted === true,
      },
    };
  }

  return null;
}

async function directRoomActivitySourceRef(input: {
  event: SessionEvent;
  node: CandidateNode;
  properties: JsonObject;
}): Promise<SessionEventExactSourceRef | null> {
  const spec = directRoomActivitySourceSpec(input.event, input.node, input.properties);
  if (!spec) return null;

  const exactText = stableJson({
    sourceKind: spec.sourceKind,
    sourceRefType: spec.sourceRefType,
    sourceRefId: spec.sourceRefId,
    eventType: input.event.type,
    sessionId: input.event.sessionId,
    candidateId: input.event.candidateId,
    candidateNodeId: input.node.id,
    actor: input.event.actor,
    timestamp: input.event.timestamp,
    text: input.event.text,
    properties: input.properties,
  });

  return {
    sourceRefType: spec.sourceRefType,
    sourceRefId: spec.sourceRefId,
    evidenceRole: spec.evidenceRole,
    locator: spec.locator,
    exactText,
    contentHash: await sha256Hex(exactText),
    metadata: {
      sourceKind: spec.sourceKind,
      eventType: input.event.type,
      actor: input.event.actor,
      durableObjectReplayExpected: input.properties.durableObjectReplayExpected === true,
      ...spec.metadata,
    },
  };
}

async function persistSessionEventContextRecord(
  db: D1Database,
  event: SessionEvent,
  node: CandidateNode,
): Promise<void> {
  const identity = await ensureCandidateLivingContext(db, event.candidateId);
  if (!identity) throw new Error(`Candidate "${event.candidateId}" could not be resolved`);

  const store = new LivingContextStore(db);
  const interaction = await store.upsertInteraction({
    ingestionKey: `legacy-source:${event.candidateId}:meeting_session:${event.sessionId}`,
    workspacePersonId: identity.workspacePersonId,
    applicationId: identity.applicationId,
    interactionType: 'meeting_session',
    externalReference: event.sessionId,
    metadata: {
      compatibilityProjection: true,
      sessionEventProjection: true,
    },
  });

  const narrative = formatEventNarrative(event);
  const properties = jsonObject(event.properties);
  const correlationRefs = sessionEventCorrelationRefs(event, properties);
  const sourceExactText = stableJson(sessionEventSourcePayload(event, node));
  const contentHash = await deterministicEntityId('content', sourceExactText);
  const sourceSpanId = await findCandidateNodeSourceSpanId(db, node.id);
  const chatTextSource = await chatTextSourceRef({ event, node, properties });
  const terminalTextSource = await terminalTextSourceRef({ event, node, properties });
  const codeServerFileSource = await codeServerFileObservationSourceRef({ event, node, properties });
  const directRoomActivitySource = await directRoomActivitySourceRef({ event, node, properties });
  const sources: ContextRecordSourceInput[] = [
    {
      sourceRefType: 'meeting_session_event',
      sourceRefId: node.id,
      evidenceRole: 'source_event',
      locator: {
        sessionId: event.sessionId,
        candidateId: event.candidateId,
        candidateNodeId: node.id,
        eventType: event.type,
        actor: event.actor,
        timestamp: event.timestamp,
      },
      exactText: sourceExactText,
      contentHash,
      metadata: {
        nodeType: node.node_type,
        sourceType: node.source_type,
        sourceReference: node.source_reference ?? null,
      },
    },
  ];
  if (chatTextSource) sources.push(chatTextSource);
  if (terminalTextSource) sources.push(terminalTextSource);
  if (codeServerFileSource) sources.push(codeServerFileSource);
  if (directRoomActivitySource) sources.push(directRoomActivitySource);
  if (sourceSpanId) {
    sources.push({
      sourceSpanId,
      evidenceRole: 'source_text',
      exactText: narrative,
      metadata: {
        source: 'legacy_candidate_node_span',
        candidateNodeId: node.id,
      },
    });
  }

  await store.upsertContextRecord({
    ingestionKey: `meeting-session-event:${node.id}:context-record`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    applicationId: identity.applicationId,
    recordType: 'meeting_session_event',
    predicate: `session_event:${event.type}`,
    narrative,
    qualifiers: {
      eventType: event.type,
      actor: event.actor,
      sessionId: event.sessionId,
      candidateId: event.candidateId,
      properties,
      ...(correlationRefs ? { correlationRefs } : {}),
      surface: stringProperty(properties, 'surface'),
      source: 'meeting_room_session_events',
    },
    confidence: node.confidence,
    polarity: 1,
    extractionVersion: 'meeting-session-event-v1',
    observedAt: observedAtFromTimestamp(event.timestamp),
    sources,
    entities: sessionEventEntities({
      event,
      node,
      workspacePersonId: identity.workspacePersonId,
      properties,
    }),
  });
}

function assessmentEventKindForSessionEvent(type: SessionEventType): string {
  switch (type) {
    case 'chat_message':
      return 'message';
    case 'ai_chat_user':
    case 'ai_chat_agent':
    case 'ai_agent_status':
      return 'ai_interaction';
    case 'terminal_command':
    case 'terminal_output':
      return 'terminal_output';
    case 'recording_start':
    case 'recording_stop':
      return 'transcript_span';
    case 'file_change':
    case 'workspace_state':
    case 'code_editor_open':
    case 'code_editor_save':
      return 'dev_container_event';
    case 'media_control':
    case 'participant_join':
    case 'participant_leave':
    default:
      return 'tool_usage';
  }
}

function assessmentActorForSessionEvent(event: SessionEvent): { actorType: AssessmentActorType; actorId: string | null } {
  const properties = jsonObject(event.properties);
  const source = stringProperty(properties, 'source');
  const explicitAgentId = stringProperty(properties, 'agent') ?? stringProperty(properties, 'agentName');
  const agentActorType: AssessmentActorType = explicitAgentId === 'devin' ? 'devin' : 'ai_agent';

  if (event.type === 'ai_chat_agent' || event.type === 'ai_agent_status') {
    return { actorType: agentActorType, actorId: explicitAgentId };
  }

  if (event.actor === 'guest') return { actorType: 'candidate', actorId: event.candidateId };
  if (event.actor === 'host') return { actorType: 'recruiter', actorId: 'host' };
  if (event.actor === 'agent') return { actorType: 'ai_agent', actorId: explicitAgentId };
  if (
    event.type === 'workspace_state'
    || event.type === 'code_editor_open'
    || event.type === 'code_editor_save'
    || (
      event.type === 'file_change'
      && (source === 'code_server_workspace' || stringProperty(properties, 'observedBy') === 'agent_bridge')
    )
  ) {
    return { actorType: 'dev_container', actorId: stringProperty(properties, 'workspaceSessionId') };
  }

  return { actorType: 'system', actorId: null };
}

async function currentAssessmentState(
  db: D1Database,
  sessionId: string,
): Promise<AssessmentSessionState | null> {
  const row = await db.prepare(
    'SELECT state FROM assessment_sessions WHERE id = ?1',
  ).bind(sessionId).first<{ state: AssessmentSessionState }>();
  return row?.state ?? null;
}

async function markAssessmentSessionInProgress(input: {
  db: D1Database;
  store: AssessmentLayerStore;
  sessionId: string;
}): Promise<void> {
  const state = await currentAssessmentState(input.db, input.sessionId);
  if (state !== 'INTAKE') return;
  await input.store.transitionAssessmentState({
    sessionId: input.sessionId,
    toState: 'IN_PROGRESS',
    reason: 'Assessment room session event captured as assessment evidence.',
    actorType: 'system',
  });
}

function assessmentInterviewIdForSessionEvent(event: SessionEvent): string | null {
  const properties = jsonObject(event.properties);
  return stringProperty(properties, 'assessmentInterviewId')
    ?? stringProperty(properties, 'scheduledInterviewId');
}

async function loadExistingAssessmentSessionForSessionEvent(
  db: D1Database,
  event: SessionEvent,
): Promise<{ id: string; mode: string } | null> {
  const assessmentInterviewId = assessmentInterviewIdForSessionEvent(event);
  if (!assessmentInterviewId) return null;
  return db.prepare(
    `SELECT id, mode
       FROM assessment_sessions
     WHERE interview_id = ?1
       AND state <> 'CANCELLED'
       AND (candidate_id IS NULL OR candidate_id = ?2)
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT 1`,
  ).bind(assessmentInterviewId, event.candidateId).first<{ id: string; mode: string }>();
}

async function persistSessionEventAssessmentEvidence(
  db: D1Database,
  event: SessionEvent,
  node: CandidateNode,
): Promise<void> {
  if (!await tableExists(db, 'assessment_sessions')) return;

  const observedAt = observedAtFromTimestamp(event.timestamp);
  const store = new AssessmentLayerStore(db, () => observedAt);
  const properties = jsonObject(event.properties);
  const assessmentInterviewId = assessmentInterviewIdForSessionEvent(event);
  const existingSession = await loadExistingAssessmentSessionForSessionEvent(db, event);
  const session = existingSession ?? await store.createAssessmentSession({
    ingestionKey: `assessment-session:room:${event.candidateId}:${event.sessionId}`,
    interviewId: event.sessionId,
    mode: 'DEV_CONTAINER_REPO_TASK',
    candidateId: event.candidateId,
    workspaceId: null,
    createdBy: 'meeting-room-session-events',
    metadata: {
      meetingSessionId: event.sessionId,
      ...(assessmentInterviewId ? { scheduledInterviewId: assessmentInterviewId } : {}),
      surface: stringProperty(properties, 'surface'),
      source: 'meeting_room_session_events',
      assessmentSurface: 'assessment_room',
    },
  });
  const { actorType, actorId } = assessmentActorForSessionEvent(event);
  const narrative = formatEventNarrative(event);
  const sourceExactText = stableJson(sessionEventSourcePayload(event, node));
  const chatTextSource = await chatTextSourceRef({ event, node, properties });
  const terminalTextSource = await terminalTextSourceRef({ event, node, properties });
  const codeServerFileSource = await codeServerFileObservationSourceRef({ event, node, properties });
  const directRoomActivitySource = await directRoomActivitySourceRef({ event, node, properties });
  const sourceRefs: AssessmentEvidenceSourceRefInput[] = [
    {
      sourceRefType: 'meeting_session_event',
      sourceRefId: node.id,
      evidenceRole: 'source_event',
      locator: {
        sessionId: event.sessionId,
        candidateId: event.candidateId,
        candidateNodeId: node.id,
        eventType: event.type,
        actor: event.actor,
        timestamp: event.timestamp,
      },
      exactText: sourceExactText,
      contentHash: await sha256Hex(sourceExactText),
      metadata: {
        sourceKind: 'meeting_session_event.source_packet',
        candidateNodeType: node.node_type,
        sourceReference: node.source_reference ?? null,
      },
    },
    ...(chatTextSource ? [chatTextSource] : []),
    ...(terminalTextSource ? [terminalTextSource] : []),
    ...(codeServerFileSource ? [codeServerFileSource] : []),
    ...(directRoomActivitySource ? [directRoomActivitySource] : []),
  ];

  await store.recordAssessmentEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:room:${node.id}`,
    kind: assessmentEventKindForSessionEvent(event.type),
    actorType,
    actorId,
    narrative,
    payload: {
      sessionEventType: event.type,
      meetingSessionId: event.sessionId,
      ...(assessmentInterviewId ? { scheduledInterviewId: assessmentInterviewId } : {}),
      candidateNodeId: node.id,
      actor: event.actor,
      properties,
    },
    occurredAt: observedAt,
    sourceRefs,
  });

  await markAssessmentSessionInProgress({ db, store, sessionId: session.id });
}

/**
 * Persist a session event into D1 as both compatibility candidate_node data and
 * a source-backed meeting_session_event context record, then mirror to Neo4j.
 */
export async function captureSessionEvent(
  db: D1Database,
  event: SessionEvent,
  env?: { NEO4J_URI?: string; NEO4J_USER?: string; NEO4J_PASSWORD?: string },
): Promise<CandidateNode | null> {
  try {
    const safeEvent = sanitizedAgentBridgeSessionEvent(event);
    if (!safeEvent) return null;
    const payload = eventToNodePayload(safeEvent);
    const node = await insertCandidateNode(db, payload, {
      ingestionKeyOverride: sessionEventIngestionKey(safeEvent),
    });
    await persistSessionEventContextRecord(db, safeEvent, node);
    await persistSessionEventAssessmentEvidence(db, safeEvent, node);

    // Fire-and-forget write to Neo4j graph
    if (env?.NEO4J_URI && env?.NEO4J_PASSWORD) {
      writeCandidateGraphFireAndForget({
        candidateId: event.candidateId,
        nodes: [node],
        env,
      });
    }

    return node;
  } catch (err) {
    console.error('[sessionEvents] Failed to capture event:', err);
    return null;
  }
}

/**
 * Batch capture multiple events at once.
 */
export async function captureSessionEvents(
  db: D1Database,
  events: SessionEvent[],
  env?: { NEO4J_URI?: string; NEO4J_USER?: string; NEO4J_PASSWORD?: string },
): Promise<{ captured: number; failed: number }> {
  let captured = 0;
  let failed = 0;

  // Batch insert to D1, then fire-and-forget Neo4j write
  const nodes: CandidateNode[] = [];
  for (const event of events) {
    try {
      const payload = eventToNodePayload(event);
      const node = await insertCandidateNode(db, payload, {
        ingestionKeyOverride: sessionEventIngestionKey(event),
      });
      await persistSessionEventContextRecord(db, event, node);
      await persistSessionEventAssessmentEvidence(db, event, node);
      nodes.push(node);
      captured++;
    } catch {
      failed++;
    }
  }

  if (nodes.length > 0 && env?.NEO4J_URI && env?.NEO4J_PASSWORD) {
    // Group by candidateId for Neo4j writes
    const byCandidate = new Map<string, CandidateNode[]>();
    for (const node of nodes) {
      const existing = byCandidate.get(node.candidate_id) ?? [];
      existing.push(node);
      byCandidate.set(node.candidate_id, existing);
    }
    for (const [candidateId, candidateNodes] of byCandidate) {
      writeCandidateGraphFireAndForget({
        candidateId,
        nodes: candidateNodes,
        env,
      });
    }
  }

  return { captured, failed };
}

/**
 * Replay the authoritative Durable Object room activity log into candidate
 * session evidence. The candidate node insertion path is deterministic, so
 * callers can safely run this before graph reads, post-interview processing,
 * or debugging tools without duplicating evidence.
 */
export async function syncRoomActivityToSessionEvents(
  db: D1Database,
  env: RoomActivitySyncEnv,
  input: RoomActivitySyncInput,
): Promise<RoomActivitySyncResult> {
  if (!env.VIDEO_ROOM) return { captured: 0, failed: 0, events: 0 };

  try {
    const roomId = env.VIDEO_ROOM.idFromName(input.sessionId);
    const room = env.VIDEO_ROOM.get(roomId);
    const response = await room.fetch(new Request('https://do/activity-log'));
    if (!response.ok) return { captured: 0, failed: 0, events: 0 };
    const snapshot = await response.json().catch(() => null);
    const events = await roomActivitySnapshotToSessionEvents(snapshot, input);
    if (events.length === 0) return { captured: 0, failed: 0, events: 0 };
    const result = await captureSessionEvents(db, events, env);
    return {
      ...result,
      events: events.length,
    };
  } catch (error) {
    console.error('[sessionEvents] Failed to sync room activity:', {
      sessionId: input.sessionId,
      candidateId: input.candidateId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { captured: 0, failed: 0, events: 0 };
  }
}

/**
 * Retrieve the full session context graph for a candidate.
 * Returns all session event nodes, ordered by timestamp.
 */
export async function getSessionContextGraph(
  db: D1Database,
  candidateId: string,
  sessionId?: string,
): Promise<SessionContextNode[]> {
  const nodes = sessionId
    ? await db
        .prepare(
          `SELECT * FROM candidate_nodes
           WHERE candidate_id = ?1 AND source_type = 'meeting_session' AND source_reference = ?2
           ORDER BY captured_at ASC`,
        )
        .bind(candidateId, sessionId)
        .all<CandidateNode>()
    : await db
        .prepare(
          `SELECT * FROM candidate_nodes
           WHERE candidate_id = ?1 AND source_type = 'meeting_session'
           ORDER BY captured_at ASC`,
        )
        .bind(candidateId)
        .all<CandidateNode>();

  return (nodes.results ?? []).map(nodeToContextNode);
}

/**
 * Get a compact text summary of the session context — useful for
 * passing as system prompt context to the AI agent.
 */
export async function getSessionContextSummary(
  db: D1Database,
  candidateId: string,
  sessionId?: string,
): Promise<string> {
  const graph = await getSessionContextGraph(db, candidateId, sessionId);
  if (graph.length === 0) return '';

  const lines: string[] = [
    `=== Session Context (${graph.length} events) ===`,
  ];

  // Group by event category
  const byCategory = new Map<string, SessionContextNode[]>();
  for (const node of graph) {
    const category = node.nodeType.replace('session_', '').split('_')[0] ?? 'other';
    const existing = byCategory.get(category) ?? [];
    existing.push(node);
    byCategory.set(category, existing);
  }

  for (const [category, nodes] of byCategory) {
    lines.push(`\n--- ${category.toUpperCase()} (${nodes.length} events) ---`);
    for (const node of nodes.slice(0, 20)) {
      lines.push(`${node.narrativeText} ${formatContextSourceRef(node)}`);
    }
    if (nodes.length > 20) {
      lines.push(`... and ${nodes.length - 20} more`);
    }
  }

  return lines.join('\n');
}

export interface SessionContextNode {
  id: string;
  nodeType: string;
  narrativeText: string;
  properties: Record<string, unknown> | null;
  capturedAt: number;
  sessionId: string;
}

const CONTEXT_SOURCE_REF_KEYS = [
  'roomMessageId',
  'roomEventId',
  'workspaceStateEventId',
  'fileChangeId',
  'codeEditorOpenId',
  'terminalCommandId',
  'terminalOutputChunkId',
  'promptId',
  'agentChatResponseId',
  'agentStatusEventId',
  'recordingEventId',
  'recordingStateEventId',
  'mediaControlId',
] as const;

function contextCapturedAtIso(capturedAt: number): string {
  const ms = Number.isFinite(capturedAt) ? capturedAt * 1000 : Number.NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : 'unknown';
}

function contextPrimaryEventRef(properties: Record<string, unknown> | null): string | null {
  if (!properties) return null;
  for (const key of CONTEXT_SOURCE_REF_KEYS) {
    const value = stringOrNull(properties[key]);
    if (value) return `${key}=${value}`;
  }
  return null;
}

function contextLinkedPromptRef(properties: Record<string, unknown> | null): string | null {
  if (!properties) return null;
  const browserPromptId = stringOrNull(properties.browserPromptId);
  return browserPromptId ? `linkedPromptId=${browserPromptId}` : null;
}

function formatContextSourceRef(node: SessionContextNode): string {
  const parts = [
    `node=${node.id}`,
    `type=${node.nodeType}`,
    `session=${node.sessionId || 'unknown'}`,
    `capturedAt=${contextCapturedAtIso(node.capturedAt)}`,
  ];
  const source = stringOrNull(node.properties?.source);
  if (source) parts.push(`source=${source}`);
  const eventRef = contextPrimaryEventRef(node.properties);
  if (eventRef) parts.push(eventRef);
  const linkedPromptRef = contextLinkedPromptRef(node.properties);
  if (linkedPromptRef) parts.push(linkedPromptRef);
  return `[source_ref: ${parts.join('; ')}]`;
}

interface RoomResolutionRow {
  session_id: string;
  meeting_id: string;
  meeting_owner_id: string;
  meeting_contact_id: string | null;
  scheduled_interview_id: string | null;
}

interface InterviewResolutionRow {
  candidate_id: string | null;
  owner_id: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
}

interface ContactResolutionRow {
  name: string | null;
  email: string | null;
}

function nodeToContextNode(node: CandidateNode): SessionContextNode {
  let properties: Record<string, unknown> | null = null;
  try {
    properties = node.extracted_properties_json
      ? JSON.parse(node.extracted_properties_json)
      : null;
  } catch {
    // ignore
  }
  return {
    id: node.id,
    nodeType: node.node_type,
    narrativeText: node.narrative_text,
    properties,
    capturedAt: node.captured_at,
    sessionId: node.source_reference ?? '',
  };
}

function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email ? email : null;
}

async function ensureRolelessCandidateForSession(
  db: D1Database,
  input: {
    ownerId: string;
    name: string | null;
    email: string;
    scheduledInterviewId: string | null;
  },
): Promise<string> {
  const existing = await db
    .prepare(
      `SELECT id FROM candidates
       WHERE owner_id = ?1 AND lower(email) = ?2 AND pipeline_id IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .bind(input.ownerId, input.email)
    .first<{ id: string }>();

  const now = new Date().toISOString();
  if (existing) {
    if (input.scheduledInterviewId) {
      await db
        .prepare(
          `UPDATE scheduled_interviews
              SET candidate_id = COALESCE(candidate_id, ?1), updated_at = ?2
            WHERE id = ?3`,
        )
        .bind(existing.id, now, input.scheduledInterviewId)
        .run();
    }
    return existing.id;
  }

  const candidateId = crypto.randomUUID();
  const inviteToken = crypto.randomUUID();
  const fallbackName = input.name?.trim() || input.email.split('@')[0] || 'Candidate';
  await db
    .prepare(
      `INSERT INTO candidates (
         id, pipeline_id, owner_id, name, email, invite_token, status,
         current_stage_id, created_at, updated_at
       ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, 'INVITED', NULL, ?6, ?6)`,
    )
    .bind(candidateId, input.ownerId, fallbackName, input.email, inviteToken, now)
    .run();

  await db
    .prepare(
      `INSERT INTO candidate_ingestion (candidate_id, status, created_at, updated_at)
       VALUES (?1, 'pending', ?2, ?2)
       ON CONFLICT(candidate_id) DO NOTHING`,
    )
    .bind(candidateId, now)
    .run()
    .catch(() => undefined);

  if (input.scheduledInterviewId) {
    await db
      .prepare(
        `UPDATE scheduled_interviews
            SET candidate_id = ?1, updated_at = ?2
          WHERE id = ?3`,
      )
      .bind(candidateId, now, input.scheduledInterviewId)
      .run();
  }

  return candidateId;
}

/**
 * Resolve the candidate_id for a meeting room token.
 * Traces: token → room → meeting → scheduled_interview/contact → candidate_id.
 */
export async function resolveCandidateIdForRoom(
  db: D1Database,
  token: string,
): Promise<{
  candidateId: string | null;
  sessionId: string;
  meetingId: string;
  scheduledInterviewId: string | null;
} | null> {
  const { hashRoomToken } = await import('./roomTokens.js');
  const tokenHash = await hashRoomToken(token);
  const now = new Date().toISOString();

  const room = await db.prepare(
    `SELECT mr.session_id, mr.meeting_id, m.owner_id AS meeting_owner_id,
            m.scheduled_interview_id,
            (
              SELECT mp.contact_id
                FROM meeting_participants mp
               WHERE mp.meeting_id = m.id
                 AND mp.role = 'ATTENDEE'
               ORDER BY mp.created_at DESC
               LIMIT 1
            ) AS meeting_contact_id
     FROM meeting_room_tokens mrt
     INNER JOIN meeting_rooms mr ON mr.id = mrt.room_id
     INNER JOIN meetings m ON m.id = mr.meeting_id
     WHERE mrt.token_hash = ? AND mrt.revoked_at IS NULL AND mrt.expires_at > ?`,
  ).bind(tokenHash, now).first<RoomResolutionRow>();

  if (!room) return null;

  let candidateId: string | null = null;
  let ownerId = room.meeting_owner_id;
  let recipientName: string | null = null;
  let recipientEmail: string | null = null;

  if (room.scheduled_interview_id) {
    const interview = await db.prepare(
      `SELECT candidate_id, owner_id, recipient_name, recipient_email
         FROM scheduled_interviews
        WHERE id = ?`,
    ).bind(room.scheduled_interview_id).first<InterviewResolutionRow>();
    candidateId = interview?.candidate_id ?? null;
    ownerId = interview?.owner_id ?? ownerId;
    recipientName = interview?.recipient_name ?? null;
    recipientEmail = normalizeEmail(interview?.recipient_email);
  }

  if (!candidateId && room.meeting_contact_id) {
    const contact = await db
      .prepare('SELECT name, email FROM contacts WHERE id = ?')
      .bind(room.meeting_contact_id)
      .first<ContactResolutionRow>();
    recipientName = recipientName ?? contact?.name ?? null;
    recipientEmail = recipientEmail ?? normalizeEmail(contact?.email);
  }

  if (!candidateId && ownerId && recipientEmail) {
    candidateId = await ensureRolelessCandidateForSession(db, {
      ownerId,
      name: recipientName,
      email: recipientEmail,
      scheduledInterviewId: room.scheduled_interview_id,
    });
  }

  return {
    candidateId,
    sessionId: room.session_id,
    meetingId: room.meeting_id,
    scheduledInterviewId: room.scheduled_interview_id,
  };
}
