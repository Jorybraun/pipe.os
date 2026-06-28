#!/usr/bin/env tsx
/**
 * Backfill legacy candidates, contacts, and candidate nodes into the living
 * context graph. All writes use the runtime compatibility functions, whose
 * deterministic ingestion keys make reruns idempotent.
 *
 * Local:
 *   npx tsx scripts/backfillLivingContext.ts --local --dry-run
 *   npx tsx scripts/backfillLivingContext.ts --local --batch-size 100
 *
 * Remote (loads Cloudflare credentials from .dev.vars):
 *   npx tsx scripts/backfillLivingContext.ts --remote --dry-run
 *   npx tsx scripts/backfillLivingContext.ts --remote --batch-size 50
 *
 * Required remote env vars:
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_D1_DATABASE_ID
 */

import dotenv from 'dotenv';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CandidateNode } from '../src/types';
import type { CultureTranscript } from '../src/lib/cultureAgent';
import { createCultureAgentProvider } from '../src/lib/llm/createProvider';
import type { ProviderEnv, ProviderName } from '../src/lib/llm/createProvider';
import {
  ensureCandidateLivingContext,
  ensureContactLivingContext,
  ingestCodeReviewScoreReportToLivingContext,
  ingestCodeReviewTranscriptToLivingContext,
  ingestHistoricalCultureTranscript,
  ingestMeetingTranscriptToLivingContext,
  ingestPhoneCallToLivingContext,
  ingestPhoneRecruiterNote,
  mirrorCandidateNodeToLivingContext,
  parseStoredMeetingTranscript,
  type CodeReviewTranscript,
} from '../src/lib/livingContext';
import {
  OPEN_TERM_RESOLVER_VERSION,
  openSemanticTermRecord,
  type OpenSemanticTermRecord,
} from '../src/lib/livingContext/openTerms';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3') as new (path: string) => SqliteDatabase;
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

type SqlValue = string | number | null;
type EntityKind =
  | 'candidates'
  | 'contacts'
  | 'candidateNodes'
  | 'meetings'
  | 'cultureSessions'
  | 'phoneCalls'
  | 'codeReviewSessions';

