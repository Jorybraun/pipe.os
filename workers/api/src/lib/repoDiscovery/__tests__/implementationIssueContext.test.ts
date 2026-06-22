import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { pickImplementationIssue } from '../../match/autoStageBuilder';
import { backfillRepoImplementationIssueContextRecords } from '../implementationIssueContext';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createRepoIssueSchema(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      github_url TEXT NOT NULL
    );
    CREATE TABLE repo_issues (
      id INTEGER PRIMARY KEY,
      repo_id INTEGER NOT NULL,
      issue_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      labels_json TEXT,
      github_updated_at TEXT NOT NULL,
      crawled_at TEXT NOT NULL,
      state_at_crawl TEXT NOT NULL,
      has_merged_pr INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE issue_challenge_signals (
      id INTEGER PRIMARY KEY,
      issue_id INTEGER NOT NULL,
      implementability_score REAL,
      clarity_score REAL,
      scope_score REAL,
      isolation_score REAL,
      difficulty_band TEXT,
      assessment_narrative TEXT,
      disqualified INTEGER NOT NULL DEFAULT 0,
      disqualified_reason TEXT,
      signals_version INTEGER,
      model_used TEXT,
      generated_at TEXT
    );
  `);
}

function insertIssue(
  sqlite: BetterSqliteDb,
  input: {
    id: number;
    issueNumber: number;
    title: string;
    body: string | null;
    labels?: string[];
    state?: 'open' | 'closed';
    hasMergedPr?: 0 | 1;
    implementability?: number;
    disqualified?: 0 | 1;
  },
): void {
  sqlite.prepare(
    `INSERT INTO repo_issues (
       id, repo_id, issue_number, title, body, labels_json,
       github_updated_at, crawled_at, state_at_crawl, has_merged_pr
     ) VALUES (?, 10, ?, ?, ?, ?, '2026-06-20T10:00:00.000Z', '2026-06-20T11:00:00.000Z', ?, ?)`,
  ).run(
    input.id,
    input.issueNumber,
    input.title,
    input.body,
    JSON.stringify(input.labels ?? []),
    input.state ?? 'open',
    input.hasMergedPr ?? 0,
  );
  sqlite.prepare(
    `INSERT INTO issue_challenge_signals (
       issue_id, implementability_score, clarity_score, scope_score,
       isolation_score, difficulty_band, assessment_narrative, disqualified,
       signals_version, model_used, generated_at
     ) VALUES (?, ?, 0.8, 0.7, 0.6, 'mid', 'Source-backed issue candidate.', ?, 3, 'fixture-model', '2026-06-20T12:00:00.000Z')`,
  ).run(input.id, input.implementability ?? 0.5, input.disqualified ?? 0);
}

describe('repo implementation issue context records', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordMigration);
    createRepoIssueSchema(sqlite);
    sqlite.prepare(
      'INSERT INTO qualified_repos (id, full_name, github_url) VALUES (?, ?, ?)',
    ).run(10, 'acme/widgets', 'https://github.com/acme/widgets');
    db = createMockD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('backfills implementation issues as idempotent source-backed context records', async () => {
    const issueBody = 'Original GitHub issue body.\n\nKeep the retry queue bounded.';
    insertIssue(sqlite, {
      id: 501,
      issueNumber: 77,
      title: 'Implement retry queue',
      body: issueBody,
      labels: ['backend', 'Kafka Idempotency'],
      implementability: 0.91,
    });
    insertIssue(sqlite, {
      id: 502,
      issueNumber: 78,
      title: 'Closed work',
      body: 'This should not be emitted.',
      state: 'closed',
      implementability: 0.99,
    });
    insertIssue(sqlite, {
      id: 503,
      issueNumber: 79,
      title: 'No body',
      body: null,
      implementability: 0.98,
    });
    insertIssue(sqlite, {
      id: 504,
      issueNumber: 80,
      title: 'Disqualified',
      body: 'This issue is too vague.',
      disqualified: 1,
      implementability: 0.97,
    });

    const first = await backfillRepoImplementationIssueContextRecords(db, {
      repoId: 10,
      now: '2026-06-21T00:00:00.000Z',
    });
    const second = await backfillRepoImplementationIssueContextRecords(db, {
      repoId: 10,
      now: '2026-06-21T00:00:00.000Z',
    });

    expect(first.processed).toBe(1);
    expect(second.processed).toBe(1);
    expect(first.contextRecordIds).toEqual(second.contextRecordIds);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_source_refs').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_record_concepts').get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare(
      `SELECT cr.scope_type, cr.scope_id, cr.record_type, cr.predicate,
              crsr.source_ref_type, crsr.source_ref_id, crsr.exact_text, crsr.content_hash
         FROM context_records cr
         JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id`,
    ).get()).toEqual({
      scope_type: 'qualified_repo',
      scope_id: '10',
      record_type: 'repo_implementation_issue',
      predicate: 'defines implementation challenge',
      source_ref_type: 'repo_issue',
      source_ref_id: '501',
      exact_text: issueBody,
      content_hash: await sha256Hex(issueBody),
    });
    const conceptKeys = sqlite.prepare(
      `SELECT c.canonical_key
         FROM context_record_concepts crc
         JOIN concepts c ON c.id = crc.concept_id
        ORDER BY c.canonical_key`,
    ).all() as Array<{ canonical_key: string }>;
    expect(conceptKeys.map((row) => row.canonical_key)).toEqual([
      'term:backend',
      'term:kafka-idempotency',
    ]);
  });

  it('selects implementation issues only after source context records exist', async () => {
    insertIssue(sqlite, {
      id: 601,
      issueNumber: 101,
      title: 'Missing body',
      body: null,
      implementability: 0.99,
    });
    insertIssue(sqlite, {
      id: 602,
      issueNumber: 102,
      title: 'Source-backed issue',
      body: 'Exact source body for implementation.',
      implementability: 0.6,
    });

    const selected = await pickImplementationIssue(db, 10, 'mid');

    expect(selected).toEqual({
      issueNumber: 102,
      issueTitle: 'Source-backed issue',
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM context_records').get()).toEqual({
      count: 1,
    });
  });

  it('prefers source-backed issue concept overlap over raw implementation score', async () => {
    insertIssue(sqlite, {
      id: 701,
      issueNumber: 201,
      title: 'Generic backend work',
      body: 'Exact source body for generic backend work.',
      labels: ['backend'],
      implementability: 0.95,
    });
    insertIssue(sqlite, {
      id: 702,
      issueNumber: 202,
      title: 'Kafka idempotency work',
      body: 'Exact source body for Kafka idempotency work.',
      labels: ['Kafka Idempotency'],
      implementability: 0.5,
    });

    const selected = await pickImplementationIssue(db, 10, 'mid', [
      'term:kafka-idempotency',
    ]);

    expect(selected).toEqual({
      issueNumber: 202,
      issueTitle: 'Kafka idempotency work',
    });
  });
});
