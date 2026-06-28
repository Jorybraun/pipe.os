import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import { generateRoomToken, hashRoomToken } from '../lib/roomTokens';
import {
  parseDeepgramStructuredTranscription,
  transcribeAudioDeepgramStructured,
  transcribeAudioWhisper,
  type StructuredTranscription,
} from '../lib/transcribe';
import { ingestMeetingTranscriptToLivingContext } from '../lib/livingContext';
import {
  loadMeetingTranscriptContext,
  searchTranscriptSourceSpans,
} from '../lib/livingContext/readModel';
import { getTurnIceServers } from '../lib/turnCredentials';
import { sendTransactionalEmail } from '../lib/transactionalEmail';
import {
  computeEffectiveTtl,
  MIN_TTL_SECONDS,
} from '../lib/devContainerTtl';
import {
  getLatestSessionForRoom,
  getSessionByIdForRoom,
  insertRoomSession,
  markStopped,
  type DevContainerSessionRow,
} from '../lib/devContainerSessions';
import type {
  JsonObject,
  MeetingTranscriptAssertionInput,
  MeetingTranscriptSegmentInput,
} from '../lib/livingContext';
import type { SessionEventType } from '../lib/sessionEvents';
import type { Env, Variables } from '../types';

type RoomRole = 'HOST' | 'GUEST';

interface ResolvedRoom {
  room_id: string;
  meeting_id: string;
  session_id: string;
  room_status: string;
  role: RoomRole;
  owner_id: string;
  title: string;
  description: string | null;
  scheduled_at: string | null;
  meeting_type: string;
  meeting_status: string;
  started_at: string | null;
  ended_at: string | null;
  guest_contact_id: string | null;
  scheduled_interview_id: string | null;
  video_enabled: number;
  workspace_enabled: number;
  recording_enabled: number;
  clippy_enabled: number;
}

interface MeetingAnalysis {
  summary: string;
  decisions: string[];
  actionItems: Array<{
    text: string;
    owner: string | null;
    dueDate: string | null;
  }>;
  topics: string[];
  followUps: string[];
  semanticAssertions: MeetingTranscriptAssertionInput[];
}

interface ResolvedMeetingRecording {
  room: ResolvedRoom;
  recordingKey: string | null;
}

interface RoomActivityEvidenceSyncResult {
  captured: number;
  failed: number;
  events: number;
}

interface RoomLifecycleEvidenceCaptureResult {
  captured: boolean;
  nodeId: string | null;
  type: SessionEventType;
}

const WHISPER_TRANSCRIPTION_TIMEOUT_MS = 30_000;
const MEETING_ANALYSIS_TIMEOUT_MS = 30_000;
const E2E_DEEPGRAM_RESPONSE_HEADER = 'X-Pipe-E2E-Deepgram-Response';
const E2E_MEETING_ANALYSIS_HEADER = 'X-Pipe-E2E-Meeting-Analysis';
const E2E_TRANSCRIPT_OVERRIDE_MAX_BYTES = 24 * 1024;
const DEFAULT_DEV_CONTAINER_TTL_SECONDS = 3600;
const DEFAULT_DEV_CONTAINER_MAX_TTL_SECONDS = 7200;
const DEFAULT_DEV_CONTAINER_INSTANCE_TYPE = 'standard-1';
const WORKSPACE_INTERVIEW_TYPES = new Set(['DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX']);
const WORKSPACE_TERMINAL_STATUSES = new Set(['ERROR', 'STOPPED', 'EXPIRED']);
const WORKSPACE_PROXY_ALLOWED_STATUS: ReadonlySet<string> = new Set(['READY', 'SLEEPING']);
const LIVING_CONTENT_HASH_RE = /^content_[a-f0-9]{32}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const TERMINAL_FINGERPRINT_RE = /^terminal_[a-f0-9]{8}$/;
const CLIPPY_PROMPT_FINGERPRINT_RE = /^clippy_[a-f0-9]{8}$/;
const ROOM_SURFACES = new Set(['standard', 'win95']);
const WINDOW_LIFECYCLE_SOURCES = new Set([
  'win95_desktop_ui',
  'win95_window_chrome',
  'win95_taskbar',
  'clippy_action',
  'shared_state_sync',
]);
const WINDOW_STATE_ACTIONS = new Set([
  'focus',
  'maximize',
  'minimize',
  'move',
  'resize',
  'restore_or_focus',
  'restore_size',
  'update',
]);
const WINDOW_STATE_KEYS = new Set(['x', 'y', 'width', 'height', 'minimized', 'maximized', 'focused']);
const WINDOW_DATA_ACTIONS = new Set(['edit_text', 'edit_paint', 'update_data']);
const CHAT_DELIVERY_STATUSES = new Set(['pending', 'accepted', 'rejected']);
const CLIPPY_UI_SOURCES = new Set(['clippy_tray_ui', 'clippy_prompt_ui']);
const CLIPPY_UI_EXECUTION_STATUSES = new Set(['opened', 'dismissed', 'executed']);
const CLIPPY_PROMPT_EVENT_SOURCES = new Set(['browser_proactive_clippy_prompt', 'clippy_agent_bridge']);
const AGENT_STATUSES = new Set(['starting', 'idle', 'thinking', 'working', 'auth_needed', 'disconnected']);
const AGENT_STATUS_MESSAGE_SOURCES = new Set(['agent_status', 'bridge_diagnostic', 'bridge_observation', 'agent_stdout']);
const BROWSER_NAVIGATION_TRIGGERS = new Set([
  'address_bar',
  'go_button',
  'history_back',
  'history_forward',
  'open_window_initial_url',
  'shared_state_sync',
]);
const WORKSPACE_STATE_SOURCES = new Set(['initial_load', 'launch', 'refresh', 'error']);
const CURSOR_PRESENCE_SAMPLE_INTERVAL_MS = 15_000;
const CURSOR_PRESENCE_MOVEMENT_THRESHOLD = 0.03;
const CURSOR_SAMPLE_ID_RE = /^cursor:(host|guest):\d+:\d+:\d+$/;
const MEDIA_CONTROL_ID_RE = /^media:(host|guest):(microphone|camera):\d+:(enabled|disabled)$/;
const CODE_SERVER_SAVE_ACTIONS = new Set(['created', 'modified']);
const SURFACE_CHANGE_ID_RE = /^surface:(host|guest):\d+:(standard|win95):(standard|win95)$/;
const WINDOW_LIFECYCLE_ID_RE = /^window-lifecycle:(host|guest):\d+:(open|close):[^:]+$/;
const WINDOW_STATE_CHANGE_ID_RE = /^window-state:(host|guest):\d+:[^:]+:[a-z_]+$/;
const WINDOW_DATA_UPDATE_ID_RE = /^window-data:(host|guest):\d+:[^:]+:[a-z_]+$/;
const WINDOW_DATA_FINGERPRINT_RE = /^data_[a-f0-9]{8}$/;
const BROWSER_NAVIGATION_ID_RE = /^browser-navigation:(host|guest):\d+:[^:]+:[a-z_]+:nav_[a-f0-9]{8}$/;
const BROWSER_NAVIGATION_FINGERPRINT_RE = /^nav_[a-f0-9]{8}$/;

function browserNavigationFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `nav_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const roomEventSchema = z.object({
  event: z.enum(['JOINED', 'LEFT', 'STARTED', 'RECORDING_STARTED', 'ENDED']),
});

const sessionEventSchema = z.object({
  type: z.enum([
    'chat_message',
    'ai_chat_user',
    'ai_chat_agent',
    'ai_agent_status',
    'terminal_command',
    'terminal_output',
    'file_change',
    'browser_navigation',
    'window_open',
    'window_close',
    'window_update',
    'window_focus',
    'cursor_presence',
    'media_control',
    'room_surface_change',
    'workspace_state',
    'participant_join',
    'participant_leave',
    'clippy_prompt',
    'clippy_action',
    'recording_start',
    'recording_stop',
    'code_editor_open',
    'code_editor_save',
  ]),
  text: z.string().min(1).max(8000),
  actor: z.enum(['host', 'guest', 'agent', 'system']).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
}).superRefine((event, ctx) => {
  const properties = event.properties ?? {};
  const hasString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const hasFiniteNonNegativeNumber = (value: unknown): boolean => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  );
  const hasRoomSurface = (value: unknown): boolean => typeof value === 'string' && ROOM_SURFACES.has(value);
  const propertyActorMatches = event.actor
    && (properties.actor === undefined || properties.actor === event.actor);
  if (event.type === 'chat_message') {
    const sourceOk = properties.source === 'room_chat_client_submit'
      && properties.chatEventSource === 'browser_room_chat_window';
    const actorOk = (event.actor === 'host' || event.actor === 'guest')
      && propertyActorMatches;
    const messageOk = hasString(properties.roomMessageId)
      && hasString(properties.clientId)
      && hasFiniteNonNegativeNumber(properties.messageCreatedAt)
      && typeof properties.messageLength === 'number'
      && properties.messageLength === event.text.length
      && typeof properties.deliveryStatus === 'string'
      && CHAT_DELIVERY_STATUSES.has(properties.deliveryStatus);
    const contextOk = hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && typeof properties.durableObjectReplayExpected === 'boolean';
    if (sourceOk && actorOk && messageOk && contextOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Room chat evidence must come from browser room chat with message identity, delivery status, surface, and room phase.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'file_change') {
    if (properties.source === 'win95_shared_file_system') {
      const operation = properties.operation;
      const operationOk = operation === 'upsert' || operation === 'delete';
      const sharedOk = properties.fileEventSource === 'browser_client_submit'
        && hasString(properties.fileId)
        && hasString(properties.fileName)
        && hasString(properties.fileKind)
        && properties.surface === 'win95'
        && hasString(properties.roomPhase);
      const upsertOk = operation === 'upsert'
        && typeof properties.contentHash === 'string'
        && LIVING_CONTENT_HASH_RE.test(properties.contentHash)
        && hasFiniteNonNegativeNumber(properties.contentLength)
        && hasFiniteNonNegativeNumber(properties.fileUpdatedAt);
      const deleteOk = operation === 'delete'
        && typeof properties.deletedContentHash === 'string'
        && LIVING_CONTENT_HASH_RE.test(properties.deletedContentHash)
        && hasFiniteNonNegativeNumber(properties.deletedContentLength)
        && hasFiniteNonNegativeNumber(properties.deletedFileUpdatedAt);
      if (operationOk && sharedOk && (upsertOk || deleteOk)) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Win95 file-change evidence must include browser source, file identity, operation, content hash, and file timestamps.',
        path: ['properties'],
      });
      return;
    }
    if (properties.source === 'code_server_workspace') {
      const observedBy = properties.observedBy;
      const observedByOk = observedBy === 'agent_bridge' || observedBy === 'clippy_agent_bridge';
      const observedAtOk = hasString(properties.observedAt);
      const bridgeOk = properties.bridgeEventType === 'FILE_CHANGED'
        && properties.editorSurface === 'code-server';
      const actionOk = properties.action === 'deleted';
      const pathOk = hasString(properties.path);
      const hashOk = typeof properties.contentHash === 'string' && SHA256_HEX_RE.test(properties.contentHash);
      const sizeOk = hasFiniteNonNegativeNumber(properties.sizeBytes);
      const directBridgeOk = properties.bridgePersisted === true
        && observedBy === 'agent_bridge'
        && hasString(properties.workspaceRoot);
      const browserFallbackOk = properties.bridgePersisted === false
        && observedBy === 'clippy_agent_bridge'
        && hasRoomSurface(properties.surface)
        && hasString(properties.roomPhase)
        && hasString(properties.workspaceStatus)
        && hasString(properties.workspaceSessionId)
        && (
          properties.repoUrl === null
          || properties.repoUrl === undefined
          || hasString(properties.repoUrl)
        );
      if (
        event.actor === 'system'
        && observedByOk
        && observedAtOk
        && bridgeOk
        && actionOk
        && pathOk
        && hashOk
        && sizeOk
        && (directBridgeOk || browserFallbackOk)
      ) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Code-server delete evidence must come from a FILE_CHANGED workspace bridge event with path, content hash, size, observation time, and direct or browser-fallback provenance.',
        path: ['properties'],
      });
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'File-change evidence must come from a recognized source-backed file surface.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'browser_navigation') {
    const url = properties.url;
    let parsedUrl: URL | null = null;
    if (typeof url === 'string') {
      try {
        parsedUrl = new URL(url);
      } catch {
        parsedUrl = null;
      }
    }
    const protocol = parsedUrl?.protocol.replace(':', '');
    const sourceOk = properties.source === 'room_browser_window'
      && properties.navigationSource === 'browser_window_client_submit';
    const urlOk = typeof url === 'string'
      && url.trim().length > 0
      && event.text === url
      && parsedUrl !== null
      && (protocol === 'http' || protocol === 'https');
    const urlPartsOk = parsedUrl !== null
      && properties.urlHost === parsedUrl.hostname
      && properties.urlProtocol === protocol;
    const triggerOk = typeof properties.navigationTrigger === 'string'
      && BROWSER_NAVIGATION_TRIGGERS.has(properties.navigationTrigger);
    const actorOk = (event.actor === 'host' || event.actor === 'guest')
      && properties.actor === event.actor;
    const capturedAtMs = properties.capturedAtMs;
    const navigationId = properties.browserNavigationId;
    const urlFingerprint = properties.urlFingerprint;
    const idOk = typeof navigationId === 'string'
      && BROWSER_NAVIGATION_ID_RE.test(navigationId)
      && typeof capturedAtMs === 'number'
      && Number.isInteger(capturedAtMs)
      && capturedAtMs >= 0
      && typeof urlFingerprint === 'string'
      && BROWSER_NAVIGATION_FINGERPRINT_RE.test(urlFingerprint)
      && typeof url === 'string'
      && urlFingerprint === browserNavigationFingerprint(url)
      && navigationId === `browser-navigation:${event.actor}:${capturedAtMs}:${properties.windowId}:${properties.navigationTrigger}:${urlFingerprint}`;
    const contextOk = hasString(properties.windowId)
      && (properties.surface === 'standard' || properties.surface === 'win95')
      && hasString(properties.roomPhase);
    if (sourceOk && urlOk && urlPartsOk && triggerOk && actorOk && idOk && contextOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Browser navigation evidence must come from the room browser window with actor, stable navigation id, timestamp, normalized URL, trigger, and room context.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'window_open' || event.type === 'window_close') {
    const expectedLifecycleKind = event.type === 'window_open' ? 'open' : 'close';
    const sourceOk = properties.source === 'window_lifecycle_client_submit'
      && typeof properties.lifecycleSource === 'string'
      && WINDOW_LIFECYCLE_SOURCES.has(properties.lifecycleSource);
    const lifecycleOk = properties.lifecycleKind === expectedLifecycleKind;
    const actorOk = (event.actor === 'host' || event.actor === 'guest')
      && properties.actor === event.actor;
    const windowIdOk = hasString(properties.windowId);
    const windowTypeOk = hasString(properties.windowType);
    const windowTitleOk = hasString(properties.windowTitle)
      && event.text === properties.windowTitle;
    const capturedAtMs = properties.capturedAtMs;
    const lifecycleId = properties.windowLifecycleId;
    const idOk = typeof lifecycleId === 'string'
      && WINDOW_LIFECYCLE_ID_RE.test(lifecycleId)
      && typeof capturedAtMs === 'number'
      && Number.isInteger(capturedAtMs)
      && capturedAtMs >= 0
      && lifecycleId === `window-lifecycle:${event.actor}:${capturedAtMs}:${expectedLifecycleKind}:${properties.windowId}`;
    const contextOk = hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && typeof properties.durableObjectReplayExpected === 'boolean';
    if (sourceOk && lifecycleOk && actorOk && windowIdOk && windowTypeOk && windowTitleOk && idOk && contextOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Window lifecycle evidence must come from the room window client with actor, lifecycle kind, stable event id, timestamp, window identity, surface, and room phase.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'window_update' || event.type === 'window_focus') {
    if (properties.source === 'window_data_client_submit') {
      const dataKeys = Array.isArray(properties.dataKeys)
        ? properties.dataKeys.filter((key): key is string => typeof key === 'string')
        : [];
      const dataValueFingerprints = (
        typeof properties.dataValueFingerprints === 'object'
        && properties.dataValueFingerprints !== null
        && !Array.isArray(properties.dataValueFingerprints)
      )
        ? properties.dataValueFingerprints as Record<string, unknown>
        : null;
      const sortedDataKeys = [...dataKeys].sort();
      const dataKeysOk = dataKeys.length > 0
        && dataKeys.every((key, index) => key === sortedDataKeys[index] && hasString(key));
      const fingerprintKeys = dataValueFingerprints ? Object.keys(dataValueFingerprints).sort() : [];
      const fingerprintsOk = dataValueFingerprints !== null
        && fingerprintKeys.length === dataKeys.length
        && fingerprintKeys.every((key, index) => (
          key === dataKeys[index]
          && typeof dataValueFingerprints[key] === 'string'
          && WINDOW_DATA_FINGERPRINT_RE.test(dataValueFingerprints[key])
        ));
      const sourceOk = event.type === 'window_update'
        && properties.dataSource === 'win95_window_data_sync';
      const actionOk = typeof properties.action === 'string' && WINDOW_DATA_ACTIONS.has(properties.action);
      const actorOk = (event.actor === 'host' || event.actor === 'guest')
        && properties.actor === event.actor;
      const windowOk = hasString(properties.windowId)
        && event.text === `Window data updated: ${properties.windowId}`;
      const capturedAtMs = properties.capturedAtMs;
      const dataUpdateId = properties.windowDataUpdateId;
      const idOk = typeof dataUpdateId === 'string'
        && WINDOW_DATA_UPDATE_ID_RE.test(dataUpdateId)
        && typeof capturedAtMs === 'number'
        && Number.isInteger(capturedAtMs)
        && capturedAtMs >= 0
        && dataUpdateId === `window-data:${event.actor}:${capturedAtMs}:${properties.windowId}:${properties.action}`;
      const contextOk = hasRoomSurface(properties.surface)
        && hasString(properties.roomPhase)
        && typeof properties.durableObjectReplayExpected === 'boolean';
      if (
        sourceOk
        && actionOk
        && actorOk
        && windowOk
        && idOk
        && dataKeysOk
        && fingerprintsOk
        && contextOk
      ) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Window data evidence must include the client source, actor, stable event id, timestamp, data keys, value fingerprints, surface, and room phase.',
        path: ['properties'],
      });
      return;
    }
    const statePatch = properties.statePatch;
    const statePatchRecord = typeof statePatch === 'object' && statePatch !== null && !Array.isArray(statePatch)
      ? statePatch as Record<string, unknown>
      : null;
    const stateKeys = Array.isArray(properties.stateKeys)
      ? properties.stateKeys.filter((key): key is string => typeof key === 'string')
      : [];
    const patchEntries = statePatchRecord ? Object.entries(statePatchRecord) : [];
    const patchOk = patchEntries.length > 0
      && patchEntries.every(([key, value]) =>
        WINDOW_STATE_KEYS.has(key)
        && (typeof value === 'number' || typeof value === 'boolean')
        && (typeof value !== 'number' || Number.isFinite(value)),
      );
    const sortedPatchKeys = patchEntries.map(([key]) => key).sort();
    const stateKeysOk = stateKeys.length === sortedPatchKeys.length
      && stateKeys.every((key, index) => key === sortedPatchKeys[index]);
    const sourceOk = properties.source === 'window_state_client_submit'
      && properties.stateSource === 'win95_window_chrome';
    const actionOk = typeof properties.action === 'string' && WINDOW_STATE_ACTIONS.has(properties.action);
    const actorOk = (event.actor === 'host' || event.actor === 'guest')
      && properties.actor === event.actor;
    const windowOk = hasString(properties.windowId)
      && event.text === `Window state updated: ${properties.windowId}`;
    const capturedAtMs = properties.capturedAtMs;
    const stateChangeId = properties.windowStateChangeId;
    const idOk = typeof stateChangeId === 'string'
      && WINDOW_STATE_CHANGE_ID_RE.test(stateChangeId)
      && typeof capturedAtMs === 'number'
      && Number.isInteger(capturedAtMs)
      && capturedAtMs >= 0
      && stateChangeId === `window-state:${event.actor}:${capturedAtMs}:${properties.windowId}:${properties.action}`;
    const contextOk = hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && typeof properties.durableObjectReplayExpected === 'boolean';
    if (sourceOk && actionOk && actorOk && windowOk && idOk && contextOk && patchOk && stateKeysOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Window state evidence must include the client source, actor, stable event id, timestamp, action, exact state patch, surface, and room phase.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'room_surface_change') {
    const sourceOk = properties.source === 'room_surface_control';
    const actorOk = (event.actor === 'host' || event.actor === 'guest')
      && properties.actor === event.actor;
    const eventSourceOk = properties.surfaceControlEventSource === 'browser_room_surface_toggle';
    const surfacesOk = hasRoomSurface(properties.surface)
      && hasRoomSurface(properties.previousSurface)
      && properties.surface !== properties.previousSurface;
    const expectedAction = properties.surface === 'win95' ? 'enter_desktop' : 'exit_desktop';
    const actionOk = properties.action === expectedAction;
    const roomPhaseOk = hasString(properties.roomPhase);
    const capturedAtMs = properties.capturedAtMs;
    const surfaceChangeId = properties.surfaceChangeId;
    const idOk = typeof surfaceChangeId === 'string'
      && SURFACE_CHANGE_ID_RE.test(surfaceChangeId)
      && typeof capturedAtMs === 'number'
      && Number.isInteger(capturedAtMs)
      && capturedAtMs >= 0
      && surfaceChangeId === `surface:${event.actor}:${capturedAtMs}:${properties.previousSurface}:${properties.surface}`;
    const replayOk = properties.durableObjectReplayExpected === true;
    if (sourceOk && actorOk && eventSourceOk && surfacesOk && actionOk && roomPhaseOk && idOk && replayOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Room surface evidence must come from a browser room surface toggle with actor, previous/next surface, stable event id, timestamp, action, replay expectation, and room phase.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'participant_join' || event.type === 'participant_leave') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Participant lifecycle evidence must be captured by the meeting-room lifecycle route, not direct session-event submission.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'workspace_state') {
    const sourceOk = properties.source === 'workspace_state_client_submit'
      && properties.workspaceEventSource === 'browser_workspace_state_observer';
    const actorOk = (event.actor === 'host' || event.actor === 'guest')
      && propertyActorMatches;
    const statusOk = hasString(properties.workspaceStatus);
    const stateSourceOk = typeof properties.workspaceStateSource === 'string'
      && WORKSPACE_STATE_SOURCES.has(properties.workspaceStateSource);
    const sessionOk = properties.workspaceStatus === 'ERROR'
      ? (
          properties.workspaceSessionId === null
          || properties.workspaceSessionId === undefined
          || hasString(properties.workspaceSessionId)
        )
      : hasString(properties.workspaceSessionId);
    const challengeOk = (properties.githubPrNumber === null || properties.githubPrNumber === undefined || hasFiniteNonNegativeNumber(properties.githubPrNumber))
      && (properties.matchedRepoId === null || properties.matchedRepoId === undefined || hasFiniteNonNegativeNumber(properties.matchedRepoId))
      && (properties.challengeStatus === null || properties.challengeStatus === undefined || hasString(properties.challengeStatus))
      && (properties.challengeKind === null || properties.challengeKind === undefined || hasString(properties.challengeKind))
      && (properties.challengeSource === null || properties.challengeSource === undefined || hasString(properties.challengeSource))
      && (properties.challengeMessage === null || properties.challengeMessage === undefined || hasString(properties.challengeMessage));
    const lifecycleOk = properties.workspaceTelemetryPersisted === true
      && properties.proxyUrlPersisted === false;
    if (sourceOk && actorOk && statusOk && stateSourceOk && sessionOk && challengeOk && lifecycleOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Workspace-state evidence must come from the browser workspace observer with workspace source, status/session context, challenge diagnostics, and no persisted proxy URL.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'clippy_prompt') {
    const promptCreatedAt = properties.promptCreatedAt;
    const sourceOk = properties.source === 'clippy_prompt_client_submit'
      && typeof properties.promptEventSource === 'string'
      && CLIPPY_PROMPT_EVENT_SOURCES.has(properties.promptEventSource);
    const actorOk = (event.actor === 'host' || event.actor === 'agent')
      && (properties.actor === undefined || properties.actor === event.actor);
    const promptOk = hasString(properties.promptId)
      && hasString(properties.clientId)
      && typeof promptCreatedAt === 'number'
      && Number.isFinite(promptCreatedAt)
      && promptCreatedAt >= 0
      && typeof properties.promptLength === 'number'
      && properties.promptLength === event.text.length
      && hasString(properties.promptTrigger)
      && hasString(properties.promptSource);
    const browserPromptOk = properties.promptEventSource === 'browser_proactive_clippy_prompt'
      && event.actor === 'host'
      && properties.agentResponseClaimed === false
      && hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase);
    const agentPromptOk = properties.promptEventSource === 'clippy_agent_bridge'
      && event.actor === 'agent'
      && properties.bridgeEventType === 'CLIPPY_PROMPT'
      && hasString(properties.observedAt)
      && typeof properties.bridgePersisted === 'boolean';
    if (sourceOk && actorOk && promptOk && (browserPromptOk || agentPromptOk)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Clippy prompt evidence must come from the browser proactive prompt flow or real agent bridge with prompt identity, trigger, length, source, and room context.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'clippy_action') {
    const source = properties.source;
    const actionIdOk = hasString(properties.actionId);
    const surfaceContextOk = hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase);
    if (typeof source === 'string' && CLIPPY_UI_SOURCES.has(source)) {
      const originOk = source === 'clippy_tray_ui'
        ? properties.origin === 'tray' && properties.actionSource === 'win95_taskbar_tray'
        : properties.origin === 'prompt' && properties.actionSource === 'clippy_prompt_ui';
      const actorOk = (event.actor === 'host' || event.actor === 'guest')
        && properties.executedBy === event.actor;
      const statusOk = typeof properties.executionStatus === 'string'
        && CLIPPY_UI_EXECUTION_STATUSES.has(properties.executionStatus);
      const noFakeAgentOk = properties.agentResponseClaimed === false;
      if (actionIdOk && surfaceContextOk && originOk && actorOk && statusOk && noFakeAgentOk) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Clippy UI action evidence must come from tray or prompt UI with actor, action source, execution status, surface, and no claimed agent response.',
        path: ['properties'],
      });
      return;
    }
    if (source === 'clippy_agent_bridge') {
      const commonOk = actionIdOk
        && properties.origin === 'agent'
        && hasString(properties.actionSource)
        && hasString(properties.agent)
        && hasString(properties.actionProtocol)
        && properties.bridgeEventType === 'ROOM_ACTION';
      const suggestedOk = event.actor === 'agent'
        && properties.executionStatus === 'suggested'
        && hasString(properties.observedAt)
        && typeof properties.bridgePersisted === 'boolean';
      const executedOk = (event.actor === 'host' || event.actor === 'guest')
        && properties.executionStatus === 'executed'
        && properties.executedBy === event.actor
        && hasString(properties.agentActionObservedAt)
        && typeof properties.agentActionBridgePersisted === 'boolean'
        && surfaceContextOk
        && properties.agentResponseClaimed === false;
      if (commonOk && (suggestedOk || executedOk)) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Clippy agent action evidence must come from the real bridge with ROOM_ACTION metadata and either a suggested agent event or a browser execution linked to that bridge event.',
        path: ['properties'],
      });
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Clippy action evidence must come from a recognized Clippy UI or agent bridge source.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'ai_chat_user') {
    const promptTimestamp = properties.promptTimestamp;
    const promptFingerprint = properties.promptFingerprint;
    const workspaceSessionId = properties.workspaceSessionId;
    const promptId = properties.promptId;
    const actorOk = (event.actor === 'host' || event.actor === 'guest')
      && propertyActorMatches;
    const sourceOk = properties.source === 'clippy_agent_chat_client_submit'
      && properties.agentChatEventSource === 'browser_clippy_chat_window';
    const bridgeOk = properties.bridgeMessageType === 'CHAT'
      && properties.bridgeProtocol === 'clippy_dev_container_ws'
      && properties.deliveredToAgentBridge === true
      && properties.agentResponseClaimed === false;
    const promptOk = typeof promptTimestamp === 'number'
      && Number.isFinite(promptTimestamp)
      && promptTimestamp >= 0
      && typeof promptFingerprint === 'string'
      && CLIPPY_PROMPT_FINGERPRINT_RE.test(promptFingerprint)
      && typeof properties.promptLength === 'number'
      && properties.promptLength === event.text.length
      && typeof promptId === 'string'
      && typeof workspaceSessionId === 'string'
      && promptId === `${workspaceSessionId}:${event.actor}:prompt:${promptTimestamp}:${promptFingerprint}`;
    const contextOk = hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && hasString(properties.workspaceStatus)
      && hasString(workspaceSessionId)
      && (properties.repoUrl === null || properties.repoUrl === undefined || hasString(properties.repoUrl));
    if (actorOk && sourceOk && bridgeOk && promptOk && contextOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Clippy user chat evidence must come from the browser Clippy chat window and include a delivered bridge CHAT prompt id, fingerprint, length, and workspace context.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'terminal_command') {
    const commandSequence = properties.terminalCommandSequence;
    const commandLength = properties.commandLength;
    const fingerprint = properties.commandFingerprint;
    const sessionId = properties.terminalSessionId;
    const commandId = properties.terminalCommandId;
    const sourceOk = properties.source === 'container_terminal'
      && properties.terminalEventSource === 'browser_terminal_ws';
    const actorOk = event.actor === 'host' || event.actor === 'guest';
    const sequenceOk = typeof commandSequence === 'number'
      && Number.isInteger(commandSequence)
      && commandSequence > 0;
    const commandLengthOk = typeof commandLength === 'number'
      && commandLength === event.text.length;
    const fingerprintOk = typeof fingerprint === 'string'
      && TERMINAL_FINGERPRINT_RE.test(fingerprint);
    const idsOk = hasString(sessionId)
      && typeof commandId === 'string'
      && typeof commandSequence === 'number'
      && typeof fingerprint === 'string'
      && commandId === `${sessionId}:command:${commandSequence}:${fingerprint}`;
    const contextOk = hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && hasString(properties.workspaceStatus)
      && hasString(properties.workspaceSessionId)
      && (properties.repoUrl === null || properties.repoUrl === undefined || hasString(properties.repoUrl));
    if (sourceOk && actorOk && sequenceOk && commandLengthOk && fingerprintOk && idsOk && contextOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Terminal command evidence must come from the browser terminal WebSocket with command id, sequence, fingerprint, length, workspace context, and participant actor.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'terminal_output') {
    const outputSequence = properties.terminalOutputSequence;
    const outputLength = properties.outputLength;
    const fingerprint = properties.outputFingerprint;
    const sessionId = properties.terminalSessionId;
    const outputChunkId = properties.terminalOutputChunkId;
    const commandId = properties.terminalCommandId;
    const sourceOk = properties.source === 'container_terminal'
      && properties.terminalEventSource === 'browser_terminal_ws';
    const actorOk = event.actor === 'system';
    const sequenceOk = typeof outputSequence === 'number'
      && Number.isInteger(outputSequence)
      && outputSequence > 0;
    const outputLengthOk = typeof outputLength === 'number'
      && outputLength === event.text.length;
    const fingerprintOk = typeof fingerprint === 'string'
      && TERMINAL_FINGERPRINT_RE.test(fingerprint);
    const idsOk = hasString(sessionId)
      && typeof outputChunkId === 'string'
      && typeof outputSequence === 'number'
      && typeof fingerprint === 'string'
      && outputChunkId === `${sessionId}:output:${outputSequence}:${fingerprint}`
      && (commandId === null || (typeof commandId === 'string' && commandId.startsWith(`${sessionId}:command:`)));
    const contextOk = hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && hasString(properties.workspaceStatus)
      && hasString(properties.workspaceSessionId)
      && (properties.repoUrl === null || properties.repoUrl === undefined || hasString(properties.repoUrl));
    if (sourceOk && actorOk && sequenceOk && outputLengthOk && fingerprintOk && idsOk && contextOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Terminal output evidence must come from the browser terminal WebSocket with output id, sequence, fingerprint, bounded length, workspace context, and system actor.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'ai_agent_status') {
    const bridgeMessageSource = properties.bridgeMessageSource;
    const status = properties.status;
    const statusOk = status === null
      || status === undefined
      || (typeof status === 'string' && AGENT_STATUSES.has(status));
    const sourceOk = properties.source === 'clippy_agent_bridge';
    const actorOk = event.actor === 'agent';
    const agentOk = hasString(properties.agent);
    const observedOk = hasString(properties.observedAt);
    const bridgeMessageOk = typeof bridgeMessageSource === 'string'
      && AGENT_STATUS_MESSAGE_SOURCES.has(bridgeMessageSource);
    const browserObservationOk = properties.agentStatusEventSource === 'browser_clippy_agent_ws'
      && hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && hasFiniteNonNegativeNumber(properties.messageTimestamp)
      && properties.agentResponseClaimed === false
      && (
        (bridgeMessageSource === 'agent_status' && typeof status === 'string' && AGENT_STATUSES.has(status))
        || (bridgeMessageSource !== 'agent_status' && hasString(properties.diagnosticSource))
      );
    const persistedDiagnosticOk = bridgeMessageSource === 'bridge_diagnostic'
      && properties.bridgePersisted === true
      && hasString(properties.diagnosticSource);
    if (
      sourceOk
      && actorOk
      && agentOk
      && statusOk
      && observedOk
      && bridgeMessageOk
      && (browserObservationOk || persistedDiagnosticOk)
    ) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Agent status evidence must come from the Clippy/Devin bridge with observed status or persisted diagnostic provenance.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'ai_chat_agent') {
    const sourceOk = properties.source === 'clippy_agent_bridge';
    const actorOk = event.actor === 'agent';
    const agentOk = hasString(properties.agent);
    const chatResponseOk = properties.bridgeEventType === 'CHAT_RESPONSE'
      && properties.bridgeMessageSource === 'agent_stdout';
    const observedAt = properties.observedAt;
    const hasObservedAt = typeof observedAt === 'string' && observedAt.trim().length > 0;
    const persistedOk = properties.bridgePersisted === true
      && hasFiniteNonNegativeNumber(properties.actionCount);
    const browserFallbackOk = properties.bridgePersisted === false
      && properties.persistenceFallback === 'browser_after_bridge_persist_failed'
      && hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && hasFiniteNonNegativeNumber(properties.messageTimestamp)
      && properties.agentResponseClaimed === true;
    if (sourceOk && actorOk && agentOk && chatResponseOk && hasObservedAt && (persistedOk || browserFallbackOk)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Agent chat evidence must come from a real Clippy/Devin bridge CHAT_RESPONSE with persisted bridge or browser fallback provenance.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'cursor_presence') {
    const sourceOk = properties.source === 'win95_cursor_presence_client_sample';
    const actorOk = (event.actor === 'host' || event.actor === 'guest')
      && properties.actor === event.actor;
    const eventSourceOk = properties.cursorEventSource === 'browser_win95_desktop_pointermove';
    const contextOk = properties.surface === 'win95' && hasString(properties.roomPhase);
    const x = properties.normalizedX;
    const y = properties.normalizedY;
    const previousX = properties.previousNormalizedX;
    const previousY = properties.previousNormalizedY;
    const distance = properties.distanceFromPrevious;
    const xOk = typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
    const yOk = typeof y === 'number' && Number.isFinite(y) && y >= 0 && y <= 1;
    const previousXOk = previousX === null || (
      typeof previousX === 'number' && Number.isFinite(previousX) && previousX >= 0 && previousX <= 1
    );
    const previousYOk = previousY === null || (
      typeof previousY === 'number' && Number.isFinite(previousY) && previousY >= 0 && previousY <= 1
    );
    const distanceOk = distance === null || hasFiniteNonNegativeNumber(distance);
    const samplingOk = properties.evidenceSampling === 'presence_sample'
      && properties.sampleIntervalMs === CURSOR_PRESENCE_SAMPLE_INTERVAL_MS
      && properties.movementThreshold === CURSOR_PRESENCE_MOVEMENT_THRESHOLD
      && properties.rawCursorMovesPersisted === false;
    const sampleId = properties.cursorSampleId;
    const sampledAtMs = properties.sampledAtMs;
    const sampleIdOk = typeof sampleId === 'string'
      && CURSOR_SAMPLE_ID_RE.test(sampleId)
      && typeof sampledAtMs === 'number'
      && Number.isInteger(sampledAtMs)
      && sampleId.startsWith(`cursor:${event.actor}:${sampledAtMs}:`);
    if (
      sourceOk
      && actorOk
      && eventSourceOk
      && contextOk
      && xOk
      && yOk
      && previousXOk
      && previousYOk
      && distanceOk
      && samplingOk
      && sampleIdOk
    ) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Cursor presence evidence must be an actor-bound sampled Win95 browser cursor event with stable sample provenance.',
      path: ['properties'],
    });
  }
  if (event.type === 'media_control') {
    const sourceOk = properties.source === 'video_room_media_controls';
    const actorOk = (event.actor === 'host' || event.actor === 'guest')
      && properties.actor === event.actor;
    const eventSourceOk = properties.mediaControlEventSource === 'browser_video_control_button';
    const controlOk = properties.control === 'microphone' || properties.control === 'camera';
    const enabledOk = typeof properties.enabled === 'boolean';
    const previousEnabledOk = typeof properties.previousEnabled === 'boolean'
      && typeof properties.enabled === 'boolean'
      && properties.previousEnabled !== properties.enabled;
    const expectedAction = properties.enabled === true ? 'enabled' : 'disabled';
    const actionOk = properties.action === expectedAction && properties.controlAction === 'toggle';
    const expectedControlSurface = properties.surface === 'win95'
      ? 'win95_video_window'
      : 'standard_video_call';
    const contextOk = hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && properties.controlSurface === expectedControlSurface;
    const sourceDetailsOk = properties.mediaSource === 'local_media_stream'
      && properties.rawMediaStreamPersisted === false;
    const mediaControlId = properties.mediaControlId;
    const capturedAtMs = properties.capturedAtMs;
    const idOk = typeof mediaControlId === 'string'
      && MEDIA_CONTROL_ID_RE.test(mediaControlId)
      && typeof properties.control === 'string'
      && typeof capturedAtMs === 'number'
      && Number.isInteger(capturedAtMs)
      && capturedAtMs >= 0
      && mediaControlId === `media:${event.actor}:${properties.control}:${capturedAtMs}:${expectedAction}`;
    if (
      sourceOk
      && actorOk
      && eventSourceOk
      && controlOk
      && enabledOk
      && previousEnabledOk
      && actionOk
      && contextOk
      && sourceDetailsOk
      && idOk
    ) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Media control evidence must be an actor-bound browser control toggle with stable event provenance and previous/next state.',
      path: ['properties'],
    });
  }
  if (event.type === 'recording_start' || event.type === 'recording_stop') {
    const expectedLifecycleKind = event.type === 'recording_start' ? 'start' : 'stop';
    const sourceOk = properties.source === 'video_room_recording'
      && properties.recordingEventSource === 'browser_media_recorder';
    const actorOk = event.actor === 'host';
    const lifecycleOk = properties.recordingLifecycleKind === expectedLifecycleKind;
    const commonOk = typeof properties.hasTranscriptionAudio === 'boolean'
      && hasString(properties.iceProvider)
      && hasFiniteNonNegativeNumber(properties.speakerMetadataVersion)
      && hasString(properties.speakerChannelLayout)
      && hasFiniteNonNegativeNumber(properties.speakerChannelCount)
      && Array.isArray(properties.speakerChannels)
      && properties.speakerChannels.length === properties.speakerChannelCount;
    const stopOk = event.type === 'recording_start' || (
      properties.uploadStatus === 'attempting'
      && hasFiniteNonNegativeNumber(properties.recordingBytes)
      && (properties.recordingMimeType === null || hasString(properties.recordingMimeType))
      && hasFiniteNonNegativeNumber(properties.transcriptionBytes)
      && (properties.transcriptionMimeType === null || hasString(properties.transcriptionMimeType))
    );
    if (sourceOk && actorOk && lifecycleOk && commonOk && stopOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Recording lifecycle evidence must come from the host browser MediaRecorder with lifecycle kind, speaker-channel provenance, and upload source facts.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'code_editor_open') {
    const sourceOk = properties.source === 'code_server_workspace'
      && properties.editorEventSource === 'browser_code_server_iframe'
      && properties.editor === 'code-server'
      && properties.openStatus === 'loaded';
    const actorOk = (event.actor === 'host' || event.actor === 'guest')
      && propertyActorMatches;
    const contextOk = hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && hasString(properties.workspaceSessionId)
      && hasString(properties.workspaceStatus)
      && (properties.repoUrl === null || properties.repoUrl === undefined || hasString(properties.repoUrl));
    const challengeOk = (properties.githubPrNumber === null || properties.githubPrNumber === undefined || hasFiniteNonNegativeNumber(properties.githubPrNumber))
      && (properties.matchedRepoId === null || properties.matchedRepoId === undefined || hasFiniteNonNegativeNumber(properties.matchedRepoId))
      && (properties.challengeStatus === null || properties.challengeStatus === undefined || hasString(properties.challengeStatus))
      && (properties.challengeKind === null || properties.challengeKind === undefined || hasString(properties.challengeKind))
      && (properties.challengeSource === null || properties.challengeSource === undefined || hasString(properties.challengeSource))
      && (properties.challengeMessage === null || properties.challengeMessage === undefined || hasString(properties.challengeMessage));
    const noProxyLeakOk = properties.proxyUrlPersisted === false;
    if (sourceOk && actorOk && contextOk && challengeOk && noProxyLeakOk) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Code editor open evidence must come from the browser code-server iframe with workspace session context and no persisted proxy URL.',
      path: ['properties'],
    });
    return;
  }
  if (event.type === 'code_editor_save') {
    const sourceOk = properties.source === 'code_server_workspace';
    const observedBy = properties.observedBy;
    const observedByOk = observedBy === 'agent_bridge' || observedBy === 'clippy_agent_bridge';
    const bridgeOk = properties.bridgeEventType === 'FILE_CHANGED'
      && properties.editorSurface === 'code-server';
    const actionOk = typeof properties.action === 'string'
      && CODE_SERVER_SAVE_ACTIONS.has(properties.action);
    const pathValue = properties.path;
    const pathOk = typeof pathValue === 'string' && pathValue.trim().length > 0 && event.text === pathValue;
    const hashValue = properties.contentHash;
    const hashOk = typeof hashValue === 'string' && SHA256_HEX_RE.test(hashValue);
    const sizeOk = hasFiniteNonNegativeNumber(properties.sizeBytes);
    const observedAt = properties.observedAt;
    const observedAtOk = typeof observedAt === 'string' && observedAt.trim().length > 0;
    const directBridgeOk = properties.bridgePersisted === true
      && observedBy === 'agent_bridge'
      && hasString(properties.workspaceRoot);
    const browserFallbackOk = properties.bridgePersisted === false
      && observedBy === 'clippy_agent_bridge'
      && hasRoomSurface(properties.surface)
      && hasString(properties.roomPhase)
      && hasString(properties.workspaceStatus)
      && hasString(properties.workspaceSessionId)
      && (
        properties.repoUrl === null
        || properties.repoUrl === undefined
        || hasString(properties.repoUrl)
      );
    if (
      event.actor === 'system'
      && sourceOk
      && observedByOk
      && bridgeOk
      && actionOk
      && pathOk
      && hashOk
      && sizeOk
      && observedAtOk
      && (directBridgeOk || browserFallbackOk)
    ) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Code editor save evidence must come from a FILE_CHANGED code-server workspace bridge event with path, content hash, size, observation time, and direct or browser-fallback provenance.',
      path: ['properties'],
    });
  }
});

async function readJsonRequestBody(c: Context<{ Bindings: Env }>): Promise<unknown> {
  const text = await c.req.text().catch(() => null);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

interface RoomWorkspaceInterview {
  interview_type: string | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
  matched_repo_id: number | null;
}

type RoomWorkspaceChallengeStatus =
  | 'github_pr_assigned'
  | 'missing_reviewable_task'
  | 'not_configured';

type RoomWorkspaceChallengeKind = 'github_pr' | 'repo_only' | null;

type RoomWorkspaceChallengeSource =
  | 'scheduled_interview.github_pr_number'
  | 'matched_repo_without_pr'
  | 'scheduled_repo_without_pr'
  | 'missing_repo_and_task'
  | 'workspace_not_enabled';

interface RoomWorkspaceChallengePayload {
  status: RoomWorkspaceChallengeStatus;
  kind: RoomWorkspaceChallengeKind;
  source: RoomWorkspaceChallengeSource;
  message: string | null;
}

async function syncRoomActivityEvidenceForToken(
  c: Context<{ Bindings: Env }>,
  token: string,
): Promise<RoomActivityEvidenceSyncResult | null> {
  if (!c.env.VIDEO_ROOM) return null;

  try {
    const {
      resolveCandidateIdForRoom,
      syncRoomActivityToSessionEvents,
    } = await import('../lib/sessionEvents.js');
    const resolved = await resolveCandidateIdForRoom(c.env.DB, token);
    if (!resolved?.candidateId) return null;
    return await syncRoomActivityToSessionEvents(c.env.DB, c.env, {
      candidateId: resolved.candidateId,
      sessionId: resolved.sessionId,
    });
  } catch (error) {
    console.error('[meetingRooms] Failed to sync room activity evidence:', {
      tokenHashPrefix: (await hashRoomToken(token)).slice(0, 12),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function roomLifecycleEvidencePayload(
  room: ResolvedRoom,
  event: z.infer<typeof roomEventSchema>['event'],
  options: { recordingWasActive: boolean; observedAt: string; timestamp: number },
): { type: SessionEventType; text: string; properties: Record<string, unknown> } | null {
  const roleLabel = room.role === 'GUEST' ? 'Guest' : 'Host';
  const sharedProperties = {
    source: 'meeting_room_lifecycle',
    roomLifecycleEventSource: 'meeting_room_event_route',
    lifecycleEvent: event,
    participantRole: room.role,
    roomId: room.room_id,
    meetingId: room.meeting_id,
    roomLifecycleObservedAt: options.observedAt,
    roomLifecycleTimestamp: options.timestamp,
  };

  if (event === 'JOINED') {
    return {
      type: 'participant_join',
      text: `${roleLabel} joined the 95 Until Infinity room`,
      properties: sharedProperties,
    };
  }
  if (event === 'LEFT') {
    return {
      type: 'participant_leave',
      text: `${roleLabel} left the 95 Until Infinity room`,
      properties: sharedProperties,
    };
  }
  if (event === 'RECORDING_STARTED' && room.role === 'HOST') {
    return {
      type: 'recording_start',
      text: 'Recording started for the 95 Until Infinity room',
      properties: {
        ...sharedProperties,
        recordingStatus: 'started',
      },
    };
  }
  if (event === 'ENDED' && room.role === 'HOST' && options.recordingWasActive) {
    return {
      type: 'recording_stop',
      text: 'Recording stopped for the 95 Until Infinity room',
      properties: {
        ...sharedProperties,
        recordingStatus: 'stopped',
      },
    };
  }

  return null;
}

async function captureRoomLifecycleEvidenceForToken(
  c: Context<{ Bindings: Env }>,
  token: string,
  room: ResolvedRoom,
  event: z.infer<typeof roomEventSchema>['event'],
  timestamp: number,
  options: { recordingWasActive: boolean; observedAt: string },
): Promise<RoomLifecycleEvidenceCaptureResult | null> {
  if (!c.env.VIDEO_ROOM) return null;

  const payload = roomLifecycleEvidencePayload(room, event, {
    ...options,
    timestamp,
  });
  if (!payload) return null;

  try {
    const { resolveCandidateIdForRoom, captureSessionEvent } = await import('../lib/sessionEvents.js');
    const resolved = await resolveCandidateIdForRoom(c.env.DB, token);
    if (!resolved?.candidateId) return null;
    const node = await captureSessionEvent(c.env.DB, {
      type: payload.type,
      sessionId: resolved.sessionId,
      candidateId: resolved.candidateId,
      timestamp,
      actor: room.role === 'GUEST' ? 'guest' : 'host',
      text: payload.text,
      properties: payload.properties,
    }, c.env);
    return {
      captured: !!node,
      nodeId: node?.id ?? null,
      type: payload.type,
    };
  } catch (error) {
    console.error('[meetingRooms] Failed to capture room lifecycle evidence:', {
      tokenHashPrefix: (await hashRoomToken(token)).slice(0, 12),
      event,
      role: room.role,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function meetingHasActiveRecordingEvidence(db: D1Database, meetingId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT transcript_status, recording_r2_key
       FROM meetings
      WHERE id = ?`,
  ).bind(meetingId).first<{ transcript_status: string | null; recording_r2_key: string | null }>();
  return row?.transcript_status === 'RECORDING' || !!row?.recording_r2_key;
}

