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
import type { RepoEngineeringSignalsRow, CandidateNode } from '../../types';
import type { CandidateDiscoveryResult, CandidateKeyConcepts } from './agent';
import { retryWithBackoff } from '../ai/retryHelper';

// ─── Cache helpers ───────────────────────────────────────────────────────────

const CACHE_TTL_DAYS = 7;

async function sha256Hex(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildSituationFitCacheKey(
  candidateId: string,
  repoId: number,
  profileVersion: string,
  signalsVersion: string,
  promptVersion = 'v1',
): Promise<string> {
  const payload = `${candidateId}|${repoId}|${profileVersion}|${signalsVersion}|${promptVersion}`;
  return sha256Hex(payload);
}

export async function getCachedSituationFit(
  db: D1Database,
  cacheKey: string,
): Promise<SituationFitRanking | null> {
  const row = await db
    .prepare(
      `SELECT result_json
         FROM situation_fit_cache
        WHERE cache_key = ?1
          AND created_at > datetime('now', '-${CACHE_TTL_DAYS} days')`,
    )
    .bind(cacheKey)
    .first<{ result_json: string }>();

  if (!row) return null;

  try {
    const parsed = JSON.parse(row.result_json) as SituationFitRanking;
    return parsed;
  } catch {
    return null;
  }
}

export async function storeSituationFitCache(
  db: D1Database,
  cacheKey: string,
  candidateId: string,
  repoId: number,
  profileVersion: string,
  signalsVersion: string,
  ranking: SituationFitRanking,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO situation_fit_cache
         (cache_key, candidate_id, repo_id, profile_version, signals_version, result_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    )
    .bind(cacheKey, candidateId, repoId, profileVersion, signalsVersion, JSON.stringify(ranking))
    .run();
}

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
  /** Optional CulturalSignal nodes to enrich the prompt. */
  culturalSignalNodes?: CandidateNode[];
  /** When provided, prefer role-specific CulturalSignal nodes for this role. */
  roleContextId?: string;
  /** Optional Experience nodes to enrich the prompt. */
  experienceNodes?: CandidateNode[];
  /** Optional Project nodes to enrich the prompt. */
  projectNodes?: CandidateNode[];
  /** Optional Skill nodes to enrich the prompt. */
  skillNodes?: CandidateNode[];
  /** Optional CareerArc nodes to enrich the prompt with trajectory synthesis. */
  careerArcNodes?: CandidateNode[];
  /** Optional recency multiplier to discount fit scores for stale profiles. */
  recencyMultiplier?: number;
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
  per_signal_scores: Record<string, number>;
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
  const userMessage = buildUserMessage(
    candidateResult,
    candidateKeyConcepts,
    repos,
    input.culturalSignalNodes,
    input.roleContextId,
    input.experienceNodes,
    input.projectNodes,
    input.skillNodes,
    input.careerArcNodes,
  );

  const completion = await retryWithBackoff(
    async () =>
      provider.complete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        { forceJson: true, maxTokens: 8192 },
      ),
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      onRetry: (attempt, delay) =>
        console.warn(`[retry] attempt ${attempt} after ${delay}ms delay for candidateSituationFit`),
    },
  );

  const rawText = completion.content ?? '';
  if (!rawText) {
    throw new Error('[candidateSituationFit] empty response from provider');
  }

  const parsed = parseFitResponse(rawText);
  const rankings = buildRankings(parsed, repos, input.recencyMultiplier);

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
    '',
    'Hard rules:',
    '  - Do not invent signals that are not in the candidate input.',
    '  - A junior candidate + high-complexity repo = low score.',
    '  - A platform-level candidate + simple library repo = low score.',
    '  - Output a single compact JSON object. No prose, no markdown.',
    '',
    'Output schema:',
    '{',
    '  "rankings": [',
    '    { "repo_id": <number>, "fit_score": <number 0..1>, "fit_band": "strong" | "moderate" | "weak" | "mismatch" }',
    '  ]',
    '}',
  ].join('\n');
}

