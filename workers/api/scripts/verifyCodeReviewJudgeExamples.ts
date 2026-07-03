#!/usr/bin/env tsx
/**
 * Compact proof bundle for the CODE_REVIEW judge improvement loop.
 *
 * This verifier is intentionally deterministic: it checks whether stored
 * examples are replayable and calibration-ready without calling an LLM. A
 * later replay runner can consume the same verified rows for model scoring.
 */

import dotenv from 'dotenv';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  D1Client,
  WranglerD1Client,
  type WranglerD1ClientOptions,
} from './crawl-repos/shared/d1Client.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, '..', '.dev.vars'), quiet: true });
const apiRoot = resolve(scriptDir, '..');

const EXPECTED_TASK = 'score_and_improve_code_review_judge';
const REQUIRED_IMPROVEMENT_USES = [
  'judge_prompt_regression',
  'feedback_prompt_regression',
  'human_label_queue',
  'cross_model_calibration',
] as const;
const REQUIRED_SOURCE_TABLES = ['review_sessions', 'challenge_submissions'] as const;
const VALID_STATUSES = ['READY', 'LABELLED', 'ARCHIVED'] as const;

type JudgeExampleStatus = typeof VALID_STATUSES[number];

export interface JudgeExampleRow {
  id: string;
  sessionId: string;
  status: string;
  promptInputJson: string | null;
  expectedOutputJson: string | null;
  judgeFeedbackJson: string | null;
  provenanceJson: string | null;
  updatedAt: string | null;
}

export interface JudgeExampleSummary {
  id: string;
  sessionId: string;
  status: string;
  replayable: boolean;
  labelled: boolean;
  calibrationReady: boolean;
  commentCount: number;
  pushbackCount: number;
  failureModes: string[];
  missing: string[];
  updatedAt: string | null;
}

export interface JudgeExampleAudit {
  status: 'not_ready' | 'replay_ready' | 'calibration_ready';
  replayReady: boolean;
  calibrationReady: boolean;
  counts: {
    total: number;
    ready: number;
    labelled: number;
    archived: number;
    invalidStatus: number;
    replayable: number;
    calibrationReady: number;
  };
  failureModes: string[];
  examples: JudgeExampleSummary[];
  failures: string[];
  nextActions: string[];
}

interface AuditOptions {
  minReplayable?: number;
  minLabelled?: number;
}

interface CliOptions {
  databasePath?: string;
  remote: boolean;
  databaseId?: string;
  limit: number;
  json: boolean;
  requireReplayReady: boolean;
  requireCalibration: boolean;
}

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close?: () => void;
}

interface RemoteQueryClient {
  query<T = Record<string, unknown>>(sql: string, params?: (string | number | null)[]): Promise<T[]>;
}

interface RemoteQueryClientOptions {
  env?: NodeJS.ProcessEnv;
  wranglerOptions?: WranglerD1ClientOptions;
}

export function createRemoteQueryClient(
  databaseId: string,
  options: RemoteQueryClientOptions = {},
): RemoteQueryClient {
  const env = options.env ?? process.env;
  const accountId = env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  const apiToken = env['CLOUDFLARE_API_TOKEN'] ?? '';
  if (accountId && apiToken) {
    return new D1Client({ accountId, apiToken, databaseId });
  }
  return new WranglerD1Client(databaseId, {
    ...options.wranglerOptions,
    env,
  });
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/verifyCodeReviewJudgeExamples.ts [options]',
    '',
    'Options:',
    '  --database-path PATH     Audit one local SQLite database instead of all local DBs',
    '  --remote                 Audit a remote D1 database through the Cloudflare API',
    '  --database-id ID         Remote D1 database id (or CODE_REVIEW_JUDGE_EXAMPLES_D1_DATABASE_ID)',
    '  --limit N                Maximum examples to read per database (default 200)',
    '  --require-replay-ready   Exit non-zero unless at least one example is replay-ready',
    '  --require-calibration    Exit non-zero unless at least one labelled example is calibration-ready',
    '  --json                   Print machine-readable JSON',
    '  --help, -h               Show this help',
  ].join('\n');
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    remote: false,
    limit: 200,
    json: false,
    requireReplayReady: false,
    requireCalibration: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--database-path' || arg.startsWith('--database-path=')) {
      const inline = arg.match(/^--database-path=(.+)$/)?.[1];
      const value = inline ?? argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--database-path requires a value');
      options.databasePath = value;
      if (!inline) index += 1;
    } else if (arg === '--remote') {
      options.remote = true;
    } else if (arg === '--database-id' || arg.startsWith('--database-id=')) {
      const inline = arg.match(/^--database-id=(.+)$/)?.[1];
      const value = inline ?? argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--database-id requires a value');
      options.databaseId = value;
      if (!inline) index += 1;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const inline = arg.match(/^--limit=(.+)$/)?.[1];
      const value = inline ?? argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--limit requires a value');
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--limit must be a positive integer');
      options.limit = Math.min(parsed, 1000);
      if (!inline) index += 1;
    } else if (arg === '--require-replay-ready') {
      options.requireReplayReady = true;
    } else if (arg === '--require-calibration') {
      options.requireCalibration = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.remote && options.databasePath) {
    throw new Error('--remote cannot be combined with --database-path');
  }
  if (!options.remote && options.databaseId) {
    throw new Error('--database-id requires --remote');
  }

  return options;
}