interface RoomWorkspacePayload {
  enabled: boolean;
  canLaunch: boolean;
  repoUrl: string | null;
  githubPrNumber: number | null;
  matchedRepoId: number | null;
  challenge: RoomWorkspaceChallengePayload;
  session: {
    sessionId: string;
    status: string;
    ttlSeconds: number;
    ttlSource: string;
    expiresAt: string;
    warnedAt: string | null;
    expiringSoon: boolean;
    proxyPath: string | null;
    errorMessage: string | null;
  } | null;
}

interface RecordingProcessingOverrides {
  structuredTranscription?: StructuredTranscription | null;
  analysisJson?: string | null;
  speakerMetadata?: RecordingSpeakerMetadata | null;
}

const recordingSpeakerChannelSchema = z.object({
  channel: z.number().int().min(0).max(7),
  role: z.enum(['host', 'guest']),
  source: z.enum(['local', 'remote']),
}).strict();

const recordingSpeakerMetadataSchema = z.object({
  version: z.literal(1),
  transcriptionAudio: z.object({
    channelLayout: z.string().min(1).max(120),
    channelCount: z.number().int().min(1).max(8),
    channels: z.array(recordingSpeakerChannelSchema).min(1).max(8),
  }).strict(),
}).strict().superRefine((metadata, ctx) => {
  const channels = new Set<number>();
  const roles = new Set<string>();
  for (const [index, channel] of metadata.transcriptionAudio.channels.entries()) {
    if (channels.has(channel.channel)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate transcription audio channel ${channel.channel}.`,
        path: ['transcriptionAudio', 'channels', index, 'channel'],
      });
    }
    channels.add(channel.channel);
    roles.add(channel.role);
    if (channel.channel >= metadata.transcriptionAudio.channelCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Channel index must be lower than channelCount.',
        path: ['transcriptionAudio', 'channels', index, 'channel'],
      });
    }
  }
  if (!roles.has('host') || !roles.has('guest')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Speaker metadata must map both host and guest audio channels.',
      path: ['transcriptionAudio', 'channels'],
    });
  }
});

type RecordingSpeakerMetadata = z.infer<typeof recordingSpeakerMetadataSchema>;
type RecordingSpeakerChannel = z.infer<typeof recordingSpeakerChannelSchema>;

function defaultRecordingSpeakerMetadata(): RecordingSpeakerMetadata {
  return {
    version: 1,
    transcriptionAudio: {
      channelLayout: 'host-local-guest-remote-v1',
      channelCount: 2,
      channels: [
        { channel: 0, role: 'host', source: 'local' },
        { channel: 1, role: 'guest', source: 'remote' },
      ],
    },
  };
}

function parseRecordingSpeakerMetadata(
  value: unknown,
): { ok: true; metadata: RecordingSpeakerMetadata } | { ok: false; message: string } {
  const parsed = recordingSpeakerMetadataSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid speaker metadata.' };
  }
  return { ok: true, metadata: parsed.data };
}

function parseRecordingSpeakerMetadataJson(
  value: string,
): { ok: true; metadata: RecordingSpeakerMetadata } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, message: 'Speaker metadata must be JSON.' };
  }
  return parseRecordingSpeakerMetadata(parsed);
}

function speakerMetadataJsonObject(metadata: RecordingSpeakerMetadata): JsonObject {
  return metadata as unknown as JsonObject;
}

function speakerMetadataFromCustomMetadata(
  customMetadata: Record<string, string> | undefined,
): RecordingSpeakerMetadata | null {
  const raw = customMetadata?.speakerMetadata;
  if (!raw) return null;
  const parsed = parseRecordingSpeakerMetadataJson(raw);
  return parsed.ok ? parsed.metadata : null;
}

function speakerMetadataCustomMetadata(
  metadata: RecordingSpeakerMetadata,
): Record<string, string> {
  return {
    speakerMetadata: JSON.stringify(metadata),
    speakerMetadataVersion: String(metadata.version),
    speakerChannelLayout: metadata.transcriptionAudio.channelLayout,
  };
}

function speakerChannelsByChannel(
  metadata: RecordingSpeakerMetadata,
): Map<number, RecordingSpeakerChannel> {
  return new Map(
    metadata.transcriptionAudio.channels.map((channel) => [channel.channel, channel]),
  );
}

const evidenceLevelSchema = z.enum([
  'mentioned',
  'used',
  'explained',
  'selected',
  'implemented',
  'demonstrated',
  'validated',
]);

const semanticAssertionSchema = z.object({
  sourceSegmentIds: z.array(z.string().min(1)).min(1),
  subjectSegmentId: z.string().min(1),
  predicate: z.string().min(1),
  narrative: z.string().min(1),
  objectType: z.string().min(1).nullable().optional(),
  objectValue: z.unknown().optional(),
  qualifiers: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  polarity: z.number().min(-1).max(1).nullable().optional(),
  concepts: z.array(z.object({
    surface: z.string().min(1),
    relationship: z.string().min(1),
    weight: z.number().min(0).max(1),
    evidenceLevel: evidenceLevelSchema.nullable().optional(),
    strength: z.number().min(0).max(1).nullable().optional(),
  })).optional(),
});

function extractAiText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.response === 'string') return record.response;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0];
  if (!first || typeof first !== 'object') return '';
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return '';
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' ? content : '';
}

function isLocalOrTestRequest(env: Env, requestUrl: string): boolean {
  if (env.ENV === 'test') return true;
  const url = new URL(requestUrl);
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  const appBase = env.APP_BASE_URL ?? '';
  const localApp = appBase.startsWith('http://localhost:') || appBase.startsWith('http://127.0.0.1:');
  return localHost && localApp;
}

function headerByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parseAnalysis(
  text: string,
  transcript: string,
  segments: MeetingTranscriptSegmentInput[],
): MeetingAnalysis {
  const segmentById = new Map(
    segments.flatMap((segment) => segment.stableSegmentId
      ? [[segment.stableSegmentId, segment] as const]
      : []),
  );
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Partial<MeetingAnalysis> & {
        semanticAssertions?: unknown[];
      };
      const semanticAssertions = (Array.isArray(parsed.semanticAssertions)
        ? parsed.semanticAssertions
        : []).flatMap((candidate) => {
          const result = semanticAssertionSchema.safeParse(candidate);
          if (!result.success) return [];
          const sourceSegmentIds = [...new Set(result.data.sourceSegmentIds)]
            .filter((segmentId) => segmentById.has(segmentId));
          if (
            sourceSegmentIds.length === 0
            || !sourceSegmentIds.includes(result.data.subjectSegmentId)
          ) {
            return [];
          }
          const sourceText = sourceSegmentIds
            .map((segmentId) => segmentById.get(segmentId)?.text ?? '')
            .join('\n')
            .toLocaleLowerCase();
          return [{
            ...result.data,
            sourceSegmentIds,
            qualifiers: result.data.qualifiers as MeetingTranscriptAssertionInput['qualifiers'],
            objectValue: result.data.objectValue as MeetingTranscriptAssertionInput['objectValue'],
            concepts: (result.data.concepts ?? []).filter((concept) =>
              sourceText.includes(concept.surface.trim().toLocaleLowerCase())
            ),
          } satisfies MeetingTranscriptAssertionInput];
        });
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : transcript.slice(0, 500),
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions.filter((v): v is string => typeof v === 'string') : [],
        actionItems: Array.isArray(parsed.actionItems)
          ? parsed.actionItems
              .filter((v): v is MeetingAnalysis['actionItems'][number] => (
                Boolean(v) && typeof v === 'object' && typeof v.text === 'string'
              ))
              .map((item) => ({
                text: item.text,
                owner: typeof item.owner === 'string' ? item.owner : null,
                dueDate: typeof item.dueDate === 'string' ? item.dueDate : null,
              }))
          : [],
        topics: Array.isArray(parsed.topics) ? parsed.topics.filter((v): v is string => typeof v === 'string') : [],
        followUps: Array.isArray(parsed.followUps) ? parsed.followUps.filter((v): v is string => typeof v === 'string') : [],
        semanticAssertions,
      };
    } catch {
      // Fall through to a transcript-only artifact.
    }
  }
  return {
    summary: transcript.slice(0, 500),
    decisions: [],
    actionItems: [],
    topics: [],
    followUps: [],
    semanticAssertions: [],
  };
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function workspaceProxyPath(token: string, sessionId: string): string {
  return `/api/v1/meeting-rooms/${encodeURIComponent(token)}/workspace/proxy/${encodeURIComponent(sessionId)}/`;
}

function githubPrChallengeRef(githubPrNumber: number | null): string | null {
  if (!Number.isInteger(githubPrNumber) || (githubPrNumber ?? 0) <= 0) return null;
  return `refs/pull/${githubPrNumber}/head`;
}

function buildRoomWorkspaceChallenge(
  interview: RoomWorkspaceInterview | null,
  enabled: boolean,
): RoomWorkspaceChallengePayload {
  if (!enabled) {
    return {
      status: 'not_configured',
      kind: null,
      source: 'workspace_not_enabled',
      message: null,
    };
  }
  if (Number.isInteger(interview?.github_pr_number) && (interview?.github_pr_number ?? 0) > 0) {
    return {
      status: 'github_pr_assigned',
      kind: 'github_pr',
      source: 'scheduled_interview.github_pr_number',
      message: null,
    };
  }
  if (interview?.matched_repo_id) {
    return {
      status: 'missing_reviewable_task',
      kind: 'repo_only',
      source: 'matched_repo_without_pr',
      message: 'Matched repository is available, but no GitHub PR or task was assigned. Treat this as an assessment setup gap, not candidate evidence.',
    };
  }
  if (interview?.github_repo_url) {
    return {
      status: 'missing_reviewable_task',
      kind: 'repo_only',
      source: 'scheduled_repo_without_pr',
      message: 'Repository workspace is available, but no GitHub PR or task was assigned. Treat this as an assessment setup gap, not candidate evidence.',
    };
  }
  return {
    status: 'missing_reviewable_task',
    kind: null,
    source: 'missing_repo_and_task',
    message: 'This workspace interview has no repository, GitHub PR, or task assigned yet. Treat this as an assessment setup gap, not candidate evidence.',
  };
}

function serializeWorkspaceSession(
  token: string,
  session: DevContainerSessionRow | null,
): RoomWorkspacePayload['session'] {
  if (!session) return null;
  return {
    sessionId: session.session_id,
    status: session.status,
    ttlSeconds: session.ttl_seconds,
    ttlSource: session.ttl_source,
    expiresAt: session.expires_at,
    warnedAt: session.warned_at,
    expiringSoon: session.warned_at !== null,
    proxyPath: WORKSPACE_PROXY_ALLOWED_STATUS.has(session.status)
      ? workspaceProxyPath(token, session.session_id)
      : null,
    errorMessage: session.error_message,
  };
}

async function loadRoomWorkspaceInterview(
  db: D1Database,
  room: ResolvedRoom,
): Promise<RoomWorkspaceInterview | null> {
  if (!room.scheduled_interview_id) return null;
  const interview = await db.prepare(
    `SELECT si.interview_type,
            si.github_repo_url,
            si.github_pr_number,
            si.matched_repo_id
       FROM scheduled_interviews si
      WHERE si.id = ?`,
  ).bind(room.scheduled_interview_id).first<RoomWorkspaceInterview>().catch(() => null);
  if (!interview || interview.github_repo_url || !interview.matched_repo_id) return interview;

  const repo = await db.prepare(
    `SELECT github_url FROM qualified_repos WHERE id = ?`,
  ).bind(interview.matched_repo_id).first<{ github_url: string }>().catch(() => null);
  return {
    ...interview,
    github_repo_url: repo?.github_url ?? null,
  };
}

async function buildRoomWorkspacePayload(
  db: D1Database,
  token: string,
  room: ResolvedRoom,
): Promise<RoomWorkspacePayload> {
  const interview = await loadRoomWorkspaceInterview(db, room);
  const enabled = Boolean(
    interview?.interview_type && WORKSPACE_INTERVIEW_TYPES.has(interview.interview_type),
  );
  const session = await getLatestSessionForRoom(db, room.room_id).catch(() => null);
  const repoUrl = interview?.github_repo_url ?? session?.repo_git_url ?? null;
  return {
    enabled,
    canLaunch: enabled && room.role === 'HOST',
    repoUrl,
    githubPrNumber: interview?.github_pr_number ?? null,
    matchedRepoId: interview?.matched_repo_id ?? null,
    challenge: buildRoomWorkspaceChallenge(interview, enabled),
    session: serializeWorkspaceSession(token, session),
  };
}

function initialRoomSurfaceForWorkspace(workspace: RoomWorkspacePayload): 'standard' | 'win95' {
  return workspace.enabled ? 'win95' : 'standard';
}

async function resolveRoom(db: D1Database, token: string): Promise<ResolvedRoom | null> {
  const tokenHash = await hashRoomToken(token);
  const now = new Date().toISOString();
  return db.prepare(
    `SELECT mr.id AS room_id, mr.meeting_id, mr.session_id,
            mr.status AS room_status, mrt.role,
            m.owner_id, m.title, m.description, m.scheduled_at,
            m.meeting_type, m.status AS meeting_status,
            m.started_at, m.ended_at, m.scheduled_interview_id,
            m.video_enabled, m.workspace_enabled, m.recording_enabled, m.clippy_enabled,
            (
              SELECT mp.contact_id
                FROM meeting_room_tokens guest_token
                JOIN meeting_participants mp
                  ON mp.id = guest_token.participant_id
               WHERE guest_token.room_id = mr.id
                 AND guest_token.role = 'GUEST'
                 AND guest_token.participant_id IS NOT NULL
               ORDER BY guest_token.created_at DESC
               LIMIT 1
            ) AS guest_contact_id
     FROM meeting_room_tokens mrt
     INNER JOIN meeting_rooms mr ON mr.id = mrt.room_id
     INNER JOIN meetings m ON m.id = mr.meeting_id
     WHERE mrt.token_hash = ?
       AND mrt.revoked_at IS NULL
       AND mrt.expires_at > ?`,
  ).bind(tokenHash, now).first<ResolvedRoom>();
}

async function resolveMeetingRecording(
  db: D1Database,
  meetingId: string,
  ownerId: string,
): Promise<ResolvedMeetingRecording | null> {
  const row = await db.prepare(
    `SELECT COALESCE(mr.id, '') AS room_id,
            m.id AS meeting_id,
            COALESCE(mr.session_id, '') AS session_id,
            COALESCE(mr.status, m.status) AS room_status,
            'HOST' AS role,
            m.owner_id, m.title, m.description, m.scheduled_at,
            m.meeting_type, m.status AS meeting_status,
            m.started_at, m.ended_at, m.scheduled_interview_id,
            m.recording_r2_key,
            (
              SELECT mp.contact_id
                FROM meeting_participants mp
               WHERE mp.meeting_id = m.id
               ORDER BY mp.created_at DESC
               LIMIT 1
            ) AS guest_contact_id
       FROM meetings m
       LEFT JOIN meeting_rooms mr ON mr.meeting_id = m.id
      WHERE m.id = ?1
        AND m.owner_id = ?2`,
  ).bind(meetingId, ownerId).first<ResolvedRoom & { recording_r2_key: string | null }>();

  if (!row) return null;
  const { recording_r2_key, ...room } = row;
  return { room, recordingKey: recording_r2_key };
}

function transcriptionAudioKeyFor(recordingKey: string): string | null {
  return recordingKey.endsWith('/recording.webm')
    ? recordingKey.replace(/\/recording\.webm$/, '/transcription-audio.webm')
    : null;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function analyzeMeeting(
  ai: Ai,
  transcript: string,
  segments: MeetingTranscriptSegmentInput[],
): Promise<MeetingAnalysis> {
  const source = segments.map((segment) => {
    const id = segment.stableSegmentId ?? 'missing-segment-id';
    const speaker = segment.speakerRole ?? segment.speakerLabel ?? 'unknown-speaker';
    return `[${id}] ${speaker}: ${segment.text}`;
  }).join('\n\n');
  const result = await ai.run(
    '@cf/google/gemma-4-26b-a4b-it' as Parameters<typeof ai.run>[0],
    {
      messages: [
        {
          role: 'system',
          content: `You extract source-backed meeting intelligence. Return JSON only:
{
  "summary": "concise factual summary",
  "decisions": ["decision"],
  "actionItems": [{"text":"task","owner":null,"dueDate":null}],
  "topics": ["topic"],
  "followUps": ["follow-up"],
  "semanticAssertions": [{
    "sourceSegmentIds": ["exact segment id"],
    "subjectSegmentId": "segment spoken by the person making the claim",
    "predicate": "open source-grounded predicate; do not choose from a taxonomy",
    "narrative": "standalone factual narrative",
    "objectType": null,
    "objectValue": null,
    "qualifiers": {},
    "confidence": 0.0,
    "polarity": 1.0,
    "concepts": [{
      "surface": "exact meaning-bearing phrase copied from a source segment",
      "relationship": "open phrase describing how the assertion relates to the concept",
      "weight": 0.0,
      "evidenceLevel": "mentioned | used | explained | selected | implemented | demonstrated | validated",
      "strength": 0.0
    }]
  }]
}
Rules:
- Every assertion must cite existing segment IDs and include its speaker's subjectSegmentId.
- Concept surfaces must appear verbatim in a cited segment.
- Predicates, object types, relationships, concepts, and qualifiers are open data. Never force them into a known list.
- Do not invent facts, owners, dates, evidence levels, strengths, or speaker identities.
- Omit an assertion or concept when the source does not establish it. Use null or empty arrays when appropriate.`,
        },
        { role: 'user', content: source },
      ],
      max_tokens: 2400,
    } as unknown as Parameters<typeof ai.run>[1],
  );
  return parseAnalysis(extractAiText(result), transcript, segments);
}

async function processRecording(
  env: Env,
  room: ResolvedRoom,
  transcriptionSourceKey: string,
  recordingKey: string,
  overrides: RecordingProcessingOverrides = {},
): Promise<void> {
  const logPrefix = `[meetingRooms/processRecording:${room.meeting_id}]`;
  console.log(`${logPrefix} Starting processing`, {
    transcriptionSourceKey,
    recordingKey,
    hasOverrides: Object.keys(overrides).length > 0,
  });
  try {
    const object = await env.STORAGE.get(transcriptionSourceKey);
    if (!object) {
      console.error(`${logPrefix} Transcription source not found in R2`, { transcriptionSourceKey });
      throw new Error('Transcription source was not found after upload.');
    }
    const audioBuffer = await object.arrayBuffer();
    const contentType = object.httpMetadata?.contentType ?? 'video/webm';
    const speakerMetadata = overrides.speakerMetadata
      ?? speakerMetadataFromCustomMetadata(object.customMetadata)
      ?? defaultRecordingSpeakerMetadata();
    const channelMap = speakerChannelsByChannel(speakerMetadata);
    console.log(`${logPrefix} Retrieved audio from R2`, {
      transcriptionSourceKey,
      bytes: audioBuffer.byteLength,
      contentType,
      speakerChannelLayout: speakerMetadata.transcriptionAudio.channelLayout,
    });
    const structured = overrides.structuredTranscription ?? (env.DEEPGRAM_API_KEY
      ? await transcribeAudioDeepgramStructured(
          audioBuffer,
          env.DEEPGRAM_API_KEY,
          contentType,
        )
      : null);
    console.log(`${logPrefix} Transcription result`, {
      hasStructured: Boolean(structured),
      hasDeepgramKey: Boolean(env.DEEPGRAM_API_KEY),
      segmentCount: structured?.segments.length ?? 0,
    });
    let segments: MeetingTranscriptSegmentInput[];
    let transcript: string;
    if (structured) {
      segments = structured.segments.map((segment) => {
        const speakerChannel = segment.channel === null
          ? null
          : channelMap.get(segment.channel) ?? null;
        return {
          stableSegmentId: segment.stableSegmentId,
          text: segment.text,
          speakerLabel: segment.speakerLabel,
          speakerRole: speakerChannel?.role ?? null,
          contactId: speakerChannel?.role === 'guest' ? room.guest_contact_id : null,
          channel: segment.channel,
          timestampStartMs: segment.timestampStartMs,
          timestampEndMs: segment.timestampEndMs,
          confidence: segment.confidence,
          metadata: {
            providerSegmentId: segment.providerSegmentId,
            speakerMetadataRole: speakerChannel?.role ?? null,
            speakerMetadataSource: speakerChannel?.source ?? null,
          },
        };
      });
      transcript = structured.transcript;
    } else {
      console.log(`${logPrefix} Using Whisper fallback (no structured transcription)`);
      const whisperTranscript = await withTimeout(
        transcribeAudioWhisper(env.AI, audioBuffer),
        WHISPER_TRANSCRIPTION_TIMEOUT_MS,
        'Workers AI transcription',
      );
      if (!whisperTranscript) {
        console.error(`${logPrefix} Whisper transcription returned empty`);
        throw new Error('Transcription returned no text.');
      }
      console.log(`${logPrefix} Whisper transcription succeeded`, {
        transcriptLength: whisperTranscript.length,
      });
      transcript = whisperTranscript;
      segments = [{
        stableSegmentId: 'mixed-0001',
        text: transcript,
        speakerLabel: 'mixed',
      }];
    }

    const hasAttributedGuestAudio = Boolean(
      room.guest_contact_id
        && segments.some((segment) => segment.contactId === room.guest_contact_id),
    );
    const provider = structured
      ? hasAttributedGuestAudio
        ? 'deepgram-multichannel'
        : 'deepgram-multichannel-summary-only'
      : 'workers-ai-whisper-summary-only';

    const analysis = overrides.analysisJson
      ? parseAnalysis(overrides.analysisJson, transcript, segments)
      : await withTimeout(
          analyzeMeeting(env.AI, transcript, segments),
          MEETING_ANALYSIS_TIMEOUT_MS,
          'Meeting transcript analysis',
        );
    const personContextMode = hasAttributedGuestAudio ? 'attributed' : 'summary_only';
    const analysisForStorage = {
      ...analysis,
      personContextMode,
      personContextReason: hasAttributedGuestAudio
        ? null
        : structured
          ? room.guest_contact_id
            ? 'guest_audio_channel_missing'
            : 'guest_contact_id_missing'
          : 'mixed_audio_without_speaker_attribution',
      speakerMetadata: speakerMetadataJsonObject(speakerMetadata),
    };
    const transcriptJson = JSON.stringify(segments.map((segment) => ({
      stable_segment_id: segment.stableSegmentId,
      speaker: segment.speakerLabel ?? null,
      role: segment.speakerRole ?? null,
      contact_id: segment.contactId ?? null,
      channel: segment.channel ?? null,
      text: segment.text,
      timestamp_start_ms: segment.timestampStartMs ?? null,
      timestamp_end_ms: segment.timestampEndMs ?? null,
      confidence: segment.confidence ?? null,
      metadata: segment.metadata ?? null,
    })));
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE meetings
       SET transcript_status = 'READY',
           transcript_json = ?,
           transcript_summary = ?,
           transcript_analysis_json = ?,
           transcript_error = NULL,
           recording_r2_key = ?,
           updated_at = ?
       WHERE id = ?`,
    ).bind(
      transcriptJson,
      analysis.summary,
      JSON.stringify(analysisForStorage),
      recordingKey,
      now,
      room.meeting_id,
    ).run();
    await ingestMeetingTranscriptToLivingContext(env.DB, {
      meetingId: room.meeting_id,
      ownerId: room.owner_id,
      scheduledInterviewId: room.scheduled_interview_id,
      transcript,
      segments,
      summary: analysis.summary,
      semanticAssertions: hasAttributedGuestAudio ? analysis.semanticAssertions : [],
      extractorVersion: 'meeting-transcript-open-v1',
      startedAt: room.started_at,
      endedAt: room.ended_at,
      recordingKey,
      transcriptionAudioKey: transcriptionSourceKey !== recordingKey ? transcriptionSourceKey : null,
      provider,
      speakerMetadata: speakerMetadataJsonObject(speakerMetadata),
      personContextMode,
      personContextReason: analysisForStorage.personContextReason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`${logPrefix} Recording processing failed`, {
      message,
      stack,
      transcriptionSourceKey,
      recordingKey,
    });
    await env.DB.prepare(
      `UPDATE meetings
       SET transcript_status = 'FAILED', transcript_error = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(message, new Date().toISOString(), room.meeting_id).run();
  }
}

export const meetingRooms = new Hono<{ Bindings: Env }>();

interface UploadedBlobPart {
  size: number;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function isUploadedBlobPart(value: unknown): value is UploadedBlobPart {
  if (!value || typeof value !== 'object') return false;
  const part = value as Partial<UploadedBlobPart>;
  return (
    typeof part.size === 'number'
    && typeof part.arrayBuffer === 'function'
  );
}

meetingRooms.get('/:token', async (c) => {
  const token = c.req.param('token');
  const room = await resolveRoom(c.env.DB, token);
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');

  const participants = await c.env.DB.prepare(
    `SELECT c.name, mp.role
     FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.meeting_id = ?
     ORDER BY mp.role, c.name`,
  ).bind(room.meeting_id).all<{ name: string; role: string }>();
  const workspace = await buildRoomWorkspacePayload(c.env.DB, token, room);

  return c.json({
    room: {
      id: room.room_id,
      meetingId: room.meeting_id,
      sessionId: room.session_id,
      role: room.role,
      status: room.room_status,
      title: room.title,
      description: room.description,
      scheduledAt: room.scheduled_at,
      meetingType: room.meeting_type,
      participants: participants.results,
      workspace,
      features: {
        video: room.video_enabled !== 0,
        workspace: room.workspace_enabled !== 0,
        recording: room.recording_enabled !== 0,
        clippy: room.clippy_enabled !== 0,
      },
    },
  });
});

meetingRooms.get('/:token/turn-credentials', async (c) => {
  const room = await resolveRoom(c.env.DB, c.req.param('token'));
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');

  const result = await getTurnIceServers(c.env, '[meetingRooms]');
  c.header('Cache-Control', 'no-store');
  return c.json(result);
});

meetingRooms.get('/:token/workspace', async (c) => {
  const token = c.req.param('token');
  const room = await resolveRoom(c.env.DB, token);
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');

  return c.json({ workspace: await buildRoomWorkspacePayload(c.env.DB, token, room) });
});

const workspaceLaunchSchema = z.object({
  repoUrl: z.string().url().optional(),
});

meetingRooms.post('/:token/workspace/launch', async (c) => {
  const token = c.req.param('token');
  const room = await resolveRoom(c.env.DB, token);
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  if (room.role !== 'HOST') {
    return apiError(c, 'FORBIDDEN', 'Only the host can launch the workspace.');
  }

  const workspace = await buildRoomWorkspacePayload(c.env.DB, token, room);
  if (!workspace.enabled) {
    return apiError(c, 'FORBIDDEN', 'Workspace is only available for dev-container interviews.');
  }
  let body: z.infer<typeof workspaceLaunchSchema> = {};
  try {
    const raw = await c.req.json().catch(() => null);
    if (raw && typeof raw === 'object') {
      body = workspaceLaunchSchema.parse(raw);
    }
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Invalid request body.');
  }
  const effectiveRepoUrl = body.repoUrl || workspace.repoUrl;
  if (!effectiveRepoUrl) {
    return apiError(c, 'VALIDATION_ERROR', 'Provide a repository URL to launch the workspace.');
  }

  const existingSession = await getLatestSessionForRoom(c.env.DB, room.room_id);
  if (existingSession && !WORKSPACE_TERMINAL_STATUSES.has(existingSession.status)) {
    return c.json({
      workspace: {
        ...workspace,
        session: serializeWorkspaceSession(token, existingSession),
      },
    }, 200);
  }

  const globalDefault = parsePositiveIntEnv(
    c.env.DEV_CONTAINER_DEFAULT_TTL_SECONDS,
    DEFAULT_DEV_CONTAINER_TTL_SECONDS,
  );
  const hardCap = parsePositiveIntEnv(
    c.env.DEV_CONTAINER_MAX_TTL_SECONDS,
    DEFAULT_DEV_CONTAINER_MAX_TTL_SECONDS,
  );

  let effective;
  try {
    effective = computeEffectiveTtl({
      globalDefault,
      challengeTtl: null,
      override: null,
      hardCap,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid TTL configuration.';
    const isUserError = message.includes(`>= ${MIN_TTL_SECONDS}s`);
    return c.json({
      error: {
        code: isUserError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
        message,
      },
    }, isUserError ? 400 : 500);
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + effective.ttlSeconds * 1000).toISOString();
  const challengeBranch = githubPrChallengeRef(workspace.githubPrNumber);
  const challenge = workspace.challenge;
  await insertRoomSession(c.env.DB, {
    id: crypto.randomUUID(),
    sessionId,
    meetingId: room.meeting_id,
    meetingRoomId: room.room_id,
    ownerId: room.owner_id,
    instanceType: DEFAULT_DEV_CONTAINER_INSTANCE_TYPE,
    ttlSeconds: effective.ttlSeconds,
    ttlSource: effective.source,
    expiresAt,
    repoGitUrl: effectiveRepoUrl,
    challengeBranch,
  });

  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);
  c.executionCtx.waitUntil(
    doStub.fetch('https://do.internal/__init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        expiresAt,
        ttlSeconds: effective.ttlSeconds,
        repoGitUrl: effectiveRepoUrl,
        challengeBranch,
        matchedRepoId: workspace.matchedRepoId,
        githubPrNumber: workspace.githubPrNumber,
        challengeStatus: challenge.status,
        challengeKind: challenge.kind,
        challengeSource: challenge.source,
        challengeMessage: challenge.message,
        agentType: 'devin',
        agentApiKey: c.env.DEVIN_API_KEY ?? null,
        pipeApiUrl: c.env.API_BASE_URL
          ?? c.env.VIDEO_ROOM_APP_URL
          ?? c.env.APP_BASE_URL
          ?? `https://${c.req.header('host') ?? 'api.pipe.os'}`,
        roomToken: token,
      }),
    }).catch((err: unknown) => {
      console.error('[meetingRooms.workspace.launch] DO init failed:', err);
    }),
  );

  const session = await getSessionByIdForRoom(c.env.DB, sessionId, room.room_id);
  return c.json({
    workspace: {
      ...workspace,
      repoUrl: workspace.repoUrl ?? effectiveRepoUrl,
      session: serializeWorkspaceSession(token, session),
    },
  }, 201);
});

