#!/usr/bin/env tsx
/**
 * Internal living-context match-quality gate.
 *
 * Usage:
 *   npx tsx scripts/runMatchQualityEvaluation.ts --database-path .wrangler/.../db.sqlite --corpus-file ./corpus.json --require-pass
 *   npx tsx scripts/runMatchQualityEvaluation.ts --remote --database-id <d1-id> --corpus-id <stored-corpus> --require-pass
 *   npx tsx scripts/runMatchQualityEvaluation.ts --remote --database-id <d1-id> --latest-expert-corpus --require-pass
 *   npx tsx scripts/runMatchQualityEvaluation.ts --remote --database-id <d1-id> --corpus-id <draft-corpus> --allow-draft-corpus
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import { D1Client } from './crawl-repos/shared/d1Client.js';
import {
  evaluationCorpusLabelCounts,
  loadCorpus as loadFrozenEvaluationCorpus,
  productionCorpusFailures,
  type EvaluationCorpus,
  type RelevanceGrade,
} from '../src/lib/challengeMatching/evaluation';
import {
  runMatchQualityEvaluation,
  type BatchEvaluationPairResult,
  type BatchEvaluationCandidate,
  type MatchQualityReasonCategory,
  type MatchQualityEvaluationResult,
  type MatchQualityEvaluationThresholds,
} from '../src/lib/livingContext/batchEvaluationHarness';
import type { MatchVerdict } from '../src/lib/livingContext/matchReportPipeline';

type SqlValue = string | number | null;
type BetterSqliteDb = InstanceType<typeof Database>;

interface QueryClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: SqlValue[],
  ): Promise<T[]>;
}

interface QueryResult<T> {
  results: T[];
  success: boolean;
  meta?: { changes?: number };
}

interface StatementLike {
  bind(...values: SqlValue[]): StatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult<never>>;
}

interface MatchQualityCorpusFile {
  corpusId: string;
  cases: BatchEvaluationCandidate[];
  thresholds?: Partial<MatchQualityEvaluationThresholds>;
}

interface FrozenCorpusRow {
  corpus_json: string;
  expert_label_count: number;
  synthetic_fixture_count: number;
}

interface EvaluationCorpusSummaryRow {
  corpus_id: string;
  expert_label_count: number;
  synthetic_fixture_count: number;
  created_at: number;
}

interface StoredCorpusGateInput {
  corpusId: string;
  expertLabelCount: number;
  syntheticFixtureCount: number;
  allowDraftCorpus: boolean;
  productionReadinessFailures?: string[];
}

export interface CliOptions {
  databasePath?: string;
  databaseId?: string;
  corpusFile?: string;
  corpusId?: string;
  latestExpertCorpus: boolean;
  remote: boolean;
  requirePass: boolean;
  allowDraftCorpus: boolean;
  json: boolean;
  summaryJson: boolean;
}

interface MatchQualityPairSummary {
  caseId: string;
  candidateId: string;
  challengePacketId: string;
  negativeCandidateId: string | null;
  expectedVerdict: MatchVerdict;
  computedVerdict: MatchVerdict | null;
  verdictMatch: boolean;
  reasonCategory: MatchQualityReasonCategory | null;
  scoreSeparation: number | null;
  minimumScoreSeparation: number | null;
  sourceBackedPr: boolean;
  candidateEvidencePresent: boolean;
  repoEvidencePresent: boolean;
  usableChallenge: boolean;
  failedReasons: string[];
  error: string | null;
  durationMs: number;
}

export interface MatchQualityEvaluationSummary {
  corpusId: string;
  batchId: string;
  passed: boolean;
  metrics: MatchQualityEvaluationResult['metrics'];
  thresholds: MatchQualityEvaluationThresholds;
  gateFailures: string[];
  failedCases: MatchQualityPairSummary[];
  caseResults: MatchQualityPairSummary[];
}

class LocalStatement implements StatementLike {
  private values: SqlValue[] = [];

  constructor(
    private readonly database: BetterSqliteDb,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): StatementLike {
    this.values = values;
    return this;
  }

  private rewritten(): { sql: string; args: SqlValue[] } {
    const numbered = /\?(\d+)/g;
    if (!numbered.test(this.sql)) return { sql: this.sql, args: this.values };
    numbered.lastIndex = 0;
    const args: SqlValue[] = [];
    const sql = this.sql.replace(numbered, (_match, index: string) => {
      args.push(this.values[Number(index) - 1] ?? null);
      return '?';
    });
    return { sql, args };
  }

  async first<T>(): Promise<T | null> {
    const { sql, args } = this.rewritten();
    return (this.database.prepare(sql).get(...args) as T | undefined) ?? null;
  }

  async all<T>(): Promise<QueryResult<T>> {
    const { sql, args } = this.rewritten();
    return {
      results: this.database.prepare(sql).all(...args) as T[],
      success: true,
    };
  }

  async run(): Promise<QueryResult<never>> {
    const { sql, args } = this.rewritten();
    const result = this.database.prepare(sql).run(...args);
    return {
      results: [],
      success: true,
      meta: { changes: result.changes },
    };
  }
}

class LocalD1 {
  constructor(private readonly database: BetterSqliteDb) {}

  prepare(sql: string): StatementLike {
    return new LocalStatement(this.database, sql);
  }
}

class RemoteStatement implements StatementLike {
  private values: SqlValue[] = [];

  constructor(
    private readonly client: QueryClient,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): StatementLike {
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

class RemoteD1 {
  constructor(private readonly client: QueryClient) {}

  prepare(sql: string): StatementLike {
    return new RemoteStatement(this.client, sql);
  }
}

function valueFor(argv: string[], flag: string): string | undefined {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

export function parseOptions(argv: string[]): CliOptions {
  return {
    databasePath: valueFor(argv, '--database-path'),
    databaseId: valueFor(argv, '--database-id'),
    corpusFile: valueFor(argv, '--corpus-file'),
    corpusId: valueFor(argv, '--corpus-id'),
    latestExpertCorpus: hasFlag(argv, '--latest-expert-corpus'),
    remote: hasFlag(argv, '--remote'),
    requirePass: hasFlag(argv, '--require-pass'),
    allowDraftCorpus: hasFlag(argv, '--allow-draft-corpus'),
    json: hasFlag(argv, '--json'),
    summaryJson: hasFlag(argv, '--summary-json'),
  };
}

export function validateOptions(options: CliOptions): void {
  if (options.remote && options.databasePath) {
    throw new Error('pass only one of --remote or --database-path');
  }
  if (!options.remote && !options.databasePath) {
    throw new Error('--database-path or --remote is required');
  }
  const corpusSourceCount = [
    Boolean(options.corpusFile),
    Boolean(options.corpusId),
    options.latestExpertCorpus,
  ].filter(Boolean).length;
  if (corpusSourceCount === 0) {
    throw new Error('--corpus-file, --corpus-id, or --latest-expert-corpus is required');
  }
  if (corpusSourceCount > 1) {
    throw new Error('pass only one corpus source');
  }
  if (options.databaseId && !options.remote) {
    throw new Error('--database-id requires --remote');
  }
  if (options.allowDraftCorpus && options.latestExpertCorpus) {
    throw new Error('--allow-draft-corpus cannot be combined with --latest-expert-corpus');
  }
  if (options.allowDraftCorpus && options.requirePass) {
    throw new Error('--allow-draft-corpus cannot be combined with --require-pass');
  }
  if (options.json && options.summaryJson) {
    throw new Error('pass only one output mode: --json or --summary-json');
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function resolveRemoteDatabaseId(
  databaseId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const resolvedDatabaseId = databaseId
    ?? env['MATCHING_EVALUATION_D1_DATABASE_ID']
    ?? env['CLOUDFLARE_D1_DATABASE_ID']
    ?? '';
  if (!resolvedDatabaseId) {
    throw new Error(
      'Missing required D1 database id; set MATCHING_EVALUATION_D1_DATABASE_ID, '
      + 'CLOUDFLARE_D1_DATABASE_ID, or pass --database-id.',
    );
  }
  return resolvedDatabaseId;
}

function remoteD1(databaseId: string | undefined): D1Database {
  const resolvedDatabaseId = resolveRemoteDatabaseId(databaseId);
  return new RemoteD1(new D1Client({
    accountId: requiredEnv('CLOUDFLARE_ACCOUNT_ID'),
    apiToken: requiredEnv('CLOUDFLARE_API_TOKEN'),
    databaseId: resolvedDatabaseId,
  })) as unknown as D1Database;
}

function isMatchQualityCorpusFile(value: unknown): value is MatchQualityCorpusFile {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as { corpusId?: unknown }).corpusId === 'string'
    && Array.isArray((value as { cases?: unknown }).cases);
}

function expectedVerdictForGrade(grade: RelevanceGrade): MatchVerdict {
  switch (grade) {
    case 'highly_relevant':
      return 'strong_match';
    case 'relevant':
      return 'likely_match';
    case 'borderline':
      return 'needs_review';
    case 'irrelevant':
    case 'forbidden':
      return 'insufficient_evidence';
  }
}

function reasonForGrade(grade: RelevanceGrade): MatchQualityReasonCategory {
  switch (grade) {
    case 'highly_relevant':
    case 'relevant':
      return 'aligned';
    case 'borderline':
      return 'needs_challenge_design';
    case 'irrelevant':
    case 'forbidden':
      return 'insufficient_evidence';
  }
}

export function matchQualityCasesFromEvaluationCorpus(corpus: EvaluationCorpus): MatchQualityCorpusFile {
  const cases = corpus.expertLabels.map((label): BatchEvaluationCandidate => {
    const expectedVerdict = expectedVerdictForGrade(label.relevanceGrade);
    const positive = expectedVerdict === 'strong_match' || expectedVerdict === 'likely_match';
    return {
      caseId: label.labelId,
      candidateId: label.candidateId,
      challengePacketId: label.challengeId,
      expectedVerdict,
      expectedReasonCategory: reasonForGrade(label.relevanceGrade),
      expertLabel: label.explanation ?? `${label.relevanceGrade} by ${label.labeledBy}`,
      negativeCandidateId: label.negativeCandidateId,
      minimumScoreSeparation: label.minimumScoreSeparation,
      requireCandidateEvidence: positive,
      requireRepoEvidence: true,
      requireSourceBackedPr: true,
    };
  });
  return {
    corpusId: corpus.corpusId,
    cases,
  };
}

export function parseMatchQualityCorpusJson(json: string): MatchQualityCorpusFile {
  const parsed = JSON.parse(json) as unknown;
  if (isMatchQualityCorpusFile(parsed)) return parsed;
  const evaluationCorpus = loadFrozenEvaluationCorpus(json);
  return matchQualityCasesFromEvaluationCorpus(evaluationCorpus);
}

export function assertStoredCorpusCanRunMatchQualityGate(input: StoredCorpusGateInput): void {
  if (input.allowDraftCorpus) return;
  if (input.expertLabelCount <= 0) {
    throw new Error(
      `${input.corpusId} has ${input.expertLabelCount} expert labels; complete expert review before running the match-quality gate`,
    );
  }
  if (input.syntheticFixtureCount > 0) {
    throw new Error(
      `${input.corpusId} has ${input.syntheticFixtureCount} synthetic fixture labels; use an expert-labelled corpus for the match-quality gate`,
    );
  }
  if (input.productionReadinessFailures && input.productionReadinessFailures.length > 0) {
    throw new Error(
      `${input.corpusId} is not production-ready for the match-quality gate: ${input.productionReadinessFailures.join('; ')}`,
    );
  }
}

function loadCorpusFile(path: string): MatchQualityCorpusFile {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as MatchQualityCorpusFile;
  if (isMatchQualityCorpusFile(parsed)) return parsed;
  return parseMatchQualityCorpusJson(JSON.stringify(parsed));
}

async function loadStoredCorpus(
  db: D1Database,
  corpusId: string,
  options: { allowDraftCorpus: boolean },
): Promise<MatchQualityCorpusFile> {
  const row = await db.prepare(
    `SELECT corpus_json, expert_label_count, synthetic_fixture_count
       FROM evaluation_corpora
      WHERE corpus_id = ?1`,
  ).bind(corpusId).first<FrozenCorpusRow>();
  if (!row) {
    throw new Error(`stored evaluation corpus not found: ${corpusId}`);
  }
  const evaluationCorpus = loadFrozenEvaluationCorpus(row.corpus_json);
  if (evaluationCorpus.corpusId !== corpusId) {
    throw new Error(`stored corpus row "${corpusId}" contains corpus "${evaluationCorpus.corpusId}"`);
  }
  const counts = evaluationCorpusLabelCounts(evaluationCorpus);
  if (
    counts.expertLabelCount !== row.expert_label_count
    || counts.syntheticFixtureCount !== row.synthetic_fixture_count
  ) {
    throw new Error(`stored corpus row "${corpusId}" label counts do not match corpus JSON`);
  }
  assertStoredCorpusCanRunMatchQualityGate({
    corpusId,
    expertLabelCount: counts.expertLabelCount,
    syntheticFixtureCount: counts.syntheticFixtureCount,
    allowDraftCorpus: options.allowDraftCorpus,
    productionReadinessFailures: productionCorpusFailures(evaluationCorpus),
  });
  return matchQualityCasesFromEvaluationCorpus(evaluationCorpus);
}

export async function resolveLatestExpertCorpusId(db: D1Database): Promise<string> {
  const expertRows = await db.prepare(
    `SELECT corpus_id, expert_label_count, synthetic_fixture_count, created_at
       FROM evaluation_corpora
      WHERE expert_label_count > 0
        AND synthetic_fixture_count = 0
      ORDER BY created_at DESC, corpus_id DESC
      LIMIT 1`,
  ).all<EvaluationCorpusSummaryRow>();
  const expert = expertRows.results[0];
  if (expert) return expert.corpus_id;

  const latestRows = await db.prepare(
    `SELECT corpus_id, expert_label_count, synthetic_fixture_count, created_at
       FROM evaluation_corpora
      ORDER BY created_at DESC, corpus_id DESC
      LIMIT 1`,
  ).all<EvaluationCorpusSummaryRow>();
  const latest = latestRows.results[0];
  if (!latest) {
    throw new Error(
      'No frozen CODE_REVIEW match-quality corpora found; create a draft with matching-eval:review, complete expert review, then persist the reviewed corpus.',
    );
  }
  throw new Error(
    `No expert-labelled CODE_REVIEW match-quality corpus found; latest frozen corpus ${latest.corpus_id} has ${latest.expert_label_count} expert labels and ${latest.synthetic_fixture_count} synthetic fixture labels.`,
  );
}

function summarizePairResult(result: BatchEvaluationPairResult): MatchQualityPairSummary {
  return {
    caseId: result.caseId,
    candidateId: result.candidateId,
    challengePacketId: result.challengePacketId,
    negativeCandidateId: result.negativeCandidateId,
    expectedVerdict: result.expectedVerdict,
    computedVerdict: result.computedVerdict,
    verdictMatch: result.verdictMatch,
    reasonCategory: result.reasonCategory,
    scoreSeparation: result.scoreSeparation,
    minimumScoreSeparation: result.minimumScoreSeparation,
    sourceBackedPr: result.sourceBackedPr,
    candidateEvidencePresent: result.candidateEvidencePresent,
    repoEvidencePresent: result.repoEvidencePresent,
    usableChallenge: result.usableChallenge,
    failedReasons: result.failedReasons,
    error: result.error,
    durationMs: result.durationMs,
  };
}

export function summarizeMatchQualityResult(
  result: MatchQualityEvaluationResult,
): MatchQualityEvaluationSummary {
  return {
    corpusId: result.corpusId,
    batchId: result.batchId,
    passed: result.passed,
    metrics: result.metrics,
    thresholds: result.thresholds,
    gateFailures: result.gateFailures,
    failedCases: result.failedCases.map(summarizePairResult),
    caseResults: result.pairResults.map(summarizePairResult),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  validateOptions(options);

  const sqlite = options.remote ? null : new Database(resolve(options.databasePath!));
  const db = options.remote
    ? remoteD1(options.databaseId)
    : new LocalD1(sqlite!) as unknown as D1Database;
  try {
    const storedCorpusId = options.latestExpertCorpus
      ? await resolveLatestExpertCorpusId(db)
      : options.corpusId;
    const corpus = options.corpusFile
      ? loadCorpusFile(options.corpusFile)
      : await loadStoredCorpus(db, storedCorpusId!, {
          allowDraftCorpus: options.allowDraftCorpus,
        });
    const result = await runMatchQualityEvaluation(
      db,
      {
        corpusId: corpus.corpusId,
        cases: corpus.cases,
        thresholds: corpus.thresholds,
      },
    );

    if (options.summaryJson) {
      console.log(JSON.stringify(summarizeMatchQualityResult(result), null, 2));
    } else if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.corpusId}`);
      console.log(`accuracy=${result.metrics.verdictAccuracy.toFixed(3)} usable=${result.metrics.usableChallengeRate.toFixed(3)} separation=${result.metrics.averageScoreSeparation.toFixed(3)}`);
      console.log(`negativeCases=${result.metrics.negativeCaseCount} insufficientEvidenceCases=${result.metrics.insufficientEvidenceCaseCount} contrastCases=${result.metrics.contrastCaseCount} reasonCategoryExpectations=${result.metrics.reasonCategoryExpectationCount}`);
      for (const failure of result.gateFailures) console.log(`- ${failure}`);
    }

    if (options.requirePass && !result.passed) process.exitCode = 1;
  } finally {
    sqlite?.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
