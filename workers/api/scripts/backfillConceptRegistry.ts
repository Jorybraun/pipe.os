#!/usr/bin/env tsx

import dotenv from 'dotenv';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createConceptRegistry } from '../src/lib/livingContext/conceptRegistry';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';

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

interface D1Statement {
  bind(...values: SqlValue[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ results: never[]; success: boolean }>;
}

interface D1Like {
  prepare(sql: string): D1Statement;
}

interface Options {
  target: 'local' | 'remote';
  databasePath?: string;
  dryRun: boolean;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

class LocalStatement implements D1Statement {
  private values: SqlValue[] = [];

  constructor(
    private readonly database: SqliteDatabase,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): D1Statement {
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

  prepare(sql: string): D1Statement {
    return new LocalStatement(this.database, sql);
  }
}

class RemoteStatement implements D1Statement {
  private values: SqlValue[] = [];

  constructor(
    private readonly client: D1Client,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): D1Statement {
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

  prepare(sql: string): D1Statement {
    return new RemoteStatement(this.client, sql);
  }
}

function parseArgs(argv: string[]): Options | null {
  if (argv.includes('--help') || argv.includes('-h')) return null;
  const remote = argv.includes('--remote');
  const local = argv.includes('--local');
  if (remote && local) throw new Error('--local and --remote are mutually exclusive');
  const pathIndex = argv.indexOf('--database-path');
  const databasePath = pathIndex >= 0 ? argv[pathIndex + 1] : undefined;
  if (pathIndex >= 0 && !databasePath) {
    throw new Error('--database-path requires a path');
  }
  if (remote && databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  const dryRun = argv.includes('--dry-run');
  if (remote && dryRun) {
    throw new Error('--dry-run is only supported for local transactional runs');
  }
  return {
    target: remote ? 'remote' : 'local',
    ...(databasePath ? { databasePath } : {}),
    dryRun,
  };
}

function help(): string {
  return `Usage:
  npx tsx scripts/backfillConceptRegistry.ts [--local|--remote] [options]

Options:
  --database-path <path>  Override local Wrangler SQLite discovery
  --dry-run               Run in a local transaction and roll it back
  --help                  Show this help

Apply migration 0094_concept_registry.sql before running.`;
}

function localDatabasePath(explicitPath?: string): string {
  if (explicitPath) return resolve(explicitPath);
  const directory = resolve(apiRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const files = readdirSync(directory).filter(
    (entry) => entry.endsWith('.sqlite') && entry !== 'metadata.sqlite',
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected one local D1 database; pass --database-path. Found: ${files.join(', ')}`,
    );
  }
  return resolve(directory, files[0]!);
}

async function counts(db: D1Like): Promise<Record<string, number>> {
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM concepts WHERE superseded_at IS NULL) AS concepts,
       (SELECT COUNT(*) FROM concept_surfaces) AS surfaces,
       (SELECT COUNT(*) FROM concept_resolutions) AS resolutions,
       (SELECT COUNT(*) FROM concept_adjacency) AS adjacencies`,
  ).first<{
    concepts: number;
    surfaces: number;
    resolutions: number;
    adjacencies: number;
  }>();
  if (!row) throw new Error('Unable to read concept registry counts');
  return row;
}

async function pruneOrphanedLegacyConcepts(db: D1Like): Promise<number> {
  const before = await db.prepare(
    `SELECT COUNT(*) AS count
       FROM concepts c
      WHERE json_extract(c.metadata_json, '$.source') = 'legacy_candidate_node'
        AND NOT EXISTS (
          SELECT 1 FROM assertion_concepts ac WHERE ac.concept_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM signal_evidence se WHERE se.concept_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM candidate_coverage cc WHERE cc.next_probe_concept_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM candidate_coverage_dimensions ccd WHERE ccd.concept_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM concept_resolutions cr WHERE cr.concept_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1
            FROM concept_adjacency ca
           WHERE ca.from_concept_id = c.id OR ca.to_concept_id = c.id
        )`,
  ).first<{ count: number }>();
  const count = before?.count ?? 0;
  if (count === 0) return 0;
  await db.prepare(
    `DELETE FROM concepts
      WHERE json_extract(metadata_json, '$.source') = 'legacy_candidate_node'
        AND NOT EXISTS (
          SELECT 1 FROM assertion_concepts ac WHERE ac.concept_id = concepts.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM signal_evidence se WHERE se.concept_id = concepts.id
        )
        AND NOT EXISTS (
          SELECT 1
            FROM candidate_coverage cc
           WHERE cc.next_probe_concept_id = concepts.id
        )
        AND NOT EXISTS (
          SELECT 1
            FROM candidate_coverage_dimensions ccd
           WHERE ccd.concept_id = concepts.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM concept_resolutions cr WHERE cr.concept_id = concepts.id
        )
        AND NOT EXISTS (
          SELECT 1
            FROM concept_adjacency ca
           WHERE ca.from_concept_id = concepts.id
              OR ca.to_concept_id = concepts.id
        )`,
  ).run();
  return count;
}

export async function runConceptRegistryBackfill(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (!options) {
    process.stdout.write(`${help()}\n`);
    return 0;
  }

  let sqlite: SqliteDatabase | undefined;
  let db: D1Like;
  if (options.target === 'remote') {
    db = new RemoteD1(new D1Client(loadD1Config()));
  } else {
    sqlite = new DatabaseSync(localDatabasePath(options.databasePath));
    db = new LocalD1(sqlite);
    if (options.dryRun) sqlite.exec('BEGIN IMMEDIATE');
  }

  try {
    const before = await counts(db);
    const prunedOrphanedLegacyConcepts = await pruneOrphanedLegacyConcepts(db);
    const backfill = await createConceptRegistry(
      db as unknown as D1Database,
    ).backfillOpenTerms();
    const after = await counts(db);
    process.stdout.write(`${JSON.stringify({
      target: options.target,
      dryRun: options.dryRun,
      before,
      prunedOrphanedLegacyConcepts,
      backfill,
      after,
    }, null, 2)}\n`);
    return 0;
  } finally {
    if (sqlite && options.dryRun) sqlite.exec('ROLLBACK');
    sqlite?.close();
  }
}

runConceptRegistryBackfill(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
