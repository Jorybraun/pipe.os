import { useCallback, useEffect, useRef, useState } from 'react';
import { getIceServerConfig, roomWebSocketUrl } from '../lib/api';
import type {
  IceServerProvider,
  IceCandidatePayload,
  RoomPhase,
  RoomRole,
  SdpPayload,
} from '../types';
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
  clippyPrompt: RoomClippyPrompt | null;
  clippyInteractionEvents: RoomClippyInteractionEvent[];
  chatMessages: RoomChatMessage[];
  codeServerFileEvents: RoomCodeServerFileEvent[];
  terminalEvents: RoomTerminalEvent[];
  peerCursors: RoomCursorPresence[];
  fileSystem: RoomFile[];
  cameraEnabled: boolean;
  micEnabled: boolean;
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
  publishCodeServerFileEvent: (event: RoomCodeServerFileEventDraft) => void;
  publishTerminalEvent: (event: RoomTerminalEventDraft) => void;
  publishCursorPresence: (position: { x: number; y: number }) => void;
  publishFileSystemEvent: (event: RoomFileSystemEventDraft) => void;
  setRoomSurface: (surface: RoomSurface, evidence?: Record<string, unknown>) => void;
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
const PEER_CURSOR_TTL_MS = 4000;

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
      roomPhase: typeof value.roomPhase === 'string' ? value.roomPhase as RoomPhase : undefined,
      durableObjectReplayExpected: booleanOrUndefined(value.durableObjectReplayExpected),
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

