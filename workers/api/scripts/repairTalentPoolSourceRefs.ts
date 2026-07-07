#!/usr/bin/env tsx
/**
 * Repair Talent Pool candidate-node source refs from existing source spans.
 *
 * This is a projection backfill only: it does not create source artifacts,
 * source spans, profile claims, or person context. It reconnects active exact
 * resume/profile-intake candidate nodes to current Talent Pool profile source
 * spans that already exist.
 */

import dotenv from 'dotenv';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countTalentPoolProfileIntakeNodeSourceRefRepairCandidates,
  countTalentPoolResumeNodeSourceRefRepairCandidates,
  repairTalentPoolProfileIntakeNodeSourceRefs,
  repairTalentPoolResumeNodeSourceRefs,
} from '../src/lib/candidateDiscovery/candidateNodes';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
dotenv.config({ path: resolve(apiRoot, '.dev.vars'), quiet: true });

type SqlValue = string | number | null;

interface SqliteStatement {
  get(...values: SqlValue[]): unknown;
  all(...values: SqlValue[]): unknown[];
  run(...values: SqlValue[]): { changes: number | bigint };
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface PreparedStatementLike {
  bind(...values: SqlValue[]): PreparedStatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }>;
  run(): Promise<{ results: never[]; success: boolean; meta: Record<string, unknown> }>;
}

interface RepairD1Like {
  prepare(sql: string): PreparedStatementLike;
}

export interface TalentPoolSourceRefRepairOptions {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  countLimit?: number;
}

export interface TalentPoolSourceRefRepairReport {
  dryRun: boolean;
  batchSize: number;
  maxBatches: number;
  countLimit: number;
  batches: number;
  beforeRepairableCount: number;
  scanned: number;
  repaired: number;
  afterRepairableCount: number;
}

interface CliOptions extends Required<TalentPoolSourceRefRepairOptions> {
  target: 'local' | 'remote';
  databasePath?: string;
  json: boolean;
}

function rewriteNumberedParams(
  sql: string,
  bindings: SqlValue[],
): { sql: string; args: SqlValue[] } {
  const numbered = /\?(\d+)/g;
  let match = numbered.exec(sql);
  if (!match) return { sql, args: bindings };

  const args: SqlValue[] = [];
  let rewritten = '';
  let lastIndex = 0;
  numbered.lastIndex = 0;
  while ((match = numbered.exec(sql)) !== null) {
    rewritten += sql.slice(lastIndex, match.index) + '?';
    args.push(bindings[Number.parseInt(match[1]!, 10) - 1] ?? null);
    lastIndex = numbered.lastIndex;
  }
  rewritten += sql.slice(lastIndex);
  return { sql: rewritten, args };
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
    const rewritten = rewriteNumberedParams(this.sql, this.values);
    return (this.database.prepare(rewritten.sql).get(...rewritten.args) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
    const rewritten = rewriteNumberedParams(this.sql, this.values);
    return {
      results: this.database.prepare(rewritten.sql).all(...rewritten.args) as T[],
      success: true,
      meta: {},
    };
  }

  async run(): Promise<{ results: never[]; success: boolean; meta: Record<string, unknown> }> {
    const rewritten = rewriteNumberedParams(this.sql, this.values);
    const result = this.database.prepare(rewritten.sql).run(...rewritten.args);
    return { results: [], success: true, meta: { changes: Number(result.changes) } };
  }
}

class LocalD1 implements RepairD1Like {
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

  async all<T>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
    return {
      results: await this.client.query<T>(this.sql, this.values),
      success: true,
      meta: {},
    };
  }

  async run(): Promise<{ results: never[]; success: boolean; meta: Record<string, unknown> }> {
    await this.client.query(this.sql, this.values);
    return { results: [], success: true, meta: {} };
  }
}

class RemoteD1 implements RepairD1Like {
  constructor(private readonly client: D1Client) {}

  prepare(sql: string): PreparedStatementLike {
    return new RemoteStatement(this.client, sql);
  }
}

function positiveInteger(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/repairTalentPoolSourceRefs.ts [--local|--remote] [options]',
    '',
    'Options:',
    '  --local                 Use local Wrangler SQLite D1 (default)',
    '  --remote                Use Cloudflare D1 through REST',
    '  --database-path PATH    Override local SQLite discovery',
    '  --batch-size N          Repair candidates nodes per batch (default: 250)',
    '  --max-batches N         Maximum repair batches (default: 20)',
    '  --count-limit N         Max rows counted for before/after reports (default: 1000)',
    '  --dry-run               Count repairable rows without writing',
    '  --json                  Print machine-readable JSON',
    '  --help, -h              Show this help',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    target: 'local',
    dryRun: false,
    batchSize: 250,
    maxBatches: 20,
    countLimit: 1000,
    json: false,
  };
  let targetWasExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--local' || arg === '--remote') {
      const target = arg.slice(2) as CliOptions['target'];
      if (targetWasExplicit && options.target !== target) {
        throw new Error('--local and --remote are mutually exclusive');
      }
      options.target = target;
      targetWasExplicit = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--database-path' || arg.startsWith('--database-path=')) {
      const inline = arg.match(/^--database-path=(.+)$/)?.[1];
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--database-path requires a value');
      options.databasePath = value;
      continue;
    }
    if (arg === '--batch-size' || arg.startsWith('--batch-size=')) {
      const inline = arg.match(/^--batch-size=(.+)$/)?.[1];
      options.batchSize = positiveInteger('--batch-size', inline ?? argv[++index]);
      continue;
    }
    if (arg === '--max-batches' || arg.startsWith('--max-batches=')) {
      const inline = arg.match(/^--max-batches=(.+)$/)?.[1];
      options.maxBatches = positiveInteger('--max-batches', inline ?? argv[++index]);
      continue;
    }
    if (arg === '--count-limit' || arg.startsWith('--count-limit=')) {
      const inline = arg.match(/^--count-limit=(.+)$/)?.[1];
      options.countLimit = positiveInteger('--count-limit', inline ?? argv[++index]);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.target === 'remote' && options.databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  return options;
}

