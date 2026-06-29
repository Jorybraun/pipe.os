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
type RoomSurface = 'standard' | 'win95';
const TERMINAL_FINGERPRINT_RE = /^terminal_[0-9a-f]{8}$/;
const TERMINAL_COMMAND_ID_RE = /^.+:command:(host|guest):\d+:\d+:terminal_[0-9a-f]{8}$/;
const CLIPPY_PROMPT_FINGERPRINT_RE = /^clippy_[0-9a-f]{8}$/;
const BROWSER_PROMPT_ID_RE = /^[a-zA-Z0-9:_-]+:(host|guest):prompt:\d+:clippy_[0-9a-f]{8}$/;
const CLIPPY_ACTION_EVENT_ID_RE = /^clippy-action:(host|guest|agent):\d+:[a-z_]+:[a-z_]+:[a-z_]+:[a-zA-Z0-9:_-]+$/;
const AGENT_CHAT_RESPONSE_FINGERPRINT_RE = /^agent_[0-9a-f]{8}$/;
const AGENT_CHAT_RESPONSE_ID_RE = /^agent-chat:[a-zA-Z0-9:_-]+:\d+:CHAT_RESPONSE:agent_[0-9a-f]{8}$/;
const AGENT_STATUS_EVENT_ID_RE = /^agent-status:[a-zA-Z0-9:_-]+:\d+:[a-z_]+:[a-zA-Z0-9:_-]+:[a-zA-Z0-9:_-]+$/;
const AGENT_STATUSES = new Set(['starting', 'idle', 'thinking', 'working', 'auth_needed', 'disconnected']);
const AGENT_STATUS_MESSAGE_SOURCES = new Set(['agent_status', 'agent_stdout', 'agent_api_response', 'bridge_diagnostic', 'bridge_observation']);
const CLIPPY_PROMPT_BLOCKED_REASONS = new Set([
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
const RECORDING_STATE_EVENT_ID_RE = /^recording:host:\d+:(start|stop):(recording|uploading|saved|failed)$/;
const RECORDING_FAILURE_STAGES = new Set(['stop_recorder', 'prepare_upload', 'upload_request']);
const RECORDING_FAILURE_SOURCES = new Set([
  'browser_media_recorder_exception',
  'browser_blob_builder_exception',
  'recording_upload_exception',
]);
const MAX_RECORDING_FAILURE_MESSAGE_LENGTH = 240;
const CURSOR_PRESENCE_SAMPLE_INTERVAL_MS = 15_000;
const CURSOR_PRESENCE_MOVEMENT_THRESHOLD = 0.03;
const CURSOR_SAMPLE_ID_RE = /^cursor:(host|guest):\d+:\d+:\d+$/;
const ROOM_FILE_PROJECTION_EVIDENCE_METADATA_KEY = 'roomFileProjectionEvidence';
const ROOM_FILE_PROJECTION_EVIDENCE_KEYS = [
  'source',
  'fileEventSource',
  'fileChangeId',
  'actor',
  'operation',
  'action',
  'fileId',
  'fileName',
  'fileKind',
  'mimeType',
  'path',
  'surface',
  'roomPhase',
  'capturedAtMs',
  'durableObjectReplayExpected',
  'contentLength',
  'contentHash',
  'fileCreatedAt',
  'fileUpdatedAt',
] as const;
const WINDOW_LIFECYCLE_SOURCES = new Set([
  'win95_desktop_ui',
  'win95_file_system',
  'win95_start_menu',
  'win95_window_chrome',
  'win95_taskbar',
  'clippy_action',
  'shared_state_sync',
]);
const WINDOW_STATE_SOURCES = new Set([
  'win95_desktop_ui',
  'win95_start_menu',
  'win95_window_chrome',
  'win95_taskbar',
]);
const WINDOW_DATA_SOURCES = new Set(['win95_window_data_sync', 'win95_file_delete_sync']);
const START_MENU_EVENT_SOURCES = new Set([
  'win95_start_button',
  'win95_desktop_click',
  'win95_start_menu_item',
]);
const START_MENU_EVENT_ID_RE = /^start-menu:(host|guest):\d+:(open|close):[a-z0-9_]+$/;
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
    | 'ROOM_DESKTOP_EVENT'
    | 'ROOM_CLIPPY_PROMPT'
    | 'ROOM_CLIPPY_INTERACTION'
    | 'ROOM_CHAT_MESSAGE'
    | 'ROOM_CURSOR'
    | 'ROOM_MEDIA_CONTROL'
    | 'ROOM_RECORDING_STATE'
    | 'ROOM_CODE_SERVER_FILE_EVENT'
    | 'ROOM_TERMINAL_EVENT'
    | 'ROOM_FILE_SYSTEM_EVENT';
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
    && CLIPPY_PROMPT_FINGERPRINT_RE.test(promptFingerprint)
    && typeof promptTimestamp === 'number'
    && Number.isInteger(promptTimestamp)
    && promptTimestamp >= 0
    && typeof promptLength === 'number'
    && Number.isInteger(promptLength)
    && promptLength > 0
    && promptId.endsWith(`:${promptTimestamp}:${promptFingerprint}`);
}

type RoomDesktopWindowType =
  | 'video'
  | 'workspace'
  | 'chat'
  | 'tasks'
  | 'snippet'
  | 'browser'
  | 'notepad'
  | 'paint'
  | 'terminal'
  | 'custom';

interface RoomDesktopWindow {
  id: string;
  windowType: RoomDesktopWindowType;
  title: string;
  icon?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  minimized?: boolean;
  maximized?: boolean;
  focused?: boolean;
  data?: Record<string, unknown>;
}

type RoomDesktopEvent =
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'SET_ROOM_SURFACE';
      surface: RoomSurface;
      previousSurface?: RoomSurface;
      action?: string;
      source?: string;
      surfaceControlEventSource?: string;
      surfaceChangeId?: string;
      capturedAtMs?: number;
      roomPhase?: string;
      durableObjectReplayExpected?: boolean;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'OPEN_WINDOW';
      window: RoomDesktopWindow;
      evidence?: Record<string, unknown>;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'START_MENU_STATE';
      open: boolean;
      evidence?: Record<string, unknown>;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'CLOSE_WINDOW';
      windowId: string;
      evidence?: Record<string, unknown>;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'UPDATE_WINDOW_DATA';
      windowId: string;
      data: Record<string, unknown>;
      evidence?: Record<string, unknown>;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'UPDATE_WINDOW_STATE';
      windowId: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      minimized?: boolean;
      maximized?: boolean;
      focused?: boolean;
      evidence?: Record<string, unknown>;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'WORKSPACE_STATE_CHANGED';
      actor?: 'host' | 'guest';
      workspaceStateEventId?: string;
      capturedAtMs?: number;
      status?: string | null;
      workspaceSessionId?: string | null;
      errorMessage?: string | null;
      repoUrl?: string | null;
      githubPrNumber?: number | null;
      matchedRepoId?: number | null;
      challengeStatus?: string | null;
      challengeKind?: string | null;
      challengeSource?: string | null;
      challengeMessage?: string | null;
      canLaunch?: boolean;
      ttlSeconds?: number | null;
      ttlSource?: string | null;
      expiresAt?: string | null;
      expiringSoon?: boolean;
      source?: string;
      workspaceEventSource?: string;
      workspaceStateSource?: string;
      workspaceTelemetryPersisted?: boolean;
      proxyUrlPersisted?: boolean;
    };

