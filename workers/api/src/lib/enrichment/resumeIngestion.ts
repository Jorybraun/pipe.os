/**
 * Shared resume ingestion helper.
 *
 * Used by:
 *   • Recruiter upload endpoint (routes/cockpit/candidates.ts)
 *   • Candidate INTAKE challenge submission (routes/rpc.ts)
 *
 * Reads a resume PDF from R2, extracts text, parses structured data,
 * persists the parsed CV, and runs the full ingestion pipeline.
 *
 * Never throws — failures are logged and swallowed.
 */

import type { Env } from '../../types';
import { parseResume, persistParsedCV, extractTextFromResumeFile } from '../cvParser';
import { runCandidateIngestion } from '../candidateDiscovery/orchestrate';
import { markIngestionFailed } from '../candidateDiscovery/persist';
import {
  ingestResumeToLivingContext,
  type ResumeLivingContextIdentity,
} from '../livingContext/resumeIngestion';
import {
  ensureRolelessTalentPoolIdentity,
  type TalentPoolOperationalContextInput,
} from '../talentPoolIdentity';

const PDF_CONTENT_TYPE = 'application/pdf';
const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ProcessResumeInput {
  env: Env;
  db: D1Database;
  candidateId: string;
  r2Key: string;
  /** Optional: if the caller already parsed the resume, skip re-parsing. */
  preParsed?: Awaited<ReturnType<typeof parseResume>> | null;
  /** Optional: if the caller already extracted source text, skip extraction replay. */
  preExtractedResumeText?: string | null;
  /**
   * Optional caller-provided person identity. Undefined keeps legacy candidate
   * application bridging; null skips living-context projection instead of
   * fabricating an application for roleless Talent Pool intake.
   */
  livingContextIdentity?: ResumeLivingContextIdentity | null;
  /**
   * Optional bounds for background candidate discovery. Stale retry paths can
   * keep this lower than live uploads so they finish inside Worker waitUntil.
   */
  candidateDiscoveryTimeoutMs?: number;
  candidateDiscoveryMaxAttempts?: number;
  maxNodeEmbeddings?: number;
  maxParserOnlyNodes?: number;
  skipPostDecompositionMaintenance?: boolean;
}

export interface ProcessResumeResult {
  success: boolean;
  parsed: Awaited<ReturnType<typeof parseResume>> | null;
  error?: string;
}

interface RolelessTalentPoolResumeRow {
  candidate_id: string;
  owner_id: string | null;
  name: string | null;
  email: string | null;
  profile_r2_key: string | null;
  profile_text_excerpt: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  phone_screener_consent: number | null;
  phone_number: string | null;
  timezone: string | null;
  availability: string | null;
}

function normalizeResumeContentType(contentType: string | null | undefined, r2Key: string): string {
  const normalized = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === PDF_CONTENT_TYPE) return PDF_CONTENT_TYPE;
  if (normalized === DOCX_CONTENT_TYPE) return DOCX_CONTENT_TYPE;
  if (r2Key.toLowerCase().endsWith('.pdf')) return PDF_CONTENT_TYPE;
  if (r2Key.toLowerCase().endsWith('.docx')) return DOCX_CONTENT_TYPE;
  return normalized || 'application/octet-stream';
}

function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

function isDocumentProfileContentType(contentType: string): boolean {
  return contentType === PDF_CONTENT_TYPE || contentType === DOCX_CONTENT_TYPE;
}

function uploadedProfileFileNameFromStorageKey(storageKey: string): string | null {
  const leaf = storageKey.split('/').pop()?.trim() ?? '';
  const match = /^[a-f0-9]{64}-(.+)$/i.exec(leaf);
  return match?.[1]?.trim() || leaf || null;
}

function isUploadPlaceholderExcerpt(excerpt: string, r2Key: string): boolean {
  const fileName = uploadedProfileFileNameFromStorageKey(r2Key);
  const placeholders = [
    fileName ? `Uploaded ${fileName}` : null,
    fileName ? `Uploaded profile file: ${fileName}` : null,
  ].filter((value): value is string => Boolean(value));

  return placeholders.includes(excerpt.trim());
}

function sourceBackedTalentPoolMessage(input: {
  row: RolelessTalentPoolResumeRow;
  r2Key: string;
  contentType: string;
}): string | undefined {
  const message = optionalTrimmed(input.row.profile_text_excerpt) ?? undefined;
  if (!message) return undefined;
  if (isDocumentProfileContentType(input.contentType) && isUploadPlaceholderExcerpt(message, input.r2Key)) {
    return undefined;
  }
  return message;
}

function talentPoolOperationalContextFromRow(
  row: RolelessTalentPoolResumeRow,
): TalentPoolOperationalContextInput {
  return {
    githubUrl: optionalTrimmed(row.github_url),
    linkedinUrl: optionalTrimmed(row.linkedin_url),
    portfolioUrl: optionalTrimmed(row.portfolio_url),
    phoneScreenerConsent: row.phone_screener_consent === 1,
    phoneNumber: optionalTrimmed(row.phone_number),
    timezone: optionalTrimmed(row.timezone),
    availability: optionalTrimmed(row.availability),
  };
}

