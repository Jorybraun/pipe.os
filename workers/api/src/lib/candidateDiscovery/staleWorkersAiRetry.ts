import type { Env } from '../../types';
import { buildRuleBasedParsedCV, persistParsedCV } from '../cvParser';
import { processResumeFromR2 } from '../enrichment/resumeIngestion';
import type { ResumeLivingContextIdentity } from '../livingContext/resumeIngestion';
import { ensureRolelessTalentPoolIdentity } from '../talentPoolIdentity';
import { recordSessionEvent } from '../telemetry/sessionEvents';
import { runCandidateIngestion } from './orchestrate';
import { markIngestionFailed } from './persist';

const DEFAULT_STALE_WORKERS_AI_RETRY_LIMIT = 3;
const MAX_STALE_WORKERS_AI_RETRY_LIMIT = 5;
const STALE_WORKERS_AI_RETRY_SCAN_MULTIPLIER = 6;
const MAX_RETRY_EVENT_ERROR_CHARS = 700;
const STALE_IN_PROGRESS_RETRY_AFTER_MS = 10 * 60 * 1000;
const RETRYABLE_STALLED_INGESTION_STEPS = new Set([
  'talent_pool_profile_received',
  'queued',
  'retry_queued',
  'parse_resume',
  'decompose_resume',
  'discover_profile',
  'embed_profile',
  'match_and_assign',
]);

function isTextSourceKey(resumeS3Key: string): boolean {
  const normalized = resumeS3Key.toLowerCase();
  return resumeS3Key.startsWith('text-intake/')
    || (resumeS3Key.startsWith('talent-intake/') && normalized.endsWith('.txt'));
}

function isTalentPoolSourceKey(resumeS3Key: string): boolean {
  return resumeS3Key.startsWith('talent-intake/');
}

type RetryTrigger = 'candidate_rpc' | 'scheduled_worker';
type RetryReasonCode =
  | 'stale_workers_ai_model_failure'
  | 'candidate_discovery_output_contract_failure'
  | 'stalled_candidate_evidence_ingestion'
  | 'missing_candidate_evidence_ingestion';

export const STALE_WORKERS_AI_RETRY_REASON = 'Retrying candidate evidence ingestion after a stale Workers AI model failure.';
export const CANDIDATE_DISCOVERY_OUTPUT_RETRY_REASON = 'Retrying candidate evidence ingestion after the AI discovery output failed the structured JSON contract.';
export const STALLED_INGESTION_RETRY_REASON = 'Retrying candidate evidence ingestion from the original source after the previous run stalled.';
export const MISSING_INGESTION_RETRY_REASON = 'Starting candidate evidence ingestion from the uploaded resume because no ingestion run was recorded.';

interface RetryContext {
  trigger: RetryTrigger;
  reasonCode: RetryReasonCode;
  originalErrorText?: string | null;
  originalStep?: string | null;
  originalUpdatedAt?: string | null;
}

interface StaleWorkersAIRow {
  resume_s3_key: string | null;
  status: string | null;
  current_step: string | null;
  error_text: string | null;
  updated_at?: string | null;
}

interface RetryableCandidateRow extends StaleWorkersAIRow {
  candidate_id: string;
  resume_s3_key: string;
}

interface TalentPoolOperationalRetryRow {
  owner_id: string | null;
  name: string | null;
  email: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  phone_screener_consent: number | null;
  phone_number: string | null;
  timezone: string | null;
  availability: string | null;
  submitted_at: string | null;
  updated_at: string | null;
}

export interface StaleWorkersAIRetryResult {
  scanned: number;
  queued: number;
  skipped: number;
  failed: number;
}

export interface TalentPoolOperationalContextRepairResult {
  scanned: number;
  repaired: number;
  skipped: number;
  failed: number;
}