meetingRooms.post('/:token/workspace/:sessionId/destroy', async (c) => {
  const token = c.req.param('token');
  const room = await resolveRoom(c.env.DB, token);
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  if (room.role !== 'HOST') {
    return apiError(c, 'FORBIDDEN', 'Only the host can stop the workspace.');
  }

  const sessionId = c.req.param('sessionId');
  const session = await getSessionByIdForRoom(c.env.DB, sessionId, room.room_id);
  if (!session) return apiError(c, 'NOT_FOUND', 'Workspace session not found.');

  if (!WORKSPACE_TERMINAL_STATUSES.has(session.status)) {
    await markStopped(c.env.DB, sessionId, new Date().toISOString());
    const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
    const doStub = c.env.DEV_CONTAINER.get(doId);
    c.executionCtx.waitUntil(
      doStub.fetch('https://do.internal/__destroy', { method: 'POST' }).catch((err: unknown) => {
        console.error('[meetingRooms.workspace.destroy] DO destroy failed:', err);
      }),
    );
  }

  return c.json({ workspace: await buildRoomWorkspacePayload(c.env.DB, token, room) });
});

async function proxyWorkspaceRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  const token = c.req.param('token');
  if (!token) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  const room = await resolveRoom(c.env.DB, token);
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');

  const sessionId = c.req.param('sessionId');
  if (!sessionId) return apiError(c, 'NOT_FOUND', 'Workspace session not found.');
  const session = await getSessionByIdForRoom(c.env.DB, sessionId, room.room_id);
  if (!session) return apiError(c, 'NOT_FOUND', 'Workspace session not found.');

  if (!WORKSPACE_PROXY_ALLOWED_STATUS.has(session.status)) {
    const code =
      session.status === 'LAUNCHING'
        ? 'NOT_READY'
        : session.status === 'ERROR'
          ? 'CONTAINER_ERROR'
          : 'SESSION_ENDED';
    return c.json({
      error: {
        code,
        message: `Workspace session is ${session.status}.`,
      },
    }, session.status === 'LAUNCHING' ? 425 : 410);
  }

  const incoming = new URL(c.req.url);
  const marker = `/workspace/proxy/${sessionId}`;
  const markerIdx = incoming.pathname.indexOf(marker);
  const innerPath =
    markerIdx >= 0 ? incoming.pathname.slice(markerIdx + marker.length) || '/' : '/';
  const innerUrl = new URL(`https://do.internal${innerPath}${incoming.search}`);
  const forwarded = new Request(innerUrl.toString(), c.req.raw);

  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);
  try {
    return await doStub.fetch(forwarded);
  } catch (err) {
    console.error('[meetingRooms.workspace.proxy] upstream failed:', err);
    return c.json({
      error: { code: 'BAD_GATEWAY', message: 'Workspace proxy failed.' },
    }, 502);
  }
}

