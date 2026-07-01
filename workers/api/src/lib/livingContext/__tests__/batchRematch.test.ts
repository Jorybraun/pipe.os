import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { runBatchRematch } from '../batchRematch';
import type { D1Database } from '@cloudflare/workers-types';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const repoGraphMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

const NOW = "datetime('now')";

function seedCandidate(sqlite: BetterSqliteDb, candidateId: string, userId: string): void {
  sqlite.exec(`INSERT INTO candidates (id, owner_id) VALUES ('${candidateId}', '${userId}');`);
}

function seedWorkspacePerson(
  sqlite: BetterSqliteDb,
  candidateId: string,
  wpId: string,
): void {
  sqlite.exec(`
    INSERT INTO people (id, ingestion_key, created_at, updated_at)
    VALUES ('person-${wpId}', 'ik-person-${wpId}', ${NOW}, ${NOW});
    INSERT INTO workspace_people (id, person_id, workspace_id, ingestion_key, context_json, created_at, updated_at)
    VALUES ('${wpId}', 'person-${wpId}', 'ws-1', 'ik-wp-${wpId}', '{}', ${NOW}, ${NOW});
    INSERT INTO applications (id, workspace_person_id, legacy_candidate_id, ingestion_key, created_at, updated_at)
    VALUES ('app-${wpId}', '${wpId}', '${candidateId}', 'ik-app-${wpId}', ${NOW}, ${NOW});
  `);
}

describe('batchRematch', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY, owner_id TEXT, pipeline_id TEXT, status TEXT DEFAULT 'ACTIVE');
      CREATE TABLE pipelines (id TEXT PRIMARY KEY, owner_id TEXT);
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(repoGraphMigration);
    sqlite.exec(conceptRegistryMigration);
    sqlite.exec(contextRecordsMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns empty result for empty candidate list', async () => {
    const db = createMockD1(sqlite) as unknown as D1Database;
    const result = await runBatchRematch(db, [], 'user-1');
    expect(result.totalCandidates).toBe(0);
    expect(result.processedCount).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(result.skippedCandidateIds).toHaveLength(0);
  });

  it('skips candidates not owned by user', async () => {
    seedCandidate(sqlite, 'cand-1', 'other-user');
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await runBatchRematch(db, ['cand-1'], 'user-1');
    expect(result.totalCandidates).toBe(1);
    expect(result.processedCount).toBe(0);
    expect(result.skippedCandidateIds).toEqual(['cand-1']);
  });

  it('returns NEEDS_MORE_EVIDENCE for candidate without workspace identity', async () => {
    seedCandidate(sqlite, 'cand-1', 'user-1');
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await runBatchRematch(db, ['cand-1'], 'user-1');
    expect(result.totalCandidates).toBe(1);
    expect(result.processedCount).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].candidateId).toBe('cand-1');
    expect(result.results[0].status).toBe('NEEDS_MORE_EVIDENCE');
  });

  it('processes multiple candidates independently', async () => {
    seedCandidate(sqlite, 'cand-1', 'user-1');
    seedCandidate(sqlite, 'cand-2', 'user-1');
    seedCandidate(sqlite, 'cand-3', 'other-user');
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await runBatchRematch(db, ['cand-1', 'cand-2', 'cand-3'], 'user-1');
    expect(result.totalCandidates).toBe(3);
    expect(result.processedCount).toBe(2);
    expect(result.skippedCandidateIds).toEqual(['cand-3']);
    expect(result.results.map((r) => r.candidateId).sort()).toEqual(['cand-1', 'cand-2']);
  });

  it('reports status for candidates with workspace identity but no match data', async () => {
    seedCandidate(sqlite, 'cand-1', 'user-1');
    seedWorkspacePerson(sqlite, 'cand-1', 'wp-1');
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await runBatchRematch(db, ['cand-1'], 'user-1');
    expect(result.processedCount).toBe(1);
    const entry = result.results[0];
    expect(entry.candidateId).toBe('cand-1');
    expect(entry.priorDecisions).toBeNull();
  });
});
