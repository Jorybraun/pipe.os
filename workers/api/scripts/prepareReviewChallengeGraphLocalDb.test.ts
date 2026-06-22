import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetterSqliteDb } from '../src/__tests__/helpers/mockD1';
import { auditReviewChallengePacketContexts } from './auditReviewChallengePacketContexts';
import {
  prepareReviewChallengeGraphLocalDb,
  SqliteQueryClient,
} from './prepareReviewChallengeGraphLocalDb';

function setupCrawlerOnlyDb(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE candidates (id TEXT PRIMARY KEY);
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      github_url TEXT,
      full_name TEXT NOT NULL,
      primary_language TEXT,
      test_framework TEXT,
      disqualified INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE repo_sample_prs (
      repo_id INTEGER NOT NULL,
      pr_number INTEGER NOT NULL,
      swe_bench_eligible INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO qualified_repos (
      id, github_url, full_name, primary_language, test_framework, disqualified
    ) VALUES
      (1, 'https://github.com/pipe-labs/orders', 'pipe-labs/orders', 'TypeScript', NULL, 0),
      (2, 'https://github.com/pipe/e2e-source-backed-local', 'pipe/e2e-source-backed-local', 'TypeScript', 'source-backed-fixture', 0),
      (3, 'https://github.com/pipe-labs/disabled', 'pipe-labs/disabled', 'TypeScript', NULL, 1);
    INSERT INTO repo_sample_prs (repo_id, pr_number, swe_bench_eligible)
    VALUES
      (1, 42, 1),
      (2, 42, 1),
      (3, 42, 1),
      (1, 43, 0);
  `);
  return sqlite;
}

describe('prepareReviewChallengeGraphLocalDb', () => {
  let sqlite: BetterSqliteDb | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('applies graph/context migrations to a crawler-shaped local D1', async () => {
    sqlite = setupCrawlerOnlyDb();

    const result = await prepareReviewChallengeGraphLocalDb(sqlite);

    expect(result.before.status).toBe('missing_graph_tables');
    expect(result.after.status).toBe('no_packets');
    expect(result.after.missingTables).toEqual([]);
    expect(result.after.sourceStats).toEqual({
      qualifiedRepos: 3,
      samplePullRequests: 4,
      eligibleSamplePullRequests: 1,
    });
    expect(result.migrations.map((migration) => migration.name)).toEqual([
      '0082_living_context_graph.sql',
      '0083_repo_semantic_graph_and_match_runs.sql',
      '0095_context_records.sql',
    ]);
  });

  it('is idempotent when migrations already exist', async () => {
    sqlite = setupCrawlerOnlyDb();
    await prepareReviewChallengeGraphLocalDb(sqlite);

    const second = await prepareReviewChallengeGraphLocalDb(sqlite);
    const audit = await auditReviewChallengePacketContexts(new SqliteQueryClient(sqlite));

    expect(second.before.status).toBe('no_packets');
    expect(second.after.status).toBe('no_packets');
    expect(audit.status).toBe('no_packets');
    expect(audit.sourceStats.eligibleSamplePullRequests).toBe(1);
  });
});
