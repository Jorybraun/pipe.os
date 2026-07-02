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

const PDF_CONTENT_TYPE = 'application/pdf';
const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ProcessResumeInput {
  env: Env;
  db: D1Database;
  candidateId: string;
  r2Key: string;
  /** Optional: if the caller already parsed the resume, skip re-parsing. */
  preParsed?: Awaited<ReturnType<typeof parseResume>> | null;
  /**
   * Optional caller-provided person identity. Undefined keeps legacy candidate
   * application bridging; null skips living-context projection instead of
   * fabricating an application for roleless Talent Pool intake.
   */
  livingContextIdentity?: ResumeLivingContextIdentity | null;
}

export interface ProcessResumeResult {
  success: boolean;
  parsed: Awaited<ReturnType<typeof parseResume>> | null;
  error?: string;
}

function normalizeResumeContentType(contentType: string | null | undefined, r2Key: string): string {
  const normalized = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (normalized === PDF_CONTENT_TYPE) return PDF_CONTENT_TYPE;
  if (normalized === DOCX_CONTENT_TYPE) return DOCX_CONTENT_TYPE;
  if (r2Key.toLowerCase().endsWith('.pdf')) return PDF_CONTENT_TYPE;
  if (r2Key.toLowerCase().endsWith('.docx')) return DOCX_CONTENT_TYPE;
  return normalized || 'application/octet-stream';
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

    // 2. Parse resume (or use pre-parsed result)
    let parseResult = preParsed ?? null;
    if (!parseResult) {
      parseResult = await parseResume({
        fileBuffer,
        contentType,
        env,
      });
    }

    if (!parseResult) {
      return await failResumeIngestion(
        db,
        candidateId,
        `Resume parsing failed or produced no text for ${r2Key}.`,
      );
    }

    const parsed = parseResult?.parsedCV ?? null;
    const decompositionResult = parseResult?.decompositionResult ?? null;

    if (!parsed) {
      return await failResumeIngestion(
        db,
        candidateId,
        `Resume parsing did not produce a candidate profile for ${r2Key}.`,
      );
    }

    // 3. Persist parsed CV
    await persistParsedCV(db, candidateId, parsed);

    // 4. Run full ingestion pipeline from extracted source text.
    let resumeText = '';
    if (contentType === PDF_CONTENT_TYPE || contentType === DOCX_CONTENT_TYPE) {
      try {
        resumeText = await extractTextFromResumeFile(arrayBuffer, contentType);
        if (resumeText.trim().length < 20) {
          const message = `Resume text extraction produced insufficient source evidence for ${r2Key}.`;
          try {
            await markIngestionFailed(db, candidateId, message);
          } catch (err) {
            console.error('[resumeIngestion] failed to mark insufficient evidence:', err instanceof Error ? err.message : String(err));
          }
          return { success: true, parsed: parseResult, error: message };
        }
        await runCandidateIngestion({
          env,
          db,
          candidateId,
          parsed: parsed ?? { skills: [], experiences: [], educationBlocks: [], credentials: [], projects: [] },
          resumeText,
          decompositionResult,
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
          identity: input.livingContextIdentity,
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
