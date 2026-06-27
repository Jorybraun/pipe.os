import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetterSqliteDb } from '../src/__tests__/helpers/mockD1';
import { repairReviewPacketReviewProfiles } from './backfillReviewPacketReviewProfiles';

function setupDb(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL
    );
    CREATE TABLE review_challenge_packets (
      id TEXT PRIMARY KEY,
      repo_id INTEGER NOT NULL,
      pr_number INTEGER NOT NULL,
      production_ready INTEGER NOT NULL,
      repo_snapshot_id TEXT NOT NULL,
      packet_json TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE repo_source_spans (
      id TEXT PRIMARY KEY,
      path TEXT,
      exact_text TEXT NOT NULL,
      line_start INTEGER,
      line_end INTEGER
    );
  `);
  sqlite.prepare(
    `INSERT INTO qualified_repos (id, full_name) VALUES (1, 'mui/base-ui')`,
  ).run();
  return sqlite;
}

function legacyPacket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const demands = [
    'artifact:source',
    'artifact:test',
    'issue:term:bug',
    'issue:term:reliability',
    'structure:calls',
    'verification:term:vitest',
  ].map((family) => ({
    id: `demand-${family}`,
    family,
    narrative: `Review ${family}`,
    conceptKeys: ['term:typescript'],
    sourceSpanIds: ['span-a', 'span-b'],
    changedSymbolIds: [],
    weight: 0.167,
    contentHash: 'sha256:demand',
  }));

  return {
    schemaVersion: 'repo-semantic-graph-v1',
    policyVersion: 'repo-challenge-v1',
    id: 'packet-legacy',
    repoSnapshotId: 'snapshot-legacy',
    repository: {
      provider: 'github',
      owner: 'mui',
      name: 'base-ui',
      canonicalUrl: 'https://github.com/mui/base-ui',
    },
    pullRequest: {
      number: 973,
      url: 'https://github.com/mui/base-ui/pull/973',
      title: '[popover] Better handle impatient clicks',
      body: 'Source-backed PR body',
      author: 'dev',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mergedAt: '2026-06-20T12:00:00.000Z',
    },
    languageSupport: {
      normalizedLanguage: 'typescript',
      level: 'production',
      challengePacketsAllowed: true,
      reason: 'production parser available',
    },
    changedFilePaths: ['src/a.ts', 'src/b.ts'],
    changedSymbolIds: [],
    sourceSpanIds: ['span-a', 'span-b'],
    testChanges: [{ path: 'src/a.test.ts', framework: 'vitest', sourceSpanIds: ['span-b'], relatedSymbolIds: [] }],
    issue: null,
    demands,
    demandFamilies: demands.map((demand) => demand.family),
    quality: {
      score: 0.9,
      metrics: {
        provenanceCoverage: 1,
        reviewableSize: 1,
        testCoverage: 1,
        issueContext: 0,
        demandDiversity: 1,
      },
      gates: [],
      eligible: true,
    },
    contentHash: 'sha256:legacy',
    ...overrides,
  };
}

function seedLegacyPacket(sqlite: BetterSqliteDb, packet = legacyPacket()): void {
  sqlite.prepare(
    `INSERT INTO review_challenge_packets (
       id, repo_id, pr_number, production_ready, repo_snapshot_id, packet_json, updated_at
     ) VALUES (?, 1, 973, 1, 'snapshot-legacy', ?, '2026-06-01T00:00:00.000Z')`,
  ).run(String(packet.id), JSON.stringify(packet));
  sqlite.prepare(
    `INSERT INTO repo_source_spans (id, path, exact_text, line_start, line_end)
     VALUES
       ('span-a', 'src/a.ts', 'line1\nline2\nline3', 10, 12),
       ('span-b', 'src/b.ts', 'line4\nline5', 20, 21)`,
  ).run();
}

describe('backfillReviewPacketReviewProfiles', () => {
  let sqlite: BetterSqliteDb | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('dry-runs legacy packet review-profile repairs without mutating packet_json', async () => {
    sqlite = setupDb();
    seedLegacyPacket(sqlite);

    const result = await repairReviewPacketReviewProfiles(sqlite, { write: false });
    const row = sqlite.prepare(
      `SELECT packet_json FROM review_challenge_packets WHERE id = 'packet-legacy'`,
    ).get() as { packet_json: string };
    const packet = JSON.parse(row.packet_json) as { reviewProfile?: unknown; contentHash: string };

    expect(result.stats).toMatchObject({ scanned: 1, wouldUpdate: 1, updated: 0 });
    expect(result.outcomes[0]).toMatchObject({
      packetId: 'packet-legacy',
      status: 'would_update',
      reviewDifficultyBand: 'advanced',
      reviewExpectedSeniority: 'staff',
      reviewExpectedTimeMinutes: 75,
    });
    expect(packet.reviewProfile).toBeUndefined();
    expect(packet.contentHash).toBe('sha256:legacy');
  });

  it('writes assessment-fit review profiles and refreshes packet content hashes', async () => {
    sqlite = setupDb();
    seedLegacyPacket(sqlite);

    const result = await repairReviewPacketReviewProfiles(sqlite, { write: true });
    const row = sqlite.prepare(
      `SELECT packet_json, updated_at FROM review_challenge_packets WHERE id = 'packet-legacy'`,
    ).get() as { packet_json: string; updated_at: string };
    const packet = JSON.parse(row.packet_json) as {
      reviewProfile?: {
        difficultyBand: string;
        expectedSeniority: string;
        expectedTimeMinutes: number;
        basis: { changedFileCount: number; changedLineCount: number; sourceHunkCount: number };
      };
      contentHash: string;
    };

    expect(result.stats).toMatchObject({ scanned: 1, wouldUpdate: 0, updated: 1 });
    expect(packet.reviewProfile).toMatchObject({
      difficultyBand: 'advanced',
      expectedSeniority: 'staff',
      expectedTimeMinutes: 75,
      basis: {
        changedFileCount: 2,
        changedLineCount: 5,
        sourceHunkCount: 2,
      },
    });
    expect(packet.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(packet.contentHash).not.toBe('sha256:legacy');
    expect(row.updated_at).not.toBe('2026-06-01T00:00:00.000Z');
  });

  it('leaves already calibrated packets unchanged', async () => {
    sqlite = setupDb();
    seedLegacyPacket(sqlite, legacyPacket({
      reviewProfile: {
        source: 'deterministic_engineering_prior',
        difficultyBand: 'focused',
        expectedSeniority: 'senior',
        expectedTimeMinutes: 45,
        basis: {
          changedFileCount: 2,
          changedLineCount: 5,
          sourceHunkCount: 2,
          testChangeCount: 1,
          demandFamilyCount: 6,
          hasIssueContext: false,
        },
        rationale: 'focused review calibrated for senior candidates',
      },
    }));

    const result = await repairReviewPacketReviewProfiles(sqlite, { write: true });

    expect(result.stats).toMatchObject({ scanned: 1, alreadyReady: 1, updated: 0 });
    expect(result.outcomes[0]).toMatchObject({
      packetId: 'packet-legacy',
      status: 'already_ready',
    });
  });
});
