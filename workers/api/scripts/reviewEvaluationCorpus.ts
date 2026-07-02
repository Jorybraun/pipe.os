#!/usr/bin/env tsx

import Database from 'better-sqlite3';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  applyExpertCorpusReview,
  buildCorpusReviewPacket,
  loadCorpus,
  persistSeededCorpus,
  type ApplyExpertCorpusReviewInput,
  type CorpusReviewPacket,
  type EvaluationCorpus,
  type ExpertLabelReview,
} from '../src/lib/challengeMatching/evaluation';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';

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

interface StoredCorpusRow {
  corpus_json: string;
}

export interface CorpusReviewCliOptions {
  target: 'local' | 'remote';
  databasePath?: string;
  sourceCorpusId?: string;
  sourceCorpusFile?: string;
  reviewPacketPath?: string;
  reviewTemplatePath?: string;
  reviewFile?: string;
  reviewedCorpusPath?: string;
  jsonPath?: string;
  persist: boolean;
  reviewerId?: string;
  reviewerRole?: string;
  reviewArtifactId?: string;
  reviewArtifactVersion?: string;
  rubricVersion?: string;
}

export interface ExpertReviewFile extends ApplyExpertCorpusReviewInput {
  sourceCorpusId?: string;
}

export interface CorpusReviewCliSummary {
  sourceCorpusId: string;
  reviewPacketPath?: string;
  reviewTemplatePath?: string;
  reviewFile?: string;
  reviewedCorpusPath?: string;
  reviewedCorpusId?: string;
  corpusHash?: string;
  persisted?: boolean;
  productionReady?: boolean;
  productionReadinessFailures?: string[];
  expertLabelCount?: number;
  syntheticFixtureCount?: number;
  nextAction: 'review_exported' | 'complete_expert_review' | 'run_evaluation';
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const TODO_REVIEWER_ID = 'TODO_REVIEWER_ID';

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

function hasReviewAction(options: CorpusReviewCliOptions): boolean {
  return Boolean(
    options.reviewPacketPath
    || options.reviewTemplatePath
    || options.reviewFile
    || options.reviewedCorpusPath
    || options.persist,
  );
}

export function parseCorpusReviewArgs(argv: string[]): CorpusReviewCliOptions | null {
  if (argv.includes('--help') || argv.includes('-h')) return null;
  const target = argv.includes('--remote') ? 'remote' : 'local';
  const sourceCorpusId = valueFor(argv, '--source-corpus-id');
  const sourceCorpusFile = valueFor(argv, '--source-corpus-file');
  if (!sourceCorpusId && !sourceCorpusFile) {
    throw new Error('--source-corpus-id or --source-corpus-file is required');
  }
  if (sourceCorpusId && sourceCorpusFile) {
    throw new Error('pass only one of --source-corpus-id or --source-corpus-file');
  }
  const databasePath = valueFor(argv, '--database-path');
  if (target === 'remote' && databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  const options: CorpusReviewCliOptions = {
    target,
    persist: argv.includes('--persist'),
    ...(databasePath ? { databasePath } : {}),
    ...(sourceCorpusId ? { sourceCorpusId } : {}),
    ...(sourceCorpusFile ? { sourceCorpusFile } : {}),
    ...(valueFor(argv, '--review-packet') ? { reviewPacketPath: valueFor(argv, '--review-packet')! } : {}),
    ...(valueFor(argv, '--review-template') ? { reviewTemplatePath: valueFor(argv, '--review-template')! } : {}),
    ...(valueFor(argv, '--review-file') ? { reviewFile: valueFor(argv, '--review-file')! } : {}),
    ...(valueFor(argv, '--reviewed-corpus') ? { reviewedCorpusPath: valueFor(argv, '--reviewed-corpus')! } : {}),
    ...(valueFor(argv, '--json') ? { jsonPath: valueFor(argv, '--json')! } : {}),
    ...(valueFor(argv, '--reviewer-id') ? { reviewerId: valueFor(argv, '--reviewer-id')! } : {}),
    ...(valueFor(argv, '--reviewer-role') ? { reviewerRole: valueFor(argv, '--reviewer-role')! } : {}),
    ...(valueFor(argv, '--review-artifact-id') ? { reviewArtifactId: valueFor(argv, '--review-artifact-id')! } : {}),
    ...(valueFor(argv, '--review-artifact-version') ? { reviewArtifactVersion: valueFor(argv, '--review-artifact-version')! } : {}),
    ...(valueFor(argv, '--rubric-version') ? { rubricVersion: valueFor(argv, '--rubric-version')! } : {}),
  };
  if (!hasReviewAction(options)) {
    throw new Error('nothing to do; pass --review-packet, --review-template, --review-file, --reviewed-corpus, or --persist');
  }
  if (options.persist && !options.sourceCorpusId) {
    throw new Error('--persist requires --source-corpus-id so the source frozen corpus remains auditable');
  }
  if (options.persist && !options.reviewFile) {
    throw new Error('--persist requires --review-file');
  }
  if ((options.reviewedCorpusPath || options.persist) && !options.reviewFile) {
    throw new Error('--reviewed-corpus and --persist require --review-file');
  }
  return options;
}

export function corpusReviewHelp(): string {
  return `Usage:
  npx tsx scripts/reviewEvaluationCorpus.ts --source-corpus-id <id> [options]
  npx tsx scripts/reviewEvaluationCorpus.ts --source-corpus-file <path> [options]

Options:
  --local | --remote
  --database-path <path>
  --review-packet <path>              Write source-backed expert review packet
  --review-template <path>            Write editable expert review payload template
  --review-file <path>                Apply completed expert review payload
  --reviewed-corpus <path>            Write reviewed frozen corpus JSON
  --persist                           Persist reviewed corpus to evaluation_corpora
  --json <path>                       Write machine-readable summary
  --reviewer-id <id>                  Optional default for generated template
  --reviewer-role <role>              Optional default for generated template
  --review-artifact-id <id>           Optional default for generated template
  --review-artifact-version <version> Optional default for generated template
  --rubric-version <version>          Optional default for generated template`;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(resolve(apiRoot, path), 'utf8')) as unknown;
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(resolve(apiRoot, path), `${JSON.stringify(value, null, 2)}\n`);
}

function sourceCorpusId(corpus: EvaluationCorpus): string {
  return corpus.corpusId;
}

async function loadStoredCorpus(db: D1Like, corpusId: string): Promise<EvaluationCorpus> {
  const row = await db.prepare(
    `SELECT corpus_json
       FROM evaluation_corpora
      WHERE corpus_id = ?1`,
  ).bind(corpusId).first<StoredCorpusRow>();
  if (!row) {
    throw new Error(`evaluation corpus not found: ${corpusId}`);
  }
  return loadCorpus(row.corpus_json);
}

function loadCorpusFile(path: string): EvaluationCorpus {
  return loadCorpus(readFileSync(resolve(apiRoot, path), 'utf8'));
}

function isPlaceholder(value: string | undefined): boolean {
  return Boolean(value && /\bTODO\b/.test(value));
}

function assertCompletedReview(input: ExpertReviewFile): void {
  const failures: string[] = [];
  if (isPlaceholder(input.reviewerId)) failures.push('reviewerId still contains a TODO placeholder');
  if (isPlaceholder(input.reviewerRole)) failures.push('reviewerRole still contains a TODO placeholder');
  if (isPlaceholder(input.reviewArtifactId)) failures.push('reviewArtifactId still contains a TODO placeholder');
  if (isPlaceholder(input.reviewArtifactVersion)) failures.push('reviewArtifactVersion still contains a TODO placeholder');
  if (isPlaceholder(input.rubricVersion)) failures.push('rubricVersion still contains a TODO placeholder');
  for (const label of input.labels ?? []) {
    if (isPlaceholder(label.explanation)) {
      failures.push(`label ${label.labelId} explanation still contains a TODO placeholder`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Expert review file is incomplete: ${failures.join('; ')}`);
  }
}

function templateReviewLabel(item: CorpusReviewPacket['items'][number]): ExpertLabelReview {
  return {
    labelId: item.labelId,
    relevanceGrade: item.draft.relevanceGrade,
    eligibleChallengeIds: item.draft.eligibleChallengeIds,
    explanation: `TODO: replace with source-backed human rationale for ${item.labelId}`,
  };
}

export function buildExpertReviewTemplate(
  packet: CorpusReviewPacket,
  defaults?: {
    reviewerId?: string;
    reviewerRole?: string;
    reviewArtifactId?: string;
    reviewArtifactVersion?: string;
    rubricVersion?: string;
  },
): ExpertReviewFile {
  return {
    sourceCorpusId: packet.corpusId,
    reviewerId: defaults?.reviewerId ?? TODO_REVIEWER_ID,
    ...(defaults?.reviewerRole ? { reviewerRole: defaults.reviewerRole } : {}),
    reviewArtifactId: defaults?.reviewArtifactId ?? `${packet.corpusId}-expert-review`,
    reviewArtifactVersion: defaults?.reviewArtifactVersion ?? 'v1',
    rubricVersion: defaults?.rubricVersion ?? 'candidate-pr-match-rubric-v1',
    labels: packet.items.map(templateReviewLabel),
  };
}

function parseReviewFile(path: string): ExpertReviewFile {
  const parsed = readJsonFile(path);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('review file must contain an object');
  }
  return parsed as ExpertReviewFile;
}

async function openD1(
  options: CorpusReviewCliOptions,
): Promise<{ db: D1Like; close(): void }> {
  if (options.target === 'remote') {
    return {
      db: new RemoteD1(new D1Client(loadD1Config())),
      close: () => {},
    };
  }
  const sqlite = new Database(discoverLocalDatabase(options.databasePath));
  return {
    db: new LocalD1(sqlite),
    close: () => sqlite.close(),
  };
}

async function loadSourceCorpus(
  options: CorpusReviewCliOptions,
  db: D1Like | null,
): Promise<EvaluationCorpus> {
  if (options.sourceCorpusFile) return loadCorpusFile(options.sourceCorpusFile);
  if (!options.sourceCorpusId) throw new Error('--source-corpus-id is required');
  if (!db) throw new Error('--source-corpus-id requires D1 access');
  const corpus = await loadStoredCorpus(db, options.sourceCorpusId);
  if (corpus.corpusId !== options.sourceCorpusId) {
    throw new Error(
      `stored corpus row "${options.sourceCorpusId}" contains corpus "${corpus.corpusId}"`,
    );
  }
  return corpus;
}

export async function runCorpusReviewCli(argv: string[]): Promise<number> {
  const options = parseCorpusReviewArgs(argv);
  if (!options) {
    process.stdout.write(`${corpusReviewHelp()}\n`);
    return 0;
  }

  const needsD1 = Boolean(options.sourceCorpusId || options.persist);
  const connection = needsD1 ? await openD1(options) : null;
  try {
    const source = await loadSourceCorpus(options, connection?.db ?? null);
    const packet = buildCorpusReviewPacket(source);
    const summary: CorpusReviewCliSummary = {
      sourceCorpusId: sourceCorpusId(source),
      nextAction: 'review_exported',
    };

    if (options.reviewPacketPath) {
      writeJsonFile(options.reviewPacketPath, packet);
      summary.reviewPacketPath = resolve(apiRoot, options.reviewPacketPath);
    }

    if (options.reviewTemplatePath) {
      writeJsonFile(options.reviewTemplatePath, buildExpertReviewTemplate(packet, {
        ...(options.reviewerId ? { reviewerId: options.reviewerId } : {}),
        ...(options.reviewerRole ? { reviewerRole: options.reviewerRole } : {}),
        ...(options.reviewArtifactId ? { reviewArtifactId: options.reviewArtifactId } : {}),
        ...(options.reviewArtifactVersion ? { reviewArtifactVersion: options.reviewArtifactVersion } : {}),
        ...(options.rubricVersion ? { rubricVersion: options.rubricVersion } : {}),
      }));
      summary.reviewTemplatePath = resolve(apiRoot, options.reviewTemplatePath);
      summary.nextAction = 'complete_expert_review';
    }

    if (options.reviewFile) {
      const review = parseReviewFile(options.reviewFile);
      if (review.sourceCorpusId && review.sourceCorpusId !== source.corpusId) {
        throw new Error(
          `review file sourceCorpusId "${review.sourceCorpusId}" does not match source corpus "${source.corpusId}"`,
        );
      }
      assertCompletedReview(review);
      const result = await applyExpertCorpusReview(source, review);
      summary.reviewFile = resolve(apiRoot, options.reviewFile);
      summary.reviewedCorpusId = result.corpus.corpusId;
      summary.productionReady = result.productionReady;
      summary.productionReadinessFailures = result.productionReadinessFailures;
      summary.expertLabelCount = result.expertLabelCount;
      summary.syntheticFixtureCount = result.syntheticFixtureCount;
      summary.nextAction = result.productionReady ? 'run_evaluation' : 'complete_expert_review';

      if (options.reviewedCorpusPath) {
        writeJsonFile(options.reviewedCorpusPath, result.corpus);
        summary.reviewedCorpusPath = resolve(apiRoot, options.reviewedCorpusPath);
      }

      if (options.persist) {
        if (!connection) throw new Error('--persist requires D1 access');
        const persistResult = await persistSeededCorpus(connection.db as unknown as D1Database, result.corpus);
        summary.persisted = persistResult.persisted;
        summary.corpusHash = persistResult.corpusHash;
      }
    }

    if (options.jsonPath) {
      writeJsonFile(options.jsonPath, summary);
    } else {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
    return summary.productionReady === false ? 1 : 0;
  } finally {
    connection?.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runCorpusReviewCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
