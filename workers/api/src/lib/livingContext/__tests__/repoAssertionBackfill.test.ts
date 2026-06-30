import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { runScheduledBackfill, BACKFILL_TASKS } from '../backfillScheduled';
import { clearGateCache } from '../rolloutEnforcement';

const livingMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const matchingMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
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

describe('repo_assertions_to_living_context backfill', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL DEFAULT 'w1', status TEXT NOT NULL DEFAULT 'active');
      CREATE TABLE contacts (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT, email TEXT, phone TEXT, company TEXT);
      CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);
      CREATE TABLE role_contexts (id TEXT PRIMARY KEY);
      CREATE TABLE meetings (id TEXT PRIMARY KEY, owner_id TEXT, contact_id TEXT, transcript_json TEXT, transcript_summary TEXT, recording_r2_key TEXT, started_at TEXT, ended_at TEXT, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE phone_calls (id TEXT PRIMARY KEY, candidate_id TEXT, owner_id TEXT, direction TEXT, twilio_call_sid TEXT, duration_seconds INTEGER, recording_s3_key TEXT, transcription TEXT, transcription_status TEXT, recruiter_notes TEXT, started_at TEXT, ended_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE code_review_sessions (id TEXT PRIMARY KEY, candidate_id TEXT, challenge_id TEXT, assessment_id TEXT, implementer_persona TEXT, status TEXT, transcript TEXT, score_report TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    `);
    sqlite.exec(livingMigration);
    sqlite.exec(matchingMigration);
    sqlite.exec(contextRecordMigration);
    sqlite.exec(backfillCheckpointsMigration);
    sqlite.exec(rolloutGatesMigration);
    sqlite.exec(rolloutGateAuditLogMigration);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    clearGateCache();
  });

  it('includes repo_assertions_to_living_context in BACKFILL_TASKS', () => {
    const task = BACKFILL_TASKS.find((t) => t.taskKey === 'repo_assertions_to_living_context');
    expect(task).toBeDefined();
    expect(task!.dependsOn).toEqual([]);
  });

  it('ingests repo semantic assertions into context records with source provenance', async () => {
    // Enable the rollout gate
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-1', 'living_context_backfill', 'GA', 'test gate', datetime('now'), datetime('now'));
    `);

    // Seed qualified repo
    sqlite.exec(`INSERT INTO qualified_repos (id) VALUES (1);`);

    // Seed a repo snapshot
    sqlite.exec(`
      INSERT INTO repo_snapshots (id, repo_id, commit_sha, tree_hash, extractor_version, created_at)
      VALUES ('snap-1', 1, 'abc123', 'tree-hash-1', '1.0.0', unixepoch());
    `);

    // Seed a source artifact + version + span
    sqlite.exec(`
      INSERT INTO repo_source_artifacts (id, repo_snapshot_id, artifact_type, path, created_at)
      VALUES ('art-1', 'snap-1', 'source_file', 'src/main.ts', unixepoch());
    `);
    sqlite.exec(`
      INSERT INTO repo_artifact_versions (id, artifact_id, content_hash, inline_content, byte_length, created_at)
      VALUES ('ver-1', 'art-1', 'hash-1', 'function hello() { return "world"; }', 37, unixepoch());
    `);
    sqlite.exec(`
      INSERT INTO repo_source_spans (id, artifact_version_id, byte_start, byte_end, line_start, line_end, content_hash, path, exact_text, created_at)
      VALUES ('span-1', 'ver-1', 0, 37, 1, 1, 'span-hash-1', 'src/main.ts', 'function hello() { return "world"; }', unixepoch());
    `);

    // Seed a facet
    sqlite.exec(`
      INSERT INTO repo_facets (id, family, slug, label, created_at)
      VALUES ('facet-1', 'language', 'typescript', 'TypeScript', unixepoch());
    `);

    // Seed a repo semantic assertion with span and facet links
    sqlite.exec(`
      INSERT INTO repo_semantic_assertions (id, repo_snapshot_id, subject, predicate, object, narrative, qualifiers_json, confidence, assertion_version, created_at)
      VALUES ('rsa-1', 'snap-1', 'hello', 'returns_value', 'world', 'Function hello returns string literal world', '{"domain":"greeting"}', 0.95, '1.0.0', unixepoch());
    `);
    sqlite.exec(`
      INSERT INTO repo_assertion_source_spans (assertion_id, source_span_id)
      VALUES ('rsa-1', 'span-1');
    `);
    sqlite.exec(`
      INSERT INTO repo_assertion_facets (assertion_id, facet_id, weight)
      VALUES ('rsa-1', 'facet-1', 0.9);
    `);

    // Run the backfill
    const env = { DB: db } as unknown as Parameters<typeof runScheduledBackfill>[0];
    const result = await runScheduledBackfill(env);

    expect(result.gateEnabled).toBe(true);
    expect(result.batchResults['repo_assertions_to_living_context']).toBeDefined();
    expect(result.batchResults['repo_assertions_to_living_context']!.processed).toBe(1);
    expect(result.batchResults['repo_assertions_to_living_context']!.failed).toBe(0);

    // Verify context record was created
    const contextRecords = sqlite.prepare(
      `SELECT * FROM context_records WHERE ingestion_key = 'repo-assertion-context:rsa-1'`,
    ).all() as Array<Record<string, unknown>>;
    expect(contextRecords.length).toBe(1);

    const record = contextRecords[0]!;
    expect(record['scope_type']).toBe('repo_snapshot');
    expect(record['scope_id']).toBe('snap-1');
    expect(record['record_type']).toBe('repo_semantic_assertion');
    expect(record['predicate']).toBe('returns_value');
    expect(record['narrative']).toBe('Function hello returns string literal world');

    // Verify source refs
    const sourceRefs = sqlite.prepare(
      `SELECT * FROM context_record_source_refs WHERE context_record_id = ?`,
    ).all(record['id'] as string) as Array<Record<string, unknown>>;
    expect(sourceRefs.length).toBe(1);
    expect(sourceRefs[0]!['source_ref_type']).toBe('repo_source_span');
    expect(sourceRefs[0]!['source_ref_id']).toBe('span-1');
    expect(sourceRefs[0]!['exact_text']).toBe('function hello() { return "world"; }');

    // Verify concept was linked
    const conceptLinks = sqlite.prepare(
      `SELECT crc.*, c.canonical_key, c.label
         FROM context_record_concepts crc
         JOIN concepts c ON c.id = crc.concept_id
        WHERE crc.context_record_id = ?`,
    ).all(record['id'] as string) as Array<Record<string, unknown>>;
    expect(conceptLinks.length).toBe(1);
    expect(conceptLinks[0]!['canonical_key']).toBe('language:typescript');
    expect(conceptLinks[0]!['relationship']).toBe('tagged');
  });

  it('skips assertions that already have context records (idempotent)', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-2', 'living_context_backfill', 'GA', 'test gate', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`INSERT INTO qualified_repos (id) VALUES (1);`);
    sqlite.exec(`
      INSERT INTO repo_snapshots (id, repo_id, commit_sha, tree_hash, extractor_version, created_at)
      VALUES ('snap-2', 1, 'def456', 'tree-hash-2', '1.0.0', unixepoch());
    `);
    sqlite.exec(`
      INSERT INTO repo_semantic_assertions (id, repo_snapshot_id, subject, predicate, object, narrative, qualifiers_json, confidence, assertion_version, created_at)
      VALUES ('rsa-2', 'snap-2', 'main', 'calls', 'init', 'main function calls init', '{}', 0.8, '1.0.0', unixepoch());
    `);

    // Pre-create the context record
    sqlite.exec(`
      INSERT INTO context_records (id, ingestion_key, scope_type, scope_id, record_type, narrative, qualifiers_json, polarity, created_at, updated_at)
      VALUES ('cr-existing', 'repo-assertion-context:rsa-2', 'repo_snapshot', 'snap-2', 'repo_semantic_assertion', 'pre-existing', '{}', 1, datetime('now'), datetime('now'));
    `);

    const env = { DB: db } as unknown as Parameters<typeof runScheduledBackfill>[0];
    const result = await runScheduledBackfill(env);

    // Should skip the already-processed assertion
    const repoTask = result.batchResults['repo_assertions_to_living_context'];
    expect(repoTask).toBeDefined();
    expect(repoTask!.processed).toBe(0);
    expect(repoTask!.done).toBe(true);
  });

  it('skips assertions with no source spans (no orphan context records)', async () => {
    sqlite.exec(`
      INSERT INTO rollout_gates (id, gate_key, stage, description, created_at, updated_at)
      VALUES ('gate-3', 'living_context_backfill', 'GA', 'test gate', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`INSERT INTO qualified_repos (id) VALUES (1);`);
    sqlite.exec(`
      INSERT INTO repo_snapshots (id, repo_id, commit_sha, tree_hash, extractor_version, created_at)
      VALUES ('snap-3', 1, 'ghi789', 'tree-hash-3', '1.0.0', unixepoch());
    `);
    sqlite.exec(`
      INSERT INTO repo_semantic_assertions (id, repo_snapshot_id, subject, predicate, object, narrative, qualifiers_json, confidence, assertion_version, created_at)
      VALUES ('rsa-3', 'snap-3', 'module', 'exports', 'api', 'Module exports public API', '{}', 0.7, '1.0.0', unixepoch());
    `);

    const env = { DB: db } as unknown as Parameters<typeof runScheduledBackfill>[0];
    const result = await runScheduledBackfill(env);

    // Assertion without source spans is counted as processed (skipped gracefully)
    expect(result.batchResults['repo_assertions_to_living_context']!.processed).toBe(1);
    expect(result.batchResults['repo_assertions_to_living_context']!.failed).toBe(0);

    // No context record created — we don't create orphan records without provenance
    const records = sqlite.prepare(
      `SELECT * FROM context_records WHERE ingestion_key = 'repo-assertion-context:rsa-3'`,
    ).all() as Array<Record<string, unknown>>;
    expect(records.length).toBe(0);
  });
});
