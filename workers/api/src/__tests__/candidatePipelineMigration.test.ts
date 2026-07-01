import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

const nullableCandidatePipelineMigration = readFileSync(
  new URL('../../migrations/0112_nullable_candidate_pipeline.sql', import.meta.url),
  'utf8',
);

describe('0112 nullable candidate pipeline migration', () => {
  let sqlite: Database.Database | undefined;

  afterEach(() => {
    sqlite?.close();
    sqlite = undefined;
  });

  it('repairs legacy candidates tables and allows standalone assessment candidates', () => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL
      );

      CREATE TABLE stages (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE
      );

      CREATE TABLE candidates (
        id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        pipeline_id         TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        owner_id            TEXT NOT NULL,
        name                TEXT,
        email               TEXT,
        invite_token        TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
        status              TEXT NOT NULL DEFAULT 'INVITED'
                            CHECK (status IN ('INVITED', 'IN_PROGRESS', 'COMPLETED')),
        current_stage_id    TEXT REFERENCES stages(id) ON DELETE SET NULL,
        skills              TEXT,
        years_of_experience INTEGER,
        current_role        TEXT,
        education           TEXT,
        resume_s3_key       TEXT,
        phone_number        TEXT,
        github_handle       TEXT,
        linkedin_url        TEXT,
        created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX idx_candidates_pipeline ON candidates(pipeline_id);
      CREATE INDEX idx_candidates_invite_token ON candidates(invite_token);
      CREATE INDEX idx_candidates_owner ON candidates(owner_id);
      CREATE INDEX idx_candidates_owner_email ON candidates(owner_id, email);
      CREATE UNIQUE INDEX idx_candidates_pipeline_email ON candidates(pipeline_id, email);

      INSERT INTO pipelines (id, owner_id) VALUES ('pipeline-1', 'owner-1');
      INSERT INTO stages (id, pipeline_id) VALUES ('stage-1', 'pipeline-1');
      INSERT INTO candidates (
        id,
        pipeline_id,
        owner_id,
        name,
        email,
        invite_token,
        status,
        current_stage_id,
        skills,
        years_of_experience,
        current_role,
        education,
        resume_s3_key,
        phone_number,
        github_handle,
        linkedin_url,
        created_at,
        updated_at
      ) VALUES (
        'candidate-legacy',
        'pipeline-1',
        'owner-1',
        'Legacy Candidate',
        'legacy@example.com',
        'legacy-token',
        'INVITED',
        'stage-1',
        '["typescript"]',
        7,
        'Senior Engineer',
        'BS CS',
        'resumes/legacy.pdf',
        '+15555550101',
        'legacy-dev',
        'https://linkedin.example/legacy',
        '2026-06-01T00:00:00.000Z',
        '2026-06-01T00:00:00.000Z'
      );
    `);

    const beforeColumn = sqlite.prepare("PRAGMA table_info(candidates)").all()
      .find((column) => (column as { name: string }).name === 'pipeline_id') as { notnull: number };
    expect(beforeColumn.notnull).toBe(1);

    sqlite.exec(nullableCandidatePipelineMigration);

    const afterColumn = sqlite.prepare("PRAGMA table_info(candidates)").all()
      .find((column) => (column as { name: string }).name === 'pipeline_id') as { notnull: number };
    expect(afterColumn.notnull).toBe(0);

    const legacyCandidate = sqlite.prepare(`
      SELECT id, pipeline_id, invite_token, phone_number, github_handle, linkedin_url
      FROM candidates
      WHERE id = 'candidate-legacy'
    `).get() as {
      id: string;
      pipeline_id: string;
      invite_token: string;
      phone_number: string;
      github_handle: string;
      linkedin_url: string;
    };

    expect(legacyCandidate).toEqual({
      id: 'candidate-legacy',
      pipeline_id: 'pipeline-1',
      invite_token: 'legacy-token',
      phone_number: '+15555550101',
      github_handle: 'legacy-dev',
      linkedin_url: 'https://linkedin.example/legacy',
    });

    sqlite.prepare(`
      INSERT INTO candidates (
        id,
        pipeline_id,
        owner_id,
        name,
        email,
        invite_token,
        status,
        current_stage_id,
        created_at,
        updated_at
      ) VALUES (
        'candidate-standalone',
        NULL,
        'owner-1',
        'Standalone Assessment',
        'standalone@example.com',
        'standalone-token',
        'INVITED',
        NULL,
        '2026-06-01T01:00:00.000Z',
        '2026-06-01T01:00:00.000Z'
      )
    `).run();

    const indexes = sqlite.prepare('PRAGMA index_list(candidates)').all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toContain('idx_candidates_pipeline');
    expect(indexes).toContain('idx_candidates_invite_token');
    expect(indexes).toContain('idx_candidates_owner');
    expect(indexes).toContain('idx_candidates_owner_email');
    expect(indexes).toContain('idx_candidates_pipeline_email');
  });
});
