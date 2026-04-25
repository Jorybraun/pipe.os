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

export interface CareerContext {
  company_stages: string[];
  company_size_exposure: string[];
  tenure_pattern: 'stable' | 'moderate' | 'job-hopper' | 'unknown';
  progression_velocity: 'fast' | 'normal' | 'slow' | 'unknown';
  ownership_depth: 'feature' | 'service' | 'platform' | 'org' | 'unknown';
  system_scale_exposure: string[];
  greenfield_ratio: number;
}

export interface SituationSignature {
  primary_challenge_types: string[];
  architecture_exposure: string[];
  test_culture_exposure: string;
  review_culture: string;
  impact_signals: string[];
}

export interface CandidateDiscoveryResult {
  candidateSearchableProfile: string;
  keyConcepts: CandidateKeyConcepts;
  careerContext: CareerContext;
  situationSignature: SituationSignature;
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
const MAX_ARRAY_LEN = 10;

const VALID_TENURE_PATTERNS = new Set(['stable', 'moderate', 'job-hopper', 'unknown'] as const);
const VALID_PROGRESSION_VELOCITIES = new Set(['fast', 'normal', 'slow', 'unknown'] as const);
const VALID_OWNERSHIP_DEPTHS = new Set(['feature', 'service', 'platform', 'org', 'unknown'] as const);

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

function coerceEnum<T extends string>(value: unknown, valid: Set<T>, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase() as T;
  return valid.has(v) ? v : fallback;
}

function coerceNumberInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
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

  // Parse rich profile fields with fallbacks for backward compatibility
  const ccRaw = (parsedResponse.career_context ?? {}) as Record<string, unknown>;
  const careerContext: CareerContext = {
    company_stages: coerceStringArray(ccRaw.company_stages, MAX_ARRAY_LEN),
    company_size_exposure: coerceStringArray(ccRaw.company_size_exposure, MAX_ARRAY_LEN),
    tenure_pattern: coerceEnum(ccRaw.tenure_pattern, VALID_TENURE_PATTERNS, 'unknown'),
    progression_velocity: coerceEnum(ccRaw.progression_velocity, VALID_PROGRESSION_VELOCITIES, 'unknown'),
    ownership_depth: coerceEnum(ccRaw.ownership_depth, VALID_OWNERSHIP_DEPTHS, 'unknown'),
    system_scale_exposure: coerceStringArray(ccRaw.system_scale_exposure, MAX_ARRAY_LEN),
    greenfield_ratio: coerceNumberInRange(ccRaw.greenfield_ratio, 0, 1, 0.5),
  };

  const ssRaw = (parsedResponse.situation_signature ?? {}) as Record<string, unknown>;
  const situationSignature: SituationSignature = {
    primary_challenge_types: coerceStringArray(ssRaw.primary_challenge_types, 5),
    architecture_exposure: coerceStringArray(ssRaw.architecture_exposure, 5),
    test_culture_exposure: typeof ssRaw.test_culture_exposure === 'string' ? ssRaw.test_culture_exposure : 'unknown',
    review_culture: typeof ssRaw.review_culture === 'string' ? ssRaw.review_culture : 'unknown',
    impact_signals: coerceStringArray(ssRaw.impact_signals, 5),
  };

  return {
    candidateSearchableProfile: profileRaw.trim(),
    keyConcepts,
    careerContext,
    situationSignature,
    profileVersion: CANDIDATE_DISCOVERY_PROMPT_VERSION,
    modelUsed: provider.name,
    rawText,
  };
}
