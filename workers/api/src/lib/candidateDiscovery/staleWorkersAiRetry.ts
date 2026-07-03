import type { Env } from '../../types';
import {
  buildRuleBasedParsedCV,
  extractTextFromResumeFile,
  persistParsedCV,
  type ParseResumeResult,
} from '../cvParser';
import { processResumeFromR2 } from '../enrichment/resumeIngestion';
import type { ResumeLivingContextIdentity } from '../livingContext/resumeIngestion';
import {
  ensureRolelessTalentPoolIdentity,
  type TalentPoolSourceArtifactInput,
} from '../talentPoolIdentity';
import { recordSessionEvent } from '../telemetry/sessionEvents';
import {
  repairCandidateProfileIntakeNodeSourceRefs,
  repairCandidateResumeNodeSourceRefs,
  repairTalentPoolProfileIntakeNodeSourceRefs,
  repairTalentPoolResumeNodeSourceRefs,
} from './candidateNodes';
import { runCandidateIngestion } from './orchestrate';
import { markIngestionFailed } from './persist';

const DEFAULT_STALE_WORKERS_AI_RETRY_LIMIT = 3;
const MAX_STALE_WORKERS_AI_RETRY_LIMIT = 25;
const STALE_WORKERS_AI_RETRY_SCAN_MULTIPLIER = 6;
const MAX_RETRY_EVENT_ERROR_CHARS = 700;
const STALE_IN_PROGRESS_RETRY_AFTER_MS = 10 * 60 * 1000;
const DOCUMENT_RETRY_DISCOVERY_TIMEOUT_MS = 18_000;
const DOCUMENT_RETRY_DISCOVERY_MAX_ATTEMPTS = 2;
const DOCUMENT_RETRY_MAX_NODE_EMBEDDINGS = 0;
const DOCUMENT_RETRY_MAX_PARSER_ONLY_NODES = 12;
const MAX_TALENT_POOL_PROFILE_TEXT_REPAIR_BYTES = 512 * 1024;
const TALENT_POOL_PASTED_PROFILE_SOURCE_KIND = 'pasted_profile_text';
const TALENT_POOL_UPLOADED_PROFILE_SOURCE_KIND = 'uploaded_profile_file';
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

