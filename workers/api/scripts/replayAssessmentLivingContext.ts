#!/usr/bin/env tsx
/**
 * Replay one assessment session into the living-context graph.
 *
 * Remote:
 *   CLOUDFLARE_D1_DATABASE_ID=<dev-db-id> npm run assessment-evidence:replay -- --remote --session-id <assessment_session_id>
 *   CLOUDFLARE_D1_DATABASE_ID=<dev-db-id> npm run assessment-evidence:replay -- --remote --all-missing --limit 25
 *   CLOUDFLARE_D1_DATABASE_ID=<dev-db-id> npm run assessment-evidence:replay -- --remote --all-missing --limit 25 --summary
 *   CLOUDFLARE_D1_DATABASE_ID=<dev-db-id> npm run assessment-evidence:replay -- --remote --all-missing --limit 25 --summary --progress --exclude-state IN_PROGRESS
 *
 * The replay uses the same production ingestion path as real-time assessment
 * evaluation and scheduled backfill. Ingestion keys make reruns idempotent.
 */

import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestAssessmentSessionRealTime } from '../src/lib/livingContext/assessmentIngestion';
import { recordAssessmentCandidateProfileEvidence } from '../src/lib/assessmentLayer/candidateProfileEvidence';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const repoRoot = resolve(apiRoot, '..', '..');
dotenv.config({ path: resolve(repoRoot, '.env.local'), quiet: true });
dotenv.config({ path: resolve(repoRoot, '.env'), quiet: true });
dotenv.config({ path: resolve(apiRoot, '.dev.vars'), quiet: true });

type SqlValue = string | number | null;

interface D1StatementResult<T> {
  results: T[];
  success: true;
}

class RemoteD1Statement {
  private values: SqlValue[] = [];

  constructor(
    private readonly client: D1Client,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): RemoteD1Statement {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const rows = await this.client.query<T>(this.sql, this.values);
    return rows[0] ?? null;
  }

  async all<T>(): Promise<D1StatementResult<T>> {
    const rows = await this.client.query<T>(this.sql, this.values);
    return { results: rows, success: true };
  }

  async run(): Promise<D1StatementResult<never>> {
    await this.client.query<never>(this.sql, this.values);
    return { results: [], success: true };
  }
}

class RemoteD1 {
  constructor(private readonly client: D1Client) {}

  prepare(sql: string): RemoteD1Statement {
    return new RemoteD1Statement(this.client, sql);
  }
}

interface ReplayOptions {
  target: 'remote';
  sessionId?: string;
  allMissing: boolean;
  limit: number;
  json: boolean;
  summary: boolean;
  progress: boolean;
  excludeStates: string[];
}

interface CountRow {
  count: number;
}

interface ProofRow {
  interaction_id: string;
  interaction_type: string;
  context_record_count: number;
  source_ref_count: number;
  evaluation_report_record_count: number;
}

interface MatchRunProofRow {
  id: string;
  status: string;
  selected_packet_id: string | null;
  created_at: number;
}

interface CandidateIdRow {
  candidate_id: string | null;
}

interface EventKindActorRow {
  kind: string;
  actor_type: string;
  count: number;
}

interface SourceProofTypeRow {
  source_ref_type: string;
  count: number;
}

interface DerivedClaimRow {
  polarity: string;
  dimension: string;
  count: number;
}

interface MissingReplayTarget {
  sessionId: string;
  state: string;
  missingEventCount: number;
}

type ReplayResult = Awaited<ReturnType<typeof replaySession>>;