export interface QueuedStandaloneIngestionRetry {
  reason: string;
  reasonCode: RetryReasonCode;
  originalStep: string | null;
  originalUpdatedAt: string | null;
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

export function isRetryableCandidateDiscoveryOutputFailure(row: {
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
  return errorText.includes('candidate discovery response was not a json object')
    || errorText.includes('candidate discovery profile too short: got 0 chars')
    || errorText.includes('cloudflare workers ai returned empty response');
}

export function isRetryableStalledInProgressIngestion(row: {
  status: string | null;
  current_step: string | null;
  updated_at?: string | null;
}, nowMs = Date.now()): boolean {
  if (row.status !== 'pending') return false;
  if (!row.current_step || !row.updated_at) return false;
  if (!RETRYABLE_STALLED_INGESTION_STEPS.has(row.current_step)) return false;
  const updatedMs = Date.parse(row.updated_at);
  if (!Number.isFinite(updatedMs)) return false;
  return nowMs - updatedMs >= STALE_IN_PROGRESS_RETRY_AFTER_MS;
}

function retryContextForRow(row: StaleWorkersAIRow, trigger: RetryTrigger): (RetryContext & {
  publicReason: string;
}) | null {
  if (!row.status && !row.current_step && row.resume_s3_key) {
    return {
      trigger,
      reasonCode: 'missing_candidate_evidence_ingestion',
      publicReason: MISSING_INGESTION_RETRY_REASON,
      originalErrorText: row.error_text,
      originalStep: null,
      originalUpdatedAt: row.updated_at ?? null,
    };
  }

  if (isRetryableStaleWorkersAIModelFailure(row)) {
    return {
      trigger,
      reasonCode: 'stale_workers_ai_model_failure',
      publicReason: STALE_WORKERS_AI_RETRY_REASON,
      originalErrorText: row.error_text,
      originalStep: row.current_step,
      originalUpdatedAt: row.updated_at ?? null,
    };
  }

  if (isRetryableCandidateDiscoveryOutputFailure(row)) {
    return {
      trigger,
      reasonCode: 'candidate_discovery_output_contract_failure',
      publicReason: CANDIDATE_DISCOVERY_OUTPUT_RETRY_REASON,
      originalErrorText: row.error_text,
      originalStep: row.current_step,
      originalUpdatedAt: row.updated_at ?? null,
    };
  }

  if (isRetryableStalledInProgressIngestion(row)) {
    return {
      trigger,
      reasonCode: 'stalled_candidate_evidence_ingestion',
      publicReason: STALLED_INGESTION_RETRY_REASON,
      originalErrorText: row.error_text,
      originalStep: row.current_step,
      originalUpdatedAt: row.updated_at ?? null,
    };
  }

  return null;
}

async function repairRolelessTalentPoolOperationalContext(
  env: Env,
  candidateId: string,
): Promise<ResumeLivingContextIdentity | null> {
  const row = await env.DB.prepare(
    `SELECT c.owner_id,
            c.name,
            c.email,
            t.github_url,
            t.linkedin_url,
            t.portfolio_url,
            t.phone_screener_consent,
            t.phone_number,
            t.timezone,
            t.availability,
            t.submitted_at,
            t.updated_at
       FROM candidates c
       JOIN talent_pool_intakes t ON t.candidate_id = c.id
      WHERE c.id = ?1
        AND c.pipeline_id IS NULL
      LIMIT 1`,
  ).bind(candidateId).first<TalentPoolOperationalRetryRow>();

  const ownerId = row?.owner_id?.trim();
  const email = row?.email?.trim();
  if (!row || !ownerId || !email) return null;

  return await ensureRolelessTalentPoolIdentity({
    db: env.DB,
    userId: ownerId,
    candidateId,
    name: row.name?.trim() || email,
    email,
    operationalContext: {
      githubUrl: row.github_url,
      linkedinUrl: row.linkedin_url,
      portfolioUrl: row.portfolio_url,
      phoneScreenerConsent: row.phone_screener_consent === 1,
      phoneNumber: row.phone_number,
      timezone: row.timezone,
      availability: row.availability,
    },
    now: row.submitted_at ?? row.updated_at ?? new Date().toISOString(),
  });
}

export async function processTalentPoolOperationalContextRepairs(
  env: Env,
  limit = MAX_STALE_WORKERS_AI_RETRY_LIMIT,
): Promise<TalentPoolOperationalContextRepairResult> {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_STALE_WORKERS_AI_RETRY_LIMIT));
  const rows = await env.DB.prepare(
    `SELECT c.id AS candidate_id
       FROM talent_pool_intakes t
       JOIN candidates c ON c.id = t.candidate_id
      WHERE c.pipeline_id IS NULL
        AND (
          (t.github_url IS NOT NULL AND TRIM(t.github_url) <> '')
          OR (t.linkedin_url IS NOT NULL AND TRIM(t.linkedin_url) <> '')
          OR (t.portfolio_url IS NOT NULL AND TRIM(t.portfolio_url) <> '')
          OR t.phone_screener_consent = 1
        )
      ORDER BY t.updated_at DESC
      LIMIT ?1`,
  ).bind(boundedLimit).all<{ candidate_id: string }>();