function normalizeRetryDocumentContentType(contentType: string | null | undefined, resumeS3Key: string): string {
  const normalized = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === 'application/pdf') return 'application/pdf';
  if (normalized === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (resumeS3Key.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  if (resumeS3Key.toLowerCase().endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return normalized || 'application/octet-stream';
}

function isDocumentSourceKey(resumeS3Key: string): boolean {
  const normalized = resumeS3Key.toLowerCase();
  return normalized.endsWith('.pdf') || normalized.endsWith('.docx');
}

function isTalentPoolDocumentEvidenceGapFailure(row: TalentPoolOperationalRetryRow): boolean {
  const profileKey = row.profile_r2_key?.trim() ?? '';
  if (!isDocumentSourceKey(profileKey)) return false;
  if (row.ingestion_status !== 'failed') return false;
  if (row.ingestion_current_step !== 'parse_resume') return false;
  const errorText = row.ingestion_error_text?.toLowerCase() ?? '';
  return errorText.includes('resume parsing failed or produced no text')
    || errorText.includes('resume parsing did not produce a candidate profile')
    || errorText.includes('resume text extraction failed')
    || errorText.includes('resume text extraction produced insufficient source evidence');
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
  profile_r2_key: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  phone_screener_consent: number | null;
  phone_number: string | null;
  timezone: string | null;
  availability: string | null;
  submitted_at: string | null;
  updated_at: string | null;
  ingestion_status?: string | null;
  ingestion_current_step?: string | null;
  ingestion_error_text?: string | null;
}

interface TalentPoolProfileMessageSource {
  message: string;
  storageKey: string;
  mediaType: string;
}

export interface StaleWorkersAIRetryResult {
  scanned: number;
  queued: number;
  skipped: number;
  failed: number;
}

export interface PipelineCandidateIngestionRetryInput {
  pipelineId: string;
  ownerId: string;
  limit?: number;
  executionCtx?: ExecutionContext | null;
}

export interface TalentPoolOperationalContextRepairResult {
  scanned: number;
  repaired: number;
  skipped: number;
  failed: number;
}

export interface TalentPoolRolelessApplicationRepairResult {
  scanned: number;
  deletedApplications: number;
  deletedPersonRoles: number;
  failed: number;
}

export function resolveCandidateIngestionRetryLimit(env: Pick<Env, 'CANDIDATE_INGESTION_RETRY_LIMIT'>): number {
  const raw = env.CANDIDATE_INGESTION_RETRY_LIMIT?.trim();
  if (!raw) return DEFAULT_STALE_WORKERS_AI_RETRY_LIMIT;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_STALE_WORKERS_AI_RETRY_LIMIT;

  return Math.max(1, Math.min(parsed, MAX_STALE_WORKERS_AI_RETRY_LIMIT));
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
    || errorText.includes('cloudflare workers ai returned empty response')
    || errorText.includes('request timeout')
    || errorText.includes('timed out after')
    || errorText.includes('candidate discovery ai failed after');
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

function normalizeTalentPoolArtifactContentType(contentType: string | null | undefined, storageKey: string): string {
  const normalized = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized) return normalized;
  const lowerKey = storageKey.toLowerCase();
  if (lowerKey.endsWith('.pdf')) return 'application/pdf';
  if (lowerKey.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lowerKey.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

function uploadedProfileFileNameFromStorageKey(storageKey: string): string | null {
  const leaf = storageKey.split('/').pop()?.trim() ?? '';
  const match = /^[a-f0-9]{64}-(.+)$/i.exec(leaf);
  return match?.[1]?.trim() || null;
}

function sourceKindFromCustomMetadata(metadata: Record<string, string> | undefined): string | null {
  const sourceKind = metadata?.sourceKind?.trim();
  return sourceKind ? sourceKind : null;
}

function isSyntheticPastedTextProfileKey(storageKey: string, originalFileName: string): boolean {
  return originalFileName.toLowerCase() === 'profile.txt'
    && /\/[a-f0-9]{64}-profile\.txt$/i.test(storageKey);
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function profileUploadReceiptExists(db: D1Database, storageKey: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS receipt_count
       FROM artifact_versions av
       JOIN artifacts a ON a.id = av.artifact_id
       JOIN context_records cr
         ON cr.workspace_person_id = a.workspace_person_id
        AND cr.record_type = 'talent_pool_profile_upload_receipt'
       JOIN context_record_source_refs crsr
         ON crsr.context_record_id = cr.id
        AND crsr.source_ref_type = 'artifact_version'
        AND crsr.source_ref_id = av.id
      WHERE av.storage_key = ?1
        AND (
          a.artifact_type = 'profile_upload'
          OR a.logical_key = 'roleless_candidate_profile_upload'
          OR json_extract(a.metadata_json, '$.evidenceKind') = 'profile_upload_source'
        )`,
  ).bind(storageKey).first<{ receipt_count: number | null }>();
  return Number(row?.receipt_count ?? 0) > 0;
}

async function profileStorageHasSourceSpans(db: D1Database, storageKey: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS source_span_count
       FROM source_spans ss
       JOIN artifact_versions av ON av.id = ss.artifact_version_id
      WHERE av.storage_key = ?1`,
  ).bind(storageKey).first<{ source_span_count: number | null }>();
  return Number(row?.source_span_count ?? 0) > 0;
}

async function buildMissingTalentPoolProfileUploadSourceArtifact(
  env: Env,
  row: TalentPoolOperationalRetryRow,
): Promise<TalentPoolSourceArtifactInput | undefined> {
  const storageKey = row.profile_r2_key?.trim();
  if (!storageKey || !env.STORAGE) return undefined;

  const originalFileName = uploadedProfileFileNameFromStorageKey(storageKey);
  if (!originalFileName) return undefined;
  if (await profileUploadReceiptExists(env.DB, storageKey)) return undefined;

  const object = await env.STORAGE.get(storageKey);
  if (!object) return undefined;

  const bytes = await object.arrayBuffer();
  const sourceKind = sourceKindFromCustomMetadata(object.customMetadata);
  const extractedTextAvailable = await profileStorageHasSourceSpans(env.DB, storageKey);
  if (sourceKind === TALENT_POOL_PASTED_PROFILE_SOURCE_KIND) return undefined;
  if (
    sourceKind !== TALENT_POOL_UPLOADED_PROFILE_SOURCE_KIND
    && isSyntheticPastedTextProfileKey(storageKey, originalFileName)
    && !extractedTextAvailable
  ) {
    return undefined;
  }

  return {
    storageKey,
    mediaType: normalizeTalentPoolArtifactContentType(object.httpMetadata?.contentType, storageKey),
    contentHash: await sha256Hex(bytes),
    byteLength: bytes.byteLength,
    originalFileName,
    extractedTextAvailable,
  };
}

function isTalentPoolProfileTextSource(input: {
  storageKey: string;
  mediaType: string;
  sourceKind: string | null;
}): boolean {
  if (input.sourceKind === TALENT_POOL_PASTED_PROFILE_SOURCE_KIND) return true;
  if (isDocumentSourceKey(input.storageKey)) return false;
  return input.mediaType.startsWith('text/')
    || input.storageKey.toLowerCase().endsWith('.txt');
}

async function buildTalentPoolProfileMessageSource(
  env: Env,
  row: TalentPoolOperationalRetryRow,
): Promise<TalentPoolProfileMessageSource | undefined> {
  const storageKey = row.profile_r2_key?.trim();
  if (!storageKey || !env.STORAGE) return undefined;
  if (isDocumentSourceKey(storageKey)) return undefined;

  const object = await env.STORAGE.get(storageKey);
  if (!object) return undefined;

  const mediaType = normalizeTalentPoolArtifactContentType(object.httpMetadata?.contentType, storageKey);
  const sourceKind = sourceKindFromCustomMetadata(object.customMetadata);
  if (!isTalentPoolProfileTextSource({ storageKey, mediaType, sourceKind })) return undefined;
  if (typeof object.size === 'number' && object.size > MAX_TALENT_POOL_PROFILE_TEXT_REPAIR_BYTES) {
    return undefined;
  }

  const message = (await object.text()).trim();
  if (message.length < 20) return undefined;

  return {
    message,
    storageKey,
    mediaType,
  };
}

async function repairTalentPoolDocumentEvidenceGapState(
  env: Env,
  candidateId: string,
  row: TalentPoolOperationalRetryRow,
): Promise<void> {
  if (!isTalentPoolDocumentEvidenceGapFailure(row)) return;
  await env.DB.prepare(
    `UPDATE candidate_ingestion
        SET status = 'pending',
            current_step = 'profile_text_extraction_needed',
            error_text = NULL,
            updated_at = ?1
      WHERE candidate_id = ?2
        AND status = 'failed'
        AND current_step = 'parse_resume'`,
  ).bind(new Date().toISOString(), candidateId).run();
}

async function repairRolelessTalentPoolOperationalContext(
  env: Env,
  candidateId: string,
): Promise<ResumeLivingContextIdentity | null> {
  const row = await env.DB.prepare(
    `SELECT c.owner_id,
            c.name,
            c.email,
            t.profile_r2_key,
            t.github_url,
            t.linkedin_url,
            t.portfolio_url,
            t.phone_screener_consent,
            t.phone_number,
            t.timezone,
            t.availability,
            t.submitted_at,
            t.updated_at,
            ci.status AS ingestion_status,
            ci.current_step AS ingestion_current_step,
            ci.error_text AS ingestion_error_text
       FROM candidates c
       JOIN talent_pool_intakes t ON t.candidate_id = c.id
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
      WHERE c.id = ?1
        AND c.pipeline_id IS NULL
      LIMIT 1`,
  ).bind(candidateId).first<TalentPoolOperationalRetryRow>();

  const ownerId = row?.owner_id?.trim();
  const email = row?.email?.trim() || null;
  if (!row || !ownerId) return null;
  const sourceArtifact = await buildMissingTalentPoolProfileUploadSourceArtifact(env, row);
  const profileMessageSource = await buildTalentPoolProfileMessageSource(env, row);

  const identity = await ensureRolelessTalentPoolIdentity({
    db: env.DB,
    userId: ownerId,
    candidateId,
    name: row.name?.trim() || email || 'Talent Pool Candidate',
    email,
    message: profileMessageSource?.message,
    messageStorageKey: profileMessageSource?.storageKey ?? null,
    messageMediaType: profileMessageSource?.mediaType ?? null,
    projectMessageAsProfileEvidence: profileMessageSource ? true : undefined,
    operationalContext: {
      githubUrl: row.github_url,
      linkedinUrl: row.linkedin_url,
      portfolioUrl: row.portfolio_url,
      phoneScreenerConsent: row.phone_screener_consent === 1,
      phoneNumber: row.phone_number,
      timezone: row.timezone,
      availability: row.availability,
    },
    sourceArtifact,
    now: row.submitted_at ?? row.updated_at ?? new Date().toISOString(),
  });
  await repairCandidateResumeNodeSourceRefs(env.DB, candidateId);
  await repairCandidateProfileIntakeNodeSourceRefs(env.DB, candidateId);
  await repairTalentPoolDocumentEvidenceGapState(env, candidateId, row);
  return identity;
}

export async function processTalentPoolOperationalContextRepairs(
  env: Env,
  limit = MAX_STALE_WORKERS_AI_RETRY_LIMIT,
): Promise<TalentPoolOperationalContextRepairResult> {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_STALE_WORKERS_AI_RETRY_LIMIT));
  try {
    await repairTalentPoolResumeNodeSourceRefs(env.DB, boundedLimit * 16);
    await repairTalentPoolProfileIntakeNodeSourceRefs(env.DB, boundedLimit * 16);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[talentPoolOperationalContextRepair] source-ref projection repair failed:', msg);
  }

  const rows = await env.DB.prepare(
    `SELECT c.id AS candidate_id
       FROM talent_pool_intakes t
       JOIN candidates c ON c.id = t.candidate_id
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
      WHERE c.pipeline_id IS NULL
        AND (
          (t.github_url IS NOT NULL AND TRIM(t.github_url) <> '')
          OR (t.linkedin_url IS NOT NULL AND TRIM(t.linkedin_url) <> '')
          OR (t.portfolio_url IS NOT NULL AND TRIM(t.portfolio_url) <> '')
          OR t.phone_screener_consent = 1
          OR (t.profile_r2_key IS NOT NULL AND TRIM(t.profile_r2_key) <> '')
          OR EXISTS (
            SELECT 1
              FROM applications app
             WHERE app.legacy_candidate_id = c.id
               AND app.pipeline_id IS NULL
          )
        )
      ORDER BY
        CASE
          WHEN ci.status = 'failed'
           AND ci.current_step = 'parse_resume'
           AND t.profile_r2_key IS NOT NULL
           AND (
             substr(LOWER(t.profile_r2_key), -4) = '.pdf'
             OR substr(LOWER(t.profile_r2_key), -5) = '.docx'
           )
          THEN 0 ELSE 1
        END,
        CASE WHEN t.profile_r2_key IS NOT NULL
          AND TRIM(t.profile_r2_key) <> ''
          AND EXISTS (
            SELECT 1
              FROM workspace_people wp
              JOIN artifacts a ON a.workspace_person_id = wp.id
              JOIN artifact_versions av ON av.artifact_id = a.id
             WHERE json_extract(wp.context_json, '$.talentPool.candidateId') = c.id
               AND av.storage_key = t.profile_r2_key
               AND (
                 a.artifact_type = 'profile_upload'
                 OR a.logical_key = 'roleless_candidate_profile_upload'
                 OR json_extract(a.metadata_json, '$.evidenceKind') = 'profile_upload_source'
               )
               AND NOT EXISTS (
                 SELECT 1
                   FROM context_records cr
                   JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
                  WHERE cr.workspace_person_id = wp.id
                    AND cr.record_type = 'talent_pool_profile_upload_receipt'
                    AND crsr.source_ref_type = 'artifact_version'
                    AND crsr.source_ref_id = av.id
               )
          )
        THEN 0 ELSE 1 END,
        CASE WHEN EXISTS (
          SELECT 1
            FROM candidate_nodes cn
           WHERE cn.candidate_id = c.id
             AND cn.superseded_at IS NULL
             AND cn.source_type = 'resume'
             AND json_extract(cn.extracted_properties_json, '$.source_quote_validated') = 1
             AND COALESCE(json_extract(cn.extracted_properties_json, '$.source_span_id'), '') = ''
             AND (
               cn.source_reference IS NULL
               OR cn.source_reference NOT LIKE 'source_span:%'
             )
        ) THEN 0 ELSE 1 END,
        CASE WHEN EXISTS (
          SELECT 1
            FROM candidate_nodes cn
            JOIN source_spans ss
              ON ss.id = COALESCE(
                json_extract(cn.extracted_properties_json, '$.source_span_id'),
                CASE
                  WHEN cn.source_reference LIKE 'source_span:%' THEN substr(cn.source_reference, 13)
                  ELSE NULL
                END
              )
            JOIN artifact_versions av ON av.id = ss.artifact_version_id
           WHERE cn.candidate_id = c.id
             AND cn.superseded_at IS NULL
             AND cn.source_type IN ('resume', 'talent_pool_profile_intake')
             AND t.profile_r2_key IS NOT NULL
             AND TRIM(t.profile_r2_key) <> ''
             AND COALESCE(av.storage_key, '') <> t.profile_r2_key
        ) THEN 0 ELSE 1 END,
        t.updated_at DESC
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

export async function processTalentPoolRolelessApplicationRepairs(
  env: Env,
  limit = MAX_STALE_WORKERS_AI_RETRY_LIMIT,
): Promise<TalentPoolRolelessApplicationRepairResult> {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_STALE_WORKERS_AI_RETRY_LIMIT));
  const rows = await env.DB.prepare(
    `SELECT app.id AS application_id
       FROM applications app
       JOIN candidates c ON c.id = app.legacy_candidate_id
       JOIN talent_pool_intakes t ON t.candidate_id = c.id
      WHERE c.pipeline_id IS NULL
      ORDER BY t.updated_at DESC
      LIMIT ?1`,
  ).bind(boundedLimit).all<{ application_id: string }>();

  let deletedApplications = 0;
  let deletedPersonRoles = 0;
  let failed = 0;

  for (const row of rows.results ?? []) {
    try {
      const roleResult = await env.DB.prepare(
        `DELETE FROM person_roles WHERE application_id = ?1`,
      ).bind(row.application_id).run();
      deletedPersonRoles += Number(roleResult.meta?.changes ?? 0);

      const appResult = await env.DB.prepare(
        `DELETE FROM applications WHERE id = ?1`,
      ).bind(row.application_id).run();
      deletedApplications += Number(appResult.meta?.changes ?? 0);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[talentPoolRolelessApplicationRepair] failed for ${row.application_id}:`, msg);
    }
  }

  return {
    scanned: rows.results?.length ?? 0,
    deletedApplications,
    deletedPersonRoles,
    failed,
  };
}

