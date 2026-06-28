import type { Env } from '../../types';
import { buildRuleBasedParsedCV, persistParsedCV } from '../cvParser';
import { processResumeFromR2 } from '../enrichment/resumeIngestion';
import { runCandidateIngestion } from './orchestrate';
import { markIngestionFailed } from './persist';

const DEFAULT_STALE_WORKERS_AI_RETRY_LIMIT = 3;
const MAX_STALE_WORKERS_AI_RETRY_LIMIT = 5;

interface StaleWorkersAIRow {
  resume_s3_key: string | null;
  status: string | null;
  current_step: string | null;
  error_text: string | null;
}

interface RetryableCandidateRow extends StaleWorkersAIRow {
  candidate_id: string;
  resume_s3_key: string;
}

export interface StaleWorkersAIRetryResult {
  scanned: number;
  queued: number;
  skipped: number;
  failed: number;
}

export function isRetryableStaleWorkersAIModelFailure(row: {
  status: string | null;
  current_step: string | null;
  error_text: string | null;
}): boolean {
  if (row.status !== 'failed') return false;
  const errorText = (row.error_text ?? '').toLowerCase();
  if (!errorText) return false;
  const currentStep = row.current_step ?? '';
  const failedDuringDiscovery = currentStep === 'discover_profile'
    || errorText.includes('discovery failed');
  if (!failedDuringDiscovery) return false;
  return errorText.includes('5028')
    || errorText.includes('deprecated')
    || errorText.includes('decommissioned');
}

export async function retryCandidateEvidenceIngestionFromSource(
  env: Env,
  candidateId: string,
  resumeS3Key: string,
): Promise<void> {
  if (resumeS3Key.startsWith('text-intake/')) {
    if (!env.STORAGE) {
      await markIngestionFailed(env.DB, candidateId, 'Retry failed: original text intake source is unavailable because R2 storage is not configured.');
      return;
    }
    const object = await env.STORAGE.get(resumeS3Key);
    if (!object) {
      await markIngestionFailed(env.DB, candidateId, `Retry failed: original text intake source not found in R2: ${resumeS3Key}`);
      return;
    }
    const resumeText = (await object.text()).trim();
    if (resumeText.length < 20) {
      await markIngestionFailed(env.DB, candidateId, 'Retry failed: original text intake source is too short for source-backed candidate evidence.');
      return;
    }
    const parsedCV = buildRuleBasedParsedCV(resumeText);
    await persistParsedCV(env.DB, candidateId, parsedCV);
    await runCandidateIngestion({
      env,
      db: env.DB,
      candidateId,
      parsed: parsedCV,
      resumeText,
      decompositionResult: null,
    });
    return;
  }

  const result = await processResumeFromR2({
    env,
    db: env.DB,
    candidateId,
    r2Key: resumeS3Key,
  });
  if (!result.success) {
    await markIngestionFailed(
      env.DB,
      candidateId,
      `Retry failed: ${result.error ?? 'resume ingestion did not complete'}`,
    );
  }
}

export async function maybeQueueRetryableStandaloneIngestion(
  env: Env,
  executionCtx: ExecutionContext | null,
  candidateId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT c.resume_s3_key,
            ci.status,
            ci.current_step,
            ci.error_text
       FROM candidates c
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
      WHERE c.id = ?1
        /* retryable_standalone_ingestion */`,
  ).bind(candidateId).first<StaleWorkersAIRow>();

  if (!row?.resume_s3_key || !isRetryableStaleWorkersAIModelFailure(row)) {
    return false;
  }

  const retryPromise = queueAndRunRetry(env, candidateId, row.resume_s3_key)
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[standaloneReview] retryable candidate ingestion failed for ${candidateId}:`, msg);
      await markIngestionFailed(env.DB, candidateId, `Retry failed: ${msg}`);
    });

  if (executionCtx) {
    executionCtx.waitUntil(retryPromise);
  } else {
    await retryPromise;
  }
  return true;
}

export async function processStaleWorkersAIModelIngestionRetries(
  env: Env,
  limit = DEFAULT_STALE_WORKERS_AI_RETRY_LIMIT,
): Promise<StaleWorkersAIRetryResult> {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_STALE_WORKERS_AI_RETRY_LIMIT));
  const rows = await env.DB.prepare(
    `SELECT c.id AS candidate_id,
            c.resume_s3_key,
            ci.status,
            ci.current_step,
            ci.error_text
       FROM candidate_ingestion ci
       JOIN candidates c ON c.id = ci.candidate_id
      WHERE c.resume_s3_key IS NOT NULL
        AND ci.status = 'failed'
        AND ci.current_step = 'discover_profile'
        AND (
          ci.error_text LIKE '%5028%'
          OR lower(ci.error_text) LIKE '%deprecated%'
          OR lower(ci.error_text) LIKE '%decommissioned%'
        )
      ORDER BY ci.updated_at ASC
      LIMIT ?1`,
  ).bind(boundedLimit).all<RetryableCandidateRow>();

  let queued = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    if (!row.resume_s3_key || !isRetryableStaleWorkersAIModelFailure(row)) {
      skipped++;
      continue;
    }

    try {
      await queueAndRunRetry(env, row.candidate_id, row.resume_s3_key);
      queued++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[staleWorkersAiRetry] retry failed for ${row.candidate_id}:`, msg);
      await markIngestionFailed(env.DB, row.candidate_id, `Retry failed: ${msg}`);
    }
  }

  return {
    scanned: rows.results?.length ?? 0,
    queued,
    skipped,
    failed,
  };
}

async function queueAndRunRetry(
  env: Env,
  candidateId: string,
  resumeS3Key: string,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO candidate_ingestion (candidate_id, status, current_step, error_text, created_at, updated_at)
     VALUES (?1, 'pending', 'retry_queued', NULL, ?2, ?2)
     ON CONFLICT(candidate_id) DO UPDATE SET
       status = 'pending',
       current_step = 'retry_queued',
       error_text = NULL,
       updated_at = excluded.updated_at`,
  ).bind(candidateId, now).run();

  await retryCandidateEvidenceIngestionFromSource(env, candidateId, resumeS3Key);
}
