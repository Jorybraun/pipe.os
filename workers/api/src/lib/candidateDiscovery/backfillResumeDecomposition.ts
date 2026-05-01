/**
 * Backfill Script — Resume Decomposition
 *
 * Re-processes historical candidates through the resume decomposition pipeline.
 * Idempotent: skips candidates who already have resume-derived candidate_nodes.
 * Rate-limited: processes max 10 candidates per invocation.
 *
 * Usage:
 *   npx tsx scripts/backfillResumeDecomposition.ts --batch-size=10 --dry-run
 *
 * Cron (wrangler.jsonc):
 *   Every night at 2 AM, 10 candidates/hour
 */

import type { Env } from '../../types';
import { parseResume, extractTextFromPDF } from '../cvParser';
import { decomposeResumeToGraph } from './resumeDecomposition';

interface BackfillOptions {
  db: import('@cloudflare/workers-types').D1Database;
  env: Env;
  batchSize: number;
  dryRun: boolean;
}

interface CandidateToBackfill {
  candidate_id: string;
  resume_s3_key: string | null;
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

  // Find candidates eligible for backfill:
  // - Have candidate_ingestion status = 'embedded' or 'matched'
  // - Do NOT already have candidate_nodes with source_type = 'resume'
  // - Ordered by most-recently-active first
  const rows = await db
    .prepare(
      `SELECT
         ci.candidate_id,
         c.resume_s3_key
       FROM candidate_ingestion ci
       JOIN candidates c ON c.id = ci.candidate_id
       WHERE ci.status IN ('embedded', 'matched')
         AND ci.candidate_id NOT IN (
           SELECT DISTINCT candidate_id
           FROM candidate_nodes
           WHERE source_type = 'resume'
         )
       ORDER BY ci.profile_embedded_at DESC
       LIMIT ?1`,
    )
    .bind(batchSize)
    .all<CandidateToBackfill>();

  const candidates = rows.results ?? [];
  console.log(`[backfill] Found ${candidates.length} candidates to process`);

  for (const candidate of candidates) {
    const { candidate_id, resume_s3_key } = candidate;

    if (!resume_s3_key) {
      console.log(`[backfill] Skipping ${candidate_id}: no resume_s3_key`);
      result.skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[backfill] DRY RUN: would process ${candidate_id}`);
      result.processed++;
      continue;
    }

    try {
      // Download resume from R2
      const object = await env.STORAGE.get(resume_s3_key);
      if (!object) {
        console.warn(`[backfill] Skipping ${candidate_id}: resume not found in R2 (${resume_s3_key})`);
        result.skipped++;
        continue;
      }

      const buffer = await object.arrayBuffer();
      const contentType = object.httpMetadata?.contentType ?? 'application/pdf';

      // Parse resume (extracts text + runs decomposition LLM)
      const parseResult = await parseResume({
        fileBuffer: buffer,
        contentType,
        env,
      });

      if (!parseResult) {
        console.warn(`[backfill] Skipping ${candidate_id}: parseResume returned null`);
        result.skipped++;
        continue;
      }

      const { parsedCV, decompositionResult } = parseResult;

      // Extract text for resumeText parameter
      let resumeText = '';
      try {
        if (contentType === 'application/pdf') {
          resumeText = await extractTextFromPDF(buffer);
        } else {
          resumeText = new TextDecoder().decode(buffer);
        }
      } catch {
        resumeText = '';
      }

      const decompResult = await decomposeResumeToGraph({
        db,
        candidateId: candidate_id,
        resumeText,
        parsedCV,
        env,
        decompositionResult,
      });

      console.log(
        `[backfill] Processed ${candidate_id}: inserted=${decompResult.nodesInserted}, embedded=${decompResult.nodesEmbedded}`,
      );

      if (decompResult.errors.length > 0) {
        console.warn(`[backfill] Errors for ${candidate_id}:`, decompResult.errors);
        result.errors += decompResult.errors.length;
      }

      result.processed++;
      result.details.push(
        `${candidate_id}: inserted=${decompResult.nodesInserted}, embedded=${decompResult.nodesEmbedded}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill] Failed ${candidate_id}:`, msg);
      result.errors++;
      result.details.push(`${candidate_id}: ERROR — ${msg}`);
    }
  }

  return result;
}