function buildCulturalSignalBlock(
  nodes: CandidateNode[] | undefined,
  targetRoleId: string | undefined,
): string {
  if (!nodes || nodes.length === 0) return '';

  const culturalNodes = nodes.filter((n) => n.node_type === 'CulturalSignal');
  if (culturalNodes.length === 0) return '';

  // Group by dimension, preferring role-specific when targetRoleId is provided
  const selected = new Map<string, CandidateNode>();

  for (const node of culturalNodes) {
    const props = safeParseJson(node.extracted_properties_json);
    const dimension = typeof props?.dimension === 'string' ? props.dimension : null;
    if (!dimension) continue;

    const isRoleSpecific = props?.is_role_specific === true;
    const nodeRoleId = typeof props?.role_context_id === 'string' ? props.role_context_id : null;

    const existing = selected.get(dimension);
    if (!existing) {
      selected.set(dimension, node);
      continue;
    }

    const existingProps = safeParseJson(existing.extracted_properties_json);
    const existingIsRoleSpecific = existingProps?.is_role_specific === true;
    const existingRoleId = typeof existingProps?.role_context_id === 'string' ? existingProps.role_context_id : null;

    if (targetRoleId) {
      // Prefer role-specific nodes for the target role
      const preferNew =
        isRoleSpecific && nodeRoleId === targetRoleId && !(existingIsRoleSpecific && existingRoleId === targetRoleId);
      if (preferNew) {
        selected.set(dimension, node);
      }
    }
  }

  if (selected.size === 0) return '';

  const lines = Array.from(selected.values()).map((node) => {
    const props = safeParseJson(node.extracted_properties_json);
    const dimension = props?.dimension ?? 'unknown';
    const score = typeof props?.bars_score === 'number' ? props.bars_score : '?';
    const reasoning = typeof props?.reasoning === 'string' ? props.reasoning : '';
    return `${dimension}: ${score}/5 — ${reasoning}`;
  });

  return [
    '',
    '### cultural_signals',
    'Structured behavioral and cultural signals extracted from the candidate\'s interview:',
    ...lines,
  ].join('\n');
}

function buildExperienceBlock(nodes: CandidateNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return '';

  const eligible = nodes
    .filter((n) => n.node_type === 'Experience' && (n.confidence ?? 0) >= 0.5)
    .slice(0, 5);

  if (eligible.length === 0) return '';

  const lines = eligible.map((node) => {
    const props = safeParseJson(node.extracted_properties_json);
    const company = typeof props?.company === 'string' ? props.company : '';
    const role = typeof props?.role === 'string' ? props.role : '';
    const narrative = node.narrative_text;
    const recencyTag = recencyTagForNode(node);

    const domain = typeof props?.domain === 'string' ? props.domain : null;
    const stage = typeof props?.company_stage === 'string' ? props.company_stage : null;
    const impact = typeof props?.impact_summary === 'string' ? props.impact_summary : null;

    let line = `- ${role}${company ? ` at ${company}` : ''}${recencyTag}: ${narrative}`;
    if (domain || stage || impact) {
      const extras: string[] = [];
      if (domain) extras.push(`domain: ${domain}`);
      if (stage) extras.push(`stage: ${stage}`);
      if (impact) extras.push(`impact: ${impact}`);
      line += ` [${extras.join('; ')}]`;
    }
    return line;
  });

  return [
    '',
    '### candidate_experiences',
    'Career history extracted from the candidate\'s resume:',
    ...lines,
  ].join('\n');
}

function buildProjectBlock(nodes: CandidateNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return '';

  const eligible = nodes
    .filter((n) => n.node_type === 'Project' && (n.confidence ?? 0) >= 0.5)
    .slice(0, 3);

  if (eligible.length === 0) return '';

  const lines = eligible.map((node) => {
    const props = safeParseJson(node.extracted_properties_json);
    const name = typeof props?.name === 'string' ? props.name : '';
    const description = typeof props?.description === 'string' ? props.description : node.narrative_text;
    const recencyTag = recencyTagForNode(node);
    return `- ${name}${recencyTag}: ${description}`;
  });

  return [
    '',
    '### candidate_projects',
    'Notable projects extracted from the candidate\'s resume:',
    ...lines,
  ].join('\n');
}