meetingRooms.all('/:token/workspace/proxy/:sessionId', proxyWorkspaceRequest);
meetingRooms.all('/:token/workspace/proxy/:sessionId/*', proxyWorkspaceRequest);

// Agent bridge WebSocket proxy — connects Clippy UI to the baked bridge/router inside the container.
// Path: /:token/agent/:sessionId/ws
meetingRooms.all('/:token/agent/:sessionId/ws', async (c) => {
  const token = c.req.param('token');
  const room = await resolveRoom(c.env.DB, token);
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');

  const sessionId = c.req.param('sessionId');
  const session = await getSessionByIdForRoom(c.env.DB, sessionId, room.room_id);
  if (!session) return apiError(c, 'NOT_FOUND', 'Workspace session not found.');

  if (!WORKSPACE_PROXY_ALLOWED_STATUS.has(session.status)) {
    return c.json({
      error: {
        code: session.status === 'LAUNCHING' ? 'NOT_READY' : 'SESSION_ENDED',
        message: `Workspace session is ${session.status}.`,
      },
    }, session.status === 'LAUNCHING' ? 425 : 410);
  }

  // Forward WebSocket upgrade to the container bridge/router on the default port.
  const incoming = new URL(c.req.url);
  const innerUrl = new URL(`https://do.internal/ws${incoming.search}`);
  const forwarded = new Request(innerUrl.toString(), c.req.raw);

  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);
  try {
    return await doStub.fetch(forwarded);
  } catch (err) {
    console.error('[meetingRooms.agent.ws] upstream failed:', err);
    return c.json({
      error: { code: 'BAD_GATEWAY', message: 'Agent bridge connection failed.' },
    }, 502);
  }
});

