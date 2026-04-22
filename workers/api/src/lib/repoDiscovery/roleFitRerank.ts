/**
 * Role-Fit Reranker — ADR-036 §2.3 Stage 2 (runtime rerank).
 *
 * Reads: a RoleContextDocument's technical_context + work/codebase domain cells,
 *        plus a candidate pool of repos with their offline-extracted
 *        RepoEngineeringSignalsRow.
 * Calls: Gemma 4 26B via the existing CloudflareAIProvider (forceJson).
 * Writes: nothing — returns RepoRoleAlignmentRow[] for the orchestrator to cache
 *         in repo_role_alignment.
 *
 * The rerank prompt is grounded in research brief Half 2 §2.3 (two-stage
 * retrieval) and ADR-036 §2.3. The justification text MUST reference RCD
 * technical_context fields verbatim (stack tokens, codebase_expectations
 * tokens) — that is the BDD assertion that proves the rerank actually
 * consumed the RCD instead of ranking by stars.
 *
 * Model-family independence (CLAUDE.md AI routing rule, ADR-032 anchor):
 *   • Pass 3 (offline) writes signals on Gemma 4 26B.
 *   • This file (runtime) reranks on Gemma 4 26B.
 *   • Never let the same family both write and read signals — the rerank
 *     must be an independent perspective on the signals.
 */

import type { LLMProvider } from '../llm/types';
import type {
  AlignmentBand,
  DomainCell,
  RepoEngineeringSignalsRow,
  RepoRoleAlignmentRow,
  RoleContextDocument,
} from '../../types';

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RerankCandidate {
  repo_id: number;
  full_name: string;
  signals: RepoEngineeringSignalsRow;
}

export interface RoleFitRerankOptions {
  provider: LLMProvider;
  rcd: RoleContextDocument;
  candidates: RerankCandidate[];
  /** Optional override for the model name stamped on the alignment row. */
  modelName?: string;
}

export interface RoleFitRerankResult {
  alignments: RepoRoleAlignmentRow[];
  /** Raw model output, retained for debugging + audit trails. */
  rawText: string;
}

export async function roleFitRerank(
  opts: RoleFitRerankOptions,
): Promise<RoleFitRerankResult> {
  const { provider, rcd, candidates } = opts;

  if (candidates.length === 0) {
    return { alignments: [], rawText: '' };
  }

  const modelName = opts.modelName ?? provider.name;
  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(rcd, candidates);

  const completion = await provider.complete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    { forceJson: true, maxTokens: 4096 },
  );

  const rawText = completion.content ?? '';
  if (!rawText) {
    throw new Error('[roleFitRerank] empty response from provider');
  }

  const parsed = parseRerankResponse(rawText);
  const alignments = buildAlignmentRows({
    parsed,
    candidates,
    rcd,
    modelName,
  });

  return { alignments, rawText };
}

