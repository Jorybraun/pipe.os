import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import type { DiscoveredRepoRow } from '../../../types';
import {
  assertPacketProductionReady,
  convertRepoToChallenge,
  packetGateFailures,
} from '../convertToChallenge';

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

function changedPatch(label: string, lines = 8): string {
  return [
    `@@ -1,1 +1,${lines} @@`,
    ...Array.from({ length: lines }, (_, index) => `+${label} ${index + 1}`),
  ].join('\n');
}

function prResponse() {
  return {
    title: 'Add idempotent order retry flow',
    body: 'Adds bounded retry behavior and source-backed tests.',
    state: 'closed',
    user: { login: 'engineer' },
    created_at: '2026-06-18T12:00:00Z',
    merged_at: '2026-06-19T12:00:00Z',
    base: { ref: 'main', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    head: { ref: 'retry-orders', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  };
}

function fileResponse(includeTest: boolean) {
  return [
    {
      filename: 'src/orders/retry.ts',
      status: 'modified',
      additions: 8,
      deletions: 1,
      patch: changedPatch('retry order event'),
    },
    {
      filename: 'src/orders/idempotency.ts',
      status: 'added',
      additions: 8,
      deletions: 0,
      patch: changedPatch('idempotency key write'),
    },
    {
      filename: includeTest ? 'src/orders/__tests__/retry.test.ts' : 'src/orders/audit.ts',
      status: 'modified',
      additions: 8,
      deletions: 1,
      patch: changedPatch(includeTest ? 'expect retry once' : 'audit retry evidence'),
    },
  ];
}

function headContentResponse(path: string): string | null {
  switch (path) {
    case 'src/orders/retry.ts':
      return [
        'import { publishOrderEvent } from "./events";',
        '',
        'export function retryOrder(orderId: string) {',
        '  return publishOrderEvent(orderId);',
        '}',
      ].join('\n');
    case 'src/orders/idempotency.ts':
      return [
        'export function idempotencyKey(orderId: string) {',
        '  return `order:${orderId}`;',
        '}',
      ].join('\n');
    case 'src/orders/__tests__/retry.test.ts':
      return [
        'import { retryOrder } from "../retry";',
        '',
        'it("retries once", () => {',
        '  expect(retryOrder("ord_123")).toBeDefined();',
        '});',
      ].join('\n');
    case 'src/orders/audit.ts':
      return [
        'export function auditRetry(orderId: string) {',
        '  return orderId;',
        '}',
      ].join('\n');
    default:
      return null;
  }
}

function mockGitHubFetch(includeTest: boolean): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith('/pulls/42')) {
      return new Response(JSON.stringify(prResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (href.endsWith('/pulls/42/files?per_page=100')) {
      return new Response(JSON.stringify(fileResponse(includeTest)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const contentsMatch = href.match(/\/contents\/([^?]+)\?ref=/);
    if (contentsMatch) {
      const content = headContentResponse(decodeURIComponent(contentsMatch[1] ?? ''));
      if (content !== null) {
        return new Response(content, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    }
    return new Response('not found', { status: 404 });
  }));
}

function discoveredRepo(): DiscoveredRepoRow {
  return {
    id: 'discovered-1',
    pipeline_id: 'pipeline-1',
    role_context_id: null,
    owner_id: 'user-1',
    github_owner: 'pipe-labs',
    github_repo: 'orders',
    github_url: 'https://github.com/pipe-labs/orders',
    default_branch: 'main',
    discovery_source: 'MANUAL',
    discovery_query: null,
    stars: 100,
    last_pushed_at: null,
    license: null,
    is_archived: 0,
    is_fork: 0,
    has_ci: 1,
    primary_language: 'TypeScript',
    topics: null,
    detected_stack: null,
    stack_match_score: null,
    sloc: null,
    mean_cyclomatic_complexity: null,
    source_file_count: null,
    seniority_band: 'SENIOR',
    quality_score: null,
    quality_details: null,
    status: 'ACCEPTED',
    rejection_reason: null,
    error_message: null,
    challenge_template_id: null,
    created_at: '2026-06-20T00:00:00.000Z',
    updated_at: '2026-06-20T00:00:00.000Z',
  };
}

function setupDb(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(`
    CREATE TABLE discovered_repos (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      error_message TEXT,
      challenge_template_id TEXT,
      updated_at TEXT
    );
    INSERT INTO discovered_repos (id, status, error_message, challenge_template_id, updated_at)
    VALUES ('discovered-1', 'ACCEPTED', NULL, NULL, '2026-06-20T00:00:00.000Z');

    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      github_url TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL
    );
    INSERT INTO qualified_repos (id, github_url, full_name)
    VALUES (99, 'https://github.com/pipe-labs/orders', 'pipe-labs/orders');

    CREATE TABLE challenge_templates (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      instructions TEXT,
      difficulty TEXT,
      primary_skill TEXT,
      config TEXT,
      server_config TEXT,
      source TEXT,
      is_published INTEGER,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE candidates (id TEXT PRIMARY KEY);
  `);
  sqlite.exec(livingContextMigration);
  sqlite.exec(repoGraphMigration);
  sqlite.exec(contextRecordMigration);
  return sqlite;
}

describe('convertRepoToChallenge packet readiness guard', () => {
  let sqlite: BetterSqliteDb | null = null;

  beforeEach(() => {
    sqlite = setupDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sqlite?.close();
    sqlite = null;
  });

  it('reports failed gates from a review challenge packet', () => {
    const failures = packetGateFailures({
      quality: {
        eligible: false,
        score: 0.52,
        metrics: {
          provenanceCoverage: 1,
          reviewableSize: 1,
          testCoverage: 0,
          issueContext: 0,
          demandDiversity: 0.5,
        },
        gates: [
          { gate: 'complete_provenance', passed: true, reason: 'all evidence resolves to exact source spans' },
          { gate: 'contains_tests', passed: false, reason: '0 normalized test changes available' },
          { gate: 'minimum_quality', passed: false, reason: 'quality score 0.52; minimum 0.7' },
        ],
      },
    });

    expect(failures).toEqual([
      'contains_tests: 0 normalized test changes available',
      'minimum_quality: quality score 0.52; minimum 0.7',
    ]);
  });

  it('throws before legacy challenge-template creation when packet is not production-ready', () => {
    expect(() => assertPacketProductionReady({
      id: 'packet-not-ready',
      quality: {
        eligible: false,
        score: 0.45,
        metrics: {
          provenanceCoverage: 1,
          reviewableSize: 1,
          testCoverage: 0,
          issueContext: 0,
          demandDiversity: 0.5,
        },
        gates: [
          { gate: 'contains_tests', passed: false, reason: '0 normalized test changes available' },
        ],
      },
    })).toThrow(
      'Review challenge packet packet-not-ready is not production-ready. Failed gates: contains_tests: 0 normalized test changes available',
    );
  });

  it('persists an eligible source-backed packet before creating the legacy challenge template', async () => {
    mockGitHubFetch(true);

    const result = await convertRepoToChallenge(createMockD1(sqlite!), discoveredRepo(), {
      prNumber: 42,
    });

    expect(result).toMatchObject({
      prNumber: 42,
      packetEligible: true,
      packetGateFailures: [],
    });
    expect(result.packetId).toMatch(/^challenge_packet_/);
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({ count: 1 });
    expect(sqlite!.prepare('SELECT production_ready AS ready FROM review_challenge_packets').get()).toEqual({ ready: 1 });
    expect((sqlite!.prepare('SELECT COUNT(*) AS count FROM repo_source_spans').get() as { count: number }).count)
      .toBeGreaterThan(4);
    expect(sqlite!.prepare(
      "SELECT COUNT(*) AS count FROM repo_source_artifacts WHERE external_reference LIKE '%/contents/src/orders/%'",
    ).get()).toEqual({ count: 3 });
    expect((sqlite!.prepare(
      "SELECT COUNT(*) AS count FROM repo_structural_facts WHERE fact_type = 'calls'",
    ).get() as { count: number }).count).toBeGreaterThan(0);
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM challenge_templates').get()).toEqual({ count: 1 });
    expect(sqlite!.prepare('SELECT status FROM discovered_repos WHERE id = ?').get('discovered-1')).toEqual({
      status: 'CHALLENGE_READY',
    });
  });

  it('keeps ineligible packet diagnostics but does not create a legacy challenge template', async () => {
    mockGitHubFetch(false);

    await expect(convertRepoToChallenge(createMockD1(sqlite!), discoveredRepo(), {
      prNumber: 42,
    })).rejects.toThrow('is not production-ready');

    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({ count: 1 });
    expect(sqlite!.prepare('SELECT production_ready AS ready FROM review_challenge_packets').get()).toEqual({ ready: 0 });
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM challenge_templates').get()).toEqual({ count: 0 });
    const failed = sqlite!.prepare(
      'SELECT status, error_message FROM discovered_repos WHERE id = ?',
    ).get('discovered-1') as { status: string; error_message: string };
    expect(failed.status).toBe('FAILED');
    expect(failed.error_message).toContain('contains_tests');
  });

  it('does not auto-select undersized fallback PRs when no reviewable PR is listed', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('/pulls?state=closed')) {
        return new Response(JSON.stringify([
          {
            number: 7,
            title: 'Tiny typo fix',
            body: null,
            state: 'closed',
            merged_at: '2026-06-19T12:00:00Z',
            changed_files: 1,
            additions: 1,
            deletions: 0,
          },
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('unexpected fetch', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(convertRepoToChallenge(createMockD1(sqlite!), discoveredRepo(), {}))
      .rejects.toThrow('No suitable merged PRs found in this repo for a review challenge packet');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({ count: 0 });
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM challenge_templates').get()).toEqual({ count: 0 });
    const failed = sqlite!.prepare(
      'SELECT status, error_message FROM discovered_repos WHERE id = ?',
    ).get('discovered-1') as { status: string; error_message: string };
    expect(failed.status).toBe('FAILED');
    expect(failed.error_message).toContain('Automatic selection requires a merged PR with 3-50 changed files');
  });
});
