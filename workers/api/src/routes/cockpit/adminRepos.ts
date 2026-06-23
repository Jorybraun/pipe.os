/**
 * Admin repo management — human-in-the-loop approval for qualified_repos.
 *
 * Mounts under /api/v1/admin.
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Routes:
 *   GET   /api/v1/admin/repos                     — list repos (status + pass filters, pagination)
 *   GET   /api/v1/admin/repos/:id                 — single repo + engineering_signals join
 *   GET   /api/v1/admin/repos/:id/prs             — sample PRs for a specific repo
 *   PATCH /api/v1/admin/repos/:id                 — set admin_status + optional admin_reason
 *   POST  /api/v1/admin/repos/:id/requeue         — demote repo to pass=1 for re-crawling
 *   POST  /api/v1/admin/repos/:id/pass3/analyze   — Gemma summarization (no vectorize)
 *   POST  /api/v1/admin/repos/:id/pass3/feedback  — record admin verdict + critique
 *   POST  /api/v1/admin/repos/:id/pass3/ingest    — vectorize approved narrative → REPO_INDEX
 *   GET   /api/v1/admin/repos/bulk-ingest/preview  — per-verdict unvectorized counts
 *   POST  /api/v1/admin/repos/bulk-ingest         — batch ingest by verdict selection
 *   POST  /api/v1/admin/repos/:id/pass3           — back-compat one-shot (analyze + approve + ingest)
 *
 * Status filter semantics (status= query param):
 *   'pending'  → disqualified=0, admin_status='pending'
 *   'approved' → disqualified=0, admin_status='approved'
 *   'denied'   → disqualified=0, admin_status='denied'
 *   'failed'   → disqualified=1
 *   'all'      → no admin_status filter
 *
 * Pass filter (pass= query param):
 *   '1' → pass=1 only
 *   '2' → pass=2 only
 *   '3' → pass=3 only
 *   omit → all passes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { EMBEDDING_MODEL_VERSION, preprocessForEmbedding } from '../../lib/embedding/preprocess';
import { createRoleAgentProvider } from '../../lib/llm/createProvider';
import { VertexAIProvider } from '../../lib/llm/vertexAIProvider';
import { recordAiUsage } from '../../lib/aiUsage';
import type { TokenUsage } from '../../lib/llm/pricing';
import type { Env, Variables } from '../../types';

const adminRepos = new Hono<{ Bindings: Env; Variables: Variables }>();

adminRepos.use('*', authMiddleware);

// ─── Shared row type ──────────────────────────────────────────────────────────

interface RepoRow {
  id: number;
  full_name: string;
  github_url: string;
  primary_language: string;
  stars: number;
  detected_domain: string | null;
  seniority_band: string | null;
  sloc: number | null;
  file_count: number | null;
  mean_ccn: number | null;
  pr_quality_score: number;
  open_feature_issue_count: number | null;
  open_pr_count: number | null;
  has_ci: number;
  has_tests: number;
  test_framework: string | null;
  detected_stack_json: string | null;
  admin_status: string;
  admin_reason: string | null;
  disqualified: number;
  disqualified_reason: string | null;
  pass: number;
  crawled_at: string;
  has_signals: number;
  top_skills_csv: string | null;
  challenge_suitability_verdict: string | null;
  confidence_score: number | null;
  confidence_verdict: string | null;
}

interface SamplePRRow {
  pr_number: number;
  pr_url: string;
  title: string | null;
  merged_at: string;
  changed_file_count: number;
  modifies_tests: number;
  swe_bench_eligible: number;
  additions: number | null;
  deletions: number | null;
  resolves_issue_number: number | null;
}

function normalizeGitHubRepoInput(input: string): { fullName: string; githubUrl: string } | null {
  const trimmed = input.trim().replace(/\.git$/, '');
  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand?.[1] && shorthand[2]) {
    const fullName = `${shorthand[1]}/${shorthand[2]}`;
    return { fullName, githubUrl: `https://github.com/${fullName}` };
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const [owner, repo] = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (!owner || !repo) return null;
    const fullName = `${owner}/${repo}`;
    return { fullName, githubUrl: `https://github.com/${fullName}` };
  } catch {
    return null;
  }
}

// ─── GET /api/v1/admin/repos ─────────────────────────────────────────────────

adminRepos.get('/repos', async (c) => {
  const statusParam = c.req.query('status') ?? 'pending';
  const passParam   = c.req.query('pass');   // '1' | '2' | '3' | undefined
  const suitabilityParam = c.req.query('suitability'); // 'suitable' | 'hold' | 'reject' | 'any' | undefined
  const page  = Math.max(1, Number(c.req.query('page')  ?? '1'));
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? '50')));
  const offset = (page - 1) * limit;

  // Build WHERE conditions
  const conditions: string[] = [];
  const baseParams: (string | number)[] = [];

  if (statusParam === 'failed') {
    conditions.push('qr.disqualified = 1');
  } else {
    conditions.push('qr.disqualified = 0');
    if (statusParam !== 'all' && ['pending', 'approved', 'denied'].includes(statusParam)) {
      conditions.push('qr.admin_status = ?');
      baseParams.push(statusParam);
    } else if (!['all', 'pending', 'approved', 'denied'].includes(statusParam)) {
      return c.json({ repos: [], total: 0, page, limit });
    }
  }

  if (passParam && ['1', '2', '3'].includes(passParam)) {
    conditions.push('qr.pass = ?');
    baseParams.push(Number(passParam));
  } else if (passParam) {
    return c.json({ repos: [], total: 0, page, limit });
  }

  if (suitabilityParam && ['suitable', 'hold', 'reject'].includes(suitabilityParam)) {
    conditions.push('res.challenge_suitability_verdict = ?');
    baseParams.push(suitabilityParam);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as total
     FROM qualified_repos qr
     LEFT JOIN repo_engineering_signals res ON res.repo_id = qr.id
     ${where}`,
  )
    .bind(...baseParams)
    .first<{ total: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT
       qr.id, qr.full_name, qr.github_url, qr.primary_language, qr.stars,
       qr.detected_domain, qr.seniority_band, qr.sloc, qr.file_count, qr.mean_ccn,
       qr.pr_quality_score, qr.open_feature_issue_count, qr.open_pr_count,
       qr.has_ci, qr.has_tests, qr.test_framework, qr.detected_stack_json,
       qr.admin_status, qr.admin_reason, qr.disqualified, qr.disqualified_reason,
       qr.pass, qr.crawled_at,
       CASE WHEN res.repo_id IS NOT NULL THEN 1 ELSE 0 END AS has_signals,
       res.challenge_suitability_verdict,
       res.confidence_score,
       res.confidence_verdict,
       (SELECT GROUP_CONCAT(skill_slug, ',') FROM (
         SELECT skill_slug FROM repo_skills WHERE repo_id = qr.id ORDER BY confidence DESC LIMIT 8
       )) AS top_skills_csv
     FROM qualified_repos qr
     LEFT JOIN repo_engineering_signals res ON res.repo_id = qr.id
     ${where}
     ORDER BY qr.stars DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...baseParams, limit, offset)
    .all<RepoRow>();

  return c.json({
    repos: results,
    total: countRow?.total ?? 0,
    page,
    limit,
  });
});

// ─── GET /api/v1/admin/repos/lookup ──────────────────────────────────────────
// Exact lookup for a manually typed GitHub repo URL. Used by the code-review
// picker so crawler-backed PRs remain usable even when the repo is not in the
// first catalog page.

adminRepos.get('/repos/lookup', async (c) => {
  const repoUrlParam = c.req.query('repoUrl');
  if (!repoUrlParam) return apiError(c, 'VALIDATION_ERROR', 'repoUrl query parameter is required.');

  const normalized = normalizeGitHubRepoInput(repoUrlParam);
  if (!normalized) return apiError(c, 'VALIDATION_ERROR', 'Invalid GitHub repository URL.');

  const rawMinPass = Number(c.req.query('minPass') ?? '2');
  if (!Number.isFinite(rawMinPass)) {
    return apiError(c, 'VALIDATION_ERROR', 'Invalid minPass filter.');
  }
  const minPass = Math.min(3, Math.max(1, rawMinPass));
  const suitabilityParam = c.req.query('suitability') ?? 'suitable';
  if (!['suitable', 'hold', 'reject', 'any'].includes(suitabilityParam)) {
    return apiError(c, 'VALIDATION_ERROR', 'Invalid suitability filter.');
  }

  const suitabilitySql = suitabilityParam === 'any'
    ? ''
    : 'AND res.challenge_suitability_verdict = ?4';
  const params: Array<string | number> = [
    normalized.fullName.toLowerCase(),
    normalized.githubUrl.toLowerCase(),
    minPass,
  ];
  if (suitabilityParam !== 'any') params.push(suitabilityParam);

  const repo = await c.env.DB.prepare(
    `SELECT
       qr.id, qr.full_name, qr.github_url, qr.primary_language, qr.stars,
       qr.admin_status, qr.disqualified, qr.pass,
       res.challenge_suitability_verdict,
       res.confidence_score,
       res.confidence_verdict
     FROM qualified_repos qr
     LEFT JOIN repo_engineering_signals res ON res.repo_id = qr.id
     WHERE qr.disqualified = 0
       AND qr.pass >= ?3
       AND (
         LOWER(qr.full_name) = ?1
         OR LOWER(REPLACE(qr.github_url, '.git', '')) = ?2
       )
       ${suitabilitySql}
     ORDER BY
       CASE qr.admin_status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
       qr.pass DESC,
       qr.stars DESC
     LIMIT 1`,
  ).bind(...params).first<{
    id: number;
    full_name: string;
    github_url: string;
    primary_language: string;
    stars: number;
    admin_status: string;
    disqualified: number;
    pass: number;
    challenge_suitability_verdict: string | null;
    confidence_score: number | null;
    confidence_verdict: string | null;
  }>();

  return c.json({ repo: repo ?? null });
});

// ─── GET /api/v1/admin/repos/:id ─────────────────────────────────────────────
// Single repo + engineering_signals (nullable join). Used by the detail page.

interface SignalsRow {
  signals_version: string | null;
  content_hash: string | null;
  architecture_style: string | null;
  engineering_narrative: string | null;
  repo_searchable_profile: string | null;
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  swe_bench_eligibility_rate: number | null;
  model_used: string | null;
  model_version: string | null;
  admin_verdict: string | null;
  admin_feedback_text: string | null;
  verdict_at: string | null;
  vectorized_at: string | null;
  challenge_suitability_verdict: string | null;
  challenge_suitability_reason: string | null;
  top_pr_picks_json: string | null;
  red_flags_json: string | null;
  seniority_justification: string | null;
  ideal_role_match: string | null;
  confidence_score: number | null;
  confidence_scores_json: string | null;
  confidence_verdict: string | null;
  confidence_scored_at: number | null;
}

export interface ReviewChallengePacketRow {
  id: string;
  repo_snapshot_id: string;
  pr_number: number;
  packet_version: string;
  source_hash: string;
  language: string | null;
  production_ready: number;
  quality_score: number;
  demand_families_json: string;
  packet_json: string;
  created_at: number;
  updated_at: number;
}

export interface ReviewChallengePacketSummary {
  id: string;
  repoSnapshotId: string;
  prNumber: number;
  packetVersion: string;
  sourceHash: string;
  language: string | null;
  productionReady: boolean;
  qualityScore: number;
  demandFamilies: string[];
  gateFailures: string[];
  updatedAt: number;
}

export function toReviewChallengePacketSummary(
  packet: ReviewChallengePacketRow,
): ReviewChallengePacketSummary {
  let demandFamilies: string[] = [];
  let gateFailures: string[] = [];
  try {
    const parsed = JSON.parse(packet.demand_families_json) as unknown;
    if (Array.isArray(parsed)) demandFamilies = parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    demandFamilies = [];
  }
  try {
    const parsed = JSON.parse(packet.packet_json) as {
      quality?: { gates?: Array<{ gate?: string; passed?: boolean; reason?: string }> };
    };
    gateFailures = (parsed.quality?.gates ?? [])
      .filter((gate) => gate.passed === false)
      .map((gate) => `${gate.gate ?? 'gate'}: ${gate.reason ?? 'failed'}`);
  } catch {
    gateFailures = ['packet_json could not be parsed'];
  }
  return {
    id: packet.id,
    repoSnapshotId: packet.repo_snapshot_id,
    prNumber: packet.pr_number,
    packetVersion: packet.packet_version,
    sourceHash: packet.source_hash,
    language: packet.language,
    productionReady: packet.production_ready === 1,
    qualityScore: packet.quality_score,
    demandFamilies,
    gateFailures,
    updatedAt: packet.updated_at,
  };
}

adminRepos.get('/repos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return apiError(c, 'VALIDATION_ERROR', 'invalid id');

  const repo = await c.env.DB.prepare(
    `SELECT
       qr.id, qr.full_name, qr.github_url, qr.primary_language, qr.stars,
       qr.detected_domain, qr.seniority_band, qr.sloc, qr.file_count, qr.mean_ccn,
       qr.pr_quality_score, qr.open_feature_issue_count, qr.open_pr_count,
       qr.has_ci, qr.has_tests, qr.test_framework, qr.detected_stack_json,
       qr.admin_status, qr.admin_reason, qr.disqualified, qr.disqualified_reason,
       qr.pass, qr.crawled_at,
       CASE WHEN res.repo_id IS NOT NULL THEN 1 ELSE 0 END AS has_signals,
       res.challenge_suitability_verdict,
       res.confidence_score,
       res.confidence_verdict,
       (SELECT GROUP_CONCAT(skill_slug, ',') FROM (
         SELECT skill_slug FROM repo_skills WHERE repo_id = qr.id ORDER BY confidence DESC LIMIT 8
       )) AS top_skills_csv
     FROM qualified_repos qr
     LEFT JOIN repo_engineering_signals res ON res.repo_id = qr.id
     WHERE qr.id = ?`,
  ).bind(id).first<RepoRow>();

  if (!repo) return apiError(c, 'NOT_FOUND', 'repo not found');

  const signals = await c.env.DB.prepare(
    `SELECT signals_version, content_hash, architecture_style,
            engineering_narrative, repo_searchable_profile,
            test_touch_rate, mean_changed_files, p90_changed_files,
            issue_link_rate, swe_bench_eligibility_rate,
            model_used, model_version,
            admin_verdict, admin_feedback_text, verdict_at, vectorized_at,
            challenge_suitability_verdict, challenge_suitability_reason,
            top_pr_picks_json, red_flags_json,
            seniority_justification, ideal_role_match,
            confidence_score, confidence_scores_json,
            confidence_verdict, confidence_scored_at
     FROM repo_engineering_signals WHERE repo_id = ?`,
  ).bind(id).first<SignalsRow>();

  const { results: packetRows } = await c.env.DB.prepare(
    `SELECT id, repo_snapshot_id, pr_number, packet_version, source_hash,
            language, production_ready, quality_score, demand_families_json,
            packet_json, created_at, updated_at
       FROM review_challenge_packets
      WHERE repo_id = ?
      ORDER BY production_ready DESC, quality_score DESC, updated_at DESC
      LIMIT 10`,
  ).bind(id).all<ReviewChallengePacketRow>();

  const reviewChallengePackets = (packetRows ?? []).map(toReviewChallengePacketSummary);

  return c.json({ repo, signals: signals ?? null, reviewChallengePackets });
});

// ─── GET /api/v1/admin/repos/:id/prs ─────────────────────────────────────────

adminRepos.get('/repos/:id/prs', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return apiError(c, 'VALIDATION_ERROR', 'invalid id');

  const { results } = await c.env.DB.prepare(
    `SELECT pr_number, pr_url, title, merged_at, changed_file_count,
            modifies_tests, swe_bench_eligible, additions, deletions,
            resolves_issue_number
     FROM repo_sample_prs
     WHERE repo_id = ?
     ORDER BY pr_number`,
  )
    .bind(id)
    .all<SamplePRRow>();

  return c.json({ prs: results });
});

// ─── PATCH /api/v1/admin/repos/:id ───────────────────────────────────────────

const patchSchema = z.object({
  admin_status: z.enum(['pending', 'approved', 'denied']),
  admin_reason: z.string().max(1000).optional(),
});

adminRepos.patch('/repos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return apiError(c, 'VALIDATION_ERROR', 'invalid id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'invalid JSON body');
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'invalid body');
  }

  const reason = parsed.data.admin_reason ?? null;
  const result = await c.env.DB.prepare(
    `UPDATE qualified_repos SET admin_status = ?, admin_reason = ? WHERE id = ?`,
  )
    .bind(parsed.data.admin_status, reason, id)
    .run();

  if (result.meta.changes === 0) return apiError(c, 'NOT_FOUND', 'repo not found');

  return c.json({ ok: true, id, admin_status: parsed.data.admin_status });
});

// ─── POST /api/v1/admin/repos/:id/requeue ────────────────────────────────────
// Demotes a repo back to pass=1 so pass 2 re-crawls it.
// Clears all pass-2 derived data: PRs, constructs, signals, analysis columns.

adminRepos.post('/repos/:id/requeue', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return apiError(c, 'VALIDATION_ERROR', 'invalid id');

  const repo = await c.env.DB.prepare(
    `SELECT id, pass FROM qualified_repos WHERE id = ?`,
  ).bind(id).first<{ id: number; pass: number }>();

  if (!repo) return apiError(c, 'NOT_FOUND', 'repo not found');

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM repo_engineering_signals WHERE repo_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM repo_sample_prs WHERE repo_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM repo_constructs WHERE repo_id = ?`).bind(id),
    c.env.DB.prepare(
      `UPDATE qualified_repos SET
         pass = 1, disqualified = 0, disqualified_reason = NULL,
         admin_status = 'pending', admin_reason = NULL,
         sloc = NULL, file_count = NULL, mean_ccn = NULL,
         has_ci = 0, has_tests = 0, test_framework = NULL,
         detected_domain = NULL, detected_stack_json = NULL,
         seniority_band = NULL, pr_quality_score = 0,
         business_logic_ratio = NULL, cross_module_change_rate = NULL
       WHERE id = ?`,
    ).bind(id),
  ]);

  return c.json({ ok: true, id, pass: 1 });
});

// ─── Pass 3 — split into analyze / feedback / ingest ─────────────────────────
// Analyze: Gemma summarization + D1 persist. Does NOT vectorize.
// Feedback: admin records approve/deny verdict + optional critique.
// Ingest: embed repo_searchable_profile + upsert to REPO_INDEX (requires
//         admin_verdict = 'approved').
// Back-compat /pass3: runs analyze → approve → ingest in one shot, keyed
//         on the older admin_status = 'approved' gate.

interface ConstructRow { construct_slug: string; evidence_count: number }

interface Pass3Facts {
  repo: {
    id: number;
    full_name: string;
    primary_language: string;
    stars: number;
    sloc: number | null;
    file_count: number | null;
    mean_ccn: number | null;
    has_ci: number;
    has_tests: number;
    test_framework: string | null;
    detected_domain: string | null;
    detected_stack_json: string | null;
    seniority_band: string | null;
    pr_quality_score: number;
    open_pr_count: number | null;
    open_feature_issue_count: number | null;
    readme_excerpt: string | null;
    root_tree_json: string | null;
    admin_status: string;
    pass: number;
  };
  prs: Array<{
    pr_number: number;
    title: string | null;
    changed_file_count: number;
    modifies_tests: number;
    resolves_issue_number: number | null;
    swe_bench_eligible: number;
  }>;
  constructs: ConstructRow[];
  stats: {
    prCount: number;
    testTouchRate: number | null;
    issueLinkRate: number | null;
    sweBenchRate: number | null;
    meanChangedFiles: number | null;
    p90ChangedFiles: number | null;
  };
}

interface TopPrPick { pr_number: number; why: string }

interface GemmaResult {
  architectureStyle: string;
  engineeringNarrative: string;
  repoSearchableProfile: string;
  contentHash: string;
  raw: string;
  modelUsed: string;
  providerName: string;
  modelKey: string;
  usage: TokenUsage;
  challengeSuitabilityVerdict: 'suitable' | 'hold' | 'reject' | null;
  challengeSuitabilityReason: string | null;
  topPrPicks: TopPrPick[];
  redFlags: string[];
  seniorityJustification: string | null;
  idealRoleMatch: string | null;
}

async function loadPass3Facts(env: Env, id: number): Promise<Pass3Facts | null> {
  const repo = await env.DB.prepare(
    `SELECT id, full_name, primary_language, stars, sloc, file_count, mean_ccn,
            has_ci, has_tests, test_framework, detected_domain, detected_stack_json,
            seniority_band, pr_quality_score, open_pr_count, open_feature_issue_count,
            readme_excerpt, root_tree_json, admin_status, pass
     FROM qualified_repos WHERE id = ?`,
  ).bind(id).first<Pass3Facts['repo']>();
  if (!repo) return null;

  const { results: prs } = await env.DB.prepare(
    `SELECT pr_number, title, changed_file_count, modifies_tests,
            resolves_issue_number, swe_bench_eligible
     FROM repo_sample_prs WHERE repo_id = ? ORDER BY pr_number`,
  ).bind(id).all<Pass3Facts['prs'][number]>();

  const { results: constructs } = await env.DB.prepare(
    `SELECT construct_slug, evidence_count FROM repo_constructs
     WHERE repo_id = ? ORDER BY evidence_count DESC LIMIT 10`,
  ).bind(id).all<ConstructRow>();

  const prCount = prs.length;
  const testTouchRate = prCount > 0 ? prs.filter((p) => p.modifies_tests === 1).length / prCount : null;
  const issueLinkRate = prCount > 0 ? prs.filter((p) => p.resolves_issue_number !== null).length / prCount : null;
  const sweBenchRate  = prCount > 0 ? prs.filter((p) => p.swe_bench_eligible === 1).length / prCount : null;
  const changedCounts = prs.map((p) => p.changed_file_count);
  const meanChangedFiles = prCount > 0 ? changedCounts.reduce((a, b) => a + b, 0) / prCount : null;
  const p90ChangedFiles = prCount > 0
    ? (() => {
        const sorted = [...changedCounts].sort((a, b) => a - b);
        const idx = Math.floor(sorted.length * 0.9);
        return sorted[Math.min(idx, sorted.length - 1)] ?? null;
      })()
    : null;

  return {
    repo,
    prs,
    constructs,
    stats: { prCount, testTouchRate, issueLinkRate, sweBenchRate, meanChangedFiles, p90ChangedFiles },
  };
}

async function runGemmaAnalysis(env: Env, facts: Pass3Facts): Promise<GemmaResult> {
  const provider = createRoleAgentProvider(env);
  if (!provider) {
    throw new Error(
      'No role-agent LLM provider configured. Set ROLE_AGENT_PROVIDER to cloudflare-ai (AI binding) or vertex-ai (VERTEX_SA_KEY_JSON).',
    );
  }

  const { repo, prs, constructs, stats } = facts;
  const fmt = (n: number | null): string => (n === null ? 'unknown' : String(Math.round(n * 100) / 100));
  const constructsList = constructs.map((c) => `${c.construct_slug} (${c.evidence_count})`).join(', ');
  const prSummary = prs.slice(0, 10).map((pr) => ({
    pr_number: pr.pr_number,
    title: pr.title,
    changed_files: pr.changed_file_count,
    modifies_tests: pr.modifies_tests === 1,
    resolves_issue: pr.resolves_issue_number !== null,
    swe_bench_eligible: pr.swe_bench_eligible === 1,
  }));

  const systemPrompt = `You are an engineering analyst. Given structured metadata about an open-source repository, produce a JSON object describing the repo's engineering culture, discoverability profile, and fitness as a code-review assessment source.

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
  "ideal_role_match": string
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
- "engineering_narrative": 200–400 words. MUST mention the primary language (${repo.primary_language}). Cover: test discipline, review culture, architecture style, complexity profile, notable PR-sample patterns.
- "repo_searchable_profile": 100–400 words (density over length — the labeled structure carries signal; do NOT pad). This string is embedded for semantic retrieval. Produce EXACTLY this shape (keep the labels verbatim):

  Language: <primary_language>. Domain: <detected_domain or "unknown">. Architecture: <architecture_style>. Seniority signal: <seniority_band or "unknown">. Test culture: <one short clause, e.g. "pytest, 80% touch rate" or "no tests">. Key technologies: <comma-separated deps/libs from detected_stack, 3–8 items>. Challenge surfaces: <comma-separated top 3 surface names>.

  Summary: <2–4 sentence engineering narrative. What the repo does, how it's built, and what makes it distinctive. Role-agnostic.>

  PR shape: <1–2 sentences verbalising test_touch_rate, issue_link_rate, mean_changed_files, swe_bench_eligibility_rate from facts.>

  Key concepts: <8–15 comma-separated noun phrases capturing the engineering patterns a reviewer would encounter — e.g. "dependency injection, async endpoints, OpenAPI generation, typed pydantic models, token auth, rate limiting, error middleware".>

  Do not include any other sections, headings, or markdown. Labels must match exactly.
- "challenge_suitability_reason": one sentence, ≤ 200 characters.
- "top_pr_picks": 1–5 entries, each with pr_number matching one from the Sample PRs block and a 'why' reason ≤ 200 chars. Rank by review-teaching value.
- "red_flags": 0–6 short strings, each ≤ 200 chars. Concrete observations the mechanical checks may have missed (e.g. "README claims TypeScript but repo is all JS", "tests are stubs", "all PRs are dependency bumps"). Empty array if none.
- "seniority_justification": 2–4 sentences explaining why the mechanical seniority_band (${repo.seniority_band ?? 'unknown'}) fits or misses.
- "ideal_role_match": short phrase ≤ 60 chars (e.g. "senior backend engineer", "mid frontend engineer").
- You MAY NOT invent numbers. Every numeric digit you write must correspond to a value from the FACTS block.
- Be role-agnostic in the narrative. The ideal_role_match field is the only place to name a target role.`;

  let rootTree: string[] = [];
  if (repo.root_tree_json) {
    try {
      const parsed: unknown = JSON.parse(repo.root_tree_json);
      if (Array.isArray(parsed)) {
        rootTree = parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      // ignore malformed tree json
    }
  }
  const readmeBlock = repo.readme_excerpt
    ? `\n\nREADME EXCERPT (verbatim, up to ~3KB — use this as the primary source for what the repo IS and DOES):\n\`\`\`\n${repo.readme_excerpt}\n\`\`\``
    : '\n\nREADME EXCERPT: (none — repo ships without a README or it was empty)';
  const treeBlock = rootTree.length > 0
    ? `\n\nROOT TREE (top-level entries, with one level of children for dirs):\n${rootTree.map((e) => `  ${e}`).join('\n')}`
    : '';

  const userPrompt = `FACTS (do not modify, reason from these only):
- repo: ${repo.full_name}
- primary_language: ${repo.primary_language}
- detected_domain: ${repo.detected_domain ?? 'unknown'}
- detected_stack: ${repo.detected_stack_json ?? 'unknown'}
- stars: ${repo.stars}
- sloc: ${fmt(repo.sloc)}
- file_count: ${fmt(repo.file_count)}
- mean_ccn: ${fmt(repo.mean_ccn)}
- has_ci: ${repo.has_ci === 1 ? 'yes' : 'no'}
- has_tests: ${repo.has_tests === 1 ? 'yes' : 'no'}
- test_framework: ${repo.test_framework ?? 'unknown'}
- seniority_band: ${repo.seniority_band ?? 'unknown'}
- pr_quality_score: ${repo.pr_quality_score.toFixed(2)}
- test_touch_rate: ${fmt(stats.testTouchRate)}
- mean_changed_files: ${fmt(stats.meanChangedFiles)}
- p90_changed_files: ${fmt(stats.p90ChangedFiles)}
- issue_link_rate: ${fmt(stats.issueLinkRate)}
- swe_bench_eligibility_rate: ${fmt(stats.sweBenchRate)}
- open_pr_count: ${fmt(repo.open_pr_count)}
- open_feature_issue_count: ${fmt(repo.open_feature_issue_count)}

Top constructs: ${constructsList || 'none detected'}${readmeBlock}${treeBlock}

Sample PRs (${prs.length} total, first 10):
${JSON.stringify(prSummary, null, 2)}

Produce all nine fields. Remember: use only numbers from FACTS. top_pr_picks pr_numbers MUST match the Sample PRs list. Use the README to ground what the repo actually does — do not hallucinate a purpose from the language/stack alone.`;

  const completion = await provider.complete(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { maxTokens: 8192, forceJson: true },
  );
  const raw = completion.content ?? '';
  if (!raw) throw new Error('Gemma returned empty response');

  const VALID_ARCH = new Set(['monolith', 'layered_service', 'microservice', 'library', 'unknown']);
  const VALID_SUITABILITY = new Set(['suitable', 'hold', 'reject']);
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: {
    architecture_style?: string;
    engineering_narrative?: string;
    repo_searchable_profile?: string;
    challenge_suitability_verdict?: string;
    challenge_suitability_reason?: string;
    top_pr_picks?: unknown;
    red_flags?: unknown;
    seniority_justification?: string;
    ideal_role_match?: string;
  };
  try {
    parsed = JSON.parse(stripped) as typeof parsed;
  } catch {
    throw new Error(`Failed to parse Gemma JSON: ${raw.slice(0, 200)}`);
  }

  const architectureStyle = VALID_ARCH.has(parsed.architecture_style ?? '') ? parsed.architecture_style! : 'unknown';
  const engineeringNarrative = parsed.engineering_narrative ?? '';
  const repoSearchableProfile = parsed.repo_searchable_profile ?? '';
  if (!engineeringNarrative || !repoSearchableProfile) {
    throw new Error('Gemma response missing required fields');
  }

  const challengeSuitabilityVerdict = VALID_SUITABILITY.has(parsed.challenge_suitability_verdict ?? '')
    ? (parsed.challenge_suitability_verdict as 'suitable' | 'hold' | 'reject')
    : null;
  const challengeSuitabilityReason = typeof parsed.challenge_suitability_reason === 'string'
    ? parsed.challenge_suitability_reason : null;
  const topPrPicks: TopPrPick[] = Array.isArray(parsed.top_pr_picks)
    ? parsed.top_pr_picks.flatMap((entry): TopPrPick[] => {
        if (!entry || typeof entry !== 'object') return [];
        const pn = (entry as { pr_number?: unknown }).pr_number;
        const w = (entry as { why?: unknown }).why;
        return typeof pn === 'number' && typeof w === 'string'
          ? [{ pr_number: pn, why: w }]
          : [];
      })
    : [];
  const redFlags: string[] = Array.isArray(parsed.red_flags)
    ? (parsed.red_flags as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const seniorityJustification = typeof parsed.seniority_justification === 'string'
    ? parsed.seniority_justification : null;
  const idealRoleMatch = typeof parsed.ideal_role_match === 'string'
    ? parsed.ideal_role_match : null;

  const hashInput = `${repo.full_name}|${repo.sloc}|${stats.prCount}|${repo.pr_quality_score}|v2.0.0`;
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput));
  const contentHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const modelUsed = provider.name;
  const providerName = provider.name;
  const modelKey = provider instanceof VertexAIProvider ? provider.getModelKey() : provider.name;
  const usage: TokenUsage = (provider instanceof VertexAIProvider ? provider.getLastUsage() : null) ?? {};

  return {
    architectureStyle,
    engineeringNarrative,
    repoSearchableProfile,
    contentHash,
    raw,
    modelUsed,
    providerName,
    modelKey,
    usage,
    challengeSuitabilityVerdict,
    challengeSuitabilityReason,
    topPrPicks,
    redFlags,
    seniorityJustification,
    idealRoleMatch,
  };
}

async function persistSignals(env: Env, id: number, facts: Pass3Facts, gemma: GemmaResult): Promise<void> {
  // INSERT OR REPLACE wipes any prior verdict/vectorized_at; a re-analysis
  // explicitly invalidates prior feedback (the narrative just changed).
  await env.DB.prepare(
    `INSERT OR REPLACE INTO repo_engineering_signals (
       repo_id, signals_version, content_hash,
       test_touch_rate, mean_changed_files, p90_changed_files, issue_link_rate,
       complexity_band, swe_bench_eligibility_rate, architecture_style,
       review_density, commit_cadence, satd_density,
       test_style, challenge_surfaces,
       repo_searchable_profile, engineering_narrative, signal_json,
       model_used, model_version,
       admin_verdict, admin_feedback_text, verdict_at, vectorized_at,
       challenge_suitability_verdict, challenge_suitability_reason,
       top_pr_picks_json, red_flags_json,
       seniority_justification, ideal_role_match
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    'v2.0.0',
    gemma.contentHash,
    facts.stats.testTouchRate,
    facts.stats.meanChangedFiles,
    facts.stats.p90ChangedFiles,
    facts.stats.issueLinkRate,
    null,
    facts.stats.sweBenchRate,
    gemma.architectureStyle,
    null,
    null,
    null,
    null,
    null,
    gemma.repoSearchableProfile,
    gemma.engineeringNarrative,
    gemma.raw.slice(0, 8000),
    gemma.modelUsed,
    'v1',
    gemma.challengeSuitabilityVerdict,
    gemma.challengeSuitabilityReason,
    JSON.stringify(gemma.topPrPicks),
    JSON.stringify(gemma.redFlags),
    gemma.seniorityJustification,
    gemma.idealRoleMatch,
  ).run();
}

async function vectorizeAndMark(env: Env, id: number, profile: string): Promise<{ vectorized: boolean; vectorizedAt: string | null }> {
  const vectorizedAt = new Date().toISOString();

  let vector: number[];
  try {
    const embedResult = (await env.AI.run('@cf/baai/bge-large-en-v1.5', {
      text: [preprocessForEmbedding(profile, 'document')],
    })) as { data?: number[][] };
    const v = embedResult?.data?.[0];
    if (!v || !Array.isArray(v)) {
      console.error(`[adminRepos] embed returned no vector for repo ${id}; shape=`, JSON.stringify(embedResult).slice(0, 300));
      return { vectorized: false, vectorizedAt: null };
    }
    vector = v;
  } catch (err) {
    console.error(`[adminRepos] embed failed for repo ${id}:`, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    return { vectorized: false, vectorizedAt: null };
  }

  if (vector.length !== 1024) {
    console.error(`[adminRepos] embed returned wrong dim for repo ${id}: got ${vector.length}, expected 1024`);
    return { vectorized: false, vectorizedAt: null };
  }
  if (vector.some((n) => !Number.isFinite(n))) {
    console.error(`[adminRepos] embed returned non-finite values for repo ${id}`);
    return { vectorized: false, vectorizedAt: null };
  }

  // Vectorize is now read-only; skip upsert.
  // The embedding is still persisted to D1 via the caller.

  await env.DB.prepare(
    `UPDATE repo_engineering_signals SET vectorized_at = ?, embedding_json = ?, embedding_model_version = ? WHERE repo_id = ?`,
  ).bind(vectorizedAt, JSON.stringify(vector), EMBEDDING_MODEL_VERSION, id).run();
  return { vectorized: true, vectorizedAt };
}

// ─── POST /api/v1/admin/repos/:id/pass3/analyze ──────────────────────────────
// Runs Gemma and persists to D1. Does NOT vectorize. Does NOT require an
// admin_status gate — the whole point is to read the narrative before deciding.

adminRepos.post('/repos/:id/pass3/analyze', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return apiError(c, 'VALIDATION_ERROR', 'invalid id');

  const facts = await loadPass3Facts(c.env, id);
  if (!facts) return apiError(c, 'NOT_FOUND', 'repo not found');
  if (facts.repo.pass < 2) return apiError(c, 'VALIDATION_ERROR', 'repo has not completed pass 2');

  let gemma: GemmaResult;
  try {
    gemma = await runGemmaAnalysis(c.env, facts);
  } catch (err) {
    return apiError(c, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
  }

  recordAiUsage(c.env.DB, c.executionCtx, {
    feature: 'repo_crawl',
    refId: String(id),
    subRefId: gemma.contentHash,
    provider: gemma.providerName,
    model: gemma.modelKey,
    usage: gemma.usage,
  });

  await persistSignals(c.env, id, facts, gemma);

  return c.json({
    ok: true,
    id,
    content_hash: gemma.contentHash,
    architecture_style: gemma.architectureStyle,
    engineering_narrative: gemma.engineeringNarrative,
    repo_searchable_profile: gemma.repoSearchableProfile,
    narrative_len: gemma.engineeringNarrative.length,
    profile_len: gemma.repoSearchableProfile.length,
    challenge_suitability_verdict: gemma.challengeSuitabilityVerdict,
    challenge_suitability_reason: gemma.challengeSuitabilityReason,
    top_pr_picks: gemma.topPrPicks,
    red_flags: gemma.redFlags,
    seniority_justification: gemma.seniorityJustification,
    ideal_role_match: gemma.idealRoleMatch,
  });
});

// ─── POST /api/v1/admin/repos/:id/pass3/feedback ─────────────────────────────
// Writes admin_verdict + optional free-text critique to repo_engineering_signals.

const feedbackSchema = z.object({
  verdict: z.enum(['approved', 'denied']),
  feedback_text: z.string().max(4000).optional(),
});

adminRepos.post('/repos/:id/pass3/feedback', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return apiError(c, 'VALIDATION_ERROR', 'invalid id');

  let body: unknown;
  try { body = await c.req.json(); } catch { return apiError(c, 'VALIDATION_ERROR', 'invalid JSON body'); }
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'invalid body');

  const verdictAt = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE repo_engineering_signals
       SET admin_verdict = ?, admin_feedback_text = ?, verdict_at = ?
     WHERE repo_id = ?`,
  ).bind(parsed.data.verdict, parsed.data.feedback_text ?? null, verdictAt, id).run();

  if (result.meta.changes === 0) {
    return apiError(c, 'NOT_FOUND', 'no analysis row — run /pass3/analyze first');
  }

  return c.json({ ok: true, id, verdict: parsed.data.verdict, verdict_at: verdictAt });
});

// ─── POST /api/v1/admin/repos/:id/pass3/ingest ───────────────────────────────
// Embeds the already-persisted repo_searchable_profile and upserts it into
// REPO_INDEX. Requires admin_verdict = 'approved'.

adminRepos.post('/repos/:id/pass3/ingest', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return apiError(c, 'VALIDATION_ERROR', 'invalid id');

  const signals = await c.env.DB.prepare(
    `SELECT admin_verdict, repo_searchable_profile
     FROM repo_engineering_signals WHERE repo_id = ?`,
  ).bind(id).first<{ admin_verdict: string | null; repo_searchable_profile: string | null }>();

  if (!signals) return apiError(c, 'NOT_FOUND', 'no analysis row — run /pass3/analyze first');
  if (signals.admin_verdict !== 'approved') {
    return apiError(c, 'VALIDATION_ERROR', 'admin_verdict must be "approved" before ingest');
  }
  if (!signals.repo_searchable_profile) {
    return apiError(c, 'VALIDATION_ERROR', 'repo_searchable_profile is empty');
  }

  const { vectorized, vectorizedAt } = await vectorizeAndMark(c.env, id, signals.repo_searchable_profile);
  if (!vectorized) {
    return apiError(c, 'INTERNAL_ERROR', 'vectorize failed — check logs. Note: REPO_INDEX requires --remote runtime.');
  }

  return c.json({ ok: true, id, vectorized_at: vectorizedAt });
});

// ─── GET /api/v1/admin/repos/bulk-ingest/preview ─────────────────────────────
//
// Returns per-verdict counts of repos eligible for bulk ingest
// (vectorized_at IS NULL, repo_searchable_profile non-empty).
// Registered before /repos/:id routes so Hono does not match 'bulk-ingest' as :id.

interface BulkIngestPreviewResponse {
  suitable: number;
  hold: number;
  reject: number;
  total_unvectorized: number;
}

adminRepos.get('/repos/bulk-ingest/preview', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT challenge_suitability_verdict AS verdict, COUNT(*) AS cnt
     FROM repo_engineering_signals
     WHERE vectorized_at IS NULL
       AND repo_searchable_profile IS NOT NULL
       AND repo_searchable_profile != ''
     GROUP BY challenge_suitability_verdict`,
  ).all<{ verdict: string; cnt: number }>();

  const counts: Record<string, number> = {};
  for (const row of results) {
    counts[row.verdict] = row.cnt;
  }

  const suitable = counts['suitable'] ?? 0;
  const hold = counts['hold'] ?? 0;
  const reject = counts['reject'] ?? 0;

  return c.json<BulkIngestPreviewResponse>({
    suitable,
    hold,
    reject,
    total_unvectorized: suitable + hold + reject,
  });
});

// ─── POST /api/v1/admin/repos/bulk-ingest ────────────────────────────────────
//
// One-shot batch endpoint: approve + vectorize all Pass-3-analyzed repos where
// Gemma flagged challenge_suitability_verdict IN ('suitable','hold') and
// vectorized_at IS NULL.
//
// Human-gated-vectorization override notice (ADR-033, 2026-04-17):
//   The per-repo ingest gate exists to ensure a human reviews each Gemma verdict
//   before it enters REPO_INDEX. This endpoint is an explicit one-shot override
//   approved by the founder on 2026-04-18. It applies only to repos that already
//   carry a Gemma verdict; no Gemma re-analysis is performed. The 200-repo hard
//   cap and the `suitable|hold`-only default preserve human accountability for the
//   reject category.

interface BulkIngestTarget {
  repo_id: number;
  full_name: string;
  challenge_suitability_verdict: string;
  repo_searchable_profile: string;
}

interface BulkIngestReportRow {
  repo_id: number;
  full_name: string;
  verdict: string;
  status: 'ok' | 'failed';
  message: string;
  vectorized_at: string | null;
}

const bulkIngestSchema = z.object({
  verdicts: z.array(z.enum(['suitable', 'hold', 'reject'])).min(1).default(['suitable', 'hold']),
  limit: z.number().int().positive().max(500).optional(),
  feedback_text: z.string().max(200).default('bulk ingest 2026-04-18'),
});

adminRepos.post('/repos/bulk-ingest', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'invalid JSON body');
  }

  const parsed = bulkIngestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'invalid body');
  }

  const { verdicts, limit, feedback_text } = parsed.data;

  // Build parameterized IN clause for the verdict filter
  const placeholders = verdicts.map(() => '?').join(', ');
  const { results: allTargets } = await c.env.DB.prepare(
    `SELECT res.repo_id, qr.full_name, res.challenge_suitability_verdict, res.repo_searchable_profile
     FROM repo_engineering_signals res
     JOIN qualified_repos qr ON qr.id = res.repo_id
     WHERE res.challenge_suitability_verdict IN (${placeholders})
       AND res.vectorized_at IS NULL
       AND res.repo_searchable_profile IS NOT NULL
       AND res.repo_searchable_profile != ''
     ORDER BY res.repo_id`,
  ).bind(...verdicts).all<BulkIngestTarget>();

  const HARD_CAP = 200;
  if (allTargets.length > HARD_CAP) {
    console.warn(
      `[adminRepos/bulk-ingest] found ${allTargets.length} targets, capping at ${HARD_CAP}. Run again to ingest the remainder.`,
    );
  }

  const requestedLimit = limit !== undefined ? Math.min(limit, HARD_CAP) : HARD_CAP;
  const targets = allTargets.slice(0, requestedLimit);
  const total = targets.length;

  const results: BulkIngestReportRow[] = [];
  let okCount = 0;
  let failedCount = 0;
  const verdictAt = new Date().toISOString();

  for (const target of targets) {
    if (!target.repo_searchable_profile) {
      // Guard against the empty_profile case even though the SQL filters it
      results.push({
        repo_id: target.repo_id,
        full_name: target.full_name,
        verdict: target.challenge_suitability_verdict,
        status: 'failed',
        message: 'empty_profile',
        vectorized_at: null,
      });
      failedCount++;
      continue;
    }

    try {
      // Step 1: approve the verdict in repo_engineering_signals
      await c.env.DB.prepare(
        `UPDATE repo_engineering_signals
           SET admin_verdict = 'approved', verdict_at = ?, admin_feedback_text = ?
         WHERE repo_id = ?`,
      ).bind(verdictAt, feedback_text, target.repo_id).run();

      // Step 2: embed + upsert to REPO_INDEX
      const { vectorized, vectorizedAt } = await vectorizeAndMark(
        c.env,
        target.repo_id,
        target.repo_searchable_profile,
      );

      if (!vectorized) {
        results.push({
          repo_id: target.repo_id,
          full_name: target.full_name,
          verdict: target.challenge_suitability_verdict,
          status: 'failed',
          message: 'vectorize_failed',
          vectorized_at: null,
        });
        failedCount++;
      } else {
        results.push({
          repo_id: target.repo_id,
          full_name: target.full_name,
          verdict: target.challenge_suitability_verdict,
          status: 'ok',
          message: 'ingested',
          vectorized_at: vectorizedAt,
        });
        okCount++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[adminRepos/bulk-ingest] repo ${target.repo_id} failed:`, message);
      results.push({
        repo_id: target.repo_id,
        full_name: target.full_name,
        verdict: target.challenge_suitability_verdict,
        status: 'failed',
        message,
        vectorized_at: null,
      });
      failedCount++;
    }
  }

  return c.json({
    ok: true,
    total,
    ok_count: okCount,
    failed_count: failedCount,
    results,
  });
});

// ─── POST /api/v1/admin/repos/:id/pass3 ──────────────────────────────────────
// Back-compat one-shot: analyze → auto-approve verdict → ingest.
// Gated on the legacy admin_status = 'approved' check so the existing approval
// queue button keeps working.

adminRepos.post('/repos/:id/pass3', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return apiError(c, 'VALIDATION_ERROR', 'invalid id');

  const facts = await loadPass3Facts(c.env, id);
  if (!facts) return apiError(c, 'NOT_FOUND', 'repo not found');
  if (facts.repo.admin_status !== 'approved') {
    return apiError(c, 'VALIDATION_ERROR', 'repo must be approved before running pass 3');
  }
  if (facts.repo.pass < 2) return apiError(c, 'VALIDATION_ERROR', 'repo has not completed pass 2');

  let gemma: GemmaResult;
  try {
    gemma = await runGemmaAnalysis(c.env, facts);
  } catch (err) {
    return apiError(c, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
  }

  recordAiUsage(c.env.DB, c.executionCtx, {
    feature: 'repo_crawl',
    refId: String(id),
    subRefId: gemma.contentHash,
    provider: gemma.providerName,
    model: gemma.modelKey,
    usage: gemma.usage,
  });

  await persistSignals(c.env, id, facts, gemma);

  // Auto-set verdict so the back-compat flow still lands rows in a consistent state.
  const verdictAt = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE repo_engineering_signals
       SET admin_verdict = 'approved', verdict_at = ? WHERE repo_id = ?`,
  ).bind(verdictAt, id).run();

  await vectorizeAndMark(c.env, id, gemma.repoSearchableProfile);

  return c.json({
    ok: true,
    id,
    content_hash: gemma.contentHash,
    narrative_len: gemma.engineeringNarrative.length,
    profile_len: gemma.repoSearchableProfile.length,
    architecture_style: gemma.architectureStyle,
  });
});

// ─── POST /api/v1/admin/repos/search ─────────────────────────────────────────
// Semantic search over approved repos using Vectorize + Workers AI.
// Body: { query: string }
// Returns repos ranked by cosine similarity to the embedded query.

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
});

adminRepos.post('/repos/search', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'invalid JSON body');
  }

  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'invalid body');
  }

  const { query } = parsed.data;

  // Embed the query text + query Vectorize.
  // Both bindings require the remote runtime — they throw when run via `wrangler dev` (local mode).
  // Run with `wrangler dev --remote` to use this endpoint during development.
  let embedResult: { data?: number[][] };
  let queryResult: Awaited<ReturnType<typeof c.env.REPO_INDEX.query>>;
  try {
    embedResult = (await c.env.AI.run('@cf/baai/bge-large-en-v1.5', {
      text: [preprocessForEmbedding(query, 'query')],
    })) as { data?: number[][] };
    const vector = embedResult?.data?.[0];
    if (!vector || !Array.isArray(vector)) {
      return apiError(c, 'INTERNAL_ERROR', 'embedding failed');
    }
    // No metadata filter: /pass3/ingest already gates on admin_verdict='approved',
    // so every vector in REPO_INDEX is already approved. Filtering here would require
    // a Vectorize metadata index and is redundant.
    queryResult = await c.env.REPO_INDEX.query(vector, { topK: 30 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('needs to be run remotely')) {
      return apiError(c, 'INTERNAL_ERROR', 'Vectorize requires the remote runtime — restart wrangler with --remote flag');
    }
    throw err;
  }

  if (!queryResult?.matches || queryResult.matches.length === 0) {
    return c.json({ results: [], query });
  }

  // Parse vector IDs back to repo IDs
  type VectorMatch = { id: string; score: number };
  const matches: { id: number; score: number }[] = (queryResult.matches as VectorMatch[])
    .flatMap((m) => {
      const hit = m.id.match(/^repo_(\d+)$/);
      return hit?.[1] ? [{ id: Number(hit[1]), score: m.score }] : [];
    });

  if (matches.length === 0) return c.json({ results: [], query });

  // Hydrate metadata from D1
  const placeholders = matches.map(() => '?').join(', ');
  const { results } = await c.env.DB.prepare(
    `SELECT id, full_name, github_url, primary_language, stars,
            detected_domain, seniority_band, sloc, pr_quality_score,
            res.engineering_narrative, res.architecture_style
     FROM qualified_repos qr
     LEFT JOIN repo_engineering_signals res ON res.repo_id = qr.id
     WHERE qr.id IN (${placeholders})
       AND qr.disqualified = 0
       AND res.admin_verdict = 'approved'`,
  ).bind(...matches.map((m) => m.id)).all<{
    id: number;
    full_name: string;
    github_url: string;
    primary_language: string;
    stars: number;
    detected_domain: string | null;
    seniority_band: string | null;
    sloc: number | null;
    pr_quality_score: number;
    engineering_narrative: string | null;
    architecture_style: string | null;
  }>();

  // Attach scores + sort by similarity descending
  const scoreMap = new Map(matches.map((m) => [m.id, m.score]));
  const ranked = (results ?? [])
    .map((r) => ({ ...r, score: scoreMap.get(r.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);

  return c.json({ results: ranked, query });
});

export { adminRepos };
