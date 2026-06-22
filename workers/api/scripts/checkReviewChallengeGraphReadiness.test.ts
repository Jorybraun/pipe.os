import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetterSqliteDb } from '../src/__tests__/helpers/mockD1';
import {
  checkReviewChallengeGraphReadiness,
  type ReviewChallengeGraphReadinessReport,
} from './checkReviewChallengeGraphReadiness';
import { SqliteQueryClient } from './prepareReviewChallengeGraphLocalDb';

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

function setupReadyDb(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      test_framework TEXT,
      disqualified INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE repo_sample_prs (
      repo_id INTEGER NOT NULL,
      pr_number INTEGER NOT NULL,
      swe_bench_eligible INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE review_challenge_packets (
      id TEXT PRIMARY KEY,
      repo_id INTEGER NOT NULL,
      pr_number INTEGER NOT NULL,
      production_ready INTEGER NOT NULL,
      repo_snapshot_id TEXT NOT NULL
    );
    CREATE TABLE context_records (
      id TEXT PRIMARY KEY,
      ingestion_key TEXT NOT NULL UNIQUE,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      record_type TEXT NOT NULL
    );
    CREATE TABLE context_record_source_refs (
      context_record_id TEXT NOT NULL,
      source_ref_type TEXT NOT NULL,
      source_ref_id TEXT NOT NULL
    );
    CREATE TABLE context_record_concepts (
      context_record_id TEXT NOT NULL,
      concept_id TEXT NOT NULL
    );
    INSERT INTO qualified_repos (id, full_name, test_framework, disqualified)
    VALUES (1, 'pipe-labs/orders', NULL, 0);
    INSERT INTO repo_sample_prs (repo_id, pr_number, swe_bench_eligible)
    VALUES (1, 42, 1);
    INSERT INTO review_challenge_packets (
      id, repo_id, pr_number, production_ready, repo_snapshot_id
    ) VALUES ('packet-real-ready', 1, 42, 1, 'snapshot-real-ready');
    INSERT INTO context_records (
      id, ingestion_key, scope_type, scope_id, record_type
    ) VALUES (
      'context-real-ready',
      'repo-challenge-packet-context:packet-real-ready',
      'repo_snapshot',
      'snapshot-real-ready',
      'repo_challenge_packet'
    );
    INSERT INTO context_record_source_refs (
      context_record_id, source_ref_type, source_ref_id
    ) VALUES ('context-real-ready', 'repo_source_span', 'repo-span-1');
    INSERT INTO context_record_concepts (context_record_id, concept_id)
    VALUES ('context-real-ready', 'concept-1');
  `);
  return sqlite;
}

function setupIncompleteDb(): BetterSqliteDb {
  const sqlite = setupReadyDb();
  sqlite.prepare('DELETE FROM context_record_concepts').run();
  return sqlite;
}

function okGitHubFetch(): Promise<Response> {
  return Promise.resolve(new Response('{}', {
    status: 200,
    headers: { 'x-ratelimit-remaining': '42' },
  }));
}

async function readiness(
  sqlite: BetterSqliteDb,
  options: Parameters<typeof checkReviewChallengeGraphReadiness>[0]['options'] = {},
): Promise<ReviewChallengeGraphReadinessReport> {
  return checkReviewChallengeGraphReadiness({
    client: new SqliteQueryClient(sqlite),
    database: sqlite,
    databasePath: '<memory>',
    options,
  });
}

describe('checkReviewChallengeGraphReadiness', () => {
  let sqlite: BetterSqliteDb | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('prepares a crawler-shaped local D1 but fails closed until packets are backfilled', async () => {
    sqlite = setupCrawlerOnlyDb();

    const report = await readiness(sqlite, {
      prepareLocal: true,
      requireGitHub: true,
      fetchImpl: okGitHubFetch,
    });

    expect(report.ready).toBe(false);
    expect(report.status).toBe('not_ready');
    expect(report.prepare?.before.status).toBe('missing_graph_tables');
    expect(report.audit.status).toBe('no_packets');
    expect(report.audit.missingTables).toEqual([]);
    expect(report.github?.ok).toBe(true);
    expect(report.failures).toContain(
      '1 eligible sample PR(s) exist, but no review challenge packets have been backfilled',
    );
    expect(report.nextActions).toContain(
      'Run backfillReviewChallengePackets.ts after GitHub API connectivity is available.',
    );
  });

  it('passes when a real packet has context records, repo refs, concepts, and GitHub reachability', async () => {
    sqlite = setupReadyDb();

    const report = await readiness(sqlite, {
      requireGitHub: true,
      fetchImpl: okGitHubFetch,
    });

    expect(report.ready).toBe(true);
    expect(report.status).toBe('ready');
    expect(report.audit.status).toBe('ready');
    expect(report.audit.stats.realOverlayReadyPackets).toBe(1);
    expect(report.github?.rateLimitRemaining).toBe('42');
    expect(report.failures).toEqual([]);
  });

  it('fails when GitHub is unreachable even if packet projection is ready', async () => {
    sqlite = setupReadyDb();

    const report = await readiness(sqlite, {
      requireGitHub: true,
      fetchImpl: async () => {
        throw new Error('network offline');
      },
    });

    expect(report.ready).toBe(false);
    expect(report.audit.status).toBe('ready');
    expect(report.github?.ok).toBe(false);
    expect(report.failures).toEqual([
      'GitHub API is not reachable for review packet backfill: network offline',
    ]);
    expect(report.nextActions).toContain(
      'Restore GitHub API connectivity and verify GITHUB_TOKEN/rate limits before packet backfill.',
    );
  });

  it('reports incomplete context projections with packet-specific failures', async () => {
    sqlite = setupIncompleteDb();

    const report = await readiness(sqlite);

    expect(report.ready).toBe(false);
    expect(report.audit.status).toBe('no_real_overlay_ready_packets');
    expect(report.failures).toContain(
      'no real review challenge packet has complete context-record, repo-source-ref, and concept-link coverage',
    );
    expect(report.failures).toContain(
      'review challenge packet packet-real-ready is missing context_record_concepts links',
    );
    expect(report.nextActions).toContain(
      'Repair or rebuild the listed packet context projections before rollout.',
    );
  });
});
