/**
 * sessionEvents.ts — Capture meeting session events as source-backed evidence.
 *
 * Every event during a meeting (AI chat, terminal I/O, file changes,
 * browser navigation, window state) is preserved as both the legacy
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

export type SessionEventType =
  | 'chat_message'
  | 'ai_chat_user'
  | 'ai_chat_agent'
  | 'ai_agent_status'
  | 'terminal_command'
  | 'terminal_output'
  | 'file_change'
  | 'browser_navigation'
  | 'window_open'
  | 'window_close'
  | 'window_update'
  | 'window_focus'
  | 'cursor_presence'
  | 'media_control'
  | 'room_surface_change'
  | 'workspace_state'
  | 'participant_join'
  | 'participant_leave'
  | 'clippy_prompt'
  | 'clippy_action'
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

interface RoomActivitySyncEnv {
  VIDEO_ROOM?: DurableObjectNamespace;
  NEO4J_URI?: string;
  NEO4J_USER?: string;
  NEO4J_PASSWORD?: string;
}

interface RoomActivitySyncInput {
  candidateId: string;
  sessionId: string;
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

function isRoomActivityRole(value: unknown): value is RoomActivityRole {
  return value === 'RECRUITER' || value === 'CANDIDATE' || value === 'HOST' || value === 'GUEST';
}

function actorFromRoomRole(value: unknown): SessionEvent['actor'] {
  if (value === 'HOST' || value === 'RECRUITER') return 'host';
  if (value === 'GUEST' || value === 'CANDIDATE') return 'guest';
  return 'system';
}

function unixTimestampFromActivity(primary: unknown, fallback: unknown): number {
  const value = numberOrNull(primary) ?? numberOrNull(fallback) ?? Date.now();
  return Math.floor(value > 10_000_000_000 ? value / 1000 : value);
}

function compactPreview(value: unknown, maxLength = 1000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
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
  return {
    type: event.type,
    sessionId: input.sessionId,
    candidateId: input.candidateId,
    timestamp: event.timestamp,
    actor: event.actor,
    text: event.text,
    properties: event.properties,
  };
}

function desktopActivityToSessionEvent(input: RoomActivitySyncInput, value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isRecord(value.event)) return null;
  const event = value.event;
  const role = isRoomActivityRole(value.role) ? value.role : null;
  const actor = actorFromRoomRole(role);
  const timestamp = unixTimestampFromActivity(event.createdAt, value.recordedAt);
  const base = roomActivityBaseProperties('desktop', role, value.recordedAt);
  const eventId = stringOrNull(event.id);
  const clientId = stringOrNull(event.clientId);
  if (eventId) base.roomEventId = eventId;
  if (clientId) base.clientId = clientId;

  if (event.kind === 'SET_ROOM_SURFACE') {
    const surface = stringOrNull(event.surface);
    if (!surface) return null;
    return createSessionEvent(input, {
      type: 'room_surface_change',
      timestamp,
      actor,
      text: `Room surface changed to ${surface}`,
      properties: { ...base, surface },
    });
  }

  if (event.kind === 'WORKSPACE_STATE_CHANGED') {
    const status = stringOrNull(event.status) ?? 'unknown';
    const properties: Record<string, unknown> = { ...base, workspaceStatus: status };
    const workspaceSessionId = stringOrNull(event.workspaceSessionId);
    const errorMessage = stringOrNull(event.errorMessage);
    const repoUrl = stringOrNull(event.repoUrl);
    const githubPrNumber = numberOrNull(event.githubPrNumber);
    const matchedRepoId = numberOrNull(event.matchedRepoId);
    const challengeStatus = stringOrNull(event.challengeStatus);
    const challengeKind = stringOrNull(event.challengeKind);
    const challengeSource = stringOrNull(event.challengeSource);
    const challengeMessage = stringOrNull(event.challengeMessage);
    const ttlSeconds = numberOrNull(event.ttlSeconds);
    const ttlSource = stringOrNull(event.ttlSource);
    const expiresAt = stringOrNull(event.expiresAt);
    const source = stringOrNull(event.source);
    if (workspaceSessionId) properties.workspaceSessionId = workspaceSessionId;
    if (errorMessage) properties.errorMessage = errorMessage;
    if (repoUrl) properties.repoUrl = repoUrl;
    if (githubPrNumber !== null) properties.githubPrNumber = githubPrNumber;
    if (matchedRepoId !== null) properties.matchedRepoId = matchedRepoId;
    if (challengeStatus) properties.challengeStatus = challengeStatus;
    if (challengeKind) properties.challengeKind = challengeKind;
    if (challengeSource) properties.challengeSource = challengeSource;
    if (challengeMessage) properties.challengeMessage = challengeMessage;
    if (typeof event.canLaunch === 'boolean') properties.canLaunch = event.canLaunch;
    if (ttlSeconds !== null) properties.ttlSeconds = ttlSeconds;
    if (ttlSource) properties.ttlSource = ttlSource;
    if (expiresAt) properties.expiresAt = expiresAt;
    if (typeof event.expiringSoon === 'boolean') properties.expiringSoon = event.expiringSoon;
    if (source) properties.source = source;
    return createSessionEvent(input, {
      type: 'workspace_state',
      timestamp,
      actor,
      text: `Workspace state changed to ${status}`,
      properties,
    });
  }

  if (event.kind === 'OPEN_WINDOW' && isRecord(event.window)) {
    const title = stringOrNull(event.window.title);
    const windowId = stringOrNull(event.window.id);
    const windowType = stringOrNull(event.window.windowType);
    if (!title || !windowId || !windowType) return null;
    return createSessionEvent(input, {
      type: 'window_open',
      timestamp,
      actor,
      text: title,
      properties: { ...base, windowId, windowType },
    });
  }

  if (event.kind === 'CLOSE_WINDOW') {
    const windowId = stringOrNull(event.windowId);
    if (!windowId) return null;
    return createSessionEvent(input, {
      type: 'window_close',
      timestamp,
      actor,
      text: windowId,
      properties: { ...base, windowId },
    });
  }

  if (event.kind === 'UPDATE_WINDOW_DATA') {
    const windowId = stringOrNull(event.windowId);
    if (!windowId || !isRecord(event.data)) return null;
    const currentUrl = stringOrNull(event.data.currentUrl);
    if (currentUrl) {
      return createSessionEvent(input, {
        type: 'browser_navigation',
        timestamp,
        actor,
        text: currentUrl,
        properties: { ...base, windowId },
      });
    }
    return createSessionEvent(input, {
      type: 'window_update',
      timestamp,
      actor,
      text: windowId,
      properties: { ...base, windowId, keys: Object.keys(event.data).sort() },
    });
  }

  if (event.kind === 'UPDATE_WINDOW_STATE') {
    const windowId = stringOrNull(event.windowId);
    if (!windowId) return null;
    const statePatch: Record<string, unknown> = {};
    for (const key of ['x', 'y', 'width', 'height', 'minimized', 'maximized', 'focused']) {
      const valueAtKey = event[key];
      if (typeof valueAtKey === 'number' || typeof valueAtKey === 'boolean') {
        statePatch[key] = valueAtKey;
      }
    }
    const stateKeys = Object.keys(statePatch).sort();
    if (stateKeys.length === 0) return null;
    return createSessionEvent(input, {
      type: 'window_update',
      timestamp,
      actor,
      text: windowId,
      properties: {
        ...base,
        windowId,
        statePatch,
        stateKeys,
      },
    });
  }

  return null;
}

function chatActivityToSessionEvent(input: RoomActivitySyncInput, value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isRecord(value.message)) return null;
  const message = value.message;
  const role = isRoomActivityRole(value.role)
    ? value.role
    : isRoomActivityRole(message.role)
      ? message.role
      : null;
  const text = stringOrNull(message.text);
  if (!text) return null;
  const properties = roomActivityBaseProperties('chat', role, value.recordedAt);
  const messageId = stringOrNull(message.id);
  const clientId = stringOrNull(message.clientId);
  if (messageId) properties.roomMessageId = messageId;
  if (clientId) properties.clientId = clientId;
  return createSessionEvent(input, {
    type: 'chat_message',
    timestamp: unixTimestampFromActivity(message.createdAt, value.recordedAt),
    actor: actorFromRoomRole(role),
    text,
    properties,
  });
}

function clippyPromptActivityToSessionEvent(input: RoomActivitySyncInput, value: unknown): SessionEvent | null {
  if (!isRecord(value) || !isRecord(value.prompt)) return null;
  const prompt = value.prompt;
  const text = stringOrNull(prompt.text);
  if (!text) return null;
  const role = isRoomActivityRole(value.role) ? value.role : null;
  const properties = roomActivityBaseProperties('clippy_prompt', role, value.recordedAt);
  const promptId = stringOrNull(prompt.id);
  const clientId = stringOrNull(prompt.clientId);
  const promptSource = stringOrNull(prompt.source);
  if (promptId) properties.promptId = promptId;
  if (clientId) properties.clientId = clientId;
  if (promptSource) properties.promptSource = promptSource;
  if (typeof prompt.hold === 'boolean') properties.hold = prompt.hold;
  if (Array.isArray(prompt.targetRoles)) properties.targetRoles = prompt.targetRoles.filter(isRoomActivityRole);
  if (Array.isArray(prompt.actions)) {
    properties.actions = prompt.actions
      .filter(isRecord)
      .map((action) => ({
        id: stringOrNull(action.id),
        label: stringOrNull(action.label),
      }))
      .filter((action) => action.id && action.label);
  }
  return createSessionEvent(input, {
    type: 'clippy_prompt',
    timestamp: unixTimestampFromActivity(prompt.createdAt, value.recordedAt),
    actor: actorFromRoomRole(role),
    text,
    properties,
  });
}

async function fileSystemActivityToSessionEvent(input: RoomActivitySyncInput, value: unknown): Promise<SessionEvent | null> {
  if (!isRecord(value) || !isRecord(value.event)) return null;
  const event = value.event;
  const role = isRoomActivityRole(value.role) ? value.role : null;
  const properties = roomActivityBaseProperties('file_system', role, value.recordedAt);
  const eventId = stringOrNull(event.id);
  const clientId = stringOrNull(event.clientId);
  if (eventId) properties.roomEventId = eventId;
  if (clientId) properties.clientId = clientId;

  if (event.kind === 'UPSERT_FILE' && isRecord(event.file)) {
    const file = event.file;
    const fileId = stringOrNull(file.id);
    const name = stringOrNull(file.name);
    const fileKind = stringOrNull(file.kind);
    if (!fileId || !name || !fileKind) return null;
    properties.operation = 'upsert';
    properties.fileId = fileId;
    properties.fileName = name;
    properties.fileKind = fileKind;
    const mimeType = stringOrNull(file.mimeType);
    if (mimeType) properties.mimeType = mimeType;
    if (typeof file.content === 'string') {
      properties.contentLength = file.content.length;
      properties.contentHash = await deterministicEntityId('content', file.content);
      const preview = compactPreview(file.content);
      if (preview && fileKind !== 'paint') properties.contentPreview = preview;
    }
    return createSessionEvent(input, {
      type: 'file_change',
      timestamp: unixTimestampFromActivity(event.createdAt, value.recordedAt),
      actor: actorFromRoomRole(role),
      text: name,
      properties,
    });
  }

  if (event.kind === 'DELETE_FILE') {
    const fileId = stringOrNull(event.fileId);
    if (!fileId) return null;
    properties.operation = 'delete';
    properties.fileId = fileId;
    let text = fileId;
    if (isRecord(event.file)) {
      const file = event.file;
      const name = stringOrNull(file.name);
      const fileKind = stringOrNull(file.kind);
      const mimeType = stringOrNull(file.mimeType);
      if (name) {
        properties.fileName = name;
        text = name;
      }
      if (fileKind) properties.fileKind = fileKind;
      if (mimeType) properties.mimeType = mimeType;
      if (typeof file.content === 'string') {
        properties.deletedContentLength = file.content.length;
        properties.deletedContentHash = await deterministicEntityId('content', file.content);
        const preview = compactPreview(file.content);
        if (preview && fileKind !== 'paint') properties.deletedContentPreview = preview;
      }
      const createdAt = numberOrNull(file.createdAt);
      const updatedAt = numberOrNull(file.updatedAt);
      if (createdAt !== null) properties.deletedFileCreatedAt = createdAt;
      if (updatedAt !== null) properties.deletedFileUpdatedAt = updatedAt;
    }
    return createSessionEvent(input, {
      type: 'file_change',
      timestamp: unixTimestampFromActivity(event.createdAt, value.recordedAt),
      actor: actorFromRoomRole(role),
      text,
      properties,
    });
  }

  return null;
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

  const desktopActivityLog = Array.isArray(snapshot.desktopActivityLog) ? snapshot.desktopActivityLog : [];
  const chatActivityLog = Array.isArray(snapshot.chatActivityLog) ? snapshot.chatActivityLog : [];
  const clippyPromptActivityLog = Array.isArray(snapshot.clippyPromptActivityLog)
    ? snapshot.clippyPromptActivityLog
    : [];
  const fileSystemActivityLog = Array.isArray(snapshot.fileSystemActivityLog) ? snapshot.fileSystemActivityLog : [];

  desktopActivityLog.forEach((entry) => pushMapped(desktopActivityToSessionEvent(input, entry)));
  chatActivityLog.forEach((entry) => pushMapped(chatActivityToSessionEvent(input, entry)));
  clippyPromptActivityLog.forEach((entry) => pushMapped(clippyPromptActivityToSessionEvent(input, entry)));
  for (const entry of fileSystemActivityLog) {
    pushMapped(await fileSystemActivityToSessionEvent(input, entry));
  }

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
    browser_navigation: 'session_browser_nav',
    window_open: 'session_window_open',
    window_close: 'session_window_close',
    window_update: 'session_window_update',
    window_focus: 'session_window_focus',
    cursor_presence: 'session_cursor_presence',
    media_control: 'session_media_control',
    room_surface_change: 'session_room_surface_change',
    workspace_state: 'session_workspace_state',
    participant_join: 'session_participant_join',
    participant_leave: 'session_participant_leave',
    clippy_prompt: 'session_clippy_prompt',
    clippy_action: 'session_clippy_action',
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
      return `[${time}] File ${event.properties?.action ?? 'changed'}: ${event.text}`;
    case 'browser_navigation':
      return `[${time}] Browser navigated to: ${event.text}`;
    case 'window_open':
      return `[${time}] Window opened: ${event.text}`;
    case 'window_close':
      return `[${time}] Window closed: ${event.text}`;
    case 'window_update':
      return `[${time}] Window updated: ${event.text}`;
    case 'window_focus':
      return `[${time}] Window focused: ${event.text}`;
    case 'cursor_presence':
      return `[${time}] ${event.text}`;
    case 'media_control':
      return `[${time}] Media control changed: ${event.text}`;
    case 'room_surface_change':
      return `[${time}] ${event.text}`;
    case 'workspace_state':
      return `[${time}] ${event.text}`;
    case 'participant_join':
      return `[${time}] Participant joined: ${event.text}`;
    case 'participant_leave':
      return `[${time}] Participant left: ${event.text}`;
    case 'clippy_prompt':
      return `[${time}] Clippy prompted: "${event.text}"`;
    case 'clippy_action':
      return `[${time}] ${event.text}`;
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

  const windowId = stringProperty(properties, 'windowId');
  if (windowId) {
    entities.push({
      entityType: 'room_window',
      entityId: windowId,
      relationship: 'affected_window',
      metadata: {
        windowType: stringProperty(properties, 'windowType'),
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

  return entities;
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
  const sourcePayload: JsonObject = {
    type: event.type,
    sessionId: event.sessionId,
    candidateId: event.candidateId,
    timestamp: event.timestamp,
    actor: event.actor,
    text: event.text,
    properties,
    candidateNodeId: node.id,
  };
  const contentHash = await deterministicEntityId('content', stableJson(sourcePayload));
  const sourceSpanId = await findCandidateNodeSourceSpanId(db, node.id);
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
      exactText: event.text,
      contentHash,
      metadata: {
        nodeType: node.node_type,
        sourceType: node.source_type,
        sourceReference: node.source_reference ?? null,
      },
    },
  ];
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
    const payload = eventToNodePayload(event);
    const node = await insertCandidateNode(db, payload, {
      ingestionKeyOverride: sessionEventIngestionKey(event),
    });
    await persistSessionEventContextRecord(db, event, node);

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
      lines.push(node.narrativeText);
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
): Promise<{ candidateId: string | null; sessionId: string; meetingId: string } | null> {
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
  };
}
