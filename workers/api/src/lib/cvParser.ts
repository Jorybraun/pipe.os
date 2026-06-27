/**
 * CV Parser — Extract structured candidate data from uploaded resumes.
 *
 * Pipeline:
 * 1. Extract plain text via unpdf (edge-compatible pdf.js)
 * 2. Rule-based extraction of structured skeleton (experiences, education, credentials, projects)
 * 3. Call LLM (Cloudflare Workers AI Llama 3.1 8B by default) for rich decomposition
 *    (experiences, skills, projects, education, credentials, career_arc)
 * 4. Derive simple ParsedCV fields from the rich decomposition result
 * 5. Persist skills, role, experience, education to D1
 *
 * Falls back gracefully: if no AI provider is available or parsing fails,
 * the upload still succeeds — parsed data is supplementary.
 *
 * ADR-041 Phase 1: Parser now emits structured skeletons for resume decomposition.
 * The rule-based pass is deterministic and fast; LLM does the heavy enrichment.
 */

import { extractText } from 'unpdf';
import { createCandidateAgentProvider } from './llm/createProvider';
import type { ProviderEnv } from './llm/createProvider';
import {
  DECOMPOSITION_SYSTEM_PROMPT,
  buildDecompositionUserMessage,
  type DecompositionResult,
} from './candidateDiscovery/candidateDecompositionPrompt';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedExperience {
  company: string;
  role: string;
  startDate?: string;
  endDate?: string;
  description: string;
  isCurrent?: boolean;
}

export interface ParsedEducation {
  institution: string;
  degree: string;
  field?: string;
  year?: string;
}

export interface ParsedCredential {
  name: string;
  issuer?: string;
  year?: string;
}

export interface ParsedProject {
  name: string;
  description: string;
  url?: string;
}

export interface ParsedCV {
  name?: string;
  skills: string[];
  yearsOfExperience?: number;
  currentRole?: string;
  education?: string[];
  /** Structured work history extracted via rule-based heuristics */
  experiences: ParsedExperience[];
  /** Structured education blocks */
  educationBlocks: ParsedEducation[];
  /** Certifications and credentials */
  credentials: ParsedCredential[];
  /** Projects mentioned in the resume */
  projects: ParsedProject[];
}

export interface ParseResumeResult {
  parsedCV: ParsedCV;
  decompositionResult: DecompositionResult | null;
}

// ─── Mock ───────────────────────────────────────────────────────────────────

export function getMockParsedCV(): ParsedCV {
  return {
    name: 'Jane Doe',
    skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'AWS', 'GraphQL'],
    yearsOfExperience: 5,
    currentRole: 'Senior Frontend Engineer',
    education: ['B.S. Computer Science, MIT'],
    experiences: [
      {
        company: 'Acme Corp',
        role: 'Senior Frontend Engineer',
        startDate: '2022-01',
        endDate: '2024-05',
        description: 'Led frontend migration to React 18 and TypeScript.',
        isCurrent: false,
      },
    ],
    educationBlocks: [
      {
        institution: 'MIT',
        degree: 'B.S.',
        field: 'Computer Science',
        year: '2019',
      },
    ],
    credentials: [],
    projects: [
      {
        name: 'Open-source CLI tool',
        description: 'A TypeScript utility for data processing.',
        url: 'https://github.com/janedoe/cli-tool',
      },
    ],
  };
}

export function getMockDecompositionResult(): DecompositionResult {
  return {
    candidate_name: 'Jane Doe',
    experiences: [
      {
        company: 'Acme Corp',
        role: 'Senior Frontend Engineer',
        duration_months: 28,
        team_size: '5-10',
        scope: 'service',
        narrative: 'Led frontend migration to React 18 and TypeScript.',
        skills_demonstrated: ['typescript', 'react'],
        confidence: 0.9,
      },
    ],
    projects: [
      {
        name: 'Open-source CLI tool',
        description: 'A TypeScript utility for data processing.',
        url: 'https://github.com/janedoe/cli-tool',
        skills_demonstrated: ['typescript', 'node.js'],
        confidence: 0.85,
      },
    ],
    skills: [
      { name: 'typescript', proficiency: 'expert', years_exposure: 5, confidence: 0.95 },
      { name: 'react', proficiency: 'expert', confidence: 0.95 },
      { name: 'node.js', proficiency: 'proficient', confidence: 0.85 },
      { name: 'postgresql', proficiency: 'familiar', confidence: 0.7 },
      { name: 'aws', proficiency: 'familiar', confidence: 0.65 },
      { name: 'graphql', proficiency: 'familiar', confidence: 0.65 },
    ],
    education: [
      {
        institution: 'MIT',
        degree: 'B.S.',
        field: 'Computer Science',
        year: '2019',
        confidence: 0.95,
      },
    ],
    credentials: [],
    career_arc: {
      narrative: 'Steady progression from junior to senior frontend engineer.',
      growth_velocity: 'normal',
      transitions: [{ from: 'Junior Developer', to: 'Senior Frontend Engineer', at_company: 'Acme Corp' }],
      confidence: 0.85,
    },
  };
}