function resolveRemoteDatabaseId(options: CliOptions): string {
  return options.databaseId
    || process.env['CODE_REVIEW_JUDGE_EXAMPLES_D1_DATABASE_ID']
    || process.env['MATCHING_EVALUATION_D1_DATABASE_ID']
    || process.env['CLOUDFLARE_D1_DATABASE_ID']
    || '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function nestedStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  let current: unknown = record;
  for (const key of keys) {
    if (!isRecord(current)) return [];
    current = current[key];
  }
  return stringArray(current);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractFailureModes(promptInput: unknown, expectedOutput: unknown, judgeFeedback: unknown): string[] {
  const modes: string[] = [];
  if (isRecord(promptInput)) {
    modes.push(...nestedStringArray(promptInput, ['labelSlots', 'judgeFailureModes']));
  }
  if (isRecord(expectedOutput)) {
    modes.push(...stringArray(expectedOutput.judgeFailureModes));
    modes.push(...stringArray(expectedOutput.failureModes));
    modes.push(...nestedStringArray(expectedOutput, ['labelSlots', 'judgeFailureModes']));
  }
  if (isRecord(judgeFeedback)) {
    modes.push(...stringArray(judgeFeedback.judgeFailureModes));
    modes.push(...stringArray(judgeFeedback.failureModes));
  }
  return unique(modes);
}

function countStatus(rows: JudgeExampleRow[], status: JudgeExampleStatus): number {
  return rows.filter((row) => row.status.toUpperCase() === status).length;
}

function auditExample(row: JudgeExampleRow): JudgeExampleSummary {
  const missing: string[] = [];
  const promptInput = parseJson(row.promptInputJson);
  const expectedOutput = parseJson(row.expectedOutputJson);
  const judgeFeedback = parseJson(row.judgeFeedbackJson);
  const provenance = parseJson(row.provenanceJson);
  const normalizedStatus = row.status.toUpperCase();

  if (!VALID_STATUSES.includes(normalizedStatus as JudgeExampleStatus)) {
    missing.push('valid status');
  }

  let commentCount = 0;
  let pushbackCount = 0;

  if (!isRecord(promptInput)) {
    missing.push('parseable prompt_input_json');
  } else {
    if (promptInput.task !== EXPECTED_TASK) missing.push('judge replay task');

    const candidateReview = isRecord(promptInput.candidateReview) ? promptInput.candidateReview : null;
    const comments = candidateReview && Array.isArray(candidateReview.comments)
      ? candidateReview.comments
      : [];
    commentCount = comments.length;
    if (commentCount === 0) missing.push('candidate review comments');

    const pushback = Array.isArray(promptInput.aiDeveloperPushback)
      ? promptInput.aiDeveloperPushback
      : [];
    pushbackCount = pushback.length;
    if (pushbackCount === 0) missing.push('AI developer pushback');

    const uses = stringArray(promptInput.improvementUses);
    for (const requiredUse of REQUIRED_IMPROVEMENT_USES) {
      if (!uses.includes(requiredUse)) missing.push(`improvement use: ${requiredUse}`);
    }
  }

  if (!isRecord(provenance)) {
    missing.push('parseable provenance_json');
  } else {
    const sourceTables = stringArray(provenance.sourceTables);
    for (const table of REQUIRED_SOURCE_TABLES) {
      if (!sourceTables.includes(table)) missing.push(`source table: ${table}`);
    }
  }

  const labelled = normalizedStatus === 'LABELLED';
  if (labelled) {
    if (!isRecord(expectedOutput)) missing.push('label expected_output_json');
    if (!isRecord(judgeFeedback)) missing.push('label judge_feedback_json');
    if (isRecord(judgeFeedback)) {
      const labelType = typeof judgeFeedback.labelType === 'string' ? judgeFeedback.labelType : '';
      if (!labelType.includes('score_report')) missing.push('score-report label type');
    }
  }

  const replayable = missing.length === 0 || (
    !missing.includes('valid status')
    && !missing.includes('parseable prompt_input_json')
    && !missing.includes('judge replay task')
    && !missing.includes('candidate review comments')
    && !missing.includes('AI developer pushback')
    && !missing.includes('parseable provenance_json')
    && REQUIRED_IMPROVEMENT_USES.every((requiredUse) => !missing.includes(`improvement use: ${requiredUse}`))
    && REQUIRED_SOURCE_TABLES.every((table) => !missing.includes(`source table: ${table}`))
  );
  const calibrationReady = labelled && replayable && isRecord(expectedOutput) && isRecord(judgeFeedback);

  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    replayable,
    labelled,
    calibrationReady,
    commentCount,
    pushbackCount,
    failureModes: extractFailureModes(promptInput, expectedOutput, judgeFeedback),
    missing: unique(missing),
    updatedAt: row.updatedAt,
  };
}

