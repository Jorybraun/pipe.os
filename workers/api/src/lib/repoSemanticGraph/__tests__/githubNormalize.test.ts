import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import type { GitHubDiffResult } from '../../fetchGitHubDiff';
import {
  buildChallengePacket,
  deriveRepoSemantics,
  persistReviewChallengeGraph,
} from '../index';
import { normalizeGitHubPullRequest } from '../githubNormalize';

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

function hunkLines(prefix: string, count: number): Array<{ type: 'added'; content: string; lineNumber: number }> {
  return Array.from({ length: count }, (_, index) => ({
    type: 'added',
    content: `${prefix} ${index + 1}`,
    lineNumber: index + 1,
  }));
}

function diffFixture(): GitHubDiffResult {
  return {
    metadata: {
      title: 'Add idempotent order retry flow',
      author: 'engineer',
      created_at: '2026-06-18T12:00:00Z',
      state: 'closed',
      base: 'main',
      head: 'retry-orders',
      base_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      merged_at: '2026-06-19T12:00:00Z',
      description: 'Adds bounded retry behavior and source-backed tests.',
    },
    diff: {
      files: [
        {
          filename: 'src/orders/retry.ts',
          status: 'modified',
          additions: 8,
          deletions: 1,
          hunks: [{ header: '@@ retryOrder @@', lines: hunkLines('retry order event', 8) }],
          headContent: [
            'import { publishOrderEvent } from "./events";',
            '',
            'export function retryOrder(orderId: string) {',
            '  return publishOrderEvent(orderId);',
            '}',
          ].join('\n'),
          headContentUrl: 'https://api.github.com/repos/pipe-labs/orders/contents/src/orders/retry.ts?ref=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        {
          filename: 'src/orders/idempotency.ts',
          status: 'added',
          additions: 8,
          deletions: 0,
          hunks: [{ header: '@@ idempotencyKey @@', lines: hunkLines('idempotency key write', 8) }],
          headContent: [
            'export function idempotencyKey(orderId: string) {',
            '  return `order:${orderId}`;',
            '}',
          ].join('\n'),
          headContentUrl: 'https://api.github.com/repos/pipe-labs/orders/contents/src/orders/idempotency.ts?ref=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        {
          filename: 'src/orders/__tests__/retry.test.ts',
          status: 'modified',
          additions: 8,
          deletions: 1,
          hunks: [{ header: '@@ retry tests @@', lines: hunkLines('expect retry once', 8) }],
          headContent: [
            'import { retryOrder } from "../retry";',
            '',
            'it("retries once", () => {',
            '  expect(retryOrder("ord_123")).toBeDefined();',
            '});',
          ].join('\n'),
          headContentUrl: 'https://api.github.com/repos/pipe-labs/orders/contents/src/orders/__tests__/retry.test.ts?ref=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ],
    },
  };
}

describe('normalizeGitHubPullRequest', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);');
    sqlite.exec('INSERT INTO qualified_repos (id) VALUES (99);');
    sqlite.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec(livingContextMigration);
    sqlite.exec(repoGraphMigration);
    sqlite.exec(contextRecordMigration);
  });

  afterEach(() => sqlite.close());

  it('turns fetched GitHub PR data into persisted source-backed review packet evidence', async () => {
    const normalized = await normalizeGitHubPullRequest({
      repoUrl: 'https://github.com/pipe-labs/orders',
      prNumber: 42,
      diffResult: diffFixture(),
      primaryLanguage: 'TypeScript',
      defaultBranch: 'main',
      observedAt: '2026-06-20T00:00:00.000Z',
    });

    expect(normalized.metadataSourceSpanIds).toHaveLength(1);
    expect(normalized.sourceArtifacts?.some((artifact) => artifact.kind === 'pull_request')).toBe(true);
    expect(normalized.sourceArtifacts?.filter((artifact) =>
      artifact.externalRef?.includes('/contents/src/orders/')
    )).toHaveLength(3);
    expect(normalized.sourceSpans.length).toBeGreaterThan(7);
    expect(normalized.changedFiles).toHaveLength(3);
    expect(normalized.tests).toHaveLength(1);
    expect(normalized.extractionDiagnostics).toEqual([]);
    expect(normalized.structuralFacts?.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining(['changed_symbol', 'imports', 'calls', 'contains']),
    );
    expect(normalized.changedFiles.flatMap((file) =>
      file.symbols.map((symbol) => symbol.name)
    )).toEqual(expect.arrayContaining(['retryOrder', 'idempotencyKey']));
    expect(normalized.changedFiles.some((file) =>
      file.symbols.some((symbol) => symbol.modifiers.includes('runtime-source-analysis'))
    )).toBe(true);

    const packet = await buildChallengePacket(normalized);
    const graph = await deriveRepoSemantics({
      pullRequest: normalized,
      packet,
      structuralFacts: normalized.structuralFacts ?? [],
    });
    await persistReviewChallengeGraph(createMockD1(sqlite), 99, normalized, packet, {
      structuralFacts: normalized.structuralFacts ?? [],
      codeEpisodes: graph.episodes,
      facets: graph.facets,
      semanticAssertions: graph.assertions,
      repoSignals: graph.signals,
    });

    const persistedPacket = sqlite.prepare(
      'SELECT repo_id, pr_number, source_hash, packet_json FROM review_challenge_packets WHERE id = ?',
    ).get(packet.id) as { repo_id: number; pr_number: number; source_hash: string; packet_json: string };
    expect(persistedPacket).toMatchObject({
      repo_id: 99,
      pr_number: 42,
      source_hash: packet.contentHash,
    });
    expect(JSON.parse(persistedPacket.packet_json)).toMatchObject({
      id: packet.id,
      pullRequest: { number: 42 },
    });

    const metadataArtifact = sqlite.prepare(
      "SELECT artifact_type FROM repo_source_artifacts WHERE path = '.pipe/pull-requests/42.json'",
    ).get() as { artifact_type: string };
    expect(metadataArtifact.artifact_type).toBe('pull_request');
    expect(sqlite.prepare(
      "SELECT COUNT(*) AS count FROM repo_source_artifacts WHERE external_reference LIKE '%/contents/src/orders/%'",
    ).get()).toEqual({ count: 3 });
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM repo_structural_facts').get() as { count: number }).count)
      .toBeGreaterThan(3);
    expect((sqlite.prepare(
      "SELECT COUNT(*) AS count FROM repo_structural_facts WHERE fact_type = 'calls'",
    ).get() as { count: number }).count).toBeGreaterThan(0);
  });

  it('marks production-language packets incomplete when full source fetch is missing', async () => {
    const fixture = diffFixture();
    delete fixture.diff.files[0]!.headContent;
    delete fixture.diff.files[0]!.headContentUrl;

    const normalized = await normalizeGitHubPullRequest({
      repoUrl: 'https://github.com/pipe-labs/orders',
      prNumber: 42,
      diffResult: fixture,
      primaryLanguage: 'TypeScript',
      defaultBranch: 'main',
      observedAt: '2026-06-20T00:00:00.000Z',
    });

    expect(normalized.extractionDiagnostics).toEqual([
      expect.objectContaining({
        kind: 'full_source_fetch',
        path: 'src/orders/retry.ts',
        language: 'typescript',
      }),
    ]);

    const packet = await buildChallengePacket(normalized);
    const completeProvenance = packet.quality.gates.find((gate) => gate.gate === 'complete_provenance');
    expect(completeProvenance).toMatchObject({
      passed: false,
    });
    expect(completeProvenance?.reason).toContain('full_source_fetch failed for src/orders/retry.ts');
    expect(packet.quality.eligible).toBe(false);
  });

  it('marks production-language packets incomplete when runtime parser support is missing', async () => {
    const fixture: GitHubDiffResult = {
      metadata: {
        title: 'Add order retry script',
        author: 'engineer',
        created_at: '2026-06-18T12:00:00Z',
        state: 'closed',
        base: 'main',
        head: 'retry-orders',
        base_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        merged_at: '2026-06-19T12:00:00Z',
        description: 'Adds Python retry behavior and tests.',
      },
      diff: {
        files: [
          {
            filename: 'orders/retry.py',
            status: 'modified',
            additions: 8,
            deletions: 1,
            hunks: [{ header: '@@ -1,1 +1,8 @@', lines: hunkLines('retry order event', 8) }],
            headContent: [
              'from orders.events import publish',
              '',
              'def retry_order(order_id):',
              '    return publish(order_id)',
            ].join('\n'),
          },
          {
            filename: 'orders/idempotency.py',
            status: 'added',
            additions: 8,
            deletions: 0,
            hunks: [{ header: '@@ -0,0 +1,8 @@', lines: hunkLines('idempotency key write', 8) }],
            headContent: [
              'def idempotency_key(order_id):',
              '    return f"order:{order_id}"',
            ].join('\n'),
          },
          {
            filename: 'tests/test_retry.py',
            status: 'modified',
            additions: 8,
            deletions: 1,
            hunks: [{ header: '@@ -1,1 +1,8 @@', lines: hunkLines('expect retry once', 8) }],
            headContent: [
              'from orders.retry import retry_order',
              '',
              'def test_retry_order():',
              '    assert retry_order("ord_123") is not None',
            ].join('\n'),
          },
        ],
      },
    };

    const normalized = await normalizeGitHubPullRequest({
      repoUrl: 'https://github.com/pipe-labs/orders',
      prNumber: 43,
      diffResult: fixture,
      primaryLanguage: 'Python',
      defaultBranch: 'main',
      observedAt: '2026-06-20T00:00:00.000Z',
    });

    expect(normalized.extractionDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'semantic_parser',
          path: 'orders/retry.py',
          language: 'python',
        }),
      ]),
    );

    const packet = await buildChallengePacket(normalized);
    const completeProvenance = packet.quality.gates.find((gate) => gate.gate === 'complete_provenance');
    expect(completeProvenance).toMatchObject({
      passed: false,
    });
    expect(completeProvenance?.reason).toContain('semantic_parser failed for orders/retry.py');
    expect(packet.quality.eligible).toBe(false);
  });
});