// Agent auth HTTP proxy — proxies auth requests to the container bridge/router.
// Path: /:token/agent/:sessionId/auth/*
meetingRooms.all('/:token/agent/:sessionId/auth/*', async (c) => {
  const token = c.req.param('token');
  const room = await resolveRoom(c.env.DB, token);
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');

  const sessionId = c.req.param('sessionId');
  const session = await getSessionByIdForRoom(c.env.DB, sessionId, room.room_id);
  if (!session) return apiError(c, 'NOT_FOUND', 'Workspace session not found.');

  if (!WORKSPACE_PROXY_ALLOWED_STATUS.has(session.status)) {
    return c.json({
      error: {
        code: session.status === 'LAUNCHING' ? 'NOT_READY' : 'SESSION_ENDED',
        message: `Workspace session is ${session.status}.`,
      },
    }, session.status === 'LAUNCHING' ? 425 : 410);
  }

  // Forward to the container's auth server
  const incoming = new URL(c.req.url);
  const marker = `/agent/${sessionId}/auth`;
  const markerIdx = incoming.pathname.indexOf(marker);
  const innerPath =
    markerIdx >= 0 ? incoming.pathname.slice(markerIdx + marker.length) || '/' : '/';
  const innerUrl = new URL(`https://do.internal${innerPath}${incoming.search}`);
  const forwarded = new Request(innerUrl.toString(), c.req.raw);

  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);
  try {
    return await doStub.fetch(forwarded);
  } catch (err) {
    console.error('[meetingRooms.agent.auth] upstream failed:', err);
    return c.json({
      error: { code: 'BAD_GATEWAY', message: 'Agent auth proxy failed.' },
    }, 502);
  }
});

// Session context graph — capture events and retrieve the candidate's session brain.
// POST /:token/session-events — capture a session event as a candidate_node
meetingRooms.post('/:token/session-events', async (c) => {
  const token = c.req.param('token');
  const parsed = sessionEventSchema.safeParse(await readJsonRequestBody(c));
  if (!parsed.success) return apiError(c, 'VALIDATION_ERROR', 'Invalid session event.');

  const { resolveCandidateIdForRoom, captureSessionEvent } = await import('../lib/sessionEvents.js');
  const resolved = await resolveCandidateIdForRoom(c.env.DB, token);
  if (!resolved) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  if (!resolved.candidateId) return apiError(c, 'NOT_FOUND', 'No candidate linked to this meeting.');

  const event = {
    type: parsed.data.type,
    sessionId: resolved.sessionId,
    candidateId: resolved.candidateId,
    timestamp: Math.floor(Date.now() / 1000),
    actor: parsed.data.actor ?? 'system',
    text: parsed.data.text,
    properties: parsed.data.properties,
  };

  const node = await captureSessionEvent(c.env.DB, event, c.env);
  if (!node) {
    return apiError(c, 'INTERNAL_ERROR', 'Session event could not be persisted.');
  }

  return c.json({ captured: true, nodeId: node.id });
});

// GET /:token/context-graph — retrieve all session events for the candidate
meetingRooms.get('/:token/context-graph', async (c) => {
  const token = c.req.param('token');
  const {
    resolveCandidateIdForRoom,
    getSessionContextGraph,
    syncRoomActivityToSessionEvents,
  } = await import('../lib/sessionEvents.js');
  const resolved = await resolveCandidateIdForRoom(c.env.DB, token);
  if (!resolved) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  if (!resolved.candidateId) return apiError(c, 'NOT_FOUND', 'No candidate linked to this meeting.');

  await syncRoomActivityToSessionEvents(c.env.DB, c.env, {
    candidateId: resolved.candidateId,
    sessionId: resolved.sessionId,
  });

  const graph = await getSessionContextGraph(c.env.DB, resolved.candidateId, resolved.sessionId);
  return c.json({
    candidateId: resolved.candidateId,
    sessionId: resolved.sessionId,
    events: graph,
  });
});

// GET /:token/context-summary — text summary for agent system prompt
meetingRooms.get('/:token/context-summary', async (c) => {
  const token = c.req.param('token');
  const {
    resolveCandidateIdForRoom,
    getSessionContextSummary,
    syncRoomActivityToSessionEvents,
  } = await import('../lib/sessionEvents.js');
  const resolved = await resolveCandidateIdForRoom(c.env.DB, token);
  if (!resolved) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  if (!resolved.candidateId) return apiError(c, 'NOT_FOUND', 'No candidate linked to this meeting.');

  await syncRoomActivityToSessionEvents(c.env.DB, c.env, {
    candidateId: resolved.candidateId,
    sessionId: resolved.sessionId,
  });

  const summary = await getSessionContextSummary(c.env.DB, resolved.candidateId, resolved.sessionId);
  return c.json({ summary });
});

meetingRooms.get('/:token/ws', async (c) => {
  const token = c.req.param('token');
  const room = await resolveRoom(c.env.DB, token);
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return apiError(c, 'VALIDATION_ERROR', 'Expected WebSocket upgrade.');
  }
  const workspace = await buildRoomWorkspacePayload(c.env.DB, token, room);

  const doId = c.env.VIDEO_ROOM.idFromName(room.session_id);
  const stub = c.env.VIDEO_ROOM.get(doId);
  await stub.fetch(new Request('https://do/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meetingId: room.meeting_id,
      hostId: room.owner_id,
      resetEnded: room.room_status !== 'ENDED',
      initialSurface: initialRoomSurfaceForWorkspace(workspace),
    }),
  }));
  return stub.fetch(new Request(`https://do/ws?role=${room.role}`, {
    headers: c.req.raw.headers,
  }));
});

meetingRooms.post('/:token/events', async (c) => {
  const token = c.req.param('token');
  const room = await resolveRoom(c.env.DB, token);
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  const parsed = roomEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 'VALIDATION_ERROR', 'Invalid room event.');

  const now = new Date().toISOString();
  const event = parsed.data.event;
  const recordingWasActive = event === 'ENDED' && room.role === 'HOST'
    ? await meetingHasActiveRecordingEvidence(c.env.DB, room.meeting_id)
    : false;
  let sessionEvidence: RoomActivityEvidenceSyncResult | null = null;
  let lifecycleEvidence: RoomLifecycleEvidenceCaptureResult | null = null;
  if (event === 'STARTED' && room.role === 'HOST') {
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `UPDATE meeting_rooms SET status = 'ACTIVE', updated_at = ? WHERE id = ?`,
      ).bind(now, room.room_id),
      c.env.DB.prepare(
        `UPDATE meetings
         SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, ?),
             updated_at = ?
         WHERE id = ?`,
      ).bind(now, now, room.meeting_id),
    ];
    if (room.scheduled_interview_id) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE scheduled_interviews
           SET status = CASE
                 WHEN status IN ('CANCELLED', 'NO_SHOW', 'COMPLETED') THEN status
                 ELSE 'ACTIVE'
               END,
               updated_at = ?
           WHERE id = ?`,
        ).bind(now, room.scheduled_interview_id),
      );
    }
    await c.env.DB.batch(statements);
  } else if (event === 'RECORDING_STARTED' && room.role === 'HOST') {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE meeting_rooms SET status = 'ACTIVE', updated_at = ? WHERE id = ?`,
      ).bind(now, room.room_id),
      c.env.DB.prepare(
        `UPDATE meetings
         SET status = 'IN_PROGRESS',
             started_at = COALESCE(started_at, ?),
             transcript_status = 'RECORDING',
             transcript_error = NULL,
             updated_at = ?
         WHERE id = ?`,
      ).bind(now, now, room.meeting_id),
    ]);
  } else if (event === 'JOINED') {
    // Track participant join for guest waiting detection
    const participant = await c.env.DB.prepare(
      `SELECT mp.id FROM meeting_participants mp
       WHERE mp.meeting_id = ?
         ${room.role === 'GUEST' ? "AND mp.role = 'ATTENDEE'" : "AND mp.role = 'HOST'"}
       ORDER BY mp.created_at DESC LIMIT 1`,
    ).bind(room.meeting_id).first<{ id: string }>();
    if (participant) {
      await c.env.DB.prepare(
        `UPDATE meeting_participants SET joined_at = COALESCE(joined_at, ?), left_at = NULL, updated_at = ? WHERE id = ?`,
      ).bind(now, now, participant.id).run();
    }
  } else if (event === 'LEFT') {
    const participant = await c.env.DB.prepare(
      `SELECT mp.id FROM meeting_participants mp
       WHERE mp.meeting_id = ?
         ${room.role === 'GUEST' ? "AND mp.role = 'ATTENDEE'" : "AND mp.role = 'HOST'"}
       ORDER BY mp.created_at DESC LIMIT 1`,
    ).bind(room.meeting_id).first<{ id: string }>();
    if (participant) {
      await c.env.DB.prepare(
        `UPDATE meeting_participants SET left_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(now, now, participant.id).run();
    }
  } else if (event === 'ENDED' && room.role === 'HOST') {
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `UPDATE meeting_rooms SET status = 'ENDED', updated_at = ? WHERE id = ?`,
      ).bind(now, room.room_id),
      c.env.DB.prepare(
        `UPDATE meetings
         SET status = 'COMPLETED', ended_at = ?,
             duration_secs = CASE
               WHEN started_at IS NULL THEN NULL
               ELSE CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER)
             END,
             transcript_status = CASE
               WHEN transcript_status = 'RECORDING' AND recording_r2_key IS NULL THEN 'NONE'
               ELSE transcript_status
             END,
             updated_at = ?
         WHERE id = ?`,
      ).bind(now, now, now, room.meeting_id),
    ];
    if (room.scheduled_interview_id) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE scheduled_interviews
           SET updated_at = ?
           WHERE id = ?`,
        ).bind(now, room.scheduled_interview_id),
      );
    }
    await c.env.DB.batch(statements);
    sessionEvidence = await syncRoomActivityEvidenceForToken(c, token);
  }

  lifecycleEvidence = await captureRoomLifecycleEvidenceForToken(
    c,
    token,
    room,
    event,
    Math.floor(new Date(now).getTime() / 1000),
    { recordingWasActive, observedAt: now },
  );

  return c.json({ accepted: true, sessionEvidence, lifecycleEvidence });
});