function parseArgs(argv: string[]): ReplayOptions {
  let target: ReplayOptions['target'] | null = null;
  let sessionId: string | undefined;
  let allMissing = false;
  let limit = 25;
  let json = false;
  let summary = false;
  let progress = false;
  const excludeStates: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--remote') {
      target = 'remote';
    } else if (arg === '--session-id') {
      sessionId = argv[++index] ?? '';
    } else if (arg === '--all-missing') {
      allMissing = true;
    } else if (arg === '--limit') {
      limit = Number(argv[++index] ?? '');
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--summary') {
      summary = true;
    } else if (arg === '--progress') {
      progress = true;
    } else if (arg === '--exclude-state' || arg.startsWith('--exclude-state=')) {
      const inline = arg.match(/^--exclude-state=(.+)$/)?.[1];
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--exclude-state requires a value');
      excludeStates.push(value.toUpperCase());
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (target !== 'remote') {
    throw new Error('Only --remote is currently supported for assessment evidence replay.');
  }
  if (!sessionId && !allMissing) {
    throw new Error('Pass --session-id <assessment_session_id> or --all-missing.');
  }
  if (sessionId && allMissing) {
    throw new Error('Pass either --session-id or --all-missing, not both.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('--limit must be an integer from 1 to 500.');
  }

  if (!allMissing && excludeStates.length > 0) {
    throw new Error('--exclude-state can only be used with --all-missing.');
  }

  return { target, sessionId, allMissing, limit, json, summary, progress, excludeStates };
}

async function count(db: D1Database, sql: string, value: string): Promise<number> {
  const row = await db.prepare(sql).bind(value).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function loadProof(db: D1Database, sessionId: string): Promise<ProofRow | null> {
  return db.prepare(
    `SELECT i.id AS interaction_id,
            i.interaction_type,
            COUNT(DISTINCT cr.id) AS context_record_count,
            COUNT(DISTINCT crsr.context_record_id || ':' || crsr.source_ref_type || ':' || crsr.source_ref_id || ':' || crsr.evidence_role) AS source_ref_count,
            COUNT(DISTINCT CASE
              WHEN cre.entity_type = 'assessment_evaluation_report' THEN cr.id
              ELSE NULL
            END) AS evaluation_report_record_count
       FROM interactions i
       LEFT JOIN context_records cr ON cr.interaction_id = i.id
       LEFT JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
       LEFT JOIN context_record_entities cre ON cre.context_record_id = cr.id
      WHERE i.external_reference = ?1
        AND i.interaction_type LIKE 'assessment:%'
      GROUP BY i.id, i.interaction_type
      LIMIT 1`,
  ).bind(sessionId).first<ProofRow>();
}

async function resolveSessionCandidateId(db: D1Database, sessionId: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT COALESCE(ass.candidate_id, si.candidate_id) AS candidate_id
       FROM assessment_sessions ass
       LEFT JOIN scheduled_interviews si ON si.id = ass.interview_id
      WHERE ass.id = ?1
      LIMIT 1`,
  ).bind(sessionId).first<CandidateIdRow>();
  return row?.candidate_id ?? null;
}

async function loadMatchingEffects(db: D1Database, candidateId: string | null): Promise<{
  candidateId: string | null;
  matchRunCount: number;
  latestMatchRuns: MatchRunProofRow[];
}> {
  if (!candidateId) return { candidateId: null, matchRunCount: 0, latestMatchRuns: [] };
  const rows = await db.prepare(
    `SELECT id, status, selected_packet_id, created_at
       FROM match_runs
      WHERE candidate_id = ?1
      ORDER BY created_at DESC
      LIMIT 5`,
  ).bind(candidateId).all<MatchRunProofRow>();
  return {
    candidateId,
    matchRunCount: (rows.results ?? []).length,
    latestMatchRuns: rows.results ?? [],
  };
}

async function loadAnswerSummary(db: D1Database, sessionId: string): Promise<{
  whatHappened: EventKindActorRow[];
  whoDidIt: Array<{ actorType: string; count: number }>;
  sourceProofTypes: SourceProofTypeRow[];
  derivedClaims: DerivedClaimRow[];
  missingPersonProjectionCount: number;
}> {
  const [events, sourceProofTypes, derivedClaims, missingProjection] = await Promise.all([
    db.prepare(
      `SELECT kind, actor_type, COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE session_id = ?1
        GROUP BY kind, actor_type
        ORDER BY kind, actor_type`,
    ).bind(sessionId).all<EventKindActorRow>(),
    db.prepare(
      `SELECT source_ref_type, COUNT(*) AS count
         FROM (
           SELECT sr.source_ref_type
             FROM assessment_event_source_refs sr
             JOIN assessment_evidence_events ev ON ev.id = sr.event_id
            WHERE ev.session_id = ?1
           UNION ALL
           SELECT csr.source_ref_type
             FROM assessment_claim_source_refs csr
             JOIN assessment_evaluation_claims c ON c.id = csr.claim_id
             JOIN assessment_evaluation_reports r ON r.id = c.report_id
            WHERE r.session_id = ?1
         )
        GROUP BY source_ref_type
        ORDER BY source_ref_type`,
    ).bind(sessionId).all<SourceProofTypeRow>(),
    db.prepare(
      `SELECT c.polarity, c.dimension, COUNT(*) AS count
         FROM assessment_evaluation_claims c
         JOIN assessment_evaluation_reports r ON r.id = c.report_id
        WHERE r.session_id = ?1
        GROUP BY c.polarity, c.dimension
        ORDER BY c.polarity, c.dimension`,
    ).bind(sessionId).all<DerivedClaimRow>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evidence_events ev
        WHERE ev.session_id = ?1
          AND NOT EXISTS (
            SELECT 1
              FROM context_records cr
             WHERE cr.ingestion_key = 'assessment_event_context:' || ev.id
               AND cr.workspace_person_id IS NOT NULL
          )`,
    ).bind(sessionId).first<CountRow>(),
  ]);

  const actorCounts = new Map<string, number>();
  for (const row of events.results ?? []) {
    actorCounts.set(row.actor_type, (actorCounts.get(row.actor_type) ?? 0) + Number(row.count));
  }

  return {
    whatHappened: events.results ?? [],
    whoDidIt: [...actorCounts.entries()]
      .map(([actorType, count]) => ({ actorType, count }))
      .sort((a, b) => a.actorType.localeCompare(b.actorType)),
    sourceProofTypes: sourceProofTypes.results ?? [],
    derivedClaims: derivedClaims.results ?? [],
    missingPersonProjectionCount: Number(missingProjection?.count ?? 0),
  };
}

