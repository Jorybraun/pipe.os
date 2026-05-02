/**
 * Backfill Script — Code Review Graph Decomposition
 *
 * Re-processes historical review_sessions through the code review decomposition
 * pipeline. Idempotent: skips sessions that already have TechnicalDemonstration
 * nodes with matching source_reference.
 *
 * Usage:
 *   npx tsx scripts/backfillCodeReviewDecomposition.ts --batch-size=50 --dry-run
 */

import type { Env } from '../../types';
import { decomposeCodeReviewToGraph } from './decomposeCodeReview';
import type { ScoreReport } from '../scorerAgent';

interface BackfillOptions {
  db: import('@cloudflare/workers-types').D1Database;
  env: Env;
  batchSize: number;
  dryRun: boolean;
}

interface SessionToBackfill {
  id: string;
  candidate_id: string;
  updated_at: string;
  implementer_persona: string;
  challenge_id: string;
  score_report: string;
}

export async function runBackfill(options: BackfillOptions): Promise<{
  processed: number;
  skipped: number;
  errors: number;
  details: string[];
}> {
  const { db, env, batchSize, dryRun } = options;

  const result = {
    processed: 0,
    skipped: 0,
    errors: 0,
    details: [] as string[],
  };

  // Find sessions eligible for backfill:
  // - status = 'scored' AND score_report IS NOT NULL
  // - Do NOT already have candidate_nodes with source_type = 'code_review_session' and matching source_reference
  const rows = await db
    .prepare(
      `SELECT
         id, candidate_id, updated_at, implementer_persona, challenge_id, score_report
       FROM review_sessions
       WHERE status = 'scored'
         AND score_report IS NOT NULL
         AND id NOT IN (
           SELECT DISTINCT source_reference
           FROM candidate_nodes
           WHERE source_type = 'code_review_session'
         )
       ORDER BY updated_at DESC
       LIMIT ?1`,
    )
    .bind(batchSize)
    .all<SessionToBackfill>();

  const sessions = rows.results ?? [];
  console.log(`[backfill-code-review] Found ${sessions.length} sessions to process`);

  for (const session of sessions) {
    const { id, candidate_id, score_report } = session;

    let scoreReport: ScoreReport;
    try {
      scoreReport = JSON.parse(score_report) as ScoreReport;
    } catch {
      console.warn(`[backfill-code-review] Skipping ${id}: invalid score_report JSON`);
      result.skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[backfill-code-review] DRY RUN: would process ${id} for candidate ${candidate_id}`);
      result.processed++;
      continue;
    }

    try {
      await decomposeCodeReviewToGraph(db, env, session, scoreReport, env.CANDIDATE_INDEX);
      console.log(`[backfill-code-review] Processed ${id} for candidate ${candidate_id}`);
      result.processed++;
      result.details.push(`${id}: OK`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill-code-review] Failed ${id}:`, msg);
      result.errors++;
      result.details.push(`${id}: ERROR — ${msg}`);
    }
  }

  return result;
}
