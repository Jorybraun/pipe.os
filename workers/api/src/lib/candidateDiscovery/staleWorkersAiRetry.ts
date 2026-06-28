import type { Env } from '../../types';
import { buildRuleBasedParsedCV, persistParsedCV } from '../cvParser';
import { processResumeFromR2 } from '../enrichment/resumeIngestion';
import { recordSessionEvent } from '../telemetry/sessionEvents';
import { runCandidateIngestion } from './orchestrate';
import { markIngestionFailed } from './persist';

const DEFAULT_STALE_WORKERS_AI_RETRY_LIMIT = 3;
const MAX_STALE_WORKERS_AI_RETRY_LIMIT = 5;
const MAX_RETRY_EVENT_ERROR_CHARS = 700;

type RetryTrigger = 'candidate_rpc' | 'scheduled_worker';

interface RetryContext {
  trigger: RetryTrigger;
  originalErrorText?: string | null;
}

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
  context?: RetryContext,
): Promise<void> {
  if (resumeS3Key.startsWith('text-intake/')) {
    if (!env.STORAGE) {
      await markRetryFailed(
        env,
        candidateId,
        resumeS3Key,
        'Retry failed: original text intake source is unavailable because R2 storage is not configured.',
        context,
      );
      return;
    }
    const object = await env.STORAGE.get(resumeS3Key);
    if (!object) {
      await markRetryFailed(
        env,
        candidateId,
        resumeS3Key,
        `Retry failed: original text intake source not found in R2: ${resumeS3Key}`,
        context,
      );
      return;
    }
    const resumeText = (await object.text()).trim();
    if (resumeText.length < 20) {
      await markRetryFailed(
        env,
        candidateId,
        resumeS3Key,
        'Retry failed: original text intake source is too short for source-backed candidate evidence.',
        context,
      );
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
    await markRetryFailed(
      env,
      candidateId,
      resumeS3Key,
      `Retry failed: ${result.error ?? 'resume ingestion did not complete'}`,
      context,
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

  const retryPromise = queueAndRunRetry(env, candidateId, row.resume_s3_key, {
    trigger: 'candidate_rpc',
    originalErrorText: row.error_text,
  })
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[standaloneReview] retryable candidate ingestion failed for ${candidateId}:`, msg);
      await markRetryFailed(env, candidateId, row.resume_s3_key!, `Retry failed: ${msg}`, {
        trigger: 'candidate_rpc',
        originalErrorText: row.error_text,
      });
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
      await queueAndRunRetry(env, row.candidate_id, row.resume_s3_key, {
        trigger: 'scheduled_worker',
        originalErrorText: row.error_text,
      });
      queued++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[staleWorkersAiRetry] retry failed for ${row.candidate_id}:`, msg);
      await markRetryFailed(env, row.candidate_id, row.resume_s3_key, `Retry failed: ${msg}`, {
        trigger: 'scheduled_worker',
        originalErrorText: row.error_text,
      });
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
  context: RetryContext,
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

  await recordRetryEvent(env, candidateId, 'ingestion_retry_queued', resumeS3Key, {
    trigger: context.trigger,
    reason: 'stale_workers_ai_model_failure',
    staleFailureStep: 'discover_profile',
    originalErrorText: boundedText(context.originalErrorText),
    queuedAt: now,
  });

  await retryCandidateEvidenceIngestionFromSource(env, candidateId, resumeS3Key, context);
}

async function markRetryFailed(
  env: Env,
  candidateId: string,
  resumeS3Key: string,
  message: string,
  context?: RetryContext,
): Promise<void> {
  await markIngestionFailed(env.DB, candidateId, message);
  await recordRetryEvent(env, candidateId, 'ingestion_retry_failed', resumeS3Key, {
    trigger: context?.trigger ?? 'candidate_rpc',
    reason: 'stale_workers_ai_model_failure',
    staleFailureStep: 'discover_profile',
    originalErrorText: boundedText(context?.originalErrorText),
    errorText: boundedText(message),
  });
}

async function recordRetryEvent(
  env: Env,
  candidateId: string,
  eventType: 'ingestion_retry_queued' | 'ingestion_retry_failed',
  resumeS3Key: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await recordSessionEvent(env.DB, {
    sessionId: ingestionSessionId(candidateId),
    sessionType: 'ingestion',
    candidateId,
    eventType,
    payload: {
      ...payload,
      sourceRef: {
        type: sourceTypeForKey(resumeS3Key),
        key: resumeS3Key,
      },
    },
  });
}

function ingestionSessionId(candidateId: string): string {
  return `ingestion-${candidateId}`;
}

function sourceTypeForKey(resumeS3Key: string): 'text_intake_r2_object' | 'resume_r2_object' {
  return resumeS3Key.startsWith('text-intake/')
    ? 'text_intake_r2_object'
    : 'resume_r2_object';
}

function boundedText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length <= MAX_RETRY_EVENT_ERROR_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_RETRY_EVENT_ERROR_CHARS)}\n[truncated]`;
}
