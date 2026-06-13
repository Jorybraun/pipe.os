#!/usr/bin/env tsx
/**
 * Backfill legacy candidates, contacts, and candidate nodes into the living
 * context graph. All writes use the runtime compatibility functions, whose
 * deterministic ingestion keys make reruns idempotent.
 *
 * Local:
 *   npx tsx scripts/backfillLivingContext.ts --local --dry-run
 *   npx tsx scripts/backfillLivingContext.ts --local --batch-size 100
 *
 * Remote (loads Cloudflare credentials from .dev.vars):
 *   npx tsx scripts/backfillLivingContext.ts --remote --dry-run
 *   npx tsx scripts/backfillLivingContext.ts --remote --batch-size 50
 *
 * Required remote env vars:
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_D1_DATABASE_ID
 */

import dotenv from 'dotenv';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CandidateNode } from '../src/types';
import {
  ensureCandidateLivingContext,
  ensureContactLivingContext,
  ingestMeetingTranscriptToLivingContext,
  mirrorCandidateNodeToLivingContext,
  parseStoredMeetingTranscript,
} from '../src/lib/livingContext';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: {
  new (path: string): SqliteDatabase;
  };
};
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

type SqlValue = string | number | null;
type EntityKind = 'candidates' | 'contacts' | 'candidateNodes' | 'meetings';