interface RoomDesktopActivityEntry {
  event: RoomDesktopEvent;
  role: VideoRole;
  recordedAt: number;
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

interface RoomCursorPresence {
  clientId: string;
  role: VideoRole;
  x: number;
  y: number;
  updatedAt: number;
  evidence?: Record<string, unknown>;
}

interface RoomCursorActivityEntry {
  cursor: RoomCursorPresence;
  role: VideoRole;
  recordedAt: number;
}

type RoomClippyPromptSource = 'system' | 'agent' | 'host' | 'guest';

interface RoomClippyAction {
  id: string;
  label: string;
  disabled?: boolean;
}

interface RoomClippyPrompt {
  id: string;
  clientId: string;
  createdAt: number;
  source: RoomClippyPromptSource;
  text: string;
  promptEventSource?: 'browser_proactive_clippy_prompt' | 'clippy_agent_bridge';
  promptTrigger?: string;
  surface?: RoomSurface;
  roomPhase?: string;
  workspaceStatus?: string | null;
  workspaceSessionId?: string | null;
  agentResponseClaimed?: boolean;
  hold?: boolean;
  targetRoles?: VideoRole[];
  actions?: RoomClippyAction[];
}

interface RoomClippyPromptActivityEntry {
  prompt: RoomClippyPrompt;
  role: VideoRole;
  recordedAt: number;
}

type RoomClippyInteractionEventType = 'ai_chat_user' | 'ai_chat_agent' | 'ai_agent_status' | 'clippy_action';

interface RoomClippyInteractionEvent {
  id: string;
  clientId: string;
  createdAt: number;
  eventType: RoomClippyInteractionEventType;
  actor: 'host' | 'guest' | 'agent' | 'system';
  text: string;
  evidence?: Record<string, unknown>;
}

interface RoomClippyInteractionActivityEntry {
  event: RoomClippyInteractionEvent;
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

type RoomFileKind = 'text' | 'paint' | 'json' | 'link';

interface RoomFile {
  id: string;
  name: string;
  kind: RoomFileKind;
  content: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  updatedBy?: VideoRole;
}

type RoomFileSystemEvent =
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'UPSERT_FILE';
      file: RoomFile;
      evidence?: Record<string, unknown>;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'DELETE_FILE';
      fileId: string;
      file?: RoomFile;
      evidence?: Record<string, unknown>;
    };

interface RoomFileSystemActivityEntry {
  event: RoomFileSystemEvent;
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
  private roomSurface: RoomSurface = 'standard';
  private metadata: VideoRoomMetadata = {};

  constructor(state: DurableObjectState) {
    this.state = state;

    // Restore status from storage on cold start
    void state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<unknown>('status');
      if (this.isSessionStatus(stored)) this.sessionStatus = stored;
      const meta = await state.storage.get<VideoRoomMetadata>('metadata');
      if (meta) this.metadata = meta;
      const surface = await state.storage.get<unknown>('roomSurface');
      if (this.isRoomSurface(surface)) this.roomSurface = surface;
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

  private isRoomDesktopWindowType(value: unknown): value is RoomDesktopWindowType {
    return typeof value === 'string'
      && [
        'video',
        'workspace',
        'chat',
        'tasks',
        'snippet',
        'browser',
        'notepad',
        'paint',
        'terminal',
        'custom',
      ].includes(value);
  }

  private isRoomSurface(value: unknown): value is RoomSurface {
    return value === 'standard' || value === 'win95';
  }

  private optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private isUnitNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  }

  private parseDesktopWindow(value: unknown): RoomDesktopWindow | null {
    if (!this.isRecord(value)) return null;
    if (
      typeof value.id !== 'string'
      || !this.isRoomDesktopWindowType(value.windowType)
      || typeof value.title !== 'string'
    ) {
      return null;
    }
    return {
      id: value.id,
      windowType: value.windowType,
      title: value.title,
      icon: typeof value.icon === 'string' ? value.icon : undefined,
      x: this.optionalNumber(value.x),
      y: this.optionalNumber(value.y),
      width: this.optionalNumber(value.width),
      height: this.optionalNumber(value.height),
      minimized: typeof value.minimized === 'boolean' ? value.minimized : undefined,
      maximized: typeof value.maximized === 'boolean' ? value.maximized : undefined,
      focused: typeof value.focused === 'boolean' ? value.focused : undefined,
      data: this.isRecord(value.data) ? value.data : undefined,
    };
  }

