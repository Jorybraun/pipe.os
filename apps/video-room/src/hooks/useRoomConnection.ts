import { useCallback, useEffect, useRef, useState } from 'react';
import { getIceServerConfig, roomWebSocketUrl } from '../lib/api';
import type {
  IceServerProvider,
  IceCandidatePayload,
  RoomPhase,
  RoomRole,
  SdpPayload,
} from '../types';
import { safeClippyEvidenceIdPart as safeEvidenceIdPart } from '../lib/clippyPromptIdentity';
import {
  browserNavigationUrlFingerprint,
  normalizeBrowserNavigationUrl,
} from '../lib/browserNavigationEvidence';
import {
  inferWindowDataAction,
  inferWindowStateAction,
  windowDataValueFingerprint,
} from '../lib/windowEvidence';
import { roomChatMessageFingerprint } from '../lib/chatEvidence';
import type { OpenWindowConfig, WindowType } from './useWindowManager';
import type { SessionEventType } from './useSessionEvents';

const WINDOW_TYPES = new Set<WindowType>([
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
]);

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

export interface RoomDesktopWindowConfig extends OpenWindowConfig {
  id: string;
  minimized?: boolean;
  maximized?: boolean;
  focused?: boolean;
}

export type RoomSurface = 'standard' | 'win95';
export type RoomClippyPromptSource = 'system' | 'agent' | 'host' | 'guest';
export type RoomClippyInteractionEventType = Extract<
  SessionEventType,
  'ai_chat_user' | 'ai_chat_agent' | 'ai_agent_status' | 'clippy_action'
