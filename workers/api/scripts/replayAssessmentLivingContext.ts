#!/usr/bin/env tsx
/**
 * Replay one assessment session into the living-context graph.
 *
 * Remote:
 *   CLOUDFLARE_D1_DATABASE_ID=<dev-db-id> npm run assessment-evidence:replay -- --remote --session-id <assessment_session_id>
 *
 * The replay uses the same production ingestion path as real-time assessment
 * evaluation and scheduled backfill. Ingestion keys make reruns idempotent.
 */

import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestAssessmentSessionRealTime } from '../src/lib/livingContext/assessmentIngestion';
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
  sessionId: string;
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

function parseArgs(argv: string[]): ReplayOptions {
  let target: ReplayOptions['target'] | null = null;
  let sessionId = '';
  let json = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--remote') {
      target = 'remote';
    } else if (arg === '--session-id') {
      sessionId = argv[++index] ?? '';
    } else if (arg === '--json') {
      json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (target !== 'remote') {
    throw new Error('Only --remote is currently supported for assessment evidence replay.');
  }
  if (!sessionId) {
    throw new Error('Missing required --session-id <assessment_session_id>.');
  }

  return { target, sessionId, json };
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const db = new RemoteD1(new D1Client(loadD1Config())) as unknown as D1Database;

  const before = {
    interactions: await count(db, `SELECT COUNT(*) AS count FROM interactions WHERE external_reference = ?1`, options.sessionId),
    contextRecords: await count(db, `SELECT COUNT(*) AS count FROM context_records WHERE interaction_id IN (SELECT id FROM interactions WHERE external_reference = ?1)`, options.sessionId),
    sourceRefs: await count(db, `SELECT COUNT(*) AS count FROM context_record_source_refs WHERE context_record_id IN (SELECT cr.id FROM context_records cr JOIN interactions i ON i.id = cr.interaction_id WHERE i.external_reference = ?1)`, options.sessionId),
  };

  const replay = await ingestAssessmentSessionRealTime(db, options.sessionId);
  const proof = await loadProof(db, options.sessionId);

  const after = {
    interactions: await count(db, `SELECT COUNT(*) AS count FROM interactions WHERE external_reference = ?1`, options.sessionId),
    contextRecords: await count(db, `SELECT COUNT(*) AS count FROM context_records WHERE interaction_id IN (SELECT id FROM interactions WHERE external_reference = ?1)`, options.sessionId),
    sourceRefs: await count(db, `SELECT COUNT(*) AS count FROM context_record_source_refs WHERE context_record_id IN (SELECT cr.id FROM context_records cr JOIN interactions i ON i.id = cr.interaction_id WHERE i.external_reference = ?1)`, options.sessionId),
  };

  const result = {
    ok: replay !== null && proof !== null && proof.source_ref_count > 0,
    sessionId: options.sessionId,
    replay,
    before,
    after,
    proof,
  };

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
