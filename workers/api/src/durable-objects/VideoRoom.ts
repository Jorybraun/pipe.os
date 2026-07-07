/**
 * VideoRoom Durable Object — WebRTC signaling room.
 *
 * Each video session gets its own DO instance (keyed by session ID).
 * Manages WebSocket connections for two peers (recruiter + candidate)
 * and routes signaling messages between them.
 *
 * Uses the Hibernation API — peer tracking via state.getWebSockets()
 * (survives hibernation) instead of in-memory Maps (lost on wake).
 *
 * Session lifecycle: WAITING → CALLING → ACTIVE → ENDED
 *
 * Messages are JSON-encoded with the format:
 *   { type: 'OFFER' | 'ANSWER' | 'ICE_CANDIDATE' | 'HANGUP' | 'STATUS_UPDATE',
 *     role: 'RECRUITER' | 'CANDIDATE',
 *     payload: ... }
 *
 * Status updates are broadcast to both peers:
 *   { type: 'STATUS_UPDATE', status: 'WAITING' | 'CALLING' | 'ACTIVE' | 'ENDED' }
 */

import type { DurableObjectState } from '@cloudflare/workers-types';

type VideoRole = 'RECRUITER' | 'CANDIDATE' | 'HOST' | 'GUEST';
type SessionStatus = 'WAITING' | 'CALLING' | 'ACTIVE' | 'ENDED';
type SignalStatus = SessionStatus | 'LEFT';
type RoomSurface = 'standard';
const TERMINAL_FINGERPRINT_RE = /^terminal_[0-9a-f]{8}$/;
const TERMINAL_COMMAND_ID_RE = /^.+:command:(host|guest):\d+:\d+:terminal_[0-9a-f]{8}$/;
const ROOM_CHAT_MESSAGE_FINGERPRINT_RE = /^chat_[0-9a-f]{8}$/;
const AGENT_PROMPT_FINGERPRINT_RE = /^agent_[0-9a-f]{8}$/;
const BROWSER_PROMPT_ID_RE = /^[a-zA-Z0-9:_-]+:(host|guest):prompt:\d+:agent_[0-9a-f]{8}$/;
const AGENT_CHAT_RESPONSE_FINGERPRINT_RE = /^agent_[0-9a-f]{8}$/;
const AGENT_CHAT_RESPONSE_ID_RE = /^agent-chat:[a-zA-Z0-9:_-]+:\d+:CHAT_RESPONSE:agent_[0-9a-f]{8}$/;
const AGENT_STATUS_EVENT_ID_RE = /^agent-status:[a-zA-Z0-9:_-]+:\d+:[a-z_]+:[a-zA-Z0-9:_-]+:[a-zA-Z0-9:_-]+$/;
const AGENT_STATUSES = new Set(['starting', 'idle', 'thinking', 'working', 'auth_needed', 'disconnected']);
const AGENT_STATUS_MESSAGE_SOURCES = new Set(['agent_status', 'agent_stdout', 'agent_api_response', 'bridge_diagnostic', 'bridge_observation']);
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
const RECORDING_STATE_EVENT_ID_RE = /^recording:host:\d+:(start|stop):(recording|uploading|saved|failed)$/;
const RECORDING_FAILURE_STAGES = new Set(['stop_recorder', 'prepare_upload', 'upload_request']);
const RECORDING_FAILURE_SOURCES = new Set([
  'browser_media_recorder_exception',
  'browser_blob_builder_exception',
  'recording_upload_exception',
]);
const MAX_RECORDING_FAILURE_MESSAGE_LENGTH = 240;
const FNV_32_OFFSET = 0x811c9dc5;
const FNV_32_PRIME = 0x01000193;
const WORKSPACE_REDACTED_SECRET = '[REDACTED_SECRET]';
const WORKSPACE_BARE_SECRET_RE = /\b(?:cog|ghp|gho|ghu|ghs|ghr|devin)_[A-Za-z0-9_-]{20,}\b/g;
const WORKSPACE_GITHUB_PAT_RE = /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g;
const WORKSPACE_OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const WORKSPACE_BEARER_TOKEN_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const WORKSPACE_ENV_SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_]*(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD))=([^\s"'`]+)/gi;
const WORKSPACE_SECRET_QUERY_RE = /([?&](?:api_key|key|token|secret|password)=)[^&\s]+/gi;
const WORKSPACE_ROOM_TOKEN_PATH_RE = /(\/api\/v1\/meeting-rooms\/)[^/\s]+/g;

interface SignalMessage {
  type:
    | 'OFFER'
    | 'ANSWER'
    | 'ICE_CANDIDATE'
    | 'HANGUP'
    | 'STATUS_UPDATE'
    | 'ROOM_AGENT_INTERACTION'
    | 'ROOM_CHAT_MESSAGE'
    | 'ROOM_MEDIA_CONTROL'
    | 'ROOM_RECORDING_STATE'
    | 'ROOM_CODE_SERVER_FILE_EVENT'
    | 'ROOM_TERMINAL_EVENT';
  role?: VideoRole;
  status?: SignalStatus;
  payload?: unknown;
}

function safeEvidenceIdPart(value: unknown): string {
  const raw = typeof value === 'string' ? value : 'none';
  const normalized = raw
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'none';
}

function roomChatMessageFingerprint(text: string): string {
  let hash = FNV_32_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_32_PRIME);
  }
  return `chat_${(hash >>> 0).toString(16).padStart(8, '0')}`;
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

type RoomMediaControlKind = 'microphone' | 'camera';

interface RoomMediaControlEvent {
  id: string;
  clientId: string;
  createdAt: number;
  role: VideoRole;
  control: RoomMediaControlKind;
  previousEnabled: boolean;
  enabled: boolean;
  evidence?: Record<string, unknown>;
}

interface RoomMediaControlState {
  role: VideoRole;
  microphoneEnabled?: boolean;
  cameraEnabled?: boolean;
  updatedAt: number;
  evidence?: Record<string, unknown>;
}

interface RoomMediaControlActivityEntry {
  event: RoomMediaControlEvent;
  role: VideoRole;
  recordedAt: number;
}

type RoomRecordingLifecycleKind = 'start' | 'stop';
type RoomRecordingStatus = 'recording' | 'uploading' | 'saved' | 'failed';

interface RoomRecordingStateEvent {
  id: string;
  clientId: string;
  createdAt: number;
  role: VideoRole;
  lifecycleKind: RoomRecordingLifecycleKind;
  status: RoomRecordingStatus;
  active: boolean;
  evidence?: Record<string, unknown>;
}

interface RoomRecordingState {
  role: VideoRole;
  status: RoomRecordingStatus;
  active: boolean;
  updatedAt: number;
  evidence?: Record<string, unknown>;
}

interface RoomRecordingActivityEntry {
  event: RoomRecordingStateEvent;
  role: VideoRole;
  recordedAt: number;
}

type RoomAgentInteractionEventType = 'ai_chat_user' | 'ai_chat_agent' | 'ai_agent_status';

interface RoomAgentInteractionEvent {
  id: string;
  clientId: string;
  createdAt: number;
  eventType: RoomAgentInteractionEventType;
  actor: 'host' | 'guest' | 'agent' | 'system';
  text: string;
  evidence?: Record<string, unknown>;
}

interface RoomAgentInteractionActivityEntry {
  event: RoomAgentInteractionEvent;
  role: VideoRole;
  recordedAt: number;
}

interface RoomChatMessage {
  id: string;
  clientId: string;
  createdAt: number;
  role: VideoRole;
  text: string;
  deliveryStatus?: 'pending' | 'accepted' | 'rejected';
  evidence?: Record<string, unknown>;
}

interface RoomChatActivityEntry {
  message: RoomChatMessage;
  role: VideoRole;
  recordedAt: number;
}

type RoomCodeServerFileEventType = 'code_editor_save' | 'file_change';

interface RoomCodeServerFileEvent {
  id: string;
  clientId: string;
  createdAt: number;
  eventType: RoomCodeServerFileEventType;
  actor: 'system';
  text: string;
  evidence?: Record<string, unknown>;
}

interface RoomCodeServerFileActivityEntry {
  event: RoomCodeServerFileEvent;
  role: VideoRole;
  recordedAt: number;
}

type RoomTerminalEvent =
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

interface RoomTerminalActivityEntry {
  event: RoomTerminalEvent;
  role: VideoRole;
  recordedAt: number;
}

interface VideoRoomMetadata {
  stageId?: string;
  candidateId?: string;
  recruiterId?: string;
  scheduledInterviewId?: string;  // For transcript artifact association
  meetingId?: string;
  hostId?: string;
}

export class VideoRoom {
  private state: DurableObjectState;
  private sessionStatus: SessionStatus = 'WAITING';
  private metadata: VideoRoomMetadata = {};

  constructor(state: DurableObjectState) {
    this.state = state;

    // Restore status from storage on cold start
    void state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<unknown>('status');
      if (this.isSessionStatus(stored)) this.sessionStatus = stored;
      const meta = await state.storage.get<VideoRoomMetadata>('metadata');
      if (meta) this.metadata = meta;
      const offer = await state.storage.get<string>('lastOffer');
      if (offer) this._lastOffer = offer;
    });
  }

  private _lastOffer: string | null = null;

  // ── Helpers: use Hibernation API for peer tracking ──────────────────────

  /** Get all active WebSockets for a specific role */
  private getWebSocketsByRole(role: VideoRole): WebSocket[] {
    return this.state.getWebSockets(role);
  }

  /** Get the role tag from a WebSocket */
  private getRoleFromWs(ws: WebSocket): VideoRole | null {
    const tags = this.state.getTags(ws);
    if (tags.includes('RECRUITER')) return 'RECRUITER';
    if (tags.includes('CANDIDATE')) return 'CANDIDATE';
    if (tags.includes('HOST')) return 'HOST';
    if (tags.includes('GUEST')) return 'GUEST';
    return null;
  }

  private isHostRole(role: VideoRole): boolean {
    return role === 'RECRUITER' || role === 'HOST';
  }

  private remoteRole(role: VideoRole): VideoRole {
    if (role === 'RECRUITER') return 'CANDIDATE';
    if (role === 'CANDIDATE') return 'RECRUITER';
    if (role === 'HOST') return 'GUEST';
    return 'HOST';
  }

  private isSessionStatus(status: unknown): status is SessionStatus {
    return status === 'WAITING'
      || status === 'CALLING'
      || status === 'ACTIVE'
      || status === 'ENDED';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private isRoomSurface(value: unknown): value is RoomSurface {
    return value === 'standard';
  }

  private isVideoRole(value: unknown): value is VideoRole {
    return value === 'RECRUITER'
      || value === 'CANDIDATE'
      || value === 'HOST'
      || value === 'GUEST';
  }

  private isRoomAgentInteractionEventType(value: unknown): value is RoomAgentInteractionEventType {
    return value === 'ai_chat_user'
      || value === 'ai_chat_agent'
      || value === 'ai_agent_status';
  }

  private safeAgentInteractionTextOrNull(eventType: RoomAgentInteractionEventType, value: unknown): string | undefined {
    if (eventType === 'ai_chat_agent' || eventType === 'ai_agent_status') {
      return this.safeWorkspaceDiagnosticOrNull(value, 8000) ?? undefined;
    }
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 8000) return undefined;
    return value;
  }

  private parseAgentInteractionEvent(value: unknown): RoomAgentInteractionEvent | null {
    if (!this.isRecord(value)) return null;
    if (
      !this.isSafeFileText(value.id, 160)
      || !this.isSafeFileText(value.clientId, 160)
      || typeof value.createdAt !== 'number'
      || !Number.isFinite(value.createdAt)
      || !this.isRoomAgentInteractionEventType(value.eventType)
      || (
        value.actor !== 'host'
        && value.actor !== 'guest'
        && value.actor !== 'agent'
        && value.actor !== 'system'
      )
    ) {
      return null;
    }
    const text = this.safeAgentInteractionTextOrNull(value.eventType, value.text);
    if (!text) return null;
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      eventType: value.eventType,
      actor: value.actor,
      text,
      evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
    };
  }

  private hasSourceBackedAgentInteractionEvidence(
    event: RoomAgentInteractionEvent,
    senderRole: VideoRole,
  ): boolean {
    const evidence = event.evidence;
    if (!this.isRecord(evidence) || evidence.durableObjectReplayExpected !== true) return false;
    const senderActor = this.isHostRole(senderRole) ? 'host' : 'guest';

    if (event.eventType === 'ai_chat_user') {
      const promptTimestamp = typeof evidence.promptTimestamp === 'number' && Number.isFinite(evidence.promptTimestamp)
        ? evidence.promptTimestamp
        : null;
      const promptFingerprint = typeof evidence.promptFingerprint === 'string' ? evidence.promptFingerprint : null;
      const workspaceSessionId = typeof evidence.workspaceSessionId === 'string' && evidence.workspaceSessionId.trim().length > 0
        ? evidence.workspaceSessionId
        : null;
      const workspacePart = safeEvidenceIdPart(workspaceSessionId);
      const deliveryStatus = evidence.bridgeDeliveryStatus === 'blocked' ? 'blocked' : 'queued';
      const deliveryOk = deliveryStatus === 'blocked'
        ? evidence.browserQueuedBridgeMessage === false
          && AGENT_PROMPT_BLOCKED_REASONS.has(String(evidence.bridgeBlockedReason))
        : evidence.browserQueuedBridgeMessage === true
          && workspaceSessionId !== null
          && typeof evidence.workspaceStatus === 'string';
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
        && evidence.promptId === `${workspacePart}:${event.actor}:prompt:${promptTimestamp}:${promptFingerprint}`
        && evidence.surface === 'standard'
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
        && evidence.surface === 'standard'
        && typeof evidence.roomPhase === 'string'
        && typeof evidence.messageTimestamp === 'number'
        && Number.isFinite(evidence.messageTimestamp)
        && evidence.messageTimestamp >= 0
        && evidence.agentResponseClaimed === true;
      return event.actor === 'agent'
        && evidence.source === 'agent_bridge'
        && evidence.bridgeEventType === 'CHAT_RESPONSE'
        && (
          evidence.bridgeMessageSource === 'agent_stdout'
          || evidence.bridgeMessageSource === 'agent_api_response'
        )
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
      const bridgeMessageSource = typeof evidence.bridgeMessageSource === 'string'
        ? evidence.bridgeMessageSource
        : null;
      const status = typeof evidence.status === 'string' ? evidence.status : null;
      const diagnosticSource = typeof evidence.diagnosticSource === 'string' ? evidence.diagnosticSource : null;
      const expectedId = capturedAtMs !== null && agent && bridgeMessageSource
        ? `agent-status:${safeEvidenceIdPart(agent)}:${capturedAtMs}:${bridgeMessageSource}:${safeEvidenceIdPart(status)}:${safeEvidenceIdPart(diagnosticSource)}`
        : null;
      const statusOk = status === null || AGENT_STATUSES.has(status);
      const browserObservationOk = evidence.agentStatusEventSource === 'browser_agent_ws'
        && evidence.surface === 'standard'
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
      const persistedContainerStatusOk = evidence.agentStatusEventSource === 'container_agent_bridge'
        && bridgeMessageSource === 'agent_status'
        && evidence.bridgePersisted === true
        && status !== null
        && diagnosticSource === null;
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
        && (browserObservationOk || persistedDiagnosticOk || persistedContainerStatusOk);
    }

    return false;
  }

  private parseAgentInteractionActivityEntry(value: unknown): RoomAgentInteractionActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const event = this.parseAgentInteractionEvent(value.event);
    if (
      event === null
      || !this.isVideoRole(value.role)
      || typeof value.recordedAt !== 'number'
      || !Number.isFinite(value.recordedAt)
    ) {
      return null;
    }
    return { event, role: value.role, recordedAt: value.recordedAt };
  }

  private parseAgentInteractionActivityLog(value: unknown): RoomAgentInteractionActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseAgentInteractionActivityEntry(entry))
      .filter((entry): entry is RoomAgentInteractionActivityEntry => entry !== null);
  }

  private parseChatMessage(value: unknown): RoomChatMessage | null {
    if (!this.isRecord(value)) return null;
    if (
      !this.isSafeFileText(value.id, 120)
      || !this.isSafeFileText(value.clientId, 120)
      || typeof value.createdAt !== 'number'
      || !Number.isFinite(value.createdAt)
      || !this.isVideoRole(value.role)
      || typeof value.text !== 'string'
      || value.text.trim().length === 0
      || value.text.length > 2000
    ) {
      return null;
    }
    const deliveryStatus = this.parseChatDeliveryStatus(value.deliveryStatus);
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      role: value.role,
      text: value.text.trim(),
      deliveryStatus: deliveryStatus ?? undefined,
      evidence: this.parseChatEvidence(value.evidence),
    };
  }

  private parseChatDeliveryStatus(value: unknown): 'pending' | 'accepted' | 'rejected' | null {
    return value === 'pending' || value === 'accepted' || value === 'rejected'
      ? value
      : null;
  }

  private parseChatEvidence(value: unknown): Record<string, unknown> | undefined {
    if (!this.isRecord(value)) return undefined;
    const evidence: Record<string, unknown> = {};
    const source = this.safeTextOrNull(value.source, 80);
    const chatEventSource = this.safeTextOrNull(value.chatEventSource, 120);
    const actor = value.actor === 'host' || value.actor === 'guest' ? value.actor : undefined;
    const surface = value.surface === 'standard' ? value.surface : undefined;
    const roomPhase = this.safeTextOrNull(value.roomPhase, 80);
    const deliveryStatus = this.parseChatDeliveryStatus(value.deliveryStatus);
    const roomMessageId = this.safeTextOrNull(value.roomMessageId, 120);
    const clientId = this.safeTextOrNull(value.clientId, 120);
    if (typeof source === 'string') evidence.source = source;
    if (typeof chatEventSource === 'string') evidence.chatEventSource = chatEventSource;
    if (actor) evidence.actor = actor;
    if (typeof roomMessageId === 'string') evidence.roomMessageId = roomMessageId;
    if (typeof clientId === 'string') evidence.clientId = clientId;
    if (typeof value.messageCreatedAt === 'number' && Number.isFinite(value.messageCreatedAt)) {
      evidence.messageCreatedAt = value.messageCreatedAt;
    }
    if (typeof value.messageLength === 'number' && Number.isFinite(value.messageLength)) {
      evidence.messageLength = value.messageLength;
    }
    if (typeof value.messageFingerprint === 'string' && ROOM_CHAT_MESSAGE_FINGERPRINT_RE.test(value.messageFingerprint)) {
      evidence.messageFingerprint = value.messageFingerprint;
    }
    if (deliveryStatus) evidence.deliveryStatus = deliveryStatus;
    if (surface) evidence.surface = surface;
    if (typeof roomPhase === 'string') evidence.roomPhase = roomPhase;
    if (typeof value.durableObjectReplayExpected === 'boolean') {
      evidence.durableObjectReplayExpected = value.durableObjectReplayExpected;
    }
    return Object.keys(evidence).length > 0 ? evidence : undefined;
  }

  private acceptedChatEvidence(message: RoomChatMessage, role: VideoRole): Record<string, unknown> | undefined {
    if (!message.evidence) return undefined;
    return {
      ...message.evidence,
      actor: this.isHostRole(role) ? 'host' : 'guest',
      roomMessageId: message.id,
      clientId: message.clientId,
      messageCreatedAt: message.createdAt,
      messageLength: message.text.length,
      messageFingerprint: roomChatMessageFingerprint(message.text),
      deliveryStatus: 'accepted',
    };
  }

  private hasSourceBackedChatEvidence(message: RoomChatMessage, role: VideoRole): boolean {
    const evidence = message.evidence;
    if (!evidence) return false;
    const actor = this.isHostRole(role) ? 'host' : 'guest';
    const messageCreatedAt = evidence.messageCreatedAt;
    const messageLength = evidence.messageLength;
    const messageFingerprint = evidence.messageFingerprint;
    return evidence.source === 'room_chat_client_submit'
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
      && evidence.deliveryStatus === 'accepted'
      && typeof evidence.surface === 'string'
      && this.isRoomSurface(evidence.surface)
      && typeof evidence.roomPhase === 'string'
      && evidence.roomPhase.trim().length > 0
      && evidence.durableObjectReplayExpected === true;
  }

  private chatClientMessageId(value: unknown): string | null {
    if (!this.isRecord(value)) return null;
    return this.isSafeFileText(value.id, 120) ? value.id : null;
  }

  private parseChatMessages(value: unknown): RoomChatMessage[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseChatMessage(entry))
      .filter((entry): entry is RoomChatMessage => entry !== null);
  }

  private async getChatMessages(): Promise<RoomChatMessage[]> {
    return this.parseChatMessages(await this.state.storage.get<unknown>('chatMessages'));
  }

  private isRoomMediaControlKind(value: unknown): value is RoomMediaControlKind {
    return value === 'microphone' || value === 'camera';
  }

  private parseMediaControlEvent(value: unknown): RoomMediaControlEvent | null {
    if (!this.isRecord(value)) return null;
    if (
      !this.isSafeFileText(value.id, 160)
      || !this.isSafeFileText(value.clientId, 160)
      || typeof value.createdAt !== 'number'
      || !Number.isFinite(value.createdAt)
      || !this.isVideoRole(value.role)
      || !this.isRoomMediaControlKind(value.control)
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
      evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
    };
  }

  private hasSourceBackedMediaControlEvidence(event: RoomMediaControlEvent, role: VideoRole): boolean {
    const evidence = event.evidence;
    if (!this.isRecord(evidence)) return false;
    const actor = this.isHostRole(role) ? 'host' : 'guest';
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
      && evidence.surface === 'standard'
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

  private parseMediaControlStates(value: unknown): RoomMediaControlState[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        if (
          !this.isRecord(entry)
          || !this.isVideoRole(entry.role)
          || (entry.microphoneEnabled !== undefined && typeof entry.microphoneEnabled !== 'boolean')
          || (entry.cameraEnabled !== undefined && typeof entry.cameraEnabled !== 'boolean')
          || typeof entry.updatedAt !== 'number'
          || !Number.isFinite(entry.updatedAt)
        ) {
          return null;
        }
        const state: RoomMediaControlState = {
          role: entry.role,
          updatedAt: entry.updatedAt,
          evidence: this.isRecord(entry.evidence) ? entry.evidence : undefined,
        };
        if (typeof entry.microphoneEnabled === 'boolean') {
          state.microphoneEnabled = entry.microphoneEnabled;
        }
        if (typeof entry.cameraEnabled === 'boolean') {
          state.cameraEnabled = entry.cameraEnabled;
        }
        return state;
      })
      .filter((entry): entry is RoomMediaControlState => entry !== null);
  }

  private async getMediaControlStates(): Promise<RoomMediaControlState[]> {
    return this.parseMediaControlStates(await this.state.storage.get<unknown>('mediaControlStates'));
  }

  private async persistMediaControlState(event: RoomMediaControlEvent, role: VideoRole): Promise<RoomMediaControlState[]> {
    const previous = await this.getMediaControlStates();
    const prior = previous.find((entry) => entry.role === role);
    const nextState: RoomMediaControlState = {
      role,
      updatedAt: event.createdAt,
      evidence: event.evidence,
    };
    if (event.control === 'microphone') {
      nextState.microphoneEnabled = event.enabled;
    } else if (prior?.microphoneEnabled !== undefined) {
      nextState.microphoneEnabled = prior.microphoneEnabled;
    }
    if (event.control === 'camera') {
      nextState.cameraEnabled = event.enabled;
    } else if (prior?.cameraEnabled !== undefined) {
      nextState.cameraEnabled = prior.cameraEnabled;
    }
    const next = [
      ...previous.filter((entry) => entry.role !== role),
      nextState,
    ];
    await this.state.storage.put('mediaControlStates', next);
    return next;
  }

  private parseMediaControlActivityEntry(value: unknown): RoomMediaControlActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const event = this.parseMediaControlEvent(value.event);
    if (
      event === null
      || !this.isVideoRole(value.role)
      || typeof value.recordedAt !== 'number'
      || !Number.isFinite(value.recordedAt)
    ) {
      return null;
    }
    return { event, role: value.role, recordedAt: value.recordedAt };
  }

  private parseMediaControlActivityLog(value: unknown): RoomMediaControlActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseMediaControlActivityEntry(entry))
      .filter((entry): entry is RoomMediaControlActivityEntry => entry !== null);
  }

  private async recordMediaControlActivity(event: RoomMediaControlEvent, role: VideoRole): Promise<void> {
    const previous = this.parseMediaControlActivityLog(await this.state.storage.get<unknown>('mediaControlActivityLog'));
    const next = [
      ...previous.slice(-249),
      { event, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('mediaControlActivityLog', next);
  }

  private isRoomRecordingLifecycleKind(value: unknown): value is RoomRecordingLifecycleKind {
    return value === 'start' || value === 'stop';
  }

  private isRoomRecordingStatus(value: unknown): value is RoomRecordingStatus {
    return value === 'recording'
      || value === 'uploading'
      || value === 'saved'
      || value === 'failed';
  }

  private parseRecordingStateEvent(value: unknown): RoomRecordingStateEvent | null {
    if (!this.isRecord(value)) return null;
    if (
      !this.isSafeFileText(value.id, 160)
      || !this.isSafeFileText(value.clientId, 160)
      || typeof value.createdAt !== 'number'
      || !Number.isFinite(value.createdAt)
      || !this.isVideoRole(value.role)
      || !this.isRoomRecordingLifecycleKind(value.lifecycleKind)
      || !this.isRoomRecordingStatus(value.status)
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
      evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
    };
  }

  private hasSourceBackedRecordingStateEvidence(event: RoomRecordingStateEvent, role: VideoRole): boolean {
    if (!this.isHostRole(role) || event.role !== role) return false;
    const evidence = event.evidence;
    if (!this.isRecord(evidence)) return false;
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
      && evidence.surface === 'standard'
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
        this.isRecord(channel)
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

  private parseRecordingState(value: unknown): RoomRecordingState | null {
    if (!this.isRecord(value)) return null;
    if (
      !this.isVideoRole(value.role)
      || !this.isRoomRecordingStatus(value.status)
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
      evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
    };
  }

  private async getRecordingState(): Promise<RoomRecordingState | null> {
    return this.parseRecordingState(await this.state.storage.get<unknown>('roomRecordingState'));
  }

  private async persistRecordingState(event: RoomRecordingStateEvent, role: VideoRole): Promise<RoomRecordingState> {
    const next: RoomRecordingState = {
      role,
      status: event.status,
      active: event.active,
      updatedAt: event.createdAt,
      evidence: event.evidence,
    };
    await this.state.storage.put('roomRecordingState', next);
    return next;
  }

  private parseRecordingActivityEntry(value: unknown): RoomRecordingActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const event = this.parseRecordingStateEvent(value.event);
    if (
      event === null
      || !this.isVideoRole(value.role)
      || typeof value.recordedAt !== 'number'
      || !Number.isFinite(value.recordedAt)
    ) {
      return null;
    }
    return { event, role: value.role, recordedAt: value.recordedAt };
  }

  private parseRecordingActivityLog(value: unknown): RoomRecordingActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseRecordingActivityEntry(entry))
      .filter((entry): entry is RoomRecordingActivityEntry => entry !== null);
  }

  private async recordRecordingActivity(event: RoomRecordingStateEvent, role: VideoRole): Promise<void> {
    const previous = this.parseRecordingActivityLog(await this.state.storage.get<unknown>('recordingActivityLog'));
    const next = [
      ...previous.slice(-249),
      { event, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('recordingActivityLog', next);
  }

  private parseChatActivityEntry(value: unknown): RoomChatActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const message = this.parseChatMessage(value.message);
    if (
      message === null
      || !this.isVideoRole(value.role)
      || typeof value.recordedAt !== 'number'
      || !Number.isFinite(value.recordedAt)
    ) {
      return null;
    }
    return { message, role: value.role, recordedAt: value.recordedAt };
  }

  private parseChatActivityLog(value: unknown): RoomChatActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseChatActivityEntry(entry))
      .filter((entry): entry is RoomChatActivityEntry => entry !== null);
  }

  private isRoomCodeServerFileEventType(value: unknown): value is RoomCodeServerFileEventType {
    return value === 'code_editor_save' || value === 'file_change';
  }

  private parseCodeServerFileEvent(value: unknown): RoomCodeServerFileEvent | null {
    if (!this.isRecord(value)) return null;
    if (
      !this.isSafeFileText(value.id, 160)
      || !this.isSafeFileText(value.clientId, 160)
      || typeof value.createdAt !== 'number'
      || !Number.isFinite(value.createdAt)
      || !this.isRoomCodeServerFileEventType(value.eventType)
      || value.actor !== 'system'
      || typeof value.text !== 'string'
      || value.text.trim().length === 0
      || value.text.length > 2000
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
      evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
    };
  }

  private hasSourceBackedCodeServerFileEvidence(event: RoomCodeServerFileEvent): boolean {
    const evidence = event.evidence;
    if (!this.isRecord(evidence)) return false;
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
      && evidence.surface === 'standard'
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

  private parseCodeServerFileActivityEntry(value: unknown): RoomCodeServerFileActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const event = this.parseCodeServerFileEvent(value.event);
    if (
      event === null
      || !this.isVideoRole(value.role)
      || typeof value.recordedAt !== 'number'
      || !Number.isFinite(value.recordedAt)
    ) {
      return null;
    }
    return { event, role: value.role, recordedAt: value.recordedAt };
  }

  private parseCodeServerFileActivityLog(value: unknown): RoomCodeServerFileActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseCodeServerFileActivityEntry(entry))
      .filter((entry): entry is RoomCodeServerFileActivityEntry => entry !== null);
  }

  private parseTerminalEvidence(value: unknown): Record<string, unknown> | undefined {
    if (!this.isRecord(value)) return undefined;
    const evidence: Record<string, unknown> = {};
    const source = this.safeTextOrNull(value.source, 80);
    const terminalEventSource = this.safeTextOrNull(value.terminalEventSource, 120);
    const terminalSessionId = this.safeTextOrNull(value.terminalSessionId, 200);
    const terminalCommandId = this.safeTextOrNull(value.terminalCommandId, 260);
    const terminalOutputChunkId = this.safeTextOrNull(value.terminalOutputChunkId, 260);
    const commandFingerprint = this.safeTextOrNull(value.commandFingerprint, 80);
    const outputFingerprint = this.safeTextOrNull(value.outputFingerprint, 80);
    const actor = value.actor === 'host' || value.actor === 'guest' || value.actor === 'system'
      ? value.actor
      : undefined;
    const surface = this.isRoomSurface(value.surface) ? value.surface : undefined;
    const roomPhase = this.safeTextOrNull(value.roomPhase, 80);
    const workspaceStatus = this.safeTextOrNull(value.workspaceStatus, 120);
    const workspaceSessionId = this.safeTextOrNull(value.workspaceSessionId, 200);
    const repoUrl = this.safeTextOrNull(value.repoUrl, 2000);

    if (typeof source === 'string') evidence.source = source;
    if (typeof terminalEventSource === 'string') evidence.terminalEventSource = terminalEventSource;
    if (typeof terminalSessionId === 'string') evidence.terminalSessionId = terminalSessionId;
    if (typeof terminalCommandId === 'string' || terminalCommandId === null) {
      evidence.terminalCommandId = terminalCommandId;
    }
    if (typeof terminalOutputChunkId === 'string') evidence.terminalOutputChunkId = terminalOutputChunkId;
    if (typeof value.terminalCommandSequence === 'number' && Number.isFinite(value.terminalCommandSequence)) {
      evidence.terminalCommandSequence = value.terminalCommandSequence;
    }
    if (typeof value.terminalOutputSequence === 'number' && Number.isFinite(value.terminalOutputSequence)) {
      evidence.terminalOutputSequence = value.terminalOutputSequence;
    }
    if (actor) evidence.actor = actor;
    if (typeof value.capturedAtMs === 'number' && Number.isFinite(value.capturedAtMs)) {
      evidence.capturedAtMs = value.capturedAtMs;
    }
    if (typeof commandFingerprint === 'string') evidence.commandFingerprint = commandFingerprint;
    if (typeof value.commandLength === 'number' && Number.isFinite(value.commandLength)) {
      evidence.commandLength = value.commandLength;
    }
    if (typeof outputFingerprint === 'string') evidence.outputFingerprint = outputFingerprint;
    if (typeof value.outputLength === 'number' && Number.isFinite(value.outputLength)) {
      evidence.outputLength = value.outputLength;
    }
    if (surface) evidence.surface = surface;
    if (typeof roomPhase === 'string') evidence.roomPhase = roomPhase;
    if (typeof workspaceStatus === 'string' || workspaceStatus === null) evidence.workspaceStatus = workspaceStatus;
    if (typeof workspaceSessionId === 'string' || workspaceSessionId === null) {
      evidence.workspaceSessionId = workspaceSessionId;
    }
    if (typeof repoUrl === 'string' || repoUrl === null) evidence.repoUrl = repoUrl;
    if (typeof value.durableObjectReplayExpected === 'boolean') {
      evidence.durableObjectReplayExpected = value.durableObjectReplayExpected;
    }
    return Object.keys(evidence).length > 0 ? evidence : undefined;
  }

  private parseTerminalEvent(value: unknown): RoomTerminalEvent | null {
    if (!this.isRecord(value)) return null;
    if (
      !this.isSafeFileText(value.id, 160)
      || !this.isSafeFileText(value.clientId, 160)
      || typeof value.createdAt !== 'number'
      || !Number.isFinite(value.createdAt)
      || typeof value.text !== 'string'
      || value.text.length === 0
      || value.text.length > 8000
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
        evidence: this.parseTerminalEvidence(value.evidence),
      };
    }
    if (value.kind === 'OUTPUT') {
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'OUTPUT',
        text: value.text,
        evidence: this.parseTerminalEvidence(value.evidence),
      };
    }
    return null;
  }

  private hasSourceBackedTerminalEvidence(event: RoomTerminalEvent, role: VideoRole): boolean {
    const evidence = event.evidence;
    if (!this.isRecord(evidence)) return false;
    const senderActor = this.isHostRole(role) ? 'host' : 'guest';
    const terminalSessionId = typeof evidence.terminalSessionId === 'string'
      ? evidence.terminalSessionId
      : null;
    const capturedAtMs = typeof evidence.capturedAtMs === 'number' && Number.isInteger(evidence.capturedAtMs)
      ? evidence.capturedAtMs
      : null;
    const commonOk = evidence.source === 'container_terminal'
      && evidence.terminalEventSource === 'browser_terminal_ws'
      && terminalSessionId !== null
      && capturedAtMs !== null
      && capturedAtMs >= 0
      && evidence.surface === 'standard'
      && typeof evidence.roomPhase === 'string'
      && typeof evidence.workspaceStatus === 'string'
      && typeof evidence.workspaceSessionId === 'string'
      && (evidence.repoUrl === null || typeof evidence.repoUrl === 'string');
    if (!commonOk) return false;

    if (event.kind === 'COMMAND') {
      const sequence = evidence.terminalCommandSequence;
      const fingerprint = evidence.commandFingerprint;
      const expectedCommandId = `${terminalSessionId}:command:${senderActor}:${capturedAtMs}:${sequence}:${fingerprint}`;
      return evidence.actor === senderActor
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

  private parseTerminalActivityEntry(value: unknown): RoomTerminalActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const event = this.parseTerminalEvent(value.event);
    if (
      event === null
      || !this.isVideoRole(value.role)
      || typeof value.recordedAt !== 'number'
      || !Number.isFinite(value.recordedAt)
    ) {
      return null;
    }
    return { event, role: value.role, recordedAt: value.recordedAt };
  }

  private parseTerminalActivityLog(value: unknown): RoomTerminalActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseTerminalActivityEntry(entry))
      .filter((entry): entry is RoomTerminalActivityEntry => entry !== null);
  }

  private isSafeFileText(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
  }

  private safeTextOrNull(value: unknown, maxLength: number): string | null | undefined {
    if (value === null) return null;
    return this.isSafeFileText(value, maxLength) ? value : undefined;
  }

  private safeWorkspaceDiagnosticOrNull(value: unknown, maxLength: number): string | null | undefined {
    if (value === null) return null;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed
      .replace(WORKSPACE_ENV_SECRET_ASSIGNMENT_RE, (_match, name: string) => `${name}=${WORKSPACE_REDACTED_SECRET}`)
      .replace(WORKSPACE_BEARER_TOKEN_RE, (_match, prefix: string) => `${prefix}${WORKSPACE_REDACTED_SECRET}`)
      .replace(WORKSPACE_GITHUB_PAT_RE, WORKSPACE_REDACTED_SECRET)
      .replace(WORKSPACE_OPENAI_KEY_RE, WORKSPACE_REDACTED_SECRET)
      .replace(WORKSPACE_BARE_SECRET_RE, WORKSPACE_REDACTED_SECRET)
      .replace(WORKSPACE_SECRET_QUERY_RE, (_match, prefix: string) => `${prefix}${WORKSPACE_REDACTED_SECRET}`)
      .replace(WORKSPACE_ROOM_TOKEN_PATH_RE, (_match, prefix: string) => `${prefix}${WORKSPACE_REDACTED_SECRET}`)
      .slice(0, maxLength);
  }

  private safeNumberOrNull(value: unknown): number | null | undefined {
    if (value === null) return null;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private safeBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  private async recordAgentInteractionActivity(
    event: RoomAgentInteractionEvent,
    role: VideoRole,
  ): Promise<void> {
    const previous = this.parseAgentInteractionActivityLog(
      await this.state.storage.get<unknown>('agentInteractionActivityLog'),
    );
    const next = [
      ...previous.slice(-249),
      { event, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('agentInteractionActivityLog', next);
  }

  private async persistChatMessage(message: RoomChatMessage, role: VideoRole): Promise<RoomChatMessage[]> {
    const previous = await this.getChatMessages();
    const next = [
      ...previous.filter((entry) => entry.id !== message.id).slice(-199),
      { ...message, role },
    ];
    await this.state.storage.put('chatMessages', next);
    return next;
  }

  private async recordChatActivity(message: RoomChatMessage, role: VideoRole): Promise<void> {
    const previous = this.parseChatActivityLog(await this.state.storage.get<unknown>('chatActivityLog'));
    const next = [
      ...previous.slice(-249),
      { message: { ...message, role }, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('chatActivityLog', next);
  }

  private async recordCodeServerFileActivity(event: RoomCodeServerFileEvent, role: VideoRole): Promise<void> {
    const previous = this.parseCodeServerFileActivityLog(
      await this.state.storage.get<unknown>('codeServerFileActivityLog'),
    );
    const next = [
      ...previous.slice(-249),
      { event, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('codeServerFileActivityLog', next);
  }

  private async recordTerminalActivity(event: RoomTerminalEvent, role: VideoRole): Promise<void> {
    const previous = this.parseTerminalActivityLog(
      await this.state.storage.get<unknown>('terminalActivityLog'),
    );
    const next = [
      ...previous.slice(-249),
      { event, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('terminalActivityLog', next);
  }

  /** Get all active WebSockets */
  private getAllWebSockets(): WebSocket[] {
    return this.state.getWebSockets();
  }

  /** Broadcast a message to all connected peers */
  private broadcast(message: string): void {
    for (const ws of this.getAllWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // Ignore — peer may have already disconnected
      }
    }
  }

  /** Send a message to all peers EXCEPT the given WebSocket */
  private broadcastExcept(ws: WebSocket, message: string): void {
    for (const peer of this.getAllWebSockets()) {
      if (peer !== ws) {
        try {
          peer.send(message);
        } catch {
          // Ignore
        }
      }
    }
  }

  private async persistSessionStatus(status: SessionStatus, endedByHost = false): Promise<void> {
    this.sessionStatus = status;
    await this.state.storage.put('status', this.sessionStatus);
    if (endedByHost) {
      await this.state.storage.put('endedByHost', true);
    } else if (status !== 'ENDED') {
      await this.state.storage.delete('endedByHost');
    }
  }

  private async endSession(senderRole: VideoRole): Promise<void> {
    const alreadyEnded = this.sessionStatus === 'ENDED';
    this._lastOffer = null;
    await this.state.storage.delete('lastOffer');
    await this.persistSessionStatus('ENDED', true);
    this.broadcast(JSON.stringify({
      type: 'STATUS_UPDATE',
      status: this.sessionStatus,
      role: senderRole,
    }));
    if (!alreadyEnded) {
      void this.state.storage.setAlarm(Date.now() + 5000);
    }
  }

  // ── HTTP handler ────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /init — initialize session metadata (called before WebSocket)
    if (request.method === 'POST' && url.pathname === '/init') {
      const body = await request.json() as {
        stageId?: string;
        candidateId?: string;
        recruiterId?: string;
        scheduledInterviewId?: string;
        meetingId?: string;
        hostId?: string;
      };
      this.metadata = {
        stageId: body.stageId,
        candidateId: body.candidateId,
        recruiterId: body.recruiterId,
        scheduledInterviewId: body.scheduledInterviewId,
        meetingId: body.meetingId,
        hostId: body.hostId,
      };
      this.sessionStatus = 'WAITING';
      this._lastOffer = null;
      await this.state.storage.put('metadata', this.metadata);
      await this.persistSessionStatus(this.sessionStatus);
      await this.state.storage.delete('lastOffer');

      return new Response(JSON.stringify({ status: 'WAITING' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /ensure — idempotently initialize a standalone meeting room.
    if (request.method === 'POST' && url.pathname === '/ensure') {
      const body = await request.json() as {
        meetingId: string;
        hostId: string;
        resetEnded?: boolean;
      };
      if (!this.metadata.meetingId) {
        this.metadata = { meetingId: body.meetingId, hostId: body.hostId };
        await this.state.storage.put('metadata', this.metadata);
      }
      const storedStatus = await this.state.storage.get<unknown>('status');
      const endedByHost = await this.state.storage.get<boolean>('endedByHost');
      if (
        !this.isSessionStatus(storedStatus)
        || (storedStatus === 'ENDED' && body.resetEnded && !endedByHost)
      ) {
        this.sessionStatus = 'WAITING';
        await this.persistSessionStatus(this.sessionStatus);
        this._lastOffer = null;
        await this.state.storage.delete('lastOffer');
      } else {
        this.sessionStatus = storedStatus;
      }
      return new Response(JSON.stringify({ status: this.sessionStatus }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /status — return current session status
    if (request.method === 'GET' && url.pathname === '/status') {
      const peerCount = this.getAllWebSockets().length;
      return new Response(JSON.stringify({
        status: this.sessionStatus,
        metadata: this.metadata,
        peers: peerCount,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/activity-log') {
      return new Response(JSON.stringify({
        chatActivityLog: this.parseChatActivityLog(
          await this.state.storage.get<unknown>('chatActivityLog'),
        ),
        codeServerFileActivityLog: this.parseCodeServerFileActivityLog(
          await this.state.storage.get<unknown>('codeServerFileActivityLog'),
        ),
        terminalActivityLog: this.parseTerminalActivityLog(
          await this.state.storage.get<unknown>('terminalActivityLog'),
        ),
        agentInteractionActivityLog: this.parseAgentInteractionActivityLog(
          await this.state.storage.get<unknown>('agentInteractionActivityLog'),
        ),
        mediaControlActivityLog: this.parseMediaControlActivityLog(
          await this.state.storage.get<unknown>('mediaControlActivityLog'),
        ),
        recordingActivityLog: this.parseRecordingActivityLog(
          await this.state.storage.get<unknown>('recordingActivityLog'),
        ),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade for legacy recruiter/candidate and meeting host/guest roles.
    if (url.pathname === '/ws') {
      const role = url.searchParams.get('role') as VideoRole | null;
      if (!role || !['RECRUITER', 'CANDIDATE', 'HOST', 'GUEST'].includes(role)) {
        return new Response('Missing or invalid role parameter', { status: 400 });
      }

      // Close any stale connections for this role (can happen after hibernation/reconnect)
      const existingForRole = this.getWebSocketsByRole(role);
      for (const staleWs of existingForRole) {
        try {
          staleWs.close(1000, 'Replaced by new connection');
        } catch {
          // Already closed
        }
      }

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      // Accept the WebSocket with the role as a tag (survives hibernation)
      this.state.acceptWebSocket(server, [role]);

      const peerCount = this.getAllWebSockets().length;

      // Send current status to the new peer
      server.send(JSON.stringify({
        type: 'STATUS_UPDATE',
        status: this.sessionStatus,
        metadata: this.metadata,
        peers: peerCount,
      }));

      const chatMessages = await this.getChatMessages();
      server.send(JSON.stringify({
        type: 'ROOM_CHAT_STATE',
        payload: { messages: chatMessages },
      }));

      const mediaControlStates = await this.getMediaControlStates();
      server.send(JSON.stringify({
        type: 'ROOM_MEDIA_CONTROL_STATE',
        payload: { states: mediaControlStates },
      }));

      const recordingState = await this.getRecordingState();
      server.send(JSON.stringify({
        type: 'ROOM_RECORDING_STATE_SNAPSHOT',
        payload: { state: recordingState },
      }));

      // Notify other peers that this role has connected
      this.broadcastExcept(server, JSON.stringify({
        type: 'PEER_CONNECTED',
        role,
      }));

      // Replay stored OFFER to late-joining candidates
      if (!this.isHostRole(role) && this._lastOffer && this.sessionStatus === 'CALLING') {
        server.send(this._lastOffer);
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // ── Hibernation API handlers ────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const messageStr = typeof rawMessage === 'string'
      ? rawMessage
      : new TextDecoder().decode(rawMessage);

    let message: SignalMessage;
    try {
      message = JSON.parse(messageStr) as SignalMessage;
    } catch {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON' }));
      return;
    }

    // Identify the sender by their tag
    const senderRole = this.getRoleFromWs(ws);
    if (!senderRole) return;

    // Handle status updates
    if (message.type === 'STATUS_UPDATE' && message.status) {
      if (message.status === 'LEFT') {
        this.broadcastExcept(ws, JSON.stringify({
          type: 'PEER_DISCONNECTED',
          role: senderRole,
          code: 1000,
        }));
        return;
      }

      if (!this.isSessionStatus(message.status)) {
        ws.send(JSON.stringify({
          type: 'STATUS_UPDATE_REJECTED',
          status: message.status,
          reason: 'INVALID_STATUS',
        }));
        return;
      }

      if (message.status === 'ENDED' && !this.isHostRole(senderRole)) {
        ws.send(JSON.stringify({
          type: 'STATUS_UPDATE_REJECTED',
          status: message.status,
          reason: 'ONLY_HOST_CAN_END_ROOM',
        }));
        return;
      }

      if (message.status === 'ENDED') {
        await this.endSession(senderRole);
        return;
      }

      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'STATUS_UPDATE_REJECTED',
          status: message.status,
          reason: 'ROOM_ENDED',
        }));
        return;
      }

      if (
        !this.isHostRole(senderRole)
        && (message.status === 'WAITING' || message.status === 'CALLING')
      ) {
        ws.send(JSON.stringify({
          type: 'STATUS_UPDATE_REJECTED',
          status: message.status,
          reason: 'ONLY_HOST_CAN_SET_STATUS',
        }));
        return;
      }

      await this.persistSessionStatus(message.status);

      // Broadcast to all peers
      this.broadcast(JSON.stringify({
        type: 'STATUS_UPDATE',
        status: this.sessionStatus,
        role: senderRole,
      }));
      return;
    }

    if (message.type === 'HANGUP' && !this.isHostRole(senderRole)) {
      ws.send(JSON.stringify({
        type: 'SIGNAL_REJECTED',
        signalType: message.type,
        reason: 'ONLY_HOST_CAN_END_ROOM',
      }));
      return;
    }

    if (message.type === 'ROOM_AGENT_INTERACTION') {
      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'ROOM_AGENT_INTERACTION_REJECTED',
          reason: 'ROOM_ENDED',
        }));
        return;
      }
      const event = this.parseAgentInteractionEvent(message.payload);
      if (!event) {
        ws.send(JSON.stringify({
          type: 'ROOM_AGENT_INTERACTION_REJECTED',
          reason: 'INVALID_EVENT',
        }));
        return;
      }
      if (!this.hasSourceBackedAgentInteractionEvidence(event, senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_AGENT_INTERACTION_REJECTED',
          reason: 'MISSING_SOURCE_EVIDENCE',
        }));
        return;
      }
      await this.recordAgentInteractionActivity(event, senderRole);
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_AGENT_INTERACTION',
        role: senderRole,
        payload: event,
      }));
      return;
    }

    if (message.type === 'ROOM_CHAT_MESSAGE') {
      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'ROOM_CHAT_MESSAGE_REJECTED',
          reason: 'ROOM_ENDED',
          payload: { clientMessageId: this.chatClientMessageId(message.payload) },
        }));
        return;
      }
      const chatMessage = this.parseChatMessage(message.payload);
      if (!chatMessage) {
        ws.send(JSON.stringify({
          type: 'ROOM_CHAT_MESSAGE_REJECTED',
          reason: 'INVALID_MESSAGE',
          payload: { clientMessageId: this.chatClientMessageId(message.payload) },
        }));
        return;
      }
      const persistedMessage = {
        ...chatMessage,
        role: senderRole,
        deliveryStatus: 'accepted' as const,
        evidence: this.acceptedChatEvidence(chatMessage, senderRole),
      };
      if (!this.hasSourceBackedChatEvidence(persistedMessage, senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_CHAT_MESSAGE_REJECTED',
          reason: 'INVALID_EVIDENCE',
          payload: { clientMessageId: chatMessage.id },
        }));
        return;
      }
      await this.persistChatMessage(persistedMessage, senderRole);
      await this.recordChatActivity(persistedMessage, senderRole);
      ws.send(JSON.stringify({
        type: 'ROOM_CHAT_MESSAGE_ACK',
        role: senderRole,
        payload: persistedMessage,
      }));
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_CHAT_MESSAGE',
        role: senderRole,
        payload: persistedMessage,
      }));
      return;
    }

    if (message.type === 'ROOM_MEDIA_CONTROL') {
      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'ROOM_MEDIA_CONTROL_REJECTED',
          reason: 'ROOM_ENDED',
        }));
        return;
      }
      const event = this.parseMediaControlEvent(message.payload);
      if (!event) {
        ws.send(JSON.stringify({
          type: 'ROOM_MEDIA_CONTROL_REJECTED',
          reason: 'INVALID_EVENT',
        }));
        return;
      }
      if (!this.hasSourceBackedMediaControlEvidence(event, senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_MEDIA_CONTROL_REJECTED',
          reason: 'MISSING_SOURCE_EVIDENCE',
        }));
        return;
      }
      await this.persistMediaControlState(event, senderRole);
      await this.recordMediaControlActivity(event, senderRole);
      ws.send(JSON.stringify({
        type: 'ROOM_MEDIA_CONTROL_ACK',
        role: senderRole,
        payload: event,
      }));
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_MEDIA_CONTROL',
        role: senderRole,
        payload: event,
      }));
      return;
    }

    if (message.type === 'ROOM_RECORDING_STATE') {
      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'ROOM_RECORDING_STATE_REJECTED',
          reason: 'ROOM_ENDED',
        }));
        return;
      }
      if (!this.isHostRole(senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_RECORDING_STATE_REJECTED',
          reason: 'ONLY_HOST_CAN_RECORD',
        }));
        return;
      }
      const event = this.parseRecordingStateEvent(message.payload);
      if (!event) {
        ws.send(JSON.stringify({
          type: 'ROOM_RECORDING_STATE_REJECTED',
          reason: 'INVALID_EVENT',
        }));
        return;
      }
      if (!this.hasSourceBackedRecordingStateEvidence(event, senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_RECORDING_STATE_REJECTED',
          reason: 'MISSING_SOURCE_EVIDENCE',
        }));
        return;
      }
      await this.persistRecordingState(event, senderRole);
      await this.recordRecordingActivity(event, senderRole);
      ws.send(JSON.stringify({
        type: 'ROOM_RECORDING_STATE_ACK',
        role: senderRole,
        payload: event,
      }));
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_RECORDING_STATE',
        role: senderRole,
        payload: event,
      }));
      return;
    }

    if (message.type === 'ROOM_CODE_SERVER_FILE_EVENT') {
      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'ROOM_CODE_SERVER_FILE_EVENT_REJECTED',
          reason: 'ROOM_ENDED',
        }));
        return;
      }
      const event = this.parseCodeServerFileEvent(message.payload);
      if (!event) {
        ws.send(JSON.stringify({
          type: 'ROOM_CODE_SERVER_FILE_EVENT_REJECTED',
          reason: 'INVALID_EVENT',
        }));
        return;
      }
      if (!this.hasSourceBackedCodeServerFileEvidence(event)) {
        ws.send(JSON.stringify({
          type: 'ROOM_CODE_SERVER_FILE_EVENT_REJECTED',
          reason: 'MISSING_SOURCE_EVIDENCE',
        }));
        return;
      }
      await this.recordCodeServerFileActivity(event, senderRole);
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_CODE_SERVER_FILE_EVENT',
        role: senderRole,
        payload: event,
      }));
      return;
    }

    if (message.type === 'ROOM_TERMINAL_EVENT') {
      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'ROOM_TERMINAL_EVENT_REJECTED',
          reason: 'ROOM_ENDED',
        }));
        return;
      }
      const terminalEvent = this.parseTerminalEvent(message.payload);
      if (!terminalEvent) {
        ws.send(JSON.stringify({
          type: 'ROOM_TERMINAL_EVENT_REJECTED',
          reason: 'INVALID_EVENT',
        }));
        return;
      }
      if (!this.hasSourceBackedTerminalEvidence(terminalEvent, senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_TERMINAL_EVENT_REJECTED',
          reason: 'MISSING_SOURCE_EVIDENCE',
        }));
        return;
      }
      await this.recordTerminalActivity(terminalEvent, senderRole);
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_TERMINAL_EVENT',
        role: senderRole,
        payload: terminalEvent,
      }));
      return;
    }

    if (message.type === 'HANGUP') {
      await this.endSession(senderRole);
    }

    if (this.sessionStatus === 'ENDED' && message.type !== 'HANGUP') {
      ws.send(JSON.stringify({
        type: 'SIGNAL_REJECTED',
        signalType: message.type,
        reason: 'ROOM_ENDED',
      }));
      return;
    }

    // Store OFFER for replay to late-joining candidates
    if (message.type === 'OFFER' && this.isHostRole(senderRole)) {
      this._lastOffer = JSON.stringify({
        type: 'OFFER',
        role: senderRole,
        payload: message.payload,
      });
      await this.state.storage.put('lastOffer', this._lastOffer);
      if (this.sessionStatus !== 'ENDED') {
        await this.persistSessionStatus('CALLING');
      }
    }

    // Route signaling messages to the remote peer
    const remoteRole = this.remoteRole(senderRole);
    const remotePeers = this.getWebSocketsByRole(remoteRole);

    for (const remotePeer of remotePeers) {
      try {
        remotePeer.send(JSON.stringify({
          type: message.type,
          role: senderRole,
          payload: message.payload,
        }));
      } catch {
        // Remote peer may have disconnected
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const role = this.getRoleFromWs(ws);
    const replacedByReconnect = code === 1000 && reason === 'Replaced by new connection';

    // Socket closes include refreshes, hibernation resumes, mobile network
    // handoffs, and our own stale-socket replacement. They must not clear the
    // room status or the replayable offer.
    if (role && !replacedByReconnect) {
      this.broadcastExcept(ws, JSON.stringify({
        type: 'PEER_DISCONNECTED',
        role,
        code,
      }));
    }

    // A browser refresh, mobile sleep, network handoff, or temporary tab close
    // must not permanently end the room. Only an explicit HOST/RECRUITER
    // hangup or STATUS_UPDATE:ENDED transition ends the session.
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.webSocketClose(ws, 1011, 'error');
  }

  async alarm(): Promise<void> {
    // Clean up storage after session ends
    await this.state.storage.deleteAll();
  }

}