>;
export type RoomCodeServerFileEventType = Extract<SessionEventType, 'code_editor_save' | 'file_change'>;
export type RoomFileKind = 'text' | 'paint' | 'json' | 'link';
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const CODE_SERVER_SAVE_ACTIONS = new Set(['created', 'modified', 'renamed']);
const CODE_SERVER_FILE_CHANGE_ID_RE = /^code-server-file:[a-zA-Z0-9:_-]+:\d+:[a-zA-Z0-9:_-]+:path_[0-9a-f]{8}:[a-f0-9]{16}$/;
const TERMINAL_FINGERPRINT_RE = /^terminal_[0-9a-f]{8}$/;
const TERMINAL_COMMAND_ID_RE = /^.+:command:(host|guest):\d+:\d+:terminal_[0-9a-f]{8}$/;
const ROOM_CHAT_MESSAGE_FINGERPRINT_RE = /^chat_[0-9a-f]{8}$/;
const CURSOR_SAMPLE_ID_RE = /^cursor:(host|guest):\d+:\d{1,4}:\d{1,4}$/;
const ROOM_FILE_PROJECTION_EVIDENCE_METADATA_KEY = 'roomFileProjectionEvidence';
const ROOM_FILE_CONTENT_HASH_RE = /^content_[a-f0-9]{32}$/;
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
  'contentExactText',
  'contentExactJson',
  'fileCreatedAt',
  'fileUpdatedAt',
] as const;
const CLIPPY_PROMPT_FINGERPRINT_RE = /^clippy_[0-9a-f]{8}$/;
const BROWSER_PROMPT_ID_RE = /^[a-zA-Z0-9:_-]+:(host|guest):prompt:\d+:clippy_[0-9a-f]{8}$/;
const AGENT_CHAT_RESPONSE_FINGERPRINT_RE = /^agent_[0-9a-f]{8}$/;
const AGENT_CHAT_RESPONSE_ID_RE = /^agent-chat:[a-zA-Z0-9:_-]+:\d+:CHAT_RESPONSE:agent_[0-9a-f]{8}$/;
const AGENT_STATUS_EVENT_ID_RE = /^agent-status:[a-zA-Z0-9:_-]+:\d+:[a-z_]+:[a-zA-Z0-9:_-]+:[a-zA-Z0-9:_-]+$/;
const CLIPPY_ACTION_EVENT_ID_RE = /^clippy-action:(host|guest|agent):\d+:[a-z_]+:[a-z_]+:[a-z_]+:[a-zA-Z0-9:_-]+$/;
const CLIPPY_PROMPT_BLOCKED_REASONS = new Set([
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
const CURSOR_PRESENCE_SAMPLE_INTERVAL_MS = 15_000;
const CURSOR_PRESENCE_MOVEMENT_THRESHOLD = 0.03;
const RECORDING_STATE_EVENT_ID_RE = /^recording:host:\d+:(start|stop):(recording|uploading|saved|failed)$/;
const RECORDING_FAILURE_STAGES = new Set(['stop_recorder', 'prepare_upload', 'upload_request']);
const RECORDING_FAILURE_SOURCES = new Set([
  'browser_media_recorder_exception',
  'browser_blob_builder_exception',
  'recording_upload_exception',
]);
const MAX_RECORDING_FAILURE_MESSAGE_LENGTH = 240;
const WINDOW_LIFECYCLE_SOURCES = new Set([
  'win95_desktop_ui',
  'win95_file_system',
  'win95_start_menu',
  'win95_window_chrome',
  'win95_taskbar',
  'standard_assessment_ui',
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

export interface RoomClippyAction {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface RoomClippyPrompt {
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
  targetRoles?: RoomRole[];
  actions?: RoomClippyAction[];
}

export interface RoomClippyPromptDraft {
  source?: RoomClippyPromptSource;
  text: string;
  promptEventSource?: 'browser_proactive_clippy_prompt' | 'clippy_agent_bridge';
  promptTrigger?: string;
  surface?: RoomSurface;
  roomPhase?: string;
  workspaceStatus?: string | null;
  workspaceSessionId?: string | null;
  agentResponseClaimed?: boolean;
  hold?: boolean;
  targetRoles?: RoomRole[];
  actions?: RoomClippyAction[];
}

export interface RoomClippyInteractionEvent {
  id: string;
  clientId: string;
  createdAt: number;
  eventType: RoomClippyInteractionEventType;
  actor: 'host' | 'guest' | 'agent' | 'system';
  text: string;
  evidence?: Record<string, unknown>;
}

export interface RoomClippyInteractionEventDraft {
  eventType: RoomClippyInteractionEventType;
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

export interface RoomCursorPresence {
  clientId: string;
  role: RoomRole;
  x: number;
  y: number;
  updatedAt: number;
  evidence?: Record<string, unknown>;
}

export interface RoomFile {
  id: string;
  name: string;
  kind: RoomFileKind;
  content: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  updatedBy?: RoomRole;
}

export interface RoomFileDraft {
  id: string;
  name: string;
  kind: RoomFileKind;
  content: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

export type RoomDesktopEvent =
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
      roomPhase?: RoomPhase;
      durableObjectReplayExpected?: boolean;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'OPEN_WINDOW';
      window: RoomDesktopWindowConfig;
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

export type RoomDesktopEventDraft =
  | {
      kind: 'SET_ROOM_SURFACE';
      surface: RoomSurface;
      previousSurface?: RoomSurface;
      action?: string;
      source?: string;
      surfaceControlEventSource?: string;
      surfaceChangeId?: string;
      capturedAtMs?: number;
      roomPhase?: RoomPhase;
      durableObjectReplayExpected?: boolean;
    }
  | {
      kind: 'OPEN_WINDOW';
      window: RoomDesktopWindowConfig;
      evidence?: Record<string, unknown>;
    }
  | {
      kind: 'START_MENU_STATE';
      open: boolean;
      evidence?: Record<string, unknown>;
    }
  | {
      kind: 'CLOSE_WINDOW';
      windowId: string;
      evidence?: Record<string, unknown>;
    }
  | {
      kind: 'UPDATE_WINDOW_DATA';
      windowId: string;
      data: Record<string, unknown>;
      evidence?: Record<string, unknown>;
    }
  | {
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

export type RoomFileSystemEvent =
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

export type RoomFileSystemEventDraft =
  | {
      kind: 'UPSERT_FILE';
      file: RoomFileDraft;
      evidence?: Record<string, unknown>;
    }
  | {
      kind: 'DELETE_FILE';
      fileId: string;
      file?: RoomFile;
      evidence?: Record<string, unknown>;
    };

interface RoomConnection {
  phase: RoomPhase;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  iceProvider: IceServerProvider;
  roomSurface: RoomSurface;
  desktopEvents: RoomDesktopEvent[];
  desktopSnapshot: RoomDesktopWindowConfig[] | null;
  desktopStartMenuOpen: boolean | null;
  clippyPrompt: RoomClippyPrompt | null;
  clippyInteractionEvents: RoomClippyInteractionEvent[];
  chatMessages: RoomChatMessage[];
  mediaControlStates: RoomMediaControlState[];
  recordingState: RoomRecordingState | null;
  codeServerFileEvents: RoomCodeServerFileEvent[];
  terminalEvents: RoomTerminalEvent[];
  peerCursors: RoomCursorPresence[];
  fileSystem: RoomFile[];
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
  publishDesktopEvent: (event: RoomDesktopEventDraft) => void;
  publishClippyPrompt: (prompt: RoomClippyPromptDraft) => void;
  publishClippyInteractionEvent: (event: RoomClippyInteractionEventDraft) => void;
  publishChatMessage: (text: string) => RoomChatMessage | null;
  publishMediaControlEvent: (event: RoomMediaControlEventDraft) => void;
  publishRecordingStateEvent: (event: RoomRecordingStateEventDraft) => void;
  publishCodeServerFileEvent: (event: RoomCodeServerFileEventDraft) => void;
  publishTerminalEvent: (event: RoomTerminalEventDraft) => void;
  publishCursorPresence: (position: { x: number; y: number }, evidence?: Record<string, unknown>) => void;
  publishFileSystemEvent: (event: RoomFileSystemEventDraft) => void;
  setRoomSurface: (surface: RoomSurface, evidence?: Record<string, unknown>) => void;
}

interface UseRoomConnectionOptions {
  onChatDeliveryEvidence?: (message: RoomChatMessage) => void;
  ignoreInitialRoomSurfaceSnapshot?: boolean;
}

const FALLBACK_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const PEER_DISCONNECT_GRACE_MS = 15000;
const PEER_FAILED_GRACE_MS = 12000;
const PEER_RENEGOTIATE_DELAY_MS = 750;
const PEER_CURSOR_TTL_MS = 4000;
export const ROOM_CURSOR_SEND_INTERVAL_MS = 160;
const SURFACE_SNAPSHOT_LOCAL_EVENT_GUARD_MS = 5000;

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

interface PendingLocalSurfaceEvent {
  surface: RoomSurface;
  createdAt: number;
}

interface SurfaceSnapshotDecision {
  applySnapshot: boolean;
  clearPendingLocalSurface: boolean;
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

function isWindowType(value: unknown): value is WindowType {
  return typeof value === 'string' && WINDOW_TYPES.has(value as WindowType);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function stringOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRoomSurface(value: unknown): value is RoomSurface {
  return value === 'standard' || value === 'win95';
}

function isRoomPhase(value: unknown): value is RoomPhase {
  return typeof value === 'string' && ROOM_PHASES.has(value as RoomPhase);
}

export function decideRoomSurfaceSnapshot(input: {
  snapshotSurface: RoomSurface;
  surfaceEventSeenOnSocket: boolean;
  pendingLocalSurfaceEvent: PendingLocalSurfaceEvent | null;
  nowMs: number;
  guardMs?: number;
  ignoreInitialSnapshot?: boolean;
}): SurfaceSnapshotDecision {
  const guardMs = input.guardMs ?? SURFACE_SNAPSHOT_LOCAL_EVENT_GUARD_MS;
  const pending = input.pendingLocalSurfaceEvent;
  if (pending) {
    const pendingAgeMs = Math.max(0, input.nowMs - pending.createdAt);
    const pendingIsFresh = pendingAgeMs <= guardMs;
    if (pendingIsFresh && pending.surface !== input.snapshotSurface) {
      return { applySnapshot: false, clearPendingLocalSurface: false };
    }
    return { applySnapshot: true, clearPendingLocalSurface: true };
  }
  if (input.surfaceEventSeenOnSocket) {
    return { applySnapshot: false, clearPendingLocalSurface: false };
  }
  if (input.ignoreInitialSnapshot) {
    return { applySnapshot: false, clearPendingLocalSurface: false };
  }
  return { applySnapshot: true, clearPendingLocalSurface: false };
}

function parseDesktopWindow(value: unknown): RoomDesktopWindowConfig | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || !isWindowType(value.windowType) || typeof value.title !== 'string') {
    return null;
  }
  return {
    id: value.id,
    windowType: value.windowType,
    title: value.title,
    icon: typeof value.icon === 'string' ? value.icon : undefined,
    x: numberOrUndefined(value.x),
    y: numberOrUndefined(value.y),
    width: numberOrUndefined(value.width),
    height: numberOrUndefined(value.height),
    minimized: typeof value.minimized === 'boolean' ? value.minimized : undefined,
    maximized: typeof value.maximized === 'boolean' ? value.maximized : undefined,
    focused: typeof value.focused === 'boolean' ? value.focused : undefined,
    data: recordOrUndefined(value.data),
  };
}

function parseDesktopEvent(value: unknown): RoomDesktopEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.createdAt !== 'number'
  ) {
    return null;
  }
  if (value.kind === 'OPEN_WINDOW') {
    const windowConfig = parseDesktopWindow(value.window);
    if (!windowConfig) return null;
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'OPEN_WINDOW',
      window: windowConfig,
      evidence: recordOrUndefined(value.evidence),
    };
  }
  if (value.kind === 'SET_ROOM_SURFACE' && isRoomSurface(value.surface)) {
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'SET_ROOM_SURFACE',
      surface: value.surface,
      previousSurface: isRoomSurface(value.previousSurface) ? value.previousSurface : undefined,
      action: typeof value.action === 'string' ? value.action : undefined,
      source: typeof value.source === 'string' ? value.source : undefined,
      surfaceControlEventSource: typeof value.surfaceControlEventSource === 'string'
        ? value.surfaceControlEventSource
        : undefined,
      surfaceChangeId: typeof value.surfaceChangeId === 'string' ? value.surfaceChangeId : undefined,
      capturedAtMs: numberOrUndefined(value.capturedAtMs),
      roomPhase: isRoomPhase(value.roomPhase) ? value.roomPhase : undefined,
      durableObjectReplayExpected: booleanOrUndefined(value.durableObjectReplayExpected),
    };
  }
  if (value.kind === 'START_MENU_STATE' && typeof value.open === 'boolean') {
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'START_MENU_STATE',
      open: value.open,
      evidence: recordOrUndefined(value.evidence),
    };
  }
  if (value.kind === 'CLOSE_WINDOW' && typeof value.windowId === 'string') {
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'CLOSE_WINDOW',
      windowId: value.windowId,
      evidence: recordOrUndefined(value.evidence),
    };
  }
  if (value.kind === 'UPDATE_WINDOW_DATA' && typeof value.windowId === 'string' && isRecord(value.data)) {
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'UPDATE_WINDOW_DATA',
      windowId: value.windowId,
      data: value.data,
      evidence: recordOrUndefined(value.evidence),
    };
  }
  if (value.kind === 'UPDATE_WINDOW_STATE' && typeof value.windowId === 'string') {
    const event: RoomDesktopEvent = {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'UPDATE_WINDOW_STATE',
      windowId: value.windowId,
      x: numberOrUndefined(value.x),
      y: numberOrUndefined(value.y),
      width: numberOrUndefined(value.width),
      height: numberOrUndefined(value.height),
      minimized: typeof value.minimized === 'boolean' ? value.minimized : undefined,
      maximized: typeof value.maximized === 'boolean' ? value.maximized : undefined,
      focused: typeof value.focused === 'boolean' ? value.focused : undefined,
      evidence: recordOrUndefined(value.evidence),
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
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'WORKSPACE_STATE_CHANGED',
      actor: value.actor === 'host' || value.actor === 'guest' ? value.actor : undefined,
      workspaceStateEventId: stringOrNull(value.workspaceStateEventId) ?? undefined,
      capturedAtMs: numberOrNull(value.capturedAtMs) ?? undefined,
      status: typeof value.status === 'string' ? value.status : null,
      workspaceSessionId: stringOrNull(value.workspaceSessionId),
      errorMessage: stringOrNull(value.errorMessage),
      repoUrl: stringOrNull(value.repoUrl),
      githubPrNumber: numberOrNull(value.githubPrNumber),
      matchedRepoId: numberOrNull(value.matchedRepoId),
      challengeStatus: stringOrNull(value.challengeStatus),
      challengeKind: stringOrNull(value.challengeKind),
      challengeSource: stringOrNull(value.challengeSource),
      challengeMessage: stringOrNull(value.challengeMessage),
      canLaunch: booleanOrUndefined(value.canLaunch),
      ttlSeconds: numberOrNull(value.ttlSeconds),
      ttlSource: stringOrNull(value.ttlSource),
      expiresAt: stringOrNull(value.expiresAt),
      expiringSoon: booleanOrUndefined(value.expiringSoon),
      source: typeof value.source === 'string' && value.source.length <= 80 ? value.source : undefined,
      workspaceEventSource: typeof value.workspaceEventSource === 'string' && value.workspaceEventSource.length <= 80
        ? value.workspaceEventSource
        : undefined,
      workspaceStateSource: typeof value.workspaceStateSource === 'string' && value.workspaceStateSource.length <= 80
        ? value.workspaceStateSource
        : undefined,
      workspaceTelemetryPersisted: booleanOrUndefined(value.workspaceTelemetryPersisted),
      proxyUrlPersisted: booleanOrUndefined(value.proxyUrlPersisted),
    };
  }
  return null;
}

function roleActor(role?: RoomRole): 'host' | 'guest' | null {
  if (role === 'HOST') return 'host';
  if (role === 'GUEST') return 'guest';
  return null;
}

function hasSourceBackedWorkspaceStateEvidence(event: RoomDesktopEvent, actor: 'host' | 'guest'): boolean {
  if (event.kind !== 'WORKSPACE_STATE_CHANGED') return false;
  const status = typeof event.status === 'string' && event.status.trim().length > 0
    ? event.status
    : null;
  const workspaceStateSource = typeof event.workspaceStateSource === 'string'
    ? event.workspaceStateSource
    : null;
  const capturedAtMs = event.capturedAtMs;
  const workspaceSessionId = typeof event.workspaceSessionId === 'string' && event.workspaceSessionId.trim().length > 0
    ? event.workspaceSessionId
    : null;
  const stateIdSession = workspaceSessionId ?? 'no-session';
  return event.actor === actor
    && status !== null
    && event.source === 'browser_workspace_state_observer'
    && event.workspaceEventSource === 'browser_workspace_state_observer'
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

function hasMatchingWindowDataEvidence(
  data: Record<string, unknown>,
  evidence: Record<string, unknown>,
): boolean {
  const dataKeys = Object.keys(data).sort();
  const evidenceKeys = Array.isArray(evidence.dataKeys)
    ? evidence.dataKeys
    : [];
  if (
    dataKeys.length === 0
    || evidenceKeys.length !== dataKeys.length
    || !evidenceKeys.every((key): key is string => typeof key === 'string')
  ) {
    return false;
  }
  const sortedEvidenceKeys = [...evidenceKeys].sort();
  if (!dataKeys.every((key, index) => key === sortedEvidenceKeys[index])) return false;

  const fingerprints = evidence.dataValueFingerprints;
  if (!isRecord(fingerprints)) return false;
  return dataKeys.every((key) => (
    fingerprints[key] === windowDataValueFingerprint(data[key])
  ));
}

function windowStatePatchFromEvent(event: Extract<RoomDesktopEvent, { kind: 'UPDATE_WINDOW_STATE' }>): Record<string, number | boolean> {
  const patch: Record<string, number | boolean> = {};
  for (const key of ['x', 'y', 'width', 'height', 'minimized', 'maximized', 'focused'] as const) {
    const value = event[key];
    if (typeof value === 'number' || typeof value === 'boolean') {
      patch[key] = value;
    }
  }
  return patch;
}

function hasMatchingWindowStateEvidence(
  event: Extract<RoomDesktopEvent, { kind: 'UPDATE_WINDOW_STATE' }>,
  evidence: Record<string, unknown>,
): { ok: boolean; action: string | null } {
  const statePatch = windowStatePatchFromEvent(event);
  const stateKeys = Object.keys(statePatch).sort();
  const evidencePatch = evidence.statePatch;
  if (stateKeys.length === 0 || !isRecord(evidencePatch)) {
    return { ok: false, action: null };
  }
  const evidenceKeys = Array.isArray(evidence.stateKeys) ? evidence.stateKeys : [];
  if (
    evidenceKeys.length !== stateKeys.length
    || !evidenceKeys.every((key): key is string => typeof key === 'string')
  ) {
    return { ok: false, action: null };
  }
  const sortedEvidenceKeys = [...evidenceKeys].sort();
  if (!stateKeys.every((key, index) => key === sortedEvidenceKeys[index])) {
    return { ok: false, action: null };
  }
  const patchMatches = stateKeys.every((key) => evidencePatch[key] === statePatch[key]);
  if (!patchMatches) return { ok: false, action: null };
  return { ok: true, action: inferWindowStateAction(statePatch) };
}

export function hasSourceBackedDesktopEventEvidence(event: RoomDesktopEvent, role?: RoomRole): boolean {
  const actor = roleActor(role);
  if (!actor) return false;
  if (event.kind === 'SET_ROOM_SURFACE') {
    const expectedAction = event.surface === 'win95' ? 'enter_desktop' : 'exit_desktop';
    const capturedAtMs = event.capturedAtMs;
    return event.source === 'room_surface_control'
      && event.surfaceControlEventSource === 'browser_room_surface_toggle'
      && event.action === expectedAction
      && event.previousSurface !== undefined
      && event.previousSurface !== event.surface
      && typeof event.surfaceChangeId === 'string'
      && typeof capturedAtMs === 'number'
      && Number.isInteger(capturedAtMs)
      && capturedAtMs >= 0
      && event.surfaceChangeId === `surface:${actor}:${capturedAtMs}:${event.previousSurface}:${event.surface}`
      && isRoomPhase(event.roomPhase)
      && event.durableObjectReplayExpected === true;
  }
  if (event.kind === 'WORKSPACE_STATE_CHANGED') {
    return hasSourceBackedWorkspaceStateEvidence(event, actor);
  }
  const evidence = event.evidence;
  if (!isRecord(evidence)) return false;
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
    const capturedAtMs = evidence.capturedAtMs;
    const openWindowMetadataMatches = event.kind === 'CLOSE_WINDOW' || (
      evidence.windowType === event.window.windowType
      && evidence.windowTitle === event.window.title
    );
    return evidence.source === 'window_lifecycle_client_submit'
      && typeof evidence.lifecycleSource === 'string'
      && WINDOW_LIFECYCLE_SOURCES.has(evidence.lifecycleSource)
      && evidence.lifecycleKind === kind
      && evidence.actor === actor
      && evidence.windowId === windowId
      && typeof evidence.windowType === 'string'
      && typeof evidence.windowTitle === 'string'
      && typeof evidence.windowLifecycleId === 'string'
      && typeof capturedAtMs === 'number'
      && Number.isFinite(capturedAtMs)
      && evidence.windowLifecycleId === [
        'window-lifecycle',
        actor,
        Math.max(0, Math.round(capturedAtMs)),
        kind,
        windowId,
      ].join(':')
      && openWindowMetadataMatches
      && evidence.surface === 'win95'
      && typeof evidence.roomPhase === 'string'
      && evidence.durableObjectReplayExpected === true;
  }
  if (event.kind === 'UPDATE_WINDOW_DATA') {
    const isBrowserNavigation = typeof event.data.currentUrl === 'string';
    if (isBrowserNavigation) {
      const normalizedUrl = normalizeBrowserNavigationUrl(event.data.currentUrl as string);
      const capturedAtMs = evidence.capturedAtMs;
      const navigationTrigger = evidence.navigationTrigger;
      const urlFingerprint = normalizedUrl ? browserNavigationUrlFingerprint(normalizedUrl) : null;
      return evidence.source === 'room_browser_window'
        && evidence.navigationSource === 'browser_window_client_submit'
        && evidence.actor === actor
        && evidence.windowId === event.windowId
        && typeof evidence.browserNavigationId === 'string'
        && typeof capturedAtMs === 'number'
        && Number.isFinite(capturedAtMs)
        && typeof navigationTrigger === 'string'
        && normalizedUrl !== null
        && evidence.url === normalizedUrl
        && evidence.urlFingerprint === urlFingerprint
        && evidence.browserNavigationId === [
          'browser-navigation',
          actor,
          Math.max(0, Math.round(capturedAtMs)),
          event.windowId,
          navigationTrigger,
          urlFingerprint,
        ].join(':')
        && evidence.surface === 'win95'
        && typeof evidence.roomPhase === 'string'
        && evidence.durableObjectReplayExpected === true;
    }
    const dataKeys = Object.keys(event.data).sort();
    const capturedAtMs = evidence.capturedAtMs;
    const expectedAction = inferWindowDataAction(event.windowId, dataKeys);
    return evidence.source === 'window_data_client_submit'
      && typeof evidence.dataSource === 'string'
      && WINDOW_DATA_SOURCES.has(evidence.dataSource)
      && evidence.actor === actor
      && evidence.windowId === event.windowId
      && typeof evidence.windowDataUpdateId === 'string'
      && typeof capturedAtMs === 'number'
      && Number.isFinite(capturedAtMs)
      && evidence.action === expectedAction
      && evidence.windowDataUpdateId === [
        'window-data',
        actor,
        Math.max(0, Math.round(capturedAtMs)),
        event.windowId,
        expectedAction,
      ].join(':')
      && hasMatchingWindowDataEvidence(event.data, evidence)
      && evidence.surface === 'win95'
      && typeof evidence.roomPhase === 'string'
      && evidence.durableObjectReplayExpected === true;
  }
  if (event.kind === 'UPDATE_WINDOW_STATE') {
    const capturedAtMs = evidence.capturedAtMs;
    const stateEvidence = hasMatchingWindowStateEvidence(event, evidence);
    const expectedAction = stateEvidence.action;
    return evidence.source === 'window_state_client_submit'
      && typeof evidence.stateSource === 'string'
      && WINDOW_STATE_SOURCES.has(evidence.stateSource)
      && evidence.actor === actor
      && evidence.windowId === event.windowId
      && typeof evidence.windowStateChangeId === 'string'
      && typeof capturedAtMs === 'number'
      && Number.isFinite(capturedAtMs)
      && stateEvidence.ok
      && evidence.action === expectedAction
      && evidence.windowStateChangeId === [
        'window-state',
        actor,
        Math.max(0, Math.round(capturedAtMs)),
        event.windowId,
        expectedAction,
      ].join(':')
      && evidence.surface === 'win95'
      && typeof evidence.roomPhase === 'string'
      && evidence.durableObjectReplayExpected === true;
  }
  return false;
}

function parseDesktopSnapshot(value: unknown): {
  windows: RoomDesktopWindowConfig[];
  surface?: RoomSurface;
  startMenuOpen?: boolean;
} | null {
  if (!isRecord(value) || !Array.isArray(value.windows)) return null;
  const windows: RoomDesktopWindowConfig[] = [];
  for (const entry of value.windows) {
    const windowConfig = parseDesktopWindow(entry);
    if (windowConfig) windows.push(windowConfig);
  }
  return {
    windows,
    surface: isRoomSurface(value.surface) ? value.surface : undefined,
    startMenuOpen: typeof value.startMenuOpen === 'boolean' ? value.startMenuOpen : undefined,
  };
}

function isRoomClippyPromptSource(value: unknown): value is RoomClippyPromptSource {
  return value === 'system' || value === 'agent' || value === 'host' || value === 'guest';
}

function isRoomRole(value: unknown): value is RoomRole {
  return value === 'HOST' || value === 'GUEST';
}

function parseClippyAction(value: unknown): RoomClippyAction | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.label !== 'string') return null;
  if (value.id.length === 0 || value.label.length === 0) return null;
  return {
    id: value.id,
    label: value.label,
    disabled: typeof value.disabled === 'boolean' ? value.disabled : undefined,
  };
}

