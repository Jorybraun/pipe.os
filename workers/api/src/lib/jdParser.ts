/**
 * Job Description Parser — Extract structured baseline data from raw JD text.
 *
 * Uses a real role-agent provider when available. When AI is unavailable,
 * disabled, or fails, this falls back to source-text-only baseline extraction
 * and intentionally leaves uncertain fields absent. It must never emit a
 * synthetic generic role profile.
 */

import { extractText } from 'unpdf';
import { createRoleAgentProvider } from './llm/createProvider';
import type { ProviderEnv } from './llm/createProvider';

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
- title: the job title, cleaned up (no company name, no "at Company X"). Only use source text.
- level: extract only when explicitly stated in title or requirements. Use null if unclear.
- stack: programming languages, frameworks, tools mentioned. Max 10 items. Only include specific technologies explicitly named in the source.
- department: extract only when explicitly stated. Use null if unclear.
- workModel: Remote, Hybrid, or On-site. Use null if not mentioned.
- location: city/region if mentioned, "Remote" if remote-only. Use null if not mentioned.
- teamSize: extract if mentioned. Use null if not found.
- reportsTo: extract if mentioned. Use null if not found.
- Omit any field you cannot confidently extract (set to null).`;

// ─── Source-text fallback ───────────────────────────────────────────────────

function cleanField(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/^[#*\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:;,]+$/, '')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function firstMeaningfulLine(text: string): string | undefined {
  const ignoredHeadings = new Set([
    'job description',
    'about us',
    'about the role',
    'the role',
    'responsibilities',
    'requirements',
    'qualifications',
    'what you will do',
    'what we are looking for',
  ]);

  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanField(rawLine);
    if (!line) continue;
    if (line.length > 120) continue;
    if (ignoredHeadings.has(line.toLowerCase())) continue;
    return line;
  }

  return undefined;
}

function extractExplicitLevel(text: string): string | undefined {
  const checks: Array<[RegExp, string]> = [
    [/\bprincipal\b/i, 'Principal'],
    [/\bstaff\b/i, 'Staff'],
    [/\bsenior\b|\bsr\.\b|\bsr\b/i, 'Senior'],
    [/\bmid[- ]?level\b|\bmid\b/i, 'Mid'],
    [/\bjunior\b|\bjr\.\b|\bjr\b/i, 'Junior'],
    [/\blead\b/i, 'Lead'],
    [/\bmanager\b/i, 'Manager'],
  ];
  for (const [pattern, level] of checks) {
    if (pattern.test(text)) return level;
  }
  return undefined;
}

function extractWorkModel(text: string): string | undefined {
  if (/\bhybrid\b/i.test(text)) return 'Hybrid';
  if (/\bremote\b/i.test(text)) return 'Remote';
  if (/\bon[- ]?site\b|\bonsite\b|\bin[- ]person\b/i.test(text)) return 'On-site';
  return undefined;
}

function extractLabeledField(text: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^\\s*${escaped}\\s*[:\\-]\\s*(.+)$`, 'im'));
  return cleanField(match?.[1]);
}

function extractTeamSize(text: string): string | undefined {
  const labeled = extractLabeledField(text, 'team size');
  if (labeled) return labeled;

  const match = text.match(/\bteam of\s+([^.\n;,]{1,80})/i);
  return cleanField(match?.[1]);
}

function extractReportsTo(text: string): string | undefined {
  const labeled = extractLabeledField(text, 'reports to');
  if (labeled) return labeled;

  const match = text.match(/\breports?\s+to\s+(?:the\s+)?([^.\n;,]{1,80})/i);
  return cleanField(match?.[1]);
}

function parseSourceTextBaseline(jdText: string): ParsedJD | null {
  const title = firstMeaningfulLine(jdText);
  const level = extractExplicitLevel(title ? `${title}\n${jdText}` : jdText);
  const workModel = extractWorkModel(jdText);
  const location = extractLabeledField(jdText, 'location') ?? (workModel === 'Remote' ? 'Remote' : undefined);
  const department = extractLabeledField(jdText, 'department');
  const teamSize = extractTeamSize(jdText);
  const reportsTo = extractReportsTo(jdText);

  const parsed: ParsedJD = {};
  if (title) parsed.title = title;
  if (level) parsed.level = level;
  if (department) parsed.department = department;
  if (workModel) parsed.workModel = workModel;
  if (location) parsed.location = location;
  if (teamSize) parsed.teamSize = teamSize;
  if (reportsTo) parsed.reportsTo = reportsTo;

  return Object.keys(parsed).length > 0 ? parsed : null;
}

// ─── Text Extraction ────────────────────────────────────────────────────────

async function extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return typeof text === 'string' ? text : (text as string[]).join('\n');
}

// ─── LLM Extraction ────────────────────────────────────────────────────────

async function callProvider(env: ProviderEnv, jdText: string): Promise<ParsedJD> {
  const provider = createRoleAgentProvider(env);
  if (!provider) {
    throw new Error('No AI provider available for JD parsing');
  }

  const truncated = jdText.trim().slice(0, 6000);

  const result = await provider.complete(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Job Description:\n${truncated}` },
    ],
    { forceJson: true, maxTokens: 500 },
  );

  const outputText = result.content;
  if (!outputText) throw new Error('No content in provider response');

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
  /** Worker env / bindings — used to create the AI provider */
  env?: ProviderEnv;
}

/**
 * Parse a job description (text or PDF) and return structured baseline fields.
 */
export async function parseJobDescription(input: ParseJDInput): Promise<ParsedJD | null> {
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

  const aiDisabled = input.env?.MOCK_AI === 'true';

  if (!aiDisabled && input.env) {
    try {
      console.log('[jdParser] Parsing', jdText.length, 'chars of JD text');
      const parsed = await callProvider(input.env, jdText);
      console.log('[jdParser] Parsed JD:', JSON.stringify(parsed).slice(0, 200));
      return parsed;
    } catch (err) {
      console.error('[jdParser] AI parsing failed; using source-text baseline:', err instanceof Error ? err.message : err);
    }
  }

  const fallback = parseSourceTextBaseline(jdText);
  if (fallback) {
    console.log('[jdParser] Parsed source-text JD baseline:', JSON.stringify(fallback).slice(0, 200));
  }
  return fallback;
}