// ─── Text Extraction ────────────────────────────────────────────────────────

export async function extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
  try {
    // Preserve page boundaries so section headers and column layouts don't
    // bleed across pages. Each page is separated by a blank line.
    // Clone buffer because unpdf's extractText may detach the original ArrayBuffer.
    const cloned = buffer.slice(0);
    const { text } = await extractText(new Uint8Array(cloned), { mergePages: false });
    const pages = Array.isArray(text) ? text : [text as string];
    const raw = pages.map((p) => p.replace(/\x00/g, '').trim()).join('\n\n');
    const cleaned = raw.trim();
    console.log(`[cvParser] PDF extraction: ${cleaned.length} chars, ${pages.length} page(s)`);
    console.log('[cvParser] First 400 chars of extracted text:', cleaned.slice(0, 400).replace(/\n/g, ' | '));
    if (cleaned.length === 0) {
      console.warn('[cvParser] PDF extraction returned empty text — possible scanned/image PDF or unsupported fonts');
    }
    return cleaned;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cvParser] PDF extraction failed:', msg);
    throw err;
  }
}

// ─── Rule-Based Structured Extraction ───────────────────────────────────────

const MONTH_NAMES =
  'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec';

const DATE_RANGE_RE = new RegExp(
  `\\b((?:${MONTH_NAMES})[.\\s]+\\d{4}|\\d{1,2}[/\\.]\\d{4}|\\d{4})` +
    `\\s*[-–——]\\s*` +
    `((?:${MONTH_NAMES})[.\\s]+\\d{4}|\\d{1,2}[/\\.]\\d{4}|\\d{4}|present|current|now|today)\\b`,
  'i',
);

const CURRENT_ENDINGS = /present|current|now|today/i;

const SECTION_HEADERS =
  /(?:^|\n)(?:\s*(?:experience|work experience|employment|professional experience|career history|work history|history|professional background)\s*(?:[:\n]|$))/i;

const EDU_SECTION_HEADERS =
  /(?:^|\n)(?:\s*(?:education|academic background|qualifications|degrees|academic|educational background)\s*(?:[:\n]|$))/i;

const CERT_SECTION_HEADERS =
  /(?:^|\n)(?:\s*(?:certifications|certificates|credentials|licenses|accreditations)\s*(?:[:\n]|$))/i;

const PROJECT_SECTION_HEADERS =
  /(?:^|\n)(?:\s*(?:projects|personal projects|side projects|open source|open-source|portfolio)\s*(?:[:\n]|$))/i;

const GITHUB_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+/gi;

function normalizeDate(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();
  if (CURRENT_ENDINGS.test(trimmed)) return undefined;
  // Try to normalize to YYYY-MM
  const m = trimmed.match(/(\d{4})/);
  if (m) return m[1];
  return trimmed;
}

