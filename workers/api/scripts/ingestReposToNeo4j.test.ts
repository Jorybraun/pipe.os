import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  discoverLocalDatabase,
  loadSourceBackedReviewPullRequests,
  parseArgs,
  sourceBackedPullRequestNarrative,
  sourceBackedRepoProfile,
} from './ingestReposToNeo4j';

describe('ingestReposToNeo4j CLI helpers', () => {
  it('parses dry-run, batch, limit, and database path options', () => {
    expect(parseArgs([
      '--dry-run',
      '--limit',
      '3',
      '--batch-size=2',
      '--database-path',
      '.wrangler/test.sqlite',
    ])).toEqual({
      dryRun: true,
      limit: 3,
      batchSize: 2,
      databasePath: '.wrangler/test.sqlite',
    });
  });

  it('discovers the single local D1 sqlite database while ignoring metadata.sqlite', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipe-d1-'));
    try {
      const d1Dir = join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
      mkdirSync(d1Dir, { recursive: true });
      writeFileSync(join(d1Dir, 'metadata.sqlite'), '');
      writeFileSync(join(d1Dir, 'local-db.sqlite'), '');

      expect(discoverLocalDatabase(undefined, root)).toBe(join(d1Dir, 'local-db.sqlite'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires an explicit database path when discovery is ambiguous', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipe-d1-'));
    try {
      const d1Dir = join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
      mkdirSync(d1Dir, { recursive: true });
      writeFileSync(join(d1Dir, 'one.sqlite'), '');
      writeFileSync(join(d1Dir, 'two.sqlite'), '');

      expect(() => discoverLocalDatabase(undefined, root)).toThrow(/Expected one local D1 database/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires an existing source-backed repo profile instead of synthesizing metadata', () => {
    expect(sourceBackedRepoProfile({
      repo_searchable_profile: '  Source-backed PR and repo evidence.  ',
    })).toBe('Source-backed PR and repo evidence.');

    expect(sourceBackedRepoProfile({ repo_searchable_profile: '   ' })).toBeNull();
    expect(sourceBackedRepoProfile(null)).toBeNull();
  });

  it('builds PR projection text from review packet content', () => {
    const narrative = sourceBackedPullRequestNarrative(JSON.stringify({
      pullRequest: {
        title: 'Refactor retry scheduling',
        body: 'Packet body from GitHub PR metadata.',
      },
      demands: [
        { narrative: 'Reviewer must understand idempotent retry orchestration.' },
        { narrative: 'Reviewer must inspect queue visibility timeout handling.' },
      ],
    }));

    expect(narrative).toContain('Title: Refactor retry scheduling');
    expect(narrative).toContain('Packet body from GitHub PR metadata.');
    expect(narrative).toContain('Reviewer must understand idempotent retry orchestration.');
    expect(sourceBackedPullRequestNarrative('not json')).toBeNull();
  });

  it('loads only context-ready review challenge packets for PR projection', () => {
    const sqlite = new Database(':memory:');
    try {
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
          pr_url TEXT NOT NULL,
          title TEXT,
          pr_narrative TEXT,
          pr_narrative_embedding_json TEXT,
          changed_file_count INTEGER NOT NULL,
          swe_bench_eligible INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE review_challenge_packets (
          id TEXT PRIMARY KEY,
          repo_id INTEGER NOT NULL,
          pr_number INTEGER NOT NULL,
          production_ready INTEGER NOT NULL,
          repo_snapshot_id TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          packet_json TEXT NOT NULL
        );
        CREATE TABLE context_records (
          id TEXT PRIMARY KEY,
          ingestion_key TEXT NOT NULL,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          record_type TEXT NOT NULL
        );
        CREATE TABLE context_record_source_refs (
          context_record_id TEXT NOT NULL,
          source_ref_type TEXT NOT NULL
        );
        CREATE TABLE context_record_concepts (
          context_record_id TEXT NOT NULL,
          concept_id TEXT NOT NULL
        );

        INSERT INTO qualified_repos (id, full_name, test_framework, disqualified)
        VALUES
          (1, 'pipe/orders', NULL, 0),
          (2, 'pipe/fixture', 'source-backed-fixture', 0),
          (3, 'pipe/incomplete', NULL, 0),
          (4, 'pipe/disabled', NULL, 1);
        INSERT INTO repo_sample_prs (
          repo_id, pr_number, pr_url, title, pr_narrative, pr_narrative_embedding_json,
          changed_file_count, swe_bench_eligible
        ) VALUES
          (1, 42, 'https://github.com/pipe/orders/pull/42', 'Ready PR', 'source-backed ready pr', NULL, 3, 1),
          (2, 42, 'https://github.com/pipe/fixture/pull/42', 'Fixture PR', 'fixture', NULL, 3, 1),
          (3, 42, 'https://github.com/pipe/incomplete/pull/42', 'Incomplete PR', 'incomplete', NULL, 3, 1),
          (4, 42, 'https://github.com/pipe/disabled/pull/42', 'Disabled PR', 'disabled', NULL, 3, 1);
        INSERT INTO review_challenge_packets (
          id, repo_id, pr_number, production_ready, repo_snapshot_id, source_hash, packet_json
        ) VALUES
          ('packet-ready', 1, 42, 1, 'snapshot-ready', 'sha256:ready', '{"pullRequest":{"title":"Ready PR packet","body":"Packet body"},"demands":[{"narrative":"Packet demand narrative"}]}'),
          ('packet-fixture', 2, 42, 1, 'snapshot-fixture', 'sha256:fixture', '{"pullRequest":{"title":"Fixture PR packet"},"demands":[{"narrative":"Fixture demand"}]}'),
          ('packet-incomplete', 3, 42, 1, 'snapshot-incomplete', 'sha256:incomplete', '{"pullRequest":{"title":"Incomplete PR packet"},"demands":[{"narrative":"Incomplete demand"}]}'),
          ('packet-disabled', 4, 42, 1, 'snapshot-disabled', 'sha256:disabled', '{"pullRequest":{"title":"Disabled PR packet"},"demands":[{"narrative":"Disabled demand"}]}');
        INSERT INTO context_records (id, ingestion_key, scope_type, scope_id, record_type)
        VALUES
          ('context-ready', 'repo-challenge-packet-context:packet-ready', 'repo_snapshot', 'snapshot-ready', 'repo_challenge_packet'),
          ('context-fixture', 'repo-challenge-packet-context:packet-fixture', 'repo_snapshot', 'snapshot-fixture', 'repo_challenge_packet'),
          ('context-incomplete', 'repo-challenge-packet-context:packet-incomplete', 'repo_snapshot', 'snapshot-incomplete', 'repo_challenge_packet'),
          ('context-disabled', 'repo-challenge-packet-context:packet-disabled', 'repo_snapshot', 'snapshot-disabled', 'repo_challenge_packet');
        INSERT INTO context_record_source_refs (context_record_id, source_ref_type)
        VALUES
          ('context-ready', 'repo_source_span'),
          ('context-fixture', 'repo_source_span'),
          ('context-incomplete', 'repo_source_span'),
          ('context-disabled', 'repo_source_span');
        INSERT INTO context_record_concepts (context_record_id, concept_id)
        VALUES
          ('context-ready', 'concept-ready'),
          ('context-fixture', 'concept-fixture'),
          ('context-disabled', 'concept-disabled');
      `);

      const prs = loadSourceBackedReviewPullRequests(sqlite);

      expect(prs).toHaveLength(1);
      expect(prs[0]).toMatchObject({
        repo_id: 1,
        pr_number: 42,
        packet_id: 'packet-ready',
        repo_snapshot_id: 'snapshot-ready',
        packet_content_hash: 'sha256:ready',
        context_record_id: 'context-ready',
        repo_source_ref_count: 1,
        concept_link_count: 1,
        pr_narrative: 'Title: Ready PR packet\n\nBody: Packet body\n\nSource-backed demands:\n- Packet demand narrative',
        pr_narrative_embedding_json: null,
      });
      expect(prs[0]?.pr_narrative).not.toContain('source-backed ready pr');
    } finally {
      sqlite.close();
    }
  });
});
