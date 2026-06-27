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

interface SignalMessage {
  type:
    | 'OFFER'
    | 'ANSWER'
    | 'ICE_CANDIDATE'
    | 'HANGUP'
    | 'STATUS_UPDATE'
    | 'ROOM_DESKTOP_EVENT'
    | 'ROOM_CLIPPY_PROMPT'
    | 'ROOM_CHAT_MESSAGE'
    | 'ROOM_CURSOR'
    | 'ROOM_FILE_SYSTEM_EVENT';
  role?: VideoRole;
  status?: SignalStatus;
  payload?: unknown;
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
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'OPEN_WINDOW';
      window: RoomDesktopWindow;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'CLOSE_WINDOW';
      windowId: string;
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'UPDATE_WINDOW_DATA';
      windowId: string;
      data: Record<string, unknown>;
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
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'WORKSPACE_STATE_CHANGED';
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
    };

interface RoomDesktopActivityEntry {
  event: RoomDesktopEvent;
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
  hold?: boolean;
  targetRoles?: VideoRole[];
  actions?: RoomClippyAction[];
}

interface RoomClippyPromptActivityEntry {
  prompt: RoomClippyPrompt;
  role: VideoRole;
  recordedAt: number;
}

interface RoomChatMessage {
  id: string;
  clientId: string;
  createdAt: number;
  role: VideoRole;
  text: string;
}

interface RoomChatActivityEntry {
  message: RoomChatMessage;
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
    }
  | {
      id: string;
      clientId: string;
      createdAt: number;
      kind: 'DELETE_FILE';
      fileId: string;
      file?: RoomFile;
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
      };
    }
    if (value.kind === 'SET_ROOM_SURFACE' && this.isRoomSurface(value.surface)) {
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'SET_ROOM_SURFACE',
        surface: value.surface,
      };
    }
    if (value.kind === 'CLOSE_WINDOW' && typeof value.windowId === 'string') {
      return {
        id: value.id,
        clientId: value.clientId,
        createdAt: value.createdAt,
        kind: 'CLOSE_WINDOW',
        windowId: value.windowId,
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
        status,
        workspaceSessionId: this.safeTextOrNull(value.workspaceSessionId, 160),
        errorMessage: this.safeTextOrNull(value.errorMessage, 500),
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
      };
    }
    return null;
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
      hold: typeof value.hold === 'boolean' ? value.hold : undefined,
      targetRoles: targetRoles && targetRoles.length > 0 ? [...new Set(targetRoles)] : undefined,
      actions: actions && actions.length > 0 ? actions : undefined,
    };
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
    return {
      id: value.id,
      clientId: value.clientId,
      createdAt: value.createdAt,
      role: value.role,
      text: value.text.trim(),
    };
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
        id: event.id,
        clientId: event.clientId,
        createdAt: event.createdAt,
        kind: 'DELETE_FILE',
        fileId: event.fileId,
      };
    }
    return { ...event, file: deletedFile };
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

  private async persistFileSystemEvent(event: RoomFileSystemEvent, role: VideoRole): Promise<RoomFile[]> {
    const files = await this.getRoomFileSystem();
    if (event.kind === 'DELETE_FILE') {
      const nextFiles = files.filter((file) => file.id !== event.fileId);
      await this.state.storage.put('roomFileSystem', nextFiles);
      return nextFiles;
    }
    const nextFile = {
      ...event.file,
      updatedBy: role,
    };
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
        clippyPromptActivityLog: this.parseClippyPromptActivityLog(
          await this.state.storage.get<unknown>('clippyPromptActivityLog'),
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
      server.send(JSON.stringify({
        type: 'ROOM_DESKTOP_STATE',
        payload: { windows: desktopWindows, surface: this.roomSurface },
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
        ws.send(JSON.stringify({
          type: 'ROOM_DESKTOP_EVENT_REJECTED',
          reason: 'ROOM_ENDED',
        }));
        return;
      }
      const event = this.parseDesktopEvent(message.payload);
      if (!event) {
        ws.send(JSON.stringify({
          type: 'ROOM_DESKTOP_EVENT_REJECTED',
          reason: 'INVALID_EVENT',
        }));
        return;
      }
      if (event.kind === 'SET_ROOM_SURFACE' && !this.isHostRole(senderRole)) {
        ws.send(JSON.stringify({
          type: 'ROOM_DESKTOP_EVENT_REJECTED',
          reason: 'ONLY_HOST_CAN_SET_SURFACE',
        }));
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
      await this.persistClippyPrompt(prompt);
      await this.recordClippyPromptActivity(prompt, senderRole);
      this.broadcastExcept(ws, JSON.stringify({
        type: 'ROOM_CLIPPY_PROMPT',
        role: senderRole,
        payload: prompt,
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
      const persistedMessage = { ...chatMessage, role: senderRole };
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

    if (message.type === 'ROOM_FILE_SYSTEM_EVENT') {
      if (this.sessionStatus === 'ENDED') {
        ws.send(JSON.stringify({
          type: 'ROOM_FILE_SYSTEM_EVENT_REJECTED',
          reason: 'ROOM_ENDED',
        }));
        return;
      }
      const event = this.parseFileSystemEvent(message.payload);
      if (!event) {
        ws.send(JSON.stringify({
          type: 'ROOM_FILE_SYSTEM_EVENT_REJECTED',
          reason: 'INVALID_EVENT',
        }));
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
