import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { runBatchEvaluation, loadEvaluationPairsFromCorpus } from '../batchEvaluationHarness';
import type { BatchEvaluationCandidate } from '../batchEvaluationHarness';
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

describe('batchEvaluationHarness', () => {
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

  it('returns empty results for empty input', async () => {
    const db = createMockD1(sqlite);
    const result = await runBatchEvaluation(db as unknown as D1Database, []);
    expect(result.batchId).toMatch(/^batch-eval-/);
    expect(result.metrics.totalPairs).toBe(0);
    expect(result.metrics.successfulPairs).toBe(0);
    expect(result.metrics.failedPairs).toBe(0);
    expect(result.pairResults).toHaveLength(0);
  });

  it('records errors for non-existent candidates', async () => {
    const db = createMockD1(sqlite);
    const candidates: BatchEvaluationCandidate[] = [
      { candidateId: 'non-existent', challengePacketId: 'packet-1' },
    ];
    const result = await runBatchEvaluation(db as unknown as D1Database, candidates);
    expect(result.metrics.totalPairs).toBe(1);
    expect(result.pairResults[0].error).not.toBeNull();
    expect(result.pairResults[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('computes verdict distribution across pairs', async () => {
    const db = createMockD1(sqlite);
    seedCandidate(sqlite, 'cand-1', 'user-1');
    seedWorkspacePerson(sqlite, 'cand-1', 'wp-1');

    const candidates: BatchEvaluationCandidate[] = [
      { candidateId: 'cand-1', challengePacketId: 'packet-1' },
      { candidateId: 'cand-1', challengePacketId: 'packet-2' },
    ];
    const result = await runBatchEvaluation(db as unknown as D1Database, candidates);
    expect(result.metrics.totalPairs).toBe(2);
    expect(result.metrics.verdictDistribution).toBeDefined();
    expect(typeof result.metrics.verdictAccuracy).toBe('number');
    expect(typeof result.metrics.averageConfidence).toBe('number');
    expect(result.metrics.evaluatedAt).toBeTruthy();
  });

  it('compares computed verdict against expected verdict', async () => {
    const db = createMockD1(sqlite);
    seedCandidate(sqlite, 'cand-1', 'user-1');
    seedWorkspacePerson(sqlite, 'cand-1', 'wp-1');

    const candidates: BatchEvaluationCandidate[] = [
      {
        candidateId: 'cand-1',
        challengePacketId: 'packet-1',
        expectedVerdict: 'insufficient_evidence',
      },
    ];
    const result = await runBatchEvaluation(db as unknown as D1Database, candidates);
    expect(result.pairResults[0].expectedVerdict).toBe('insufficient_evidence');
    expect(typeof result.pairResults[0].verdictMatch).toBe('boolean');
  });

  it('loadEvaluationPairsFromCorpus returns empty for no match runs', async () => {
    const db = createMockD1(sqlite);
    const pairs = await loadEvaluationPairsFromCorpus(db as unknown as D1Database);
    expect(pairs).toHaveLength(0);
  });

  it('loadEvaluationPairsFromCorpus extracts pairs from completed match runs', async () => {
    const db = createMockD1(sqlite);
    seedCandidate(sqlite, 'cand-1', 'user-1');
    seedWorkspacePerson(sqlite, 'cand-1', 'wp-1');

    sqlite.exec(`
      INSERT INTO match_runs (id, candidate_id, candidate_snapshot_id, role_snapshot_id, policy_version, status, query_json, recalled_packets_json, excluded_packets_json, ranked_results_json, created_at)
      VALUES ('mr-1', 'cand-1', 'snap-1', 'rsnap-1', 'v1', 'MATCHED',
        '{}', '[]', '[]',
        '${JSON.stringify([{ challengeId: 'ch-1', repoId: 'repo-1', prNumber: 1, sourceVersion: 'v1' }])}',
        ${Math.floor(Date.now() / 1000)});
    `);

    const pairs = await loadEvaluationPairsFromCorpus(db as unknown as D1Database);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].candidateId).toBe('cand-1');
    expect(pairs[0].challengePacketId).toBe('ch-1');
  });
});
