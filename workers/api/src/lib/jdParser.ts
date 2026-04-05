/**
 * Job Description Parser — Extract structured baseline data from raw JD text.
 *
 * Calls Mistral (mistral-small) to extract title, level, stack, department,
 * work model, location, team size, and reports-to from pasted or uploaded JD text.
 * Same pattern as cvParser.ts.
 */

import { extractText } from 'unpdf';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedJD {
  title?: string;
  level?: string;
  stack?: string[];
  department?: string;
  workModel?: string;
  location?: string;
  teamSize?: string;
  reportsTo?: string;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert recruitment assistant. Extract structured data from the following job description.
Return ONLY valid JSON. Do not include any explanation or markdown formatting.

The JSON should follow this schema:
{
  "title": "Job Title",
  "level": "Junior | Mid | Senior | Staff | Principal | Lead | Manager",
  "stack": ["technology1", "technology2"],
  "department": "Department name",
  "workModel": "Remote | Hybrid | On-site",
  "location": "City, State/Country or Remote",
  "teamSize": "e.g., 4 engineers",
  "reportsTo": "e.g., Engineering Manager"
}

Rules:
- title: the job title, cleaned up (no company name, no "at Company X")
- level: infer from title and requirements. Use null if unclear.
- stack: programming languages, frameworks, tools mentioned. Max 10 items. Only include specific technologies, not generic terms.
- department: infer from context. Use null if unclear.
- workModel: Remote, Hybrid, or On-site. Use null if not mentioned.
- location: city/region if mentioned, "Remote" if remote-only. Use null if not mentioned.
- teamSize: extract if mentioned. Use null if not found.
- reportsTo: extract if mentioned. Use null if not found.
- Omit any field you cannot confidently extract (set to null).`;

// ─── Mock ───────────────────────────────────────────────────────────────────

function getMockParsedJD(): ParsedJD {
  return {
    title: 'Senior Backend Engineer',
    level: 'Senior',
    stack: ['TypeScript', 'Node.js', 'PostgreSQL', 'Kafka', 'AWS'],
    department: 'Engineering',
    workModel: 'Remote',
    location: 'Remote (US)',
    teamSize: '5 engineers',
    reportsTo: 'Engineering Manager',
  };
}

// ─── Text Extraction ────────────────────────────────────────────────────────

async function extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return typeof text === 'string' ? text : (text as string[]).join('\n');
}

// ─── LLM Extraction ────────────────────────────────────────────────────────

async function callMistral(apiKey: string, jdText: string): Promise<ParsedJD> {
  const truncated = jdText.trim().slice(0, 6000);

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Job Description:\n${truncated}` },
      ],
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[jdParser] Mistral API error', { status: response.status, body: errorText.slice(0, 200) });
    throw new Error(`Mistral API ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const outputText = data.choices?.[0]?.message?.content;
  if (!outputText) throw new Error('No content in Mistral response');

  const cleaned = outputText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned) as ParsedJD;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ParseJDInput {
  /** Raw JD text (for paste) */
  text?: string;
  /** File buffer (for PDF upload) */
  fileBuffer?: ArrayBuffer;
  /** MIME type of the uploaded file */
  contentType?: string;
  /** Mistral API key */
  apiKey?: string;
  /** Return mock data */
  mock?: boolean;
}

/**
 * Parse a job description (text or PDF) and return structured baseline fields.
 */
export async function parseJobDescription(input: ParseJDInput): Promise<ParsedJD | null> {
  if (input.mock) {
    return getMockParsedJD();
  }

  if (!input.apiKey) {
    console.warn('[jdParser] No MISTRAL_API_KEY — skipping JD parsing');
    return null;
  }

  let jdText = input.text ?? '';

  // Extract text from PDF if provided
  if (input.fileBuffer && input.contentType === 'application/pdf') {
    try {
      jdText = await extractTextFromPDF(input.fileBuffer);
    } catch (err) {
      console.error('[jdParser] PDF extraction failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  if (!jdText || jdText.trim().length < 20) {
    console.warn('[jdParser] Insufficient text for parsing:', jdText.length, 'chars');
    return null;
  }

  try {
    console.log('[jdParser] Parsing', jdText.length, 'chars of JD text');
    const parsed = await callMistral(input.apiKey, jdText);
    console.log('[jdParser] Parsed JD:', JSON.stringify(parsed).slice(0, 200));
    return parsed;
  } catch (err) {
    console.error('[jdParser] Parsing failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
