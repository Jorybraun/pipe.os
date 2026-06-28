import {
  AssessmentLayerStore,
  type AssessmentSessionMode,
  type AssessmentSessionState,
} from './persistence';
import { stableJson } from '../livingContext/persistence';
import type { JsonObject, JsonValue } from '../livingContext/types';
import type { DevContainerSessionRow, DevContainerStatus } from '../devContainerSessions';

export type DevContainerLifecycleEvent =
  | 'launching'
  | 'ready'
  | 'sleeping'
  | 'warned'
  | 'error'
  | 'stopped'
  | 'expired';

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
  ).bind(tableName).first<{ name: string }>();
  return Boolean(row);
}

async function hasAssessmentSchema(db: D1Database): Promise<boolean> {
  return await tableExists(db, 'assessment_sessions')
    && await tableExists(db, 'context_records')
    && await tableExists(db, 'context_record_source_refs');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
    reason: 'Dev-container lifecycle event captured as assessment evidence.',
    actorType: 'system',
  });
}

function modeForSession(row: DevContainerSessionRow): AssessmentSessionMode {
  if (row.access_scope === 'meeting_room') return 'DEV_CONTAINER_REPO_TASK';
  if (row.challenge_id || row.repo_git_url) return 'DEV_CONTAINER_CHALLENGE';
  return 'TECHNICAL';
}

function interviewIdForSession(row: DevContainerSessionRow): string {
  return row.challenge_id
    ?? row.meeting_id
    ?? row.pipeline_id
    ?? row.session_id;
}

function eventTimestamp(row: DevContainerSessionRow, event: DevContainerLifecycleEvent): string {
  switch (event) {
    case 'launching':
      return row.created_at;
    case 'ready':
      return row.started_at ?? row.updated_at;
    case 'warned':
      return row.warned_at ?? row.updated_at;
    case 'stopped':
    case 'expired':
      return row.stopped_at ?? row.updated_at;
    case 'error':
    case 'sleeping':
      return row.updated_at;
  }
}

function sourceSnapshot(row: DevContainerSessionRow, event: DevContainerLifecycleEvent): JsonObject {
  return {
    sourceKind: 'dev_container_sessions.row',
    lifecycleEvent: event,
    sessionId: row.session_id,
    candidateId: row.candidate_id,
    challengeId: row.challenge_id,
    pipelineId: row.pipeline_id,
    meetingId: row.meeting_id,
    meetingRoomId: row.meeting_room_id,
    ownerId: row.owner_id,
    accessScope: row.access_scope,
    status: row.status,
    instanceType: row.instance_type,
    ttlSeconds: row.ttl_seconds,
    ttlSource: row.ttl_source,
    expiresAt: row.expires_at,
    warnedAt: row.warned_at,
    repoGitUrl: row.repo_git_url,
    challengeBranch: row.challenge_branch,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function statusFromLifecycleEvent(event: DevContainerLifecycleEvent): DevContainerStatus | 'WARNED' {
  switch (event) {
    case 'launching':
      return 'LAUNCHING';
    case 'ready':
      return 'READY';
    case 'sleeping':
      return 'SLEEPING';
    case 'warned':
      return 'WARNED';
    case 'error':
      return 'ERROR';
    case 'stopped':
      return 'STOPPED';
    case 'expired':
      return 'EXPIRED';
  }
}

async function eventKey(
  row: DevContainerSessionRow,
  event: DevContainerLifecycleEvent,
  exactText: string,
): Promise<string> {
  if (event === 'error') {
    return `assessment-event:dev-container:${row.session_id}:error:${await sha256Hex(row.error_message ?? exactText)}`;
  }
  return `assessment-event:dev-container:${row.session_id}:${event}:${eventTimestamp(row, event)}`;
}

function narrativeForEvent(row: DevContainerSessionRow, event: DevContainerLifecycleEvent): string {
  const repo = row.repo_git_url ? ` for ${row.repo_git_url}` : '';
  switch (event) {
    case 'launching':
      return `Dev-container session is launching${repo}.`;
    case 'ready':
      return `Dev-container session is ready${repo}.`;
    case 'sleeping':
      return `Dev-container session is sleeping${repo}.`;
    case 'warned':
      return `Dev-container session is nearing TTL expiry${repo}.`;
    case 'error':
      return `Dev-container session failed${row.error_message ? `: ${row.error_message}` : ''}.`;
    case 'stopped':
      return `Dev-container session was stopped${repo}.`;
    case 'expired':
      return `Dev-container session expired after its TTL${repo}.`;
  }
}

export async function ingestDevContainerAssessmentEvidence(
  db: D1Database,
  row: DevContainerSessionRow,
  event: DevContainerLifecycleEvent,
): Promise<void> {
  if (!await hasAssessmentSchema(db)) return;

  const observedAt = eventTimestamp(row, event);
  const store = new AssessmentLayerStore(db, () => observedAt);
  const snapshot = sourceSnapshot(row, event);
  const exactText = stableJson(snapshot as JsonValue);
  const session = await store.createAssessmentSession({
    ingestionKey: `assessment-session:dev-container:${row.session_id}`,
    interviewId: interviewIdForSession(row),
    mode: modeForSession(row),
    candidateId: row.candidate_id,
    workspaceId: row.owner_id,
    createdBy: 'dev-container-session-lifecycle',
    metadata: {
      sessionId: row.session_id,
      candidateId: row.candidate_id,
      challengeId: row.challenge_id,
      pipelineId: row.pipeline_id,
      meetingId: row.meeting_id,
      meetingRoomId: row.meeting_room_id,
      ownerId: row.owner_id,
      accessScope: row.access_scope,
      repoGitUrl: row.repo_git_url,
      challengeBranch: row.challenge_branch,
      source: 'dev_container_sessions',
    },
  });

  await store.recordAssessmentEvent({
    sessionId: session.id,
    ingestionKey: await eventKey(row, event, exactText),
    kind: 'dev_container_event',
    actorType: 'dev_container',
    actorId: row.session_id,
    narrative: narrativeForEvent(row, event),
    payload: {
      lifecycleEvent: event,
      status: row.status,
      statusEvent: statusFromLifecycleEvent(event),
      sessionId: row.session_id,
      accessScope: row.access_scope,
      candidateId: row.candidate_id,
      challengeId: row.challenge_id,
      pipelineId: row.pipeline_id,
      meetingId: row.meeting_id,
      meetingRoomId: row.meeting_room_id,
      repoGitUrl: row.repo_git_url,
      challengeBranch: row.challenge_branch,
      errorMessage: row.error_message,
    },
    occurredAt: observedAt,
    sourceRefs: [{
      sourceRefType: 'dev_container_session',
      sourceRefId: row.session_id,
      evidenceRole: event,
      locator: {
        sessionId: row.session_id,
        status: row.status,
        lifecycleEvent: event,
        updatedAt: row.updated_at,
      },
      exactText,
      contentHash: await sha256Hex(exactText),
      metadata: {
        sourceKind: 'dev_container_sessions.row',
        accessScope: row.access_scope,
        status: row.status,
      },
    }],
  });

  await markAssessmentSessionInProgress({ db, store, sessionId: session.id });
}

export async function tryIngestDevContainerAssessmentEvidence(
  db: D1Database,
  row: DevContainerSessionRow,
  event: DevContainerLifecycleEvent,
): Promise<void> {
  try {
    await ingestDevContainerAssessmentEvidence(db, row, event);
  } catch (error) {
    console.error('[devContainerEvidence] failed to persist assessment evidence:', {
      sessionId: row.session_id,
      event,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
