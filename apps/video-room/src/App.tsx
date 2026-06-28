import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Camera,
  CameraOff,
  Circle,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCcw,
  ShieldCheck,
  Square,
  SquareTerminal,
  Video,
} from 'lucide-react';
import {
  getRoomWorkspace,
  launchRoomWorkspace,
  loadRoom,
  postRoomEvent,
  roomWorkspaceProxyUrl,
  roomAgentWsUrl,
  roomTerminalWsUrl,
  uploadRecording,
} from './lib/api';
import {
  createCompositeRecording,
  preferredAudioRecordingOptions,
  preferredRecordingOptions,
} from './lib/recording';
import { buildRecordingLifecycleEvidence } from './lib/recordingEvidence';
import {
  buildRoomSurfaceChangeEvidence,
  canControlSharedRoomSurface,
} from './lib/roomSurfaceEvidence';
import {
  buildClippyAgentChatFallbackEvidence,
  buildClippyRoomActionExecutionEvidence,
  buildClippyUiActionEvidence,
  buildClippyUserChatEvidence,
} from './lib/clippyEvidence';
import {
  buildCodeEditorOpenEvidence,
  buildWorkspaceStateDesktopEvent,
} from './lib/workspaceEvidence';
import {
  buildWindowLifecycleEvidence,
  buildWindowStateUpdateEvidence,
} from './lib/windowEvidence';
import {
  buildCursorPresenceEvidence,
  type CursorPresenceEvidenceState,
} from './lib/cursorEvidence';
import {
  buildMediaControlEvidence,
  type MediaControlKind,
} from './lib/mediaControlEvidence';
import {
  buildRoomFileEvidence,
  roomFileEvidenceText,
  type RoomFileEvidenceOperation,
} from './lib/roomFileEvidence';
import { buildRoomChatEvidence } from './lib/chatEvidence';
import {
  buildBrowserNavigationEvidence,
  normalizeBrowserNavigationUrl,
  type BrowserNavigationTrigger,
} from './lib/browserNavigationEvidence';
import {
  useRoomConnection,
  type RoomClippyPromptDraft,
  type RoomFile,
  type RoomSurface,
} from './hooks/useRoomConnection';
import { useWindowManager } from './hooks/useWindowManager';
import { StandardLayout } from './components/StandardLayout';
import { Win95Desktop } from './components/Win95Desktop';
import { ChatWindow, type ChatMessage } from './components/ChatWindow';
import { ClippyAssistant, type ClippyAction, type ClippyMessage } from './components/ClippyAssistant';
import {
  agentStatusEvidenceText,
  type AgentChatMessage,
  type AgentFileChangeEvent,
  type AgentRoomAction,
  type AgentStatus,
} from './hooks/useAgentConnection';
import { BrowserWindow } from './components/BrowserWindow';
import { TerminalWindow } from './components/TerminalWindow';
import {
  buildTerminalCommandEvidence,
  buildTerminalOutputEvidence,
  type TerminalEvidenceContext,
} from './lib/terminalProtocol';
import { NotepadWindow } from './components/NotepadWindow';
import { PaintWindow, type PaintCanvasItem, type PaintShape, type PaintStroke } from './components/PaintWindow';
import { RoomFileSystemWindow } from './components/RoomFileSystemWindow';
import { useSessionEvents } from './hooks/useSessionEvents';
import { API_BASE } from './lib/api';
import type { OpenWindowConfig, WindowState, WindowStatePatch, WindowType } from './hooks/useWindowManager';
import type {
  IceServerProvider,
  RecordingSpeakerMetadata,
  RoomMetadata,
  RoomWorkspace,
} from './types';

type RecordingState = 'idle' | 'starting' | 'recording' | 'uploading' | 'saved' | 'failed';
const NOTEPAD_FILE_ID = 'desktop-notes';
const PAINT_FILE_ID = 'desktop-paint';
const NOTEPAD_FILE_NAME = 'notes.txt';
const PAINT_FILE_NAME = 'drawing.pipe-paint';

function PipeMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 1000 1000"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M 740 500 L 740 752 A 120 120 0 0 1 500 752 L 500 248 A 120 120 0 0 0 260 248 L 260 500"
        stroke="currentColor"
        strokeWidth="192"
        strokeLinecap="butt"
        strokeLinejoin="round"
      />
      <rect x="615" y="450" width="250" height="100" fill="currentColor" />
      <rect x="135" y="450" width="250" height="100" fill="currentColor" />
    </svg>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <div className={compact ? 'brand compact' : 'brand'} aria-label="PIPE room">
      <span className="brand-logo-shell">
        <PipeMark className="brand-logo" />
      </span>
      <span className="brand-word">PIPE</span>
      <span className="brand-chip">Room</span>
    </div>
  );
}

function RoomStateMark({
  icon,
  loading = false,
  variant = 'default',
}: {
  icon?: JSX.Element;
  loading?: boolean;
  variant?: 'default' | 'error';
}): JSX.Element {
  return (
    <div
      className={`state-mark${loading ? ' is-loading' : ''}${variant === 'error' ? ' is-error' : ''}`}
      aria-hidden="true"
    >
      <span className="state-orbit" />
      <span className="state-scan" />
      <PipeMark className="state-logo" />
      {icon && <span className="state-icon">{icon}</span>}
    </div>
  );
}

function DevicePlaceholder({
  state,
}: {
  state: 'checking' | 'ready' | 'error';
}): JSX.Element {
  if (state === 'ready') {
    return (
      <div className="device-placeholder" aria-hidden="true">
        <span>Camera ready</span>
      </div>
    );
  }

  return (
    <div className="device-placeholder">
      <RoomStateMark
        loading={state === 'checking'}
        variant={state === 'error' ? 'error' : 'default'}
        icon={state === 'error' ? <CameraOff size={18} /> : undefined}
      />
      <span>{state === 'checking' ? 'Preparing camera and microphone' : 'Camera and microphone access needed'}</span>
    </div>
  );
}

function relayLabel(provider: IceServerProvider): string {
  switch (provider) {
    case 'cloudflare':
      return 'Relay Cloudflare';
    case 'metered':
      return 'Relay Metered';
    case 'fallback':
      return 'STUN fallback';
    case 'unknown':
    default:
      return 'Network pending';
  }
}

function StreamVideo({
  stream,
  muted = false,
  className,
  testId,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  className: string;
  testId?: string;
}): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} data-testid={testId} />;
}

function isSyntheticMedia(stream: MediaStream | null): boolean {
  if (!stream) return false;
  return stream.getTracks().some((track) => /fake|synthetic|virtual/i.test(track.label));
}

function stringWindowData(win: WindowState, key: string): string {
  const value = win.data?.[key];
  return typeof value === 'string' ? value : '';
}

function isPaintPoint(value: unknown): value is { x: number; y: number } {
  return (
    Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { x?: unknown }).x === 'number'
    && typeof (value as { y?: unknown }).y === 'number'
  );
}

function isPaintStroke(value: unknown): value is PaintStroke {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const stroke = value as Partial<PaintStroke>;
  return (
    (stroke.kind === undefined || stroke.kind === 'stroke')
    && typeof stroke.color === 'string'
    && typeof stroke.size === 'number'
    && Array.isArray(stroke.points)
    && stroke.points.every(isPaintPoint)
  );
}

function isPaintShape(value: unknown): value is PaintShape {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const shape = value as Partial<PaintShape>;
  return (
    (shape.kind === 'rectangle' || shape.kind === 'diamond' || shape.kind === 'arrow')
    && typeof shape.color === 'string'
    && typeof shape.size === 'number'
    && isPaintPoint(shape.start)
    && isPaintPoint(shape.end)
  );
}

function isPaintCanvasItem(value: unknown): value is PaintCanvasItem {
  return isPaintStroke(value) || isPaintShape(value);
}

function paintItemsWindowData(win: WindowState): PaintCanvasItem[] {
  const value = win.data?.strokes;
  return Array.isArray(value) ? value.filter(isPaintCanvasItem) : [];
}

function parsePaintFileContent(content: string): PaintCanvasItem[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isPaintCanvasItem) : [];
  } catch {
    return [];
  }
}

function serializePaintItems(items: PaintCanvasItem[]): string {
  return JSON.stringify(items.filter(isPaintCanvasItem));
}

function paintItemsEqual(a: PaintCanvasItem[], b: PaintCanvasItem[]): boolean {
  return serializePaintItems(a) === serializePaintItems(b);
}

function findRoomFile(files: RoomFile[], id: string): RoomFile | undefined {
  return files.find((file) => file.id === id);
}