  let repaired = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows.results ?? []) {
    try {
      const identity = await repairRolelessTalentPoolOperationalContext(env, row.candidate_id);
      if (identity) {
        repaired++;
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[talentPoolOperationalContextRepair] failed for ${row.candidate_id}:`, msg);
    }
  }

  return {
    scanned: rows.results?.length ?? 0,
    repaired,
    skipped,
    failed,
  };
}

export async function retryCandidateEvidenceIngestionFromSource(
  env: Env,
  candidateId: string,
  resumeS3Key: string,
  context?: RetryContext,
): Promise<void> {
  const rolelessTalentPoolIdentity = isTalentPoolSourceKey(resumeS3Key)
    ? await repairRolelessTalentPoolOperationalContext(env, candidateId)
    : null;

  if (isTextSourceKey(resumeS3Key)) {
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
      maxNodeEmbeddings: 0,
      maxParserOnlyNodes: 12,
      mirrorLivingContext: false,
      skipPostDecompositionMaintenance: true,
    });
    return;
  }

  const result = await processResumeFromR2({
    env,
    db: env.DB,
    candidateId,
    r2Key: resumeS3Key,
    ...(isTalentPoolSourceKey(resumeS3Key) ? { livingContextIdentity: rolelessTalentPoolIdentity } : {}),
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
): Promise<QueuedStandaloneIngestionRetry | null> {
  const row = await env.DB.prepare(
    `SELECT c.resume_s3_key,
            ci.status,
            ci.current_step,
            ci.error_text,
            ci.updated_at
       FROM candidates c
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
      WHERE c.id = ?1
        /* retryable_standalone_ingestion */`,
  ).bind(candidateId).first<StaleWorkersAIRow>();

  const retryContext = row?.resume_s3_key
    ? retryContextForRow(row, 'candidate_rpc')
    : null;
  if (!row?.resume_s3_key || !retryContext) {
    return null;
  }

  const retryPromise = queueAndRunRetry(env, candidateId, row.resume_s3_key, {
    trigger: retryContext.trigger,
    reasonCode: retryContext.reasonCode,
    originalErrorText: retryContext.originalErrorText,
    originalStep: retryContext.originalStep,
    originalUpdatedAt: retryContext.originalUpdatedAt,
  })
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[standaloneReview] retryable candidate ingestion failed for ${candidateId}:`, msg);
      await markRetryFailed(env, candidateId, row.resume_s3_key!, `Retry failed: ${msg}`, {
        trigger: retryContext.trigger,
        reasonCode: retryContext.reasonCode,
        originalErrorText: retryContext.originalErrorText,
        originalStep: retryContext.originalStep,
        originalUpdatedAt: retryContext.originalUpdatedAt,
      });
    });

  if (executionCtx) {
    executionCtx.waitUntil(retryPromise);
  } else {
    await retryPromise;
  }
  return {
    reason: retryContext.publicReason,
    reasonCode: retryContext.reasonCode,
    originalStep: retryContext.originalStep ?? null,
    originalUpdatedAt: retryContext.originalUpdatedAt ?? null,
  };
}