interface SqliteStatement {
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

export interface Options {
  target: 'local' | 'remote';
  databasePath?: string;
  batchSize: number;
  limit?: number;
  dryRun: boolean;
  extractCultureSemantics: boolean;
  cultureProvider?: ProviderName;
}

interface IdRow {
  id: string;
}

interface MeetingTranscriptRow {
  id: string;
  owner_id: string;
  transcript_json: string;
  transcript_summary: string | null;
  recording_r2_key: string | null;
  started_at: string | null;
  ended_at: string | null;
}

interface CultureSessionRow {
  id: string;
  candidate_id: string;
  transcript: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

interface PhoneCallBackfillRow {
  id: string;
  candidate_id: string;
  owner_id: string;
  direction: string;
  twilio_call_sid: string | null;
  duration_seconds: number | null;
  recording_s3_key: string | null;
  transcription: string | null;
  transcription_status: string | null;
  recruiter_notes: string | null;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
}

interface CodeReviewSessionBackfillRow {
  id: string;
  candidate_id: string;
  challenge_id: string;
  assessment_id: string;
  implementer_persona: string;
  status: string;
  transcript: string | null;
  score_report: string | null;
  created_at: string;
  updated_at: string;
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

export interface D1Like {
  prepare(sql: string): PreparedStatementLike;
}

export interface EntityStats {
  discovered: number;
  processed: number;
  skipped: number;
  failed: number;
  partial: number;
}

interface BackfillStats {
  candidates: EntityStats;
  contacts: EntityStats;
  candidateNodes: EntityStats;
  meetings: EntityStats;
  cultureSessions: EntityStats;
  phoneCalls: EntityStats;
  codeReviewSessions: EntityStats;
}

export function emptyEntityStats(): EntityStats {
  return { discovered: 0, processed: 0, skipped: 0, failed: 0, partial: 0 };
}

function parsePositiveInteger(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function printHelp(): void {
  console.log(`Usage:
  npx tsx scripts/backfillLivingContext.ts [--local|--remote] [options]

Options:
  --local                 Use the local Wrangler SQLite database (default)
  --remote                Use Cloudflare D1 through the existing REST client
  --database-path <path>  Override local SQLite discovery
  --batch-size <n>        Rows fetched per keyset page (default: 100)
  --limit <n>             Maximum rows processed per entity type
  --extract-culture-semantics
                          Re-extract open semantics for historical culture turns
                          that do not contain a persisted decomposition
  --culture-provider <name>
                          Provider for offline extraction:
                          cloudflare-ai | vertex-ai | google-ai | kimi
  --dry-run               Count eligible rows without writing
  --help                  Show this help

Apply migrations 0082_living_context_graph.sql and
0091_transcript_semantic_projections.sql before running this script.`);
}

function parseArgs(argv: string[]): Options {
  let target: Options['target'] = 'local';
  let targetWasExplicit = false;
  let databasePath: string | undefined;
  let batchSize = 100;
  let limit: number | undefined;
  let dryRun = false;
  let extractCultureSemantics = false;
  let cultureProvider: ProviderName | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--local' || arg === '--remote') {
      const nextTarget = arg.slice(2) as Options['target'];
      if (targetWasExplicit && target !== nextTarget) {
        throw new Error('--local and --remote are mutually exclusive');
      }
      target = nextTarget;
      targetWasExplicit = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--extract-culture-semantics') {
      extractCultureSemantics = true;
      continue;
    }
    if (arg === '--culture-provider') {
      const value = argv[++index];
      if (
        value !== 'cloudflare-ai'
        && value !== 'vertex-ai'
        && value !== 'google-ai'
        && value !== 'kimi'
      ) {
        throw new Error('--culture-provider must name a supported provider');
      }
      cultureProvider = value;
      continue;
    }
    if (arg.startsWith('--culture-provider=')) {
      const value = arg.slice('--culture-provider='.length);
      if (
        value !== 'cloudflare-ai'
        && value !== 'vertex-ai'
        && value !== 'google-ai'
        && value !== 'kimi'
      ) {
        throw new Error('--culture-provider must name a supported provider');
      }
      cultureProvider = value;
      continue;
    }
    if (arg === '--database-path') {
      databasePath = argv[++index];
      if (!databasePath) throw new Error('--database-path requires a value');
      continue;
    }
    if (arg.startsWith('--database-path=')) {
      databasePath = arg.slice('--database-path='.length);
      continue;
    }
    if (arg === '--batch-size') {
      batchSize = parsePositiveInteger('--batch-size', argv[++index]);
      continue;
    }
    if (arg.startsWith('--batch-size=')) {
      batchSize = parsePositiveInteger('--batch-size', arg.slice('--batch-size='.length));
      continue;
    }
    if (arg === '--limit') {
      limit = parsePositiveInteger('--limit', argv[++index]);
      continue;
    }
    if (arg.startsWith('--limit=')) {
      limit = parsePositiveInteger('--limit', arg.slice('--limit='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (target === 'remote' && databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  return {
    target,
    databasePath,
    batchSize,
    limit,
    dryRun,
    extractCultureSemantics,
    cultureProvider,
  };
}

function rewriteNumberedParams(
  sql: string,
  params: SqlValue[],
): { sql: string; args: SqlValue[] } {
  const numbered = /\?(\d+)/g;
  let match = numbered.exec(sql);
  if (!match) return { sql, args: params };

  const args: SqlValue[] = [];
  let rewritten = '';
  let lastIndex = 0;

  numbered.lastIndex = 0;
  while ((match = numbered.exec(sql)) !== null) {
    rewritten += sql.slice(lastIndex, match.index) + '?';
    const paramIndex = Number.parseInt(match[1]!, 10) - 1;
    args.push(params[paramIndex] ?? null);
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
    const { sql, args } = rewriteNumberedParams(this.sql, this.values);
    return (this.database.prepare(sql).get(...args) as T | undefined) ?? null;
  }

  async all<T>(): Promise<QueryResult<T>> {
    const { sql, args } = rewriteNumberedParams(this.sql, this.values);
    return {
      results: this.database.prepare(sql).all(...args) as T[],
      success: true,
    };
  }

  async run(): Promise<QueryResult<never>> {
    const { sql, args } = rewriteNumberedParams(this.sql, this.values);
    this.database.prepare(sql).run(...args);
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

  async all<T>(): Promise<QueryResult<T>> {
    return { results: await this.client.query<T>(this.sql, this.values), success: true };
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
  if (candidates.length === 0) {
    throw new Error(
      'No local D1 SQLite database found. Run Wrangler once or pass --database-path.',
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Multiple local D1 databases found; pass --database-path. Found: ${candidates.join(', ')}`,
    );
  }
  return candidates[0]!;
}

async function fetchIdPage(
  db: D1Like,
  table: 'candidates' | 'contacts',
  afterId: string,
  pageSize: number,
): Promise<IdRow[]> {
  const result = await db.prepare(
    `SELECT id FROM ${table} WHERE id > ?1 ORDER BY id LIMIT ?2`,
  ).bind(afterId, pageSize).all<IdRow>();
  return result.results;
}

async function fetchCandidateNodePage(
  db: D1Like,
  afterId: string,
  pageSize: number,
): Promise<CandidateNode[]> {
  const result = await db.prepare(
    `SELECT id, candidate_id, node_type, narrative_text,
            extracted_properties_json, embedding_json, source_type,
            source_reference, captured_at, confidence, supersedes,
            superseded_at, decomposition_version, created_at, updated_at
      FROM candidate_nodes
      WHERE id > ?1
        AND superseded_at IS NULL
      ORDER BY id
      LIMIT ?2`,
  ).bind(afterId, pageSize).all<CandidateNode>();
  return result.results;
}

function upgradeLegacyCandidateNodeSemanticTerms(node: CandidateNode): {
  node: CandidateNode;
  upgraded: boolean;
} {
  if (!node.extracted_properties_json) return { node, upgraded: false };
  try {
    const properties = JSON.parse(node.extracted_properties_json) as Record<string, unknown> & {
      semantic_terms?: unknown;
      skills_demonstrated?: unknown;
      name?: unknown;
    };
    if (Array.isArray(properties.semantic_terms) && properties.semantic_terms.length > 0) {
      return { node, upgraded: false };
    }

    const terms = new Map<string, OpenSemanticTermRecord & { resolver: string }>();
    const add = (surface: string, evidenceLevel: string): void => {
      const term = openSemanticTermRecord(surface, evidenceLevel);
      if (term) {
        terms.set(term.canonical_key, {
          ...term,
          resolver: OPEN_TERM_RESOLVER_VERSION,
        });
      }
    };
    if (Array.isArray(properties.skills_demonstrated)) {
      for (const surface of properties.skills_demonstrated) {
        if (typeof surface === 'string') add(surface, 'demonstrated');
      }
    }
    if (
      terms.size === 0
      && node.node_type.toLowerCase() === 'skill'
      && typeof properties.name === 'string'
    ) {
      add(properties.name, 'mentioned');
    }
    if (terms.size === 0) return { node, upgraded: false };

    return {
      node: {
        ...node,
        extracted_properties_json: JSON.stringify({
          ...properties,
          semantic_terms: [...terms.values()],
        }),
      },
      upgraded: true,
    };
  } catch {
    return { node, upgraded: false };
  }
}

async function fetchMeetingPage(
  db: D1Like,
  afterId: string,
  pageSize: number,
): Promise<MeetingTranscriptRow[]> {
  const result = await db.prepare(
    `SELECT id, owner_id, transcript_json, transcript_summary,
            recording_r2_key, started_at, ended_at
       FROM meetings
      WHERE id > ?1
        AND transcript_status = 'READY'
        AND transcript_json IS NOT NULL
      ORDER BY id
      LIMIT ?2`,
  ).bind(afterId, pageSize).all<MeetingTranscriptRow>();
  return result.results;
}

async function fetchCultureSessionPage(
  db: D1Like,
  afterId: string,
  pageSize: number,
): Promise<CultureSessionRow[]> {
  const result = await db.prepare(
    `SELECT id, candidate_id, transcript, started_at, completed_at, updated_at
       FROM culture_interview_sessions
      WHERE id > ?1
        AND transcript IS NOT NULL
      ORDER BY id
      LIMIT ?2`,
  ).bind(afterId, pageSize).all<CultureSessionRow>();
  return result.results;
}

async function fetchPhoneCallPage(
  db: D1Like,
  afterId: string,
  pageSize: number,
): Promise<PhoneCallBackfillRow[]> {
  const result = await db.prepare(
    `SELECT id, candidate_id, owner_id, direction, twilio_call_sid,
            duration_seconds, recording_s3_key, transcription,
            transcription_status, recruiter_notes, started_at, ended_at,
            updated_at
       FROM phone_calls
      WHERE id > ?1
      ORDER BY id
      LIMIT ?2`,
  ).bind(afterId, pageSize).all<PhoneCallBackfillRow>();
  return result.results;
}

async function fetchCodeReviewSessionPage(
  db: D1Like,
  afterId: string,
  pageSize: number,
): Promise<CodeReviewSessionBackfillRow[]> {
  const result = await db.prepare(
    `SELECT id, candidate_id, challenge_id, assessment_id,
            implementer_persona, status, transcript, score_report,
            created_at, updated_at
       FROM review_sessions
      WHERE id > ?1
      ORDER BY id
      LIMIT ?2`,
  ).bind(afterId, pageSize).all<CodeReviewSessionBackfillRow>();
  return result.results;
}

function pageSize(options: Options, stats: EntityStats): number {
  if (options.limit === undefined) return options.batchSize;
  return Math.min(options.batchSize, options.limit - stats.discovered);
}

function shouldContinue(options: Options, stats: EntityStats): boolean {
  return options.limit === undefined || stats.discovered < options.limit;
}

function reportFailure(kind: EntityKind, id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[living-context] ${kind} ${id} failed: ${message}`);
}

async function backfillIdentities(
  db: D1Like,
  kind: 'candidates' | 'contacts',
  options: Options,
  stats: EntityStats,
): Promise<void> {
  let afterId = '';
  while (shouldContinue(options, stats)) {
    const rows = await fetchIdPage(db, kind, afterId, pageSize(options, stats));
    if (rows.length === 0) break;
    stats.discovered += rows.length;

    if (!options.dryRun) {
      for (const row of rows) {
        try {
          const result = kind === 'candidates'
            ? await ensureCandidateLivingContext(db as unknown as D1Database, row.id)
            : await ensureContactLivingContext(db as unknown as D1Database, row.id);
          if (result) stats.processed++;
          else stats.skipped++;
        } catch (error) {
          stats.failed++;
          reportFailure(kind, row.id, error);
        }
      }
    }

    afterId = rows.at(-1)!.id;
    console.log(
      `[living-context] ${kind}: discovered=${stats.discovered} processed=${stats.processed} failed=${stats.failed}`,
    );
  }
}

async function backfillCandidateNodes(
  db: D1Like,
  options: Options,
  stats: EntityStats,
): Promise<number> {
  let afterId = '';
  let semanticTermUpgrades = 0;
  while (shouldContinue(options, stats)) {
    const rows = await fetchCandidateNodePage(db, afterId, pageSize(options, stats));
    if (rows.length === 0) break;
    stats.discovered += rows.length;

    if (!options.dryRun) {
      for (const row of rows) {
        try {
          const upgraded = upgradeLegacyCandidateNodeSemanticTerms(row);
          if (upgraded.upgraded) {
            await db.prepare(
              `UPDATE candidate_nodes
                  SET extracted_properties_json = ?1,
                      updated_at = unixepoch()
                WHERE id = ?2`,
            ).bind(upgraded.node.extracted_properties_json, row.id).run();
            semanticTermUpgrades++;
          }
          await mirrorCandidateNodeToLivingContext(
            db as unknown as D1Database,
            upgraded.node,
          );
          stats.processed++;
        } catch (error) {
          stats.failed++;
          reportFailure('candidateNodes', row.id, error);
        }
      }
    }

    afterId = rows.at(-1)!.id;
    console.log(
      `[living-context] candidateNodes: discovered=${stats.discovered} processed=${stats.processed} failed=${stats.failed}`,
    );
  }
  return semanticTermUpgrades;
}

async function backfillMeetings(
  db: D1Like,
  options: Options,
  stats: EntityStats,
): Promise<void> {
  let afterId = '';
  while (shouldContinue(options, stats)) {
    const rows = await fetchMeetingPage(db, afterId, pageSize(options, stats));
    if (rows.length === 0) break;
    stats.discovered += rows.length;

    if (!options.dryRun) {
      for (const row of rows) {
        try {
          const transcript = parseStoredMeetingTranscript(row.transcript_json);
          await ingestMeetingTranscriptToLivingContext(db as unknown as D1Database, {
            meetingId: row.id,
            ownerId: row.owner_id,
            transcript: transcript.transcript,
            segments: transcript.segments,
            summary: row.transcript_summary,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            recordingKey: row.recording_r2_key,
            provider: 'historical-meeting-transcript',
          });
          stats.processed++;
        } catch (error) {
          stats.failed++;
          reportFailure('meetings', row.id, error);
        }
      }
    }

    afterId = rows.at(-1)!.id;
    console.log(
      `[living-context] meetings: discovered=${stats.discovered} processed=${stats.processed} failed=${stats.failed}`,
    );
  }
}

async function backfillCultureSessions(
  db: D1Like,
  options: Options,
  stats: EntityStats,
  provider: ReturnType<typeof createCultureAgentProvider>,
): Promise<void> {
  let afterId = '';
  while (shouldContinue(options, stats)) {
    const rows = await fetchCultureSessionPage(db, afterId, pageSize(options, stats));
    if (rows.length === 0) break;
    stats.discovered += rows.length;

    if (!options.dryRun) {
      for (const row of rows) {
        try {
          const transcript = JSON.parse(row.transcript) as CultureTranscript;
          const result = await ingestHistoricalCultureTranscript(
            db as unknown as D1Database,
            {
              candidateId: row.candidate_id,
              sessionId: row.id,
              transcript,
              provider,
              extractSemantics: options.extractCultureSemantics,
              fallbackObservedAt: row.updated_at,
              sessionStartedAt: row.started_at,
              sessionEndedAt: row.completed_at,
            },
          );
          stats.processed++;
          if (result.extractionFailures > 0) stats.partial++;
          console.log(JSON.stringify({
            event: 'livingContextBackfill.cultureSession',
            sessionId: row.id,
            candidateId: row.candidate_id,
            ...result,
          }));
        } catch (error) {
          stats.failed++;
          reportFailure('cultureSessions', row.id, error);
        }
      }
    }

    afterId = rows.at(-1)!.id;
    console.log(
      `[living-context] cultureSessions: discovered=${stats.discovered} processed=${stats.processed} failed=${stats.failed}`,
    );
  }
}

async function backfillPhoneCalls(
  db: D1Like,
  options: Options,
  stats: EntityStats,
): Promise<void> {
  let afterId = '';
  while (shouldContinue(options, stats)) {
    const rows = await fetchPhoneCallPage(db, afterId, pageSize(options, stats));
    if (rows.length === 0) break;
    stats.discovered += rows.length;

    if (!options.dryRun) {
      for (const row of rows) {
        try {
          await ingestPhoneCallToLivingContext(db as unknown as D1Database, {
            callId: row.id,
            candidateId: row.candidate_id,
            direction: row.direction,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            twilioCallSid: row.twilio_call_sid,
            recording: row.recording_s3_key
              ? {
                  storageKey: row.recording_s3_key,
                  durationSeconds: row.duration_seconds,
                }
              : null,
            transcript: row.transcription,
            transcriptProvider: row.transcription_status === 'COMPLETED'
              ? 'historical-phone-transcript'
              : null,
          });
          if (row.recruiter_notes !== null) {
            await ingestPhoneRecruiterNote(db as unknown as D1Database, {
              callId: row.id,
              candidateId: row.candidate_id,
              direction: row.direction,
              note: row.recruiter_notes,
              observedAt: row.updated_at,
              recruiterActorId: row.owner_id,
              startedAt: row.started_at,
              endedAt: row.ended_at,
            });
          }
          stats.processed++;
        } catch (error) {
          stats.failed++;
          reportFailure('phoneCalls', row.id, error);
        }
      }
    }

    afterId = rows.at(-1)!.id;
    console.log(
      `[living-context] phoneCalls: discovered=${stats.discovered} processed=${stats.processed} failed=${stats.failed}`,
    );
  }
}

export async function backfillCodeReviewSessions(
  db: D1Like,
  options: Options,
  stats: EntityStats,
): Promise<void> {
  let afterId = '';
  while (shouldContinue(options, stats)) {
    const rows = await fetchCodeReviewSessionPage(db, afterId, pageSize(options, stats));
    if (rows.length === 0) break;
    stats.discovered += rows.length;

    if (!options.dryRun) {
      for (const row of rows) {
        try {
          const transcript = row.transcript
            ? JSON.parse(row.transcript) as CodeReviewTranscript
            : { rounds: [] };
          await ingestCodeReviewTranscriptToLivingContext(
            db as unknown as D1Database,
            {
              sessionId: row.id,
              candidateId: row.candidate_id,
              challengeId: row.challenge_id,
              assessmentId: row.assessment_id,
              transcript,
              status: row.status,
              implementerPersona: row.implementer_persona,
              startedAt: row.created_at,
              endedAt: ['verdict_submitted', 'scoring', 'scored'].includes(row.status)
                ? row.updated_at
                : null,
              observedAt: row.updated_at,
            },
          );
          if (row.score_report) {
            await ingestCodeReviewScoreReportToLivingContext(
              db as unknown as D1Database,
              {
                sessionId: row.id,
                candidateId: row.candidate_id,
                challengeId: row.challenge_id,
                assessmentId: row.assessment_id,
                scoreReportJson: row.score_report,
                observedAt: row.updated_at,
                producer: 'automated_scorer',
                startedAt: row.created_at,
              },
            );
          }
          await db.prepare(
            `UPDATE candidate_nodes
                SET superseded_at = COALESCE(superseded_at, ?1),
                    updated_at = ?1
              WHERE source_type = 'code_review_session'
                AND source_reference = ?2
                AND decomposition_version = 'code_review_v1'`,
          ).bind(row.updated_at, row.id).run();
          stats.processed++;
        } catch (error) {
          stats.failed++;
          reportFailure('codeReviewSessions', row.id, error);
        }
      }
    }

    afterId = rows.at(-1)!.id;
    console.log(
      `[living-context] codeReviewSessions: discovered=${stats.discovered} processed=${stats.processed} failed=${stats.failed}`,
    );
  }
}

async function verifySchema(db: D1Like): Promise<void> {
  const requiredTables = [
    'candidates',
    'contacts',
    'candidate_nodes',
    'meetings',
    'culture_interview_sessions',
    'phone_calls',
    'review_sessions',
    'meeting_participants',
    'people',
    'workspace_people',
    'applications',
    'person_roles',
    'interactions',
    'artifacts',
    'artifact_versions',
    'source_spans',
    'episodes',
    'semantic_assertions',
    'assertion_source_spans',
    'signal_evidence',
    'projection_outbox',
    'artifact_interactions',
    'source_span_attributions',
    'semantic_projection_runs',
  ];
  for (const table of requiredTables) {
    const row = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
    ).bind(table).first<{ name: string }>();
    if (!row) {
      throw new Error(
        `Required table "${table}" is missing. Apply the living-context migrations first.`,
      );
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let localDatabase: SqliteDatabase | undefined;
  let db: D1Like;

  if (options.target === 'remote') {
    db = new RemoteD1(new D1Client(loadD1Config()));
    console.log('[living-context] target=remote');
  } else {
    const databasePath = discoverLocalDatabase(options.databasePath);
    localDatabase = new BetterSqlite3(databasePath);
    localDatabase.exec('PRAGMA foreign_keys = ON');
    db = new LocalD1(localDatabase);
    console.log(`[living-context] target=local database=${databasePath}`);
  }

  try {
    await verifySchema(db);
    const providerEnv: ProviderEnv = {
      ...(process.env as ProviderEnv),
      ...(options.cultureProvider
        ? { CULTURE_AGENT_PROVIDER: options.cultureProvider }
        : {}),
    };
    const provider = options.extractCultureSemantics
      ? createCultureAgentProvider(providerEnv)
      : null;
    if (options.extractCultureSemantics && !provider) {
      throw new Error(
        'Culture semantic extraction was requested, but no configured provider is available.',
      );
    }
    const stats: BackfillStats = {
      candidates: emptyEntityStats(),
      contacts: emptyEntityStats(),
      candidateNodes: emptyEntityStats(),
      meetings: emptyEntityStats(),
      cultureSessions: emptyEntityStats(),
      phoneCalls: emptyEntityStats(),
      codeReviewSessions: emptyEntityStats(),
    };

    await backfillIdentities(db, 'candidates', options, stats.candidates);
    await backfillIdentities(db, 'contacts', options, stats.contacts);
    await backfillCultureSessions(
      db,
      options,
      stats.cultureSessions,
      provider,
    );
    await backfillPhoneCalls(db, options, stats.phoneCalls);
    await backfillCodeReviewSessions(db, options, stats.codeReviewSessions);
    const candidateSemanticTermUpgrades = await backfillCandidateNodes(
      db,
      options,
      stats.candidateNodes,
    );
    await backfillMeetings(db, options, stats.meetings);

    const failed = Object.values(stats).reduce((sum, entry) => sum + entry.failed, 0);
    const partial = Object.values(stats).reduce((sum, entry) => sum + entry.partial, 0);
    console.log(JSON.stringify({
      event: 'livingContextBackfill.complete',
      target: options.target,
      dryRun: options.dryRun,
      batchSize: options.batchSize,
      limitPerEntity: options.limit ?? null,
      stats,
      candidateSemanticTermUpgrades,
      failed,
      partial,
    }, null, 2));

    if (failed > 0 || partial > 0) process.exitCode = 1;
  } finally {
    localDatabase?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      '[living-context] fatal:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
