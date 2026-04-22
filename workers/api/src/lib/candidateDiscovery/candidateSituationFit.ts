/**
 * Candidate Situation Fit — scores how well a repo's engineering signals align
 * with a candidate's career context and situation signature.
 *
 * Modeled on `roleFitRerank` (ADR-036 §2.3) but with a candidate-side lens:
 * instead of "does this repo fit the role?" we ask "does this repo represent
 * a challenge this candidate is meaningfully prepared for?"
 *
 * Called from the resume-upload orchestration after the Discovery agent
 * produces a rich candidate profile. Operates on a shortlist of repos
 * (typically top 20 from repo_role_alignment cache). Pure module — no D1 writes.
 */

import type { LLMProvider } from '../llm/types';
import type { RepoEngineeringSignalsRow } from '../../types';
import type { CandidateDiscoveryResult, CandidateKeyConcepts } from './agent';

// ─── Public API ─────────────────────────────────────────────────────────────

export interface SituationFitCandidate {
  repo_id: number;
  full_name: string;
  signals: RepoEngineeringSignalsRow;
}

export interface CandidateSituationFitInput {
  provider: LLMProvider;
  candidateResult: CandidateDiscoveryResult;
  candidateKeyConcepts: CandidateKeyConcepts;
  repos: SituationFitCandidate[];
}

export type FitBand = 'strong' | 'moderate' | 'weak' | 'mismatch';

export interface SituationFitRanking {
  repo_id: number;
  fit_score: number;
  fit_band: FitBand;
  reasoning: {
    matches: string[];
    mismatches: string[];
    summary: string;
  };
  per_signal_scores: {
    skill_coverage: number;
    seniority_fit: number;
    complexity_fit: number;
    architecture_fit: number;
    test_culture_fit: number;
    challenge_surface_fit: number;
  };
}

export interface CandidateSituationFitResult {
  rankings: SituationFitRanking[];
  rawText: string;
}

// ─── Main function ──────────────────────────────────────────────────────────

export async function candidateSituationFit(
  input: CandidateSituationFitInput,
): Promise<CandidateSituationFitResult> {
  const { provider, candidateResult, candidateKeyConcepts, repos } = input;

  if (repos.length === 0) {
    return { rankings: [], rawText: '' };
  }

  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(candidateResult, candidateKeyConcepts, repos);

  const completion = await provider.complete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    { forceJson: true, maxTokens: 4096 },
  );

  const rawText = completion.content ?? '';
  if (!rawText) {
    throw new Error('[candidateSituationFit] empty response from provider');
  }

  const parsed = parseFitResponse(rawText);
  const rankings = buildRankings(parsed, repos);

  return { rankings, rawText };
}

// ─── Prompt construction ────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    'You are a candidate-repo fit scorer for a developer hiring platform.',
    '',
    'You receive (1) a candidate profile describing their engineering background,',
    'career context, and situation signature, and (2) a candidate pool of GitHub',
    'repositories with pre-extracted engineering signals.',
    '',
    'Your job: score each repo on how well it represents a challenge this candidate',
    'is meaningfully prepared for. Consider not just skill overlap, but whether',
    'the repo\'s complexity, architecture, test culture, and challenge surfaces',
    'match the candidate\'s demonstrated experience.',
    '',
    'Scoring rubric (per repo):',
    '  - fit_score: a number in [0.0, 1.0]. 1.0 = perfect challenge fit. 0.0 = completely inappropriate.',
    '  - fit_band: one of "strong" (>= 0.75), "moderate" (>= 0.5), "weak" (>= 0.25), "mismatch" (< 0.25).',
    '  - reasoning.matches: 1-3 short bullets naming concrete candidate→repo alignments.',
    '    Each bullet MUST quote at least one verbatim token from the candidate\'s situation_signature.',
    '  - reasoning.mismatches: 0-3 short bullets naming concrete misalignments.',
    '  - reasoning.summary: one sentence (≤ 30 words) explaining the overall fit.',
    '  - per_signal_scores: object with the following keys, each a number in [0.0, 1.0]:',
    '      • skill_coverage — how well repo skills overlap with candidate must-have skills',
    '      • seniority_fit — is repo complexity appropriate for candidate seniority?',
    '      • complexity_fit — repo complexity_band vs candidate ownership_depth and system_scale_exposure',
    '      • architecture_fit — repo architecture_style vs candidate architecture_exposure',
    '      • test_culture_fit — repo test_style + test_touch_rate vs candidate test_culture_exposure',
    '      • challenge_surface_fit — repo challenge_surfaces vs candidate primary_challenge_types',
    '    Use null for any dimension you genuinely cannot judge. Do NOT fabricate scores.',
    '',
    'Hard rules:',
    '  - Do not invent signals that are not in the candidate input.',
    '  - Do not phrase any repo as "disqualified" — explain fit, do not gate.',
    '  - Reference candidate situation_signature fields verbatim — this is auditable downstream.',
    '  - A junior candidate + high-complexity repo = low complexity_fit.',
    '  - A platform-level candidate + simple library repo = low complexity_fit.',
    '  - A candidate with no event-driven exposure + event-driven repo = architecture mismatch.',
    '  - Output a single JSON object matching the schema below. No prose, no markdown.',
    '',
    'Output schema:',
    '{',
    '  "rankings": [',
    '    {',
    '      "repo_id": <number>,',
    '      "fit_score": <number 0..1>,',
    '      "fit_band": "strong" | "moderate" | "weak" | "mismatch",',
    '      "reasoning": {',
    '        "matches": [<string>, ...],',
    '        "mismatches": [<string>, ...],',
    '        "summary": <string>',
    '      },',
    '      "per_signal_scores": { "<signal_name>": <number 0..1>, ... }',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

