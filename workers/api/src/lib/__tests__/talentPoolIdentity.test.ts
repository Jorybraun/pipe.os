import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import { ensureRolelessTalentPoolIdentity } from '../talentPoolIdentity';

const livingContextMigration = readFileSync(
  new URL('../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const candidateNodesMigration = readFileSync(
  new URL('../../../migrations/0052_candidate_nodes.sql', import.meta.url),
  'utf8',
);
const candidateNodeIdempotencyMigration = readFileSync(
  new URL('../../../migrations/0085_candidate_node_idempotency.sql', import.meta.url),
  'utf8',
);

function createSqlite(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(`
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      invite_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('INVITED', 'IN_PROGRESS', 'COMPLETED')),
      pipeline_id TEXT,
      current_stage_id TEXT,
      resume_s3_key TEXT,
      phone_number TEXT,
      skills TEXT,
      years_of_experience INTEGER,
      current_role TEXT,
      education TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  sqlite.exec(livingContextMigration);
  sqlite.exec(contextRecordsMigration);
  sqlite.exec(candidateNodesMigration);
  sqlite.exec(candidateNodeIdempotencyMigration);
  sqlite.prepare(
    `INSERT INTO candidates (
       id, owner_id, name, email, invite_token, status, created_at, updated_at
     )
     VALUES (
       'candidate-1', 'owner-1', 'Jordan Talent', 'jordan@example.com',
       'invite-token', 'INVITED',
       '2026-07-02T00:00:00.000Z', '2026-07-02T00:00:00.000Z'
     )`,
  ).run();
  return sqlite;
}

function tableCount(sqlite: BetterSqliteDb, tableName: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

function duplicateProjectedEdgeCount(sqlite: BetterSqliteDb): number {
  const row = sqlite.prepare(
    `SELECT COUNT(*) AS count
       FROM (
         SELECT workspace_person_id, record_type, predicate, narrative, polarity, COUNT(*) AS edge_count
           FROM context_records
          WHERE workspace_person_id IS NOT NULL
            AND polarity > 0
          GROUP BY workspace_person_id, record_type, predicate, narrative, polarity
         HAVING edge_count > 1
       )`,
  ).get() as { count: number };
  return row.count;
}

describe('ensureRolelessTalentPoolIdentity', () => {
  it('replays roleless message, upload receipt, and operational context without duplicate projected edges', async () => {
    const sqlite = createSqlite();
    const db = createMockD1(sqlite);
    const now = '2026-07-02T12:00:00.000Z';
    const profileText = [
      'Jordan shipped source-backed Talent Pool ingestion.',
      'They built Cloudflare Workers APIs and exact source-span replay tests.',
    ].join(' ');
    const storageKey = 'talent-intake/candidate-1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-profile.txt';
    const sourceArtifact = {
      storageKey,
      mediaType: 'text/plain',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      byteLength: new TextEncoder().encode(profileText).byteLength,
      originalFileName: 'profile.txt',
      extractedTextAvailable: true,
    };
    const operationalContext = {
      githubUrl: 'https://github.com/jordan-talent',
      linkedinUrl: 'https://linkedin.com/in/jordan-talent',
      portfolioUrl: 'https://jordan.example.dev',
      phoneScreenerConsent: true,
      phoneNumber: '+15551234567',
      timezone: 'America/Vancouver',
      availability: 'Weekday afternoons after 2 PM.',
    };

    const first = await ensureRolelessTalentPoolIdentity({
      db,
      userId: 'owner-1',
      candidateId: 'candidate-1',
      name: 'Jordan Talent',
      email: 'Jordan@Example.com',
      message: profileText,
      messageStorageKey: storageKey,
      messageMediaType: 'text/plain',
      sourceArtifact,
      operationalContext,
      now,
    });

    expect(tableCount(sqlite, 'people')).toBe(1);
    expect(tableCount(sqlite, 'workspace_people')).toBe(1);
    expect(tableCount(sqlite, 'interactions')).toBe(3);
    expect(tableCount(sqlite, 'artifacts')).toBe(3);
    expect(tableCount(sqlite, 'artifact_versions')).toBe(3);
    expect(tableCount(sqlite, 'source_spans')).toBe(8);
    expect(tableCount(sqlite, 'context_records')).toBe(5);
    expect(tableCount(sqlite, 'context_record_source_refs')).toBe(8);
    expect(tableCount(sqlite, 'candidate_nodes')).toBe(1);
    expect(duplicateProjectedEdgeCount(sqlite)).toBe(0);

    sqlite.prepare(
      `INSERT INTO applications (
         id, ingestion_key, workspace_person_id, legacy_candidate_id,
         pipeline_id, status, context_json, created_at, updated_at
       )
       VALUES (
         'legacy-application-1', 'legacy-roleless-application-1', ?,
         'candidate-1', NULL, 'legacy', '{}', ?, ?
       )`,
    ).bind(first.workspacePersonId, now, now).run();
    sqlite.prepare(
      `INSERT INTO person_roles (
         id, ingestion_key, workspace_person_id, application_id, role_type,
         label, attributes_json, created_at, updated_at
       )
       VALUES (
         'legacy-role-1', 'legacy-roleless-role-1', ?,
         'legacy-application-1', 'candidate', 'Legacy roleless bridge',
         '{}', ?, ?
       )`,
    ).bind(first.workspacePersonId, now, now).run();

    const replay = await ensureRolelessTalentPoolIdentity({
      db,
      userId: 'owner-1',
      candidateId: 'candidate-1',
      name: 'Jordan Talent',
      email: 'jordan@example.com',
      message: profileText,
      messageStorageKey: storageKey,
      messageMediaType: 'text/plain',
      sourceArtifact,
      operationalContext,
      now: '2026-07-02T12:05:00.000Z',
    });

    expect(replay).toEqual(first);
    expect(tableCount(sqlite, 'applications')).toBe(0);
    expect(tableCount(sqlite, 'person_roles')).toBe(0);
    expect(tableCount(sqlite, 'people')).toBe(1);
    expect(tableCount(sqlite, 'workspace_people')).toBe(1);
    expect(tableCount(sqlite, 'interactions')).toBe(3);
    expect(tableCount(sqlite, 'artifacts')).toBe(3);
    expect(tableCount(sqlite, 'artifact_versions')).toBe(3);
    expect(tableCount(sqlite, 'source_spans')).toBe(8);
    expect(tableCount(sqlite, 'context_records')).toBe(5);
    expect(tableCount(sqlite, 'context_record_source_refs')).toBe(8);
    expect(tableCount(sqlite, 'candidate_nodes')).toBe(1);
    expect(duplicateProjectedEdgeCount(sqlite)).toBe(0);

    const backfillReplay = await ensureRolelessTalentPoolIdentity({
      db,
      userId: 'owner-1',
      candidateId: 'candidate-1',
      name: 'Jordan Talent',
      email: 'jordan@example.com',
      sourceArtifact,
      operationalContext,
      now: '2026-07-02T12:10:00.000Z',
    });

    expect(backfillReplay).toEqual(first);
    expect(tableCount(sqlite, 'people')).toBe(1);
    expect(tableCount(sqlite, 'workspace_people')).toBe(1);
    expect(tableCount(sqlite, 'interactions')).toBe(3);
    expect(tableCount(sqlite, 'artifacts')).toBe(3);
    expect(tableCount(sqlite, 'artifact_versions')).toBe(3);
    expect(tableCount(sqlite, 'source_spans')).toBe(8);
    expect(tableCount(sqlite, 'context_records')).toBe(5);
    expect(tableCount(sqlite, 'context_record_source_refs')).toBe(8);
    expect(tableCount(sqlite, 'candidate_nodes')).toBe(1);
    expect(duplicateProjectedEdgeCount(sqlite)).toBe(0);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM artifact_versions
        WHERE storage_key = ?
          AND json_extract(metadata_json, '$.evidenceKind') = 'profile_upload_source'`,
    ).get(storageKey)).toEqual({ count: 1 });
  });
});