interface SqliteStatement {
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface Options {
  target: 'local' | 'remote';
  databasePath?: string;
  batchSize: number;
  limit?: number;
  dryRun: boolean;
}

interface IdRow {
  id: string;
}

interface MeetingTranscriptRow {
  id: string;
  owner_id: string;
  transcript_json: string;
  transcript_summary: string | null;
  recording_r2_key: string | null;
  started_at: string | null;
  ended_at: string | null;
}

interface QueryResult<T> {
  results: T[];
  success: boolean;
}

interface PreparedStatementLike {
  bind(...values: SqlValue[]): PreparedStatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult<never>>;
}

interface D1Like {
  prepare(sql: string): PreparedStatementLike;
}

interface EntityStats {
  discovered: number;
  processed: number;
  skipped: number;
  failed: number;
}

interface BackfillStats {
  candidates: EntityStats;
  contacts: EntityStats;
  candidateNodes: EntityStats;
  meetings: EntityStats;
}

function emptyEntityStats(): EntityStats {
  return { discovered: 0, processed: 0, skipped: 0, failed: 0 };
}

function parsePositiveInteger(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function printHelp(): void {
  console.log(`Usage:
  npx tsx scripts/backfillLivingContext.ts [--local|--remote] [options]

Options:
  --local                 Use the local Wrangler SQLite database (default)
  --remote                Use Cloudflare D1 through the existing REST client
  --database-path <path>  Override local SQLite discovery
  --batch-size <n>        Rows fetched per keyset page (default: 100)
  --limit <n>             Maximum rows processed per entity type
  --dry-run               Count eligible rows without writing
  --help                  Show this help

Apply migrations 0082_living_context_graph.sql and
0091_transcript_semantic_projections.sql before running this script.`);
}

function parseArgs(argv: string[]): Options {
  let target: Options['target'] = 'local';
  let targetWasExplicit = false;
  let databasePath: string | undefined;
  let batchSize = 100;
  let limit: number | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--local' || arg === '--remote') {
      const nextTarget = arg.slice(2) as Options['target'];
      if (targetWasExplicit && target !== nextTarget) {
        throw new Error('--local and --remote are mutually exclusive');
      }
      target = nextTarget;
      targetWasExplicit = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--database-path') {
      databasePath = argv[++index];
      if (!databasePath) throw new Error('--database-path requires a value');
      continue;
    }
    if (arg.startsWith('--database-path=')) {
      databasePath = arg.slice('--database-path='.length);
      continue;
    }
    if (arg === '--batch-size') {
      batchSize = parsePositiveInteger('--batch-size', argv[++index]);
      continue;
    }
    if (arg.startsWith('--batch-size=')) {
      batchSize = parsePositiveInteger('--batch-size', arg.slice('--batch-size='.length));
      continue;
    }
    if (arg === '--limit') {
      limit = parsePositiveInteger('--limit', argv[++index]);
      continue;
    }
    if (arg.startsWith('--limit=')) {
      limit = parsePositiveInteger('--limit', arg.slice('--limit='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (target === 'remote' && databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  return { target, databasePath, batchSize, limit, dryRun };
}

class LocalStatement implements PreparedStatementLike {
  private values: SqlValue[] = [];

  constructor(
    private readonly database: SqliteDatabase,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>(): Promise<QueryResult<T>> {
    return {
      results: this.database.prepare(this.sql).all(...this.values) as T[],
      success: true,
    };
  }

  async run(): Promise<QueryResult<never>> {
    this.database.prepare(this.sql).run(...this.values);
    return { results: [], success: true };
  }
}

class LocalD1 implements D1Like {
  constructor(private readonly database: SqliteDatabase) {}

  prepare(sql: string): PreparedStatementLike {
    return new LocalStatement(this.database, sql);
  }
}

class RemoteStatement implements PreparedStatementLike {
  private values: SqlValue[] = [];

  constructor(
    private readonly client: D1Client,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return (await this.client.query<T>(this.sql, this.values))[0] ?? null;
  }

  async all<T>(): Promise<QueryResult<T>> {
    return { results: await this.client.query<T>(this.sql, this.values), success: true };
  }

  async run(): Promise<QueryResult<never>> {
    await this.client.query(this.sql, this.values);
    return { results: [], success: true };
  }
}

class RemoteD1 implements D1Like {
  constructor(private readonly client: D1Client) {}

  prepare(sql: string): PreparedStatementLike {
    return new RemoteStatement(this.client, sql);
  }
}

function discoverLocalDatabase(explicitPath?: string): string {
  if (explicitPath) return resolve(apiRoot, explicitPath);

  const directory = resolve(apiRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const candidates = readdirSync(directory)
    .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
    .map((name) => resolve(directory, name));
  if (candidates.length === 0) {
    throw new Error(
      'No local D1 SQLite database found. Run Wrangler once or pass --database-path.',
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Multiple local D1 databases found; pass --database-path. Found: ${candidates.join(', ')}`,
    );
  }
  return candidates[0]!;
}

async function fetchIdPage(
  db: D1Like,
  table: 'candidates' | 'contacts',
  afterId: string,
  pageSize: number,
): Promise<IdRow[]> {
  const result = await db.prepare(
    `SELECT id FROM ${table} WHERE id > ?1 ORDER BY id LIMIT ?2`,
  ).bind(afterId, pageSize).all<IdRow>();
  return result.results;
}

async function fetchCandidateNodePage(
  db: D1Like,
  afterId: string,
  pageSize: number,
): Promise<CandidateNode[]> {
  const result = await db.prepare(
    `SELECT id, candidate_id, node_type, narrative_text,
            extracted_properties_json, embedding_json, source_type,
            source_reference, captured_at, confidence, supersedes,
            superseded_at, decomposition_version, created_at, updated_at
      FROM candidate_nodes
      WHERE id > ?1
        AND superseded_at IS NULL
      ORDER BY id
      LIMIT ?2`,
  ).bind(afterId, pageSize).all<CandidateNode>();
  return result.results;
}

async function fetchMeetingPage(
  db: D1Like,
  afterId: string,
  pageSize: number,
): Promise<MeetingTranscriptRow[]> {
  const result = await db.prepare(
    `SELECT id, owner_id, transcript_json, transcript_summary,
            recording_r2_key, started_at, ended_at
       FROM meetings
      WHERE id > ?1
        AND transcript_status = 'READY'
        AND transcript_json IS NOT NULL
      ORDER BY id
      LIMIT ?2`,
  ).bind(afterId, pageSize).all<MeetingTranscriptRow>();
  return result.results;
}

function pageSize(options: Options, stats: EntityStats): number {
  if (options.limit === undefined) return options.batchSize;
  return Math.min(options.batchSize, options.limit - stats.discovered);
}

function shouldContinue(options: Options, stats: EntityStats): boolean {
  return options.limit === undefined || stats.discovered < options.limit;
}

function reportFailure(kind: EntityKind, id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[living-context] ${kind} ${id} failed: ${message}`);
}

async function backfillIdentities(
  db: D1Like,
  kind: 'candidates' | 'contacts',
  options: Options,
  stats: EntityStats,
): Promise<void> {
  let afterId = '';
  while (shouldContinue(options, stats)) {
    const rows = await fetchIdPage(db, kind, afterId, pageSize(options, stats));
    if (rows.length === 0) break;
    stats.discovered += rows.length;

    if (!options.dryRun) {
      for (const row of rows) {
        try {
          const result = kind === 'candidates'
            ? await ensureCandidateLivingContext(db as unknown as D1Database, row.id)
            : await ensureContactLivingContext(db as unknown as D1Database, row.id);
          if (result) stats.processed++;
          else stats.skipped++;
        } catch (error) {
          stats.failed++;
          reportFailure(kind, row.id, error);
        }
      }
    }

    afterId = rows.at(-1)!.id;
    console.log(
      `[living-context] ${kind}: discovered=${stats.discovered} processed=${stats.processed} failed=${stats.failed}`,
    );
  }
}

async function backfillCandidateNodes(
  db: D1Like,
  options: Options,
  stats: EntityStats,
): Promise<void> {
  let afterId = '';
  while (shouldContinue(options, stats)) {
    const rows = await fetchCandidateNodePage(db, afterId, pageSize(options, stats));
    if (rows.length === 0) break;
    stats.discovered += rows.length;

    if (!options.dryRun) {
      for (const row of rows) {
        try {
          await mirrorCandidateNodeToLivingContext(db as unknown as D1Database, row);
          stats.processed++;
        } catch (error) {
          stats.failed++;
          reportFailure('candidateNodes', row.id, error);
        }
      }
    }

    afterId = rows.at(-1)!.id;
    console.log(
      `[living-context] candidateNodes: discovered=${stats.discovered} processed=${stats.processed} failed=${stats.failed}`,
    );
  }
}

async function backfillMeetings(
  db: D1Like,
  options: Options,
  stats: EntityStats,
): Promise<void> {
  let afterId = '';
  while (shouldContinue(options, stats)) {
    const rows = await fetchMeetingPage(db, afterId, pageSize(options, stats));
    if (rows.length === 0) break;
    stats.discovered += rows.length;

    if (!options.dryRun) {
      for (const row of rows) {
        try {
          const transcript = parseStoredMeetingTranscript(row.transcript_json);
          await ingestMeetingTranscriptToLivingContext(db as unknown as D1Database, {
            meetingId: row.id,
            ownerId: row.owner_id,
            transcript: transcript.transcript,
            segments: transcript.segments,
            summary: row.transcript_summary,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            recordingKey: row.recording_r2_key,
            provider: 'historical-meeting-transcript',
          });
          stats.processed++;
        } catch (error) {
          stats.failed++;
          reportFailure('meetings', row.id, error);
        }
      }
    }

    afterId = rows.at(-1)!.id;
    console.log(
      `[living-context] meetings: discovered=${stats.discovered} processed=${stats.processed} failed=${stats.failed}`,
    );
  }
}

async function verifySchema(db: D1Like): Promise<void> {
  const requiredTables = [
    'candidates',
    'contacts',
    'candidate_nodes',
    'meetings',
    'meeting_participants',
    'people',
    'workspace_people',
    'applications',
    'person_roles',
    'interactions',
    'artifacts',
    'artifact_versions',
    'source_spans',
    'episodes',
    'semantic_assertions',
    'assertion_source_spans',
    'signal_evidence',
    'projection_outbox',
    'artifact_interactions',
    'source_span_attributions',
    'semantic_projection_runs',
  ];
  for (const table of requiredTables) {
    const row = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
    ).bind(table).first<{ name: string }>();
    if (!row) {
      throw new Error(
        `Required table "${table}" is missing. Apply the living-context migrations first.`,
      );
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let localDatabase: SqliteDatabase | undefined;
  let db: D1Like;

  if (options.target === 'remote') {
    db = new RemoteD1(new D1Client(loadD1Config()));
    console.log('[living-context] target=remote');
  } else {
    const databasePath = discoverLocalDatabase(options.databasePath);
    localDatabase = new DatabaseSync(databasePath);
    localDatabase.exec('PRAGMA foreign_keys = ON');
    db = new LocalD1(localDatabase);
    console.log(`[living-context] target=local database=${databasePath}`);
  }

  try {
    await verifySchema(db);
    const stats: BackfillStats = {
      candidates: emptyEntityStats(),
      contacts: emptyEntityStats(),
      candidateNodes: emptyEntityStats(),
      meetings: emptyEntityStats(),
    };

    await backfillIdentities(db, 'candidates', options, stats.candidates);
    await backfillIdentities(db, 'contacts', options, stats.contacts);
    await backfillCandidateNodes(db, options, stats.candidateNodes);
    await backfillMeetings(db, options, stats.meetings);

    const failed = Object.values(stats).reduce((sum, entry) => sum + entry.failed, 0);
    console.log(JSON.stringify({
      event: 'livingContextBackfill.complete',
      target: options.target,
      dryRun: options.dryRun,
      batchSize: options.batchSize,
      limitPerEntity: options.limit ?? null,
      stats,
      failed,
    }, null, 2));

    if (failed > 0) process.exitCode = 1;
  } finally {
    localDatabase?.close();
  }
}

main().catch((error) => {
  console.error(
    '[living-context] fatal:',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
