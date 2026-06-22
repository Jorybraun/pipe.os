#!/usr/bin/env tsx
/**
 * Apply the local D1 graph/context migrations required by review challenge
 * packet backfill, then audit packet-context readiness.
 */

import dotenv from 'dotenv';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditReviewChallengePacketContexts,
  type AuditResult,
  type QueryClient,
} from './auditReviewChallengePacketContexts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, '..', '.dev.vars'), quiet: true });
const apiRoot = resolve(scriptDir, '..');
const migrationsRoot = resolve(apiRoot, 'migrations');

export const REVIEW_CHALLENGE_GRAPH_MIGRATIONS = [
  '0082_living_context_graph.sql',
  '0083_repo_semantic_graph_and_match_runs.sql',
  '0095_context_records.sql',
] as const;

export interface SqliteStatement {
  all(...values: Array<string | number | null>): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close?: () => void;
}

export class SqliteQueryClient implements QueryClient {
  constructor(private readonly database: SqliteDatabase) {}

  async query<T>(
    sql: string,
    params: Array<string | number | null> = [],
  ): Promise<T[]> {
    return this.database.prepare(sql).all(...params) as T[];
  }
}

export interface AppliedMigration {
  name: string;
  bytes: number;
}

export interface PrepareResult {
  databasePath: string;
  before: AuditResult;
  after: AuditResult;
  migrations: AppliedMigration[];
}

function discoverLocalDatabase(explicitPath?: string): string {
  if (explicitPath) return resolve(apiRoot, explicitPath);
  const directory = resolve(apiRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const candidates = readdirSync(directory)
    .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
    .map((name) => resolve(directory, name));
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one local D1 database; pass --database-path. Found: ${candidates.join(', ') || 'none'}`,
    );
  }
  return candidates[0]!;
}

export function applyReviewChallengeGraphMigrations(
  database: Pick<SqliteDatabase, 'exec'>,
  migrationNames: readonly string[] = REVIEW_CHALLENGE_GRAPH_MIGRATIONS,
): AppliedMigration[] {
  return migrationNames.map((name) => {
    const sql = readFileSync(resolve(migrationsRoot, name), 'utf8');
    database.exec(sql);
    return { name, bytes: Buffer.byteLength(sql, 'utf8') };
  });
}

function openLocalDatabase(databasePath?: string): { database: SqliteDatabase; path: string } {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const path = discoverLocalDatabase(databasePath);
  return { database: new DatabaseSync(path), path };
}

export async function prepareReviewChallengeGraphLocalDb(
  database: SqliteDatabase,
  databasePath = '<memory>',
): Promise<PrepareResult> {
  const client = new SqliteQueryClient(database);
  const before = await auditReviewChallengePacketContexts(client);
  const migrations = applyReviewChallengeGraphMigrations(database);
  const after = await auditReviewChallengePacketContexts(client);
  return {
    databasePath,
    before,
    after,
    migrations,
  };
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/prepareReviewChallengeGraphLocalDb.ts [options]',
    '',
    'Options:',
    '  --database-path PATH  Override local SQLite discovery',
    '  --json                Print machine-readable JSON',
    '  --help, -h            Show this help',
  ].join('\n');
}

interface CliOptions {
  databasePath?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--database-path' || arg.startsWith('--database-path=')) {
      const inline = arg.match(/^--database-path=(.+)$/)?.[1];
      const value = inline ?? argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--database-path requires a value');
      options.databasePath = value;
      if (!inline) index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHuman(result: PrepareResult): void {
  console.log(`review challenge graph local DB prep (${result.databasePath})`);
  console.log(`  before status:          ${result.before.status}`);
  console.log(`  after status:           ${result.after.status}`);
  console.log(`  migrations executed:    ${result.migrations.map((m) => m.name).join(', ')}`);
  console.log(`  qualified repos:        ${result.after.sourceStats.qualifiedRepos ?? 'unknown'}`);
  console.log(`  sample PRs:             ${result.after.sourceStats.samplePullRequests ?? 'unknown'}`);
  console.log(`  eligible sample PRs:    ${result.after.sourceStats.eligibleSamplePullRequests ?? 'unknown'}`);
  console.log(`  total packets:          ${result.after.stats.totalPackets}`);
  console.log(`  real overlay-ready:     ${result.after.stats.realOverlayReadyPackets}`);
  if (result.after.missingTables.length > 0) {
    console.log(`  missing tables:         ${result.after.missingTables.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { database, path } = openLocalDatabase(options.databasePath);
  try {
    const result = await prepareReviewChallengeGraphLocalDb(database, path);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
  } finally {
    database.close?.();
  }
}

if (process.argv[1]?.endsWith('prepareReviewChallengeGraphLocalDb.ts')) {
  main().catch((err) => {
    console.error('[prepareReviewChallengeGraphLocalDb] Fatal:', err);
    process.exit(1);
  });
}