function isCompanyName(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  // Heuristic: company names often have Inc, LLC, Corp, Ltd, or are capitalized
  if (/\b(Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation|Company|Co\.?|GmbH|AG|BV)\b/i.test(trimmed))
    return true;
  // Capitalized words without bullet markers
  if (/^[A-Z][a-zA-Z0-9 &.,'-]+$/.test(trimmed) && !/^[-•·*\d]/.test(trimmed)) return true;
  return false;
}

function isRoleTitle(line: string): boolean {
  const trimmed = line.trim();
  const roleKeywords =
    /\b(Engineer|Developer|Manager|Director|Architect|Lead|Principal|Staff|Senior|Junior|Intern|Consultant|Analyst|Designer|Product|DevOps|Data|Frontend|Backend|Fullstack|Full-stack)\b/i;
  return roleKeywords.test(trimmed) && trimmed.length < 80;
}

function extractSection(text: string, headerRe: RegExp): string {
  const match = text.match(headerRe);
  if (!match) return '';
  const start = match.index! + match[0].length;
  // Find next major section header
  const nextHeader = text.slice(start).search(/\n(?:\s*(?:experience|education|projects|skills|certifications|summary|objective|contact|references)\s*(?:\n|$))/i);
  if (nextHeader === -1) return text.slice(start);
  return text.slice(start, start + nextHeader);
}

export function extractExperiences(text: string): ParsedExperience[] {
  const section = extractSection(text, SECTION_HEADERS);
  if (!section.trim()) return [];

  const experiences: ParsedExperience[] = [];
  const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);

  let current: Partial<ParsedExperience> | null = null;
  const descriptionLines: string[] = [];

  function flush() {
    if (current && current.company && current.role) {
      experiences.push({
        company: current.company,
        role: current.role,
        startDate: current.startDate,
        endDate: current.endDate,
        description: descriptionLines.join(' ').trim(),
        isCurrent: current.isCurrent ?? false,
      });
    }
    current = null;
    descriptionLines.length = 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const dateMatch = line.match(DATE_RANGE_RE);

    if (dateMatch) {
      // New experience block likely starts here or previous line
      flush();
      const startDate = normalizeDate(dateMatch[1]!);
      const endDateRaw = dateMatch[2]!;
      const endDate = normalizeDate(endDateRaw);
      const isCurrent = CURRENT_ENDINGS.test(endDateRaw);

      // Look back one line for company/role if available
      const prevLine = i > 0 ? lines[i - 1]! : '';
      let company = '';
      let role = '';

      const withoutDate = line
        .replace(dateMatch[0], '')
        .trim()
        .replace(/\s*\([^)]*\)\s*$/, '')  // strip duration like "(1 year 3 months)"
        .replace(/\s*[–—\-|,:]\s*$/, '')  // then strip trailing punctuation
        .trim();

      if (isCompanyName(prevLine) && isRoleTitle(withoutDate)) {
        company = prevLine;
        role = withoutDate;
      } else if (isRoleTitle(prevLine) && isCompanyName(withoutDate)) {
        role = prevLine;
        company = withoutDate;
      } else {
        // Try to split the line itself
        const parts = withoutDate.split(/\s*[|,]\s*/);
        if (parts.length >= 2) {
          company = parts[0]!;
          role = parts[1]!;
        } else if (isCompanyName(withoutDate)) {
          company = withoutDate;
          role = 'Unknown';
        } else {
          company = 'Unknown';
          role = withoutDate || 'Unknown';
        }
      }

      current = { company, role, startDate, endDate, isCurrent };
      continue;
    }

    if (current) {
      // Check if this line looks like a new company/role header (no date yet)
      if (isCompanyName(line) && i + 1 < lines.length && lines[i + 1]!.match(DATE_RANGE_RE)) {
        flush();
        continue;
      }
      descriptionLines.push(line);
    }
  }

  flush();
  return experiences;
}