export async function processStaleWorkersAIModelIngestionRetries(
  env: Env,
  limit = DEFAULT_STALE_WORKERS_AI_RETRY_LIMIT,
): Promise<StaleWorkersAIRetryResult> {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_STALE_WORKERS_AI_RETRY_LIMIT));
  const scanLimit = boundedLimit * STALE_WORKERS_AI_RETRY_SCAN_MULTIPLIER;
  const staleCutoff = new Date(Date.now() - STALE_IN_PROGRESS_RETRY_AFTER_MS).toISOString();
  const rows = await env.DB.prepare(
    `SELECT c.id AS candidate_id,
            c.resume_s3_key,
            ci.status,
            ci.current_step,
            ci.error_text,
            ci.updated_at
       FROM candidate_ingestion ci
       JOIN candidates c ON c.id = ci.candidate_id
      WHERE c.resume_s3_key IS NOT NULL
        AND (
          (
            ci.status = 'failed'
            AND ci.current_step = 'discover_profile'
            AND ci.error_text IS NOT NULL
          )
          OR (
            ci.status = 'pending'
            AND ci.current_step IS NOT NULL
            AND ci.current_step IN ('talent_pool_profile_received', 'queued', 'retry_queued', 'parse_resume', 'decompose_resume', 'discover_profile', 'embed_profile', 'match_and_assign')
            AND ci.updated_at IS NOT NULL
            AND ci.updated_at <= ?1
          )
        )
      ORDER BY
        CASE WHEN ci.status = 'pending' THEN 0 ELSE 1 END,
        CASE WHEN ci.status = 'pending' THEN ci.updated_at END DESC,
        ci.updated_at ASC
      LIMIT ?2`,
  ).bind(staleCutoff, scanLimit).all<RetryableCandidateRow>();

  let queued = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    const retryContext = retryContextForRow(row, 'scheduled_worker');
    if (!row.resume_s3_key || !retryContext) {
      skipped++;
      continue;
    }
    if (queued >= boundedLimit) {
      skipped++;
      continue;
    }

    try {
      await queueAndRunRetry(env, row.candidate_id, row.resume_s3_key, {
        trigger: retryContext.trigger,
        reasonCode: retryContext.reasonCode,
        originalErrorText: retryContext.originalErrorText,
        originalStep: retryContext.originalStep,
        originalUpdatedAt: retryContext.originalUpdatedAt,
      });
      queued++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[staleWorkersAiRetry] retry failed for ${row.candidate_id}:`, msg);
      await markRetryFailed(env, row.candidate_id, row.resume_s3_key, `Retry failed: ${msg}`, {
        trigger: retryContext.trigger,
        reasonCode: retryContext.reasonCode,
        originalErrorText: retryContext.originalErrorText,
        originalStep: retryContext.originalStep,
        originalUpdatedAt: retryContext.originalUpdatedAt,
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
    reason: context.reasonCode,
    staleFailureStep: context.originalStep ?? 'not_recorded',
    originalStep: context.originalStep ?? null,
    originalUpdatedAt: context.originalUpdatedAt ?? null,
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
    reason: context?.reasonCode ?? 'stale_workers_ai_model_failure',
    staleFailureStep: context?.originalStep ?? 'not_recorded',
    originalStep: context?.originalStep ?? null,
    originalUpdatedAt: context?.originalUpdatedAt ?? null,
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
  return isTextSourceKey(resumeS3Key)
    ? 'text_intake_r2_object'
    : 'resume_r2_object';
}

function boundedText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length <= MAX_RETRY_EVENT_ERROR_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_RETRY_EVENT_ERROR_CHARS)}\n[truncated]`;
}
