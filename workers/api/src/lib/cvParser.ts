/**
 * CV Parser — Extract structured candidate data from uploaded resumes.
 *
 * Pipeline:
 * 1. Read PDF from R2
 * 2. Extract plain text via unpdf (edge-compatible pdf.js)
 * 3. Call Mistral (mistral-small) for structured JSON extraction
 * 4. Persist skills, role, experience, education to D1
 *
 * Falls back gracefully: if MISTRAL_API_KEY is missing or parsing fails,
 * the upload still succeeds — parsed data is supplementary.
 */

import { extractText } from 'unpdf';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedCV {
  name?: string;
  skills: string[];
  yearsOfExperience?: number;
  currentRole?: string;
  education?: string[];
}

// ─── Config ─────────────────────────────────────────────────────────────────

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
// mistral-small: fast, cheap, reliable for structured extraction (~2-5s)
const MISTRAL_MODEL = 'mistral-small-latest';

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

async function extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return typeof text === 'string' ? text : (text as string[]).join('\n');
}

// ─── LLM Extraction ────────────────────────────────────────────────────────

async function callMistral(apiKey: string, resumeText: string): Promise<ParsedCV> {
  // Truncate to 4000 chars — enough for skills/role extraction, keeps API fast
  const truncated = resumeText.trim().slice(0, 4000);

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Resume Text:\n${truncated}` },
      ],
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[cvParser] Mistral API error', { status: response.status, body: errorText.slice(0, 200) });
    throw new Error(`Mistral API ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const outputText = data.choices?.[0]?.message?.content;
  if (!outputText) throw new Error('No content in Mistral response');

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
  /** Mistral API key — if missing, returns null */
  apiKey?: string;
  /** When true, return mock data instead of calling LLM */
  mock?: boolean;
}

/**
 * Parse a resume file and return structured candidate data.
 * Returns null if parsing is unavailable (no API key) or fails gracefully.
 */
export async function parseResume(input: ParseResumeInput): Promise<ParsedCV | null> {
  if (input.mock) {
    return getMockParsedCV();
  }

  if (!input.apiKey) {
    console.warn('[cvParser] No MISTRAL_API_KEY — skipping CV parsing');
    return null;
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

    console.log('[cvParser] Extracted', text.length, 'chars from PDF, calling Mistral');
    const parsed = await callMistral(input.apiKey, text);
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
