import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const assessmentListProjectionIndexesMigration = readFileSync(
  new URL('../../migrations/0114_assessment_list_projection_indexes.sql', import.meta.url),
  'utf8',
);

function createMinimalSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE assessment_sessions (
      id TEXT PRIMARY KEY,
      interview_id TEXT,
      updated_at TEXT
    );

    CREATE TABLE assessment_evidence_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE assessment_event_source_refs (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      source_ref_type TEXT NOT NULL,
      evidence_role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE assessment_evaluation_reports (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE candidate_challenge_assignment (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL
    );
  `);
}

describe('assessment list projection indexes migration', () => {
  it('creates every composite index used by recruiter assessment summaries', () => {
    const db = new Database(':memory:');
    try {
      createMinimalSchema(db);

      db.exec(assessmentListProjectionIndexesMigration);

      const indexes = db.prepare(
        `SELECT name
           FROM sqlite_master
          WHERE type = 'index'
          ORDER BY name`,
      ).all() as Array<{ name: string }>;

      expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
        'idx_assessment_sessions_interview_updated',
        'idx_assessment_evidence_events_session_kind',
        'idx_assessment_evidence_events_session_latest',
        'idx_assessment_evidence_events_session_kind_latest',
        'idx_assessment_event_source_refs_event_lookup',
        'idx_assessment_evaluation_reports_session_latest',
        'idx_candidate_challenge_assignment_candidate_stage_latest',
      ]));
    } finally {
      db.close();
    }
  });
});
