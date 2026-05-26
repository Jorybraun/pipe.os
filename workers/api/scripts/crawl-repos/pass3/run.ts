#!/usr/bin/env tsx
/**
 * Pass 3 — TypeScript orchestrator.
 *
 * Calls Gemma 4 26B via Vertex AI for the summarization step.
 *
 * Usage:
 *   npx tsx scripts/crawl-repos/pass3/run.ts [--limit N] [--repo-id N] [--dry-run]
 *   npx tsx scripts/crawl-repos/pass3/run.ts [--concurrency N] (default 1)
 *
 * Env vars (loaded from .dev.vars):
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_D1_DATABASE_ID
 *   VERTEX_AI_PROJECT_ID (optional, defaults to pipe-493116)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '../../..');
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

import { z } from 'zod';
import { D1Client, loadD1Config } from '../shared/d1Client.js';
import { logger } from '../shared/logger.js';
import { fetchBatch } from './fetch.js';
import { computeContentHash } from './hash.js';
import { validatePass3 } from './validate.js';
import { persistAndVerify } from './persist.js';
import { auditSignals } from './audit.js';
import { classifyTestStyle } from './testStyleClassifier.js';
import { classifyChallengeSurfaces } from './challengeSurfaceClassifier.js';
import { computeDeterministicStats, computeComplexityBand } from './deterministicStats.js';
import { scoreRepoConfidence, type ScorerApiConfig } from '../../../src/lib/repoApproval/confidenceScorer';
import type { Pass2SignalSummary } from '../../../src/lib/repoApproval/confidenceScorerPrompts';
import { getAccessToken as getServiceAccountToken } from '../../../src/lib/llm/vertexAuth';
import type { Pass3Input, FetchOptions } from './types.js';
import type {
  Pass3Data,
  Pass3Output,
  RepoSubElement,
  RepoNodeType,
  ArchitectureStyle,
  ChallengeSuitabilityVerdict,
  TopPrPick,
} from '../shared/types.js';

// ─── Config ────────────────────────────────────────────────────────────────

const SIGNALS_VERSION = 'v2.0.0'; // migration 0028: RUC canonical enum + test_style + challenge_surfaces + repo_searchable_profile (STRATEGY Decision Log 2026-04-14)
const _rawModel = process.env['VERTEX_AI_MODEL'] ?? 'gemma-4-26b-a4b-it-maas';
const SUMMARIZER_MODEL = _rawModel.replace(/^google\//, '');
const MODEL_VERSION = 'v1';
const DEFAULT_CONCURRENCY = 1;

// ─── Vertex AI call ────────────────────────────────────────────────────────

interface VertexAIPart { text?: string }
interface VertexAIResponse {
  candidates?: Array<{ content?: { parts?: VertexAIPart[] } }>;
  error?: { code: number; message: string };
}

export async function callGemma(
  accessToken: string,
  projectId: string,
  systemPrompt: string,
  userPrompt: string,
  retries = 3,
  responseMimeType = 'application/json',
): Promise<string> {
  const region = process.env['VERTEX_AI_REGION'] ?? 'global';
  const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${SUMMARIZER_MODEL}:generateContent`;

  const combinedPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: combinedPrompt }] }],
    generationConfig: { maxOutputTokens: 8192, responseMimeType },
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body,
      signal: AbortSignal.timeout(90_000), // 90s timeout per call
    });

    if (res.status === 429 && attempt < retries) {
      const delay = 2000 * (attempt + 1); // 2s, 4s, 6s
      logger.warn(`[pass3] rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Vertex AI ${res.status}: ${err}`);
    }

    const data = (await res.json()) as VertexAIResponse;
    if (data.error) throw new Error(`Vertex AI error ${data.error.code}: ${data.error.message}`);

    const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
    if (!content) throw new Error('Vertex AI returned empty response');
    return content;
  }

  throw new Error('Vertex AI max retries exceeded');
}

// ─── Summarization prompt ──────────────────────────────────────────────────
//
// Gemma receives only three tasks: pick `architecture_style` from a fixed
// enum, write a 200–400-word `engineering_narrative`, and write a 400–600-word
// `repo_searchable_profile`. All numeric facts are pre-filled and must not be
// invented or rewritten — the validator enforces that every digit in the
// narrative corresponds to a FACTS value.

export interface PromptFacts {
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  swe_bench_eligibility_rate: number | null;
  complexity_band: 'low' | 'medium' | 'high' | 'mixed' | null;
  test_style: string;
  challenge_surfaces: Record<string, number>;
  business_logic_ratio: number | null;
  cross_module_change_rate: number | null;
  open_pr_count: number | null;
  open_feature_issue_count: number | null;
}

function fmt(n: number | null): string {
  return n === null ? 'unknown' : String(n);
}

export function buildSummarizerPrompt(
  input: Pass3Input,
  facts: PromptFacts,
): { system: string; user: string } {
  const system = `You are an engineering analyst. Given structured metadata about an open-source repository, produce a JSON object describing the repo's engineering culture, discoverability profile, fitness as a code-review assessment source, and decomposed sub-elements.

Output MUST be valid JSON matching this schema EXACTLY:

{
  "architecture_style": "monolith" | "layered_service" | "microservice" | "library" | "unknown",
  "engineering_narrative": string,
  "repo_searchable_profile": string,
  "challenge_suitability_verdict": "suitable" | "hold" | "reject",
  "challenge_suitability_reason": string,
  "top_pr_picks": [{ "pr_number": number, "why": string }],
  "red_flags": [string],
  "seniority_justification": string,
  "ideal_role_match": string,
  "sub_elements": {
    "features": [{ "slug": string, "narrative": string }],
    "architectural_patterns": [{ "slug": string, "narrative": string }],
    "technical_stack": [{ "slug": string, "narrative": string }],
    "constructs": [{ "slug": string, "narrative": string }],
    "challenge_surfaces": [{ "slug": string, "narrative": string }],
    "quality_signals": [{ "slug": string, "narrative": string }],
    "domain_contexts": [{ "slug": string, "narrative": string }]
  }
}

architecture_style definitions:
- "library": the repo's purpose is to be imported by other projects. No deployable runtime entrypoint.
- "layered_service": single-deploy application with clear controller/service/repository or equivalent internal layers.
- "monolith": single-deploy application without strong internal layering.
- "microservice": part of a multi-service topology OR function-as-a-service.
- "unknown": cannot determine from the provided signals.

challenge_suitability_verdict definitions (used to decide whether this repo should feed the code-review challenge bank):
- "suitable": repo has real business logic, clean PR shape, and would make a credible code-review challenge source.
- "hold": decision borderline — quality issues, thin PR sample, or uncertain domain fit. Needs human review.
- "reject": repo is vendor/generated/demo/tutorial code, test-theater, or otherwise unsuitable for assessment material.

Constraints:
- Return ONLY the JSON object. No markdown, no commentary.
- "engineering_narrative": 200–400 words. MUST mention the primary language (${input.primary_language}). Cover: test discipline, review culture, architecture style, complexity profile, notable PR-sample patterns.
- "repo_searchable_profile": 300–800 words. This is the MOST IMPORTANT field — it is embedded for semantic retrieval. Be thorough, specific, and expansive. Write dense, information-rich prose. Do NOT be terse. Produce EXACTLY this shape (keep the labels verbatim):

  Language: <2–4 sentences. Name the primary language and explain how it shapes the codebase. Mention frameworks, paradigms, or language-specific patterns visible in the repo.>

  Domain: <2–4 sentences. What problem space does this repo operate in? What would a developer build with it? Be specific about use cases and target users.>

  Architecture: <2–4 sentences. Describe the structural pattern and WHY it fits. Mention layering, package organization, or deployment model. Cite specific directories or files if relevant.>

  Seniority signal: <2–4 sentences. What complexity indicators place this repo at its seniority band? Discuss scale, abstraction depth, or advanced patterns.>

  Test culture: <2–4 sentences. Describe testing practices in detail — framework, coverage philosophy, test touch rate meaning, what kinds of tests exist.>

  Key technologies: <comma-separated deps/libs from detected_stack, 5–10 items>. Then <1–2 sentences explaining how the core technologies interact.>

  Challenge surfaces: <comma-separated top 3 surface names>. Then <2–3 sentences describing WHERE bugs or complexity tend to surface and WHY.>

  Summary: <5–8 sentence engineering narrative. What the repo does, how it's built, what makes it distinctive, and what a code reviewer would encounter. Role-agnostic. Cite specific technologies and patterns from the FACTS block.>

  PR shape: <3–5 sentences. Describe the review culture — PR sizes, test inclusion, issue linkage, and what a typical contribution looks like. Use actual numbers from FACTS.>

  Key concepts: <10–20 comma-separated noun phrases capturing engineering patterns>. Then <2–3 sentences tying the top 3-5 concepts to specific files or PR patterns in the repo.>

  Do not include any other sections, headings, or markdown. Labels must match exactly.
- "challenge_suitability_reason": one sentence, ≤ 200 characters.
- "top_pr_picks": 1–5 entries, each with pr_number matching one from the Sample PRs block and a 'why' reason ≤ 200 chars. Rank by review-teaching value.
- "red_flags": 0–6 short strings, each ≤ 200 chars. Concrete observations the mechanical checks may have missed (e.g. "README claims TypeScript but repo is all JS", "tests are stubs", "all PRs are dependency bumps"). Empty array if none.
- "seniority_justification": 2–4 sentences explaining why the mechanical seniority_band (${input.seniority_band ?? 'unknown'}) fits or misses.
- "ideal_role_match": short phrase ≤ 60 chars (e.g. "senior backend engineer", "mid frontend engineer").
- You MAY NOT invent numbers. Every numeric digit you write must correspond to a value from the FACTS block below. If a fact is "unknown", do not discuss it quantitatively.
- Be role-agnostic in the narrative. The ideal_role_match field is the only place to name a target role.

Sub-elements constraints:
- The "sub_elements" object contains arrays of repo-specific sub-elements. Do not force a fixed count per type; thin repos may have 0–2 entries per type, rich repos may have 5–8. Do not invent features absent from the signals.
- Each sub-element must have:
  - "slug": short kebab-case identifier (e.g. "async-io-pipeline", "jwt-auth-middleware")
  - "narrative": 2–3 sentences, repo-specific (not generic), citing specific technologies and scale indicators from the FACTS block.
- Supported types:
  - "features": Specific capabilities or user-facing functionality.
  - "architectural_patterns": Design patterns or structural approaches.
  - "technical_stack": Key libraries, frameworks, or infrastructure.
  - "constructs": Code-level patterns or idioms (map to detected constructs where possible).
  - "challenge_surfaces": Areas where bugs or complexity tend to surface.
  - "quality_signals": Indicators of engineering quality (test coverage, CI, documentation).
  - "domain_contexts": Business domain or problem-space context.`;

  const constructsList = input.constructs
    .slice(0, 10)
    .map((c) => `${c.slug} (${c.evidence_count})`)
    .join(', ');

  const prSummary = input.sample_prs.slice(0, 10).map((pr) => ({
    pr_number: pr.pr_number,
    title: pr.title,
    changed_files: pr.changed_file_count,
    modifies_tests: pr.modifies_tests === 1,
    resolves_issue: pr.resolves_issue_number !== null,
    swe_bench_eligible: pr.swe_bench_eligible === 1,
  }));

  const rootTree = parseRootTree(input.root_tree_json);
  const readmeBlock = input.readme_excerpt
    ? `\n\nREADME EXCERPT (verbatim, up to ~3KB — use this as the primary source for what the repo IS and DOES):\n\`\`\`\n${input.readme_excerpt}\n\`\`\``
    : '\n\nREADME EXCERPT: (none — repo ships without a README or it was empty)';
  const treeBlock = rootTree.length > 0
    ? `\n\nROOT TREE (top-level entries, with one level of children for dirs):\n${rootTree.map((e) => `  ${e}`).join('\n')}`
    : '';

  const user = `FACTS (do not modify, reason from these only):
- repo: ${input.full_name}
- primary_language: ${input.primary_language}
- detected_domain: ${input.detected_domain ?? 'unknown'}
- detected_stack: ${input.detected_stack_json ?? 'unknown'}
- stars: ${input.stars}
- sloc: ${fmt(input.sloc)}
- file_count: ${fmt(input.file_count)}
- mean_ccn: ${fmt(input.mean_ccn)}
- has_ci: ${input.has_ci === 1 ? 'yes' : 'no'}
- has_tests: ${input.has_tests === 1 ? 'yes' : 'no'}
- test_framework: ${input.test_framework ?? 'unknown'}
- seniority_band: ${input.seniority_band ?? 'unknown'}
- pr_quality_score: ${input.pr_quality_score.toFixed(2)}
- test_touch_rate: ${fmt(facts.test_touch_rate)}
- mean_changed_files: ${fmt(facts.mean_changed_files)}
- p90_changed_files: ${fmt(facts.p90_changed_files)}
- issue_link_rate: ${fmt(facts.issue_link_rate)}
- swe_bench_eligibility_rate: ${fmt(facts.swe_bench_eligibility_rate)}
- complexity_band: ${facts.complexity_band ?? 'unknown'}
- test_style: ${facts.test_style}
- business_logic_ratio: ${fmt(facts.business_logic_ratio)}
- cross_module_change_rate: ${fmt(facts.cross_module_change_rate)}
- open_pr_count: ${fmt(facts.open_pr_count)}
- open_feature_issue_count: ${fmt(facts.open_feature_issue_count)}
- challenge_surfaces (top 3, sorted desc): ${topSurfaces(facts.challenge_surfaces, 3)}

Top constructs: ${constructsList || 'none detected'}${readmeBlock}${treeBlock}

Sample PRs (${input.sample_prs.length} total, first 10):
${JSON.stringify(prSummary, null, 2)}

Produce all nine fields. Remember: use only numbers from FACTS. top_pr_picks pr_numbers MUST match the Sample PRs list. Use the README to ground what the repo actually does — do not hallucinate a purpose from the language/stack alone.`;

  return { system, user };
}

function parseRootTree(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function topSurfaces(surfaces: Record<string, number>, k: number): string {
  return Object.entries(surfaces)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([name, score]) => `${name}=${score.toFixed(2)}`)
    .join(', ');
}

// ─── Zod schemas ───────────────────────────────────────────────────────────

const repoSubElementJsonSchema = z.object({
  slug: z.string(),
  narrative: z.string(),
  extracted_properties: z.record(z.unknown()).optional(),
  source_reference: z.string().optional(),
});

const pass3SubElementsSchema = z.object({
  features: z.array(repoSubElementJsonSchema).optional().default([]),
  architectural_patterns: z.array(repoSubElementJsonSchema).optional().default([]),
  technical_stack: z.array(repoSubElementJsonSchema).optional().default([]),
  constructs: z.array(repoSubElementJsonSchema).optional().default([]),
  challenge_surfaces: z.array(repoSubElementJsonSchema).optional().default([]),
  quality_signals: z.array(repoSubElementJsonSchema).optional().default([]),
  domain_contexts: z.array(repoSubElementJsonSchema).optional().default([]),
});

export const pass3GemmaOutputSchema = z.object({
  architecture_style: z.enum(['monolith', 'layered_service', 'microservice', 'library', 'unknown']).optional(),
  engineering_narrative: z.string().optional(),
  repo_searchable_profile: z.string().optional(),
  challenge_suitability_verdict: z.enum(['suitable', 'hold', 'reject']).optional(),
  challenge_suitability_reason: z.string().optional(),
  top_pr_picks: z.array(z.object({ pr_number: z.number(), why: z.string() })).optional(),
  red_flags: z.array(z.string()).optional(),
  seniority_justification: z.string().optional(),
  ideal_role_match: z.string().optional(),
  sub_elements: pass3SubElementsSchema.optional(),
});

export type Pass3GemmaOutput = z.infer<typeof pass3GemmaOutputSchema>;

// ─── Parse Gemma response ──────────────────────────────────────────────────
//
// Gemma only writes three fields (architecture_style, engineering_narrative,
// repo_searchable_profile). Everything else comes from deterministic stats
// and classifiers. We merge here so the rest of the pipeline sees a single
// Pass3Data value.

const ARCHITECTURE_ENUM = new Set<ArchitectureStyle>([
  'monolith',
  'layered_service',
  'microservice',
  'library',
  'unknown',
]);

const SUITABILITY_ENUM = new Set<ChallengeSuitabilityVerdict>([
  'suitable',
  'hold',
  'reject',
]);

function parseTopPrPicks(value: unknown): TopPrPick[] {
  if (!Array.isArray(value)) return [];
  const picks: TopPrPick[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const pr_number = (entry as { pr_number?: unknown }).pr_number;
    const why = (entry as { why?: unknown }).why;
    if (typeof pr_number === 'number' && typeof why === 'string') {
      picks.push({ pr_number, why });
    }
  }
  return picks;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function flattenSubElements(
  subElements: Pass3GemmaOutput['sub_elements'],
): RepoSubElement[] {
  const result: RepoSubElement[] = [];
  const mappings: Array<[string, RepoNodeType]> = [
    ['features', 'Feature'],
    ['architectural_patterns', 'ArchitecturalPattern'],
    ['technical_stack', 'TechnicalStack'],
    ['constructs', 'Construct'],
    ['challenge_surfaces', 'ChallengeSurface'],
    ['quality_signals', 'QualitySignal'],
    ['domain_contexts', 'DomainContext'],
  ];
  for (const [key, nodeType] of mappings) {
    const arr = subElements[key as keyof typeof subElements] as Array<{
      slug: string;
      narrative: string;
      extracted_properties?: Record<string, unknown>;
      source_reference?: string;
    }>;
    for (const item of arr) {
      result.push({
        node_type: nodeType,
        slug: item.slug,
        narrative_text: item.narrative,
        extracted_properties: item.extracted_properties,
        source_reference: item.source_reference,
      });
    }
  }
  return result;
}

function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

export function buildPrAndIssueSubElements(input: Pass3Input): RepoSubElement[] {
  const result: RepoSubElement[] = [];

  for (const pr of input.sample_prs.slice(0, 5)) {
    const slug = sanitizeSlug(pr.title ?? `pr-${pr.pr_number}`) || `pr-${pr.pr_number}`;
    const narrative = `PR #${pr.pr_number}${pr.title ? `: "${pr.title}"` : ''} — changes ${pr.changed_file_count} file${pr.changed_file_count === 1 ? '' : 's'}${pr.modifies_tests ? ', touches tests' : ''}${pr.swe_bench_eligible ? ', SWE-bench eligible' : ''}. Demonstrates code-review patterns in this repo.`;
    result.push({
      node_type: 'PRSample',
      slug,
      narrative_text: narrative,
      source_reference: `pr:${pr.pr_number}`,
    });
  }

  for (const issue of input.issues.slice(0, 5)) {
    const slug = sanitizeSlug(issue.title ?? `issue-${issue.issue_number}`) || `issue-${issue.issue_number}`;
    const narrative = `Issue #${issue.issue_number}${issue.title ? `: "${issue.title}"` : ''} — ${issue.state_at_crawl}, ${issue.comment_count} comment${issue.comment_count === 1 ? '' : 's'}${issue.has_merged_pr ? ', has merged PR' : ', no merged PR'}. ${issue.has_merged_pr ? 'Already resolved; not a candidate for new implementation.' : 'Potential candidate for code-implementation challenge.'}`;
    result.push({
      node_type: 'IssueCandidate',
      slug,
      narrative_text: narrative,
      source_reference: `issue:${issue.issue_number}`,
    });
  }

  return result;
}

export function parseGemmaResponse(
  raw: string,
  input: Pass3Input,
  contentHash: string,
  facts: PromptFacts,
): Pass3Output {
  // Strip markdown code fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(stripped) as Record<string, unknown>;

  const archCandidate = parsed.architecture_style as string | undefined;
  const architecture_style: ArchitectureStyle | null =
    archCandidate && ARCHITECTURE_ENUM.has(archCandidate as ArchitectureStyle)
      ? (archCandidate as ArchitectureStyle)
      : null;

  const suitabilityCandidate = parsed.challenge_suitability_verdict as string | undefined;
  const challenge_suitability_verdict: ChallengeSuitabilityVerdict | null =
    suitabilityCandidate && SUITABILITY_ENUM.has(suitabilityCandidate as ChallengeSuitabilityVerdict)
      ? (suitabilityCandidate as ChallengeSuitabilityVerdict)
      : null;

  const subElementsRaw = (parsed.sub_elements ?? {}) as Pass3GemmaOutput['sub_elements'];
  const gemmaSubElements = flattenSubElements(subElementsRaw);
  const prIssueSubElements = buildPrAndIssueSubElements(input);

  return {
    repo_id: input.repo_id,
    signals_version: SIGNALS_VERSION,
    content_hash: contentHash,
    test_touch_rate: facts.test_touch_rate,
    mean_changed_files: facts.mean_changed_files,
    p90_changed_files: facts.p90_changed_files,
    issue_link_rate: facts.issue_link_rate,
    complexity_band: facts.complexity_band,
    swe_bench_eligibility_rate: facts.swe_bench_eligibility_rate,
    architecture_style,
    review_density: null,
    commit_cadence: null,
    satd_density: null,
    test_style: facts.test_style as Pass3Data['test_style'],
    challenge_surfaces: JSON.stringify(facts.challenge_surfaces),
    repo_searchable_profile:
      typeof parsed.repo_searchable_profile === 'string' ? parsed.repo_searchable_profile : '',
    engineering_narrative:
      typeof parsed.engineering_narrative === 'string' ? parsed.engineering_narrative : '',
    signal_json: stripped,
    model_used: SUMMARIZER_MODEL,
    model_version: MODEL_VERSION,
    challenge_suitability_verdict,
    challenge_suitability_reason:
      typeof parsed.challenge_suitability_reason === 'string'
        ? parsed.challenge_suitability_reason
        : null,
    top_pr_picks: parseTopPrPicks(parsed.top_pr_picks),
    red_flags: parseStringArray(parsed.red_flags),
    seniority_justification:
      typeof parsed.seniority_justification === 'string'
        ? parsed.seniority_justification
        : null,
    ideal_role_match:
      typeof parsed.ideal_role_match === 'string' ? parsed.ideal_role_match : null,
    subElements: [...gemmaSubElements, ...prIssueSubElements],
  };
}

// ─── Process a single repo ─────────────────────────────────────────────────

interface RepoResult {
  repo_id: number;
  full_name: string;
  status: 'cache_hit' | 'written' | 'gemma_error' | 'parse_error' | 'validation_failed' | 'persist_failed';
  detail?: string;
  narrative_len?: number;
  verdict?: 'auto_approve' | 'manual_review' | 'auto_reject';
}

export async function processRepo(
  accessToken: string,
  projectId: string,
  db: D1Client,
  input: Pass3Input,
  dryRun: boolean,
  scorerConfig: ScorerApiConfig | null,
  progress?: { index: number; total: number },
): Promise<RepoResult> {
  const base = { repo_id: input.repo_id, full_name: input.full_name };
  const tag = progress ? `[${progress.index}/${progress.total}]` : '';
  logger.info(`[pass3] ${tag} ${input.full_name} — starting`);

  // Step 1: Content hash check
  const contentHash = computeContentHash(input, SIGNALS_VERSION);
  const isCacheHit =
    input.prior_content_hash === contentHash &&
    input.prior_signals_version === SIGNALS_VERSION;

  if (isCacheHit) {
    return { ...base, status: 'cache_hit' };
  }

  if (dryRun) {
    return { ...base, status: 'written', detail: 'dry-run skip' };
  }

  // Step 2a: Deterministic stats + classifiers run BEFORE Gemma.
  // Gemma then only chooses architecture_style and writes narratives.
  const stats = computeDeterministicStats(input.sample_prs);
  const testStyle = classifyTestStyle({
    test_touch_rate: stats.test_touch_rate,
    detected_stack_json: input.detected_stack_json,
  });
  const challengeSurfaces = classifyChallengeSurfaces({
    detected_stack_json: input.detected_stack_json,
    primary_language: input.primary_language,
    constructs: input.constructs,
    detected_domain: input.detected_domain,
  });
  const facts: PromptFacts = {
    ...stats,
    complexity_band: computeComplexityBand(input.mean_ccn),
    test_style: testStyle,
    challenge_surfaces: challengeSurfaces as unknown as Record<string, number>,
    business_logic_ratio: input.business_logic_ratio,
    cross_module_change_rate: input.cross_module_change_rate,
    open_pr_count: input.open_pr_count,
    open_feature_issue_count: input.open_feature_issue_count,
  };

  // Step 2b: Call Gemma
  logger.info(`[pass3] ${tag} ${input.full_name} — calling Gemma`);
  const { system, user: factsPrompt } = buildSummarizerPrompt(input, facts);
  let raw: string;
  try {
    raw = await callGemma(accessToken, projectId, system, factsPrompt);
  } catch (err) {
    return { ...base, status: 'gemma_error', detail: err instanceof Error ? err.message : String(err) };
  }
  logger.info(`[pass3] ${tag} ${input.full_name} — Gemma done`);

  // Step 3: Parse
  let output: Pass3Output;
  try {
    output = parseGemmaResponse(raw, input, contentHash, facts);
  } catch (err) {
    return { ...base, status: 'parse_error', detail: `${err instanceof Error ? err.message : String(err)} | raw: ${raw.slice(0, 200)}` };
  }

  // Step 3b: Zod validation of sub-elements before any D1 write
  try {
    pass3GemmaOutputSchema.parse(JSON.parse(output.signal_json));
  } catch (err) {
    return {
      ...base,
      status: 'validation_failed',
      detail: `Zod validation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Step 4: Validate — retry once if it fails
  let validation = validatePass3(input, output);
  if (!validation.valid) {
    logger.warn(
      `[pass3] ${tag} ${input.full_name} — validation failed (${validation.failures.length} issues). Retrying Gemma with corrections.`,
    );
    const retryPrompt =
      `${factsPrompt}\n\n---\nPREVIOUS ATTEMPT FAILED validation. Your output was TOO SHORT and INSUFFICIENTLY DETAILED. Fix ALL of the following issues in your new response by DRAMATICALLY EXPANDING every section. Write at least TWICE as much content as before. Be verbose, specific, and thorough:\n` +
      validation.failures.map((f) => `- ${f}`).join('\n') +
      `\n\nCRITICAL: The repo_searchable_profile must be 300+ words. Write multiple detailed sentences for EVERY labeled section. Do NOT write brief clauses — write rich, informative paragraphs.`;

    let retryRaw: string;
    try {
      retryRaw = await callGemma(accessToken, projectId, system, retryPrompt);
    } catch (err) {
      return {
        ...base,
        status: 'validation_failed',
        detail: `validation failed; retry Gemma failed: ${err instanceof Error ? err.message : String(err)} | original_failures: ${validation.failures.join('; ')}`,
      };
    }

    try {
      output = parseGemmaResponse(retryRaw, input, contentHash, facts);
    } catch {
      return {
        ...base,
        status: 'validation_failed',
        detail: `validation failed; retry parse failed | original_failures: ${validation.failures.join('; ')}`,
      };
    }

    // Re-run Zod validation on retry output
    try {
      pass3GemmaOutputSchema.parse(JSON.parse(output.signal_json));
    } catch (err) {
      return {
        ...base,
        status: 'validation_failed',
        detail: `Zod validation failed on retry: ${err instanceof Error ? err.message : String(err)} | original_failures: ${validation.failures.join('; ')}`,
      };
    }

    validation = validatePass3(input, output);
    if (!validation.valid) {
      logger.error(
        `[pass3] ${tag} ${input.full_name} — validation still failed after retry. Dropping. Failures: ${validation.failures.join('; ')}`,
      );
      return { ...base, status: 'validation_failed', detail: `after retry: ${validation.failures.join('; ')}` };
    }

    logger.info(`[pass3] ${tag} ${input.full_name} — validation passed on retry`);
  }
  if (validation.warnings.length > 0) {
    logger.warn(`[pass3] ${input.full_name} warnings: ${validation.warnings.join('; ')}`);
  }

  // Step 4.5: Confidence scoring (cross-family: Qwen evaluates Gemma)
  if (scorerConfig) {
    logger.info(`[pass3] ${tag} ${input.full_name} — scoring confidence`);
    try {
      const pass2Signals: Pass2SignalSummary = {
        repo_id: input.repo_id,
        full_name: input.full_name,
        primary_language: input.primary_language,
        stars: input.stars,
        sloc: input.sloc,
        file_count: input.file_count,
        mean_ccn: input.mean_ccn,
        seniority_band: input.seniority_band,
        has_ci: input.has_ci,
        has_tests: input.has_tests,
        test_framework: input.test_framework,
        detected_domain: input.detected_domain,
        pr_quality_score: input.pr_quality_score,
        open_pr_count: input.open_pr_count,
        open_feature_issue_count: input.open_feature_issue_count,
        business_logic_ratio: input.business_logic_ratio,
        cross_module_change_rate: input.cross_module_change_rate,
        test_touch_rate: output.test_touch_rate,
        mean_changed_files: output.mean_changed_files,
        p90_changed_files: output.p90_changed_files,
        issue_link_rate: output.issue_link_rate,
        swe_bench_eligibility_rate: output.swe_bench_eligibility_rate,
        complexity_band: output.complexity_band,
        test_style: output.test_style,
        challenge_surfaces: output.challenge_surfaces,
        detected_stack_json: input.detected_stack_json,
        constructs: input.constructs,
      };
      const confidence = await scoreRepoConfidence(
        {
          engineeringNarrative: output.engineering_narrative,
          repoSearchableProfile: output.repo_searchable_profile,
          pass2Signals,
        },
        scorerConfig,
      );
      output.confidence_score = confidence.aggregate;
      output.confidence_scores_json = JSON.stringify(confidence.scores);
      output.confidence_verdict = confidence.verdict;
      output.confidence_scored_at = Math.floor(Date.now() / 1000);
      logger.info(
        `[pass3] ${tag} ${input.full_name} — confidence=${confidence.aggregate} verdict=${confidence.verdict}`,
      );
    } catch (err) {
      logger.warn(`[pass3] ${tag} ${input.full_name} — confidence scoring failed, defaulting to manual_review`, {
        error: err instanceof Error ? err.message : String(err),
      });
      output.confidence_score = null;
      output.confidence_scores_json = null;
      output.confidence_verdict = 'manual_review';
      output.confidence_scored_at = null;
    }
  } else {
    // No scorer config — default to manual_review (existing queue behavior)
    output.confidence_score = null;
    output.confidence_scores_json = null;
    output.confidence_verdict = 'manual_review';
    output.confidence_scored_at = null;
  }

  // Step 5: Persist
  const persistResult = await persistAndVerify(db, output, false);
  if (!persistResult.verified) {
    return {
      ...base,
      status: 'persist_failed',
      detail: `expected=${persistResult.expectedHash} actual=${persistResult.actualHash}`,
    };
  }

  return { ...base, status: 'written', narrative_len: output.engineering_narrative.length, verdict: output.confidence_verdict ?? 'manual_review' };
}

// ─── Concurrency helper ────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    let item: T | undefined;
    while ((item = queue.shift()) !== undefined) {
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// ─── Main ──────────────────────────────────────────────────────────────────

interface RunStats {
  total: number;
  cacheHits: number;
  written: number;
  validationFailed: number;
  gemmaErrors: number;
  persistFailed: number;
  autoApproved: number;
  manualReview: number;
  autoRejected: number;
}

export async function getAccessToken(): Promise<string> {
  // 1. Try service account key from VERTEX_SA_KEY_JSON (preferred — no browser needed)
  const saJson = process.env['VERTEX_SA_KEY_JSON'];
  if (saJson) {
    try {
      const sa = JSON.parse(saJson) as { private_key?: string; client_email?: string; project_id?: string };
      if (sa.private_key && sa.client_email && sa.project_id) {
        logger.info('[pass3] Using VERTEX_SA_KEY_JSON for Vertex AI auth...');
        return getServiceAccountToken(sa as { private_key: string; client_email: string; project_id: string });
      }
    } catch {
      logger.warn('[pass3] VERTEX_SA_KEY_JSON present but invalid, falling back to ADC');
    }
  }

  // 2. Fall back to ADC (authorized_user credentials from gcloud)
  const { readFileSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const adcPath = process.env['GOOGLE_APPLICATION_CREDENTIALS']
    ?? `${homedir()}/.config/gcloud/application_default_credentials.json`;

  let creds: { client_id: string; client_secret: string; refresh_token: string; type: string };
  try {
    creds = JSON.parse(readFileSync(adcPath, 'utf-8')) as typeof creds;
  } catch {
    throw new Error(
      `Could not read ADC credentials at ${adcPath}. ` +
      `Run: gcloud auth application-default login --no-browser`,
    );
  }

  if (creds.type !== 'authorized_user') {
    throw new Error(`Unsupported ADC credential type: ${creds.type}. Expected authorized_user.`);
  }

  logger.info('[pass3] Refreshing Vertex AI access token via ADC...');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { access_token: string };
  if (!data.access_token) throw new Error('Token refresh returned no access_token');
  logger.info('[pass3] Access token refreshed successfully');
  return data.access_token;
}

export async function run(
  opts: FetchOptions & { dryRun?: boolean; concurrency?: number },
): Promise<void> {
  const accessToken = await getAccessToken();
  const projectId = process.env['VERTEX_AI_PROJECT_ID'] ?? 'pipe-493116';

  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const db = new D1Client(loadD1Config());
  const runStart = new Date().toISOString();

  // Build scorer config from env (optional — if missing, all repos default to manual_review)
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'];
  const scorerConfig: ScorerApiConfig | null =
    accountId && apiToken
      ? {
          accountId,
          apiToken,
          model: process.env['CONFIDENCE_SCORER_MODEL'] ?? undefined,
        }
      : null;

  logger.info('[pass3/run] Fetching batch...');
  const batch = await fetchBatch(db, opts);
  logger.info(
    `[pass3/run] ${batch.length} repos in batch (concurrency=${concurrency}, scorer=${scorerConfig ? 'enabled' : 'disabled'})`,
  );

  if (batch.length === 0) {
    logger.info('[pass3/run] Nothing to do.');
    return;
  }

  const stats: RunStats = {
    total: batch.length,
    cacheHits: 0,
    written: 0,
    validationFailed: 0,
    gemmaErrors: 0,
    persistFailed: 0,
    autoApproved: 0,
    manualReview: 0,
    autoRejected: 0,
  };

  const failures: Array<{ repo_id: number; full_name: string; reason: string }> = [];

  let doneCount = 0;
  await runWithConcurrency(batch, concurrency, async (input: Pass3Input) => {
    const index = ++doneCount;
    const result = await processRepo(
      accessToken,
      projectId,
      db,
      input,
      opts.dryRun ?? false,
      scorerConfig,
      { index, total: batch.length },
    );
    // Track verdicts for written repos
    if (result.status === 'written' && 'verdict' in result) {
      const v = (result as unknown as { verdict: string }).verdict;
      if (v === 'auto_approve') stats.autoApproved++;
      else if (v === 'manual_review') stats.manualReview++;
      else if (v === 'auto_reject') stats.autoRejected++;
    }

    switch (result.status) {
      case 'cache_hit':
        stats.cacheHits++;
        logger.info(`[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=cache_hit`);
        break;
      case 'written':
        stats.written++;
        logger.info(
          `[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=written narrative_len=${result.narrative_len ?? 0}`,
        );
        break;
      case 'gemma_error':
      case 'parse_error':
        stats.gemmaErrors++;
        logger.error(`[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=${result.status} detail=${result.detail}`);
        failures.push({ repo_id: result.repo_id, full_name: result.full_name, reason: `${result.status}: ${result.detail}` });
        break;
      case 'validation_failed':
        stats.validationFailed++;
        logger.error(`[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=validation_failed failures=${result.detail}`);
        failures.push({ repo_id: result.repo_id, full_name: result.full_name, reason: `validation: ${result.detail}` });
        break;
      case 'persist_failed':
        stats.persistFailed++;
        logger.error(`[pass3] repo_id=${result.repo_id} full_name=${result.full_name} status=persist_unverified ${result.detail}`);
        failures.push({ repo_id: result.repo_id, full_name: result.full_name, reason: `persist: ${result.detail}` });
        break;
    }
  });

  // Final report
  console.log('\n═══ Pass 3 — Vertex AI Gemma ═══');
  console.log(`Batch:             ${stats.total} repos`);
  console.log(`  Cache hits:      ${stats.cacheHits}`);
  console.log(`  Written:         ${stats.written}`);
  console.log(`  Validation fail: ${stats.validationFailed}`);
  console.log(`  Gemma errors:    ${stats.gemmaErrors}`);
  console.log(`  Persist fail:    ${stats.persistFailed}`);
  console.log(`  Auto-approved:   ${stats.autoApproved}`);
  console.log(`  Manual review:   ${stats.manualReview}`);
  console.log(`  Auto-rejected:   ${stats.autoRejected}`);
  console.log(`signals_version:   ${SIGNALS_VERSION}`);
  console.log(`model_used:        ${SUMMARIZER_MODEL}`);
  console.log(`concurrency:       ${concurrency}`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  repo_id=${f.repo_id} ${f.full_name}: ${f.reason}`);
    }
  }

  // Audit
  if (!opts.dryRun && stats.written > 0) {
    console.log('\n─── Audit (rows written this run) ───');
    const audit = await auditSignals(db, runStart);
    for (const row of audit) {
      console.log(
        `  ${row.repo_id} ${row.full_name ?? '(orphan)'} narr=${row.narrative_len} model=${row.model_used}`,
      );
    }
  }
}

// ─── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): FetchOptions & { dryRun?: boolean; concurrency?: number } {
  const opts: FetchOptions & { dryRun?: boolean; concurrency?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') {
      opts.limit = Number(argv[++i]);
    } else if (a === '--repo-id') {
      opts.repoId = Number(argv[++i]);
    } else if (a === '--only-missing') {
      opts.onlyMissing = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--concurrency') {
      opts.concurrency = Number(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: npx tsx scripts/crawl-repos/pass3/run.ts [--limit N] [--repo-id N] [--only-missing] [--dry-run] [--concurrency N]');
      process.exit(0);
    }
  }
  return opts;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  run(opts).catch((err) => {
    console.error('[pass3/run] Fatal:', err);
    process.exit(1);
  });
}