function parseDesktopSnapshot(value: unknown): {
  windows: RoomDesktopWindowConfig[];
  surface?: RoomSurface;
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
  const deliveryStatus = value.deliveryStatus === 'pending'
    || value.deliveryStatus === 'accepted'
    || value.deliveryStatus === 'rejected'
    ? value.deliveryStatus
    : 'accepted';
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

function parseChatRejection(value: unknown): { clientMessageId: string | null } {
  if (!isRecord(value)) return { clientMessageId: null };
  return {
    clientMessageId: typeof value.clientMessageId === 'string' ? value.clientMessageId : null,
  };
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

export function mergeRoomChatMessage(
  previous: RoomChatMessage[],
  message: RoomChatMessage,
): RoomChatMessage[] {
  return sortChatMessages([
    ...previous.filter((entry) => entry.id !== message.id),
    message,
  ]);
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
  };
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

function applyFileSystemEvent(files: RoomFile[], event: RoomFileSystemEvent): RoomFile[] {
  if (event.kind === 'DELETE_FILE') {
    return files.filter((file) => file.id !== event.fileId);
  }
  return sortRoomFiles([
    ...files.filter((file) => file.id !== event.file.id),
    event.file,
  ]);
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
  const [clippyPrompt, setClippyPrompt] = useState<RoomClippyPrompt | null>(null);
  const [clippyInteractionEvents, setClippyInteractionEvents] = useState<RoomClippyInteractionEvent[]>([]);
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
  const chatMessagesRef = useRef<RoomChatMessage[]>([]);
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
  const codeServerFileOutboxRef = useRef<RoomCodeServerFileEvent[]>([]);
  const terminalOutboxRef = useRef<RoomTerminalEvent[]>([]);
  const fileSystemOutboxRef = useRef<RoomFileSystemEvent[]>([]);
  const surfaceEventSeenRef = useRef(false);
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
      setRoomSurfaceState(initialSurface);
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
    localRef.current?.getTracks().forEach((track) => {
      peer.addTrack(track, localRef.current!);
    });
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
        flushDesktopOutbox();
        flushClippyOutbox();
        flushClippyInteractionOutbox();
        flushChatOutbox();
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
          if (!event || event.clientId === desktopClientIdRef.current) return;
          if (event.kind === 'SET_ROOM_SURFACE') {
            surfaceEventSeenRef.current = true;
            setRoomSurfaceState(event.surface);
          }
          setDesktopEvents((prev) => [...prev.slice(-99), event]);
        } else if (message.type === 'ROOM_DESKTOP_STATE') {
          const snapshot = parseDesktopSnapshot(message.payload);
          if (!snapshot) return;
          if (snapshot.surface && !surfaceEventSeenRef.current) {
            setRoomSurfaceState(snapshot.surface);
          }
          setDesktopSnapshot(snapshot.windows);
        } else if (message.type === 'ROOM_CLIPPY_PROMPT') {
          const prompt = parseClippyPrompt(message.payload);
          if (!prompt) return;
          setClippyPrompt(prompt);
        } else if (message.type === 'ROOM_CLIPPY_STATE') {
          const snapshot = parseClippySnapshot(message.payload);
          if (!snapshot) return;
          setClippyPrompt(snapshot.prompt);
        } else if (message.type === 'ROOM_CLIPPY_INTERACTION') {
          const event = parseClippyInteractionEvent(message.payload);
          if (!event || event.clientId === desktopClientIdRef.current) return;
          setClippyInteractionEvents((prev) => [...prev.slice(-199), event]);
        } else if (message.type === 'ROOM_CHAT_MESSAGE') {
          const chatMessage = parseChatMessage(message.payload);
          if (!chatMessage || chatMessage.clientId === desktopClientIdRef.current) return;
          setChatMessages((prev) => mergeRoomChatMessage(prev, chatMessage));
        } else if (message.type === 'ROOM_CHAT_MESSAGE_ACK') {
          const chatMessage = parseChatMessage(message.payload);
          if (!chatMessage) return;
          setChatMessages((prev) => mergeRoomChatMessage(prev, chatMessage));
          chatDeliveryEvidenceRef.current?.(chatMessage);
        } else if (message.type === 'ROOM_CHAT_MESSAGE_REJECTED') {
          const rejection = parseChatRejection(message.payload);
          if (!rejection.clientMessageId) return;
          const rejectedMessage = chatMessagesRef.current.find((entry) => entry.id === rejection.clientMessageId);
          if (rejectedMessage) {
            chatDeliveryEvidenceRef.current?.({
              ...rejectedMessage,
              deliveryStatus: 'rejected',
              evidence: {
                ...(rejectedMessage.evidence ?? {}),
                deliveryStatus: 'rejected',
              },
            });
          }
          setChatMessages((prev) => prev.map((entry) => {
            if (entry.id !== rejection.clientMessageId) return entry;
            return {
              ...entry,
              deliveryStatus: 'rejected',
              evidence: {
                ...(entry.evidence ?? {}),
                deliveryStatus: 'rejected',
              },
            };
          }));
        } else if (message.type === 'ROOM_CHAT_STATE') {
          const snapshot = parseChatSnapshot(message.payload);
          if (!snapshot) return;
          setChatMessages(sortChatMessages(snapshot.messages));
        } else if (message.type === 'ROOM_CODE_SERVER_FILE_EVENT') {
          const event = parseCodeServerFileEvent(message.payload);
          if (!event || event.clientId === desktopClientIdRef.current) return;
          setCodeServerFileEvents((prev) => [...prev.slice(-199), event]);
        } else if (message.type === 'ROOM_TERMINAL_EVENT') {
          const terminalEvent = parseTerminalEvent(message.payload);
          if (!terminalEvent || terminalEvent.clientId === desktopClientIdRef.current) return;
          setTerminalEvents((prev) => [...prev.slice(-199), terminalEvent]);
        } else if (message.type === 'ROOM_CURSOR') {
          const cursor = parseCursorPresence(message.payload, message.role);
          if (!cursor || cursor.clientId === desktopClientIdRef.current) return;
          setPeerCursors((prev) => mergePeerCursorPresence(prev, cursor));
        } else if (message.type === 'ROOM_FILE_SYSTEM_EVENT') {
          const event = parseFileSystemEvent(message.payload);
          if (!event || event.clientId === desktopClientIdRef.current) return;
          setFileSystem((prev) => applyFileSystemEvent(prev, event));
        } else if (message.type === 'ROOM_FILE_SYSTEM_STATE') {
          const snapshot = parseFileSystemSnapshot(message.payload);
          if (!snapshot) return;
          setFileSystem(sortRoomFiles(snapshot.files));
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
    localRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled;
    });
    setCameraEnabled((value) => !value);
  }, []);

  const toggleMic = useCallback((): void => {
    localRef.current?.getAudioTracks().forEach((track) => {
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
    if (event.kind === 'SET_ROOM_SURFACE') {
      surfaceEventSeenRef.current = true;
      setRoomSurfaceState(event.surface);
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
    setClippyPrompt(prompt);
    if (!sendClippyPrompt(prompt)) {
      clippyOutboxRef.current.push(prompt);
    }
  }, [sendClippyPrompt]);

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
    setClippyInteractionEvents((prev) => [...prev.slice(-199), event]);
    if (!sendClippyInteractionEvent(event)) {
      clippyInteractionOutboxRef.current.push(event);
    }
  }, [sendClippyInteractionEvent]);

  const publishChatMessage = useCallback((text: string): RoomChatMessage | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const message: RoomChatMessage = {
      id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientId: desktopClientIdRef.current,
      createdAt: Date.now(),
      role,
      text: trimmed,
      deliveryStatus: 'pending',
      evidence: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_window',
        actor: role === 'HOST' ? 'host' : 'guest',
        messageLength: trimmed.length,
        deliveryStatus: 'pending',
        surface: roomSurface,
        roomPhase: phaseRef.current,
        durableObjectReplayExpected: true,
      },
    };
    setChatMessages((prev) => mergeRoomChatMessage(prev, message));
    if (!sendChatMessage(message)) {
      chatOutboxRef.current.push(message);
    }
    return message;
  }, [role, roomSurface, sendChatMessage]);

  const publishCodeServerFileEvent = useCallback((draft: RoomCodeServerFileEventDraft): void => {
    if (!draft.text.trim()) return;
    const createdAt = Date.now();
    const event: RoomCodeServerFileEvent = {
      ...draft,
      id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `code-file-${createdAt}-${Math.random().toString(36).slice(2)}`,
      clientId: desktopClientIdRef.current,
      createdAt,
    };
    setCodeServerFileEvents((prev) => [...prev.slice(-199), event]);
    if (!sendCodeServerFileEvent(event)) {
      codeServerFileOutboxRef.current.push(event);
    }
  }, [sendCodeServerFileEvent]);

  const publishTerminalEvent = useCallback((draft: RoomTerminalEventDraft): void => {
    if (draft.text.length === 0) return;
    const createdAt = Date.now();
    const event: RoomTerminalEvent = {
      ...draft,
      id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `terminal-${createdAt}-${Math.random().toString(36).slice(2)}`,
      clientId: desktopClientIdRef.current,
      createdAt,
    };
    setTerminalEvents((prev) => [...prev.slice(-199), event]);
    if (!sendTerminalEvent(event)) {
      terminalOutboxRef.current.push(event);
    }
  }, [sendTerminalEvent]);

  const publishCursorPresence = useCallback((position: { x: number; y: number }): void => {
    const now = Date.now();
    if (now - lastCursorSentAtRef.current < 90) return;
    lastCursorSentAtRef.current = now;
    const cursor: RoomCursorPresence = {
      clientId: desktopClientIdRef.current,
      role,
      x: Math.min(1, Math.max(0, position.x)),
      y: Math.min(1, Math.max(0, position.y)),
      updatedAt: now,
    };
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
      roomPhase: typeof evidence?.roomPhase === 'string' ? evidence.roomPhase as RoomPhase : undefined,
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
    clippyPrompt,
    clippyInteractionEvents,
    chatMessages,
    codeServerFileEvents,
    terminalEvents,
    peerCursors,
    fileSystem,
    cameraEnabled,
    micEnabled,
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
    publishCodeServerFileEvent,
    publishTerminalEvent,
    publishCursorPresence,
    publishFileSystemEvent,
    setRoomSurface,
  };
}
