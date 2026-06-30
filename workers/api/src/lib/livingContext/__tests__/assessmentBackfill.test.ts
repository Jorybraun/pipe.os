import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { runScheduledBackfill } from '../backfillScheduled';
import { ingestAssessmentSessionRealTime } from '../assessmentIngestion';
import { clearGateCache } from '../rolloutEnforcement';

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

function rewriteNumberedParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?(\d+)/g, () => {
    index++;
    return '?';
  });
}

describe('assessments_to_living_context backfill', () => {
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
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        owner_id TEXT,
        contact_id TEXT,
        transcript_json TEXT,
        transcript_summary TEXT,
        recording_r2_key TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
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
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(matchingMigration);
    sqlite.exec(rewriteNumberedParams(transcriptProjectionMigration));
    sqlite.exec(rewriteNumberedParams(contextRecordMigration));
    sqlite.exec(assessmentMigration);
    sqlite.exec(backfillCheckpointsMigration);
    sqlite.exec(rolloutGatesMigration);
    sqlite.exec(rolloutGateAuditLogMigration);
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-backfill', 'living_context_backfill', 'GA', 'test gate', datetime('now'), datetime('now'));

      INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status, resume_s3_key, skills)
      VALUES ('cand-assess-1', 'owner-1', 'pipe-1', 'Casey Candidate', 'casey@test.dev', 'active', NULL, NULL);

      INSERT INTO scheduled_interviews
        (id, candidate_id, owner_id, status, interview_type, recipient_name, recipient_email, created_at, updated_at)
      VALUES ('interview-assess-1', 'cand-assess-1', 'owner-1', 'INVITED', 'OPEN_SOURCE_BUG_FIX', 'Casey Candidate', 'casey@test.dev', datetime('now'), datetime('now'));
    `);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    clearGateCache();
  });

  it('reprocesses partially ingested assessment sessions when evaluation report context is missing', async () => {
    const now = '2026-06-30T12:00:00Z';
    sqlite.exec(`
      INSERT INTO assessment_sessions
        (id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id, metadata_json, started_at, created_at, updated_at)
      VALUES ('sess-partial-1', 'assessment:sess-partial-1', 'interview-assess-1', 'OPEN_SOURCE_BUG_FIX', 'IN_PROGRESS', NULL, 'owner-1', '{}', '${now}', '${now}', '${now}');

      INSERT INTO assessment_evidence_events
        (id, ingestion_key, session_id, sequence, kind, actor_type, actor_id, narrative, payload_json, occurred_at, created_at)
      VALUES ('event-partial-1', 'assessment:event-partial-1', 'sess-partial-1', 1, 'commit_created', 'candidate', 'cand-assess-1', 'Candidate created an assessment commit.', '{}', '${now}', '${now}');
    `);

    const partial = await ingestAssessmentSessionRealTime(db, 'sess-partial-1');
    expect(partial).not.toBeNull();
    expect(partial!.contextRecordCount).toBe(1);

    sqlite.exec(`
      UPDATE assessment_sessions
         SET state = 'EVALUATED', completed_at = '${now}', updated_at = '${now}'
       WHERE id = 'sess-partial-1';

      INSERT INTO assessment_evaluation_reports
        (id, ingestion_key, session_id, status, summary, output_json, created_at, updated_at)
      VALUES ('report-partial-1', 'assessment:report-partial-1', 'sess-partial-1', 'EVALUATED', 'Candidate produced a coherent source-backed fix.', '{}', '${now}', '${now}');

      INSERT INTO assessment_evaluation_claims
        (id, report_id, polarity, dimension, narrative, confidence, created_at)
      VALUES ('claim-partial-1', 'report-partial-1', 'positive', 'debugging_skill', 'Candidate isolated the bug and committed a targeted fix.', 0.86, '${now}');
    `);

    const reportEntitiesBefore = sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_record_entities
        WHERE entity_type = 'assessment_evaluation_report'
          AND entity_id = 'report-partial-1'`,
    ).get() as { count: number };
    expect(reportEntitiesBefore.count).toBe(0);

    sqlite.exec(`
      INSERT INTO backfill_checkpoints
        (id, ingestion_key, task_key, cursor, status, processed, failed, metadata_json, started_at, completed_at, created_at, updated_at)
      VALUES
        ('checkpoint-candidates-completed', 'backfill:candidates_to_living_context', 'candidates_to_living_context', 'cand-assess-1', 'completed', 1, 0, '{}', datetime('now'), datetime('now'), datetime('now'), datetime('now')),
        ('checkpoint-assessments-completed', 'backfill:assessments_to_living_context', 'assessments_to_living_context', 'sess-partial-1', 'completed', 1, 0, '{}', datetime('now'), datetime('now'), datetime('now'), datetime('now'));
    `);

    const result = await runScheduledBackfill({ DB: db } as unknown as Parameters<typeof runScheduledBackfill>[0]);

    expect(result.gateEnabled).toBe(true);
    expect(result.batchResults['assessment_evaluations_to_living_context']).toMatchObject({
      processed: 1,
      failed: 0,
    });

    const evaluationRecord = sqlite.prepare(
      `SELECT cr.id, cr.record_type, cr.predicate, cr.narrative
         FROM context_records cr
        WHERE cr.ingestion_key = 'assessment_claim_context:claim-partial-1'`,
    ).get() as { id: string; record_type: string; predicate: string; narrative: string } | undefined;
    expect(evaluationRecord).toMatchObject({
      record_type: 'evaluation:debugging_skill',
      predicate: 'positive',
      narrative: 'Candidate isolated the bug and committed a targeted fix.',
    });

    const reportEntity = sqlite.prepare(
      `SELECT entity_type, entity_id, relationship
         FROM context_record_entities
        WHERE context_record_id = ?
          AND entity_type = 'assessment_evaluation_report'
          AND entity_id = 'report-partial-1'`,
    ).get(evaluationRecord!.id) as { entity_type: string; entity_id: string; relationship: string } | undefined;
    expect(reportEntity).toMatchObject({
      entity_type: 'assessment_evaluation_report',
      entity_id: 'report-partial-1',
      relationship: 'evaluation_report',
    });
  });
});
