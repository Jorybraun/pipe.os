/**
 * Candidate Discovery agent — produces candidate_searchable_profile +
 * structured key_concepts from a parsed CV + raw resume text. Mirror of the
 * repo-side pass3 pipeline, symmetrical BGE-large-en-v1.5 embedding space.
 *
 * Called from the resume-upload hook. Pure module — does not write to D1 or
 * Vectorize. The caller persists the result to `candidate_ingestion` and
 * then triggers embedding + match.
 *
 * Per CLAUDE.md AI model routing: Gemma 4 26B, Vertex AI MaaS in production,
 * Workers AI binding as fallback. Routed via `createCandidateAgentProvider`
 * in `lib/llm/createProvider.ts`.
 *
 * See STRATEGY.md Decision Log 2026-04-21 and ADR-039.
 */

import type { ParsedCV } from '../cvParser';
import type { LLMProvider } from '../llm/types';
import {
  CANDIDATE_DISCOVERY_PROMPT_VERSION,
  CANDIDATE_DISCOVERY_SYSTEM_PROMPT,
  buildCandidateDiscoveryUserMessage,
  type CandidateDiscoveryFacts,
} from './prompts';

export type SeniorityBand = 'junior' | 'mid' | 'senior' | 'staff';

export interface CandidateKeyConcepts {
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  seniority: SeniorityBand;
  primary_language: string;
  detected_domain: string;
}

export interface CandidateDiscoveryResult {
  candidateSearchableProfile: string;
  keyConcepts: CandidateKeyConcepts;
  profileVersion: string;
  modelUsed: string;
  rawText: string;
}

export interface DiscoverCandidateProfileInput {
  provider: LLMProvider;
  parsed: ParsedCV;
  resumeText?: string | null;
}

const SENIORITY_BANDS: SeniorityBand[] = ['junior', 'mid', 'senior', 'staff'];
const MAX_SKILLS = 10;
const MIN_PROFILE_CHARS = 400;

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function coerceStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function coerceSeniority(value: unknown, fallback: SeniorityBand): SeniorityBand {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  return (SENIORITY_BANDS as string[]).includes(v) ? (v as SeniorityBand) : fallback;
}

function inferSeniorityFromYears(years: number | undefined): SeniorityBand {
  if (typeof years !== 'number' || years < 3) return 'junior';
  if (years < 6) return 'mid';
  if (years < 10) return 'senior';
  return 'staff';
}

function parseJsonResponse(raw: string): Record<string, unknown> {
  const cleaned = stripCodeFences(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new Error('Candidate Discovery response was not a JSON object');
}

export async function discoverCandidateProfile(
  input: DiscoverCandidateProfileInput,
): Promise<CandidateDiscoveryResult> {
  const { provider, parsed, resumeText } = input;

  const facts: CandidateDiscoveryFacts = {
    parsed,
    resumeText: resumeText ?? null,
  };

  const userMessage = buildCandidateDiscoveryUserMessage(facts);

  const completion = await provider.complete(
    [
      { role: 'system', content: CANDIDATE_DISCOVERY_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    { forceJson: true, maxTokens: 1400 },
  );

  const rawText = completion.content ?? '';
  if (rawText.trim().length === 0) {
    throw new Error('Candidate Discovery returned empty content');
  }

  const parsedResponse = parseJsonResponse(rawText);

  const profileRaw = parsedResponse.candidate_searchable_profile;
  if (typeof profileRaw !== 'string' || profileRaw.trim().length < MIN_PROFILE_CHARS) {
    throw new Error(
      `Candidate Discovery profile too short: got ${typeof profileRaw === 'string' ? profileRaw.length : 0} chars, need >= ${MIN_PROFILE_CHARS}`,
    );
  }

  const kcRaw = (parsedResponse.key_concepts ?? {}) as Record<string, unknown>;
  const seniority = coerceSeniority(
    kcRaw.seniority,
    inferSeniorityFromYears(parsed.yearsOfExperience),
  );
  const primaryLanguage =
    typeof kcRaw.primary_language === 'string' && kcRaw.primary_language.trim().length > 0
      ? kcRaw.primary_language.trim().toLowerCase()
      : 'unknown';
  const detectedDomain =
    typeof kcRaw.detected_domain === 'string' && kcRaw.detected_domain.trim().length > 0
      ? kcRaw.detected_domain.trim().toLowerCase()
      : 'general';

  const keyConcepts: CandidateKeyConcepts = {
    mustHaveSkills: coerceStringArray(kcRaw.mustHaveSkills, MAX_SKILLS),
    niceToHaveSkills: coerceStringArray(kcRaw.niceToHaveSkills, MAX_SKILLS),
    seniority,
    primary_language: primaryLanguage,
    detected_domain: detectedDomain,
  };

  return {
    candidateSearchableProfile: profileRaw.trim(),
    keyConcepts,
    profileVersion: CANDIDATE_DISCOVERY_PROMPT_VERSION,
    modelUsed: provider.name,
    rawText,
  };
}