function buildUserMessage(
  candidate: CandidateDiscoveryResult,
  keyConcepts: CandidateKeyConcepts,
  repos: SituationFitCandidate[],
): string {
  const candidateBlock = [
    '## Candidate Profile',
    `searchable_profile: ${candidate.candidateSearchableProfile}`,
    '',
    '### key_concepts',
    `mustHaveSkills: [${keyConcepts.mustHaveSkills.join(', ')}]`,
    `niceToHaveSkills: [${keyConcepts.niceToHaveSkills.join(', ')}]`,
    `seniority: ${keyConcepts.seniority}`,
    `primary_language: ${keyConcepts.primary_language}`,
    `detected_domain: ${keyConcepts.detected_domain}`,
    '',
    '### career_context',
    `company_stages: [${candidate.careerContext.company_stages.join(', ')}]`,
    `company_size_exposure: [${candidate.careerContext.company_size_exposure.join(', ')}]`,
    `tenure_pattern: ${candidate.careerContext.tenure_pattern}`,
    `progression_velocity: ${candidate.careerContext.progression_velocity}`,
    `ownership_depth: ${candidate.careerContext.ownership_depth}`,
    `system_scale_exposure: [${candidate.careerContext.system_scale_exposure.join(', ')}]`,
    `greenfield_ratio: ${candidate.careerContext.greenfield_ratio}`,
    '',
    '### situation_signature',
    `primary_challenge_types: [${candidate.situationSignature.primary_challenge_types.join(', ')}]`,
    `architecture_exposure: [${candidate.situationSignature.architecture_exposure.join(', ')}]`,
    `test_culture_exposure: ${candidate.situationSignature.test_culture_exposure}`,
    `review_culture: ${candidate.situationSignature.review_culture}`,
    `impact_signals: [${candidate.situationSignature.impact_signals.join(', ')}]`,
  ].join('\n');

  const repoBlock = repos.map((r, i) => formatRepo(r, i + 1)).join('\n\n');

  return [
    candidateBlock,
    '',
    '---',
    '',
    '## Candidate Repositories',
    repoBlock,
    '',
    '---',
    '',
    'Score every candidate repo. Return one entry per repo_id, in the same order. Output the JSON object only.',
  ].join('\n');
}

function formatRepo(c: SituationFitCandidate, idx: number): string {
  const s = c.signals;
  return [
    `### ${idx}. repo_id=${c.repo_id} — ${c.full_name}`,
    `signals_version: ${s.signals_version}`,
    `engineering_narrative: ${s.engineering_narrative}`,
    'tier1_signals:',
    `  test_touch_rate: ${formatNum(s.test_touch_rate)}`,
    `  mean_changed_files: ${formatNum(s.mean_changed_files)}`,
    `  p90_changed_files: ${formatNum(s.p90_changed_files)}`,
    `  issue_link_rate: ${formatNum(s.issue_link_rate)}`,
    `  complexity_band: ${s.complexity_band ?? 'unknown'}`,
    `  swe_bench_eligibility_rate: ${formatNum(s.swe_bench_eligibility_rate)}`,
    'tier2_signals:',
    `  architecture_style: ${s.architecture_style ?? 'unknown'}`,
    `  review_density: ${formatNum(s.review_density)}`,
    `  test_style: ${s.test_style ?? 'unknown'}`,
    `  challenge_surfaces: ${s.challenge_surfaces ?? 'null'}`,
  ].join('\n');
}