function parseClippyPrompt(value: unknown): RoomClippyPrompt | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.createdAt !== 'number'
    || typeof value.text !== 'string'
    || value.text.trim().length === 0
  ) {
    return null;
  }
  const actions = Array.isArray(value.actions)
    ? value.actions
        .slice(0, 4)
        .map(parseClippyAction)
        .filter((entry): entry is RoomClippyAction => entry !== null)
    : undefined;
  const targetRoles = Array.isArray(value.targetRoles)
    ? Array.from(new Set(value.targetRoles.filter((entry): entry is RoomRole => isRoomRole(entry))))
    : undefined;
  return {
    id: value.id,
    clientId: value.clientId,
    createdAt: value.createdAt,
    source: isRoomClippyPromptSource(value.source) ? value.source : 'system',
    text: value.text,
    promptEventSource: value.promptEventSource === 'browser_proactive_clippy_prompt' || value.promptEventSource === 'clippy_agent_bridge'
      ? value.promptEventSource
      : undefined,
    promptTrigger: typeof value.promptTrigger === 'string' && value.promptTrigger.length <= 120
      ? value.promptTrigger
      : undefined,
    surface: isRoomSurface(value.surface) ? value.surface : undefined,
    roomPhase: typeof value.roomPhase === 'string' && value.roomPhase.length <= 80 ? value.roomPhase : undefined,
    workspaceStatus: stringOrNull(value.workspaceStatus),
    workspaceSessionId: stringOrNull(value.workspaceSessionId),
    agentResponseClaimed: booleanOrUndefined(value.agentResponseClaimed),
    hold: typeof value.hold === 'boolean' ? value.hold : undefined,
    targetRoles: targetRoles && targetRoles.length > 0 ? targetRoles : undefined,
    actions: actions && actions.length > 0 ? actions : undefined,
  };
}