function buildSkillBlock(nodes: CandidateNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return '';

  const eligible = nodes
    .filter((n) => n.node_type === 'Skill' && (n.confidence ?? 0) >= 0.5)
    .slice(0, 10);

  if (eligible.length === 0) return '';

  const lines = eligible.map((node) => {
    const props = safeParseJson(node.extracted_properties_json);
    const name = typeof props?.name === 'string' ? props.name : node.narrative_text;
    const proficiency = typeof props?.proficiency === 'string' ? props.proficiency : '';
    const years = typeof props?.years_exposure === 'number' ? props.years_exposure : null;
    const depthPattern = typeof props?.depth_pattern === 'string' ? props.depth_pattern : null;
    const recencyTag = recencyTagForNode(node);

    const innerParts: string[] = [];
    if (proficiency) innerParts.push(proficiency);
    if (years !== null) innerParts.push(`${years} years`);
    if (depthPattern) innerParts.push(depthPattern);

    const inner = innerParts.length > 0 ? ` (${innerParts.join(', ')})` : '';
    return `- ${name}${inner}${recencyTag}`;
  });

  return [
    '',
    '### candidate_skills',
    'Skill profile extracted from the candidate\'s resume:',
    ...lines,
  ].join('\n');
}

function buildCareerArcBlock(nodes: CandidateNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return '';

  const eligible = nodes
    .filter((n) => n.node_type === 'CareerArc' && (n.confidence ?? 0) >= 0.5)
    .slice(0, 1);

  if (eligible.length === 0) return '';

  const lines = eligible.map((node) => {
    const props = safeParseJson(node.extracted_properties_json);
    const domainSpec = typeof props?.domain_specialization === 'string' ? props.domain_specialization : null;
    const stagePattern = Array.isArray(props?.company_stage_pattern) ? props.company_stage_pattern : null;
    const ownership = typeof props?.ownership_progression === 'string' ? props.ownership_progression : null;
    const themes = Array.isArray(props?.impact_themes) ? props.impact_themes : null;
    const narrative = node.narrative_text;

    const parts: string[] = [narrative];
    if (domainSpec) parts.push(`domain specialization: ${domainSpec}`);
    if (stagePattern) parts.push(`company stages: ${stagePattern.join(', ')}`);
    if (ownership) parts.push(`ownership progression: ${ownership}`);
    if (themes) parts.push(`impact themes: ${themes.join(', ')}`);

    return parts.join(' | ');
  });

  return [
    '',
    '### candidate_career_arc',
    'Synthesized career trajectory and cross-cutting patterns:',
    ...lines,
  ].join('\n');
}

function recencyTagForNode(node: CandidateNode): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const age = nowSec - node.captured_at;
  const TWO_YEARS_SEC = 2 * 365 * 24 * 60 * 60;
  const FOUR_YEARS_SEC = 4 * 365 * 24 * 60 * 60;
  if (age > FOUR_YEARS_SEC) return ' [4+ years old]';
  if (age > TWO_YEARS_SEC) return ' [2+ years old]';
  return '';
}

function safeParseJson(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildUserMessage(
  candidate: CandidateDiscoveryResult,
  keyConcepts: CandidateKeyConcepts,
  repos: SituationFitCandidate[],
  culturalSignalNodes?: CandidateNode[],
  roleContextId?: string,
  experienceNodes?: CandidateNode[],
  projectNodes?: CandidateNode[],
  skillNodes?: CandidateNode[],
  careerArcNodes?: CandidateNode[],
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

  const culturalBlock = buildCulturalSignalBlock(culturalSignalNodes, roleContextId);
  const experienceBlock = buildExperienceBlock(experienceNodes);
  const projectBlock = buildProjectBlock(projectNodes);
  const skillBlock = buildSkillBlock(skillNodes);
  const careerArcBlock = buildCareerArcBlock(careerArcNodes);

  const repoBlock = repos.map((r, i) => formatRepo(r, i + 1)).join('\n\n');

  return [
    candidateBlock,
    culturalBlock,
    experienceBlock,
    projectBlock,
    skillBlock,
    careerArcBlock,
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
  recencyMultiplier = 1.0,
): SituationFitRanking[] {
  const repoById = new Map(repos.map((r) => [r.repo_id, r]));
  const out: SituationFitRanking[] = [];

  for (const ranking of parsed.rankings) {
    if (!repoById.has(ranking.repo_id)) {
      console.error('[candidateSituationFit] dropping unknown repo_id from response:', ranking.repo_id);
      continue;
    }
    const adjustedScore = clamp01(ranking.fit_score * recencyMultiplier);
    out.push({
      ...ranking,
      fit_score: adjustedScore,
      fit_band: deriveBand(adjustedScore),
    });
  }

  // Stable sort: highest fit first.
  out.sort((a, b) => b.fit_score - a.fit_score);
  return out;
}
