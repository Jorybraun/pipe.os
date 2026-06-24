import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import type { GitHubDiffResult } from '../../fetchGitHubDiff';
import {
  backfillReviewChallengePackets,
  countOverlayReadyPackets,
  selectEligibleCrawlerPullRequests,
  type GitHubDiffFetcher,
} from '../backfill';

const repoGraphMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

const REPO_ID = 77;
const PR_NUMBER = 142;
const GITHUB_URL = 'https://github.com/pipe-labs/ledger-sync';
const HEAD_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BASE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function hunkLines(
  prefix: string,
  count: number,
): Array<{ type: 'added'; content: string; lineNumber: number }> {
  return Array.from({ length: count }, (_, index) => ({
    type: 'added',
    content: `${prefix} line ${index + 1}`,
    lineNumber: index + 1,
  }));
}

/**
 * Realistic GitHub diff fixture for a merged TypeScript PR that touches 3
 * source/test files — enough to pass every challenge packet quality gate
 * (reviewable file count, reviewable change size, contains tests, demand
 * diversity, complete provenance, minimum quality).
 */
function realEligibleDiffFixture(): GitHubDiffResult {
  return {
    metadata: {
      title: 'Add idempotent ledger reconciliation with retry budget',
      author: 'engineer',
      created_at: '2026-06-18T12:00:00Z',
      state: 'closed',
      base: 'main',
      head: 'reconcile-ledger',
      base_sha: BASE_SHA,
      head_sha: HEAD_SHA,
      merged_at: '2026-06-19T12:00:00Z',
      description:
        'Adds bounded retries and transactional idempotency for ledger reconciliation events.',
    },
    diff: {
      files: [
        {
          filename: 'src/ledger/reconcile.ts',
          status: 'modified',
          additions: 9,
          deletions: 2,
          hunks: [{ header: '@@ -1,4 +1,11 @@', lines: hunkLines('reconcile ledger entry', 9) }],
          headContent: [
            'import { publishLedgerEvent } from "./events";',
            '',
            'export function reconcileLedger(orderId: string): void {',
            '  const key = `ledger:${orderId}`;',
            '  publishLedgerEvent(key);',
            '}',
          ].join('\n'),
          headContentUrl: `https://api.github.com/repos/pipe-labs/ledger-sync/contents/src/ledger/reconcile.ts?ref=${HEAD_SHA}`,
        },
        {
          filename: 'src/ledger/idempotency.ts',
          status: 'added',
          additions: 8,
          deletions: 0,
          hunks: [{ header: '@@ -0,0 +1,8 @@', lines: hunkLines('idempotency key write', 8) }],
          headContent: [
            'export function idempotencyKey(orderId: string): string {',
            '  return `order:${orderId}`;',
            '}',
          ].join('\n'),
          headContentUrl: `https://api.github.com/repos/pipe-labs/ledger-sync/contents/src/ledger/idempotency.ts?ref=${HEAD_SHA}`,
        },
        {
          filename: 'src/ledger/__tests__/reconcile.test.ts',
          status: 'modified',
          additions: 9,
          deletions: 1,
          hunks: [{ header: '@@ -1,3 +1,11 @@', lines: hunkLines('expect reconcile once', 9) }],
          headContent: [
            'import { reconcileLedger } from "../reconcile";',
            '',
            'it("reconciles once", () => {',
            '  expect(reconcileLedger("ord_123")).toBeDefined();',
            '});',
          ].join('\n'),
          headContentUrl: `https://api.github.com/repos/pipe-labs/ledger-sync/contents/src/ledger/__tests__/reconcile.test.ts?ref=${HEAD_SHA}`,
        },
      ],
    },
  };
}