function discoverLocalDatabase(explicitPath?: string): string {
  if (explicitPath) return isAbsolute(explicitPath) ? explicitPath : resolve(apiRoot, explicitPath);
  const directory = resolve(apiRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
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

function openLocalD1(databasePath?: string): { db: RepairD1Like; close: () => void; path: string } {
  const require = createRequire(import.meta.url);
  const BetterSqlite3 = require('better-sqlite3') as new (path: string) => SqliteDatabase;
  const path = discoverLocalDatabase(databasePath);
  const database = new BetterSqlite3(path);
  return {
    db: new LocalD1(database),
    close: () => database.close(),
    path,
  };
}

export async function repairTalentPoolSourceRefs(
  db: D1Database,
  options: TalentPoolSourceRefRepairOptions = {},
): Promise<TalentPoolSourceRefRepairReport> {
  const dryRun = options.dryRun === true;
  const parsedBatchSize = Number.isFinite(options.batchSize) ? Math.floor(options.batchSize ?? 250) : 250;
  const parsedMaxBatches = Number.isFinite(options.maxBatches) ? Math.floor(options.maxBatches ?? 20) : 20;
  const parsedCountLimit = Number.isFinite(options.countLimit) ? Math.floor(options.countLimit ?? 1000) : 1000;
  const batchSize = Math.max(1, Math.min(parsedBatchSize, 1000));
  const maxBatches = Math.max(1, Math.min(parsedMaxBatches, 1000));
  const countLimit = Math.max(1, Math.min(parsedCountLimit, 5000));
  const countRepairable = async (): Promise<number> => {
    const resumeCount = await countTalentPoolResumeNodeSourceRefRepairCandidates(db, countLimit);
    const profileIntakeCount = await countTalentPoolProfileIntakeNodeSourceRefRepairCandidates(db, countLimit);
    return resumeCount + profileIntakeCount;
  };
  const beforeRepairableCount = await countRepairable();

  if (dryRun) {
    return {
      dryRun,
      batchSize,
      maxBatches,
      countLimit,
      batches: 0,
      beforeRepairableCount,
      scanned: 0,
      repaired: 0,
      afterRepairableCount: beforeRepairableCount,
    };
  }

  let scanned = 0;
  let repaired = 0;
  let batches = 0;

  for (let index = 0; index < maxBatches; index += 1) {
    const resumeResult = await repairTalentPoolResumeNodeSourceRefs(db, batchSize);
    const profileIntakeResult = await repairTalentPoolProfileIntakeNodeSourceRefs(db, batchSize);
    const result = {
      scanned: resumeResult.scanned + profileIntakeResult.scanned,
      repaired: resumeResult.repaired + profileIntakeResult.repaired,
    };
    batches += 1;
    scanned += result.scanned;
    repaired += result.repaired;
    if (result.scanned === 0 || result.repaired === 0) break;
  }

  const afterRepairableCount = await countRepairable();
  return {
    dryRun,
    batchSize,
    maxBatches,
    countLimit,
    batches,
    beforeRepairableCount,
    scanned,
    repaired,
    afterRepairableCount,
  };
}

function printReport(report: TalentPoolSourceRefRepairReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('Talent Pool source-ref repair');
  console.log(`  dryRun: ${report.dryRun}`);
  console.log(`  repairable before: ${report.beforeRepairableCount} (bounded by countLimit=${report.countLimit})`);
  console.log(`  scanned: ${report.scanned}`);
  console.log(`  repaired: ${report.repaired}`);
  console.log(`  repairable after: ${report.afterRepairableCount} (bounded by countLimit=${report.countLimit})`);
  console.log(`  batches: ${report.batches}/${report.maxBatches}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let opened: { db: RepairD1Like; close: () => void } | null = null;
  try {
    opened = options.target === 'remote'
      ? { db: new RemoteD1(new D1Client(loadD1Config())), close: () => undefined }
      : openLocalD1(options.databasePath);

    const report = await repairTalentPoolSourceRefs(opened.db as unknown as D1Database, options);
    printReport(report, options.json);
  } finally {
    opened?.close();
  }
}

if (process.argv[1]?.endsWith('repairTalentPoolSourceRefs.ts')) {
  main().catch((error) => {
    console.error('[repairTalentPoolSourceRefs] fatal:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