function parseClippySnapshot(value: unknown): { prompt: RoomClippyPrompt | null } | null {
  if (!isRecord(value) || !('prompt' in value)) return null;
  return { prompt: value.prompt === null ? null : parseClippyPrompt(value.prompt) };
}

function isRoomClippyInteractionEventType(value: unknown): value is RoomClippyInteractionEventType {
  return value === 'ai_chat_user'
    || value === 'ai_chat_agent'
    || value === 'ai_agent_status'
    || value === 'clippy_action';
}

function parseClippyInteractionEvent(value: unknown): RoomClippyInteractionEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt)
    || !isRoomClippyInteractionEventType(value.eventType)
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

export function hasSourceBackedClippyPromptEvidence(prompt: RoomClippyPrompt, role: RoomRole): boolean {
  const actor = role === 'HOST' ? 'host' : 'guest';
  return actor === 'host'
    && prompt.promptEventSource === 'browser_proactive_clippy_prompt'
    && (prompt.source === 'system' || prompt.source === 'host')
    && Number.isInteger(prompt.createdAt)
    && prompt.createdAt >= 0
    && typeof prompt.promptTrigger === 'string'
    && prompt.promptTrigger.trim().length > 0
    && (prompt.surface === 'standard' || prompt.surface === 'win95')
    && typeof prompt.roomPhase === 'string'
    && prompt.roomPhase.trim().length > 0
    && prompt.agentResponseClaimed === false;
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
    && promptLength >= 0;
}