function createSchema(sqlite: BetterSqliteDb): void {
  sqlite.exec('PRAGMA foreign_keys = ON;');
  // Minimal qualified_repos with the columns the backfill query joins on.
  sqlite.exec(`
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_url TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      primary_language TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0,
      disqualified INTEGER NOT NULL DEFAULT 0,
      pr_quality_score REAL NOT NULL DEFAULT 0
    );
  `);
  // Minimal repo_sample_prs matching migration 0021.
  sqlite.exec(`
    CREATE TABLE repo_sample_prs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,
      pr_number INTEGER NOT NULL,
      pr_url TEXT NOT NULL,
      title TEXT,
      merged_at TEXT NOT NULL,
      resolves_issue_number INTEGER,
      changed_file_count INTEGER NOT NULL,
      modifies_tests INTEGER NOT NULL DEFAULT 0,
      additions INTEGER,
      deletions INTEGER,
      swe_bench_eligible INTEGER NOT NULL DEFAULT 0,
      UNIQUE (repo_id, pr_number)
    );
  `);
  sqlite.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY);');
  sqlite.exec(livingContextMigration);
  sqlite.exec(repoGraphMigration);
  sqlite.exec(contextRecordMigration);
}

function seedCrawlerPr(
  sqlite: BetterSqliteDb,
  overrides: Partial<{
    repoId: number;
    prNumber: number;
    githubUrl: string;
    fullName: string;
    primaryLanguage: string;
    changedFileCount: number;
    additions: number;
    deletions: number;
    modifiesTests: number;
    mergedAt: string;
    sweBenchEligible: number;
    disqualified: number;
    isArchived: number;
  }> = {},
): void {
  const repoId = overrides.repoId ?? REPO_ID;
  sqlite.prepare(
    `INSERT INTO qualified_repos (id, github_url, full_name, primary_language, is_archived, disqualified, pr_quality_score)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       github_url = excluded.github_url,
       full_name = excluded.full_name,
       primary_language = excluded.primary_language`,
  ).run(
    repoId,
    overrides.githubUrl ?? GITHUB_URL,
    overrides.fullName ?? 'pipe-labs/ledger-sync',
    overrides.primaryLanguage ?? 'TypeScript',
    overrides.isArchived ?? 0,
    overrides.disqualified ?? 0,
    0.82,
  );
  sqlite.prepare(
    `INSERT INTO repo_sample_prs (
       repo_id, pr_number, pr_url, title, merged_at, resolves_issue_number,
       changed_file_count, modifies_tests, additions, deletions, swe_bench_eligible
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo_id, pr_number) DO UPDATE SET
       pr_url = excluded.pr_url,
       title = excluded.title,
       merged_at = excluded.merged_at,
       changed_file_count = excluded.changed_file_count,
       modifies_tests = excluded.modifies_tests,
       additions = excluded.additions,
       deletions = excluded.deletions,
       swe_bench_eligible = excluded.swe_bench_eligible`,
  ).run(
    repoId,
    overrides.prNumber ?? PR_NUMBER,
    overrides.githubUrl ?? GITHUB_URL,
    'Add idempotent ledger reconciliation with retry budget',
    overrides.mergedAt ?? '2026-06-19T12:00:00Z',
    null,
    overrides.changedFileCount ?? 3,
    overrides.modifiesTests ?? 1,
    overrides.additions ?? 26,
    overrides.deletions ?? 3,
    overrides.sweBenchEligible ?? 1,
  );
}