  private parseDesktopEvent(value: unknown): RoomDesktopEvent | null {
    if (!this.isRecord(value)) return null;
    if (
      typeof value.id !== 'string'
      || typeof value.clientId !== 'string'
      || typeof value.createdAt !== 'number'
    ) {
      return null;
    }
    if (value.kind === 'OPEN_WINDOW') {
      const windowConfig = this.parseDesktopWindow(value.window);
      if (!windowConfig) return null;
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'OPEN_WINDOW',
        window: windowConfig,
        evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
      };
    }
    if (value.kind === 'SET_ROOM_SURFACE' && this.isRoomSurface(value.surface)) {
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'SET_ROOM_SURFACE',
        surface: value.surface,
        previousSurface: this.isRoomSurface(value.previousSurface) ? value.previousSurface : undefined,
        action: typeof value.action === 'string' ? value.action : undefined,
        source: typeof value.source === 'string' ? value.source : undefined,
        surfaceControlEventSource: typeof value.surfaceControlEventSource === 'string'
          ? value.surfaceControlEventSource
          : undefined,
        surfaceChangeId: typeof value.surfaceChangeId === 'string' ? value.surfaceChangeId : undefined,
        capturedAtMs: this.optionalNumber(value.capturedAtMs),
        roomPhase: typeof value.roomPhase === 'string' ? value.roomPhase : undefined,
        durableObjectReplayExpected: typeof value.durableObjectReplayExpected === 'boolean'
          ? value.durableObjectReplayExpected
          : undefined,
      };
    }
    if (value.kind === 'START_MENU_STATE' && typeof value.open === 'boolean') {
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'START_MENU_STATE',
        open: value.open,
        evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
      };
    }
    if (value.kind === 'CLOSE_WINDOW' && typeof value.windowId === 'string') {
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'CLOSE_WINDOW',
        windowId: value.windowId,
        evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
      };
    }
    if (value.kind === 'UPDATE_WINDOW_DATA' && typeof value.windowId === 'string' && this.isRecord(value.data)) {
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'UPDATE_WINDOW_DATA',
        windowId: value.windowId,
        data: value.data,
        evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
      };
    }
    if (value.kind === 'UPDATE_WINDOW_STATE' && typeof value.windowId === 'string') {
      const event: RoomDesktopEvent = {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'UPDATE_WINDOW_STATE',
        windowId: value.windowId,
        x: this.optionalNumber(value.x),
        y: this.optionalNumber(value.y),
        width: this.optionalNumber(value.width),
        height: this.optionalNumber(value.height),
        minimized: typeof value.minimized === 'boolean' ? value.minimized : undefined,
        maximized: typeof value.maximized === 'boolean' ? value.maximized : undefined,
        focused: typeof value.focused === 'boolean' ? value.focused : undefined,
        evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
      };
      if (
        event.x === undefined
        && event.y === undefined
        && event.width === undefined
        && event.height === undefined
        && event.minimized === undefined
        && event.maximized === undefined
        && event.focused === undefined
      ) {
        return null;
      }
      return event;
    }
    if (value.kind === 'WORKSPACE_STATE_CHANGED') {
      const status = typeof value.status === 'string' && value.status.length <= 80
        ? value.status
        : null;
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'WORKSPACE_STATE_CHANGED',
        actor: value.actor === 'host' || value.actor === 'guest' ? value.actor : undefined,
        workspaceStateEventId: this.safeTextOrNull(value.workspaceStateEventId, 240) ?? undefined,
        capturedAtMs: this.safeNumberOrNull(value.capturedAtMs) ?? undefined,
        status,
        workspaceSessionId: this.safeTextOrNull(value.workspaceSessionId, 160),
        errorMessage: this.safeWorkspaceDiagnosticOrNull(value.errorMessage, 500),
        repoUrl: this.safeTextOrNull(value.repoUrl, 500),
        githubPrNumber: this.safeNumberOrNull(value.githubPrNumber),
        matchedRepoId: this.safeNumberOrNull(value.matchedRepoId),
        challengeStatus: this.safeTextOrNull(value.challengeStatus, 80),
        challengeKind: this.safeTextOrNull(value.challengeKind, 80),
        challengeSource: this.safeTextOrNull(value.challengeSource, 120),
        challengeMessage: this.safeTextOrNull(value.challengeMessage, 500),
        canLaunch: this.safeBoolean(value.canLaunch),
        ttlSeconds: this.safeNumberOrNull(value.ttlSeconds),
        ttlSource: this.safeTextOrNull(value.ttlSource, 80),
        expiresAt: this.safeTextOrNull(value.expiresAt, 80),
        expiringSoon: this.safeBoolean(value.expiringSoon),
        source: this.safeTextOrNull(value.source, 80) ?? undefined,
        workspaceEventSource: this.safeTextOrNull(value.workspaceEventSource, 80) ?? undefined,
        workspaceStateSource: this.safeTextOrNull(value.workspaceStateSource, 80) ?? undefined,
        workspaceTelemetryPersisted: this.safeBoolean(value.workspaceTelemetryPersisted),
        proxyUrlPersisted: this.safeBoolean(value.proxyUrlPersisted),
      };
    }
    return null;
  }

  private hasSourceBackedWorkspaceStateEvidence(
    event: Extract<RoomDesktopEvent, { kind: 'WORKSPACE_STATE_CHANGED' }>,
    actor: 'host' | 'guest',
  ): boolean {
    const status = typeof event.status === 'string' && event.status.length > 0 ? event.status : null;
    const capturedAtMs = event.capturedAtMs;
    const workspaceStateSource = event.workspaceStateSource;
    const workspaceSessionId = typeof event.workspaceSessionId === 'string' && event.workspaceSessionId.length > 0
      ? event.workspaceSessionId
      : null;
    const stateIdSession = workspaceSessionId ?? 'no-session';
    return event.actor === actor
      && status !== null
      && event.source === 'browser_workspace_state_observer'
      && event.workspaceEventSource === 'browser_workspace_state_observer'
      && typeof workspaceStateSource === 'string'
      && (
        workspaceStateSource === 'initial_load'
        || workspaceStateSource === 'launch'
        || workspaceStateSource === 'refresh'
        || workspaceStateSource === 'error'
      )
      && typeof capturedAtMs === 'number'
      && Number.isInteger(capturedAtMs)
      && capturedAtMs >= 0
      && event.workspaceStateEventId === `workspace-state:${actor}:${capturedAtMs}:${workspaceStateSource}:${stateIdSession}:${status}`
      && (status === 'ERROR' || workspaceSessionId !== null)
      && event.workspaceTelemetryPersisted === true
      && event.proxyUrlPersisted === false;
  }

  private hasSourceBackedDesktopEventEvidence(event: RoomDesktopEvent, role: VideoRole): boolean {
    const actor = this.isHostRole(role) ? 'host' : 'guest';
    if (event.kind === 'SET_ROOM_SURFACE') {
      const expectedAction = event.surface === 'win95' ? 'enter_desktop' : 'exit_desktop';
      return event.source === 'room_surface_control'
        && event.surfaceControlEventSource === 'browser_room_surface_toggle'
        && event.action === expectedAction
        && event.previousSurface !== undefined
        && event.previousSurface !== event.surface
        && typeof event.surfaceChangeId === 'string'
        && typeof event.capturedAtMs === 'number'
        && Number.isFinite(event.capturedAtMs)
        && event.surfaceChangeId === `surface:${actor}:${event.capturedAtMs}:${event.previousSurface}:${event.surface}`
        && typeof event.roomPhase === 'string'
        && event.durableObjectReplayExpected === true;
    }
    if (event.kind === 'WORKSPACE_STATE_CHANGED') {
      return this.hasSourceBackedWorkspaceStateEvidence(event, actor);
    }
    const evidence = event.evidence;
    if (!this.isRecord(evidence)) return false;
    if (event.kind === 'START_MENU_STATE') {
      const action = event.open ? 'open' : 'close';
      const capturedAtMs = evidence.capturedAtMs;
      const menuEventSource = evidence.menuEventSource;
      const startMenuEventId = evidence.startMenuEventId;
      return evidence.source === 'win95_start_menu_control'
        && typeof menuEventSource === 'string'
        && START_MENU_EVENT_SOURCES.has(menuEventSource)
        && evidence.actor === actor
        && evidence.menuId === 'start'
        && evidence.action === action
        && evidence.open === event.open
        && typeof startMenuEventId === 'string'
        && START_MENU_EVENT_ID_RE.test(startMenuEventId)
        && typeof capturedAtMs === 'number'
        && Number.isInteger(capturedAtMs)
        && capturedAtMs >= 0
        && startMenuEventId === `start-menu:${actor}:${capturedAtMs}:${action}:${menuEventSource}`
        && evidence.surface === 'win95'
        && typeof evidence.roomPhase === 'string'
        && evidence.durableObjectReplayExpected === true;
    }
    if (event.kind === 'OPEN_WINDOW' || event.kind === 'CLOSE_WINDOW') {
      const kind = event.kind === 'OPEN_WINDOW' ? 'open' : 'close';
      const windowId = event.kind === 'OPEN_WINDOW' ? event.window.id : event.windowId;
      return evidence.source === 'window_lifecycle_client_submit'
        && typeof evidence.lifecycleSource === 'string'
        && WINDOW_LIFECYCLE_SOURCES.has(evidence.lifecycleSource)
        && evidence.lifecycleKind === kind
        && evidence.actor === actor
        && evidence.windowId === windowId
        && typeof evidence.windowType === 'string'
        && typeof evidence.windowTitle === 'string'
        && typeof evidence.windowLifecycleId === 'string'
        && typeof evidence.capturedAtMs === 'number'
        && Number.isFinite(evidence.capturedAtMs)
        && evidence.surface === 'win95'
        && typeof evidence.roomPhase === 'string'
        && evidence.durableObjectReplayExpected === true;
    }
    if (event.kind === 'UPDATE_WINDOW_DATA') {
      const isBrowserNavigation = this.isRecord(event.data) && typeof event.data.currentUrl === 'string';
      if (isBrowserNavigation) {
        return evidence.source === 'room_browser_window'
          && evidence.navigationSource === 'browser_window_client_submit'
          && evidence.actor === actor
          && evidence.windowId === event.windowId
          && typeof evidence.browserNavigationId === 'string'
          && typeof evidence.capturedAtMs === 'number'
          && Number.isFinite(evidence.capturedAtMs)
          && typeof evidence.navigationTrigger === 'string'
          && typeof evidence.url === 'string'
          && typeof evidence.urlFingerprint === 'string'
          && evidence.surface === 'win95'
          && typeof evidence.roomPhase === 'string'
          && evidence.durableObjectReplayExpected === true;
      }
      return evidence.source === 'window_data_client_submit'
        && typeof evidence.dataSource === 'string'
        && WINDOW_DATA_SOURCES.has(evidence.dataSource)
        && evidence.actor === actor
        && evidence.windowId === event.windowId
        && typeof evidence.windowDataUpdateId === 'string'
        && typeof evidence.capturedAtMs === 'number'
        && Number.isFinite(evidence.capturedAtMs)
        && Array.isArray(evidence.dataKeys)
        && evidence.dataKeys.length > 0
        && this.isRecord(evidence.dataValueFingerprints)
        && evidence.surface === 'win95'
        && typeof evidence.roomPhase === 'string'
        && evidence.durableObjectReplayExpected === true;
    }
    if (event.kind === 'UPDATE_WINDOW_STATE') {
      return evidence.source === 'window_state_client_submit'
        && typeof evidence.stateSource === 'string'
        && WINDOW_STATE_SOURCES.has(evidence.stateSource)
        && evidence.actor === actor
        && evidence.windowId === event.windowId
        && typeof evidence.windowStateChangeId === 'string'
        && typeof evidence.capturedAtMs === 'number'
        && Number.isFinite(evidence.capturedAtMs)
        && typeof evidence.action === 'string'
        && evidence.surface === 'win95'
        && typeof evidence.roomPhase === 'string'
        && evidence.durableObjectReplayExpected === true;
    }
    return false;
  }

  private parseDesktopWindows(value: unknown): RoomDesktopWindow[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseDesktopWindow(entry))
      .filter((entry): entry is RoomDesktopWindow => entry !== null);
  }

  private isRoomClippyPromptSource(value: unknown): value is RoomClippyPromptSource {
    return value === 'system' || value === 'agent' || value === 'host' || value === 'guest';
  }

  private isVideoRole(value: unknown): value is VideoRole {
    return value === 'RECRUITER'
      || value === 'CANDIDATE'
      || value === 'HOST'
      || value === 'GUEST';
  }

  private parseClippyAction(value: unknown): RoomClippyAction | null {
    if (!this.isRecord(value)) return null;
    if (
      typeof value.id !== 'string'
      || value.id.length === 0
      || value.id.length > 80
      || typeof value.label !== 'string'
      || value.label.length === 0
      || value.label.length > 80
    ) {
      return null;
    }
    return {
      id: value.id,
      label: value.label,
      disabled: typeof value.disabled === 'boolean' ? value.disabled : undefined,
    };
  }

  private parseClippyPrompt(value: unknown): RoomClippyPrompt | null {
    if (!this.isRecord(value)) return null;
    if (
      typeof value.id !== 'string'
      || value.id.length === 0
      || typeof value.clientId !== 'string'
      || value.clientId.length === 0
      || typeof value.createdAt !== 'number'
      || typeof value.text !== 'string'
      || value.text.trim().length === 0
      || value.text.length > 800
    ) {
      return null;
    }
    const actions = Array.isArray(value.actions)
      ? value.actions
          .slice(0, 4)
          .map((entry) => this.parseClippyAction(entry))
          .filter((entry): entry is RoomClippyAction => entry !== null)
      : undefined;
    const targetRoles = Array.isArray(value.targetRoles)
      ? value.targetRoles.filter((entry): entry is VideoRole => this.isVideoRole(entry))
      : undefined;
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      source: this.isRoomClippyPromptSource(value.source) ? value.source : 'system',
      text: value.text,
      promptEventSource: value.promptEventSource === 'browser_proactive_clippy_prompt' || value.promptEventSource === 'clippy_agent_bridge'
        ? value.promptEventSource
        : undefined,
      promptTrigger: this.safeTextOrNull(value.promptTrigger, 120) ?? undefined,
      surface: this.isRoomSurface(value.surface) ? value.surface : undefined,
      roomPhase: this.safeTextOrNull(value.roomPhase, 80) ?? undefined,
      workspaceStatus: this.safeTextOrNull(value.workspaceStatus, 80),
      workspaceSessionId: this.safeTextOrNull(value.workspaceSessionId, 160),
      agentResponseClaimed: this.safeBoolean(value.agentResponseClaimed),
      hold: typeof value.hold === 'boolean' ? value.hold : undefined,
      targetRoles: targetRoles && targetRoles.length > 0 ? [...new Set(targetRoles)] : undefined,
      actions: actions && actions.length > 0 ? actions : undefined,
    };
  }

  private hasSourceBackedClippyPromptEvidence(prompt: RoomClippyPrompt, role: VideoRole): boolean {
    const actor = this.isHostRole(role) ? 'host' : 'guest';
    return actor === 'host'
      && prompt.promptEventSource === 'browser_proactive_clippy_prompt'
      && (prompt.source === 'system' || prompt.source === 'host')
      && Number.isInteger(prompt.createdAt)
      && prompt.createdAt >= 0
      && typeof prompt.promptTrigger === 'string'
      && prompt.promptTrigger.length > 0
      && (prompt.surface === 'standard' || prompt.surface === 'win95')
      && typeof prompt.roomPhase === 'string'
      && prompt.roomPhase.length > 0
      && prompt.agentResponseClaimed === false;
  }

  private async getDesktopWindows(): Promise<RoomDesktopWindow[]> {
    return this.parseDesktopWindows(await this.state.storage.get<unknown>('desktopWindows'));
  }

  private parseDesktopActivityEntry(value: unknown): RoomDesktopActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const event = this.parseDesktopEvent(value.event);
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

  private parseDesktopActivityLog(value: unknown): RoomDesktopActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseDesktopActivityEntry(entry))
      .filter((entry): entry is RoomDesktopActivityEntry => entry !== null);
  }

  private async getCurrentClippyPrompt(): Promise<RoomClippyPrompt | null> {
    return this.parseClippyPrompt(await this.state.storage.get<unknown>('currentClippyPrompt'));
  }

  private parseClippyPromptActivityEntry(value: unknown): RoomClippyPromptActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const prompt = this.parseClippyPrompt(value.prompt);
    if (
      prompt === null
      || !this.isVideoRole(value.role)
      || typeof value.recordedAt !== 'number'
      || !Number.isFinite(value.recordedAt)
    ) {
      return null;
    }
    return { prompt, role: value.role, recordedAt: value.recordedAt };
  }

  private parseClippyPromptActivityLog(value: unknown): RoomClippyPromptActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseClippyPromptActivityEntry(entry))
      .filter((entry): entry is RoomClippyPromptActivityEntry => entry !== null);
  }

  private isRoomClippyInteractionEventType(value: unknown): value is RoomClippyInteractionEventType {
    return value === 'ai_chat_user'
      || value === 'ai_chat_agent'
      || value === 'ai_agent_status'
      || value === 'clippy_action';
  }

  private safeClippyInteractionTextOrNull(eventType: RoomClippyInteractionEventType, value: unknown): string | undefined {
    if (eventType === 'ai_chat_agent' || eventType === 'ai_agent_status') {
      return this.safeWorkspaceDiagnosticOrNull(value, 8000) ?? undefined;
    }
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 8000) return undefined;
    return value;
  }

  private parseClippyInteractionEvent(value: unknown): RoomClippyInteractionEvent | null {
    if (!this.isRecord(value)) return null;
    if (
      !this.isSafeFileText(value.id, 160)
      || !this.isSafeFileText(value.clientId, 160)
      || typeof value.createdAt !== 'number'
      || !Number.isFinite(value.createdAt)
      || !this.isRoomClippyInteractionEventType(value.eventType)
      || (
        value.actor !== 'host'
        && value.actor !== 'guest'
        && value.actor !== 'agent'
        && value.actor !== 'system'
      )
    ) {
      return null;
    }
    const text = this.safeClippyInteractionTextOrNull(value.eventType, value.text);
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

  private hasSourceBackedClippyInteractionEvidence(
    event: RoomClippyInteractionEvent,
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
          && CLIPPY_PROMPT_BLOCKED_REASONS.has(String(evidence.bridgeBlockedReason))
        : evidence.browserQueuedBridgeMessage === true
          && workspaceSessionId !== null
          && typeof evidence.workspaceStatus === 'string';
      return (event.actor === 'host' || event.actor === 'guest')
        && event.actor === senderActor
        && evidence.actor === event.actor
        && evidence.source === 'clippy_agent_chat_client_submit'
        && evidence.agentChatEventSource === 'browser_clippy_chat_window'
        && evidence.bridgeMessageType === 'CHAT'
        && evidence.bridgeProtocol === 'clippy_dev_container_ws'
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
        && CLIPPY_PROMPT_FINGERPRINT_RE.test(promptFingerprint)
        && evidence.promptLength === event.text.length
        && evidence.promptId === `${workspacePart}:${event.actor}:prompt:${promptTimestamp}:${promptFingerprint}`
        && (evidence.surface === 'standard' || evidence.surface === 'win95')
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
        && (evidence.surface === 'standard' || evidence.surface === 'win95')
        && typeof evidence.roomPhase === 'string'
        && typeof evidence.messageTimestamp === 'number'
        && Number.isFinite(evidence.messageTimestamp)
        && evidence.messageTimestamp >= 0
        && evidence.agentResponseClaimed === true;
      return event.actor === 'agent'
        && evidence.source === 'clippy_agent_bridge'
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
      const browserObservationOk = evidence.agentStatusEventSource === 'browser_clippy_agent_ws'
        && (evidence.surface === 'standard' || evidence.surface === 'win95')
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
        && evidence.source === 'clippy_agent_bridge'
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

    if (event.eventType === 'clippy_action') {
      const source = typeof evidence.source === 'string' ? evidence.source : null;
      const capturedAtMs = typeof evidence.capturedAtMs === 'number' && Number.isInteger(evidence.capturedAtMs)
        ? evidence.capturedAtMs
        : null;
      const origin = typeof evidence.origin === 'string' ? evidence.origin : null;
      const executionStatus = typeof evidence.executionStatus === 'string' ? evidence.executionStatus : null;
      const actionId = typeof evidence.actionId === 'string' ? evidence.actionId : null;
      const expectedId = source && capturedAtMs !== null && origin && executionStatus && actionId
        ? `clippy-action:${event.actor}:${capturedAtMs}:${source}:${origin}:${executionStatus}:${safeEvidenceIdPart(actionId)}`
        : null;
      const idOk = typeof evidence.clippyActionEventId === 'string'
        && CLIPPY_ACTION_EVENT_ID_RE.test(evidence.clippyActionEventId)
        && evidence.clippyActionEventId === expectedId;
      const surfaceOk = evidence.surface === 'standard' || evidence.surface === 'win95';
      const roomContextOk = surfaceOk && typeof evidence.roomPhase === 'string';
      if (source === 'clippy_tray_ui' || source === 'clippy_prompt_ui' || source === 'clippy_chat_ui') {
        const originOk = source === 'clippy_tray_ui'
          ? origin === 'tray' && evidence.actionSource === 'win95_taskbar_tray'
          : source === 'clippy_chat_ui'
            ? origin === 'chat' && evidence.actionSource === 'clippy_chat_window'
            : (origin === 'prompt' && evidence.actionSource === 'clippy_prompt_ui');
        const statusOk = executionStatus === 'opened'
          || executionStatus === 'closed'
          || executionStatus === 'dismissed'
          || executionStatus === 'executed';
        return (event.actor === 'host' || event.actor === 'guest')
          && event.actor === senderActor
          && evidence.executedBy === event.actor
          && actionId !== null
          && capturedAtMs !== null
          && capturedAtMs >= 0
          && idOk
          && roomContextOk
          && originOk
          && statusOk
          && evidence.agentResponseClaimed === false
          && (evidence.agent === undefined || evidence.agent === null);
      }
      if (source === 'clippy_agent_bridge') {
        const commonOk = actionId !== null
          && capturedAtMs !== null
          && capturedAtMs >= 0
          && idOk
          && origin === 'agent'
          && typeof evidence.agent === 'string'
          && evidence.agent.trim().length > 0
          && hasOptionalBrowserPromptRef(evidence)
          && evidence.actionProtocol === 'clippy_room_action_tag'
          && evidence.bridgeEventType === 'ROOM_ACTION';
        const suggestedOk = event.actor === 'agent'
          && executionStatus === 'suggested'
          && (evidence.actionSource === 'agent_stdout' || evidence.actionSource === 'agent_api_response')
          && typeof evidence.observedAt === 'string'
          && typeof evidence.bridgePersisted === 'boolean';
        const executedOk = (event.actor === 'host' || event.actor === 'guest')
          && event.actor === senderActor
          && executionStatus === 'executed'
          && evidence.executedBy === event.actor
          && (evidence.actionSource === 'agent_stdout_action' || evidence.actionSource === 'agent_api_response_action')
          && typeof evidence.agentActionObservedAt === 'string'
          && typeof evidence.agentActionBridgePersisted === 'boolean'
          && roomContextOk
          && evidence.agentResponseClaimed === false;
        return commonOk && (suggestedOk || executedOk);
      }
    }

    return false;
  }

  private parseClippyInteractionActivityEntry(value: unknown): RoomClippyInteractionActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const event = this.parseClippyInteractionEvent(value.event);
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

  private parseClippyInteractionActivityLog(value: unknown): RoomClippyInteractionActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseClippyInteractionActivityEntry(entry))
      .filter((entry): entry is RoomClippyInteractionActivityEntry => entry !== null);
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
    const surface = value.surface === 'standard' || value.surface === 'win95' ? value.surface : undefined;
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
      deliveryStatus: 'accepted',
    };
  }

  private hasSourceBackedChatEvidence(message: RoomChatMessage, role: VideoRole): boolean {
    const evidence = message.evidence;
    if (!evidence) return false;
    const actor = this.isHostRole(role) ? 'host' : 'guest';
    const messageCreatedAt = evidence.messageCreatedAt;
    const messageLength = evidence.messageLength;
    return evidence.source === 'room_chat_client_submit'
      && evidence.chatEventSource === 'browser_room_chat_window'
      && evidence.actor === actor
      && evidence.roomMessageId === message.id
      && evidence.clientId === message.clientId
      && messageCreatedAt === message.createdAt
      && typeof messageCreatedAt === 'number'
      && Number.isFinite(messageCreatedAt)
      && messageCreatedAt >= 0
      && messageLength === message.text.length
      && typeof messageLength === 'number'
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
    const controlSurface = evidence.surface === 'win95'
      ? 'win95_video_window'
      : 'standard_video_call';
    return event.role === role
      && evidence.source === 'video_room_media_controls'
      && evidence.mediaControlEventSource === 'browser_video_control_button'
      && evidence.actor === actor
      && evidence.control === event.control
      && evidence.previousEnabled === event.previousEnabled
      && evidence.enabled === event.enabled
      && evidence.action === action
      && evidence.controlAction === 'toggle'
      && (evidence.surface === 'standard' || evidence.surface === 'win95')
      && typeof evidence.roomPhase === 'string'
      && evidence.roomPhase.length > 0
      && evidence.controlSurface === controlSurface
      && evidence.mediaSource === 'local_media_stream'
      && evidence.rawMediaStreamPersisted === false
      && typeof evidence.capturedAtMs === 'number'
      && Number.isInteger(evidence.capturedAtMs)
      && evidence.capturedAtMs >= 0
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
      && recordingStateEventId === `recording:host:${capturedAtMs}:${event.lifecycleKind}:${event.status}`
      && (evidence.surface === 'standard' || evidence.surface === 'win95')
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

  private parseCursorPresence(value: unknown, fallbackRole?: VideoRole): RoomCursorPresence | null {
    if (!this.isRecord(value)) return null;
    const role = this.isVideoRole(value.role) ? value.role : fallbackRole;
    if (
      !this.isSafeFileText(value.clientId, 160)
      || !role
      || !this.isUnitNumber(value.x)
      || !this.isUnitNumber(value.y)
      || typeof value.updatedAt !== 'number'
      || !Number.isFinite(value.updatedAt)
      || value.updatedAt < 0
    ) {
      return null;
    }
    return {
      clientId: value.clientId,
      role,
      x: value.x,
      y: value.y,
      updatedAt: value.updatedAt,
      evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
    };
  }

  private hasSourceBackedCursorEvidence(cursor: RoomCursorPresence, role: VideoRole): boolean {
    const evidence = cursor.evidence;
    if (!this.isRecord(evidence)) return false;
    const actor = this.isHostRole(role) ? 'host' : 'guest';
    const normalizedX = this.isUnitNumber(evidence.normalizedX) ? evidence.normalizedX : null;
    const normalizedY = this.isUnitNumber(evidence.normalizedY) ? evidence.normalizedY : null;
    const previousX = evidence.previousNormalizedX;
    const previousY = evidence.previousNormalizedY;
    const distance = evidence.distanceFromPrevious;
    const sampledAtMs = evidence.sampledAtMs;
    const cursorSampleId = evidence.cursorSampleId;
    if (normalizedX === null || normalizedY === null) return false;
    if (previousX !== null && !this.isUnitNumber(previousX)) return false;
    if (previousY !== null && !this.isUnitNumber(previousY)) return false;
    if (distance !== null && (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0)) {
      return false;
    }
    if (typeof sampledAtMs !== 'number' || !Number.isInteger(sampledAtMs) || sampledAtMs < 0) {
      return false;
    }
    const expectedSampleId = `cursor:${actor}:${sampledAtMs}:${Math.round(normalizedX * 1000)}:${Math.round(normalizedY * 1000)}`;
    return cursor.role === role
      && evidence.source === 'win95_cursor_presence_client_sample'
      && evidence.cursorEventSource === 'browser_win95_desktop_pointermove'
      && evidence.actor === actor
      && evidence.surface === 'win95'
      && typeof evidence.roomPhase === 'string'
      && evidence.roomPhase.length > 0
      && evidence.evidenceSampling === 'presence_sample'
      && evidence.sampleIntervalMs === CURSOR_PRESENCE_SAMPLE_INTERVAL_MS
      && evidence.movementThreshold === CURSOR_PRESENCE_MOVEMENT_THRESHOLD
      && evidence.rawCursorMovesPersisted === false
      && typeof cursorSampleId === 'string'
      && CURSOR_SAMPLE_ID_RE.test(cursorSampleId)
      && cursorSampleId === expectedSampleId
      && Math.abs(cursor.x - normalizedX) <= 0.001
      && Math.abs(cursor.y - normalizedY) <= 0.001;
  }

  private parseCursorActivityEntry(value: unknown): RoomCursorActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const cursor = this.parseCursorPresence(value.cursor);
    if (
      cursor === null
      || !this.isVideoRole(value.role)
      || typeof value.recordedAt !== 'number'
      || !Number.isFinite(value.recordedAt)
    ) {
      return null;
    }
    return { cursor, role: value.role, recordedAt: value.recordedAt };
  }

  private parseCursorActivityLog(value: unknown): RoomCursorActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseCursorActivityEntry(entry))
      .filter((entry): entry is RoomCursorActivityEntry => entry !== null);
  }

  private async recordCursorActivity(cursor: RoomCursorPresence, role: VideoRole): Promise<void> {
    const previous = this.parseCursorActivityLog(await this.state.storage.get<unknown>('cursorActivityLog'));
    const next = [
      ...previous.slice(-249),
      { cursor, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('cursorActivityLog', next);
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
    const commonOk = event.actor === 'system'
      && evidence.source === 'code_server_workspace'
      && evidence.observedBy === 'clippy_agent_bridge'
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
      && (evidence.surface === 'standard' || evidence.surface === 'win95')
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
      && (evidence.surface === 'standard' || evidence.surface === 'win95')
      && typeof evidence.roomPhase === 'string'
      && typeof evidence.workspaceStatus === 'string'
      && typeof evidence.workspaceSessionId === 'string'
      && (evidence.repoUrl === null || typeof evidence.repoUrl === 'string');
    if (!commonOk) return false;

    if (event.kind === 'COMMAND') {
      const sequence = evidence.terminalCommandSequence;
      const fingerprint = evidence.commandFingerprint;
      return evidence.actor === senderActor
        && typeof sequence === 'number'
        && Number.isInteger(sequence)
        && sequence > 0
        && typeof fingerprint === 'string'
        && TERMINAL_FINGERPRINT_RE.test(fingerprint)
        && evidence.commandLength === event.text.length
        && evidence.terminalCommandId === `${terminalSessionId}:command:${senderActor}:${capturedAtMs}:${sequence}:${fingerprint}`;
    }

    const sequence = evidence.terminalOutputSequence;
    const fingerprint = evidence.outputFingerprint;
    const commandId = evidence.terminalCommandId;
    return evidence.actor === 'system'
      && typeof sequence === 'number'
      && Number.isInteger(sequence)
      && sequence > 0
      && typeof fingerprint === 'string'
      && TERMINAL_FINGERPRINT_RE.test(fingerprint)
      && evidence.outputLength === event.text.length
      && evidence.terminalOutputChunkId === `${terminalSessionId}:output:system:${capturedAtMs}:${sequence}:${fingerprint}`
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

  private isRoomFileKind(value: unknown): value is RoomFileKind {
    return value === 'text' || value === 'paint' || value === 'json' || value === 'link';
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

  private parseRoomFile(value: unknown): RoomFile | null {
    if (!this.isRecord(value)) return null;
    if (
      !this.isSafeFileText(value.id, 120)
      || !this.isSafeFileText(value.name, 160)
      || !this.isRoomFileKind(value.kind)
      || typeof value.content !== 'string'
      || value.content.length > 512_000
      || typeof value.createdAt !== 'number'
      || typeof value.updatedAt !== 'number'
      || !Number.isFinite(value.createdAt)
      || !Number.isFinite(value.updatedAt)
    ) {
      return null;
    }
    const metadata = this.isRecord(value.metadata) ? value.metadata : undefined;
    if (metadata) {
      try {
        if (JSON.stringify(metadata).length > 8192) return null;
      } catch {
        return null;
      }
    }
    return {
      id: value.id,
      name: value.name,
      kind: value.kind,
      content: value.content,
      mimeType: this.isSafeFileText(value.mimeType, 160) ? value.mimeType : undefined,
      metadata,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      updatedBy: this.isVideoRole(value.updatedBy) ? value.updatedBy : undefined,
    };
  }

  private parseFileSystemEvent(value: unknown): RoomFileSystemEvent | null {
    if (!this.isRecord(value)) return null;
    if (
      !this.isSafeFileText(value.id, 120)
      || !this.isSafeFileText(value.clientId, 120)
      || typeof value.createdAt !== 'number'
      || !Number.isFinite(value.createdAt)
    ) {
      return null;
    }
    if (value.kind === 'UPSERT_FILE') {
      const file = this.parseRoomFile(value.file);
      if (!file) return null;
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'UPSERT_FILE',
        file,
        evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
      };
    }
    if (value.kind === 'DELETE_FILE' && this.isSafeFileText(value.fileId, 120)) {
      const file = this.parseRoomFile(value.file);
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'DELETE_FILE',
        fileId: value.fileId,
        file: file ?? undefined,
        evidence: this.isRecord(value.evidence) ? value.evidence : undefined,
      };
    }
    return null;
  }

  private parseRoomFiles(value: unknown): RoomFile[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseRoomFile(entry))
      .filter((entry): entry is RoomFile => entry !== null);
  }

  private async getRoomFileSystem(): Promise<RoomFile[]> {
    return this.parseRoomFiles(await this.state.storage.get<unknown>('roomFileSystem'));
  }

  private async enrichFileSystemEvent(event: RoomFileSystemEvent): Promise<RoomFileSystemEvent> {
    if (event.kind !== 'DELETE_FILE') return event;
    const files = await this.getRoomFileSystem();
    const deletedFile = files.find((file) => file.id === event.fileId);
    if (!deletedFile) {
      return {
        ...event,
        file: undefined,
      };
    }
    return { ...event, file: deletedFile };
  }

  private hasSourceBackedFileEvidence(event: RoomFileSystemEvent, role: VideoRole): boolean {
    const evidence = event.evidence;
    if (!this.isRecord(evidence)) return false;
    const actor = this.isHostRole(role) ? 'host' : 'guest';
    const operation = event.kind === 'DELETE_FILE' ? 'delete' : 'upsert';
    const fileId = event.kind === 'DELETE_FILE' ? event.fileId : event.file.id;
    return evidence.source === 'win95_shared_file_system'
      && evidence.fileEventSource === 'browser_client_submit'
      && evidence.actor === actor
      && evidence.operation === operation
      && evidence.fileId === fileId
      && typeof evidence.fileChangeId === 'string'
      && typeof evidence.capturedAtMs === 'number'
      && Number.isFinite(evidence.capturedAtMs)
      && evidence.surface === 'win95'
      && typeof evidence.roomPhase === 'string'
      && evidence.durableObjectReplayExpected === true;
  }

  private parseFileSystemActivityEntry(value: unknown): RoomFileSystemActivityEntry | null {
    if (!this.isRecord(value)) return null;
    const event = this.parseFileSystemEvent(value.event);
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

  private parseFileSystemActivityLog(value: unknown): RoomFileSystemActivityEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.parseFileSystemActivityEntry(entry))
      .filter((entry): entry is RoomFileSystemActivityEntry => entry !== null);
  }

  private async persistRoomSurface(surface: RoomSurface): Promise<void> {
    this.roomSurface = surface;
    await this.state.storage.put('roomSurface', surface);
  }

  private async persistDesktopEvent(event: RoomDesktopEvent): Promise<RoomDesktopWindow[]> {
    if (event.kind === 'SET_ROOM_SURFACE') {
      await this.persistRoomSurface(event.surface);
      return this.getDesktopWindows();
    }
    if (event.kind === 'START_MENU_STATE') {
      await this.state.storage.put('desktopStartMenuOpen', event.open);
      return this.getDesktopWindows();
    }
    const windows = await this.getDesktopWindows();
    if (event.kind === 'OPEN_WINDOW') {
      const withoutExisting = windows.filter((windowConfig) => windowConfig.id !== event.window.id);
      const nextWindows = [...withoutExisting, event.window];
      await this.state.storage.put('desktopWindows', nextWindows);
      return nextWindows;
    }
    if (event.kind === 'CLOSE_WINDOW') {
      const nextWindows = windows.filter((windowConfig) => windowConfig.id !== event.windowId);
      await this.state.storage.put('desktopWindows', nextWindows);
      return nextWindows;
    }
    if (event.kind === 'WORKSPACE_STATE_CHANGED') {
      return windows;
    }
    if (event.kind === 'UPDATE_WINDOW_STATE') {
      const nextWindows = windows.map((windowConfig) => {
        if (windowConfig.id !== event.windowId) {
          return event.focused === true ? { ...windowConfig, focused: false } : windowConfig;
        }
        return {
          ...windowConfig,
          x: event.x ?? windowConfig.x,
          y: event.y ?? windowConfig.y,
          width: event.width ?? windowConfig.width,
          height: event.height ?? windowConfig.height,
          minimized: event.minimized ?? windowConfig.minimized,
          maximized: event.maximized ?? windowConfig.maximized,
          focused: event.focused ?? windowConfig.focused,
        };
      });
      await this.state.storage.put('desktopWindows', nextWindows);
      return nextWindows;
    }
    const nextWindows = windows.map((windowConfig) => (
      windowConfig.id === event.windowId
        ? { ...windowConfig, data: { ...windowConfig.data, ...event.data } }
        : windowConfig
    ));
    await this.state.storage.put('desktopWindows', nextWindows);
    return nextWindows;
  }

  private async sendDesktopEventRejected(ws: WebSocket, reason: string): Promise<void> {
    const desktopStartMenuOpen = await this.state.storage.get<unknown>('desktopStartMenuOpen');
    ws.send(JSON.stringify({
      type: 'ROOM_DESKTOP_EVENT_REJECTED',
      reason,
      payload: {
        windows: await this.getDesktopWindows(),
        surface: this.roomSurface,
        startMenuOpen: typeof desktopStartMenuOpen === 'boolean' ? desktopStartMenuOpen : false,
      },
    }));
  }

  private async recordDesktopActivity(event: RoomDesktopEvent, role: VideoRole): Promise<void> {
    const previous = this.parseDesktopActivityLog(await this.state.storage.get<unknown>('desktopActivityLog'));
    const next = [
      ...previous.slice(-249),
      { event, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('desktopActivityLog', next);
  }

  private async persistClippyPrompt(prompt: RoomClippyPrompt): Promise<void> {
    await this.state.storage.put('currentClippyPrompt', prompt);
  }

  private async recordClippyPromptActivity(prompt: RoomClippyPrompt, role: VideoRole): Promise<void> {
    const previous = this.parseClippyPromptActivityLog(
      await this.state.storage.get<unknown>('clippyPromptActivityLog'),
    );
    const next = [
      ...previous.slice(-99),
      { prompt, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('clippyPromptActivityLog', next);
  }

  private async recordClippyInteractionActivity(
    event: RoomClippyInteractionEvent,
    role: VideoRole,
  ): Promise<void> {
    const previous = this.parseClippyInteractionActivityLog(
      await this.state.storage.get<unknown>('clippyInteractionActivityLog'),
    );
    const next = [
      ...previous.slice(-249),
      { event, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('clippyInteractionActivityLog', next);
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

  private roomFileProjectionEvidenceFromEvent(event: RoomFileSystemEvent): Record<string, unknown> | undefined {
    const evidence = event.evidence;
    if (event.kind !== 'UPSERT_FILE' || !this.isRecord(evidence)) return undefined;
    const projection: Record<string, unknown> = {};
    for (const key of ROOM_FILE_PROJECTION_EVIDENCE_KEYS) {
      if (evidence[key] !== undefined) {
        projection[key] = evidence[key];
      }
    }
    return projection;
  }

  private roomFileWithProjectionEvidence(file: RoomFile, event: RoomFileSystemEvent): RoomFile {
    const evidence = this.roomFileProjectionEvidenceFromEvent(event);
    if (!evidence) return file;
    return {
      ...file,
      metadata: {
        ...(file.metadata ?? {}),
        [ROOM_FILE_PROJECTION_EVIDENCE_METADATA_KEY]: evidence,
      },
    };
  }

  private async persistFileSystemEvent(event: RoomFileSystemEvent, role: VideoRole): Promise<RoomFile[]> {
    const files = await this.getRoomFileSystem();
    if (event.kind === 'DELETE_FILE') {
      const nextFiles = files.filter((file) => file.id !== event.fileId);
      await this.state.storage.put('roomFileSystem', nextFiles);
      return nextFiles;
    }
    const nextFile = this.roomFileWithProjectionEvidence({
      ...event.file,
      updatedBy: role,
    }, event);
    const nextFiles = [
      ...files.filter((file) => file.id !== event.file.id),
      nextFile,
    ];
    await this.state.storage.put('roomFileSystem', nextFiles);
    return nextFiles;
  }

  private async recordFileSystemActivity(event: RoomFileSystemEvent, role: VideoRole): Promise<void> {
    const previous = this.parseFileSystemActivityLog(
      await this.state.storage.get<unknown>('fileSystemActivityLog'),
    );
    const next = [
      ...previous.slice(-249),
      { event, role, recordedAt: Date.now() },
    ];
    await this.state.storage.put('fileSystemActivityLog', next);
  }

  private async sendFileSystemEventRejected(ws: WebSocket, reason: string): Promise<void> {
    ws.send(JSON.stringify({
      type: 'ROOM_FILE_SYSTEM_EVENT_REJECTED',
      reason,
      payload: {
        files: await this.getRoomFileSystem(),
      },
    }));
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
        initialSurface?: RoomSurface;
      };
      if (!this.metadata.meetingId) {
        this.metadata = { meetingId: body.meetingId, hostId: body.hostId };
        await this.state.storage.put('metadata', this.metadata);
      }
      const storedSurface = await this.state.storage.get<unknown>('roomSurface');
      if (this.isRoomSurface(storedSurface)) {
        this.roomSurface = storedSurface;
      } else if (this.isRoomSurface(body.initialSurface)) {
        this.roomSurface = body.initialSurface;
        await this.state.storage.put('roomSurface', this.roomSurface);
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
        desktopActivityLog: this.parseDesktopActivityLog(
          await this.state.storage.get<unknown>('desktopActivityLog'),
        ),
        chatActivityLog: this.parseChatActivityLog(
          await this.state.storage.get<unknown>('chatActivityLog'),
        ),
        codeServerFileActivityLog: this.parseCodeServerFileActivityLog(
          await this.state.storage.get<unknown>('codeServerFileActivityLog'),
        ),
        terminalActivityLog: this.parseTerminalActivityLog(
          await this.state.storage.get<unknown>('terminalActivityLog'),
        ),
        clippyPromptActivityLog: this.parseClippyPromptActivityLog(
          await this.state.storage.get<unknown>('clippyPromptActivityLog'),
        ),
        clippyInteractionActivityLog: this.parseClippyInteractionActivityLog(
          await this.state.storage.get<unknown>('clippyInteractionActivityLog'),
        ),
        mediaControlActivityLog: this.parseMediaControlActivityLog(
          await this.state.storage.get<unknown>('mediaControlActivityLog'),
        ),
        recordingActivityLog: this.parseRecordingActivityLog(
          await this.state.storage.get<unknown>('recordingActivityLog'),
        ),
        cursorActivityLog: this.parseCursorActivityLog(
          await this.state.storage.get<unknown>('cursorActivityLog'),
        ),
        fileSystemActivityLog: this.parseFileSystemActivityLog(
          await this.state.storage.get<unknown>('fileSystemActivityLog'),
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

      const desktopWindows = await this.getDesktopWindows();
      const desktopStartMenuOpen = await this.state.storage.get<unknown>('desktopStartMenuOpen');
      server.send(JSON.stringify({
        type: 'ROOM_DESKTOP_STATE',
        payload: {
          windows: desktopWindows,
          surface: this.roomSurface,
          startMenuOpen: typeof desktopStartMenuOpen === 'boolean' ? desktopStartMenuOpen : false,
        },
      }));

      const currentClippyPrompt = await this.getCurrentClippyPrompt();
      server.send(JSON.stringify({
        type: 'ROOM_CLIPPY_STATE',
        payload: { prompt: currentClippyPrompt },
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

      const roomFileSystem = await this.getRoomFileSystem();
      server.send(JSON.stringify({
        type: 'ROOM_FILE_SYSTEM_STATE',
        payload: { files: roomFileSystem },
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

    if (message.type === 'ROOM_DESKTOP_EVENT') {
      if (this.sessionStatus === 'ENDED') {
        await this.sendDesktopEventRejected(ws, 'ROOM_ENDED');
        return;
      }
      const event = this.parseDesktopEvent(message.payload);
      if (!event) {
        await this.sendDesktopEventRejected(ws, 'INVALID_EVENT');
        return;
      }
      if (!this.hasSourceBackedDesktopEventEvidence(event, senderRole)) {
        await this.sendDesktopEventRejected(ws, 'MISSING_SOURCE_EVIDENCE');
        return;
      }
      await this.persistDesktopEvent(event);
      await this.recordDesktopActivity(event, senderRole);
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_DESKTOP_EVENT',
        role: senderRole,
        payload: event,
      }));
      return;
    }

    if (message.type === 'ROOM_CLIPPY_PROMPT') {
      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'ROOM_CLIPPY_PROMPT_REJECTED',
          reason: 'ROOM_ENDED',
        }));
        return;
      }
      if (!this.isHostRole(senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_CLIPPY_PROMPT_REJECTED',
          reason: 'ONLY_HOST_CAN_PROMPT',
        }));
        return;
      }
      const prompt = this.parseClippyPrompt(message.payload);
      if (!prompt) {
        ws.send(JSON.stringify({
          type: 'ROOM_CLIPPY_PROMPT_REJECTED',
          reason: 'INVALID_PROMPT',
        }));
        return;
      }
      if (!this.hasSourceBackedClippyPromptEvidence(prompt, senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_CLIPPY_PROMPT_REJECTED',
          reason: 'MISSING_SOURCE_EVIDENCE',
        }));
        return;
      }
      await this.persistClippyPrompt(prompt);
      await this.recordClippyPromptActivity(prompt, senderRole);
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_CLIPPY_PROMPT',
        role: senderRole,
        payload: prompt,
      }));
      return;
    }

    if (message.type === 'ROOM_CLIPPY_INTERACTION') {
      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'ROOM_CLIPPY_INTERACTION_REJECTED',
          reason: 'ROOM_ENDED',
        }));
        return;
      }
      const event = this.parseClippyInteractionEvent(message.payload);
      if (!event) {
        ws.send(JSON.stringify({
          type: 'ROOM_CLIPPY_INTERACTION_REJECTED',
          reason: 'INVALID_EVENT',
        }));
        return;
      }
      if (!this.hasSourceBackedClippyInteractionEvidence(event, senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_CLIPPY_INTERACTION_REJECTED',
          reason: 'MISSING_SOURCE_EVIDENCE',
        }));
        return;
      }
      await this.recordClippyInteractionActivity(event, senderRole);
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_CLIPPY_INTERACTION',
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

    if (message.type === 'ROOM_FILE_SYSTEM_EVENT') {
      if (this.sessionStatus === 'ENDED') {
        await this.sendFileSystemEventRejected(ws, 'ROOM_ENDED');
        return;
      }
      const event = this.parseFileSystemEvent(message.payload);
      if (!event) {
        await this.sendFileSystemEventRejected(ws, 'INVALID_EVENT');
        return;
      }
      if (!this.hasSourceBackedFileEvidence(event, senderRole)) {
        await this.sendFileSystemEventRejected(ws, 'MISSING_SOURCE_EVIDENCE');
        return;
      }
      const enrichedEvent = await this.enrichFileSystemEvent(event);
      await this.persistFileSystemEvent(enrichedEvent, senderRole);
      await this.recordFileSystemActivity(enrichedEvent, senderRole);
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_FILE_SYSTEM_EVENT',
        role: senderRole,
        payload: enrichedEvent,
      }));
      return;
    }

    if (message.type === 'ROOM_CURSOR') {
      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'ROOM_CURSOR_REJECTED',
          reason: 'ROOM_ENDED',
        }));
        return;
      }
      const cursor = this.parseCursorPresence(message.payload, senderRole);
      if (!cursor || cursor.role !== senderRole) {
        ws.send(JSON.stringify({
          type: 'ROOM_CURSOR_REJECTED',
          reason: 'INVALID_CURSOR',
        }));
        return;
      }
      if (!this.hasSourceBackedCursorEvidence(cursor, senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_CURSOR_REJECTED',
          reason: 'MISSING_SOURCE_EVIDENCE',
        }));
        return;
      }
      await this.recordCursorActivity(cursor, senderRole);
      const payloadHadRole = this.isRecord(message.payload) && this.isVideoRole(message.payload.role);
      const cursorPayload = payloadHadRole
        ? cursor
        : {
            clientId: cursor.clientId,
            x: cursor.x,
            y: cursor.y,
            updatedAt: cursor.updatedAt,
            ...(cursor.evidence ? { evidence: cursor.evidence } : {}),
          };
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_CURSOR',
        role: senderRole,
        payload: cursorPayload,
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