// ─── Prompt construction ───────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    'You are a repository fit reranker for a developer hiring platform.',
    '',
    'You receive (1) a Role Context Document (RCD) describing what the hiring team is looking for and (2) a candidate pool of GitHub repositories with role-agnostic engineering signals already extracted.',
    '',
    'Your job: score each candidate repo on how well its engineering signals align with the role\'s technical_context and codebase expectations, and explain the score in plain language that references the RCD verbatim.',
    '',
    'Scoring rubric (per repo):',
    '  - alignment_score: a number in [0.0, 1.0]. 1.0 = perfect fit. 0.0 = irrelevant.',
    '  - alignment_band: one of "strong" (>= 0.75), "moderate" (>= 0.5), "weak" (>= 0.25), "mismatch" (< 0.25).',
    '  - reasoning.matches: 1-3 short bullets naming concrete signal-to-RCD links. Each bullet MUST quote at least one verbatim token from the RCD\'s technical_context.stack OR technical_context.codebase_expectations.',
    '  - reasoning.mismatches: 0-3 short bullets naming concrete misalignments.',
    '  - reasoning.summary: one sentence (≤ 30 words) explaining the overall fit. Must also reference at least one RCD technical_context token verbatim.',
    '  - per_signal_scores: object with the following keys, each a number in [0.0, 1.0]:',
    '      • test_touch_rate, complexity_band, architecture_style, review_density, swe_bench_eligibility_rate, language_match (legacy dimensions)',
    '      • architecture_style_match — how well repo\'s architecture_style fits the codebase_expectations and constructs tokens. If repo.architecture_style = "library" score 0.0 (hard mismatch).',
    '      • test_style_match — repo.test_style vs what the RCD implies about testing. Partial credit: unit_only↔integration_heavy = 0.5; minimal↔anything_not_minimal = 0.2; e2e_present expected and present = 1.0.',
    '      • review_culture_match — repo.review_density bucketed (rigorous ≥ 2.0 comments/PR, lightweight 1–2, solo < 1) vs RCD\'s implied review culture (infer from codebase_expectations language — e.g., "thorough review", "trunk-based", "ship fast").',
    '      • pr_size_match — repo.p90_changed_files bucketed (small < 10, medium 10–30, large > 30) vs RCD\'s implied PR size band.',
    '      • complexity_match — repo.complexity_band vs RCD\'s implied complexity_tolerance (infer from seniority_band + codebase_expectations).',
    '      • challenge_surface_fit — repo.challenge_surfaces (10 *_potential floats in [0,1]) cosine-aligned to the surfaces the RCD\'s must_have skills imply. If challenge_surfaces is null, return 0.5.',
    '    Use null for any dimension you genuinely cannot judge. Do NOT fabricate scores.',
    '',
    'Hard rules:',
    '  - Do not invent signals that are not in the candidate input.',
    '  - Do not phrase any repo as "disqualified" or "rejected" — explain fit, do not gate. The recruiter decides.',
    '  - Reference RCD technical_context fields verbatim — this is auditable downstream.',
    '  - Output a single JSON object matching the schema below. No prose, no markdown.',
    '',
    'Output schema:',
    '{',
    '  "rankings": [',
    '    {',
    '      "repo_id": <number>,',
    '      "alignment_score": <number 0..1>,',
    '      "alignment_band": "strong" | "moderate" | "weak" | "mismatch",',
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
  rcd: RoleContextDocument,
  candidates: RerankCandidate[],
): string {
  const tc = rcd.technical_context;
  const workCells = collectDomainCellSummaries(rcd, 'work');
  const codebaseCells = collectDomainCellSummaries(rcd, 'codebase');

  const rcdBlock = [
    '## Role Context Document',
    `role_context_id: ${rcd.role_context_id}`,
    `rcd_version: ${rcd.rcd_version}`,
    '',
    '### technical_context',
    `stack: [${tc.stack.join(', ')}]`,
    `constructs: [${tc.constructs.join(', ')}]`,
    `seniority_band: ${tc.seniority_band}`,
    `codebase_expectations: [${tc.codebase_expectations.join(', ')}]`,
    '',
    '### work domain (what this team builds, per stakeholders)',
    workCells.length > 0 ? workCells.join('\n') : '(no work domain cells populated)',
    '',
    '### codebase domain (how this team writes code, per stakeholders)',
    codebaseCells.length > 0 ? codebaseCells.join('\n') : '(no codebase domain cells populated)',
  ].join('\n');

  const candidateBlock = [
    '## Candidate Repositories',
    ...candidates.map((c, i) => formatCandidate(c, i + 1)),
  ].join('\n\n');

  return [
    rcdBlock,
    '',
    '---',
    '',
    candidateBlock,
    '',
    '---',
    '',
    'Score every candidate. Return one entry per repo_id, in the same order. Output the JSON object only.',
  ].join('\n');
}

function collectDomainCellSummaries(
  rcd: RoleContextDocument,
  domain: 'work' | 'codebase',
): string[] {
  const out: string[] = [];
  for (const stakeholder of Object.keys(rcd.domain_matrix) as Array<keyof typeof rcd.domain_matrix>) {
    const cells = rcd.domain_matrix[stakeholder];
    if (!cells) continue;
    const cell = cells[domain] as DomainCell | undefined;
    if (!cell) continue;
    if (cell.coverage === 'not_probed') continue;
    if (!cell.summary) continue;
    out.push(`- [${stakeholder}] ${cell.summary}`);
  }
  return out;
}

function formatCandidate(c: RerankCandidate, idx: number): string {
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
    `  commit_cadence: ${formatNum(s.commit_cadence)}`,
    `  satd_density: ${formatNum(s.satd_density)}`,
    'canonical_alignment_signals:',
    `  test_style: ${s.test_style ?? 'unknown'}`,
    `  challenge_surfaces: ${s.challenge_surfaces ?? 'null'}`,
  ].join('\n');
}