describe('backfillReviewChallengePackets', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
  });

  afterEach(() => sqlite.close());

  it('selects only eligible merged crawler PRs with a production language and test changes', async () => {
    seedCrawlerPr(sqlite); // eligible TypeScript PR
    seedCrawlerPr(sqlite, {
      repoId: REPO_ID + 1,
      prNumber: 200,
      githubUrl: 'https://github.com/pipe-labs/rust-tool',
      fullName: 'pipe-labs/rust-tool',
      primaryLanguage: 'Rust',
    }); // ineligible: Rust is structural_only
    seedCrawlerPr(sqlite, {
      repoId: REPO_ID + 2,
      prNumber: 201,
      githubUrl: 'https://github.com/pipe-labs/no-tests',
      fullName: 'pipe-labs/no-tests',
      modifiesTests: 0,
    }); // ineligible: no test changes
    seedCrawlerPr(sqlite, {
      repoId: REPO_ID + 3,
      prNumber: 202,
      githubUrl: 'https://github.com/pipe-labs/too-big',
      fullName: 'pipe-labs/too-big',
      changedFileCount: 60,
      additions: 2000,
      deletions: 100,
    }); // ineligible: exceeds file/line thresholds
    seedCrawlerPr(sqlite, {
      repoId: REPO_ID + 4,
      prNumber: 203,
      githubUrl: 'https://github.com/pipe-labs/archived',
      fullName: 'pipe-labs/archived',
      isArchived: 1,
    }); // ineligible: archived repo

    const d1 = createMockD1(sqlite);
    const eligible = await selectEligibleCrawlerPullRequests(d1, 25);

    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toMatchObject({
      repo_id: REPO_ID,
      pr_number: PR_NUMBER,
      github_url: GITHUB_URL,
      primary_language: 'TypeScript',
    });
  });

  it('backfills a real source-backed overlay-ready packet with exact spans, facts, symbols, refs, context record, and concept links', async () => {
    seedCrawlerPr(sqlite);
    const fetchDiff: GitHubDiffFetcher = async () => realEligibleDiffFixture();
    const d1 = createMockD1(sqlite);

    const report = await backfillReviewChallengePackets(
      { DB: d1, fetchDiff },
      { observedAt: '2026-06-20T00:00:00.000Z' },
    );

    expect(report.processed).toBe(1);
    expect(report.succeeded).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      repoId: REPO_ID,
      prNumber: PR_NUMBER,
      productionReady: true,
      failed: false,
      skipped: false,
    });
    expect(report.results[0]!.packetId).toMatch(/^challenge_packet_[a-f0-9]{24}$/);
    expect(report.results[0]!.qualityScore).toBeGreaterThanOrEqual(0.7);
    expect(report.results[0]!.demandFamilies.length).toBeGreaterThanOrEqual(2);

    // Readiness gate: at least one real overlay-ready packet in D1.
    expect(report.overlayReadyPackets).toBeGreaterThanOrEqual(1);
    expect(await countOverlayReadyPackets(d1)).toBe(1);

    const packetRow = sqlite.prepare(
      'SELECT id, repo_id, pr_number, source_hash, production_ready, quality_score, demand_families_json, packet_json FROM review_challenge_packets',
    ).get() as {
      id: string;
      repo_id: number;
      pr_number: number;
      source_hash: string;
      production_ready: number;
      quality_score: number;
      demand_families_json: string;
      packet_json: string;
    };
    expect(packetRow.repo_id).toBe(REPO_ID);
    expect(packetRow.pr_number).toBe(PR_NUMBER);
    expect(packetRow.production_ready).toBe(1);
    expect(packetRow.source_hash).toBe(report.results[0]!.packetId ? packetRow.source_hash : '');
    const persistedPacket = JSON.parse(packetRow.packet_json);
    expect(persistedPacket.id).toBe(report.results[0]!.packetId);
    expect(persistedPacket.quality.eligible).toBe(true);
    expect(persistedPacket.sourceSpanIds.length).toBeGreaterThan(0);

    // Exact source spans persisted verbatim from GitHub head content.
    const spanRows = sqlite.prepare(
      'SELECT id, exact_text, byte_start, byte_end, line_start, line_end, pr_side, content_hash FROM repo_source_spans ORDER BY id',
    ).all() as Array<{
      id: string;
      exact_text: string;
      byte_start: number;
      byte_end: number;
      line_start: number;
      line_end: number;
      pr_side: string;
      content_hash: string;
    }>;
    expect(spanRows.length).toBeGreaterThan(0);
    expect(spanRows.every((span) => span.exact_text.length > 0)).toBe(true);
    // Every packet source span resolves to a persisted row with exact text.
    const spanIds = new Set(spanRows.map((span) => span.id));
    expect(persistedPacket.sourceSpanIds.every((id: string) => spanIds.has(id))).toBe(true);

    // Structural facts derived from real source (changed_symbol, imports, calls, contains).
    const factTypes = sqlite.prepare(
      'SELECT DISTINCT fact_type FROM repo_structural_facts',
    ).all() as Array<{ fact_type: string }>;
    expect(factTypes.map((row) => row.fact_type)).toEqual(
      expect.arrayContaining(['changed_symbol', 'imports', 'calls', 'contains']),
    );

    // Symbols extracted from real GitHub head source.
    const symbolRows = sqlite.prepare(
      'SELECT id, qualified_name, symbol_kind, defining_span_id FROM repo_symbols ORDER BY id',
    ).all() as Array<{
      id: string;
      qualified_name: string;
      symbol_kind: string;
      defining_span_id: string;
    }>;
    expect(symbolRows.length).toBeGreaterThan(0);
    expect(symbolRows.some((symbol) => symbol.qualified_name.includes('reconcileLedger'))).toBe(true);
    expect(symbolRows.some((symbol) => symbol.qualified_name.includes('idempotencyKey'))).toBe(true);
    expect(persistedPacket.changedSymbolIds.every((id: string) =>
      symbolRows.some((symbol) => symbol.id === id),
    )).toBe(true);

    // Repo source refs: GitHub head-content external references persisted.
    const externalRefs = sqlite.prepare(
      "SELECT COUNT(*) AS count FROM repo_source_artifacts WHERE external_reference LIKE '%/contents/src/ledger/%'",
    ).get() as { count: number };
    expect(externalRefs.count).toBe(3);

    // Context record linking the packet to repo snapshot, PR, demands, and concepts.
    const contextRecord = sqlite.prepare(
      `SELECT scope_type, scope_id, record_type, predicate, narrative, confidence, extraction_version
         FROM context_records WHERE record_type = 'repo_challenge_packet'`,
    ).get() as {
      scope_type: string;
      scope_id: string;
      record_type: string;
      predicate: string;
      narrative: string;
      confidence: number;
      extraction_version: string;
    };
    expect(contextRecord).toMatchObject({
      scope_type: 'repo_snapshot',
      record_type: 'repo_challenge_packet',
      predicate: 'defines reviewable pull request challenge',
    });
    expect(contextRecord.narrative).toContain(`PR #${PR_NUMBER}`);

    // Context record source refs point at persisted repo source spans with exact text.
    const sourceRefs = sqlite.prepare(
      `SELECT refs.source_ref_id, refs.exact_text, refs.content_hash,
              spans.exact_text AS span_exact_text, spans.content_hash AS span_content_hash
         FROM context_record_source_refs refs
         JOIN repo_source_spans spans ON spans.id = refs.source_ref_id
        WHERE refs.source_ref_type = 'repo_source_span'
        ORDER BY refs.source_ref_id`,
    ).all() as Array<{
      source_ref_id: string;
      exact_text: string;
      content_hash: string;
      span_exact_text: string;
      span_content_hash: string;
    }>;
    expect(sourceRefs.length).toBe(persistedPacket.sourceSpanIds.length);
    expect(sourceRefs.every((ref) =>
      ref.exact_text === ref.span_exact_text && ref.content_hash === ref.span_content_hash,
    )).toBe(true);

    // Concept links: open concepts derived from source-backed demands.
    const conceptRows = sqlite.prepare(
      `SELECT c.canonical_key, c.namespace, c.label
         FROM context_record_concepts crc
         JOIN concepts c ON c.id = crc.concept_id
        ORDER BY c.canonical_key`,
    ).all() as Array<{ canonical_key: string; namespace: string; label: string }>;
    expect(conceptRows.length).toBeGreaterThan(0);
    expect(conceptRows.some((concept) => concept.namespace === 'term')).toBe(true);

    // Derived semantic graph: episodes, facets, assertions, signals.
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM repo_code_episodes').get() as { count: number }).count).toBe(1);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM repo_facets').get() as { count: number }).count).toBeGreaterThan(0);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM repo_semantic_assertions').get() as { count: number }).count).toBe(persistedPacket.demands.length);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM repo_signals').get() as { count: number }).count).toBeGreaterThan(0);
  });

  it('is idempotent: a second backfill run skips already-persisted packets and preserves byte-identical state', async () => {
    seedCrawlerPr(sqlite);
    const fetchDiff: GitHubDiffFetcher = async () => realEligibleDiffFixture();
    const d1 = createMockD1(sqlite);

    const first = await backfillReviewChallengePackets(
      { DB: d1, fetchDiff },
      { observedAt: '2026-06-20T00:00:00.000Z' },
    );
    expect(first.succeeded).toBe(1);
    expect(first.skipped).toBe(0);

    const firstPacketJson = (sqlite.prepare(
      'SELECT packet_json FROM review_challenge_packets',
    ).get() as { packet_json: string }).packet_json;
    const firstSpanCount = (sqlite.prepare('SELECT COUNT(*) AS count FROM repo_source_spans').get() as { count: number }).count;
    const firstFactCount = (sqlite.prepare('SELECT COUNT(*) AS count FROM repo_structural_facts').get() as { count: number }).count;
    const firstContextCount = (sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get() as { count: number }).count;

    // Second run without force: the already-persisted packet is skipped.
    const second = await backfillReviewChallengePackets(
      { DB: d1, fetchDiff },
      { observedAt: '2026-06-20T00:00:00.000Z' },
    );
    expect(second.processed).toBe(1);
    expect(second.succeeded).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.failed).toBe(0);
    expect(second.overlayReadyPackets).toBe(1);

    // State is byte-identical — no duplicate rows, no changed packet content.
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get() as { count: number }).count).toBe(1);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM repo_source_spans').get() as { count: number }).count).toBe(firstSpanCount);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM repo_structural_facts').get() as { count: number }).count).toBe(firstFactCount);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get() as { count: number }).count).toBe(firstContextCount);
    expect((sqlite.prepare('SELECT packet_json FROM review_challenge_packets').get() as { packet_json: string }).packet_json).toBe(firstPacketJson);
  });

  it('force-rebuild re-fetches and re-persists an already-persisted packet idempotently', async () => {
    seedCrawlerPr(sqlite);
    const fetchDiff: GitHubDiffFetcher = async () => realEligibleDiffFixture();
    const d1 = createMockD1(sqlite);

    await backfillReviewChallengePackets(
      { DB: d1, fetchDiff },
      { observedAt: '2026-06-20T00:00:00.000Z' },
    );
    const firstPacketJson = (sqlite.prepare(
      'SELECT packet_json FROM review_challenge_packets',
    ).get() as { packet_json: string }).packet_json;

    // Force rebuild: re-fetches from GitHub and re-persists.
    const forced = await backfillReviewChallengePackets(
      { DB: d1, fetchDiff },
      { observedAt: '2026-06-20T00:00:00.000Z', force: true },
    );
    expect(forced.succeeded).toBe(1);
    expect(forced.skipped).toBe(0);

    // Packet content is byte-identical (deterministic identity + content hash).
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get() as { count: number }).count).toBe(1);
    expect((sqlite.prepare('SELECT packet_json FROM review_challenge_packets').get() as { packet_json: string }).packet_json).toBe(firstPacketJson);
    expect(forced.overlayReadyPackets).toBe(1);
  });

  it('reports a failed result without persisting when GitHub diff fetch returns no data', async () => {
    seedCrawlerPr(sqlite);
    const fetchDiff: GitHubDiffFetcher = async () => null;
    const d1 = createMockD1(sqlite);

    const report = await backfillReviewChallengePackets(
      { DB: d1, fetchDiff },
      { observedAt: '2026-06-20T00:00:00.000Z' },
    );

    expect(report.succeeded).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.results[0]).toMatchObject({ failed: true, prNumber: PR_NUMBER });
    expect(report.overlayReadyPackets).toBe(0);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get() as { count: number }).count).toBe(0);
  });

  it('readiness gate reports zero overlay-ready packets when no eligible PRs exist in crawler D1', async () => {
    // No PRs seeded.
    const d1 = createMockD1(sqlite);
    const fetchDiff: GitHubDiffFetcher = async () => realEligibleDiffFixture();

    const report = await backfillReviewChallengePackets(
      { DB: d1, fetchDiff },
      { observedAt: '2026-06-20T00:00:00.000Z' },
    );

    expect(report.processed).toBe(0);
    expect(report.succeeded).toBe(0);
    expect(report.overlayReadyPackets).toBe(0);
  });
});