meetingRooms.post('/:token/recording', async (c) => {
  const token = c.req.param('token');
  const room = await resolveRoom(c.env.DB, token);
  if (!room) {
    console.warn('[meetingRooms] Recording upload: room not found', { token });
    return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  }
  if (room.role !== 'HOST') {
    console.warn('[meetingRooms] Recording upload: non-host role', { token, role: room.role });
    return apiError(c, 'FORBIDDEN', 'Only the host can upload a room recording.');
  }

  const contentLength = Number(c.req.header('Content-Length') ?? '0');
  console.log('[meetingRooms] Recording upload started', {
    token,
    meetingId: room.meeting_id,
    roomId: room.room_id,
    contentLength,
    contentType: c.req.header('Content-Type') ?? 'unknown',
  });
  if (contentLength > 100 * 1024 * 1024) {
    console.warn('[meetingRooms] Recording upload: exceeds 100MB limit', { contentLength });
    return apiError(c, 'VALIDATION_ERROR', 'Recording exceeds the 100 MB limit.');
  }
  const requestContentType = c.req.header('Content-Type') ?? 'audio/webm';
  const e2eDeepgramResponse = c.req.header(E2E_DEEPGRAM_RESPONSE_HEADER);
  const e2eMeetingAnalysis = c.req.header(E2E_MEETING_ANALYSIS_HEADER);
  let processingOverrides: RecordingProcessingOverrides = {};
  if (e2eDeepgramResponse || e2eMeetingAnalysis) {
    if (!isLocalOrTestRequest(c.env, c.req.url)) {
      return apiError(c, 'FORBIDDEN', 'E2E transcription overrides are only accepted in local/test environments.');
    }
    if (
      (e2eDeepgramResponse && headerByteLength(e2eDeepgramResponse) > E2E_TRANSCRIPT_OVERRIDE_MAX_BYTES)
      || (e2eMeetingAnalysis && headerByteLength(e2eMeetingAnalysis) > E2E_TRANSCRIPT_OVERRIDE_MAX_BYTES)
    ) {
      return apiError(c, 'VALIDATION_ERROR', 'E2E transcription override is too large.');
    }
    if (e2eDeepgramResponse) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(e2eDeepgramResponse);
      } catch {
        return apiError(c, 'VALIDATION_ERROR', 'E2E Deepgram override must be JSON.');
      }
      const structuredTranscription = parseDeepgramStructuredTranscription(parsed);
      if (!structuredTranscription) {
        return apiError(c, 'VALIDATION_ERROR', 'E2E Deepgram override did not contain usable segments.');
      }
      processingOverrides = {
        ...processingOverrides,
        structuredTranscription,
      };
    }
    if (e2eMeetingAnalysis) {
      try {
        JSON.parse(e2eMeetingAnalysis);
      } catch {
        return apiError(c, 'VALIDATION_ERROR', 'E2E meeting analysis override must be JSON.');
      }
      processingOverrides = {
        ...processingOverrides,
        analysisJson: e2eMeetingAnalysis,
      };
    }
  }
  let bytes: ArrayBuffer;
  let contentType: string;
  let transcriptionBytes: ArrayBuffer | null = null;
  let transcriptionContentType: string | null = null;
  let speakerMetadata = defaultRecordingSpeakerMetadata();

  if (requestContentType.toLowerCase().includes('multipart/form-data')) {
    const form = await c.req.formData();
    const recording = form.get('recording');
    if (!isUploadedBlobPart(recording)) {
      console.warn('[meetingRooms] Recording upload: missing recording file in multipart', { token });
      return apiError(c, 'VALIDATION_ERROR', 'Recording upload is missing the recording file.');
    }
    bytes = await recording.arrayBuffer();
    contentType = recording.type || 'video/webm';

    const transcriptionAudio = form.get('transcriptionAudio');
    if (isUploadedBlobPart(transcriptionAudio) && transcriptionAudio.size > 0) {
      transcriptionBytes = await transcriptionAudio.arrayBuffer();
      transcriptionContentType = transcriptionAudio.type || 'audio/webm';
    }

    const speakerMetadataField = form.get('speakerMetadata');
    if (speakerMetadataField !== null) {
      if (typeof speakerMetadataField !== 'string') {
        return apiError(c, 'VALIDATION_ERROR', 'Speaker metadata must be a JSON string.');
      }
      const parsedSpeakerMetadata = parseRecordingSpeakerMetadataJson(speakerMetadataField);
      if (!parsedSpeakerMetadata.ok) {
        return apiError(c, 'VALIDATION_ERROR', parsedSpeakerMetadata.message);
      }
      speakerMetadata = parsedSpeakerMetadata.metadata;
    }
  } else {
    bytes = await c.req.arrayBuffer();
    contentType = requestContentType;
  }

  console.log('[meetingRooms] Recording upload parsed', {
    meetingId: room.meeting_id,
    recordingBytes: bytes.byteLength,
    hasTranscriptionAudio: transcriptionBytes !== null,
    transcriptionBytes: transcriptionBytes?.byteLength ?? 0,
    contentType,
    speakerChannelLayout: speakerMetadata.transcriptionAudio.channelLayout,
  });

  if (bytes.byteLength === 0) {
    console.warn('[meetingRooms] Recording upload: empty recording', { token });
    return apiError(c, 'VALIDATION_ERROR', 'Recording is empty.');
  }
  if (bytes.byteLength + (transcriptionBytes?.byteLength ?? 0) > 100 * 1024 * 1024) {
    console.warn('[meetingRooms] Recording upload: exceeds limit after parse', {
      recordingBytes: bytes.byteLength,
      transcriptionBytes: transcriptionBytes?.byteLength ?? 0,
    });
    return apiError(c, 'VALIDATION_ERROR', 'Recording exceeds the 100 MB limit.');
  }

  const recordingKey = `meetings/${room.owner_id}/${room.meeting_id}/recording.webm`;
  console.log('[meetingRooms] Storing recording to R2', { recordingKey, bytes: bytes.byteLength });
  try {
    await c.env.STORAGE.put(recordingKey, bytes, {
      httpMetadata: { contentType },
      customMetadata: {
        meetingId: room.meeting_id,
        roomId: room.room_id,
        ...speakerMetadataCustomMetadata(speakerMetadata),
      },
    });
  } catch (r2Error) {
    console.error('[meetingRooms] R2 put failed for recording', {
      recordingKey,
      error: r2Error instanceof Error ? r2Error.message : String(r2Error),
    });
    throw r2Error;
  }

  let transcriptionSourceKey = recordingKey;
  if (transcriptionBytes) {
    transcriptionSourceKey = `meetings/${room.owner_id}/${room.meeting_id}/transcription-audio.webm`;
    await c.env.STORAGE.put(transcriptionSourceKey, transcriptionBytes, {
      httpMetadata: { contentType: transcriptionContentType ?? 'audio/webm' },
      customMetadata: {
        meetingId: room.meeting_id,
        roomId: room.room_id,
        derivedFrom: recordingKey,
        ...speakerMetadataCustomMetadata(speakerMetadata),
      },
    });
  }

  await c.env.DB.prepare(
    `UPDATE meetings
     SET transcript_status = 'PROCESSING', recording_r2_key = ?,
         transcript_error = NULL, updated_at = ?
     WHERE id = ?`,
  ).bind(recordingKey, new Date().toISOString(), room.meeting_id).run();

  c.executionCtx.waitUntil(processRecording(
    c.env,
    room,
    transcriptionSourceKey,
    recordingKey,
    {
      ...processingOverrides,
      speakerMetadata,
    },
  ));
  console.log('[meetingRooms] Recording upload complete, processing started', {
    meetingId: room.meeting_id,
    recordingKey,
    transcriptionSourceKey,
  });
  return c.json({ accepted: true, transcriptStatus: 'PROCESSING' }, 202);
});

// ─── Authenticated meeting management ───────────────────────────────────────
// These routes let a recruiter create meetings, list them, and invite guests.
// The token-based room runtime above remains public (the opaque token IS the
// credential). Management of meetings themselves requires Clerk JWT auth.

const MEETING_TYPES = ['DISCOVERY', 'INTERVIEW', 'FOLLOW_UP', 'DEMO', 'OTHER'] as const;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const createMeetingSchema = z.object({
  contactId: z.string().min(1).optional(),
  recipientEmail: z.string().email().optional(),
  recipientName: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  meetingType: z.enum(MEETING_TYPES).optional(),
  scheduledAt: z.string().optional(),
  scheduledInterviewId: z.string().min(1).optional(),
}).refine(
  (data) => Boolean(data.contactId) || (Boolean(data.recipientEmail) && Boolean(data.recipientName)),
  'Either contactId or both recipientEmail and recipientName are required.',
);

const inviteGuestSchema = z.object({
  email: z.string().email(),
  message: z.string().max(1000).optional(),
});

interface MeetingRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  meeting_url: string | null;
  meeting_type: string;
  transcript_status: string;
  transcript_summary: string | null;
  recording_r2_key: string | null;
  scheduled_interview_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RoomRow {
  id: string;
  meeting_id: string;
  session_id: string;
  status: string;
}

async function createRoomAndHostToken(
  db: D1Database,
  meetingId: string,
  ownerId: string,
): Promise<{ room: RoomRow; hostToken: string }> {
  const roomId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO meeting_rooms (id, meeting_id, session_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'WAITING', ?, ?)`,
  ).bind(roomId, meetingId, sessionId, now, now).run();

  const hostToken = generateRoomToken();
  const hostHash = await hashRoomToken(hostToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  await db.prepare(
    `INSERT INTO meeting_room_tokens (id, room_id, token_hash, role, expires_at, created_at)
     VALUES (?, ?, ?, 'HOST', ?, ?)`,
  ).bind(crypto.randomUUID(), roomId, hostHash, expiresAt, now).run();

  return {
    room: { id: roomId, meeting_id: meetingId, session_id: sessionId, status: 'WAITING' },
    hostToken,
  };
}

export async function ensureMeetingRoomLinks(
  db: D1Database,
  meetingId: string,
  roomAppUrl: string,
  env?: Pick<Env, 'ENV' | 'DEV_BASIC_AUTH_USER' | 'DEV_BASIC_AUTH_PASSWORD' | 'VIDEO_ROOM_DEV_AUTH_USER' | 'VIDEO_ROOM_DEV_AUTH_PASSWORD'>,
): Promise<{
  id: string;
  sessionId: string;
  hostUrl: string;
  guestUrl: string;
  expiresAt: string;
}> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  let room = await db.prepare(
    'SELECT id, session_id, status FROM meeting_rooms WHERE meeting_id = ?',
  ).bind(meetingId).first<{ id: string; session_id: string; status: string }>();

  if (!room) {
    room = {
      id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      status: 'WAITING',
    };
    await db.prepare(
      `INSERT INTO meeting_rooms (id, meeting_id, session_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'WAITING', ?, ?)`,
    ).bind(room.id, meetingId, room.session_id, now, now).run();
  } else if (room.status === 'ENDED') {
    const sessionId = crypto.randomUUID();
    await db.prepare(
      `UPDATE meeting_rooms
       SET session_id = ?, status = 'WAITING', updated_at = ?
       WHERE id = ?`,
    ).bind(sessionId, now, room.id).run();
    room = { ...room, session_id: sessionId, status: 'WAITING' };
  }

  await db.prepare(
    `UPDATE meeting_room_tokens
     SET revoked_at = ?
     WHERE room_id = ? AND role = 'HOST' AND revoked_at IS NULL`,
  ).bind(now, room.id).run();

  const hostToken = generateRoomToken();
  const hostHash = await hashRoomToken(hostToken);
  await db.prepare(
    `INSERT INTO meeting_room_tokens (id, room_id, token_hash, role, expires_at, created_at)
     VALUES (?, ?, ?, 'HOST', ?, ?)`,
  ).bind(crypto.randomUUID(), room.id, hostHash, expiresAt, now).run();

  const meeting = await db.prepare(
    'SELECT meeting_url FROM meetings WHERE id = ?',
  ).bind(meetingId).first<{ meeting_url: string | null }>();
  const participants = await db.prepare(
    `SELECT id FROM meeting_participants
     WHERE meeting_id = ?
     ORDER BY created_at, id`,
  ).bind(meetingId).all<{ id: string }>();
  const guestParticipantId = participants.results.length === 1
    ? participants.results[0]?.id ?? null
    : null;

  let guestToken: string | null = null;
  if (meeting?.meeting_url) {
    try {
      const existingUrl = new URL(meeting.meeting_url);
      guestToken = existingUrl.pathname.split('/').filter(Boolean).pop() ?? null;
      if (guestToken) {
        const existingHash = await hashRoomToken(guestToken);
        const valid = await db.prepare(
          `SELECT id FROM meeting_room_tokens
           WHERE room_id = ? AND token_hash = ? AND role = 'GUEST'
             AND revoked_at IS NULL AND expires_at > ?`,
        ).bind(room.id, existingHash, now).first<{ id: string }>();
        if (!valid) {
          guestToken = null;
        } else if (guestParticipantId) {
          await db.prepare(
            `UPDATE meeting_room_tokens
             SET participant_id = ?
             WHERE id = ? AND participant_id IS NULL`,
          ).bind(guestParticipantId, valid.id).run();
        }
      }
    } catch {
      guestToken = null;
    }
  }

  if (!guestToken) {
    guestToken = await mintGuestToken(db, room.id, guestParticipantId);
  }

  const cleanRoomAppUrl = roomAppUrl.replace(/\/$/, '');
  const hostUrl = `${cleanRoomAppUrl}/room/${hostToken}`;
  const guestUrl = `${cleanRoomAppUrl}/room/${guestToken}`;
  await db.prepare(
    'UPDATE meetings SET meeting_url = ?, updated_at = ? WHERE id = ?',
  ).bind(guestUrl, now, meetingId).run();

  return {
    id: room.id,
    sessionId: room.session_id,
    hostUrl: withDevBasicAuth(hostUrl, env),
    guestUrl: withDevBasicAuth(guestUrl, env),
    expiresAt,
  };
}

export function withDevBasicAuth(
  rawUrl: string,
  env?: Pick<Env, 'ENV' | 'DEV_BASIC_AUTH_USER' | 'DEV_BASIC_AUTH_PASSWORD' | 'VIDEO_ROOM_DEV_AUTH_USER' | 'VIDEO_ROOM_DEV_AUTH_PASSWORD'>,
): string {
  if (env?.ENV !== 'dev' || !env.DEV_BASIC_AUTH_USER || !env.DEV_BASIC_AUTH_PASSWORD) {
    return rawUrl;
  }
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return rawUrl;
    url.username = env.VIDEO_ROOM_DEV_AUTH_USER || env.DEV_BASIC_AUTH_USER;
    url.password = env.VIDEO_ROOM_DEV_AUTH_PASSWORD || env.DEV_BASIC_AUTH_PASSWORD;
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function mintGuestToken(
  db: D1Database,
  roomId: string,
  participantId: string | null,
): Promise<string> {
  const guestToken = generateRoomToken();
  const guestHash = await hashRoomToken(guestToken);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  await db.prepare(
    `INSERT INTO meeting_room_tokens (id, room_id, token_hash, role, participant_id, expires_at, created_at)
     VALUES (?, ?, ?, 'GUEST', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), roomId, guestHash, participantId, expiresAt, now).run();
  return guestToken;
}