export function extractEducationBlocks(text: string): ParsedEducation[] {
  const section = extractSection(text, EDU_SECTION_HEADERS);
  if (!section.trim()) return [];

  const blocks: ParsedEducation[] = [];
  const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const nextLine = lines[i + 1];

    // Multi-line format: institution on one line, degree info on the next
    // e.g. "Hyper Island" / "E-commerce Marketing · (2013 - 2014) Stockholm, Sweden"
    if (nextLine && !hasYear(line) && hasYear(nextLine)) {
      const institution = line;
      const degreeInfo = nextLine;
      const year = degreeInfo.match(/\((\d{4})\s*[-–—]\s*(?:\d{4}|present)\)/)?.[1]
        ?? degreeInfo.match(/\b(\d{4})\b/)?.[1];
      // Split on middle-dot or strip parenthetical year, then take the degree part
      const degreeField = degreeInfo
        .replace(/\([^)]*\)/, '')
        .split('·')[0]!
        .replace(/,\s*[A-Za-z\s]+$/, '')
        .trim();
      let degree = degreeField;
      let field: string | undefined;
      const dfMatch = degreeField.match(/^((?:B\.?S\.?|M\.?S\.?|Ph\.?D\.?|B\.?A\.?|M\.?A\.?|M\.?B\.?A\.?|B\.?E\.?|M\.?E\.?|B\.?Tech\.?|M\.?Tech\.?|B\.?Eng\.?|M\.?Eng\.?)[^,]*)[,\s]+in\s+(.+)$/i);
      if (dfMatch) {
        degree = dfMatch[1]!.trim();
        field = dfMatch[2]!.trim();
      } else {
        const spaceMatch = degreeField.match(/^((?:B\.?S\.?|M\.?S\.?|Ph\.?D\.?|B\.?A\.?|M\.?A\.?|M\.?B\.?A\.?)[^,\s]*)\s+(.+)$/i);
        if (spaceMatch) {
          degree = spaceMatch[1]!.trim();
          field = spaceMatch[2]!.trim();
        }
      }
      blocks.push({ institution, degree: degree || 'Unknown', field, year });
      i++; // skip next line
      continue;
    }

    // Pattern: "B.S. Computer Science, MIT, 2019"
    const m = line.match(
      /^(?:([^,]+),\s*)?([A-Za-z][\w\s.&'-]+?)\s*,?\s*(\d{4})?\s*$/,
    );
    if (m) {
      const degreeField = m[1]?.trim() || '';
      const institution = m[2]!.trim();
      const year = m[3]?.trim();

      let degree = degreeField;
      let field: string | undefined;
      const dfMatch = degreeField.match(/^((?:B\.?S\.?|M\.?S\.?|Ph\.?D\.?|B\.?A\.?|M\.?A\.?|M\.?B\.?A\.?|B\.?E\.?|M\.?E\.?|B\.?Tech\.?|M\.?Tech\.?|B\.?Eng\.?|M\.?Eng\.?)[^,]*)[,\s]+in\s+(.+)$/i);
      if (dfMatch) {
        degree = dfMatch[1]!.trim();
        field = dfMatch[2]!.trim();
      } else {
        const simpleMatch = degreeField.match(/^((?:B\.?S\.?|M\.?S\.?|Ph\.?D\.?|B\.?A\.?|M\.?A\.?|M\.?B\.?A\.?)[^,\s]*)\s+(.+)$/i);
        if (simpleMatch) {
          degree = simpleMatch[1]!.trim();
          field = simpleMatch[2]!.trim();
        }
      }

      if (institution && institution.length > 2) {
        blocks.push({ institution, degree: degree || 'Unknown', field, year });
      }
      continue;
    }

    // Pattern: "MIT — B.S. Computer Science (2019)"
    const m2 = line.match(/^([A-Za-z][\w\s.&'-]+?)\s*[-–—]\s*(.+?)\s*(?:\((\d{4})\))?\s*$/);
    if (m2) {
      const institution = m2[1]!.trim();
      const degreeField = m2[2]!.trim();
      const year = m2[3]?.trim();
      let degree = degreeField;
      let field: string | undefined;
      const dfMatch = degreeField.match(/^((?:B\.?S\.?|M\.?S\.?|Ph\.?D\.?)[^,]*)[,\s]+in\s+(.+)$/i);
      if (dfMatch) {
        degree = dfMatch[1]!.trim();
        field = dfMatch[2]!.trim();
      } else {
        const spaceMatch = degreeField.match(/^((?:B\.?S\.?|M\.?S\.?|Ph\.?D\.?|B\.?A\.?|M\.?A\.?|M\.?B\.?A\.?)[^,\s]*)\s+(.+)$/i);
        if (spaceMatch) {
          degree = spaceMatch[1]!.trim();
          field = spaceMatch[2]!.trim();
        }
      }
      blocks.push({ institution, degree: degree || 'Unknown', field, year });
    }
  }

  return blocks;
}

function hasYear(line: string): boolean {
  return /\b\d{4}\b/.test(line);
}

export function extractCredentials(text: string): ParsedCredential[] {
  const section = extractSection(text, CERT_SECTION_HEADERS);
  if (!section.trim()) return [];

  const creds: ParsedCredential[] = [];
  const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Pattern: "AWS Certified Solutions Architect — Amazon, 2020"
    const m = line.match(/^(.+?)\s*(?:[-–—]|,)\s*(.+?)(?:,\s*(\d{4}))?\s*$/);
    if (m) {
      const name = m[1]!.trim();
      const issuer = m[2]!.trim();
      const year = m[3]?.trim();
      if (name.length > 2) {
        creds.push({ name, issuer: issuer.length > 2 ? issuer : undefined, year });
      }
    }
  }

  return creds;
}

export function extractProjects(text: string): ParsedProject[] {
  const section = extractSection(text, PROJECT_SECTION_HEADERS);
  const projects: ParsedProject[] = [];

  // Extract standalone projects from section
  if (section.trim()) {
    const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Look for project name + description patterns
      const m = line.match(/^[-•·*]\s*(.+?)\s+[-–—:]\s+(.+)$/);
      if (m) {
        const name = m[1]!.trim();
        const description = m[2]!.trim();
        const url = line.match(GITHUB_URL_RE)?.[0];
        projects.push({ name, description, url });
      } else if (line.match(GITHUB_URL_RE)) {
        // Line is mostly a URL
        const url = line.match(GITHUB_URL_RE)![0];
        const name = url.split('/').pop() || 'Unknown Project';
        const description = lines[i + 1] && !lines[i + 1]!.match(GITHUB_URL_RE) ? lines[i + 1]! : '';
        projects.push({ name, description, url });
      }
    }
  }

  // Also scan full text for GitHub URLs in bullet points (projects embedded in experience descriptions)
  const allLines = text.split('\n');
  for (const line of allLines) {
    const urls = line.match(GITHUB_URL_RE);
    if (urls && !projects.some((p) => p.url === urls[0])) {
      const name = urls[0].split('/').pop() || 'Unknown Project';
      const desc = line.replace(urls[0], '').replace(/^[-•·*]\s*/, '').trim();
      projects.push({ name, description: desc || 'Project referenced in resume.', url: urls[0] });
    }
  }

  return projects.slice(0, 20); // Cap to avoid noise
}

// ─── Decomposition LLM ──────────────────────────────────────────────────────

function safeParseJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boundedConfidence(value: unknown, fallback = 0.6): number {
  const numeric = optionalNumber(value) ?? fallback;
  return Math.max(0, Math.min(1, numeric));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

type DecompositionExperience = DecompositionResult['experiences'][number];
type DecompositionProject = DecompositionResult['projects'][number];
type DecompositionSkill = DecompositionResult['skills'][number];
type DecompositionEducation = DecompositionResult['education'][number];
type DecompositionCredential = DecompositionResult['credentials'][number];
type DecompositionCareerArc = DecompositionResult['career_arc'];
type SemanticTermRecord = NonNullable<DecompositionSkill['semantic_terms']>[number];

function normalizeSemanticTerms(value: unknown): SemanticTermRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const terms = value.flatMap((entry): SemanticTermRecord[] => {
    if (!isRecord(entry)) return [];
    const surface = optionalString(entry.surface);
    const canonicalKey = optionalString(entry.canonical_key);
    if (!surface || !canonicalKey) return [];
    return [{
      surface,
      canonical_key: canonicalKey,
      ...(optionalString(entry.evidence_level) ? { evidence_level: optionalString(entry.evidence_level) } : {}),
    }];
  });
  return terms.length > 0 ? terms : undefined;
}

function normalizeScope(value: unknown): DecompositionExperience['scope'] | undefined {
  return value === 'feature' || value === 'service' || value === 'platform' || value === 'org'
    ? value
    : undefined;
}

function normalizeExperience(value: unknown): DecompositionExperience | null {
  if (!isRecord(value)) return null;
  const company = optionalString(value.company);
  const role = optionalString(value.role);
  const narrative = optionalString(value.narrative);
  if (!company || !role || !narrative) return null;
  const semanticTerms = normalizeSemanticTerms(value.semantic_terms);
  return {
    company,
    role,
    duration_months: optionalNumber(value.duration_months) ?? 0,
    narrative,
    skills_demonstrated: stringArray(value.skills_demonstrated),
    confidence: boundedConfidence(value.confidence),
    ...(optionalString(value.team_size) ? { team_size: optionalString(value.team_size) } : {}),
    ...(normalizeScope(value.scope) ? { scope: normalizeScope(value.scope) } : {}),
    ...(optionalString(value.domain) ? { domain: optionalString(value.domain) } : {}),
    ...(optionalString(value.company_stage) ? { company_stage: optionalString(value.company_stage) } : {}),
    ...(optionalString(value.impact_summary) ? { impact_summary: optionalString(value.impact_summary) } : {}),
    ...(semanticTerms ? { semantic_terms: semanticTerms } : {}),
    ...(optionalString(value.source_quote) ? { source_quote: optionalString(value.source_quote) } : {}),
  };
}

function normalizeProject(value: unknown): DecompositionProject | null {
  if (!isRecord(value)) return null;
  const name = optionalString(value.name);
  const description = optionalString(value.description);
  if (!name || !description) return null;
  const semanticTerms = normalizeSemanticTerms(value.semantic_terms);
  return {
    name,
    description,
    skills_demonstrated: stringArray(value.skills_demonstrated),
    confidence: boundedConfidence(value.confidence),
    ...(optionalString(value.url) ? { url: optionalString(value.url) } : {}),
    ...(semanticTerms ? { semantic_terms: semanticTerms } : {}),
    ...(optionalString(value.source_quote) ? { source_quote: optionalString(value.source_quote) } : {}),
  };
}

function normalizeSkill(value: unknown): DecompositionSkill | null {
  if (!isRecord(value)) return null;
  const name = optionalString(value.name);
  if (!name) return null;
  const proficiency = value.proficiency === 'expert'
    || value.proficiency === 'proficient'
    || value.proficiency === 'familiar'
    || value.proficiency === 'exposure'
    ? value.proficiency
    : 'exposure';
  const semanticTerms = normalizeSemanticTerms(value.semantic_terms);
  return {
    name: name.toLowerCase(),
    proficiency,
    confidence: boundedConfidence(value.confidence),
    ...(optionalNumber(value.years_exposure) !== undefined ? { years_exposure: optionalNumber(value.years_exposure) } : {}),
    ...(optionalString(value.evidence_source) ? { evidence_source: optionalString(value.evidence_source) } : {}),
    ...(optionalString(value.depth_pattern) ? { depth_pattern: optionalString(value.depth_pattern) } : {}),
    ...(semanticTerms ? { semantic_terms: semanticTerms } : {}),
    ...(optionalString(value.source_quote) ? { source_quote: optionalString(value.source_quote) } : {}),
  };
}

function normalizeEducation(value: unknown): DecompositionEducation | null {
  if (!isRecord(value)) return null;
  const institution = optionalString(value.institution);
  const degree = optionalString(value.degree);
  if (!institution || !degree) return null;
  const semanticTerms = normalizeSemanticTerms(value.semantic_terms);
  return {
    institution,
    degree,
    confidence: boundedConfidence(value.confidence),
    ...(optionalString(value.field) ? { field: optionalString(value.field) } : {}),
    ...(optionalString(value.year) ? { year: optionalString(value.year) } : {}),
    ...(semanticTerms ? { semantic_terms: semanticTerms } : {}),
    ...(optionalString(value.source_quote) ? { source_quote: optionalString(value.source_quote) } : {}),
  };
}

function normalizeCredential(value: unknown): DecompositionCredential | null {
  if (!isRecord(value)) return null;
  const name = optionalString(value.name);
  if (!name) return null;
  const semanticTerms = normalizeSemanticTerms(value.semantic_terms);
  return {
    name,
    confidence: boundedConfidence(value.confidence),
    ...(optionalString(value.issuer) ? { issuer: optionalString(value.issuer) } : {}),
    ...(optionalString(value.year) ? { year: optionalString(value.year) } : {}),
    ...(semanticTerms ? { semantic_terms: semanticTerms } : {}),
    ...(optionalString(value.source_quote) ? { source_quote: optionalString(value.source_quote) } : {}),
  };
}

function normalizeGrowthVelocity(value: unknown): DecompositionCareerArc['growth_velocity'] {
  return value === 'fast' || value === 'normal' || value === 'slow' ? value : 'normal';
}

function normalizeCareerArc(value: unknown): DecompositionCareerArc | null {
  if (!isRecord(value)) return null;
  const narrative = optionalString(value.narrative);
  if (!narrative) return null;
  const semanticTerms = normalizeSemanticTerms(value.semantic_terms);
  const transitions = Array.isArray(value.transitions)
    ? value.transitions.flatMap((entry): DecompositionCareerArc['transitions'] => {
        if (!isRecord(entry)) return [];
        const from = optionalString(entry.from);
        const to = optionalString(entry.to);
        const atCompany = optionalString(entry.at_company);
        return from && to && atCompany ? [{ from, to, at_company: atCompany }] : [];
      })
    : [];
  return {
    narrative,
    growth_velocity: normalizeGrowthVelocity(value.growth_velocity),
    transitions,
    confidence: boundedConfidence(value.confidence),
    ...(semanticTerms ? { semantic_terms: semanticTerms } : {}),
    ...(optionalString(value.source_quote) ? { source_quote: optionalString(value.source_quote) } : {}),
  };
}

function buildFallbackCareerArc(
  experiences: DecompositionExperience[],
  projects: DecompositionProject[],
  skills: DecompositionSkill[],
): DecompositionCareerArc {
  const narrative =
    experiences[0]?.narrative
    ?? projects[0]?.description
    ?? (skills.length > 0 ? `Candidate evidence mentions ${skills.slice(0, 5).map((skill) => skill.name).join(', ')}.` : 'Candidate supplied resume evidence.');
  return {
    narrative,
    growth_velocity: 'normal',
    transitions: [],
    confidence: 0.5,
  };
}

function normalizeDecompositionResult(value: unknown): DecompositionResult | null {
  if (!isRecord(value)) return null;

  const experiences = Array.isArray(value.experiences) ? value.experiences.flatMap((entry) => {
    const normalized = normalizeExperience(entry);
    return normalized ? [normalized] : [];
  }) : [];
  const projects = Array.isArray(value.projects) ? value.projects.flatMap((entry) => {
    const normalized = normalizeProject(entry);
    return normalized ? [normalized] : [];
  }) : [];
  const skills = Array.isArray(value.skills) ? value.skills.flatMap((entry) => {
    const normalized = normalizeSkill(entry);
    return normalized ? [normalized] : [];
  }) : [];
  const education = Array.isArray(value.education) ? value.education.flatMap((entry) => {
    const normalized = normalizeEducation(entry);
    return normalized ? [normalized] : [];
  }) : [];
  const credentials = Array.isArray(value.credentials) ? value.credentials.flatMap((entry) => {
    const normalized = normalizeCredential(entry);
    return normalized ? [normalized] : [];
  }) : [];
  const careerArc = normalizeCareerArc(value.career_arc);

  if (
    experiences.length === 0
    && projects.length === 0
    && skills.length === 0
    && education.length === 0
    && credentials.length === 0
    && !careerArc
  ) {
    return null;
  }

  return {
    ...(optionalString(value.candidate_name) ? { candidate_name: optionalString(value.candidate_name) } : {}),
    experiences,
    projects,
    skills,
    education,
    credentials,
    career_arc: careerArc ?? buildFallbackCareerArc(experiences, projects, skills),
    ...(optionalString(value.domain_specialization) ? { domain_specialization: optionalString(value.domain_specialization) } : {}),
    ...(stringArray(value.company_stage_pattern).length > 0 ? { company_stage_pattern: stringArray(value.company_stage_pattern) } : {}),
    ...(optionalString(value.ownership_progression) ? { ownership_progression: optionalString(value.ownership_progression) } : {}),
    ...(stringArray(value.impact_themes).length > 0 ? { impact_themes: stringArray(value.impact_themes) } : {}),
  };
}

async function callDecompositionLLM(
  env: ProviderEnv,
  parsedCV: ParsedCV,
  resumeText: string,
): Promise<DecompositionResult | null> {
  const provider = createCandidateAgentProvider(env);
  if (!provider) {
    console.warn('[cvParser] No AI provider available for decomposition');
    return null;
  }

  const userMessage = buildDecompositionUserMessage({ parsed: parsedCV, resumeText });

  console.log('[cvParser] Decomposition prompt length:', DECOMPOSITION_SYSTEM_PROMPT.length, 'system +', userMessage.length, 'user');

  // Use proper system + user messages. The provider layer handles model-specific
  // quirks (e.g. Gemma ignoring system messages on Vertex AI).
  const result = await provider.complete(
    [
      { role: 'system', content: DECOMPOSITION_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    { forceJson: true, maxTokens: 4096 },
  );

  const outputText = result.content;
  if (!outputText) {
    console.warn('[cvParser] Decomposition LLM returned empty content');
    return null;
  }

  const cleaned = outputText
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();

  const parsed = safeParseJson<unknown>(cleaned);
  const normalized = normalizeDecompositionResult(parsed);
  if (!normalized) {
    console.warn('[cvParser] Decomposition JSON parse failed. Raw output length:', outputText.length);
    console.warn('[cvParser] First 500 chars:', outputText.slice(0, 500));
    return null;
  }

  console.log('[cvParser] Decomposition parsed OK:', {
    experiences: normalized.experiences.length,
    skills: normalized.skills.length,
    education: normalized.education.length,
    projects: normalized.projects.length,
    credentials: normalized.credentials.length,
    careerArc: normalized.career_arc ? 'yes' : 'no',
    candidateName: normalized.candidate_name ? 'yes' : 'no',
  });

  return normalized;
}

// ─── Derive ParsedCV from DecompositionResult ───────────────────────────────

function deriveParsedCVFromDecomposition(
  decomposition: DecompositionResult,
  ruleBased: {
    experiences: ParsedExperience[];
    educationBlocks: ParsedEducation[];
    credentials: ParsedCredential[];
    projects: ParsedProject[];
  },
): ParsedCV {
  const totalMonths = decomposition.experiences.reduce((sum, e) => sum + (e.duration_months ?? 0), 0);
  const yearsOfExperience = totalMonths > 0 ? Math.round(totalMonths / 12) : undefined;

  // Most recent experience → currentRole
  const currentRole = decomposition.experiences[0]?.role;

  // Derive education strings
  const education = decomposition.education.map((edu) => {
    const parts: string[] = [edu.degree];
    if (edu.field) parts.push(`in ${edu.field}`);
    parts.push(edu.institution);
    if (edu.year) parts.push(`(${edu.year})`);
    return parts.join(' ');
  });

  // Use decomposition experiences when rule-based failed (common for complex PDFs)
  const experiences = ruleBased.experiences.length > 0
    ? ruleBased.experiences
    : decomposition.experiences.map((e) => ({
        company: e.company,
        role: e.role,
        description: e.narrative,
      }));

  const educationBlocks = ruleBased.educationBlocks.length > 0
    ? ruleBased.educationBlocks
    : decomposition.education.map((e) => ({
        institution: e.institution,
        degree: e.degree,
        field: e.field,
        year: e.year,
      }));

  return {
    name: decomposition.candidate_name,
    skills: decomposition.skills.map((s) => s.name),
    yearsOfExperience,
    currentRole,
    education: education.length > 0 ? education : undefined,
    experiences,
    educationBlocks,
    credentials: ruleBased.credentials,
    projects: ruleBased.projects.length > 0 ? ruleBased.projects : decomposition.projects.map((p) => ({
      name: p.name,
      description: p.description,
      url: p.url,
    })),
  };
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

export interface ParseResumeTextInput {
  /** Plain text resume/intake evidence. */
  resumeText: string;
  /** Worker env / bindings — used to create the AI provider. */
  env: ProviderEnv;
  /** When true, return mock data instead of calling LLM. */
  mock?: boolean;
}

function buildRuleBasedParsedCV(text: string): ParsedCV {
  return {
    skills: [],
    experiences: extractExperiences(text),
    educationBlocks: extractEducationBlocks(text),
    credentials: extractCredentials(text),
    projects: extractProjects(text),
  };
}

export async function parseResumeText(input: ParseResumeTextInput): Promise<ParseResumeResult | null> {
  if (input.mock) {
    return {
      parsedCV: getMockParsedCV(),
      decompositionResult: getMockDecompositionResult(),
    };
  }

  const text = input.resumeText.trim();
  if (text.length < 20) {
    console.warn('[cvParser] Insufficient resume text:', text.length, 'chars');
    return null;
  }

  let decomposition: DecompositionResult | null = null;
  try {
    decomposition = await callDecompositionLLM(
      input.env,
      { skills: [], experiences: [], educationBlocks: [], credentials: [], projects: [] },
      text,
    );
    if (decomposition) {
      console.log('[cvParser] Decomposition LLM succeeded');
    }
  } catch (llmErr) {
    console.warn('[cvParser] Decomposition LLM failed:', llmErr);
  }

  const parsedCV = decomposition
    ? deriveParsedCVFromDecomposition(decomposition, {
        experiences: [],
        educationBlocks: [],
        credentials: [],
        projects: [],
      })
    : buildRuleBasedParsedCV(text);

  console.log('[cvParser] Final ParsedCV:', {
    name: parsedCV.name,
    skillsCount: parsedCV.skills.length,
    yearsOfExperience: parsedCV.yearsOfExperience,
    currentRole: parsedCV.currentRole,
    educationCount: parsedCV.education?.length ?? 0,
    experiencesCount: parsedCV.experiences.length,
  });

  return { parsedCV, decompositionResult: decomposition };
}

/**
 * Parse a resume file and return structured candidate data.
 * Returns null if parsing is unavailable (no provider) or fails gracefully.
 */
export async function parseResume(input: ParseResumeInput): Promise<ParseResumeResult | null> {
  if (input.mock) {
    return {
      parsedCV: getMockParsedCV(),
      decompositionResult: getMockDecompositionResult(),
    };
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

    return await parseResumeText({
      resumeText: text,
      env: input.env,
    });
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
