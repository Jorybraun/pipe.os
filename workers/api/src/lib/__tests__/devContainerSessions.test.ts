import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import {
  insertRoomSession,
  insertSession,
  markError,
  markStatus,
  markStopped,
  markWarned,
} from '../devContainerSessions';

const livingContextMigrationSql = readFileSync(
  new URL('../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigrationSql = readFileSync(
  new URL('../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const assessmentLayerMigrationSql = readFileSync(
  new URL('../../../migrations/0102_assessment_layer.sql', import.meta.url),
  'utf8',
);

function createDevContainerSessionsTable(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    CREATE TABLE dev_container_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      candidate_id TEXT,
      challenge_id TEXT,
      pipeline_id TEXT,
      meeting_id TEXT,
      meeting_room_id TEXT,
      owner_id TEXT,
      access_scope TEXT NOT NULL DEFAULT 'candidate',
      status TEXT NOT NULL DEFAULT 'LAUNCHING',
      instance_type TEXT NOT NULL DEFAULT 'standard-1',
      ttl_seconds INTEGER NOT NULL,
      ttl_source TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      warned_at TEXT,
      url TEXT,
      repo_r2_key TEXT,
      repo_git_url TEXT,
      challenge_branch TEXT,
      base_commit_sha TEXT,
      base_branch TEXT,
      started_at TEXT,
      stopped_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-06-28T07:00:00.000Z',
      updated_at TEXT NOT NULL DEFAULT '2026-06-28T07:00:00.000Z'
    );
  `);
}

function count(sqlite: BetterSqliteDb, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe('devContainerSessions assessment evidence', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigrationSql);
    sqlite.exec(contextRecordsMigrationSql);
    sqlite.exec(assessmentLayerMigrationSql);
    createDevContainerSessionsTable(sqlite);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('captures room dev-container lifecycle rows as immutable assessment evidence', async () => {
    await insertRoomSession(db, {
      id: 'row-room-1',
      sessionId: 'room-session-1',
      meetingId: 'meeting-1',
      meetingRoomId: 'room-1',
      ownerId: 'workspace-1',
      instanceType: 'standard-1',
      ttlSeconds: 3600,
      ttlSource: 'GLOBAL',
      expiresAt: '2026-06-28T08:00:00.000Z',
      repoGitUrl: 'https://github.com/example/source-backed-repo',
      challengeBranch: 'pr-42',
      baseCommitSha: 'c'.repeat(40),
    });
    await markStatus(db, 'room-session-1', 'READY', {
      startedAt: '2026-06-28T07:01:00.000Z',
    });
    await markWarned(db, 'room-session-1', '2026-06-28T07:59:00.000Z');
    await markStopped(db, 'room-session-1', '2026-06-28T07:59:30.000Z');
    await markStopped(db, 'room-session-1', '2026-06-28T07:59:30.000Z');

    expect(count(sqlite, 'assessment_sessions')).toBe(1);
    expect(count(sqlite, 'assessment_evidence_events')).toBe(4);
    expect(count(sqlite, 'assessment_event_source_refs')).toBe(4);
    expect(count(sqlite, 'assessment_state_transitions')).toBe(1);

    const session = sqlite.prepare(
      `SELECT interview_id, mode, state, candidate_id, workspace_id, created_by, metadata_json
         FROM assessment_sessions`,
    ).get() as {
      interview_id: string;
      mode: string;
      state: string;
      candidate_id: string | null;
      workspace_id: string;
      created_by: string;
      metadata_json: string;
    };
    expect(session).toMatchObject({
      interview_id: 'meeting-1',
      mode: 'DEV_CONTAINER_REPO_TASK',
      state: 'IN_PROGRESS',
      candidate_id: null,
      workspace_id: 'workspace-1',
      created_by: 'dev-container-session-lifecycle',
    });
    expect(JSON.parse(session.metadata_json)).toMatchObject({
      sessionId: 'room-session-1',
      meetingId: 'meeting-1',
      meetingRoomId: 'room-1',
      accessScope: 'meeting_room',
      repoGitUrl: 'https://github.com/example/source-backed-repo',
      challengeBranch: 'pr-42',
      baseCommitSha: 'c'.repeat(40),
      source: 'dev_container_sessions',
    });

    const events = sqlite.prepare(
      `SELECT e.sequence, e.kind, e.actor_type, e.actor_id, e.payload_json,
              r.source_ref_type, r.source_ref_id, r.evidence_role, r.exact_text, r.content_hash
         FROM assessment_evidence_events e
         JOIN assessment_event_source_refs r ON r.event_id = e.id
        ORDER BY e.sequence`,
    ).all() as Array<{
      sequence: number;
      kind: string;
      actor_type: string;
      actor_id: string;
      payload_json: string;
      source_ref_type: string;
      source_ref_id: string;
      evidence_role: string;
      exact_text: string;
      content_hash: string;
    }>;

    expect(events.map((event) => ({
      sequence: event.sequence,
      kind: event.kind,
      actorType: event.actor_type,
      actorId: event.actor_id,
      sourceRefType: event.source_ref_type,
      sourceRefId: event.source_ref_id,
      evidenceRole: event.evidence_role,
    }))).toEqual([
      {
        sequence: 1,
        kind: 'dev_container_event',
        actorType: 'dev_container',
        actorId: 'room-session-1',
        sourceRefType: 'dev_container_session',
        sourceRefId: 'room-session-1',
        evidenceRole: 'launching',
      },
      {
        sequence: 2,
        kind: 'dev_container_event',
        actorType: 'dev_container',
        actorId: 'room-session-1',
        sourceRefType: 'dev_container_session',
        sourceRefId: 'room-session-1',
        evidenceRole: 'ready',
      },
      {
        sequence: 3,
        kind: 'dev_container_event',
        actorType: 'dev_container',
        actorId: 'room-session-1',
        sourceRefType: 'dev_container_session',
        sourceRefId: 'room-session-1',
        evidenceRole: 'warned',
      },
      {
        sequence: 4,
        kind: 'dev_container_event',
        actorType: 'dev_container',
        actorId: 'room-session-1',
        sourceRefType: 'dev_container_session',
        sourceRefId: 'room-session-1',
        evidenceRole: 'stopped',
      },
    ]);
    expect(events.every((event) => /^[a-f0-9]{64}$/.test(event.content_hash))).toBe(true);

    const stoppedPayload = JSON.parse(events[3].payload_json) as {
      lifecycleEvent: string;
      status: string;
      repoGitUrl: string;
    };
    expect(stoppedPayload).toMatchObject({
      lifecycleEvent: 'stopped',
      status: 'STOPPED',
      repoGitUrl: 'https://github.com/example/source-backed-repo',
    });
    const stoppedSource = JSON.parse(events[3].exact_text) as {
      sourceKind: string;
      lifecycleEvent: string;
      status: string;
      sessionId: string;
      stoppedAt: string;
      repoGitUrl: string;
    };
    expect(stoppedSource).toMatchObject({
      sourceKind: 'dev_container_sessions.row',
      lifecycleEvent: 'stopped',
      status: 'STOPPED',
      sessionId: 'room-session-1',
      stoppedAt: '2026-06-28T07:59:30.000Z',
      repoGitUrl: 'https://github.com/example/source-backed-repo',
    });
  });

  it('keeps candidate dev-container evidence linked to the candidate challenge session', async () => {
    await insertSession(db, {
      id: 'row-candidate-1',
      sessionId: 'candidate-session-1',
      candidateId: 'candidate-1',
      challengeId: 'challenge-1',
      pipelineId: 'pipeline-1',
      instanceType: 'standard-1',
      ttlSeconds: 1800,
      ttlSource: 'CHALLENGE',
      expiresAt: '2026-06-28T07:30:00.000Z',
      repoGitUrl: 'https://github.com/example/candidate-task',
      challengeBranch: 'candidate-fix',
    });

    const session = sqlite.prepare(
      `SELECT interview_id, mode, candidate_id, metadata_json
         FROM assessment_sessions`,
    ).get() as {
      interview_id: string;
      mode: string;
      candidate_id: string;
      metadata_json: string;
    };
    expect(session).toMatchObject({
      interview_id: 'challenge-1',
      mode: 'DEV_CONTAINER_CHALLENGE',
      candidate_id: 'candidate-1',
    });
    expect(JSON.parse(session.metadata_json)).toMatchObject({
      sessionId: 'candidate-session-1',
      candidateId: 'candidate-1',
      challengeId: 'challenge-1',
      pipelineId: 'pipeline-1',
      accessScope: 'candidate',
      repoGitUrl: 'https://github.com/example/candidate-task',
    });

    const sourceRef = sqlite.prepare(
      `SELECT e.payload_json, r.exact_text
         FROM assessment_evidence_events e
         JOIN assessment_event_source_refs r ON r.event_id = e.id`,
    ).get() as { payload_json: string; exact_text: string };
    expect(JSON.parse(sourceRef.payload_json)).toMatchObject({
      lifecycleEvent: 'launching',
      status: 'LAUNCHING',
      candidateId: 'candidate-1',
      challengeId: 'challenge-1',
    });
    expect(JSON.parse(sourceRef.exact_text)).toMatchObject({
      sourceKind: 'dev_container_sessions.row',
      sessionId: 'candidate-session-1',
      candidateId: 'candidate-1',
      status: 'LAUNCHING',
      repoGitUrl: 'https://github.com/example/candidate-task',
    });
  });

  it('clears stale live error text when a dev-container recovers while preserving the error evidence event', async () => {
    await insertRoomSession(db, {
      id: 'row-room-recovery',
      sessionId: 'room-session-recovery',
      meetingId: 'meeting-recovery',
      meetingRoomId: 'room-recovery',
      ownerId: 'workspace-recovery',
      instanceType: 'standard-1',
      ttlSeconds: 3600,
      ttlSource: 'GLOBAL',
      expiresAt: '2026-06-28T08:00:00.000Z',
      repoGitUrl: 'https://github.com/example/recovered-repo',
      challengeBranch: 'pr-77',
      baseCommitSha: 'd'.repeat(40),
    });

    await markError(db, 'room-session-recovery', 'port 8080 never opened');
    await markStatus(db, 'room-session-recovery', 'READY', {
      startedAt: '2026-06-28T07:02:00.000Z',
    });

    const row = sqlite.prepare(
      `SELECT status, error_message
         FROM dev_container_sessions
        WHERE session_id = 'room-session-recovery'`,
    ).get() as { status: string; error_message: string | null };
    expect(row).toEqual({
      status: 'READY',
      error_message: null,
    });

    const events = sqlite.prepare(
      `SELECT e.sequence, e.payload_json, r.exact_text
         FROM assessment_evidence_events e
         JOIN assessment_event_source_refs r ON r.event_id = e.id
        ORDER BY e.sequence`,
    ).all() as Array<{ sequence: number; payload_json: string; exact_text: string }>;
    expect(events).toHaveLength(3);
    expect(JSON.parse(events[1]!.payload_json)).toMatchObject({
      lifecycleEvent: 'error',
      status: 'ERROR',
      errorMessage: 'port 8080 never opened',
      baseCommitSha: 'd'.repeat(40),
    });
    expect(JSON.parse(events[1]!.exact_text)).toMatchObject({
      lifecycleEvent: 'error',
      status: 'ERROR',
      errorMessage: 'port 8080 never opened',
    });
    expect(JSON.parse(events[2]!.payload_json)).toMatchObject({
      lifecycleEvent: 'ready',
      status: 'READY',
      errorMessage: null,
    });
    expect(JSON.parse(events[2]!.exact_text)).toMatchObject({
      lifecycleEvent: 'ready',
      status: 'READY',
      errorMessage: null,
    });
  });
});