export const meetingsAuth = new Hono<{ Bindings: Env; Variables: Variables }>();
meetingsAuth.use('*', authMiddleware);

// POST / — create a meeting + room + host token
meetingsAuth.post('/', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json().catch(() => ({}));
  const parsed = createMeetingSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }
  const data = parsed.data;

  // Resolve a contact when contactId is provided; otherwise create one from recipient info.
  let contactId: string | null = null;
  if (data.contactId) {
    const contact = await db
      .prepare('SELECT id FROM contacts WHERE id = ? AND owner_id = ?')
      .bind(data.contactId, userId)
      .first<{ id: string }>();
    if (!contact) return apiError(c, 'NOT_FOUND', 'Contact not found.');
    contactId = contact.id;
  } else if (data.recipientEmail && data.recipientName) {
    // Reuse an existing contact with this email if present, else create one.
    const existing = await db
      .prepare('SELECT id FROM contacts WHERE owner_id = ? AND email = ?')
      .bind(userId, data.recipientEmail)
      .first<{ id: string }>();
    if (existing) {
      contactId = existing.id;
    } else {
      contactId = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO contacts (id, owner_id, email, name, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'lead', ?, ?)`,
      ).bind(contactId, userId, data.recipientEmail, data.recipientName, now, now).run();
    }
  }

  const meetingId = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = data.title ?? (data.recipientName ?? 'Meeting');
  const meetingType = data.meetingType ?? 'OTHER';

  await db.prepare(
    `INSERT INTO meetings
     (id, owner_id, title, description, status, scheduled_at, meeting_type,
      scheduled_interview_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?)`,
  ).bind(
    meetingId, userId, title, data.description ?? null,
    data.scheduledAt ?? null, meetingType,
    data.scheduledInterviewId ?? null, now, now,
  ).run();

  // Link the contact as a participant (ATTENDEE; host is the recruiter).
  if (contactId) {
    await db.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at, updated_at)
       VALUES (?, ?, ?, 'ATTENDEE', ?, ?)`,
    ).bind(crypto.randomUUID(), meetingId, contactId, now, now).run();
  }

  const { room, hostToken } = await createRoomAndHostToken(db, meetingId, userId);

  return c.json({
    meeting: {
      id: meetingId,
      title,
      description: data.description ?? null,
      status: 'SCHEDULED',
      meetingType,
      scheduledAt: data.scheduledAt ?? null,
      scheduledInterviewId: data.scheduledInterviewId ?? null,
      contactId,
    },
    room: { id: room.id, sessionId: room.session_id, status: room.status },
    hostToken,
  }, 201);
});

// GET / — list owner's meetings with room status + participants
meetingsAuth.get('/', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const meetings = await db.prepare(
    `SELECT m.* FROM meetings m
     WHERE m.owner_id = ?
     ORDER BY m.created_at DESC
     LIMIT 100`,
  ).bind(userId).all<MeetingRow>();

  if (!meetings.results.length) {
    return c.json({ meetings: [] });
  }

  const meetingIds = meetings.results.map((m) => m.id);
  const placeholders = meetingIds.map(() => '?').join(',');
  const rooms = await db.prepare(
    `SELECT mr.* FROM meeting_rooms mr
     WHERE mr.meeting_id IN (${placeholders})`,
  ).bind(...meetingIds).all<RoomRow>();

  const participants = await db.prepare(
    `SELECT mp.meeting_id, mp.role, c.id AS contact_id, c.name, c.email
     FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.meeting_id IN (${placeholders})`,
  ).bind(...meetingIds).all<{
    meeting_id: string; role: string; contact_id: string; name: string | null; email: string | null;
  }>();

  const roomsByMeeting = new Map(rooms.results.map((r) => [r.meeting_id, r]));
  const participantsByMeeting = new Map<string, Array<{
    role: string; contactId: string; name: string | null; email: string | null;
  }>>();
  for (const p of participants.results) {
    const list = participantsByMeeting.get(p.meeting_id) ?? [];
    list.push({ role: p.role, contactId: p.contact_id, name: p.name, email: p.email });
    participantsByMeeting.set(p.meeting_id, list);
  }

  const result = meetings.results.map((m) => {
    const room = roomsByMeeting.get(m.id);
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      status: m.status,
      meetingType: m.meeting_type,
      scheduledAt: m.scheduled_at,
      startedAt: m.started_at,
      endedAt: m.ended_at,
      durationSecs: m.duration_secs,
      transcriptStatus: m.transcript_status,
      recordingR2Key: m.recording_r2_key,
      scheduledInterviewId: m.scheduled_interview_id,
      room: room ? { id: room.id, sessionId: room.session_id, status: room.status } : null,
      participants: participantsByMeeting.get(m.id) ?? [],
      createdAt: m.created_at,
    };
  });

  return c.json({ meetings: result });
});

// GET /:id — meeting detail with transcript status
meetingsAuth.get('/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const meeting = await db.prepare(
    'SELECT * FROM meetings WHERE id = ? AND owner_id = ?',
  ).bind(id, userId).first<MeetingRow>();
  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const room = await db.prepare(
    'SELECT * FROM meeting_rooms WHERE meeting_id = ?',
  ).bind(id).first<RoomRow>();

  const participants = await db.prepare(
    `SELECT mp.role, mp.joined_at, mp.left_at, c.id AS contact_id, c.name, c.email
     FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.meeting_id = ?`,
  ).bind(id).all<{
    role: string; joined_at: string | null; left_at: string | null;
    contact_id: string; name: string | null; email: string | null;
  }>();

  return c.json({
    meeting: {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      status: meeting.status,
      meetingType: meeting.meeting_type,
      scheduledAt: meeting.scheduled_at,
      startedAt: meeting.started_at,
      endedAt: meeting.ended_at,
      durationSecs: meeting.duration_secs,
      transcriptStatus: meeting.transcript_status,
      transcriptSummary: meeting.transcript_summary,
      recordingR2Key: meeting.recording_r2_key,
      scheduledInterviewId: meeting.scheduled_interview_id,
      room: room ? { id: room.id, sessionId: room.session_id, status: room.status } : null,
      participants: participants.results.map((p) => ({
        role: p.role,
        joinedAt: p.joined_at,
        leftAt: p.left_at,
        contactId: p.contact_id,
        name: p.name,
        email: p.email,
      })),
      createdAt: meeting.created_at,
      updatedAt: meeting.updated_at,
    },
  });
});

// POST /:id/room — create/reopen a standalone video room for a meeting.
meetingsAuth.post('/:id/room', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const meeting = await db.prepare(
    'SELECT id FROM meetings WHERE id = ? AND owner_id = ?',
  ).bind(id, userId).first<{ id: string }>();
  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const room = await ensureMeetingRoomLinks(
    db,
    meeting.id,
    c.env.VIDEO_ROOM_APP_URL ?? 'http://localhost:5175',
    c.env,
  );

  return c.json({ room });
});

// POST /:id/transcript/retry — reprocess an already-saved recording.
meetingsAuth.post('/:id/transcript/retry', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const resolved = await resolveMeetingRecording(c.env.DB, id, userId);
  if (!resolved) return apiError(c, 'NOT_FOUND', 'Meeting not found.');
  if (!resolved.recordingKey) {
    return apiError(c, 'VALIDATION_ERROR', 'No saved recording is available to transcribe.');
  }

  const recordingHead = await c.env.STORAGE.head(resolved.recordingKey).catch(() => null);
  if (!recordingHead) {
    return apiError(c, 'NOT_FOUND', 'Saved recording was not found in storage.');
  }

  let transcriptionSourceKey = resolved.recordingKey;
  const transcriptionKey = transcriptionAudioKeyFor(resolved.recordingKey);
  if (transcriptionKey) {
    const transcriptionHead = await c.env.STORAGE.head(transcriptionKey).catch(() => null);
    if (transcriptionHead) transcriptionSourceKey = transcriptionKey;
  }

  await c.env.DB.prepare(
    `UPDATE meetings
        SET transcript_status = 'PROCESSING',
            transcript_error = NULL,
            updated_at = ?
      WHERE id = ?`,
  ).bind(new Date().toISOString(), id).run();

  c.executionCtx.waitUntil(processRecording(
    c.env,
    resolved.room,
    transcriptionSourceKey,
    resolved.recordingKey,
  ));
  return c.json({ accepted: true, transcriptStatus: 'PROCESSING' }, 202);
});

// POST /:id/invite — mint a guest token and send via Resend with the join link
meetingsAuth.post('/:id/invite', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const meeting = await db.prepare(
    'SELECT id, title, owner_id FROM meetings WHERE id = ? AND owner_id = ?',
  ).bind(id, userId).first<{ id: string; title: string; owner_id: string }>();
  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const room = await db.prepare(
    'SELECT id FROM meeting_rooms WHERE meeting_id = ?',
  ).bind(id).first<{ id: string }>();
  if (!room) return apiError(c, 'NOT_FOUND', 'Meeting room not found.');

  const body = await c.req.json().catch(() => ({}));
  const parsed = inviteGuestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }
  const { email, message: customMessage } = parsed.data;

  // Resolve the participant for this email (must already be a meeting_participant).
  const participant = await db.prepare(
    `SELECT mp.id, c.name FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.meeting_id = ? AND c.email = ?`,
  ).bind(id, email).first<{ id: string; name: string | null }>();

  const guestToken = await mintGuestToken(db, room.id, participant?.id ?? null);

  const baseUrl = (c.env.VIDEO_ROOM_APP_URL ?? c.env.APP_BASE_URL ?? 'https://pipe.build').replace(/\/$/, '');
  const joinUrl = withDevBasicAuth(`${baseUrl}/room/${guestToken}`, c.env);
  const escapeHtml = (str: string): string =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const guestName = escapeHtml(participant?.name ?? email.split('@')[0] ?? 'there');
  const safeJoinUrl = encodeURI(joinUrl);
  const customBlock = customMessage
    ? `<p style="font-size:16px;line-height:1.6;margin-bottom:24px;padding:16px;background:rgba(255,255,255,0.05);border-left:3px solid rgba(96,165,250,0.4);border-radius:4px;">${escapeHtml(customMessage)}</p>`
    : '';

  const html = `<div style="font-family:'Space Mono',monospace;max-width:600px;margin:0 auto;padding:40px 20px;color:#e0e0e0;background:#0c0c0e;">
  <h1 style="font-size:24px;font-weight:700;margin-bottom:24px;color:#fff;">Hi ${guestName},</h1>
  <p style="font-size:16px;line-height:1.6;margin-bottom:24px;">
    You've been invited to a video call for <strong>${escapeHtml(meeting.title)}</strong>.
  </p>
  ${customBlock}
  <a href="${safeJoinUrl}" style="display:inline-block;padding:14px 32px;background:#fff;color:#0c0c0e;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.5px;border:none;">
    JOIN VIDEO CALL →
  </a>
  <p style="font-size:12px;color:#666;margin-top:40px;">
    If the button doesn't work, copy this link:<br/>
    <a href="${safeJoinUrl}" style="color:#888;">${escapeHtml(joinUrl)}</a>
  </p>
</div>`;

  let emailResult: Awaited<ReturnType<typeof sendTransactionalEmail>> | null = null;
  try {
    emailResult = await sendTransactionalEmail(c.env, {
      to: email,
      subject: `Video call invitation — ${meeting.title}`,
      html,
    });
  } catch (err) {
    console.error('[meetings/invite] Email send failed:', err);
    return c.json({ success: false, emailSent: false, joinUrl }, 502);
  }

  if (!emailResult) {
    // No email service — return the join link directly (dev/test path).
    return c.json({ success: true, emailSent: false, joinUrl, guestToken });
  }

  const now = new Date().toISOString();
  if (participant?.id) {
    await db.prepare(
      `UPDATE meeting_participants SET invite_sent_at = COALESCE(invite_sent_at, ?), updated_at = ?
       WHERE meeting_id = ? AND id = ?`,
    ).bind(now, now, id, participant.id).run();
  }

  return c.json({
    success: true,
    emailSent: true,
    joinUrl,
    provider: emailResult.provider,
  });
});

// GET /:id/interaction-context — source-backed interaction context for a meeting.
// Keeps transcript/interaction evidence separately reviewable from accumulated
// person projections. Returns the shared immutable transcript artifact, its
// exact source spans, and per-participant derived assertions/context records.
meetingsAuth.get('/:id/interaction-context', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const meeting = await db.prepare(
    'SELECT id FROM meetings WHERE id = ? AND owner_id = ?',
  ).bind(id, userId).first<{ id: string }>();
  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const context = await loadMeetingTranscriptContext(db, id);
  if (!context) return apiError(c, 'NOT_FOUND', 'Meeting interaction context not found.');

  return c.json(context);
});

// GET /:id/transcript/search?q= — search original transcript text for a meeting.
// Returns explainable hits that point back to exact source spans (with
// char/line/timestamp offsets) plus the assertions/context records citing them.
meetingsAuth.get('/:id/transcript/search', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const meeting = await db.prepare(
    'SELECT id FROM meetings WHERE id = ? AND owner_id = ?',
  ).bind(id, userId).first<{ id: string }>();
  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const query = c.req.query('q') ?? '';
  if (!query.trim()) {
    return apiError(c, 'VALIDATION_ERROR', 'query parameter "q" is required');
  }

  const result = await searchTranscriptSourceSpans(db, id, query);
  return c.json(result);
});
