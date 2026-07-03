#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

import {
  checkLatestProductionEvaluation,
  evaluationCorpusLabelCounts,
  generateEvaluationReadinessReport,
  generateHumanReadableReport,
  loadCorpus,
  runEvaluation,
} from '../src/lib/challengeMatching/evaluation';
import { D1Client } from './crawl-repos/shared/d1Client.js';

type SqlValue = string | number | null;

type BetterSqliteDb = InstanceType<typeof Database>;

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

export interface EvaluationCliOptions {
  target: 'local' | 'remote';
  databasePath?: string;
  databaseId?: string;
  corpusId: string;
  corpusFile?: string;
  matchRunIds: string[];
  comparisonMatchRunIds: string[];
  autoComparisonRuns: boolean;
  jsonPath?: string;
  reportPath?: string;
  persist: boolean;
  allowSynthetic: boolean;
  checkLatestProductionPass: boolean;
  stage: 'shadow' | 'canary' | 'production';
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');

function rewriteNumberedParams(
  sql: string,
  bindings: unknown[],
): { sql: string; args: unknown[] } {
  const numbered = /\?(\d+)/g;
  let match = numbered.exec(sql);
  if (!match) return { sql, args: bindings };

  const args: unknown[] = [];
  let rewritten = '';
  let lastIndex = 0;

  numbered.lastIndex = 0;
  while ((match = numbered.exec(sql)) !== null) {
    rewritten += sql.slice(lastIndex, match.index) + '?';
    const paramIndex = parseInt(match[1], 10) - 1;
    args.push(bindings[paramIndex]);
    lastIndex = numbered.lastIndex;
  }
  rewritten += sql.slice(lastIndex);
  return { sql: rewritten, args };
}

class LocalStatement implements PreparedStatementLike {
  private values: SqlValue[] = [];

  constructor(
    private readonly database: BetterSqliteDb,
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
      const { sql, args } = rewriteNumberedParams(this.sql, this.values);
      return (this.database.prepare(sql).get(...args) as T | undefined) ?? null;
    } catch (error) {
      throw this.bindingError(error);
    }
  }

  async all<T>(): Promise<QueryResult<T>> {
    try {
      const { sql, args } = rewriteNumberedParams(this.sql, this.values);
      return {
        results: this.database.prepare(sql).all(...args) as T[],
        success: true,
      };
    } catch (error) {
      throw this.bindingError(error);
    }
  }

  async run(): Promise<QueryResult<never>> {
    try {
      const { sql, args } = rewriteNumberedParams(this.sql, this.values);
      this.database.prepare(sql).run(...args);
      return { results: [], success: true };
    } catch (error) {
      throw this.bindingError(error);
    }
  }
}

