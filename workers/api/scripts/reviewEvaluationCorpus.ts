#!/usr/bin/env tsx

import Database from 'better-sqlite3';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  applyExpertCorpusReview,
  buildCorpusReviewPacket,
  evaluationCorpusLabelCounts,
  loadCorpus,
  persistSeededCorpus,
  seedCorpusFromMatchRuns,
  type ApplyExpertCorpusReviewInput,
  type CorpusReviewPacket,
  type CorpusReviewReadinessSummary,
  type CorpusSeederResult,
  type EvaluationCorpus,
  type ExpertLabelReview,
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

interface StoredCorpusRow {
  corpus_json: string;
}

export interface CorpusReviewCliOptions {
  target: 'local' | 'remote';
  databasePath?: string;
  databaseId?: string;
  sourceCorpusId?: string;
  sourceCorpusFile?: string;
  seedFromMatchRuns: boolean;
  seedLimit?: number;
  seedSelectionPoolLimit?: number;
  seedStatusFilter?: string;
  seedRoleContextId?: string;
  seedDescription?: string;
  persistDraft: boolean;
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
  seeded?: {
    matchRunCount: number;
    candidateCount: number;
    roleCount: number;
    challengeCount: number;
    labelCount: number;
    draftLabelCount: number;
    expertLabelCount: number;
    syntheticFixtureCount: number;
    expectedPacketCount: number;
    warnings: string[];
  };
  draftPersisted?: boolean;
  draftCorpusHash?: string;
  reviewPacketPath?: string;
  reviewTemplatePath?: string;
  reviewFile?: string;
  reviewedCorpusPath?: string;
  reviewedCorpusId?: string;
  corpusHash?: string;
  persisted?: boolean;
  productionReady?: boolean;
  productionReadinessFailures?: string[];
  readinessSummary?: CorpusReviewReadinessSummary;
  expertLabelCount?: number;
  syntheticFixtureCount?: number;
  nextAction:
    | 'review_exported'
    | 'complete_expert_review'
    | 'expand_corpus_packet_breadth'
    | 'fix_corpus_source_evidence'
    | 'run_evaluation';
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

function positiveIntegerFor(argv: string[], flag: string): number | undefined {
  const value = valueFor(argv, flag);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function hasReviewAction(options: CorpusReviewCliOptions): boolean {
  return Boolean(
    options.reviewPacketPath
    || options.reviewTemplatePath
    || options.reviewFile
    || options.reviewedCorpusPath
    || options.persistDraft
    || options.persist,
  );
}

export function parseCorpusReviewArgs(argv: string[]): CorpusReviewCliOptions | null {
  if (argv.includes('--help') || argv.includes('-h')) return null;
  const target = argv.includes('--remote') ? 'remote' : 'local';
  const sourceCorpusId = valueFor(argv, '--source-corpus-id');
  const sourceCorpusFile = valueFor(argv, '--source-corpus-file');
  const seedFromMatchRuns = argv.includes('--seed-from-match-runs');
  const sourceModes = [Boolean(sourceCorpusId), Boolean(sourceCorpusFile), seedFromMatchRuns]
    .filter(Boolean).length;
  if (sourceModes === 0) {
    throw new Error('--source-corpus-id, --source-corpus-file, or --seed-from-match-runs is required');
  }
  if (sourceModes > 1) {
    throw new Error('pass only one source mode: --source-corpus-id, --source-corpus-file, or --seed-from-match-runs');
  }
  const databasePath = valueFor(argv, '--database-path');
  const databaseId = valueFor(argv, '--database-id');
  if (target === 'remote' && databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  if (target === 'local' && databaseId) {
    throw new Error('--database-id requires --remote');
  }
  const seedLimit = positiveIntegerFor(argv, '--seed-limit');
  const seedSelectionPoolLimit = positiveIntegerFor(argv, '--seed-selection-pool-limit');
  const options: CorpusReviewCliOptions = {
    target,
    persist: argv.includes('--persist'),
    persistDraft: argv.includes('--persist-draft'),
    seedFromMatchRuns,
    ...(databasePath ? { databasePath } : {}),
    ...(databaseId ? { databaseId } : {}),
    ...(sourceCorpusId ? { sourceCorpusId } : {}),
    ...(sourceCorpusFile ? { sourceCorpusFile } : {}),
    ...(seedLimit ? { seedLimit } : {}),
    ...(seedSelectionPoolLimit ? { seedSelectionPoolLimit } : {}),
    ...(valueFor(argv, '--seed-status') ? { seedStatusFilter: valueFor(argv, '--seed-status')! } : {}),
    ...(valueFor(argv, '--seed-role-context-id') ? { seedRoleContextId: valueFor(argv, '--seed-role-context-id')! } : {}),
    ...(valueFor(argv, '--seed-description') ? { seedDescription: valueFor(argv, '--seed-description')! } : {}),
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
    throw new Error('nothing to do; pass --review-packet, --review-template, --review-file, --reviewed-corpus, --persist-draft, or --persist');
  }
  if (options.persistDraft && !options.seedFromMatchRuns) {
    throw new Error('--persist-draft can only be used with --seed-from-match-runs');
  }
  if (options.seedFromMatchRuns && options.reviewFile) {
    throw new Error('--review-file cannot be combined with --seed-from-match-runs; first persist/export the draft, then review it');
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
  npx tsx scripts/reviewEvaluationCorpus.ts --seed-from-match-runs [options]

Options:
  --local | --remote
  --database-path <path>
  --database-id <id>                 Remote D1 database id; defaults to MATCHING_EVALUATION_D1_DATABASE_ID then CLOUDFLARE_D1_DATABASE_ID
  --seed-from-match-runs              Build a draft corpus from real persisted match_runs
  --seed-limit <n>                    Match run limit for seeding (default: 50)
  --seed-selection-pool-limit <n>     Recent match-run rows inspected for packet-diverse seeding (default: 500)
  --seed-status <status>              Match run status for seeding (default: MATCHED)
  --seed-role-context-id <id>         Optional role_context_id filter
  --seed-description <text>           Description for the seeded draft corpus
  --persist-draft                     Persist the seeded draft corpus before review
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

function summarizeSeededCorpus(result: CorpusSeederResult): CorpusReviewCliSummary['seeded'] {
  const counts = evaluationCorpusLabelCounts(result.corpus);
  const labelCount = result.corpus.expertLabels.length;
  const draftLabelCount = labelCount - counts.expertLabelCount - counts.syntheticFixtureCount;
  return {
    matchRunCount: result.matchRunCount,
    candidateCount: result.candidateCount,
    roleCount: result.roleCount,
    challengeCount: result.challengeCount,
    labelCount,
    draftLabelCount,
    expertLabelCount: counts.expertLabelCount,
    syntheticFixtureCount: counts.syntheticFixtureCount,
    expectedPacketCount: result.corpus.expectedPackets?.length ?? 0,
    warnings: result.warnings,
  };
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
    ...(item.draft.negativeCandidateId
      ? { negativeCandidateId: item.draft.negativeCandidateId }
      : {}),
    ...(item.draft.minimumScoreSeparation !== null
      ? { minimumScoreSeparation: item.draft.minimumScoreSeparation }
      : {}),
    explanation: `TODO: replace with source-backed human rationale for ${item.labelId}`,
  };
}

function cliNextActionFromReadiness(
  readiness: CorpusReviewReadinessSummary,
): CorpusReviewCliSummary['nextAction'] {
  return readiness.nextAction === 'ready_for_evaluation'
    ? 'run_evaluation'
    : readiness.nextAction;
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
      db: remoteD1(options.databaseId),
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
): Promise<{ corpus: EvaluationCorpus; seedResult?: CorpusSeederResult }> {
  if (options.sourceCorpusFile) return { corpus: loadCorpusFile(options.sourceCorpusFile) };
  if (options.seedFromMatchRuns) {
    if (!db) throw new Error('--seed-from-match-runs requires D1 access');
    const seedResult = await seedCorpusFromMatchRuns(db as unknown as D1Database, {
      ...(options.seedLimit ? { limit: options.seedLimit } : {}),
      ...(options.seedSelectionPoolLimit ? { selectionPoolLimit: options.seedSelectionPoolLimit } : {}),
      ...(options.seedStatusFilter ? { statusFilter: options.seedStatusFilter } : {}),
      ...(options.seedRoleContextId ? { roleContextId: options.seedRoleContextId } : {}),
      ...(options.seedDescription ? { description: options.seedDescription } : {}),
    });
    return { corpus: seedResult.corpus, seedResult };
  }
  if (!options.sourceCorpusId) throw new Error('--source-corpus-id or --seed-from-match-runs is required');
  if (!db) throw new Error('--source-corpus-id requires D1 access');
  const corpus = await loadStoredCorpus(db, options.sourceCorpusId);
  if (corpus.corpusId !== options.sourceCorpusId) {
    throw new Error(
      `stored corpus row "${options.sourceCorpusId}" contains corpus "${corpus.corpusId}"`,
    );
  }
  return { corpus };
}

export async function runCorpusReviewCli(argv: string[]): Promise<number> {
  const options = parseCorpusReviewArgs(argv);
  if (!options) {
    process.stdout.write(`${corpusReviewHelp()}\n`);
    return 0;
  }

  const needsD1 = Boolean(options.sourceCorpusId || options.seedFromMatchRuns || options.persist || options.persistDraft);
  const connection = needsD1 ? await openD1(options) : null;
  try {
    const loadedSource = await loadSourceCorpus(options, connection?.db ?? null);
    const source = loadedSource.corpus;
    const packet = buildCorpusReviewPacket(source);
    const summary: CorpusReviewCliSummary = {
      sourceCorpusId: sourceCorpusId(source),
      readinessSummary: packet.readinessSummary,
      nextAction: cliNextActionFromReadiness(packet.readinessSummary),
    };
    if (loadedSource.seedResult) {
      summary.seeded = summarizeSeededCorpus(loadedSource.seedResult);
    }

    if (options.persistDraft) {
      if (!connection) throw new Error('--persist-draft requires D1 access');
      const persistResult = await persistSeededCorpus(connection.db as unknown as D1Database, source);
      summary.draftPersisted = persistResult.persisted;
      summary.draftCorpusHash = persistResult.corpusHash;
    }

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
      summary.nextAction = cliNextActionFromReadiness(packet.readinessSummary);
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
      const reviewedPacket = buildCorpusReviewPacket(result.corpus);
      summary.reviewFile = resolve(apiRoot, options.reviewFile);
      summary.reviewedCorpusId = result.corpus.corpusId;
      summary.productionReady = result.productionReady;
      summary.productionReadinessFailures = result.productionReadinessFailures;
      summary.readinessSummary = reviewedPacket.readinessSummary;
      summary.expertLabelCount = result.expertLabelCount;
      summary.syntheticFixtureCount = result.syntheticFixtureCount;
      summary.nextAction = cliNextActionFromReadiness(reviewedPacket.readinessSummary);

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