export function hasSourceBackedClippyInteractionEvidence(
  event: RoomClippyInteractionEvent,
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
        && CLIPPY_PROMPT_BLOCKED_REASONS.has(String(evidence.bridgeBlockedReason))
      : evidence.browserQueuedBridgeMessage === true
        && workspaceSessionId !== null
        && typeof evidence.workspaceStatus === 'string';
    const expectedPromptId = promptTimestamp !== null && promptFingerprint !== null
      ? `${safeEvidenceIdPart(workspaceSessionId)}:${event.actor}:prompt:${promptTimestamp}:${promptFingerprint}`
      : null;
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
      && evidence.promptId === expectedPromptId
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
    const roomContextOk = (evidence.surface === 'standard' || evidence.surface === 'win95')
      && typeof evidence.roomPhase === 'string';

    if (source === 'clippy_tray_ui' || source === 'clippy_prompt_ui' || source === 'clippy_chat_ui' || source === 'clippy_call_controls_ui') {
      const originOk = source === 'clippy_tray_ui'
        ? origin === 'tray' && evidence.actionSource === 'win95_taskbar_tray'
        : source === 'clippy_chat_ui'
          ? origin === 'chat' && evidence.actionSource === 'clippy_chat_window'
          : source === 'clippy_call_controls_ui'
            ? origin === 'call' && evidence.actionSource === 'video_call_controls'
            : origin === 'prompt' && evidence.actionSource === 'clippy_prompt_ui';
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
    && (evidence.surface === 'standard' || evidence.surface === 'win95')
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

function parseCursorPresence(value: unknown, role: unknown): RoomCursorPresence | null {
  if (!isRecord(value) || !isRoomRole(role)) return null;
  if (
    typeof value.clientId !== 'string'
    || typeof value.x !== 'number'
    || typeof value.y !== 'number'
    || typeof value.updatedAt !== 'number'
    || !Number.isFinite(value.x)
    || !Number.isFinite(value.y)
    || !Number.isFinite(value.updatedAt)
  ) {
    return null;
  }
  return {
    clientId: value.clientId,
    role,
    x: Math.min(1, Math.max(0, value.x)),
    y: Math.min(1, Math.max(0, value.y)),
    updatedAt: value.updatedAt,
    evidence: recordOrUndefined(value.evidence),
  };
}

export function hasSourceBackedCursorEvidence(cursor: RoomCursorPresence, role?: RoomRole): boolean {
  const evidence = cursor.evidence;
  if (!isRecord(evidence)) return false;
  const actor = role === 'HOST' ? 'host' : role === 'GUEST' ? 'guest' : cursor.role === 'HOST' ? 'host' : 'guest';
  const normalizedX = isUnitNumber(evidence.normalizedX) ? evidence.normalizedX : null;
  const normalizedY = isUnitNumber(evidence.normalizedY) ? evidence.normalizedY : null;
  const previousX = evidence.previousNormalizedX;
  const previousY = evidence.previousNormalizedY;
  const distance = evidence.distanceFromPrevious;
  const sampledAtMs = evidence.sampledAtMs;
  const cursorSampleId = evidence.cursorSampleId;
  if (normalizedX === null || normalizedY === null) return false;
  if (previousX !== null && !isUnitNumber(previousX)) return false;
  if (previousY !== null && !isUnitNumber(previousY)) return false;
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

function isRoomFileKind(value: unknown): value is RoomFileKind {
  return value === 'text' || value === 'paint' || value === 'json' || value === 'link';
}

function parseRoomFile(value: unknown): RoomFile | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || value.id.length === 0
    || typeof value.name !== 'string'
    || value.name.length === 0
    || !isRoomFileKind(value.kind)
    || typeof value.content !== 'string'
    || typeof value.createdAt !== 'number'
    || typeof value.updatedAt !== 'number'
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    kind: value.kind,
    content: value.content,
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : undefined,
    metadata: recordOrUndefined(value.metadata),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    updatedBy: isRoomRole(value.updatedBy) ? value.updatedBy : undefined,
  };
}

function parseFileSystemEvent(value: unknown): RoomFileSystemEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.clientId !== 'string'
    || typeof value.createdAt !== 'number'
  ) {
    return null;
  }
  if (value.kind === 'UPSERT_FILE') {
    const file = parseRoomFile(value.file);
    if (!file) return null;
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'UPSERT_FILE',
      file,
      evidence: recordOrUndefined(value.evidence),
    };
  }
  if (value.kind === 'DELETE_FILE' && typeof value.fileId === 'string') {
    const file = parseRoomFile(value.file);
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      kind: 'DELETE_FILE',
      fileId: value.fileId,
      file: file ?? undefined,
      evidence: recordOrUndefined(value.evidence),
    };
  }
  return null;
}

function parseFileSystemSnapshot(value: unknown): { files: RoomFile[] } | null {
  if (!isRecord(value) || !Array.isArray(value.files)) return null;
  const files: RoomFile[] = [];
  for (const entry of value.files) {
    const file = parseRoomFile(entry);
    if (file) files.push(file);
  }
  return { files };
}