class LocalD1 implements D1Like {
  constructor(private readonly database: BetterSqliteDb) {}

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

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function remoteDatabaseId(explicitDatabaseId?: string): string {
  const databaseId = explicitDatabaseId
    ?? process.env['MATCHING_EVALUATION_D1_DATABASE_ID']
    ?? process.env['CLOUDFLARE_D1_DATABASE_ID']
    ?? '';
  if (!databaseId) {
    throw new Error(
      'Missing required D1 database id; set MATCHING_EVALUATION_D1_DATABASE_ID, '
      + 'CLOUDFLARE_D1_DATABASE_ID, or pass --database-id.',
    );
  }
  return databaseId;
}

function remoteD1(explicitDatabaseId?: string): D1Like {
  return new RemoteD1(new D1Client({
    accountId: requiredEnv('CLOUDFLARE_ACCOUNT_ID'),
    apiToken: requiredEnv('CLOUDFLARE_API_TOKEN'),
    databaseId: remoteDatabaseId(explicitDatabaseId),
  }));
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

function parseStage(value: string | undefined): 'shadow' | 'canary' | 'production' {
  if (!value) return 'production';
  if (value === 'shadow' || value === 'canary' || value === 'production') return value;
  throw new Error(`--stage must be one of: shadow, canary, production (got "${value}")`);
}

export function parseEvaluationArgs(argv: string[]): EvaluationCliOptions | null {
  if (argv.includes('--help') || argv.includes('-h')) return null;
  const corpusId = valueFor(argv, '--corpus-id');
  if (!corpusId) throw new Error('--corpus-id is required');
  const target = argv.includes('--remote') ? 'remote' : 'local';
  const databasePath = valueFor(argv, '--database-path');
  const databaseId = valueFor(argv, '--database-id');
  if (target === 'remote' && databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  if (target === 'local' && databaseId) {
    throw new Error('--database-id requires --remote');
  }
  const comparisonMatchRunIds = valuesFor(argv, '--comparison-run-id');
  const autoComparisonRuns = argv.includes('--auto-comparison-runs');
  if (autoComparisonRuns && comparisonMatchRunIds.length > 0) {
    throw new Error('--auto-comparison-runs cannot be combined with --comparison-run-id');
  }
  return {
    target,
    ...(databasePath ? { databasePath } : {}),
    ...(databaseId ? { databaseId } : {}),
    corpusId,
    ...(valueFor(argv, '--corpus-file')
      ? { corpusFile: valueFor(argv, '--corpus-file')! }
      : {}),
    matchRunIds: valuesFor(argv, '--match-run-id'),
    comparisonMatchRunIds,
    autoComparisonRuns,
    ...(valueFor(argv, '--json') ? { jsonPath: valueFor(argv, '--json')! } : {}),
    ...(valueFor(argv, '--report') ? { reportPath: valueFor(argv, '--report')! } : {}),
    persist: argv.includes('--persist'),
    allowSynthetic: argv.includes('--allow-synthetic'),
    checkLatestProductionPass: argv.includes('--check-latest-production-pass'),
    stage: parseStage(valueFor(argv, '--stage')),
  };
}

export function evaluationHelp(): string {
  return `Usage:
  npx tsx scripts/evaluateMatching.ts --corpus-id <id> [options]

Options:
  --local | --remote
  --database-path <path>
  --database-id <id>           Remote D1 database id; defaults to MATCHING_EVALUATION_D1_DATABASE_ID then CLOUDFLARE_D1_DATABASE_ID
  --corpus-file <path>          Validate and freeze this corpus before evaluation
  --match-run-id <id>           Repeat or pass comma-separated IDs
  --comparison-run-id <id>      Independent reruns for byte-identical comparison
  --auto-comparison-runs        Select one same-or-earlier candidate/role/status run
                                for each primary run when explicit comparison
                                IDs are not supplied
  --json <path>                 Write machine-readable result
  --report <path>               Write human-readable report
  --persist                     Persist the evaluation result in D1
  --check-latest-production-pass
                                Read-only rollout gate: require latest persisted
                                result for --corpus-id to satisfy production gates
  --stage <shadow|canary|production>
                                Rollout stage for the readiness gate (default: production)
  --allow-synthetic             Fixture testing only; cannot be combined with --persist`;
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
  const { expertLabelCount, syntheticFixtureCount } = evaluationCorpusLabelCounts(corpus);
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
    expertLabelCount,
    syntheticFixtureCount,
    Math.floor(Date.parse(corpus.createdAt) / 1000),
  ).run();
}

export async function runEvaluationCli(argv: string[]): Promise<number> {
  const options = parseEvaluationArgs(argv);
  if (!options) {
    process.stdout.write(`${evaluationHelp()}\n`);
    return 0;
  }
  if (options.allowSynthetic && options.persist) {
    throw new Error(
      '--allow-synthetic cannot be combined with --persist; fixture evaluations must not be stored as acceptance evidence',
    );
  }
  if (options.checkLatestProductionPass && options.allowSynthetic) {
    throw new Error('--allow-synthetic cannot be used with --check-latest-production-pass');
  }
  if (options.checkLatestProductionPass && options.corpusFile) {
    throw new Error('--corpus-file cannot be used with --check-latest-production-pass; freeze/evaluate first, then check the persisted result');
  }

  let localDatabase: BetterSqliteDb | undefined;
  let db: D1Like;
  if (options.target === 'remote') {
    db = remoteD1(options.databaseId);
  } else {
    localDatabase = new Database(discoverLocalDatabase(options.databasePath));
    db = new LocalD1(localDatabase);
  }

  try {
    if (options.checkLatestProductionPass) {
      const readiness = await checkLatestProductionEvaluation(db as unknown as D1Database, {
        corpusId: options.corpusId,
        stage: options.stage,
      });
      const json = `${JSON.stringify(readiness, null, 2)}\n`;
      const report = `${generateEvaluationReadinessReport(readiness)}\n`;
      if (options.jsonPath) writeFileSync(resolve(options.jsonPath), json);
      if (options.reportPath) writeFileSync(resolve(options.reportPath), report);
      if (!options.jsonPath) process.stdout.write(json);
      if (!options.reportPath) process.stdout.write(report);
      return readiness.ready ? 0 : 1;
    }
    if (options.corpusFile) {
      await freezeCorpus(db, options.corpusId, options.corpusFile);
    }
    const result = await runEvaluation(db as unknown as D1Database, {
      corpusId: options.corpusId,
      matchRunIds: options.matchRunIds,
      comparisonMatchRunIds: options.comparisonMatchRunIds,
      autoComparisonRuns: options.autoComparisonRuns,
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
    return result.passed ? 0 : 1;
  } finally {
    localDatabase?.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runEvaluationCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