export function auditCodeReviewJudgeExamples(
  rows: JudgeExampleRow[],
  options: AuditOptions = {},
): JudgeExampleAudit {
  const minReplayable = options.minReplayable ?? 1;
  const minLabelled = options.minLabelled ?? 1;
  const examples = rows.map(auditExample);
  const replayable = examples.filter((example) => example.replayable);
  const calibrationReadyExamples = examples.filter((example) => example.calibrationReady);
  const replayReady = replayable.length >= minReplayable;
  const calibrationReady = calibrationReadyExamples.length >= minLabelled;
  const invalidStatus = rows.filter((row) =>
    !VALID_STATUSES.includes(row.status.toUpperCase() as JudgeExampleStatus)
  ).length;
  const failures: string[] = [];
  const nextActions: string[] = [];

  if (rows.length === 0) {
    failures.push('no code_review_judge_examples rows found');
    nextActions.push('Run a CODE_REVIEW full-submit smoke or backfill completed review sessions into judge examples.');
  }

  if (!replayReady && rows.length > 0) {
    failures.push(`fewer than ${minReplayable} replay-ready judge example(s) are available`);
    nextActions.push('Verify completed sessions include candidate comments, AI developer pushback, improvement uses, and provenance.');
  }

  if (!calibrationReady && rows.length > 0) {
    nextActions.push('Apply recruiter score overrides or human labels until at least one replay-ready example is LABELLED.');
  }

  if (invalidStatus > 0) {
    failures.push('one or more judge examples have an invalid status');
  }

  const status = calibrationReady ? 'calibration_ready' : replayReady ? 'replay_ready' : 'not_ready';

  return {
    status,
    replayReady,
    calibrationReady,
    counts: {
      total: rows.length,
      ready: countStatus(rows, 'READY'),
      labelled: countStatus(rows, 'LABELLED'),
      archived: countStatus(rows, 'ARCHIVED'),
      invalidStatus,
      replayable: replayable.length,
      calibrationReady: calibrationReadyExamples.length,
    },
    failureModes: unique(examples.flatMap((example) => example.failureModes)),
    examples,
    failures,
    nextActions: unique(nextActions),
  };
}