interface TalentPoolDocumentRetryPreParsed {
  parseResult: ParseResumeResult;
  resumeText: string;
}

async function buildDocumentRetryPreParsed(
  env: Env,
  resumeS3Key: string,
): Promise<TalentPoolDocumentRetryPreParsed | null> {
  if (!isDocumentSourceKey(resumeS3Key)) return null;
  if (!env.STORAGE) return null;

  const object = await env.STORAGE.get(resumeS3Key);
  if (!object) return null;

  const contentType = normalizeRetryDocumentContentType(object.httpMetadata?.contentType, resumeS3Key);
  const arrayBuffer = await object.arrayBuffer();
  const resumeText = (await extractTextFromResumeFile(arrayBuffer, contentType)).trim();
  if (resumeText.length < 20) return null;

  return {
    parseResult: {
      parsedCV: buildRuleBasedParsedCV(resumeText),
      decompositionResult: null,
    },
    resumeText,
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

  const preParsed = await buildDocumentRetryPreParsed(env, resumeS3Key);
  const isDocumentRetry = isDocumentSourceKey(resumeS3Key);
  const result = await processResumeFromR2({
    env,
    db: env.DB,
    candidateId,
    r2Key: resumeS3Key,
    ...(preParsed ? {
      preParsed: preParsed.parseResult,
      preExtractedResumeText: preParsed.resumeText,
    } : {}),
    ...(isTalentPoolSourceKey(resumeS3Key) ? { livingContextIdentity: rolelessTalentPoolIdentity } : {}),
    ...(isDocumentRetry
      ? {
          candidateDiscoveryTimeoutMs: DOCUMENT_RETRY_DISCOVERY_TIMEOUT_MS,
          candidateDiscoveryMaxAttempts: DOCUMENT_RETRY_DISCOVERY_MAX_ATTEMPTS,
          maxNodeEmbeddings: DOCUMENT_RETRY_MAX_NODE_EMBEDDINGS,
          maxParserOnlyNodes: DOCUMENT_RETRY_MAX_PARSER_ONLY_NODES,
          skipPostDecompositionMaintenance: true,
        }
      : {}),
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
  limit = resolveCandidateIngestionRetryLimit(env),
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
        CASE
          WHEN ci.status = 'failed'
           AND (
             c.resume_s3_key LIKE 'candidate-documents/%'
             OR c.resume_s3_key LIKE 'talent-intake/%'
           )
          THEN 0
          WHEN ci.status = 'failed' THEN 1
          ELSE 0
        END,
        CASE WHEN ci.status = 'pending' THEN ci.updated_at END DESC,
        CASE WHEN ci.status = 'failed' THEN ci.updated_at END DESC
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

export async function processPipelineCandidateIngestionRetries(
  env: Env,
  input: PipelineCandidateIngestionRetryInput,
): Promise<StaleWorkersAIRetryResult> {
  const boundedLimit = Math.max(
    1,
    Math.min(input.limit ?? resolveCandidateIngestionRetryLimit(env), MAX_STALE_WORKERS_AI_RETRY_LIMIT),
  );
  const scanLimit = boundedLimit * STALE_WORKERS_AI_RETRY_SCAN_MULTIPLIER;
  const staleCutoff = new Date(Date.now() - STALE_IN_PROGRESS_RETRY_AFTER_MS).toISOString();
  const rows = await env.DB.prepare(
    `SELECT c.id AS candidate_id,
            c.resume_s3_key,
            ci.status,
            ci.current_step,
            ci.error_text,
            ci.updated_at
       FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
      WHERE c.pipeline_id = ?1
        AND p.owner_id = ?2
        AND c.resume_s3_key IS NOT NULL
        AND (
          ci.candidate_id IS NULL
          OR (
            ci.status = 'failed'
            AND ci.current_step = 'discover_profile'
            AND ci.error_text IS NOT NULL
          )
          OR (
            ci.status = 'pending'
            AND ci.current_step IS NOT NULL
            AND ci.current_step IN ('talent_pool_profile_received', 'queued', 'retry_queued', 'parse_resume', 'decompose_resume', 'discover_profile', 'embed_profile', 'match_and_assign')
            AND ci.updated_at IS NOT NULL
            AND ci.updated_at <= ?3
          )
        )
      ORDER BY
        CASE WHEN ci.candidate_id IS NULL THEN 0 ELSE 1 END,
        CASE WHEN ci.status = 'pending' THEN 0 ELSE 1 END,
        CASE
          WHEN ci.status = 'failed'
           AND (
             c.resume_s3_key LIKE 'candidate-documents/%'
             OR c.resume_s3_key LIKE 'talent-intake/%'
           )
          THEN 0
          WHEN ci.status = 'failed' THEN 1
          ELSE 0
        END,
        CASE WHEN ci.status = 'pending' THEN ci.updated_at END DESC,
        CASE WHEN ci.status = 'failed' THEN ci.updated_at END DESC
      LIMIT ?4`,
  ).bind(input.pipelineId, input.ownerId, staleCutoff, scanLimit).all<RetryableCandidateRow>();

  let queued = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    const retryContext = retryContextForRow(row, 'candidate_rpc');
    if (!row.resume_s3_key || !retryContext) {
      skipped++;
      continue;
    }
    const resumeS3Key = row.resume_s3_key;
    if (queued >= boundedLimit) {
      skipped++;
      continue;
    }

    const retryPromise = queueAndRunRetry(env, row.candidate_id, resumeS3Key, {
      trigger: retryContext.trigger,
      reasonCode: retryContext.reasonCode,
      originalErrorText: retryContext.originalErrorText,
      originalStep: retryContext.originalStep,
      originalUpdatedAt: retryContext.originalUpdatedAt,
    }).catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pipelineIngestionRetry] retry failed for ${row.candidate_id}:`, msg);
      await markRetryFailed(env, row.candidate_id, resumeS3Key, `Retry failed: ${msg}`, {
        trigger: retryContext.trigger,
        reasonCode: retryContext.reasonCode,
        originalErrorText: retryContext.originalErrorText,
        originalStep: retryContext.originalStep,
        originalUpdatedAt: retryContext.originalUpdatedAt,
      });
      throw err;
    });

    if (input.executionCtx) {
      input.executionCtx.waitUntil(retryPromise);
      queued++;
      continue;
    }

    try {
      await retryPromise;
      queued++;
    } catch {
      failed++;
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
