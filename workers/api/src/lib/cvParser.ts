/**
 * CV Parser — Extract structured candidate data from uploaded resumes.
 *
 * Pipeline:
 * 1. Extract plain text via unpdf (edge-compatible pdf.js)
 * 2. Call Gemma 4 26B (Workers AI or Vertex AI) for structured JSON extraction
 * 3. Persist skills, role, experience, education to D1
 *
 * Falls back gracefully: if no AI provider is available or parsing fails,
 * the upload still succeeds — parsed data is supplementary.
 */

import { extractText } from 'unpdf';
import { createCandidateAgentProvider } from './llm/createProvider';
import type { ProviderEnv } from './llm/createProvider';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedCV {
  name?: string;
  skills: string[];
  yearsOfExperience?: number;
  currentRole?: string;
  education?: string[];
}

// ─── Config ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert recruitment assistant. Extract structured data from the following resume text.
Return ONLY valid JSON. Do not include any explanation or markdown formatting.

The JSON should follow this schema:
{
  "name": "Full Name",
  "skills": ["skill1", "skill2"],
  "yearsOfExperience": number,
  "currentRole": "Current Job Title",
  "education": ["Degree 1", "Degree 2"]
}

Rules:
- skills: include programming languages, frameworks, tools, and domain expertise. Max 15 items.
- yearsOfExperience: estimate from work history dates. Use 0 if unclear.
- currentRole: most recent job title. Use null if not found.
- education: include degree + institution. Omit if not found.`;

// ─── Mock ───────────────────────────────────────────────────────────────────

export function getMockParsedCV(): ParsedCV {
  return {
    name: 'Jane Doe',
    skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'AWS', 'GraphQL'],
    yearsOfExperience: 5,
    currentRole: 'Senior Frontend Engineer',
    education: ['B.S. Computer Science, MIT'],
  };
}

// ─── Text Extraction ────────────────────────────────────────────────────────

export async function extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return typeof text === 'string' ? text : (text as string[]).join('\n');
}

// ─── LLM Extraction ────────────────────────────────────────────────────────

async function callProvider(env: ProviderEnv, resumeText: string): Promise<ParsedCV> {
  const provider = createCandidateAgentProvider(env);
  if (!provider) {
    throw new Error('No AI provider available for CV parsing');
  }

  // Truncate to 4000 chars — enough for skills/role extraction, keeps API fast
  const truncated = resumeText.trim().slice(0, 4000);

  const result = await provider.complete(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Resume Text:\n${truncated}` },
    ],
    { forceJson: true, maxTokens: 500 },
  );

  const outputText = result.content;
  if (!outputText) throw new Error('No content in provider response');

  // Strip markdown code fences if present
  const cleaned = outputText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned) as ParsedCV;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ParseResumeInput {
  /** Raw file bytes from R2 */
  fileBuffer: ArrayBuffer;
  /** MIME type of the uploaded file */
  contentType: string;
  /** Worker env / bindings — used to create the AI provider */
  env: ProviderEnv;
  /** When true, return mock data instead of calling LLM */
  mock?: boolean;
}

/**
 * Parse a resume file and return structured candidate data.
 * Returns null if parsing is unavailable (no provider) or fails gracefully.
 */
export async function parseResume(input: ParseResumeInput): Promise<ParsedCV | null> {
  if (input.mock) {
    return getMockParsedCV();
  }

  // Only PDFs are supported for text extraction currently
  if (input.contentType !== 'application/pdf') {
    console.warn('[cvParser] Non-PDF file — skipping parsing:', input.contentType);
    return null;
  }

  try {
    const text = await extractTextFromPDF(input.fileBuffer);

    if (!text || text.trim().length < 20) {
      console.warn('[cvParser] Insufficient text extracted from PDF:', text.length, 'chars');
      return null;
    }

    console.log('[cvParser] Extracted', text.length, 'chars from PDF, calling provider');
    const parsed = await callProvider(input.env, text);
    console.log('[cvParser] Parsed CV:', JSON.stringify(parsed).slice(0, 200));
    return parsed;
  } catch (err) {
    console.error('[cvParser] Parsing failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Persist parsed CV data to the candidates table in D1.
 */
export async function persistParsedCV(
  db: D1Database,
  candidateId: string,
  parsed: ParsedCV,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE candidates
       SET skills = ?, years_of_experience = ?, current_role = ?, education = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      JSON.stringify(parsed.skills ?? []),
      parsed.yearsOfExperience ?? null,
      parsed.currentRole ?? null,
      JSON.stringify(parsed.education ?? []),
      now,
      candidateId,
    )
    .run();
}
