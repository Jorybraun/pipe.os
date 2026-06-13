#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateHumanReadableReport,
  loadCorpus,
  runEvaluation,
} from '../src/lib/challengeMatching/evaluation';
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

interface Options {
  target: 'local' | 'remote';
  databasePath?: string;
  corpusId: string;
  corpusFile?: string;
  matchRunIds: string[];
  comparisonMatchRunIds: string[];
  jsonPath?: string;
  reportPath?: string;
  persist: boolean;
  allowSynthetic: boolean;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

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

  private bindingError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const statement = this.sql.replace(/\s+/g, ' ').trim();
    const valueTypes = this.values.map((value) => value === null ? 'null' : typeof value);
    return new Error(
      `${message} [statement="${statement}", bindingTypes=${JSON.stringify(valueTypes)}]`,
      { cause: error },
    );
  }

  async first<T>(): Promise<T | null> {
    try {
      return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
    } catch (error) {
      throw this.bindingError(error);
    }
  }

  async all<T>(): Promise<QueryResult<T>> {
    try {
      return {
        results: this.database.prepare(this.sql).all(...this.values) as T[],
        success: true,
      };
    } catch (error) {
      throw this.bindingError(error);
    }
  }

  async run(): Promise<QueryResult<never>> {
    try {
      this.database.prepare(this.sql).run(...this.values);
      return { results: [], success: true };
    } catch (error) {
      throw this.bindingError(error);
    }
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
    return {
      results: await this.client.query<T>(this.sql, this.values),
      success: true,
    };
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
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one local D1 database; pass --database-path. Found: ${candidates.join(', ')}`,
    );
  }
  return candidates[0]!;
}

function valuesFor(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === flag && argv[index + 1]) values.push(argv[index + 1]!);
    if (argv[index]?.startsWith(`${flag}=`)) values.push(argv[index]!.slice(flag.length + 1));
  }
  return values.flatMap((value) => value.split(',')).filter(Boolean);
}

function valueFor(argv: string[], flag: string): string | undefined {
  return valuesFor(argv, flag)[0];
}

function parseArgs(argv: string[]): Options {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Usage:
  npx tsx scripts/evaluateMatching.ts --corpus-id <id> [options]

Options:
  --local | --remote
  --database-path <path>
  --corpus-file <path>          Validate and freeze this corpus before evaluation
  --match-run-id <id>           Repeat or pass comma-separated IDs
  --comparison-run-id <id>      Independent reruns for byte-identical comparison
  --json <path>                 Write machine-readable result
  --report <path>               Write human-readable report
  --persist                     Persist the evaluation result in D1
  --allow-synthetic             Disable the expert-only gate for fixture testing`);
    process.exit(0);
  }
  const corpusId = valueFor(argv, '--corpus-id');
  if (!corpusId) throw new Error('--corpus-id is required');
  const target = argv.includes('--remote') ? 'remote' : 'local';
  const databasePath = valueFor(argv, '--database-path');
  if (target === 'remote' && databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  return {
    target,
    databasePath,
    corpusId,
    corpusFile: valueFor(argv, '--corpus-file'),
    matchRunIds: valuesFor(argv, '--match-run-id'),
    comparisonMatchRunIds: valuesFor(argv, '--comparison-run-id'),
    jsonPath: valueFor(argv, '--json'),
    reportPath: valueFor(argv, '--report'),
    persist: argv.includes('--persist'),
    allowSynthetic: argv.includes('--allow-synthetic'),
  };
}

async function freezeCorpus(
  db: D1Like,
  corpusId: string,
  corpusFile: string,
): Promise<void> {
  const corpusJson = readFileSync(resolve(corpusFile), 'utf8');
  const corpus = loadCorpus(corpusJson);
  if (corpus.corpusId !== corpusId) {
    throw new Error(
      `Corpus file ID "${corpus.corpusId}" does not match --corpus-id "${corpusId}"`,
    );
  }
  const corpusHash = createHash('sha256').update(corpusJson).digest('hex');
  const existing = await db.prepare(
    'SELECT corpus_hash FROM evaluation_corpora WHERE corpus_id = ?1',
  ).bind(corpusId).first<{ corpus_hash: string }>();
  if (existing) {
    if (existing.corpus_hash !== corpusHash) {
      throw new Error(`Frozen corpus "${corpusId}" already exists with different content`);
    }
    return;
  }
  const syntheticFixtureCount = corpus.expertLabels.filter(
    (label) => label.labeledBy === 'synthetic-fixture',
  ).length;
  await db.prepare(
    `INSERT INTO evaluation_corpora (
       corpus_id, schema_version, corpus_hash, corpus_json,
       expert_label_count, synthetic_fixture_count, frozen_at, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())`,
  ).bind(
    corpus.corpusId,
    corpus.version,
    corpusHash,
    corpusJson,
    corpus.expertLabels.length - syntheticFixtureCount,
    syntheticFixtureCount,
    Math.floor(Date.parse(corpus.createdAt) / 1000),
  ).run();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let localDatabase: SqliteDatabase | undefined;
  let db: D1Like;
  if (options.target === 'remote') {
    db = new RemoteD1(new D1Client(loadD1Config()));
  } else {
    const path = discoverLocalDatabase(options.databasePath);
    localDatabase = new DatabaseSync(path);
    db = new LocalD1(localDatabase);
  }

  try {
    if (options.corpusFile) {
      await freezeCorpus(db, options.corpusId, options.corpusFile);
    }
    const result = await runEvaluation(db as unknown as D1Database, {
      corpusId: options.corpusId,
      matchRunIds: options.matchRunIds,
      comparisonMatchRunIds: options.comparisonMatchRunIds,
      persistResult: options.persist,
      ...(options.allowSynthetic
        ? { thresholds: { requireExpertLabels: false } }
        : {}),
    });
    const json = `${JSON.stringify(result, null, 2)}\n`;
    const report = `${generateHumanReadableReport(result)}\n`;
    if (options.jsonPath) writeFileSync(resolve(options.jsonPath), json);
    if (options.reportPath) writeFileSync(resolve(options.reportPath), report);
    if (!options.jsonPath) process.stdout.write(json);
    if (!options.reportPath) process.stdout.write(report);
    if (!result.passed) process.exitCode = 1;
  } finally {
    localDatabase?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
