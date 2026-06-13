#!/usr/bin/env tsx
/**
 * Rebuild the open candidate coverage projection from living-context concepts
 * and source-backed evidence.
 *
 * Local:
 *   npx tsx scripts/backfillCandidateCoverage.ts --local --dry-run
 *   npx tsx scripts/backfillCandidateCoverage.ts --local
 *
 * Remote:
 *   npx tsx scripts/backfillCandidateCoverage.ts --remote --dry-run
 *   npx tsx scripts/backfillCandidateCoverage.ts --remote --batch-size 50
 */

import dotenv from 'dotenv';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCandidateCoverage } from '../src/lib/candidateDiscovery/candidateCoverage';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

type SqlValue = string | number | null;

interface SqliteStatement {
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): { changes: number | bigint };
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface PreparedStatementLike {
  bind(...values: SqlValue[]): PreparedStatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ results: never[]; success: boolean }>;
}

interface D1Like {
  prepare(sql: string): PreparedStatementLike;
}

interface Options {
  target: 'local' | 'remote';
  databasePath?: string;
  batchSize: number;
  limit?: number;
  dryRun: boolean;
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

  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return {
      results: this.database.prepare(this.sql).all(...this.values) as T[],
      success: true,
    };
  }

  async run(): Promise<{ results: never[]; success: boolean }> {
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

  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return {
      results: await this.client.query<T>(this.sql, this.values),
      success: true,
    };
  }

  async run(): Promise<{ results: never[]; success: boolean }> {
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

function positiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Options {
  let target: Options['target'] = 'local';
  let targetWasExplicit = false;
  let databasePath: string | undefined;
  let batchSize = 100;
  let limit: number | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === '--help' || argument === '-h') {
      console.log(`Usage:
  npx tsx scripts/backfillCandidateCoverage.ts [--local|--remote] [options]

Options:
  --local                 Use the local Wrangler SQLite database (default)
  --remote                Use Cloudflare D1 through the REST client
  --database-path <path>  Override local SQLite discovery
  --batch-size <n>        Candidate IDs fetched per page (default: 100)
  --limit <n>             Maximum candidates processed
  --dry-run               Count eligible candidates without writing
  --help                  Show this help

Apply migration 0089_open_candidate_coverage.sql before running.`);
      process.exit(0);
    }
    if (argument === '--local' || argument === '--remote') {
      const nextTarget = argument.slice(2) as Options['target'];
      if (targetWasExplicit && target !== nextTarget) {
        throw new Error('--local and --remote are mutually exclusive');
      }
      target = nextTarget;
      targetWasExplicit = true;
      continue;
    }
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument === '--database-path') {
      databasePath = argv[++index];
      if (!databasePath) throw new Error('--database-path requires a value');
      continue;
    }
    if (argument.startsWith('--database-path=')) {
      databasePath = argument.slice('--database-path='.length);
      continue;
    }
    if (argument === '--batch-size') {
      batchSize = positiveInteger('--batch-size', argv[++index]);
      continue;
    }
    if (argument.startsWith('--batch-size=')) {
      batchSize = positiveInteger(
        '--batch-size',
        argument.slice('--batch-size='.length),
      );
      continue;
    }
    if (argument === '--limit') {
      limit = positiveInteger('--limit', argv[++index]);
      continue;
    }
    if (argument.startsWith('--limit=')) {
      limit = positiveInteger('--limit', argument.slice('--limit='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (target === 'remote' && databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  return { target, databasePath, batchSize, limit, dryRun };
}

function discoverLocalDatabase(explicitPath?: string): string {
  if (explicitPath) return resolve(apiRoot, explicitPath);
  const directory = resolve(
    apiRoot,
    '.wrangler/state/v3/d1/miniflare-D1DatabaseObject',
  );
  const databases = readdirSync(directory)
    .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
    .map((name) => resolve(directory, name));
  if (databases.length !== 1) {
    throw new Error(
      databases.length === 0
        ? `No local D1 database found under ${directory}`
        : `Multiple local D1 databases found; pass --database-path: ${databases.join(', ')}`,
    );
  }
  return databases[0]!;
}

async function candidatePage(
  db: D1Like,
  afterId: string,
  limit: number,
): Promise<string[]> {
  const result = await db.prepare(
    `SELECT app.legacy_candidate_id AS id
       FROM applications app
       JOIN candidate_ingestion ci
         ON ci.candidate_id = app.legacy_candidate_id
      WHERE app.legacy_candidate_id IS NOT NULL
        AND app.legacy_candidate_id > ?1
      ORDER BY app.legacy_candidate_id
      LIMIT ?2`,
  ).bind(afterId, limit).all<{ id: string }>();
  return result.results.map((row) => row.id);
}

async function runBackfill(
  db: D1Like,
  options: Options,
  sqlite?: SqliteDatabase,
): Promise<void> {
  let afterId = '';
  let discovered = 0;
  let processed = 0;
  let failed = 0;

  while (options.limit === undefined || discovered < options.limit) {
    const remaining = options.limit === undefined
      ? options.batchSize
      : Math.min(options.batchSize, options.limit - discovered);
    const ids = await candidatePage(db, afterId, remaining);
    if (ids.length === 0) break;

    for (const candidateId of ids) {
      discovered += 1;
      afterId = candidateId;
      if (options.dryRun) continue;

      if (sqlite) sqlite.exec('BEGIN');
      try {
        await computeCandidateCoverage(db as unknown as D1Database, candidateId);
        if (sqlite) sqlite.exec('COMMIT');
        processed += 1;
      } catch (error) {
        if (sqlite) sqlite.exec('ROLLBACK');
        failed += 1;
        console.error(
          `[candidateCoverageBackfill] ${candidateId}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  console.log(JSON.stringify({
    target: options.target,
    dryRun: options.dryRun,
    discovered,
    processed,
    failed,
  }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.target === 'remote') {
    const client = new D1Client(loadD1Config());
    await runBackfill(new RemoteD1(client), options);
    return;
  }

  const sqlite = new DatabaseSync(discoverLocalDatabase(options.databasePath));
  try {
    await runBackfill(new LocalD1(sqlite), options, sqlite);
  } finally {
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
