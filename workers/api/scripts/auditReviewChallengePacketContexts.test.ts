import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetterSqliteDb } from '../src/__tests__/helpers/mockD1';
import {
  auditReviewChallengePacketContexts,
  type QueryClient,
} from './auditReviewChallengePacketContexts';

class BetterQueryClient implements QueryClient {
  constructor(private readonly sqlite: BetterSqliteDb) {}

  async query<T>(
    sql: string,
    params: Array<string | number | null> = [],
  ): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }
}

function setupDb(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      test_framework TEXT
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
  `);
  return sqlite;
}

function setupCrawlerOnlyDb(): BetterSqliteDb {
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
    INSERT INTO qualified_repos (id, full_name, test_framework, disqualified)
    VALUES
      (1, 'pipe-labs/orders', NULL, 0),
      (2, 'pipe/e2e-source-backed-local', 'source-backed-fixture', 0),
      (3, 'pipe-labs/disabled', NULL, 1);
    INSERT INTO repo_sample_prs (repo_id, pr_number, swe_bench_eligible)
    VALUES
      (1, 42, 1),
      (2, 42, 1),
      (3, 42, 1),
      (1, 43, 0);
  `);
  return sqlite;
}

interface PacketFixture {
  packetId: string;
  repoId: number;
  fullName: string;
  prNumber?: number;
  fixture?: boolean;
  productionReady?: boolean;
  context?: boolean;
  repoSourceRefs?: number;
  concepts?: number;
}

function seedPacket(sqlite: BetterSqliteDb, fixture: PacketFixture): void {
  const prNumber = fixture.prNumber ?? 1;
  const repoSnapshotId = `snapshot-${fixture.packetId}`;
  sqlite.prepare(
    `INSERT OR IGNORE INTO qualified_repos (id, full_name, test_framework)
     VALUES (?, ?, ?)`,
  ).run(
    fixture.repoId,
    fixture.fullName,
    fixture.fixture ? 'source-backed-fixture' : null,
  );
  sqlite.prepare(
    `INSERT INTO review_challenge_packets (
       id, repo_id, pr_number, production_ready, repo_snapshot_id
     ) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    fixture.packetId,
    fixture.repoId,
    prNumber,
    fixture.productionReady === false ? 0 : 1,
    repoSnapshotId,
  );

  if (fixture.context === false) return;
  const contextRecordId = `context-${fixture.packetId}`;
  sqlite.prepare(
    `INSERT INTO context_records (
       id, ingestion_key, scope_type, scope_id, record_type
     ) VALUES (?, ?, 'repo_snapshot', ?, 'repo_challenge_packet')`,
  ).run(
    contextRecordId,
    `repo-challenge-packet-context:${fixture.packetId}`,
    repoSnapshotId,
  );

  for (let index = 0; index < (fixture.repoSourceRefs ?? 1); index += 1) {
    sqlite.prepare(
      `INSERT INTO context_record_source_refs (
         context_record_id, source_ref_type, source_ref_id
       ) VALUES (?, 'repo_source_span', ?)`,
    ).run(contextRecordId, `repo-span-${fixture.packetId}-${index + 1}`);
  }
  for (let index = 0; index < (fixture.concepts ?? 1); index += 1) {
    sqlite.prepare(
      `INSERT INTO context_record_concepts (context_record_id, concept_id)
       VALUES (?, ?)`,
    ).run(contextRecordId, `concept-${fixture.packetId}-${index + 1}`);
  }
}

describe('auditReviewChallengePacketContexts', () => {
  let sqlite: BetterSqliteDb | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('reports missing graph tables while preserving crawler source counts', async () => {
    sqlite = setupCrawlerOnlyDb();

    const result = await auditReviewChallengePacketContexts(new BetterQueryClient(sqlite));

    expect(result.status).toBe('missing_graph_tables');
    expect(result.missingTables).toEqual([
      'review_challenge_packets',
      'context_records',
      'context_record_source_refs',
      'context_record_concepts',
    ]);
    expect(result.sourceStats).toEqual({
      qualifiedRepos: 3,
      samplePullRequests: 4,
      eligibleSamplePullRequests: 1,
    });
    expect(result.stats.totalPackets).toBe(0);
  });

  it('reports no_packets when there are no review challenge packets', async () => {
    sqlite = setupDb();

    const result = await auditReviewChallengePacketContexts(new BetterQueryClient(sqlite));

    expect(result.status).toBe('no_packets');
    expect(result.stats.totalPackets).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('reports fixture_only even when seeded fixture packets are overlay-ready', async () => {
    sqlite = setupDb();
    seedPacket(sqlite, {
      packetId: 'packet-fixture-ready',
      repoId: 7,
      fullName: 'pipe/e2e-source-backed-local',
      fixture: true,
    });

    const result = await auditReviewChallengePacketContexts(new BetterQueryClient(sqlite));

    expect(result.status).toBe('fixture_only');
    expect(result.stats).toMatchObject({
      totalPackets: 1,
      fixturePackets: 1,
      realPackets: 0,
      overlayReadyPackets: 1,
      realOverlayReadyPackets: 0,
    });
  });

  it('detects missing context records, repo source refs, and concept links for real packets', async () => {
    sqlite = setupDb();
    seedPacket(sqlite, {
      packetId: 'packet-fixture-ready',
      repoId: 7,
      fullName: 'pipe/e2e-source-backed-local',
      fixture: true,
    });
    seedPacket(sqlite, {
      packetId: 'packet-real-ready',
      repoId: 77,
      fullName: 'pipe-labs/orders',
    });
    seedPacket(sqlite, {
      packetId: 'packet-real-missing-context',
      repoId: 78,
      fullName: 'pipe-labs/billing',
      context: false,
    });
    seedPacket(sqlite, {
      packetId: 'packet-real-missing-refs',
      repoId: 79,
      fullName: 'pipe-labs/invoices',
      repoSourceRefs: 0,
    });
    seedPacket(sqlite, {
      packetId: 'packet-real-missing-concepts',
      repoId: 80,
      fullName: 'pipe-labs/ledger',
      concepts: 0,
    });

    const result = await auditReviewChallengePacketContexts(new BetterQueryClient(sqlite));

    expect(result.status).toBe('incomplete_context_projection');
    expect(result.stats).toMatchObject({
      totalPackets: 5,
      productionReadyPackets: 5,
      fixturePackets: 1,
      realPackets: 4,
      withContextRecords: 4,
      withRepoSourceRefs: 3,
      withConceptLinks: 3,
      overlayReadyPackets: 2,
      realOverlayReadyPackets: 1,
    });
    expect(result.missingContextRecordPacketIds).toEqual(['packet-real-missing-context']);
    expect(result.missingRepoSourceRefPacketIds).toEqual(['packet-real-missing-refs']);
    expect(result.missingConceptLinkPacketIds).toEqual(['packet-real-missing-concepts']);
  });
});