function discoverLocalDatabases(explicitPath?: string): string[] {
  if (explicitPath) return [resolve(apiRoot, explicitPath)];
  const directory = resolve(apiRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
    .map((name) => resolve(directory, name))
    .sort();
}

function openDatabase(path: string): { database: SqliteDatabase; close: () => void } {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const database = new DatabaseSync(path);
  return { database, close: () => database.close?.() };
}

function normalizeRow(row: unknown): JudgeExampleRow | null {
  if (!isRecord(row)) return null;
  const id = typeof row.id === 'string' ? row.id : null;
  const sessionId = typeof row.session_id === 'string' ? row.session_id : null;
  const status = typeof row.status === 'string' ? row.status : null;
  if (!id || !sessionId || !status) return null;
  return {
    id,
    sessionId,
    status,
    promptInputJson: typeof row.prompt_input_json === 'string' ? row.prompt_input_json : null,
    expectedOutputJson: typeof row.expected_output_json === 'string' ? row.expected_output_json : null,
    judgeFeedbackJson: typeof row.judge_feedback_json === 'string' ? row.judge_feedback_json : null,
    provenanceJson: typeof row.provenance_json === 'string' ? row.provenance_json : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

function loadRows(database: SqliteDatabase, limit: number): JudgeExampleRow[] {
  const statement = database.prepare(`
    SELECT id,
           session_id,
           status,
           prompt_input_json,
           expected_output_json,
           judge_feedback_json,
           provenance_json,
           updated_at
      FROM code_review_judge_examples
     ORDER BY updated_at DESC
     LIMIT ?
  `);
  return statement.all(limit).flatMap((row) => {
    const normalized = normalizeRow(row);
    return normalized ? [normalized] : [];
  });
}

export async function loadRemoteRows(client: RemoteQueryClient, limit: number): Promise<JudgeExampleRow[]> {
  const rows = await client.query(`
    SELECT id,
           session_id,
           status,
           prompt_input_json,
           expected_output_json,
           judge_feedback_json,
           provenance_json,
           updated_at
      FROM code_review_judge_examples
     ORDER BY updated_at DESC
     LIMIT ?1
  `, [limit]);
  return rows.flatMap((row) => {
    const normalized = normalizeRow(row);
    return normalized ? [normalized] : [];
  });
}

export interface DatabaseJudgeExampleAudit {
  databasePath: string;
  audit: JudgeExampleAudit;
}

async function auditDatabase(path: string, limit: number): Promise<DatabaseJudgeExampleAudit> {
  const { database, close } = openDatabase(path);
  try {
    let rows: JudgeExampleRow[] = [];
    let loadFailure: string | null = null;
    try {
      rows = loadRows(database, limit);
    } catch (error) {
      loadFailure = error instanceof Error ? error.message : String(error);
    }
    const audit = auditCodeReviewJudgeExamples(rows);
    if (loadFailure) {
      audit.failures.push(`failed to read code_review_judge_examples: ${loadFailure}`);
      audit.nextActions.push('Apply migration 0100_code_review_judge_examples.sql to this D1 database.');
    }
    return {
      databasePath: path,
      audit,
    };
  } finally {
    close();
  }
}

async function auditRemoteDatabase(databaseId: string, limit: number): Promise<DatabaseJudgeExampleAudit> {
  if (!databaseId) {
    throw new Error(
      'Missing D1 database id; pass --database-id or set CODE_REVIEW_JUDGE_EXAMPLES_D1_DATABASE_ID, '
      + 'MATCHING_EVALUATION_D1_DATABASE_ID, or CLOUDFLARE_D1_DATABASE_ID.',
    );
  }

  const client = createRemoteQueryClient(databaseId);
  let rows: JudgeExampleRow[] = [];
  let loadFailure: string | null = null;
  try {
    rows = await loadRemoteRows(client, limit);
  } catch (error) {
    loadFailure = error instanceof Error ? error.message : String(error);
  }
  const audit = auditCodeReviewJudgeExamples(rows);
  if (loadFailure) {
    audit.failures.push(`failed to read remote code_review_judge_examples: ${loadFailure}`);
    audit.nextActions.push('Apply migration 0100_code_review_judge_examples.sql to this remote D1 database.');
  }
  return {
    databasePath: `remote:${databaseId}`,
    audit,
  };
}

function printHuman(results: DatabaseJudgeExampleAudit[]): void {
  console.log('CODE_REVIEW judge example proof');
  if (results.length === 0) {
    console.log('  status: no D1 databases found');
    return;
  }
  for (const result of results) {
    const audit = result.audit;
    console.log('');
    console.log(`  ${result.databasePath}`);
    console.log(`    status:              ${audit.status}`);
    console.log(`    replay ready:        ${audit.replayReady ? 'YES' : 'NO'}`);
    console.log(`    calibration ready:   ${audit.calibrationReady ? 'YES' : 'NO'}`);
    console.log(`    examples:            ${audit.counts.total}`);
    console.log(`    READY/LABELLED:      ${audit.counts.ready}/${audit.counts.labelled}`);
    console.log(`    replayable:          ${audit.counts.replayable}`);
    console.log(`    calibration-ready:   ${audit.counts.calibrationReady}`);
    if (audit.failureModes.length > 0) {
      console.log(`    failure modes:       ${audit.failureModes.join(', ')}`);
    }
    for (const example of audit.examples.slice(0, 5)) {
      console.log(
        `    example:             ${example.id} ${example.status} comments=${example.commentCount} pushback=${example.pushbackCount}`
        + `${example.calibrationReady ? ' calibration-ready' : example.replayable ? ' replayable' : ' incomplete'}`,
      );
      if (example.missing.length > 0) {
        console.log(`      missing:           ${example.missing.join(', ')}`);
      }
    }
    if (audit.failures.length > 0) {
      console.log('    failures:');
      for (const failure of audit.failures) console.log(`      - ${failure}`);
    }
    if (audit.nextActions.length > 0) {
      console.log('    next actions:');
      for (const action of audit.nextActions) console.log(`      - ${action}`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const results = options.remote
    ? [await auditRemoteDatabase(resolveRemoteDatabaseId(options), options.limit)]
    : await Promise.all(discoverLocalDatabases(options.databasePath).map((path) => auditDatabase(path, options.limit)));

  if (options.json) {
    console.log(JSON.stringify({ databases: results }, null, 2));
  } else {
    printHuman(results);
  }

  if (
    options.requireReplayReady
    && !results.some((result) => result.audit.replayReady)
  ) {
    process.exitCode = 1;
  }
  if (
    options.requireCalibration
    && !results.some((result) => result.audit.calibrationReady)
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('verifyCodeReviewJudgeExamples.ts')) {
  main().catch((err) => {
    console.error('[verifyCodeReviewJudgeExamples] Fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
