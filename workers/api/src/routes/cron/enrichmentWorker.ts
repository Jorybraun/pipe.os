/**
 * Enrichment Worker Cron Handler — processes pending enrichment_jobs.
 *
 * Trigger: every 2 hours (configured in wrangler.jsonc)
 * Model: sequential job processing, max 5 per invocation, max 3 attempts per job.
 */

import type { Env } from '../../types';
import { enrichCandidateFromGitHub } from '../../lib/enrichment/githubEnrich';

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;

class PermanentEnrichmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentEnrichmentError';
  }
}

export async function handleEnrichmentWorkerCron(
  env: Env,
): Promise<{ processed: number; failed: number; errors: string[] }> {
  const db = env.DB;
  const errors: string[] = [];
  let processed = 0;
  let failed = 0;

  // Poll for pending jobs
  const jobs = await db
    .prepare(
      `SELECT id, candidate_id, source_type, source_url
       FROM enrichment_jobs
       WHERE status = 'PENDING' AND attempt_count < ?1
       ORDER BY created_at ASC
       LIMIT ?2`,
    )
    .bind(MAX_ATTEMPTS, BATCH_SIZE)
    .all<{ id: string; candidate_id: string; source_type: string; source_url: string }>();

  for (const job of jobs.results ?? []) {
    try {
      // Mark IN_PROGRESS
      await db
        .prepare(
          `UPDATE enrichment_jobs
           SET status = 'IN_PROGRESS',
               attempt_count = attempt_count + 1,
               last_attempted_at = ?1,
               updated_at = unixepoch()
           WHERE id = ?2`,
        )
        .bind(Math.floor(Date.now() / 1000), job.id)
        .run();

      if (job.source_type === 'github') {
        // Extract handle from https://github.com/<handle>
        const handle = job.source_url.replace(/^https:\/\/github\.com\//, '').split('/')[0];
        if (!handle) {
          throw new PermanentEnrichmentError(`Invalid github source_url: ${job.source_url}`);
        }

        const result = await enrichCandidateFromGitHub(
          handle,
          job.candidate_id,
          db,
          env as unknown as Parameters<typeof enrichCandidateFromGitHub>[3],
          env.GITHUB_TOKEN,
        );

        if (result.error) {
          throw new Error(result.error);
        }

        console.log(
          `[enrichmentWorker] GitHub enrichment complete for ${job.candidate_id}: ${result.nodesCreated} nodes from ${result.reposFound} repos`,
        );
      } else {
        throw new PermanentEnrichmentError(`Unsupported source_type: ${job.source_type}`);
      }

      // Mark DONE
      await db
        .prepare(
          `UPDATE enrichment_jobs
           SET status = 'DONE',
               completed_at = ?1,
               error_text = NULL,
               updated_at = unixepoch()
           WHERE id = ?2`,
        )
        .bind(Math.floor(Date.now() / 1000), job.id)
        .run();

      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Job ${job.id}: ${msg}`);
      console.error(`[enrichmentWorker] Job ${job.id} failed:`, msg);

      const isPermanent = err instanceof PermanentEnrichmentError;

      // Mark FAILED immediately for permanent errors, otherwise retry up to MAX_ATTEMPTS
      await db
        .prepare(
          `UPDATE enrichment_jobs
           SET status = CASE WHEN ?1 OR attempt_count >= ?2 THEN 'FAILED' ELSE 'PENDING' END,
               error_text = ?3,
               updated_at = unixepoch()
           WHERE id = ?4`,
        )
        .bind(isPermanent ? 1 : 0, MAX_ATTEMPTS, msg.slice(0, 500), job.id)
        .run();

      if (
        isPermanent ||
        (await db
          .prepare(`SELECT attempt_count FROM enrichment_jobs WHERE id = ?1`)
          .bind(job.id)
          .first<{ attempt_count: number }>()
          .then((r) => (r?.attempt_count ?? 0) >= MAX_ATTEMPTS))
      ) {
        failed++;
      }
    }
  }

  return { processed, failed, errors };
}
