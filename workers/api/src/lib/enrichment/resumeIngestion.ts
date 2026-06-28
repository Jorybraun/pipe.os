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
import { parseResume, persistParsedCV, extractTextFromPDF } from '../cvParser';
import { runCandidateIngestion } from '../candidateDiscovery/orchestrate';

export interface ProcessResumeInput {
  env: Env;
  db: D1Database;
  candidateId: string;
  r2Key: string;
  /** Optional: if the caller already parsed the resume, skip re-parsing. */
  preParsed?: Awaited<ReturnType<typeof parseResume>> | null;
}

export interface ProcessResumeResult {
  success: boolean;
  parsed: Awaited<ReturnType<typeof parseResume>> | null;
  error?: string;
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

    const arrayBuffer = await object.arrayBuffer();
    const fileBuffer = arrayBuffer.slice(0);
    const contentType = object.httpMetadata?.contentType ?? 'application/pdf';

    // 2. Parse resume (or use pre-parsed result)
    let parseResult = preParsed ?? null;
    if (!parseResult) {
      parseResult = await parseResume({
        fileBuffer,
        contentType,
        env,
      });
    }

    const parsed = parseResult?.parsedCV ?? null;
    const decompositionResult = parseResult?.decompositionResult ?? null;

    // 3. Persist parsed CV
    if (parsed) {
      await persistParsedCV(db, candidateId, parsed);
    }

    // 4. Run full ingestion pipeline (PDF only — DOCX ingestion can be added later)
    if (contentType === 'application/pdf') {
      try {
        const resumeText = await extractTextFromPDF(arrayBuffer);
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
        // Non-fatal: return success=true because parsing succeeded
      }
    }

    return { success: true, parsed: parseResult };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resumeIngestion] fatal error:', msg);
    return { success: false, parsed: null, error: msg };
  }
}
