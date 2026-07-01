import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { runScheduledBackfill, BACKFILL_TASKS } from '../backfillScheduled';
import { clearGateCache } from '../rolloutEnforcement';
import type { Env } from '../../../types';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const matchingMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const assessmentMigration = readFileSync(
  new URL('../../../../migrations/0102_assessment_layer.sql', import.meta.url),
  'utf8',
);
const backfillCheckpointsMigration = readFileSync(
  new URL('../../../../migrations/0106_backfill_checkpoints.sql', import.meta.url),
  'utf8',
);
const rolloutGatesMigration = readFileSync(
  new URL('../../../../migrations/0107_rollout_gates.sql', import.meta.url),
  'utf8',
);
const rolloutGateAuditLogMigration = readFileSync(
  new URL('../../../../migrations/0108_rollout_gate_audit_log.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);

function rewriteNumberedParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?(\d+)/g, () => {
    index++;
    return '?';
  });
}

function count(sqlite: BetterSqliteDb, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  }).count;
}

describe('runScheduledBackfill', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pipeline_id TEXT,
        name TEXT,
        email TEXT,
        status TEXT NOT NULL,
        resume_s3_key TEXT,
        skills TEXT
      );
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        phone TEXT,
        company TEXT,
        role TEXT,
        type TEXT NOT NULL
      );
      CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        owner_id TEXT,
        contact_id TEXT,
        transcript_json TEXT,
        transcript_summary TEXT,
        recording_r2_key TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE phone_calls (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        owner_id TEXT,
        direction TEXT,
        twilio_call_sid TEXT,
        duration_seconds INTEGER,
        recording_s3_key TEXT,
        transcription TEXT,
        transcription_status TEXT,
        recruiter_notes TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE code_review_sessions (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        challenge_id TEXT,
        assessment_id TEXT,
        implementer_persona TEXT,
        status TEXT,
        transcript TEXT,
        score_report TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE scheduled_interviews (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        owner_id TEXT NOT NULL,
        status TEXT NOT NULL,
        interview_type TEXT,
        recipient_name TEXT,
        recipient_email TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE culture_interview_sessions (
        id TEXT PRIMARY KEY,
        candidate_id TEXT,
        assessment_id TEXT,
        state TEXT,
        transcript TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE meeting_participants (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        contact_id TEXT,
        role TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(matchingMigration);
    sqlite.exec(rewriteNumberedParams(transcriptProjectionMigration));
    sqlite.exec(rewriteNumberedParams(contextRecordMigration));
    sqlite.exec(assessmentMigration);
    sqlite.exec(backfillCheckpointsMigration);
    sqlite.exec(rolloutGatesMigration);
    sqlite.exec(rolloutGateAuditLogMigration);
    sqlite.exec(rewriteNumberedParams(conceptRegistryMigration));
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    clearGateCache();
  });

  function buildEnv(): Env {
    return { DB: db } as unknown as Env;
  }

  it('does not run when living_context_backfill gate is disabled', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-1', 'living_context_backfill', 'disabled', 'test', datetime('now'), datetime('now'));
    `);
    const result = await runScheduledBackfill(buildEnv());
    expect(result.gateEnabled).toBe(false);
    expect(result.tasksExecuted).toEqual([]);
    expect(result.batchResults).toEqual({});
  });

  it('backfills candidates missing living context identities', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-1', 'living_context_backfill', 'GA', 'test', datetime('now'), datetime('now'));

      INSERT INTO candidates (id, owner_id, status, name, email)
      VALUES ('cand-1', 'ws-1', 'active', 'Alice Smith', 'alice@test.dev');

      INSERT INTO candidates (id, owner_id, status, name, email)
      VALUES ('cand-2', 'ws-1', 'active', 'Bob Jones', 'bob@test.dev');
    `);

    expect(count(sqlite, 'workspace_people')).toBe(0);
    expect(count(sqlite, 'applications')).toBe(0);

    const result = await runScheduledBackfill(buildEnv());
    expect(result.gateEnabled).toBe(true);
    expect(result.tasksExecuted).toContain('candidates_to_living_context');
    expect(result.batchResults['candidates_to_living_context']).toMatchObject({
      processed: 2,
      failed: 0,
      done: true,
    });

    expect(count(sqlite, 'people')).toBe(2);
    expect(count(sqlite, 'workspace_people')).toBe(2);
    expect(count(sqlite, 'applications')).toBe(2);
  });

  it('backfills contacts missing living context identities', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-1', 'living_context_backfill', 'GA', 'test', datetime('now'), datetime('now'));

      INSERT INTO contacts (id, owner_id, name, email, type)
      VALUES ('contact-1', 'ws-1', 'Carol Davis', 'carol@test.dev', 'candidate');
    `);

    const result = await runScheduledBackfill(buildEnv());
    expect(result.gateEnabled).toBe(true);
    expect(result.tasksExecuted).toContain('contacts_to_living_context');
    expect(result.batchResults['contacts_to_living_context']).toMatchObject({
      processed: 1,
      failed: 0,
      done: true,
    });

    expect(count(sqlite, 'workspace_people')).toBe(1);
  });

  it('is idempotent — re-running after completion creates no duplicates', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-1', 'living_context_backfill', 'GA', 'test', datetime('now'), datetime('now'));

      INSERT INTO candidates (id, owner_id, status, name, email)
      VALUES ('cand-idem', 'ws-1', 'active', 'Idem Test', 'idem@test.dev');
    `);

    const first = await runScheduledBackfill(buildEnv());
    expect(first.batchResults['candidates_to_living_context']?.processed).toBe(1);
    const peopleAfterFirst = count(sqlite, 'people');
    const wpAfterFirst = count(sqlite, 'workspace_people');

    clearGateCache();
    const second = await runScheduledBackfill(buildEnv());
    expect(count(sqlite, 'people')).toBe(peopleAfterFirst);
    expect(count(sqlite, 'workspace_people')).toBe(wpAfterFirst);

    const candidateBatch = second.batchResults['candidates_to_living_context'];
    if (candidateBatch) {
      expect(candidateBatch.processed).toBe(0);
      expect(candidateBatch.done).toBe(true);
    }
  });

  it('registers all expected task definitions', () => {
    const taskKeys = BACKFILL_TASKS.map((t) => t.taskKey);
    expect(taskKeys).toContain('candidates_to_living_context');
    expect(taskKeys).toContain('contacts_to_living_context');
    expect(taskKeys).toContain('resumes_to_living_context');
    expect(taskKeys).toContain('meetings_to_living_context');
    expect(taskKeys).toContain('phone_calls_to_living_context');
    expect(taskKeys).toContain('code_reviews_to_living_context');
    expect(taskKeys).toContain('repo_assertions_to_living_context');
    expect(taskKeys).toContain('culture_sessions_to_living_context');
    expect(taskKeys).toContain('assessments_to_living_context');
    expect(taskKeys).toContain('assessment_evaluations_to_living_context');
    expect(taskKeys).toContain('session_events_to_living_context');
    expect(taskKeys).toContain('projection_outbox_drain');
    expect(BACKFILL_TASKS.length).toBe(12);
  });

  it('respects task dependency ordering', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-1', 'living_context_backfill', 'GA', 'test', datetime('now'), datetime('now'));
    `);

    const result = await runScheduledBackfill(buildEnv());
    expect(result.gateEnabled).toBe(true);

    const candidateTask = BACKFILL_TASKS.find((t) => t.taskKey === 'candidates_to_living_context');
    expect(candidateTask?.dependsOn).toEqual([]);

    const meetingsTask = BACKFILL_TASKS.find((t) => t.taskKey === 'meetings_to_living_context');
    expect(meetingsTask?.dependsOn).toContain('contacts_to_living_context');

    const projectionTask = BACKFILL_TASKS.find((t) => t.taskKey === 'projection_outbox_drain');
    expect(projectionTask?.dependsOn?.length).toBeGreaterThan(0);
  });

  it('processes resume backfill only for candidates with resume_s3_key and sufficient skills text', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-1', 'living_context_backfill', 'GA', 'test', datetime('now'), datetime('now'));

      INSERT INTO candidates (id, owner_id, status, name, email, resume_s3_key, skills)
      VALUES ('cand-resume', 'ws-1', 'active', 'Resume Candidate', 'resume@test.dev', 'docs/resume.pdf', 'TypeScript, React, Cloudflare Workers, D1 database, Hono framework, edge computing');
    `);

    const first = await runScheduledBackfill(buildEnv());
    expect(first.batchResults['candidates_to_living_context']).toMatchObject({
      processed: 1, done: true,
    });

    clearGateCache();
    const second = await runScheduledBackfill(buildEnv());
    const resumeBatch = second.batchResults['resumes_to_living_context'];
    if (resumeBatch) {
      expect(resumeBatch.processed).toBe(1);
      expect(count(sqlite, 'artifacts')).toBeGreaterThanOrEqual(1);
    }
  });

  it('backfills meeting transcripts into living context interactions', async () => {
    const transcript = JSON.stringify({
      segments: [
        { text: 'Tell me about your TypeScript experience.', speakerRole: 'host', timestampStartMs: 0, timestampEndMs: 3000 },
        { text: 'I have been building TypeScript applications for five years, focusing on Cloudflare Workers and edge-first architectures.', speakerRole: 'guest', timestampStartMs: 3100, timestampEndMs: 8000 },
      ],
    });

    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-1', 'living_context_backfill', 'GA', 'test', datetime('now'), datetime('now'));

      INSERT INTO contacts (id, owner_id, name, email, type)
      VALUES ('contact-meet', 'ws-1', 'Meeting Contact', 'contact@test.dev', 'candidate');

      INSERT INTO meetings (id, owner_id, contact_id, transcript_json, started_at, ended_at)
      VALUES ('meet-1', 'ws-1', 'contact-meet', '${transcript.replace(/'/g, "''")}', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z');

      INSERT INTO meeting_participants (id, meeting_id, contact_id, role)
      VALUES ('mp-1', 'meet-1', 'contact-meet', 'guest');
    `);

    const first = await runScheduledBackfill(buildEnv());
    expect(first.tasksExecuted).toContain('contacts_to_living_context');

    clearGateCache();
    const second = await runScheduledBackfill(buildEnv());
    const meetingBatch = second.batchResults['meetings_to_living_context'];
    if (meetingBatch) {
      expect(meetingBatch.processed).toBe(1);
      expect(meetingBatch.done).toBe(true);
      expect(count(sqlite, 'interactions')).toBeGreaterThanOrEqual(1);
    }
  });
});
