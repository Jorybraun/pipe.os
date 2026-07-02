#!/usr/bin/env tsx
/**
 * Replay one assessment session into the living-context graph.
 *
 * Remote:
 *   CLOUDFLARE_D1_DATABASE_ID=<dev-db-id> npm run assessment-evidence:replay -- --remote --session-id <assessment_session_id>
 *   CLOUDFLARE_D1_DATABASE_ID=<dev-db-id> npm run assessment-evidence:replay -- --remote --all-missing --limit 25
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

function parseArgs(argv: string[]): ReplayOptions {
  let target: ReplayOptions['target'] | null = null;
  let sessionId: string | undefined;
  let allMissing = false;
  let limit = 25;
  let json = false;

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

  return { target, sessionId, allMissing, limit, json };
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

async function replaySession(db: D1Database, sessionId: string): Promise<{
  ok: boolean;
  sessionId: string;
  replay: Awaited<ReturnType<typeof ingestAssessmentSessionRealTime>>;
  before: { interactions: number; contextRecords: number; sourceRefs: number };
  after: { interactions: number; contextRecords: number; sourceRefs: number };
  proof: ProofRow | null;
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
    matchingEffects,
  };
}

async function loadMissingReplaySessionIds(db: D1Database, limit: number): Promise<string[]> {
  const rows = await db.prepare(
    `SELECT DISTINCT ev.session_id
       FROM assessment_evidence_events ev
       JOIN assessment_sessions ass ON ass.id = ev.session_id
       LEFT JOIN scheduled_interviews si ON si.id = ass.interview_id
       JOIN candidates c ON c.id = COALESCE(ass.candidate_id, si.candidate_id)
      WHERE (ass.candidate_id IS NOT NULL OR si.candidate_id IS NOT NULL)
        AND ass.state NOT IN ('INTAKE', 'CANCELLED')
        AND NOT EXISTS (
          SELECT 1
            FROM context_records cr
           WHERE cr.ingestion_key = 'assessment_event_context:' || ev.id
             AND cr.workspace_person_id IS NOT NULL
        )
      ORDER BY ev.session_id
      LIMIT ?1`,
  ).bind(limit).all<{ session_id: string }>();
  return (rows.results ?? []).map((row) => row.session_id);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = new RemoteD1(new D1Client(loadD1Config())) as unknown as D1Database;

  if (options.allMissing) {
    const sessionIds = await loadMissingReplaySessionIds(db, options.limit);
    const results = [];
    for (const sessionId of sessionIds) {
      results.push(await replaySession(db, sessionId));
    }
    const result = {
      ok: results.every((entry) => entry.ok),
      mode: 'all-missing',
      requestedLimit: options.limit,
      processedCount: results.length,
      sessionIds,
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