async function resolveRolelessTalentPoolResumeIdentity(input: {
  db: D1Database;
  candidateId: string;
  r2Key: string;
  contentType: string;
}): Promise<ResumeLivingContextIdentity | null | undefined> {
  const { db, candidateId, r2Key, contentType } = input;
  let row: RolelessTalentPoolResumeRow | null = null;
  try {
    row = await db.prepare(
      `SELECT
         c.id AS candidate_id,
         c.owner_id,
         c.name,
         c.email,
         t.profile_r2_key,
         t.profile_text_excerpt,
         t.github_url,
         t.linkedin_url,
         t.portfolio_url,
         t.phone_screener_consent,
         t.phone_number,
         t.timezone,
         t.availability
       FROM candidates c
       JOIN talent_pool_intakes t ON t.candidate_id = c.id
      WHERE c.id = ?1
        AND c.pipeline_id IS NULL
      LIMIT 1`,
    ).bind(candidateId).first<RolelessTalentPoolResumeRow>();
  } catch (err) {
    console.error(
      '[resumeIngestion] failed to check roleless Talent Pool identity:',
      err instanceof Error ? err.message : String(err),
    );
    return undefined;
  }

  if (!row) return undefined;

  const userId = optionalTrimmed(row.owner_id);
  const email = optionalTrimmed(row.email);
  if (!userId) {
    console.error('[resumeIngestion] roleless Talent Pool candidate is missing owner:', { candidateId });
    return null;
  }

  try {
    const message = sourceBackedTalentPoolMessage({ row, r2Key, contentType });
    const identity = await ensureRolelessTalentPoolIdentity({
      db,
      userId,
      candidateId,
      name: optionalTrimmed(row.name) ?? email ?? 'Talent Pool Candidate',
      email,
      message,
      messageStorageKey: message ? optionalTrimmed(row.profile_r2_key) ?? r2Key : null,
      messageMediaType: message ? contentType : null,
      operationalContext: talentPoolOperationalContextFromRow(row),
      now: new Date().toISOString(),
    });
    return {
      ...identity,
      applicationId: null,
    };
  } catch (err) {
    console.error(
      '[resumeIngestion] failed to ensure roleless Talent Pool identity:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

async function markResumeIngestionPending(
  db: D1Database,
  candidateId: string,
  step: string,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await db.prepare(
      `INSERT INTO candidate_ingestion (candidate_id, status, current_step, error_text, created_at, updated_at)
       VALUES (?1, 'pending', ?2, NULL, ?3, ?3)
       ON CONFLICT(candidate_id) DO UPDATE SET
         status = 'pending',
         current_step = excluded.current_step,
         error_text = NULL,
         updated_at = excluded.updated_at`,
    ).bind(candidateId, step, now).run();
  } catch (err) {
    console.error('[resumeIngestion] failed to mark pending ingestion:', err instanceof Error ? err.message : String(err));
  }
}

async function failResumeIngestion(
  db: D1Database,
  candidateId: string,
  message: string,
): Promise<ProcessResumeResult> {
  try {
    await markIngestionFailed(db, candidateId, message);
  } catch (err) {
    console.error('[resumeIngestion] failed to mark ingestion failed:', err instanceof Error ? err.message : String(err));
  }
  return { success: false, parsed: null, error: message };
}

async function markTalentPoolDocumentEvidenceGap(
  db: D1Database,
  candidateId: string,
  message: string,
  parsed: ProcessResumeResult['parsed'],
): Promise<ProcessResumeResult> {
  await markResumeIngestionPending(db, candidateId, 'profile_text_extraction_needed');
  return { success: true, parsed, error: message };
}

/**
 * Process a resume stored in R2.
 *
 * 1. Fetch PDF from R2
 * 2. Extract plain text
 * 3. Parse structured CV data
 * 4. Persist parsed CV to candidates table
 * 5. Run full ingestion pipeline (decompose → nodes → embed → match → assign)
 */
export async function processResumeFromR2(
  input: ProcessResumeInput,
): Promise<ProcessResumeResult> {
  const { env, db, candidateId, r2Key, preParsed } = input;

  try {
    // 1. Fetch from R2
    if (!env.STORAGE) {
      return { success: false, parsed: null, error: 'R2 STORAGE binding not configured' };
    }

    const object = await env.STORAGE.get(r2Key);
    if (!object) {
      return { success: false, parsed: null, error: `Resume not found in R2: ${r2Key}` };
    }

    await markResumeIngestionPending(db, candidateId, 'parse_resume');

    const arrayBuffer = await object.arrayBuffer();
    const fileBuffer = arrayBuffer.slice(0);
    const contentType = normalizeResumeContentType(object.httpMetadata?.contentType, r2Key);
    const isTalentPoolProfileDocument = r2Key.startsWith('talent-intake/')
      && isDocumentProfileContentType(contentType);
    const livingContextIdentity = input.livingContextIdentity === undefined
      ? await resolveRolelessTalentPoolResumeIdentity({ db, candidateId, r2Key, contentType })
      : input.livingContextIdentity;

    // 2. Parse resume (or use pre-parsed result)
    let parseResult = preParsed ?? null;
    if (!parseResult) {
      try {
        parseResult = await parseResume({
          fileBuffer,
          contentType,
          env,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isTalentPoolProfileDocument) {
          return await markTalentPoolDocumentEvidenceGap(
            db,
            candidateId,
            `Resume parsing failed or produced no text for ${r2Key}: ${msg}`,
            null,
          );
        }
        throw err;
      }
    }

    if (!parseResult) {
      if (isTalentPoolProfileDocument) {
        return await markTalentPoolDocumentEvidenceGap(
          db,
          candidateId,
          `Resume parsing failed or produced no text for ${r2Key}.`,
          null,
        );
      }
      return await failResumeIngestion(
        db,
        candidateId,
        `Resume parsing failed or produced no text for ${r2Key}.`,
      );
    }

    const parsed = parseResult?.parsedCV ?? null;
    const decompositionResult = parseResult?.decompositionResult ?? null;

    if (!parsed) {
      if (isTalentPoolProfileDocument) {
        return await markTalentPoolDocumentEvidenceGap(
          db,
          candidateId,
          `Resume parsing did not produce a candidate profile for ${r2Key}.`,
          parseResult,
        );
      }
      return await failResumeIngestion(
        db,
        candidateId,
        `Resume parsing did not produce a candidate profile for ${r2Key}.`,
      );
    }

    // 3. Persist parsed CV
    await persistParsedCV(db, candidateId, parsed);

    // 4. Run full ingestion pipeline from extracted source text.
    let resumeText = input.preExtractedResumeText?.trim() ?? '';
    if (isDocumentProfileContentType(contentType)) {
      if (resumeText.length === 0) {
        try {
          resumeText = await extractTextFromResumeFile(arrayBuffer, contentType);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (isTalentPoolProfileDocument) {
            return await markTalentPoolDocumentEvidenceGap(
              db,
              candidateId,
              `Resume text extraction failed for ${r2Key}: ${msg}`,
              parseResult,
            );
          }
          throw err;
        }
      }
      if (resumeText.trim().length < 20) {
        const message = `Resume text extraction produced insufficient source evidence for ${r2Key}.`;
        if (isTalentPoolProfileDocument) {
          return await markTalentPoolDocumentEvidenceGap(db, candidateId, message, parseResult);
        }
        try {
          await markIngestionFailed(db, candidateId, message);
        } catch (err) {
          console.error('[resumeIngestion] failed to mark insufficient evidence:', err instanceof Error ? err.message : String(err));
        }
        return { success: true, parsed: parseResult, error: message };
      }

      try {
        await runCandidateIngestion({
          env,
          db,
          candidateId,
          parsed: parsed ?? { skills: [], experiences: [], educationBlocks: [], credentials: [], projects: [] },
          resumeText,
          decompositionResult,
          mirrorLivingContext: livingContextIdentity === undefined,
          candidateDiscoveryTimeoutMs: input.candidateDiscoveryTimeoutMs,
          candidateDiscoveryMaxAttempts: input.candidateDiscoveryMaxAttempts,
          maxNodeEmbeddings: input.maxNodeEmbeddings,
          maxParserOnlyNodes: input.maxParserOnlyNodes,
          skipPostDecompositionMaintenance: input.skipPostDecompositionMaintenance,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[resumeIngestion] background ingestion error:', msg);
        return await failResumeIngestion(
          db,
          candidateId,
          `Resume ingestion failed after parsing ${r2Key}: ${msg}`,
        );
      }
    } else {
      return await failResumeIngestion(
        db,
        candidateId,
        `Resume ingestion does not support content type ${contentType} for ${r2Key}.`,
      );
    }

    // 5. Ingest into living context graph — real-time, not deferred to scheduled backfill.
    // Creates source-backed person graph entries (interaction, artifact, source spans,
    // assertions, concepts) immediately upon upload.
    if (resumeText.length >= 20) {
      try {
        await ingestResumeToLivingContext(db, {
          candidateId,
          storageKey: r2Key,
          mediaType: contentType,
          resumeText,
          uploadedAt: new Date().toISOString(),
          identity: livingContextIdentity,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[resumeIngestion] living context ingestion error:', msg);
        // Non-fatal: legacy ingestion already succeeded
      }
    }

    return { success: true, parsed: parseResult };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resumeIngestion] fatal error:', msg);
    return await failResumeIngestion(db, candidateId, msg);
  }
}