function formatNum(n: number | null): string {
  return n === null ? 'null' : n.toFixed(3);
}

// ─── Response parsing ──────────────────────────────────────────────────────

interface ParsedRerankItem {
  repo_id: number;
  alignment_score: number;
  alignment_band: AlignmentBand;
  reasoning: {
    matches: string[];
    mismatches: string[];
    summary: string;
  };
  per_signal_scores: Record<string, number>;
}

interface ParsedRerankResponse {
  rankings: ParsedRerankItem[];
}

function parseRerankResponse(text: string): ParsedRerankResponse {
  const stripped = stripCodeFences(text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[roleFitRerank] failed to parse JSON response: ${msg}`);
  }

  if (!isObject(parsed) || !Array.isArray((parsed as { rankings?: unknown }).rankings)) {
    throw new Error('[roleFitRerank] response missing "rankings" array');
  }

  const rawRankings = (parsed as { rankings: unknown[] }).rankings;
  const rankings: ParsedRerankItem[] = rawRankings.map((r, i) => normalizeRanking(r, i));

  return { rankings };
}

function normalizeRanking(raw: unknown, idx: number): ParsedRerankItem {
  if (!isObject(raw)) {
    throw new Error(`[roleFitRerank] ranking[${idx}] is not an object`);
  }
  const obj = raw as Record<string, unknown>;

  const repoId = coerceNumber(obj.repo_id);
  if (repoId === null) {
    throw new Error(`[roleFitRerank] ranking[${idx}] missing valid repo_id`);
  }

  const score = clamp01(coerceNumber(obj.alignment_score) ?? 0);
  const band = coerceBand(obj.alignment_band) ?? deriveBand(score);

  const reasoningRaw = isObject(obj.reasoning) ? (obj.reasoning as Record<string, unknown>) : {};
  const matches = coerceStringArray(reasoningRaw.matches);
  const mismatches = coerceStringArray(reasoningRaw.mismatches);
  const summary = typeof reasoningRaw.summary === 'string' ? reasoningRaw.summary : '';

  const perSignal = isObject(obj.per_signal_scores)
    ? coercePerSignal(obj.per_signal_scores as Record<string, unknown>)
    : {};

  return {
    repo_id: repoId,
    alignment_score: score,
    alignment_band: band,
    reasoning: { matches, mismatches, summary },
    per_signal_scores: perSignal,
  };
}

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

const VALID_BANDS: ReadonlySet<AlignmentBand> = new Set(['strong', 'moderate', 'weak', 'mismatch']);

function coerceBand(v: unknown): AlignmentBand | null {
  if (typeof v !== 'string') return null;
  const lower = v.toLowerCase();
  return (VALID_BANDS as ReadonlySet<string>).has(lower) ? (lower as AlignmentBand) : null;
}

function deriveBand(score: number): AlignmentBand {
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

// ─── Row assembly ──────────────────────────────────────────────────────────

interface BuildRowsOptions {
  parsed: ParsedRerankResponse;
  candidates: RerankCandidate[];
  rcd: RoleContextDocument;
  modelName: string;
}

function buildAlignmentRows(opts: BuildRowsOptions): RepoRoleAlignmentRow[] {
  const { parsed, candidates, rcd, modelName } = opts;

  const candidateById = new Map(candidates.map((c) => [c.repo_id, c]));
  const generatedAt = new Date().toISOString();

  const rows: RepoRoleAlignmentRow[] = [];

  for (const ranking of parsed.rankings) {
    const candidate = candidateById.get(ranking.repo_id);
    if (!candidate) {
      // Model hallucinated a repo_id we never sent it — drop it.
      console.error('[roleFitRerank] dropping unknown repo_id from response:', ranking.repo_id);
      continue;
    }

    rows.push({
      role_context_id: rcd.role_context_id,
      repo_id: ranking.repo_id,
      alignment_score: ranking.alignment_score,
      alignment_band: ranking.alignment_band,
      reasoning_json: JSON.stringify(ranking.reasoning),
      per_signal_scores: JSON.stringify(ranking.per_signal_scores),
      rcd_version: rcd.rcd_version,
      signals_version: candidate.signals.signals_version,
      generated_at: generatedAt,
      model_used: modelName,
    });
  }

  // Stable sort: highest alignment first.
  rows.sort((a, b) => b.alignment_score - a.alignment_score);

  return rows;
}