function formatNum(n: number | null): string {
  return n === null ? 'null' : n.toFixed(3);
}

// ─── Response parsing ───────────────────────────────────────────────────────

interface ParsedFitItem {
  repo_id: number;
  fit_score: number;
  fit_band: FitBand;
  reasoning: {
    matches: string[];
    mismatches: string[];
    summary: string;
  };
  per_signal_scores: Record<string, number>;
}

interface ParsedFitResponse {
  rankings: ParsedFitItem[];
}

function parseFitResponse(text: string): ParsedFitResponse {
  const stripped = stripCodeFences(text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[candidateSituationFit] failed to parse JSON response: ${msg}`);
  }

  if (!isObject(parsed) || !Array.isArray((parsed as { rankings?: unknown }).rankings)) {
    throw new Error('[candidateSituationFit] response missing "rankings" array');
  }

  const rawRankings = (parsed as { rankings: unknown[] }).rankings;
  const rankings: ParsedFitItem[] = rawRankings.map((r, i) => normalizeRanking(r, i));

  return { rankings };
}

function normalizeRanking(raw: unknown, idx: number): ParsedFitItem {
  if (!isObject(raw)) {
    throw new Error(`[candidateSituationFit] ranking[${idx}] is not an object`);
  }
  const obj = raw as Record<string, unknown>;

  const repoId = coerceNumber(obj.repo_id);
  if (repoId === null) {
    throw new Error(`[candidateSituationFit] ranking[${idx}] missing valid repo_id`);
  }

  const score = clamp01(coerceNumber(obj.fit_score) ?? 0);
  const band = coerceBand(obj.fit_band) ?? deriveBand(score);

  const reasoningRaw = isObject(obj.reasoning) ? (obj.reasoning as Record<string, unknown>) : {};
  const matches = coerceStringArray(reasoningRaw.matches);
  const mismatches = coerceStringArray(reasoningRaw.mismatches);
  const summary = typeof reasoningRaw.summary === 'string' ? reasoningRaw.summary : '';

  const perSignal = isObject(obj.per_signal_scores)
    ? coercePerSignal(obj.per_signal_scores as Record<string, unknown>)
    : {};

  return {
    repo_id: repoId,
    fit_score: score,
    fit_band: band,
    reasoning: { matches, mismatches, summary },
    per_signal_scores: perSignal,
  };
}

// ─── Utility ────────────────────────────────────────────────────────────────

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

const VALID_BANDS: ReadonlySet<FitBand> = new Set(['strong', 'moderate', 'weak', 'mismatch']);

function coerceBand(v: unknown): FitBand | null {
  if (typeof v !== 'string') return null;
  const lower = v.toLowerCase();
  return (VALID_BANDS as ReadonlySet<string>).has(lower) ? (lower as FitBand) : null;
}

function deriveBand(score: number): FitBand {
  if (score >= 0.75) return 'strong';
  if (score >= 0.5) return 'moderate';
  if (score >= 0.25) return 'weak';
  return 'mismatch';
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function coercePerSignal(obj: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = coerceNumber(v);
    if (n !== null) out[k] = clamp01(n);
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}

// ─── Row assembly ───────────────────────────────────────────────────────────

function buildRankings(
  parsed: ParsedFitResponse,
  repos: SituationFitCandidate[],
): SituationFitRanking[] {
  const repoById = new Map(repos.map((r) => [r.repo_id, r]));
  const out: SituationFitRanking[] = [];

  for (const ranking of parsed.rankings) {
    if (!repoById.has(ranking.repo_id)) {
      console.error('[candidateSituationFit] dropping unknown repo_id from response:', ranking.repo_id);
      continue;
    }
    out.push(ranking);
  }

  // Stable sort: highest fit first.
  out.sort((a, b) => b.fit_score - a.fit_score);
  return out;
}