async function replaySession(db: D1Database, sessionId: string): Promise<{
  ok: boolean;
  sessionId: string;
  replay: Awaited<ReturnType<typeof ingestAssessmentSessionRealTime>>;
  before: { interactions: number; contextRecords: number; sourceRefs: number };
  after: { interactions: number; contextRecords: number; sourceRefs: number };
  proof: ProofRow | null;
  answers: Awaited<ReturnType<typeof loadAnswerSummary>>;
  matchingEffects: Awaited<ReturnType<typeof loadMatchingEffects>>;
}> {
  const before = {
    interactions: await count(db, `SELECT COUNT(*) AS count FROM interactions WHERE external_reference = ?1`, sessionId),
    contextRecords: await count(db, `SELECT COUNT(*) AS count FROM context_records WHERE interaction_id IN (SELECT id FROM interactions WHERE external_reference = ?1)`, sessionId),
    sourceRefs: await count(db, `SELECT COUNT(*) AS count FROM context_record_source_refs WHERE context_record_id IN (SELECT cr.id FROM context_records cr JOIN interactions i ON i.id = cr.interaction_id WHERE i.external_reference = ?1)`, sessionId),
  };

  await recordAssessmentCandidateProfileEvidence(db, { sessionId });
  const replay = await ingestAssessmentSessionRealTime(db, sessionId);
  const proof = await loadProof(db, sessionId);
  const candidateId = await resolveSessionCandidateId(db, sessionId);
  const answers = await loadAnswerSummary(db, sessionId);
  const matchingEffects = await loadMatchingEffects(db, candidateId);

  const after = {
    interactions: await count(db, `SELECT COUNT(*) AS count FROM interactions WHERE external_reference = ?1`, sessionId),
    contextRecords: await count(db, `SELECT COUNT(*) AS count FROM context_records WHERE interaction_id IN (SELECT id FROM interactions WHERE external_reference = ?1)`, sessionId),
    sourceRefs: await count(db, `SELECT COUNT(*) AS count FROM context_record_source_refs WHERE context_record_id IN (SELECT cr.id FROM context_records cr JOIN interactions i ON i.id = cr.interaction_id WHERE i.external_reference = ?1)`, sessionId),
  };

  return {
    ok: replay !== null && proof !== null && proof.source_ref_count > 0,
    sessionId,
    replay,
    before,
    after,
    proof,
    answers,
    matchingEffects,
  };
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function emitProgress(enabled: boolean, message: string, data: Record<string, string | number | boolean | null> = {}): void {
  if (!enabled) return;
  const suffix = Object.entries(data)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.error(`[assessment-replay] ${message}${suffix ? ` ${suffix}` : ''}`);
}

async function loadMissingReplayTargets(
  db: D1Database,
  limit: number,
  excludeStates: string[],
): Promise<MissingReplayTarget[]> {
  const excludeStateSql = excludeStates.length > 0
    ? ` AND ass.state NOT IN (${placeholders(excludeStates.length)})`
    : '';
  const rows = await db.prepare(
    `SELECT ev.session_id,
            ass.state,
            COUNT(*) AS missing_event_count
       FROM assessment_evidence_events ev
       JOIN assessment_sessions ass ON ass.id = ev.session_id
       LEFT JOIN scheduled_interviews si ON si.id = ass.interview_id
       JOIN candidates c ON c.id = COALESCE(ass.candidate_id, si.candidate_id)
      WHERE (ass.candidate_id IS NOT NULL OR si.candidate_id IS NOT NULL)
        AND ass.state NOT IN ('INTAKE', 'CANCELLED')
        ${excludeStateSql}
        AND NOT EXISTS (
          SELECT 1
            FROM context_records cr
           WHERE cr.ingestion_key = 'assessment_event_context:' || ev.id
             AND cr.workspace_person_id IS NOT NULL
        )
      GROUP BY ev.session_id, ass.state
      ORDER BY ev.session_id
      LIMIT ?`,
  ).bind(...excludeStates, limit).all<{ session_id: string; state: string; missing_event_count: number }>();
  return (rows.results ?? []).map((row) => ({
    sessionId: row.session_id,
    state: row.state,
    missingEventCount: Number(row.missing_event_count),
  }));
}

function summarizeReplayResults(input: {
  requestedLimit: number;
  targets: MissingReplayTarget[];
  results: ReplayResult[];
}): {
  ok: boolean;
  mode: 'all-missing';
  requestedLimit: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  sessionIds: string[];
  skippedStates: string[];
  failures: Array<{ sessionId: string; reason: string }>;
  totals: {
    contextRecordsBefore: number;
    contextRecordsAfter: number;
    sourceRefsBefore: number;
    sourceRefsAfter: number;
    missingPersonProjectionsAfter: number;
    matchRunCount: number;
  };
  sessions: Array<{
    sessionId: string;
    state: string | null;
    selectedMissingEventCount: number | null;
    ok: boolean;
    interactionType: string | null;
    contextRecordsBefore: number;
    contextRecordsAfter: number;
    sourceRefsBefore: number;
    sourceRefsAfter: number;
    missingPersonProjectionCount: number;
    candidateId: string | null;
    matchRunCount: number;
    latestSelectedPacketId: string | null;
  }>;
} {
  const targetBySessionId = new Map(input.targets.map((target) => [target.sessionId, target]));
  const sessions = input.results.map((entry) => ({
    sessionId: entry.sessionId,
    state: targetBySessionId.get(entry.sessionId)?.state ?? null,
    selectedMissingEventCount: targetBySessionId.get(entry.sessionId)?.missingEventCount ?? null,
    ok: entry.ok,
    interactionType: entry.proof?.interaction_type ?? null,
    contextRecordsBefore: entry.before.contextRecords,
    contextRecordsAfter: entry.after.contextRecords,
    sourceRefsBefore: entry.before.sourceRefs,
    sourceRefsAfter: entry.after.sourceRefs,
    missingPersonProjectionCount: entry.answers.missingPersonProjectionCount,
    candidateId: entry.matchingEffects.candidateId,
    matchRunCount: entry.matchingEffects.matchRunCount,
    latestSelectedPacketId: entry.matchingEffects.latestMatchRuns[0]?.selected_packet_id ?? null,
  }));
  const failures = input.results
    .filter((entry) => !entry.ok)
    .map((entry) => ({
      sessionId: entry.sessionId,
      reason: entry.proof === null ? 'missing assessment interaction proof' : 'replay produced no source refs',
    }));

  return {
    ok: failures.length === 0,
    mode: 'all-missing',
    requestedLimit: input.requestedLimit,
    processedCount: input.results.length,
    succeededCount: input.results.length - failures.length,
    failedCount: failures.length,
    sessionIds: input.targets.map((target) => target.sessionId),
    skippedStates: [],
    failures,
    totals: {
      contextRecordsBefore: sessions.reduce((sum, entry) => sum + entry.contextRecordsBefore, 0),
      contextRecordsAfter: sessions.reduce((sum, entry) => sum + entry.contextRecordsAfter, 0),
      sourceRefsBefore: sessions.reduce((sum, entry) => sum + entry.sourceRefsBefore, 0),
      sourceRefsAfter: sessions.reduce((sum, entry) => sum + entry.sourceRefsAfter, 0),
      missingPersonProjectionsAfter: sessions.reduce((sum, entry) => sum + entry.missingPersonProjectionCount, 0),
      matchRunCount: sessions.reduce((sum, entry) => sum + entry.matchRunCount, 0),
    },
    sessions,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = new RemoteD1(new D1Client(loadD1Config())) as unknown as D1Database;

  if (options.allMissing) {
    const targets = await loadMissingReplayTargets(db, options.limit, options.excludeStates);
    const results = [];
    emitProgress(options.progress, 'selected all-missing targets', {
      count: targets.length,
      requestedLimit: options.limit,
      excludedStates: options.excludeStates.join(',') || 'none',
    });
    for (const target of targets) {
      emitProgress(options.progress, 'start session', {
        sessionId: target.sessionId,
        state: target.state,
        missingEvents: target.missingEventCount,
      });
      const startedAt = Date.now();
      const result = await replaySession(db, target.sessionId);
      results.push(result);
      emitProgress(options.progress, 'done session', {
        sessionId: target.sessionId,
        ok: result.ok,
        durationMs: Date.now() - startedAt,
        contextRecordsAfter: result.after.contextRecords,
        sourceRefsAfter: result.after.sourceRefs,
        missingAfter: result.answers.missingPersonProjectionCount,
      });
    }
    const result = options.summary
      ? {
          ...summarizeReplayResults({ requestedLimit: options.limit, targets, results }),
          skippedStates: options.excludeStates,
        }
      : {
          ok: results.every((entry) => entry.ok),
          mode: 'all-missing',
          requestedLimit: options.limit,
          processedCount: results.length,
          sessionIds: targets.map((target) => target.sessionId),
          skippedStates: options.excludeStates,
          results,
        };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  const result = await replaySession(db, options.sessionId!);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[assessment-replay] session=${options.sessionId} ok=${result.ok}`);
    console.log(JSON.stringify(result, null, 2));
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('[assessment-replay] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