function sortRoomFiles(files: RoomFile[]): RoomFile[] {
  return [...files].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

function sortChatMessages(messages: RoomChatMessage[]): RoomChatMessage[] {
  return [...messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function roomFileProjectionEvidenceFromEvent(event: RoomFileSystemEvent): Record<string, unknown> | undefined {
  const evidence = event.evidence;
  if (event.kind !== 'UPSERT_FILE' || !isRecord(evidence)) return undefined;
  const projection: Record<string, unknown> = {};
  for (const key of ROOM_FILE_PROJECTION_EVIDENCE_KEYS) {
    if (evidence[key] !== undefined) {
      projection[key] = evidence[key];
    }
  }
  return projection;
}

function roomFileWithProjectionEvidence(file: RoomFile, event: RoomFileSystemEvent): RoomFile {
  const evidence = roomFileProjectionEvidenceFromEvent(event);
  if (!evidence) return file;
  return {
    ...file,
    metadata: {
      ...(file.metadata ?? {}),
      [ROOM_FILE_PROJECTION_EVIDENCE_METADATA_KEY]: evidence,
    },
  };
}

function applyFileSystemEvent(files: RoomFile[], event: RoomFileSystemEvent): RoomFile[] {
  if (event.kind === 'DELETE_FILE') {
    return files.filter((file) => file.id !== event.fileId);
  }
  const file = roomFileWithProjectionEvidence(event.file, event);
  return sortRoomFiles([
    ...files.filter((file) => file.id !== event.file.id),
    file,
  ]);
}

function hasExactRoomFileContentEvidence(
  file: RoomFile,
  evidence: Record<string, unknown>,
  operation: 'upsert' | 'delete',
): boolean {
  const prefix = operation === 'delete' ? 'deletedContent' : 'content';
  const contentLength = evidence[`${prefix}Length`];
  const contentHash = evidence[`${prefix}Hash`];
  if (
    typeof contentLength !== 'number'
    || !Number.isFinite(contentLength)
    || contentLength !== file.content.length
    || typeof contentHash !== 'string'
    || !ROOM_FILE_CONTENT_HASH_RE.test(contentHash)
  ) {
    return false;
  }

  if (file.kind === 'text' || file.kind === 'link') {
    return evidence[`${prefix}ExactText`] === file.content;
  }
  if (file.kind === 'paint' || file.kind === 'json') {
    return evidence[`${prefix}ExactJson`] === file.content;
  }
  return false;
}

export function hasSourceBackedRoomFileSystemEvidence(
  event: RoomFileSystemEvent,
  role?: RoomRole,
): boolean {
  const evidence = event.evidence;
  if (!isRecord(evidence)) return false;
  const actor = role === 'HOST' ? 'host' : role === 'GUEST' ? 'guest' : evidence.actor;
  const operation = event.kind === 'DELETE_FILE' ? 'delete' : 'upsert';
  const fileId = event.kind === 'DELETE_FILE' ? event.fileId : event.file.id;
  if (event.kind === 'DELETE_FILE') {
    if (!event.file || !hasExactRoomFileContentEvidence(event.file, evidence, 'delete')) return false;
  } else if (!hasExactRoomFileContentEvidence(event.file, evidence, 'upsert')) {
    return false;
  }
  return evidence.source === 'win95_shared_file_system'
    && evidence.fileEventSource === 'browser_client_submit'
    && evidence.actor === actor
    && evidence.operation === operation
    && evidence.fileId === fileId
    && typeof evidence.fileChangeId === 'string'
    && evidence.fileChangeId.trim().length > 0
    && typeof evidence.capturedAtMs === 'number'
    && Number.isFinite(evidence.capturedAtMs)
    && evidence.surface === 'win95'
    && typeof evidence.roomPhase === 'string'
    && evidence.roomPhase.trim().length > 0
    && evidence.durableObjectReplayExpected === true;
}

export function hasSourceBackedRoomFileSnapshotEvidence(file: RoomFile): boolean {
  const projection = file.metadata?.[ROOM_FILE_PROJECTION_EVIDENCE_METADATA_KEY];
  if (!isRecord(projection)) return false;
  const actor = projection.actor === 'host' || projection.actor === 'guest' ? projection.actor : null;
  if (actor === null) return false;
  const expectedRole: RoomRole = actor === 'host' ? 'HOST' : 'GUEST';
  const capturedAtMs = projection.capturedAtMs;
  const contentLength = projection.contentLength;
  const contentHash = projection.contentHash;
  return (file.updatedBy === undefined || file.updatedBy === expectedRole)
    && projection.source === 'win95_shared_file_system'
    && projection.fileEventSource === 'browser_client_submit'
    && projection.operation === 'upsert'
    && projection.action === 'upsert'
    && projection.fileId === file.id
    && projection.fileName === file.name
    && projection.fileKind === file.kind
    && (projection.mimeType === undefined || projection.mimeType === file.mimeType)
    && (projection.path === undefined || typeof projection.path === 'string')
    && typeof capturedAtMs === 'number'
    && Number.isFinite(capturedAtMs)
    && projection.fileChangeId === `file:${actor}:${capturedAtMs}:upsert:${file.id}`
    && projection.surface === 'win95'
    && typeof projection.roomPhase === 'string'
    && projection.roomPhase.trim().length > 0
    && projection.durableObjectReplayExpected === true
    && typeof contentLength === 'number'
    && Number.isFinite(contentLength)
    && contentLength === file.content.length
    && typeof contentHash === 'string'
    && ROOM_FILE_CONTENT_HASH_RE.test(contentHash)
    && hasExactRoomFileContentEvidence(file, projection, 'upsert')
    && projection.fileCreatedAt === file.createdAt
    && projection.fileUpdatedAt === file.updatedAt;
}

export function mergePeerCursorPresence(
  previous: RoomCursorPresence[],
  cursor: RoomCursorPresence,
  now = Date.now(),
  ttlMs = PEER_CURSOR_TTL_MS,
): RoomCursorPresence[] {
  const cutoff = now - ttlMs;
  const receivedCursor: RoomCursorPresence = {
    ...cursor,
    updatedAt: now,
  };
  return [
    ...previous.filter((entry) => (
      entry.role !== cursor.role
      && entry.updatedAt >= cutoff
    )),
    receivedCursor,
  ];
}

export function shouldSendCursorPresence(input: {
  hasEvidence: boolean;
  nowMs: number;
  lastSentAtMs: number;
  intervalMs?: number;
}): boolean {
  if (!input.hasEvidence) return false;
  if (input.hasEvidence) return true;
  if (input.lastSentAtMs <= 0) return true;
  if (input.nowMs < input.lastSentAtMs) return true;
  return input.nowMs - input.lastSentAtMs >= (input.intervalMs ?? ROOM_CURSOR_SEND_INTERVAL_MS);
}

export function useRoomConnection(
  token: string,
  role: RoomRole,
  active: boolean,
  initialSurface: RoomSurface = 'standard',
  options: UseRoomConnectionOptions = {},
): RoomConnection {
  const [phase, setPhase] = useState<RoomPhase>('disconnected');
  const [localStream, setLocalStreamState] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [iceProvider, setIceProvider] = useState<IceServerProvider>('unknown');
  const [roomSurface, setRoomSurfaceState] = useState<RoomSurface>(initialSurface);
  const [desktopEvents, setDesktopEvents] = useState<RoomDesktopEvent[]>([]);
  const [desktopSnapshot, setDesktopSnapshot] = useState<RoomDesktopWindowConfig[] | null>(null);
  const [desktopStartMenuOpen, setDesktopStartMenuOpen] = useState<boolean | null>(null);
  const [clippyPrompt, setClippyPrompt] = useState<RoomClippyPrompt | null>(null);
  const [clippyInteractionEvents, setClippyInteractionEvents] = useState<RoomClippyInteractionEvent[]>([]);
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
  const chatMessagesRef = useRef<RoomChatMessage[]>([]);
  const [mediaControlStates, setMediaControlStates] = useState<RoomMediaControlState[]>([]);
  const [recordingState, setRecordingState] = useState<RoomRecordingState | null>(null);
  const [codeServerFileEvents, setCodeServerFileEvents] = useState<RoomCodeServerFileEvent[]>([]);
  const [terminalEvents, setTerminalEvents] = useState<RoomTerminalEvent[]>([]);
  const [peerCursors, setPeerCursors] = useState<RoomCursorPresence[]>([]);
  const [fileSystem, setFileSystem] = useState<RoomFile[]>([]);
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
  const desktopOutboxRef = useRef<RoomDesktopEvent[]>([]);
  const clippyOutboxRef = useRef<RoomClippyPrompt[]>([]);
  const clippyInteractionOutboxRef = useRef<RoomClippyInteractionEvent[]>([]);
  const chatOutboxRef = useRef<RoomChatMessage[]>([]);
  const mediaControlOutboxRef = useRef<RoomMediaControlEvent[]>([]);
  const recordingStateOutboxRef = useRef<RoomRecordingStateEvent[]>([]);
  const codeServerFileOutboxRef = useRef<RoomCodeServerFileEvent[]>([]);
  const terminalOutboxRef = useRef<RoomTerminalEvent[]>([]);
  const fileSystemOutboxRef = useRef<RoomFileSystemEvent[]>([]);
  const surfaceEventSeenRef = useRef(false);
  const pendingLocalSurfaceEventRef = useRef<PendingLocalSurfaceEvent | null>(null);
  const lastCursorSentAtRef = useRef(0);
  const chatDeliveryEvidenceRef = useRef(options.onChatDeliveryEvidence);
  const desktopClientIdRef = useRef(
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  chatDeliveryEvidenceRef.current = options.onChatDeliveryEvidence;
  chatMessagesRef.current = chatMessages;
  phaseRef.current = phase;

  useEffect(() => {
    if (!active) {
      surfaceEventSeenRef.current = false;
      pendingLocalSurfaceEventRef.current = null;
      setRoomSurfaceState(initialSurface);
      setDesktopStartMenuOpen(null);
    }
  }, [active, initialSurface]);

  const setConnectionPhase = useCallback((nextPhase: RoomPhase): void => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  useEffect(() => {
    remoteRef.current = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (peerCursors.length === 0) return undefined;
    const intervalId = window.setInterval(() => {
      const cutoff = Date.now() - PEER_CURSOR_TTL_MS;
      setPeerCursors((prev) => prev.filter((cursor) => cursor.updatedAt >= cutoff));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [peerCursors.length]);

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

  const sendDesktopEvent = useCallback((event: RoomDesktopEvent): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_DESKTOP_EVENT', payload: event }));
    return true;
  }, []);

  const sendClippyPrompt = useCallback((prompt: RoomClippyPrompt): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_CLIPPY_PROMPT', payload: prompt }));
    return true;
  }, []);

  const sendClippyInteractionEvent = useCallback((event: RoomClippyInteractionEvent): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_CLIPPY_INTERACTION', payload: event }));
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

  const sendCursorPresence = useCallback((cursor: RoomCursorPresence): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_CURSOR', payload: cursor }));
    return true;
  }, []);

  const sendFileSystemEvent = useCallback((event: RoomFileSystemEvent): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'ROOM_FILE_SYSTEM_EVENT', payload: event }));
    return true;
  }, []);

  const flushDesktopOutbox = useCallback((): void => {
    if (desktopOutboxRef.current.length === 0) return;
    const pending = desktopOutboxRef.current.splice(0);
    for (const event of pending) {
      if (!sendDesktopEvent(event)) {
        desktopOutboxRef.current.unshift(event, ...pending.slice(pending.indexOf(event) + 1));
        return;
      }
    }
  }, [sendDesktopEvent]);

  const flushClippyOutbox = useCallback((): void => {
    if (clippyOutboxRef.current.length === 0) return;
    const pending = clippyOutboxRef.current.splice(0);
    for (const prompt of pending) {
      if (!sendClippyPrompt(prompt)) {
        clippyOutboxRef.current.unshift(prompt, ...pending.slice(pending.indexOf(prompt) + 1));
        return;
      }
    }
  }, [sendClippyPrompt]);

  const flushClippyInteractionOutbox = useCallback((): void => {
    if (clippyInteractionOutboxRef.current.length === 0) return;
    const pending = clippyInteractionOutboxRef.current.splice(0);
    for (const event of pending) {
      if (!sendClippyInteractionEvent(event)) {
        clippyInteractionOutboxRef.current.unshift(event, ...pending.slice(pending.indexOf(event) + 1));
        return;
      }
    }
  }, [sendClippyInteractionEvent]);

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

  const flushFileSystemOutbox = useCallback((): void => {
    if (fileSystemOutboxRef.current.length === 0) return;
    const pending = fileSystemOutboxRef.current.splice(0);
    for (const event of pending) {
      if (!sendFileSystemEvent(event)) {
        fileSystemOutboxRef.current.unshift(event, ...pending.slice(pending.indexOf(event) + 1));
        return;
      }
    }
  }, [sendFileSystemEvent]);

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
      surfaceEventSeenRef.current = false;
      const ws = new WebSocket(roomWebSocketUrl(token));
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        flushDesktopOutbox();
        flushClippyOutbox();
        flushClippyInteractionOutbox();
        flushChatOutbox();
        flushMediaControlOutbox();
        flushRecordingStateOutbox();
        flushCodeServerFileOutbox();
        flushTerminalOutbox();
        flushFileSystemOutbox();
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
        } else if (message.type === 'ROOM_DESKTOP_EVENT') {
          const event = parseDesktopEvent(message.payload);
          if (
            !event
            || event.clientId === desktopClientIdRef.current
            || !hasSourceBackedDesktopEventEvidence(event, isRoomRole(message.role) ? message.role : undefined)
          ) return;
          if (event.kind === 'SET_ROOM_SURFACE') {
            surfaceEventSeenRef.current = true;
            pendingLocalSurfaceEventRef.current = null;
            setRoomSurfaceState(event.surface);
          } else if (event.kind === 'START_MENU_STATE') {
            setDesktopStartMenuOpen(event.open);
          }
          setDesktopEvents((prev) => [...prev.slice(-99), event]);
        } else if (message.type === 'ROOM_DESKTOP_STATE') {
          const snapshot = parseDesktopSnapshot(message.payload);
          if (!snapshot) return;
          if (snapshot.surface) {
            const decision = decideRoomSurfaceSnapshot({
              snapshotSurface: snapshot.surface,
              surfaceEventSeenOnSocket: surfaceEventSeenRef.current,
              pendingLocalSurfaceEvent: pendingLocalSurfaceEventRef.current,
              nowMs: Date.now(),
              ignoreInitialSnapshot: options.ignoreInitialRoomSurfaceSnapshot,
            });
            if (decision.clearPendingLocalSurface) {
              pendingLocalSurfaceEventRef.current = null;
            }
            if (decision.applySnapshot) {
              setRoomSurfaceState(snapshot.surface);
            }
          }
          if (snapshot.startMenuOpen !== undefined) {
            setDesktopStartMenuOpen(snapshot.startMenuOpen);
          }
          setDesktopSnapshot(snapshot.windows);
        } else if (message.type === 'ROOM_DESKTOP_EVENT_REJECTED') {
          const snapshot = parseDesktopSnapshot(message.payload);
          pendingLocalSurfaceEventRef.current = null;
          surfaceEventSeenRef.current = false;
          if (!snapshot) return;
          if (snapshot.surface) {
            setRoomSurfaceState(snapshot.surface);
          }
          if (snapshot.startMenuOpen !== undefined) {
            setDesktopStartMenuOpen(snapshot.startMenuOpen);
          }
          setDesktopSnapshot(snapshot.windows);
        } else if (message.type === 'ROOM_CLIPPY_PROMPT') {
          const prompt = parseClippyPrompt(message.payload);
          if (
            !prompt
            || !hasSourceBackedClippyPromptEvidence(prompt, isRoomRole(message.role) ? message.role : 'HOST')
          ) return;
          setClippyPrompt(prompt);
        } else if (message.type === 'ROOM_CLIPPY_STATE') {
          const snapshot = parseClippySnapshot(message.payload);
          if (!snapshot) return;
          if (snapshot.prompt === null) {
            setClippyPrompt(null);
            return;
          }
          if (!hasSourceBackedClippyPromptEvidence(snapshot.prompt, 'HOST')) return;
          setClippyPrompt(snapshot.prompt);
        } else if (message.type === 'ROOM_CLIPPY_INTERACTION') {
          const event = parseClippyInteractionEvent(message.payload);
          const eventRole = isRoomRole(message.role)
            ? message.role
            : event?.actor === 'guest'
              ? 'GUEST'
              : 'HOST';
          if (
            !event
            || event.clientId === desktopClientIdRef.current
            || !hasSourceBackedClippyInteractionEvidence(event, eventRole)
          ) return;
          setClippyInteractionEvents((prev) => [...prev.slice(-199), event]);
        } else if (message.type === 'ROOM_CHAT_MESSAGE') {
          const chatMessage = parseChatMessage(message.payload);
          if (
            !chatMessage
            || chatMessage.clientId === desktopClientIdRef.current
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
            || event.clientId === desktopClientIdRef.current
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
            || event.clientId === desktopClientIdRef.current
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
            || event.clientId === desktopClientIdRef.current
            || !hasSourceBackedCodeServerFileEvidence(event)
          ) return;
          setCodeServerFileEvents((prev) => [...prev.slice(-199), event]);
        } else if (message.type === 'ROOM_TERMINAL_EVENT') {
          const terminalEvent = parseTerminalEvent(message.payload);
          if (
            !terminalEvent
            || terminalEvent.clientId === desktopClientIdRef.current
            || !hasSourceBackedTerminalEvidence(
              terminalEvent,
              isRoomRole(message.role) ? message.role : undefined,
            )
          ) return;
          setTerminalEvents((prev) => [...prev.slice(-199), terminalEvent]);
        } else if (message.type === 'ROOM_CURSOR') {
          const cursor = parseCursorPresence(message.payload, message.role);
          if (
            !cursor
            || cursor.clientId === desktopClientIdRef.current
            || !hasSourceBackedCursorEvidence(cursor, isRoomRole(message.role) ? message.role : undefined)
          ) return;
          setPeerCursors((prev) => mergePeerCursorPresence(prev, cursor));
        } else if (message.type === 'ROOM_FILE_SYSTEM_EVENT') {
          const event = parseFileSystemEvent(message.payload);
          if (
            !event
            || event.clientId === desktopClientIdRef.current
            || !hasSourceBackedRoomFileSystemEvidence(
              event,
              isRoomRole(message.role) ? message.role : undefined,
            )
          ) return;
          setFileSystem((prev) => applyFileSystemEvent(prev, event));
        } else if (message.type === 'ROOM_FILE_SYSTEM_EVENT_REJECTED') {
          const snapshot = parseFileSystemSnapshot(message.payload);
          if (!snapshot) return;
          setFileSystem(sortRoomFiles(snapshot.files.filter(hasSourceBackedRoomFileSnapshotEvidence)));
        } else if (message.type === 'ROOM_FILE_SYSTEM_STATE') {
          const snapshot = parseFileSystemSnapshot(message.payload);
          if (!snapshot) return;
          setFileSystem(sortRoomFiles(snapshot.files.filter(hasSourceBackedRoomFileSnapshotEvidence)));
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
    flushClippyInteractionOutbox,
    flushChatOutbox,
    flushClippyOutbox,
    flushCodeServerFileOutbox,
    flushDesktopOutbox,
    flushFileSystemOutbox,
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

  const publishDesktopEvent = useCallback((draft: RoomDesktopEventDraft): void => {
    const event: RoomDesktopEvent = {
      ...draft,
      id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientId: desktopClientIdRef.current,
      createdAt: Date.now(),
    };
    if (!hasSourceBackedDesktopEventEvidence(event, role)) {
      console.error('[publishDesktopEvent] rejected desktop event without source-backed evidence:', {
        kind: event.kind,
        role,
        source: event.kind === 'SET_ROOM_SURFACE' || event.kind === 'WORKSPACE_STATE_CHANGED'
          ? event.source
          : event.evidence?.source,
      });
      return;
    }
    if (event.kind === 'SET_ROOM_SURFACE') {
      surfaceEventSeenRef.current = true;
      pendingLocalSurfaceEventRef.current = {
        surface: event.surface,
        createdAt: event.createdAt,
      };
      setRoomSurfaceState(event.surface);
    } else if (event.kind === 'START_MENU_STATE') {
      setDesktopStartMenuOpen(event.open);
    }
    if (!sendDesktopEvent(event)) {
      desktopOutboxRef.current.push(event);
    }
  }, [sendDesktopEvent]);

  const publishClippyPrompt = useCallback((draft: RoomClippyPromptDraft): void => {
    const prompt: RoomClippyPrompt = {
      ...draft,
      id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `clippy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientId: desktopClientIdRef.current,
      createdAt: Date.now(),
      source: draft.source ?? 'system',
    };
    if (!hasSourceBackedClippyPromptEvidence(prompt, role)) {
      console.error('[publishClippyPrompt] rejected prompt without source-backed evidence:', {
        role,
        promptEventSource: prompt.promptEventSource,
        promptTrigger: prompt.promptTrigger,
      });
      return;
    }
    setClippyPrompt(prompt);
    if (!sendClippyPrompt(prompt)) {
      clippyOutboxRef.current.push(prompt);
    }
  }, [role, sendClippyPrompt]);

  const publishClippyInteractionEvent = useCallback((draft: RoomClippyInteractionEventDraft): void => {
    if (!draft.text.trim()) return;
    const createdAt = Date.now();
    const event: RoomClippyInteractionEvent = {
      ...draft,
      id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `clippy-interaction-${createdAt}-${Math.random().toString(36).slice(2)}`,
      clientId: desktopClientIdRef.current,
      createdAt,
    };
    if (!hasSourceBackedClippyInteractionEvidence(event, role)) {
      console.error('[publishClippyInteractionEvent] rejected interaction without source-backed evidence:', {
        role,
        eventType: event.eventType,
        actor: event.actor,
        source: event.evidence?.source,
      });
      return;
    }
    setClippyInteractionEvents((prev) => [...prev.slice(-199), event]);
    if (!sendClippyInteractionEvent(event)) {
      clippyInteractionOutboxRef.current.push(event);
    }
  }, [role, sendClippyInteractionEvent]);

  const publishChatMessage = useCallback((text: string): RoomChatMessage | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const id = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = Date.now();
    const message: RoomChatMessage = {
      id,
      clientId: desktopClientIdRef.current,
      createdAt,
      role,
      text: trimmed,
      deliveryStatus: 'pending',
      evidence: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_window',
        actor: role === 'HOST' ? 'host' : 'guest',
        roomMessageId: id,
        clientId: desktopClientIdRef.current,
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
      clientId: desktopClientIdRef.current,
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
      clientId: desktopClientIdRef.current,
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
      clientId: desktopClientIdRef.current,
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
      clientId: desktopClientIdRef.current,
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

  const publishCursorPresence = useCallback((position: { x: number; y: number }, evidence?: Record<string, unknown>): void => {
    const sampledAtMs = numberOrUndefined(evidence?.sampledAtMs);
    const now = sampledAtMs ?? Date.now();
    if (!shouldSendCursorPresence({
      hasEvidence: Boolean(evidence),
      nowMs: now,
      lastSentAtMs: lastCursorSentAtRef.current,
    })) return;
    lastCursorSentAtRef.current = now;
    const x = numberOrUndefined(evidence?.normalizedX) ?? position.x;
    const y = numberOrUndefined(evidence?.normalizedY) ?? position.y;
    const cursor: RoomCursorPresence = {
      clientId: desktopClientIdRef.current,
      role,
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      updatedAt: now,
      ...(evidence ? { evidence } : {}),
    };
    if (!hasSourceBackedCursorEvidence(cursor, role)) {
      console.error('[publishCursorPresence] rejected cursor presence without source-backed evidence:', {
        role,
        source: cursor.evidence?.source,
      });
      return;
    }
    sendCursorPresence(cursor);
  }, [role, sendCursorPresence]);

  const setRoomSurface = useCallback((surface: RoomSurface, evidence?: Record<string, unknown>): void => {
    publishDesktopEvent({
      kind: 'SET_ROOM_SURFACE',
      surface,
      previousSurface: isRoomSurface(evidence?.previousSurface) ? evidence.previousSurface : undefined,
      action: typeof evidence?.action === 'string' ? evidence.action : undefined,
      source: typeof evidence?.source === 'string' ? evidence.source : undefined,
      surfaceControlEventSource: typeof evidence?.surfaceControlEventSource === 'string'
        ? evidence.surfaceControlEventSource
        : undefined,
      surfaceChangeId: typeof evidence?.surfaceChangeId === 'string' ? evidence.surfaceChangeId : undefined,
      capturedAtMs: numberOrUndefined(evidence?.capturedAtMs),
      roomPhase: isRoomPhase(evidence?.roomPhase) ? evidence.roomPhase : undefined,
      durableObjectReplayExpected: booleanOrUndefined(evidence?.durableObjectReplayExpected),
    });
  }, [publishDesktopEvent]);

  const publishFileSystemEvent = useCallback((draft: RoomFileSystemEventDraft): void => {
    const createdAt = Date.now();
    const event: RoomFileSystemEvent = draft.kind === 'UPSERT_FILE'
      ? {
          id: `fs-${createdAt}-${Math.random().toString(36).slice(2)}`,
          clientId: desktopClientIdRef.current,
          createdAt,
          kind: 'UPSERT_FILE',
          file: {
            ...draft.file,
            createdAt: draft.file.createdAt ?? createdAt,
            updatedAt: draft.file.updatedAt ?? createdAt,
            updatedBy: role,
          },
          evidence: draft.evidence,
        }
      : {
          id: `fs-${createdAt}-${Math.random().toString(36).slice(2)}`,
          clientId: desktopClientIdRef.current,
          createdAt,
          kind: 'DELETE_FILE',
          fileId: draft.fileId,
          file: draft.file,
          evidence: draft.evidence,
        };
    if (!hasSourceBackedRoomFileSystemEvidence(event, role)) {
      console.error('[publishFileSystemEvent] rejected file system event without source-backed evidence:', {
        kind: event.kind,
        fileId: event.kind === 'DELETE_FILE' ? event.fileId : event.file.id,
        actor: role,
        source: event.evidence?.source,
      });
      return;
    }
    setFileSystem((prev) => applyFileSystemEvent(prev, event));
    if (!sendFileSystemEvent(event)) {
      fileSystemOutboxRef.current.push(event);
    }
  }, [role, sendFileSystemEvent]);

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
    desktopEvents,
    desktopSnapshot,
    desktopStartMenuOpen,
    clippyPrompt,
    clippyInteractionEvents,
    chatMessages,
    mediaControlStates,
    recordingState,
    codeServerFileEvents,
    terminalEvents,
    peerCursors,
    fileSystem,
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
    publishDesktopEvent,
    publishClippyPrompt,
    publishClippyInteractionEvent,
    publishChatMessage,
    publishMediaControlEvent,
    publishRecordingStateEvent,
    publishCodeServerFileEvent,
    publishTerminalEvent,
    publishCursorPresence,
    publishFileSystemEvent,
    setRoomSurface,
  };
}