function Room({ token, metadata }: { token: string; metadata: RoomMetadata }): JSX.Element {
  const [enteredRoom, setEnteredRoom] = useState(false);
  const initialRoomSurface = metadata.workspace?.enabled ? 'win95' : 'standard';
  const room = useRoomConnection(token, metadata.role, enteredRoom, initialRoomSurface);
  const { capture: captureSessionEvent } = useSessionEvents({ token, apiBase: API_BASE });
  const [workspace, setWorkspace] = useState<RoomWorkspace | null>(metadata.workspace ?? null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceRepoInput, setWorkspaceRepoInput] = useState('');
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const wm = useWindowManager();
  const [deviceState, setDeviceState] = useState<'checking' | 'ready' | 'error'>('checking');
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [clippyVisible, setClippyVisible] = useState(true);
  const [clippyChatRequest, setClippyChatRequest] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const transcriptionRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const transcriptionChunksRef = useRef<Blob[]>([]);
  const recordingDisposeRef = useRef<(() => Promise<void>) | null>(null);
  const recordingSpeakerMetadataRef = useRef<RecordingSpeakerMetadata | null>(null);
  const autoAcceptingRef = useRef(false);
  const processedDesktopEventsRef = useRef<Set<string>>(new Set());
  const endingRef = useRef(false);
  const deviceRequestRef = useRef(0);
  const callStartedRef = useRef(false);
  const recordingStartedRef = useRef(false);
  const publishedClippyPromptSignatureRef = useRef<string | null>(null);
  const workspaceEditorOpenEvidenceKeysRef = useRef<Set<string>>(new Set());
  const publishedWorkspaceStateSignatureRef = useRef<string | null>(null);
  const terminalCommandSequenceRef = useRef(0);
  const terminalOutputSequenceRef = useRef(0);
  const activeTerminalCommandIdRef = useRef<string | null>(null);
  const cursorPresenceEvidenceRef = useRef<CursorPresenceEvidenceState | null>(null);

  const requestDevices = useCallback(async (): Promise<void> => {
    const requestId = deviceRequestRef.current + 1;
    deviceRequestRef.current = requestId;
    setDeviceState('checking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (deviceRequestRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setPreview(stream);
      setDeviceState('ready');
    } catch {
      if (deviceRequestRef.current === requestId) {
        setDeviceState('error');
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestId = deviceRequestRef.current + 1;
    deviceRequestRef.current = requestId;
    setDeviceState('checking');
    void navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled || deviceRequestRef.current !== requestId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setPreview(stream);
        setDeviceState('ready');
      })
      .catch(() => {
        if (!cancelled && deviceRequestRef.current === requestId) {
          setDeviceState('error');
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (
      metadata.role !== 'HOST' ||
      callStartedRef.current ||
      room.phase !== 'connected' ||
      !room.localStream ||
      !room.remoteStream
    ) return;
    callStartedRef.current = true;
    void postRoomEvent(token, 'STARTED');
  }, [metadata.role, room.localStream, room.phase, room.remoteStream, token]);

  const publishWorkspaceStateEvent = useCallback((
    nextWorkspace: RoomWorkspace | null,
    source: 'initial_load' | 'launch' | 'refresh' | 'error',
    options: { errorMessage?: string | null; fallbackRepoUrl?: string | null } = {},
  ): void => {
    if (metadata.role !== 'HOST') return;
    if (!nextWorkspace && !options.errorMessage) return;
    const event = buildWorkspaceStateDesktopEvent({
      workspace: nextWorkspace,
      source,
      fallbackRepoUrl: options.fallbackRepoUrl,
      errorMessage: options.errorMessage,
    });
    const signature = JSON.stringify(event);
    if (publishedWorkspaceStateSignatureRef.current === signature) return;
    publishedWorkspaceStateSignatureRef.current = signature;
    room.publishDesktopEvent(event);
  }, [metadata.role, room.publishDesktopEvent]);

  useEffect(() => {
    const initialWorkspace = metadata.workspace ?? null;
    setWorkspace(initialWorkspace);
    publishWorkspaceStateEvent(initialWorkspace, 'initial_load');
    // Always fetch fresh workspace data on room entry; metadata can be stale.
    void getRoomWorkspace(token).then((freshWorkspace) => {
      setWorkspace(freshWorkspace);
      publishWorkspaceStateEvent(freshWorkspace, 'refresh');
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Workspace status failed.';
      setWorkspaceError(message);
      publishWorkspaceStateEvent(initialWorkspace, 'error', { errorMessage: message });
    });
  }, [metadata.workspace, publishWorkspaceStateEvent, token]);

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    try {
      const nextWorkspace = await getRoomWorkspace(token);
      setWorkspace(nextWorkspace);
      publishWorkspaceStateEvent(nextWorkspace, 'refresh');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace status failed.';
      setWorkspaceError(message);
      publishWorkspaceStateEvent(workspace, 'error', { errorMessage: message });
    }
  }, [publishWorkspaceStateEvent, token, workspace]);

  const launchWorkspace = useCallback(async (): Promise<void> => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const repoUrl = workspace?.repoUrl ?? (workspaceRepoInput.trim() || undefined);
      const nextWorkspace = await launchRoomWorkspace(token, repoUrl);
      setWorkspace(nextWorkspace);
      publishWorkspaceStateEvent(nextWorkspace, 'launch', { fallbackRepoUrl: repoUrl ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace launch failed.';
      setWorkspaceError(message);
      publishWorkspaceStateEvent(workspace, 'error', {
        errorMessage: message,
        fallbackRepoUrl: workspace?.repoUrl ?? (workspaceRepoInput.trim() || null),
      });
    } finally {
      setWorkspaceLoading(false);
    }
  }, [publishWorkspaceStateEvent, token, workspace, workspaceRepoInput]);

  useEffect(() => {
    if (!workspace?.enabled) return undefined;
    const status = workspace.session?.status;
    if (status !== 'LAUNCHING') return undefined;
    const timer = window.setInterval(() => {
      void refreshWorkspace();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refreshWorkspace, workspace?.enabled, workspace?.session?.status]);

  const roomActor = metadata.role === 'HOST' ? 'host' : 'guest';
  const usesWin95Desktop = room.roomSurface === 'win95';
  const canControlRoomSurface = canControlSharedRoomSurface(metadata.role);
  const chatMessages: ChatMessage[] = room.chatMessages.map((message) => ({
    id: message.id,
    role: message.role === 'HOST' ? 'host' : 'candidate',
    text: message.text,
    timestamp: message.createdAt,
    deliveryStatus: message.deliveryStatus,
  }));
  const sendChatMessage = (text: string): void => {
    const message = room.publishChatMessage(text);
    if (!message) return;
    const evidence = buildRoomChatEvidence({
      message,
      actor: roomActor,
      surface: room.roomSurface,
      roomPhase: room.phase,
    });
    captureSessionEvent('chat_message', evidence.text, roomActor, evidence.properties);
  };

  useEffect(() => {
    if (metadata.role !== 'GUEST' || room.phase !== 'offer_received' || autoAcceptingRef.current) {
      return;
    }
    autoAcceptingRef.current = true;
    void room.acceptCall().finally(() => {
      autoAcceptingRef.current = false;
    });
  }, [metadata.role, room.acceptCall, room.phase]);

  const joinLobby = (): void => {
    if (!preview) return;
    room.setLocalStream(preview);
    setPreview(null);
    setEnteredRoom(true);
    void postRoomEvent(token, 'JOINED');
  };

  useEffect(() => {
    if (!enteredRoom) return;
    if (!wm.isWindowOpen('video')) {
      wm.openWindow({ id: 'video', windowType: 'video', title: 'Video Call', x: 60, y: 30, width: 480, height: 360 });
    }
    if (!wm.isWindowOpen('chat')) {
      wm.openWindow({ id: 'chat', windowType: 'chat', title: 'Room Chat', x: 560, y: 30, width: 340, height: 400 });
    }
    if (workspace?.enabled && !wm.isWindowOpen('workspace')) {
      wm.openWindow({ id: 'workspace', windowType: 'workspace', title: workspace?.repoUrl ?? 'VS Code', x: 80, y: 80, width: 800, height: 500 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enteredRoom, workspace?.enabled, workspace?.repoUrl]);

  useEffect(() => {
    if (!enteredRoom || !room.desktopSnapshot) return;
    for (const windowConfig of room.desktopSnapshot) {
      wm.openWindow(windowConfig);
      wm.applyWindowState(windowConfig.id, {
        x: windowConfig.x,
        y: windowConfig.y,
        width: windowConfig.width,
        height: windowConfig.height,
        minimized: windowConfig.minimized,
        maximized: windowConfig.maximized,
        focused: windowConfig.focused,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enteredRoom, room.desktopSnapshot]);

  useEffect(() => {
    if (!enteredRoom) return;
    for (const event of room.desktopEvents) {
      if (processedDesktopEventsRef.current.has(event.id)) continue;
      processedDesktopEventsRef.current.add(event.id);
      if (event.kind === 'SET_ROOM_SURFACE') {
        continue;
      } else if (event.kind === 'WORKSPACE_STATE_CHANGED') {
        void refreshWorkspace();
      } else if (event.kind === 'OPEN_WINDOW') {
        wm.openWindow(event.window);
      } else if (event.kind === 'CLOSE_WINDOW') {
        wm.closeWindow(event.windowId);
      } else if (event.kind === 'UPDATE_WINDOW_STATE') {
        wm.applyWindowState(event.windowId, {
          x: event.x,
          y: event.y,
          width: event.width,
          height: event.height,
          minimized: event.minimized,
          maximized: event.maximized,
          focused: event.focused,
        });
      } else {
        wm.updateWindowData(event.windowId, event.data);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enteredRoom, refreshWorkspace, room.desktopEvents]);

  useEffect(() => {
    if (!enteredRoom) return;
    const file = findRoomFile(room.fileSystem, NOTEPAD_FILE_ID);
    const win = wm.windows.find((entry) => entry.id === 'notepad');
    if (!file || !win) return;
    if (stringWindowData(win, 'text') !== file.content) {
      wm.updateWindowData('notepad', { text: file.content });
    }
  }, [enteredRoom, room.fileSystem, wm.updateWindowData, wm.windows]);

  useEffect(() => {
    if (!enteredRoom) return;
    const file = findRoomFile(room.fileSystem, PAINT_FILE_ID);
    const win = wm.windows.find((entry) => entry.id === 'paint');
    if (!file || !win) return;
    const nextStrokes = parsePaintFileContent(file.content);
    if (!paintItemsEqual(paintItemsWindowData(win), nextStrokes)) {
      wm.updateWindowData('paint', { strokes: nextStrokes });
    }
  }, [enteredRoom, room.fileSystem, wm.updateWindowData, wm.windows]);

  const openSharedWindow = useCallback((config: OpenWindowConfig & { id: string }): void => {
    wm.openWindow(config);
    if (room.roomSurface === 'win95') {
      room.publishDesktopEvent({ kind: 'OPEN_WINDOW', window: config });
    }
    const evidence = buildWindowLifecycleEvidence({
      kind: 'open',
      actor: roomActor,
      windowId: config.id,
      windowType: config.windowType,
      windowTitle: config.title,
      source: 'win95_desktop_ui',
      surface: room.roomSurface,
      roomPhase: room.phase,
    });
    captureSessionEvent('window_open', evidence.text, roomActor, evidence.properties);
  }, [captureSessionEvent, room, roomActor, wm]);

  const closeSharedWindow = useCallback((id: string): void => {
    const win = wm.windows.find((entry) => entry.id === id);
    wm.closeWindow(id);
    if (room.roomSurface === 'win95') {
      room.publishDesktopEvent({ kind: 'CLOSE_WINDOW', windowId: id });
    }
    const evidence = buildWindowLifecycleEvidence({
      kind: 'close',
      actor: roomActor,
      windowId: id,
      windowType: win?.windowType ?? 'custom',
      windowTitle: win?.title ?? id,
      source: 'win95_window_chrome',
      surface: room.roomSurface,
      roomPhase: room.phase,
    });
    captureSessionEvent('window_close', evidence.text, roomActor, evidence.properties);
  }, [captureSessionEvent, room, roomActor, wm]);

  const updateSharedWindowData = useCallback((
    id: string,
    data: Partial<Record<string, unknown>>,
    options?: { browserNavigationTrigger?: BrowserNavigationTrigger },
  ): void => {
    wm.updateWindowData(id, data);
    if (room.roomSurface === 'win95') {
      room.publishDesktopEvent({
        kind: 'UPDATE_WINDOW_DATA',
        windowId: id,
        data,
      });
    }
    const currentUrl = data.currentUrl;
    if (typeof currentUrl === 'string') {
      const evidence = buildBrowserNavigationEvidence({
        actor: roomActor,
        windowId: id,
        url: currentUrl,
        trigger: options?.browserNavigationTrigger ?? 'shared_state_sync',
        surface: room.roomSurface,
        roomPhase: room.phase,
      });
      if (evidence) {
        captureSessionEvent('browser_navigation', evidence.text, roomActor, evidence.properties);
      }
    }
  }, [captureSessionEvent, room, roomActor, wm]);

  const publishSharedWindowState = useCallback((id: string, patch: WindowStatePatch): void => {
    if (room.roomSurface !== 'win95') return;
    room.publishDesktopEvent({
      kind: 'UPDATE_WINDOW_STATE',
      windowId: id,
      ...patch,
    });
    const evidence = buildWindowStateUpdateEvidence({
      actor: roomActor,
      windowId: id,
      patch: { ...patch },
      surface: room.roomSurface,
      roomPhase: room.phase,
    });
    if (evidence) {
      captureSessionEvent('window_update', evidence.text, roomActor, evidence.properties);
    }
  }, [captureSessionEvent, room, roomActor]);

  const focusSharedWindow = useCallback((id: string): void => {
    wm.focusWindow(id);
    publishSharedWindowState(id, { focused: true, minimized: false });
  }, [publishSharedWindowState, wm]);

  const minimizeSharedWindow = useCallback((id: string): void => {
    wm.minimizeWindow(id);
    publishSharedWindowState(id, { minimized: true, focused: false });
  }, [publishSharedWindowState, wm]);

  const restoreSharedWindow = useCallback((id: string): void => {
    wm.restoreWindow(id);
    publishSharedWindowState(id, { minimized: false, focused: true });
  }, [publishSharedWindowState, wm]);

  const maximizeSharedWindow = useCallback((id: string): void => {
    const win = wm.windows.find((entry) => entry.id === id);
    if (!win) return;
    const patch: WindowStatePatch = win.maximized
      ? {
          maximized: false,
          x: win.prevX ?? win.x,
          y: win.prevY ?? win.y,
          width: win.prevWidth ?? win.width,
          height: win.prevHeight ?? win.height,
          focused: true,
          minimized: false,
        }
      : {
          maximized: true,
          focused: true,
          minimized: false,
        };
    wm.toggleMaximize(id);
    publishSharedWindowState(id, patch);
  }, [publishSharedWindowState, wm]);

  const moveSharedWindow = useCallback((id: string, x: number, y: number): void => {
    wm.moveWindow(id, x, y);
  }, [wm]);

  const publishSharedWindowMove = useCallback((id: string, x: number, y: number): void => {
    publishSharedWindowState(id, { x, y });
  }, [publishSharedWindowState]);

  const startRecording = useCallback(async (): Promise<void> => {
    if (
      metadata.role !== 'HOST' ||
      room.phase !== 'connected' ||
      !room.localStream ||
      !room.remoteStream ||
      recorderRef.current
    ) return;

    let dispose: (() => Promise<void>) | null = null;
    setRecordingError(null);
    setRecordingState('starting');
    setRecordingNotice('Starting recording...');
    try {
      const composite = await createCompositeRecording(room.localStream, room.remoteStream);
      dispose = composite.dispose;
      const recorder = new MediaRecorder(composite.stream, preferredRecordingOptions());
      recordingChunksRef.current = [];
      transcriptionChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };

      const transcriptionTracks = composite.transcriptionStream.getAudioTracks();
      let transcriptionRecorder: MediaRecorder | null = null;
      if (transcriptionTracks.length > 0) {
        transcriptionRecorder = new MediaRecorder(
          composite.transcriptionStream,
          preferredAudioRecordingOptions(),
        );
        transcriptionRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) transcriptionChunksRef.current.push(event.data);
        };
        transcriptionRecorder.start(1000);
      }

      recorder.start(1000);
      recorderRef.current = recorder;
      transcriptionRecorderRef.current = transcriptionRecorder;
      recordingDisposeRef.current = composite.dispose;
      recordingSpeakerMetadataRef.current = composite.speakerMetadata;
      recordingStartedRef.current = true;
      setRecordingNotice('Recording started. Transcript processing begins after the host ends the call.');
      setRecordingState('recording');
      void postRoomEvent(token, 'RECORDING_STARTED').catch(() => {
        setRecordingNotice('Recording started. Status will sync when the call ends.');
      });
      captureSessionEvent('recording_start', 'Recording started', 'host', buildRecordingLifecycleEvidence({
        lifecycleKind: 'start',
        speakerMetadata: composite.speakerMetadata,
        iceProvider: room.iceProvider,
        hasTranscriptionAudio: transcriptionTracks.length > 0,
      }));
    } catch (error) {
      await dispose?.().catch(() => undefined);
      const message = error instanceof Error ? error.message : 'Recording could not start.';
      setRecordingState('failed');
      setRecordingError(message);
    }
  }, [captureSessionEvent, metadata.role, room.iceProvider, room.localStream, room.phase, room.remoteStream, token]);

  const stopRecorder = async (recorder: MediaRecorder | null): Promise<void> => {
    if (!recorder || recorder.state === 'inactive') return;
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.stop();
    });
  };

  const stopAndUploadRecording = async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      await recordingDisposeRef.current?.();
      recorderRef.current = null;
      transcriptionRecorderRef.current = null;
      recordingDisposeRef.current = null;
      recordingSpeakerMetadataRef.current = null;
      recordingChunksRef.current = [];
      transcriptionChunksRef.current = [];
      if (metadata.role === 'HOST') {
        setRecordingNotice('No recording was captured because the call never reached an active recorded state.');
      }
      return;
    }
    setRecordingState('uploading');
    setRecordingError(null);
    setRecordingNotice('Saving recording and starting transcript processing...');
    try {
      await Promise.all([
        stopRecorder(recorder),
        stopRecorder(transcriptionRecorderRef.current),
      ]);
      const blob = new Blob(recordingChunksRef.current, {
        type: recorder.mimeType || 'video/webm',
      });
      const transcriptionRecorder = transcriptionRecorderRef.current;
      const transcriptionAudio = transcriptionChunksRef.current.length > 0
        ? new Blob(transcriptionChunksRef.current, {
            type: transcriptionRecorder?.mimeType || 'audio/webm',
          })
        : undefined;
      console.log('[room] Uploading recording', {
        token,
        recordingBytes: blob.size,
        recordingType: blob.type,
        hasTranscriptionAudio: Boolean(transcriptionAudio),
        transcriptionBytes: transcriptionAudio?.size ?? 0,
        iceProvider: room.iceProvider,
      });
      captureSessionEvent('recording_stop', 'Recording stopped', 'host', buildRecordingLifecycleEvidence({
        lifecycleKind: 'stop',
        speakerMetadata: recordingSpeakerMetadataRef.current,
        iceProvider: room.iceProvider,
        hasTranscriptionAudio: Boolean(transcriptionAudio),
        recordingBytes: blob.size,
        recordingMimeType: blob.type || null,
        transcriptionBytes: transcriptionAudio?.size ?? 0,
        transcriptionMimeType: transcriptionAudio?.type ?? null,
        uploadStatus: 'attempting',
      }));
      const result = await uploadRecording(
        token,
        blob,
        transcriptionAudio,
        recordingSpeakerMetadataRef.current ?? undefined,
      );
      console.log('[room] Recording upload succeeded', {
        accepted: result.accepted,
        transcriptStatus: result.transcriptStatus,
      });
      setRecordingState('saved');
      setRecordingNotice(
        result.transcriptStatus === 'PROCESSING'
          ? 'Recording saved. Transcript processing has started.'
          : 'Recording saved.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording upload failed.';
      console.error('[room] Recording upload failed', {
        token,
        message,
        stack: error instanceof Error ? error.stack : undefined,
        iceProvider: room.iceProvider,
        recordingChunks: recordingChunksRef.current.length,
        transcriptionChunks: transcriptionChunksRef.current.length,
      });
      setRecordingState('failed');
      setRecordingError(message);
      throw error;
    } finally {
      await recordingDisposeRef.current?.().catch(() => undefined);
      recorderRef.current = null;
      transcriptionRecorderRef.current = null;
      recordingDisposeRef.current = null;
      recordingSpeakerMetadataRef.current = null;
      recordingChunksRef.current = [];
      transcriptionChunksRef.current = [];
    }
  };

  const stopRecording = async (): Promise<void> => {
    if (metadata.role !== 'HOST' || recordingState !== 'recording' || !recorderRef.current) return;
    try {
      await stopAndUploadRecording();
    } catch {
      // stopAndUploadRecording already surfaced the error in state.
    }
  };

  const endCall = async (): Promise<void> => {
    if (endingRef.current) return;
    endingRef.current = true;
    if (
      metadata.role === 'HOST' &&
      !recordingStartedRef.current &&
      !window.confirm('End this call without a recording? No transcript will be generated.')
    ) {
      endingRef.current = false;
      return;
    }
    room.hangUp();
    if (metadata.role === 'HOST') {
      let failed = false;
      try {
        await postRoomEvent(token, 'ENDED');
      } catch {
        failed = true;
      }
      try {
        if (recordingStartedRef.current && recorderRef.current) {
          await stopAndUploadRecording();
        } else if (recordingStartedRef.current && recordingState === 'saved') {
          setRecordingNotice((notice) => notice ?? 'Recording saved. Transcript processing has started.');
        } else {
          setRecordingNotice('Call ended without a recording.');
        }
      } catch {
        failed = true;
      }
      if (failed) {
        setRecordingState('failed');
      }
    } else {
      await postRoomEvent(token, 'LEFT').catch(() => undefined);
    }
  };

  const workspaceSession = workspace?.session ?? null;
  const workspaceReady = workspaceSession?.status === 'READY' || workspaceSession?.status === 'SLEEPING';
  const hasWorkspaceFeature = Boolean(workspace?.enabled);
  const workspaceUrl = workspaceReady && workspaceSession
    ? roomWorkspaceProxyUrl(token, workspaceSession.sessionId)
    : null;
  useEffect(() => {
    setIframeLoaded(false);
  }, [workspaceUrl]);
  const canLaunchWorkspace = metadata.role === 'HOST'
    && hasWorkspaceFeature
    && Boolean(workspace?.canLaunch)
    && !workspaceLoading
    && (!workspaceSession || ['ERROR', 'STOPPED', 'EXPIRED'].includes(workspaceSession.status));
  const showWorkspacePanel = hasWorkspaceFeature;
  const needsRepoUrl = canLaunchWorkspace && !workspace?.repoUrl;
  const hasActiveWorkspace = workspaceSession?.status === 'READY' || workspaceSession?.status === 'SLEEPING';
  const workspaceChallengeMessage = workspace?.challenge?.status === 'missing_reviewable_task'
    ? workspace.challenge.message
    : null;
  const clippyAgentUnavailableMessage = !hasWorkspaceFeature
    ? 'This room was not configured with a dev workspace. Room chat still goes to people; Clippy/Devin chat requires a real container workspace.'
    : workspaceSession?.status === 'LAUNCHING'
      ? 'The VS Code workspace is starting. Clippy will connect to real Devin when the container bridge is ready.'
      : workspaceSession?.status === 'ERROR'
        ? `The VS Code workspace failed: ${workspaceSession.errorMessage ?? workspaceError ?? 'container startup did not complete'}. Clippy/Devin chat stays disabled until the workspace is relaunched.`
        : metadata.role === 'HOST' && canLaunchWorkspace
          ? 'Launch the VS Code workspace to connect real Devin. Clippy chat stays disabled until the container bridge is connected.'
          : 'The host needs to launch the VS Code workspace before Clippy can connect to real Devin.';
  const captureClippyUiAction = (
    actionId: 'open-clippy-chat' | 'dismiss-clippy',
    origin: 'tray' | 'prompt',
  ): void => {
    const evidence = buildClippyUiActionEvidence({
      actionId,
      origin,
      actor: roomActor,
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
      agentWorkspaceReady: hasActiveWorkspace,
    });
    captureSessionEvent('clippy_action', evidence.text, roomActor, evidence.properties);
  };
  const openClippyChat = (): void => {
    captureClippyUiAction('open-clippy-chat', 'tray');
    setClippyVisible(true);
    setClippyChatRequest((request) => request + 1);
  };
  const dismissClippy = (): void => {
    captureClippyUiAction('dismiss-clippy', 'prompt');
    setClippyVisible(false);
  };
  const terminalSessionId = `terminal-${workspaceSession?.sessionId ?? 'no-workspace'}-${metadata.role.toLowerCase()}`;
  const terminalEvidenceContext: TerminalEvidenceContext = useMemo(() => ({
    surface: room.roomSurface,
    roomPhase: room.phase,
    workspaceStatus: workspaceSession?.status ?? null,
    workspaceSessionId: workspaceSession?.sessionId ?? null,
    repoUrl: workspace?.repoUrl ?? null,
  }), [
    room.phase,
    room.roomSurface,
    workspace?.repoUrl,
    workspaceSession?.sessionId,
    workspaceSession?.status,
  ]);
  const captureTerminalCommand = useCallback((command: string): void => {
    terminalCommandSequenceRef.current += 1;
    const evidence = buildTerminalCommandEvidence({
      command,
      terminalSessionId,
      commandSequence: terminalCommandSequenceRef.current,
      context: terminalEvidenceContext,
    });
    activeTerminalCommandIdRef.current = evidence.properties.terminalCommandId;
    captureSessionEvent('terminal_command', evidence.text, roomActor, evidence.properties);
  }, [
    terminalEvidenceContext,
    terminalSessionId,
    captureSessionEvent,
    roomActor,
  ]);
  const captureTerminalOutput = useCallback((output: string): void => {
    terminalOutputSequenceRef.current += 1;
    const evidence = buildTerminalOutputEvidence({
      output,
      terminalSessionId,
      outputSequence: terminalOutputSequenceRef.current,
      activeCommandId: activeTerminalCommandIdRef.current,
      context: terminalEvidenceContext,
    });
    captureSessionEvent('terminal_output', evidence.text, 'system', evidence.properties);
  }, [
    terminalEvidenceContext,
    terminalSessionId,
    captureSessionEvent,
  ]);

  const captureWorkspaceEditorOpen = useCallback((): void => {
    setIframeLoaded(true);
    const evidence = buildCodeEditorOpenEvidence({
      workspace,
      actor: roomActor,
      surface: room.roomSurface,
      roomPhase: room.phase,
    });
    if (!evidence) return;
    const sessionId = typeof evidence.properties.workspaceSessionId === 'string'
      ? evidence.properties.workspaceSessionId
      : 'unknown-workspace-session';
    const evidenceKey = `${sessionId}:${roomActor}`;
    if (workspaceEditorOpenEvidenceKeysRef.current.has(evidenceKey)) return;
    workspaceEditorOpenEvidenceKeysRef.current.add(evidenceKey);
    captureSessionEvent('code_editor_open', evidence.text, roomActor, evidence.properties);
  }, [
    captureSessionEvent,
    room.phase,
    room.roomSurface,
    roomActor,
    workspace,
  ]);

  const canStartCall = metadata.role === 'HOST' && (
    room.phase === 'peer_connected' || room.phase === 'peer_disconnected'
  );
  const hasConnectedMedia = room.phase === 'connected' && Boolean(room.localStream && room.remoteStream);
  const canStartRecording = metadata.role === 'HOST'
    && hasConnectedMedia
    && !recorderRef.current
    && (recordingState === 'idle' || recordingState === 'failed');
  const canStopRecording = metadata.role === 'HOST'
    && recordingState === 'recording'
    && Boolean(recorderRef.current);
  const canAccept = metadata.role === 'GUEST' && room.phase === 'offer_received';
  const isConnecting = room.phase === 'connecting';
  const isOpening = room.phase === 'disconnected';
  const isRecovering = room.phase === 'peer_disconnected';
  const isRoomError = room.phase === 'error';
  const canRetry = room.phase === 'peer_disconnected' || room.phase === 'error';
  const recordingLabel = {
    idle: 'Not recording',
    starting: 'Starting',
    recording: 'Recording',
    uploading: 'Saving',
    saved: 'Saved',
    failed: 'Save failed',
  }[recordingState];
  const visibleRecordingNotice = recordingError ?? recordingNotice;
  const inlineRecordingNotice = (
    recordingState === 'uploading'
    || recordingState === 'saved'
    || recordingState === 'failed'
  )
    ? visibleRecordingNotice
    : null;
  const recordingButtonLabel = {
    idle: 'Start recording',
    starting: 'Starting',
    recording: 'Recording',
    uploading: 'Saving',
    saved: 'Saved',
    failed: 'Retry recording',
  }[recordingState];

  let proactiveClippyPrompt: RoomClippyPromptDraft | null = null;
  if (enteredRoom) {
    const workspaceActions: ClippyAction[] = [];
    if (showWorkspacePanel) {
      if (hasActiveWorkspace) {
        workspaceActions.push({ id: 'open-workspace', label: 'Open workspace' });
      } else if (canLaunchWorkspace) {
        workspaceActions.push({ id: 'launch-workspace', label: 'Launch workspace' });
      }
    }

    if (!room.remoteStream && metadata.role === 'HOST' && workspaceActions.length > 0) {
      proactiveClippyPrompt = {
        source: 'system',
        promptTrigger: 'host_waiting_prepare_workspace',
        targetRoles: ['HOST'],
        text: "It looks like you're waiting for your guest. Would you like to prepare the dev workspace while you wait?",
        hold: true,
        actions: workspaceActions,
      };
    } else if (!room.remoteStream && metadata.role === 'HOST') {
      proactiveClippyPrompt = {
        source: 'system',
        promptTrigger: 'host_waiting_guest',
        targetRoles: ['HOST'],
        text: "It looks like you're waiting for your guest. I'll keep the desktop ready while they join.",
        hold: true,
      };
    } else if (room.remoteStream && recordingState === 'idle' && metadata.role === 'HOST') {
      proactiveClippyPrompt = {
        source: 'system',
        promptTrigger: 'recording_start_suggestion',
        targetRoles: ['HOST'],
        text: "It looks like you're starting an interview. Would you like to begin recording?",
        hold: true,
        actions: [{ id: 'start-recording', label: 'Start recording', disabled: !canStartRecording }],
      };
    } else if (recordingState === 'recording') {
      const actions = hasActiveWorkspace
        ? [
            { id: 'open-workspace', label: 'Open workspace' },
            { id: 'open-terminal', label: 'Open terminal' },
          ]
        : undefined;
      proactiveClippyPrompt = {
        source: 'system',
        promptTrigger: 'recording_active_guidance',
        targetRoles: ['HOST'],
        text: "It looks like you're recording the session. You can stop recording when you're done.",
        hold: true,
        actions: [
          { id: 'stop-recording', label: 'Stop recording', disabled: !canStopRecording },
          ...(actions ?? []),
        ],
      };
    } else if (room.phase === 'ended') {
      proactiveClippyPrompt = {
        source: 'system',
        promptTrigger: 'room_ended_notice',
        targetRoles: ['HOST', 'GUEST'],
        text: "It looks like the call has ended. You can close this window now.",
        hold: true,
      };
    }
  }
  if (proactiveClippyPrompt) {
    proactiveClippyPrompt = {
      ...proactiveClippyPrompt,
      promptEventSource: 'browser_proactive_clippy_prompt',
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspace?.session?.status ?? null,
      workspaceSessionId: workspace?.session?.sessionId ?? null,
      agentResponseClaimed: false,
    };
  }

  const proactiveClippyPromptSignature = proactiveClippyPrompt
    ? JSON.stringify({
        source: proactiveClippyPrompt.source,
        promptEventSource: proactiveClippyPrompt.promptEventSource,
        promptTrigger: proactiveClippyPrompt.promptTrigger,
        surface: proactiveClippyPrompt.surface,
        roomPhase: proactiveClippyPrompt.roomPhase,
        workspaceStatus: proactiveClippyPrompt.workspaceStatus,
        workspaceSessionId: proactiveClippyPrompt.workspaceSessionId,
        agentResponseClaimed: proactiveClippyPrompt.agentResponseClaimed,
        targetRoles: proactiveClippyPrompt.targetRoles,
        text: proactiveClippyPrompt.text,
        hold: proactiveClippyPrompt.hold ?? false,
        actions: proactiveClippyPrompt.actions?.map((action) => ({
          id: action.id,
          label: action.label,
          disabled: action.disabled ?? false,
        })) ?? [],
      })
    : null;

  useEffect(() => {
    if (
      metadata.role !== 'HOST'
      || !enteredRoom
      || !proactiveClippyPrompt
      || !proactiveClippyPromptSignature
    ) {
      return;
    }
    if (publishedClippyPromptSignatureRef.current === proactiveClippyPromptSignature) return;
    publishedClippyPromptSignatureRef.current = proactiveClippyPromptSignature;
    room.publishClippyPrompt(proactiveClippyPrompt);
  }, [
    enteredRoom,
    metadata.role,
    proactiveClippyPrompt,
    proactiveClippyPromptSignature,
    room,
  ]);

  const sharedClippyPrompt = room.clippyPrompt;
  const canShowSharedClippyPrompt = Boolean(
    sharedClippyPrompt
    && (!sharedClippyPrompt.targetRoles || sharedClippyPrompt.targetRoles.includes(metadata.role)),
  );
  const clippyMessages: ClippyMessage[] = canShowSharedClippyPrompt && sharedClippyPrompt
    ? [{
        text: sharedClippyPrompt.text,
        hold: sharedClippyPrompt.hold,
        actions: sharedClippyPrompt.actions,
      }]
    : [];

  const inLobby = room.localStream === null;
  const previewIsSynthetic = isSyntheticMedia(preview);
  const localIsSynthetic = isSyntheticMedia(room.localStream);
  if (inLobby) {
    const isDeviceChecking = deviceState === 'checking';
    const hasDeviceError = deviceState === 'error';
    const joinButtonLabel = hasDeviceError
      ? 'Allow camera and microphone'
      : isDeviceChecking
        ? 'Preparing devices'
        : 'Enter room';
    const joinButtonHint = hasDeviceError
      ? 'Enable camera and microphone access in your browser, then try again.'
      : isDeviceChecking
        ? 'Preparing your camera and microphone preview.'
        : 'You will enter the private room with camera and microphone ready.';
    const joinButtonIcon = hasDeviceError
      ? <CameraOff size={17} />
      : isDeviceChecking
        ? <Loader2 size={17} className="spin" />
        : <Video size={17} />;

    return (
      <main className="lobby">
        <section className="lobby-copy">
          <BrandMark />
          <div className="brand-line" />
          <div className="eyebrow">{metadata.meetingType.replace(/_/g, ' ')}</div>
          <h1>{metadata.title}</h1>
          {metadata.description && <p>{metadata.description}</p>}
          <div className="privacy-line">
            <ShieldCheck size={16} />
            <span>Private link · host controls recording after everyone connects</span>
          </div>
        </section>
        <section className="device-panel" data-testid="device-check">
          <div className="device-brand">
            <span>Room prejoin</span>
          </div>
          <div className="preview-shell">
            {preview && <StreamVideo stream={preview} muted className="preview-video" testId="preview-video" />}
            {!preview && <DevicePlaceholder state={deviceState} />}
            {previewIsSynthetic && (
              <span className="media-watermark" data-testid="synthetic-media-label">
                Test camera
              </span>
            )}
          </div>
          <div className="device-meta">
            <span>Camera preview</span>
            <span><ShieldCheck size={13} /> Private room</span>
          </div>
          <button
            className={`primary${hasDeviceError ? ' is-action-needed' : ''}`}
            onClick={hasDeviceError ? () => void requestDevices() : joinLobby}
            disabled={isDeviceChecking}
            data-testid="join-room"
          >
            {joinButtonIcon}
            {joinButtonLabel}
          </button>
          <p className="join-hint">{joinButtonHint}</p>

          {metadata.role === 'HOST' && hasWorkspaceFeature && (
            <div className="prejoin-workspace" data-testid="prejoin-workspace">
              <div className="prejoin-workspace-header">
                <SquareTerminal size={14} />
                <span>WORKSPACE</span>
              </div>
              {workspaceSession?.status === 'READY' || workspaceSession?.status === 'SLEEPING' ? (
                <p className="prejoin-workspace-ready">Container ready — editor will open when you enter.</p>
              ) : workspaceSession?.status === 'LAUNCHING' ? (
                <div className="prejoin-workspace-launching">
                  <Loader2 size={14} className="spin" />
                  <span>Starting container...</span>
                  <button className="prejoin-refresh" onClick={() => void refreshWorkspace()}>
                    <RefreshCcw size={12} /> Refresh
                  </button>
                </div>
              ) : (
                <>
                  {needsRepoUrl && (
                    <input
                      type="url"
                      className="workspace-repo-input"
                      placeholder="https://github.com/org/repo"
                      value={workspaceRepoInput}
                      onChange={(e) => setWorkspaceRepoInput(e.target.value)}
                      data-testid="prejoin-repo-input"
                    />
                  )}
                  <button
                    className="prejoin-launch-btn"
                    onClick={() => void launchWorkspace()}
                    disabled={needsRepoUrl && !workspaceRepoInput.trim() || workspaceLoading}
                    data-testid="prejoin-launch"
                  >
                    {workspaceLoading ? <Loader2 size={14} className="spin" /> : <SquareTerminal size={14} />}
                    Launch workspace
                  </button>
                  {workspaceChallengeMessage && (
                    <p className="prejoin-workspace-diagnostic">{workspaceChallengeMessage}</p>
                  )}
                  {workspaceError && <p className="prejoin-workspace-error">{workspaceError}</p>}
                </>
              )}
            </div>
          )}
        </section>
      </main>
    );
  }

  const setSharedRoomSurface = (surface: RoomSurface): void => {
    if (!canControlRoomSurface || room.roomSurface === surface) return;
    const evidence = buildRoomSurfaceChangeEvidence({
      actor: roomActor,
      previousSurface: room.roomSurface,
      nextSurface: surface,
      roomPhase: room.phase,
    });
    room.setRoomSurface(surface);
    captureSessionEvent('room_surface_change', evidence.text, roomActor, evidence.properties);
  };

  const enterWin95Desktop = (): void => setSharedRoomSurface('win95');

  const exitWin95Desktop = (): void => setSharedRoomSurface('standard');

  const captureMediaControlChange = (
    control: MediaControlKind,
    previousEnabled: boolean,
    enabled: boolean,
  ): void => {
    const evidence = buildMediaControlEvidence({
      actor: roomActor,
      control,
      previousEnabled,
      enabled,
      surface: room.roomSurface,
      roomPhase: room.phase,
      capturedAtMs: Date.now(),
    });
    captureSessionEvent('media_control', evidence.text, roomActor, evidence.properties);
  };

  const toggleMicrophone = (): void => {
    const previousEnabled = room.micEnabled;
    const enabled = !previousEnabled;
    room.toggleMic();
    captureMediaControlChange('microphone', previousEnabled, enabled);
  };

  const toggleCamera = (): void => {
    const previousEnabled = room.cameraEnabled;
    const enabled = !previousEnabled;
    room.toggleCamera();
    captureMediaControlChange('camera', previousEnabled, enabled);
  };

  const captureRoomFileChange = (operation: RoomFileEvidenceOperation, file: RoomFile): void => {
    const text = roomFileEvidenceText(roomActor, operation, file.name);
    void buildRoomFileEvidence({
      actor: roomActor,
      operation,
      file,
      surface: room.roomSurface,
      roomPhase: room.phase,
      capturedAtMs: Date.now(),
    }).then((evidence) => {
      captureSessionEvent('file_change', text, roomActor, evidence.properties);
    }).catch((error: unknown) => {
      console.error('[Room] Failed to build source-backed room file evidence:', {
        operation,
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const handleCursorMove = useCallback((position: { x: number; y: number }): void => {
    room.publishCursorPresence(position);
    if (room.roomSurface !== 'win95') return;
    const evidence = buildCursorPresenceEvidence({
      actor: roomActor,
      position,
      surface: room.roomSurface,
      roomPhase: room.phase,
      capturedAtMs: Date.now(),
      previous: cursorPresenceEvidenceRef.current,
    });
    if (!evidence) return;
    cursorPresenceEvidenceRef.current = evidence.state;
    captureSessionEvent('cursor_presence', evidence.text, roomActor, evidence.properties);
  }, [captureSessionEvent, room, roomActor]);

  const openWorkspaceWindow = (): void => {
    if (!showWorkspacePanel) return;
    openSharedWindow({
      id: 'workspace',
      windowType: 'workspace',
      title: workspace?.repoUrl ?? 'VS Code',
      x: 80,
      y: 80,
      width: 800,
      height: 500,
    });
  };

  const openBrowserWindow = (url = ''): void => {
    const currentUrl = url ? normalizeBrowserNavigationUrl(url) ?? '' : '';
    openSharedWindow({
      id: 'browser',
      windowType: 'browser',
      title: 'Microsoft Edge',
      x: 100,
      y: 60,
      width: 800,
      height: 560,
      data: { currentUrl },
    });
    if (currentUrl) {
      const evidence = buildBrowserNavigationEvidence({
        actor: roomActor,
        windowId: 'browser',
        url: currentUrl,
        trigger: 'open_window_initial_url',
        surface: room.roomSurface,
        roomPhase: room.phase,
      });
      if (evidence) {
        captureSessionEvent('browser_navigation', evidence.text, roomActor, evidence.properties);
      }
    }
  };

  const openTerminalWindow = (): void => {
    openSharedWindow({
      id: 'terminal',
      windowType: 'terminal',
      title: 'Container terminal',
      x: 120,
      y: 80,
      width: 640,
      height: 400,
    });
  };

  const openFilesWindow = (): void => {
    openSharedWindow({
      id: 'tasks',
      windowType: 'tasks',
      title: 'Files',
      x: 200,
      y: 120,
      width: 520,
      height: 420,
    });
  };

  const openNotepadWindow = (text?: string): void => {
    const file = findRoomFile(room.fileSystem, NOTEPAD_FILE_ID);
    openSharedWindow({
      id: 'notepad',
      windowType: 'notepad',
      title: `${NOTEPAD_FILE_NAME} - Notepad`,
      x: 180,
      y: 90,
      width: 520,
      height: 420,
      data: { text: text ?? file?.content ?? '' },
    });
  };

  const openPaintWindow = (strokes?: PaintCanvasItem[]): void => {
    const file = findRoomFile(room.fileSystem, PAINT_FILE_ID);
    openSharedWindow({
      id: 'paint',
      windowType: 'paint',
      title: `${PAINT_FILE_NAME} - Paint`,
      x: 220,
      y: 110,
      width: 640,
      height: 480,
      data: { strokes: strokes ?? (file ? parsePaintFileContent(file.content) : []) },
    });
  };

  const saveNotepadText = (text: string): void => {
    updateSharedWindowData('notepad', { text });
    const existing = findRoomFile(room.fileSystem, NOTEPAD_FILE_ID);
    const now = Date.now();
    const file: RoomFile = {
      id: NOTEPAD_FILE_ID,
      name: NOTEPAD_FILE_NAME,
      kind: 'text',
      content: text,
      mimeType: 'text/plain',
      metadata: { app: 'notepad', path: `Desktop/${NOTEPAD_FILE_NAME}` },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: metadata.role,
    };
    room.publishFileSystemEvent({ kind: 'UPSERT_FILE', file });
    captureRoomFileChange('upsert', file);
  };

  const savePaintItems = (strokes: PaintCanvasItem[]): void => {
    updateSharedWindowData('paint', { strokes });
    const existing = findRoomFile(room.fileSystem, PAINT_FILE_ID);
    const now = Date.now();
    const file: RoomFile = {
      id: PAINT_FILE_ID,
      name: PAINT_FILE_NAME,
      kind: 'paint',
      content: serializePaintItems(strokes),
      mimeType: 'application/json',
      metadata: { app: 'paint', path: `Desktop/${PAINT_FILE_NAME}` },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: metadata.role,
    };
    room.publishFileSystemEvent({ kind: 'UPSERT_FILE', file });
    captureRoomFileChange('upsert', file);
  };

  const previewPaintItems = (strokes: PaintCanvasItem[]): void => {
    updateSharedWindowData('paint', { strokes });
  };

  const openRoomFile = (file: RoomFile): void => {
    if (file.kind === 'paint') {
      openPaintWindow(parsePaintFileContent(file.content));
      return;
    }
    if (file.kind === 'link') {
      openBrowserWindow(file.content);
      return;
    }
    openNotepadWindow(file.content);
  };

  const deleteRoomFile = (file: RoomFile): void => {
    room.publishFileSystemEvent({ kind: 'DELETE_FILE', fileId: file.id });
    if (file.id === NOTEPAD_FILE_ID) {
      wm.updateWindowData('notepad', { text: '' });
    }
    if (file.id === PAINT_FILE_ID) {
      wm.updateWindowData('paint', { strokes: [] });
    }
    captureRoomFileChange('delete', file);
  };

  const captureClippyAction = (
    actionId: string,
    text: string,
    options: {
      origin: 'prompt' | 'agent';
      agentAction?: AgentRoomAction;
    },
  ): void => {
    const evidence = buildClippyRoomActionExecutionEvidence({
      actionId,
      text,
      origin: options.origin,
      actor: roomActor,
      agentAction: options.agentAction,
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
    });
    captureSessionEvent('clippy_action', evidence.text, roomActor, evidence.properties);
  };

  const executeRoomAction = (actionId: string, options: { url?: string; source?: 'prompt' | 'agent'; agentAction?: AgentRoomAction } = {}): void => {
    const source = options.source ?? 'prompt';
    const actionEvidence = { origin: source, agentAction: options.agentAction } as const;
    switch (actionId) {
      case 'start-recording':
        captureClippyAction(actionId, `${source === 'agent' ? 'Agent' : 'Clippy'} action: start recording`, actionEvidence);
        void startRecording();
        break;
      case 'stop-recording':
        captureClippyAction(actionId, `${source === 'agent' ? 'Agent' : 'Clippy'} action: stop recording`, actionEvidence);
        void stopRecording();
        break;
      case 'launch-workspace':
        captureClippyAction(actionId, `${source === 'agent' ? 'Agent' : 'Clippy'} action: launch workspace`, actionEvidence);
        openWorkspaceWindow();
        void launchWorkspace();
        break;
      case 'open-workspace':
        captureClippyAction(actionId, `${source === 'agent' ? 'Agent' : 'Clippy'} action: open workspace`, actionEvidence);
        openWorkspaceWindow();
        break;
      case 'open-terminal':
        captureClippyAction(actionId, `${source === 'agent' ? 'Agent' : 'Clippy'} action: open terminal`, actionEvidence);
        openTerminalWindow();
        break;
      case 'open-browser':
        captureClippyAction(actionId, `${source === 'agent' ? 'Agent' : 'Clippy'} action: open browser`, actionEvidence);
        openBrowserWindow(options.url ?? '');
        break;
      case 'open-files':
        captureClippyAction(actionId, `${source === 'agent' ? 'Agent' : 'Clippy'} action: open files`, actionEvidence);
        openFilesWindow();
        break;
      case 'open-notepad':
        captureClippyAction(actionId, `${source === 'agent' ? 'Agent' : 'Clippy'} action: open notepad`, actionEvidence);
        openNotepadWindow();
        break;
      case 'open-paint':
        captureClippyAction(actionId, `${source === 'agent' ? 'Agent' : 'Clippy'} action: open paint`, actionEvidence);
        openPaintWindow();
        break;
      default:
        break;
    }
  };

  const handleClippyAction = (actionId: string): void => {
    executeRoomAction(actionId);
  };

  const handleAgentRoomAction = (action: AgentRoomAction): void => {
    executeRoomAction(action.id, { url: action.url, source: 'agent', agentAction: action });
  };

  const captureClippyUserChatMessage = (message: AgentChatMessage): void => {
    const evidence = buildClippyUserChatEvidence({
      message,
      actor: roomActor,
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
      repoUrl: workspace?.repoUrl ?? null,
    });
    captureSessionEvent('ai_chat_user', evidence.text, roomActor, evidence.properties);
  };

  const captureClippyAgentChatMessage = (message: AgentChatMessage): void => {
    if (message.persisted) return;
    const isAgentResponse = message.source === 'agent_stdout';
    if (isAgentResponse && message.observedAt) {
      const evidence = buildClippyAgentChatFallbackEvidence({
        text: message.text,
        agentName: message.agentName ?? 'devin',
        observedAt: message.observedAt,
        surface: room.roomSurface,
        roomPhase: room.phase,
        workspaceStatus: workspaceSession?.status ?? null,
        workspaceSessionId: workspaceSession?.sessionId ?? null,
        messageTimestamp: message.timestamp,
      });
      captureSessionEvent('ai_chat_agent', evidence.text, 'agent', evidence.properties);
      return;
    }
    const diagnosticText = isAgentResponse
      ? 'Clippy/Devin response was not recorded as agent evidence because bridge source metadata was missing.'
      : message.text;
    const observedAt = message.observedAt ?? new Date().toISOString();
    captureSessionEvent('ai_agent_status', diagnosticText, 'agent', {
      source: 'clippy_agent_bridge',
      agentStatusEventSource: 'browser_clippy_agent_ws',
      agent: message.agentName ?? 'devin',
      status: message.agentStatus ?? null,
      diagnosticSource: isAgentResponse
        ? 'agent_response_missing_source_metadata'
        : message.diagnosticSource ?? message.source,
      bridgeMessageSource: message.source,
      observedAt,
      exitCode: message.exitCode ?? null,
      signal: message.signal ?? null,
      truncated: message.truncated ?? null,
      bridgePersisted: message.persisted ?? null,
      promptType: message.promptType ?? null,
      deliveredToAgent: message.deliveredToAgent ?? null,
      promptLength: message.promptLength ?? null,
      promptFingerprint: message.promptFingerprint ?? null,
      roomContextStatus: message.roomContextStatus ?? null,
      roomContextLength: message.roomContextLength ?? null,
      roomContextFingerprint: message.roomContextFingerprint ?? null,
      userMessageLength: message.userMessageLength ?? null,
      userMessageFingerprint: message.userMessageFingerprint ?? null,
      contextTruncated: message.contextTruncated ?? null,
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
      messageTimestamp: message.timestamp,
      agentResponseClaimed: false,
    });
  };

  const captureClippyAgentStatus = (status: AgentStatus, agentName: string): void => {
    const observedAt = new Date().toISOString();
    captureSessionEvent('ai_agent_status', agentStatusEvidenceText(status, agentName), 'agent', {
      source: 'clippy_agent_bridge',
      agentStatusEventSource: 'browser_clippy_agent_ws',
      agent: agentName,
      status,
      bridgeMessageSource: 'agent_status',
      observedAt,
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
      messageTimestamp: Date.now(),
      agentResponseClaimed: false,
    });
  };

  const captureClippyFileChange = (event: AgentFileChangeEvent): void => {
    if (event.persisted) return;
    const eventType = event.actionName === 'deleted' ? 'file_change' : 'code_editor_save';
    captureSessionEvent(eventType, event.filePath, 'system', {
      source: event.source ?? 'code_server_workspace',
      observedBy: 'clippy_agent_bridge',
      bridgeEventType: 'FILE_CHANGED',
      editorSurface: 'code-server',
      action: event.actionName,
      surface: room.roomSurface,
      roomPhase: room.phase,
      workspaceStatus: workspaceSession?.status ?? null,
      workspaceSessionId: workspaceSession?.sessionId ?? null,
      repoUrl: workspace?.repoUrl ?? null,
      path: event.filePath,
      observedAt: event.observedAt ?? null,
      contentHash: event.contentHash ?? null,
      sizeBytes: event.sizeBytes ?? null,
      contentPreview: event.contentPreview ?? null,
      bridgePersisted: false,
    });
  };

  const handleDesktopIconDoubleClick = (windowType: WindowType): void => {
    const existing = wm.getWindowByType(windowType);
    if (existing) {
      if (existing.minimized) {
        restoreSharedWindow(existing.id);
      } else {
        focusSharedWindow(existing.id);
      }
      return;
    }
    switch (windowType) {
      case 'video':
        openSharedWindow({ id: 'video', windowType: 'video', title: 'Video Call', x: 60, y: 30, width: 480, height: 360 });
        break;
      case 'workspace':
        openWorkspaceWindow();
        break;
      case 'chat':
        openSharedWindow({ id: 'chat', windowType: 'chat', title: 'Room Chat', x: 560, y: 30, width: 340, height: 400 });
        break;
      case 'tasks':
        openFilesWindow();
        break;
      case 'notepad':
        openNotepadWindow();
        break;
      case 'paint':
        openPaintWindow();
        break;
      case 'browser':
        openBrowserWindow();
        break;
      case 'terminal':
        openTerminalWindow();
        break;
      default:
        break;
    }
  };

  const renderWindowContent = (win: WindowState): JSX.Element => {
    switch (win.windowType) {
      case 'video':
        return (
          <div className="win95-video-content">
            <div className="win95-video-grid">
              {/* Remote participant tile */}
              <div className="win95-video-tile">
                {room.remoteStream ? (
                  <StreamVideo stream={room.remoteStream} className="win95-video-tile-stream" testId="remote-video" />
                ) : (
                  <div className="win95-video-tile-empty" data-testid="waiting-state">
                    <div className="win95-video-tile-avatar">
                      {metadata.role === 'HOST' ? '👤' : '🏠'}
                    </div>
                    <span className="win95-video-tile-label">
                      {isRoomError ? 'Connection interrupted'
                        : isRecovering ? 'Reconnecting...'
                        : isOpening ? 'Opening room...'
                        : isConnecting ? 'Connecting...'
                        : metadata.role === 'HOST' ? 'Waiting for guest'
                        : 'Waiting for host'}
                    </span>
                    {canRetry && (
                      <button onClick={room.retryConnection} data-testid="retry-connection" className="win95-video-tile-btn">Retry</button>
                    )}
                    {!canRetry && canStartCall && (
                      <button onClick={() => void room.startCall()} data-testid="start-call" className="win95-video-tile-btn">Start call</button>
                    )}
                    {canAccept && (
                      <button onClick={() => void room.acceptCall()} data-testid="accept-call" className="win95-video-tile-btn">Join call</button>
                    )}
                  </div>
                )}
                <span className="win95-video-tile-name">
                  {metadata.role === 'HOST' ? 'Guest' : 'Host'}
                </span>
              </div>

              {/* Local participant tile */}
              <div className="win95-video-tile">
                {room.localStream ? (
                  <StreamVideo stream={room.localStream} muted className="win95-video-tile-stream local-video" testId="local-video" />
                ) : (
                  <div className="win95-video-tile-empty">
                    <div className="win95-video-tile-avatar">📷</div>
                    <span className="win95-video-tile-label">Camera off</span>
                  </div>
                )}
                <span className="win95-video-tile-name">You</span>
              </div>
            </div>

            <div className="win95-video-controls">
              <button className="win95-video-btn" onClick={toggleMicrophone} aria-label="Toggle microphone">
                {room.micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
              </button>
              <button className="win95-video-btn" onClick={toggleCamera} aria-label="Toggle camera">
                {room.cameraEnabled ? <Camera size={16} /> : <CameraOff size={16} />}
              </button>
              {metadata.role === 'HOST' && (metadata.features?.recordingEnabled ?? true) && (
                recordingState === 'recording' ? (
                  <button
                    className="win95-video-btn is-recording"
                    onClick={() => void stopRecording()}
                    disabled={!canStopRecording}
                    aria-label="Stop recording"
                    data-testid="stop-recording"
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="win95-video-btn"
                    onClick={() => void startRecording()}
                    disabled={!canStartRecording}
                    aria-label={recordingButtonLabel}
                    data-testid="start-recording"
                  >
                    <Circle size={14} fill="none" />
                  </button>
                )
              )}
              {metadata.role === 'HOST' && (metadata.features?.recordingEnabled ?? true) && (
                <span
                  className={`win95-recording-state${recordingState === 'recording' ? ' is-recording' : ''}`}
                  data-testid="recording-state"
                >
                  {recordingLabel}
                </span>
              )}
              {metadata.role === 'HOST' && inlineRecordingNotice && (
                <span className="win95-recording-state" data-testid="recording-save-status">
                  {inlineRecordingNotice}
                </span>
              )}
              <button className="win95-video-btn is-hangup" onClick={() => void endCall()} aria-label="End call" data-testid="end-call">
                <PhoneOff size={16} />
              </button>
            </div>
          </div>
        );

      case 'workspace':
        return (
          <div className="win95-workspace-content" style={{ position: 'relative' }}>
            {workspaceUrl ? (
              <>
                {!iframeLoaded && (
                  <div className="win95-workspace-loader">
                    <Loader2 size={24} className="spin" />
                    <span>Loading editor...</span>
                  </div>
                )}
                <iframe
                  src={workspaceUrl}
                  title="VS Code workspace"
                  className="win95-workspace-iframe"
                  data-testid="workspace-iframe"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-top-navigation-by-user-activation"
                  onLoad={captureWorkspaceEditorOpen}
                />
              </>
            ) : (
              <div className="win95-workspace-empty">
                <SquareTerminal size={26} />
                <h3>
                  {workspaceSession?.status === 'LAUNCHING'
                    ? 'Starting workspace...'
                    : workspaceSession?.status === 'ERROR'
                      ? 'Workspace failed'
                      : 'Workspace ready to launch'}
                </h3>
                <p>
                  {workspaceSession?.status === 'LAUNCHING'
                    ? 'The container is warming up. This can take 20-30 seconds.'
                    : workspaceSession?.errorMessage
                      ? workspaceSession.errorMessage
                      : workspaceError
                      ? workspaceError
                      : workspaceChallengeMessage
                        ? workspaceChallengeMessage
                        : metadata.role === 'HOST'
                          ? 'Launch a repo into a live code-server workspace for this call.'
                          : 'The host can launch the live code workspace.'}
                </p>
                {needsRepoUrl && canLaunchWorkspace && (
                  <input
                    type="url"
                    className="win95-workspace-repo-input"
                    placeholder="https://github.com/org/repo"
                    value={workspaceRepoInput}
                    onChange={(e) => setWorkspaceRepoInput(e.target.value)}
                    data-testid="workspace-repo-input"
                  />
                )}
                {canLaunchWorkspace && (
                  <button
                    className="win95-workspace-launch-btn"
                    onClick={() => void launchWorkspace()}
                    disabled={needsRepoUrl && !workspaceRepoInput.trim()}
                  >
                    {workspaceLoading ? <Loader2 size={14} className="spin" /> : <SquareTerminal size={14} />}
                    Launch workspace
                  </button>
                )}
                {workspaceSession?.status === 'LAUNCHING' && (
                  <button className="win95-workspace-launch-btn" onClick={() => void refreshWorkspace()}>
                    <RefreshCcw size={14} /> Refresh
                  </button>
                )}
              </div>
            )}
          </div>
        );

      case 'chat':
        return (
          <ChatWindow
            messages={chatMessages}
            onSend={(text) => sendChatMessage(text)}
            currentUserRole={metadata.role}
          />
        );

      case 'tasks':
        return (
          <RoomFileSystemWindow
            files={room.fileSystem}
            onOpenFile={openRoomFile}
            onDeleteFile={deleteRoomFile}
          />
        );

      case 'browser':
        return (
          <BrowserWindow
            initialUrl={stringWindowData(win, 'currentUrl') || stringWindowData(win, 'initialUrl')}
            currentUrl={stringWindowData(win, 'currentUrl') || stringWindowData(win, 'initialUrl')}
            onNavigate={(url, navigation) => updateSharedWindowData(
              win.id,
              { currentUrl: url },
              { browserNavigationTrigger: navigation.trigger },
            )}
          />
        );

      case 'notepad':
        return (
          <NotepadWindow
            value={stringWindowData(win, 'text')}
            onChange={saveNotepadText}
            saveStatus={`Desktop/${NOTEPAD_FILE_NAME}`}
          />
        );

      case 'paint':
        return (
          <PaintWindow
            strokes={paintItemsWindowData(win)}
            onChange={savePaintItems}
            onPreview={previewPaintItems}
            saveStatus={`Desktop/${PAINT_FILE_NAME}`}
          />
        );

      case 'terminal':
        return (
          <TerminalWindow
            wsUrl={workspaceSession && hasActiveWorkspace
              ? roomTerminalWsUrl(token, workspaceSession.sessionId)
              : ''}
            onCommand={captureTerminalCommand}
            onOutput={captureTerminalOutput}
          />
        );

      default:
        return <div style={{ padding: '8px', color: '#000' }}>Window content</div>;
    }
  };

  const roomSurface = usesWin95Desktop ? (
    <Win95Desktop
      wm={wm}
      onIconDoubleClick={handleDesktopIconDoubleClick}
      recordingLabel={recordingLabel}
      recordingActive={recordingState === 'recording'}
      onClippyClick={(metadata.features?.clippyEnabled ?? true) ? openClippyChat : undefined}
      clippyActive={clippyVisible}
      renderWindowContent={renderWindowContent}
      onWindowClose={closeSharedWindow}
      onWindowFocus={focusSharedWindow}
      onWindowMinimize={minimizeSharedWindow}
      onWindowRestore={restoreSharedWindow}
      onWindowMaximize={maximizeSharedWindow}
      onWindowMove={moveSharedWindow}
      onWindowMoveEnd={publishSharedWindowMove}
      canExitDesktop={canControlRoomSurface}
      onExitDesktop={exitWin95Desktop}
      peerCursors={room.peerCursors}
      onCursorMove={handleCursorMove}
    />
  ) : (
    <StandardLayout
      wm={wm}
      renderWindowContent={renderWindowContent}
      recordingLabel={recordingLabel}
      recordingActive={recordingState === 'recording'}
      canEnterDesktop={canControlRoomSurface}
      onEnterDesktop={enterWin95Desktop}
    />
  );

  return (
    <>
      <div
        className="call-stage"
        data-testid="call-stage"
        data-room-phase={room.phase}
        data-room-layout={usesWin95Desktop ? 'win95' : 'standard'}
      >
        {roomSurface}
      </div>
      {clippyVisible && enteredRoom && usesWin95Desktop && (metadata.features?.clippyEnabled ?? true) && (
        <ClippyAssistant
          messages={clippyMessages}
          onDismiss={dismissClippy}
          agentWsUrl={workspaceSession && hasActiveWorkspace
            ? roomAgentWsUrl(token, workspaceSession.sessionId)
            : null}
          agentEnabled={hasActiveWorkspace}
          agentUnavailableMessage={clippyAgentUnavailableMessage}
          canLaunchAgentWorkspace={canLaunchWorkspace}
          openChatRequest={clippyChatRequest}
          onOpenBrowser={openBrowserWindow}
          onOpenTerminal={openTerminalWindow}
          onAction={handleClippyAction}
          onAgentRoomAction={handleAgentRoomAction}
          onUserChatMessage={captureClippyUserChatMessage}
          onAgentChatMessage={captureClippyAgentChatMessage}
          onAgentStatus={captureClippyAgentStatus}
          onAgentFileChange={captureClippyFileChange}
        />
      )}
      {room.phase === 'ended' && (
        <div className="ended-overlay" style={{ zIndex: 99999 }}>
          <RoomStateMark />
          <h2>Call ended</h2>
          <p>
            {metadata.role === 'HOST' && recordingState === 'uploading'
              ? 'Saving the recording and starting transcription...'
              : metadata.role === 'HOST' && recordingState === 'saved'
                ? (recordingNotice ?? 'Recording saved. Transcript processing has started.')
                : metadata.role === 'HOST' && recordingState === 'failed'
                  ? `Recording was not saved: ${recordingError ?? 'unknown error'}`
                  : 'You can close this window.'}
          </p>
        </div>
      )}
    </>
  );
}

export default function App(): JSX.Element {
  const location = useLocation();
  const token = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [metadata, setMetadata] = useState<RoomMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('This room link is invalid.');
      return;
    }
    void loadRoom(token).then(setMetadata).catch(() => {
      setError('This room link is expired or unavailable.');
    });
  }, [token]);

  if (error) {
    return (
      <main className="center-message is-error">
        <RoomStateMark variant="error" />
        <h1>Room unavailable</h1>
        <p>{error}</p>
      </main>
    );
  }
  if (!metadata) {
    return (
      <main className="center-message is-loading">
        <RoomStateMark loading />
        <h1>Opening room...</h1>
        <p>Connecting to the private room.</p>
      </main>
    );
  }
  return <Room token={token} metadata={metadata} />;
}
