/**
 * Admin repo management — human-in-the-loop approval for qualified_repos.
 *
 * Mounts under /api/v1/admin.
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Routes:
 *   GET   /api/v1/admin/repos             — list repos (status + pass filters, pagination)
 *   GET   /api/v1/admin/repos/:id/prs     — sample PRs for a specific repo
 *   PATCH /api/v1/admin/repos/:id         — set admin_status + optional admin_reason
 *   POST  /api/v1/admin/repos/:id/requeue — demote repo to pass=1 for re-crawling
 *   POST  /api/v1/admin/repos/:id/pass3   — trigger Gemma summarization + vectorization
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
 *   omit → all passes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { GoogleAIProvider } from '../../lib/llm/googleAIProvider';
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

// ─── GET /api/v1/admin/repos ─────────────────────────────────────────────────

adminRepos.get('/repos', async (c) => {
  const statusParam = c.req.query('status') ?? 'pending';
  const passParam   = c.req.query('pass');   // '1' | '2' | undefined
  const page  = Math.max(1, Number(c.req.query('page')  ?? '1'));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '50')));
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

  if (passParam === '1') {
    conditions.push('qr.pass = 1');
  } else if (passParam === '2') {
    conditions.push('qr.pass = 2');
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
       CASE WHEN res.repo_id IS NOT NULL THEN 1 ELSE 0 END AS has_signals
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

// ─── POST /api/v1/admin/repos/:id/pass3 ──────────────────────────────────────
// Triggers Workers AI Gemma summarization + Vectorize upsert for an approved repo.
// Only runs if admin_status = 'approved' and pass >= 2.

interface ConstructRow { construct_slug: string; evidence_count: number }

adminRepos.post('/repos/:id/pass3', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return apiError(c, 'VALIDATION_ERROR', 'invalid id');

  // 1. Fetch the repo — must be approved pass-2 repo
  const repo = await c.env.DB.prepare(
    `SELECT id, full_name, primary_language, stars, sloc, file_count, mean_ccn,
            has_ci, has_tests, test_framework, detected_domain, detected_stack_json,
            seniority_band, pr_quality_score, open_pr_count, open_feature_issue_count,
            business_logic_ratio, cross_module_change_rate, admin_status, pass
     FROM qualified_repos WHERE id = ?`,
  )
    .bind(id)
    .first<RepoRow & {
      mean_ccn: number | null;
      has_ci: number;
      has_tests: number;
      test_framework: string | null;
      detected_stack_json: string | null;
      business_logic_ratio: number | null;
      cross_module_change_rate: number | null;
    }>();

  if (!repo) return apiError(c, 'NOT_FOUND', 'repo not found');
  if (repo.admin_status !== 'approved') return apiError(c, 'VALIDATION_ERROR', 'repo must be approved before running pass 3');
  if (repo.pass < 2) return apiError(c, 'VALIDATION_ERROR', 'repo has not completed pass 2');

  // 2. Fetch PRs + constructs
  const { results: prs } = await c.env.DB.prepare(
    `SELECT pr_number, title, changed_file_count, modifies_tests, resolves_issue_number,
            additions, deletions, swe_bench_eligible
     FROM repo_sample_prs WHERE repo_id = ? ORDER BY pr_number`,
  ).bind(id).all<{
    pr_number: number;
    title: string | null;
    changed_file_count: number;
    modifies_tests: number;
    resolves_issue_number: number | null;
    additions: number | null;
    deletions: number | null;
    swe_bench_eligible: number;
  }>();

  const { results: constructs } = await c.env.DB.prepare(
    `SELECT construct_slug, evidence_count FROM repo_constructs WHERE repo_id = ? ORDER BY evidence_count DESC LIMIT 10`,
  ).bind(id).all<ConstructRow>();

  // 3. Compute deterministic stats from PRs
  const prCount = prs.length;
  const testTouchRate = prCount > 0
    ? prs.filter((p) => p.modifies_tests === 1).length / prCount
    : null;
  const issueLinkRate = prCount > 0
    ? prs.filter((p) => p.resolves_issue_number !== null).length / prCount
    : null;
  const sweBenchRate = prCount > 0
    ? prs.filter((p) => p.swe_bench_eligible === 1).length / prCount
    : null;
  const changedFileCounts = prs.map((p) => p.changed_file_count);
  const meanChangedFiles = prCount > 0
    ? changedFileCounts.reduce((a, b) => a + b, 0) / prCount
    : null;
  const p90ChangedFiles = prCount > 0
    ? (() => {
        const sorted = [...changedFileCounts].sort((a, b) => a - b);
        const idx = Math.floor(sorted.length * 0.9);
        return sorted[Math.min(idx, sorted.length - 1)] ?? null;
      })()
    : null;

  function fmt(n: number | null): string {
    return n === null ? 'unknown' : String(Math.round(n * 100) / 100);
  }

  const constructsList = constructs.map((c) => `${c.construct_slug} (${c.evidence_count})`).join(', ');
  const prSummary = prs.slice(0, 10).map((pr) => ({
    pr_number: pr.pr_number,
    title: pr.title,
    changed_files: pr.changed_file_count,
    modifies_tests: pr.modifies_tests === 1,
    resolves_issue: pr.resolves_issue_number !== null,
    swe_bench_eligible: pr.swe_bench_eligible === 1,
  }));

  // 4. Build prompt
  const systemPrompt = `You are an engineering analyst. Given structured metadata about an open-source repository, produce a JSON object describing the repo's engineering culture and discoverability profile.

Output MUST be valid JSON matching this schema EXACTLY:

{
  "architecture_style": "monolith" | "layered_service" | "microservice" | "library" | "unknown",
  "engineering_narrative": string,
  "repo_searchable_profile": string
}

architecture_style definitions:
- "library": the repo's purpose is to be imported by other projects. No deployable runtime entrypoint.
- "layered_service": single-deploy application with clear controller/service/repository or equivalent internal layers.
- "monolith": single-deploy application without strong internal layering.
- "microservice": part of a multi-service topology OR function-as-a-service.
- "unknown": cannot determine from the provided signals.

Constraints:
- Return ONLY the JSON object. No markdown, no commentary.
- "engineering_narrative": 200–400 words. MUST mention the primary language (${repo.primary_language}). Cover: test discipline, review culture, architecture style, complexity profile, notable PR-sample patterns.
- "repo_searchable_profile": 400–600 words. A natural-language narrative covering (in order): repo type and purpose; primary language and detected stack; PR-shape observations; test/review culture; top three challenge surfaces; contribution readiness.
- You MAY NOT invent numbers. Every numeric digit you write must correspond to a value from the FACTS block.
- Be role-agnostic. Do not assume what kind of developer would work on this repo.`;

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
- test_touch_rate: ${fmt(testTouchRate)}
- mean_changed_files: ${fmt(meanChangedFiles)}
- p90_changed_files: ${fmt(p90ChangedFiles)}
- issue_link_rate: ${fmt(issueLinkRate)}
- swe_bench_eligibility_rate: ${fmt(sweBenchRate)}
- open_pr_count: ${fmt(repo.open_pr_count)}
- open_feature_issue_count: ${fmt(repo.open_feature_issue_count)}

Top constructs: ${constructsList || 'none detected'}

Sample PRs (${prs.length} total, first 10):
${JSON.stringify(prSummary, null, 2)}

Choose an architecture_style from the enum, write the engineering_narrative, and write the repo_searchable_profile. Remember: use only numbers from FACTS.`;

  // 5. Call Gemma via Google AI API (generativelanguage.googleapis.com)
  if (!c.env.GOOGLE_AI_API_KEY) {
    return apiError(c, 'INTERNAL_ERROR', 'GOOGLE_AI_API_KEY not configured');
  }
  const googleProvider = new GoogleAIProvider(c.env.GOOGLE_AI_API_KEY, 'gemma-4-31b-it');
  let raw: string;
  try {
    const completion = await googleProvider.complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { maxTokens: 4096, forceJson: true },
    );
    raw = completion.content ?? '';
    if (!raw) return apiError(c, 'INTERNAL_ERROR', 'Gemma returned empty response');
  } catch (err) {
    return apiError(c, 'INTERNAL_ERROR', `Gemma call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 6. Parse response
  const VALID_ARCH = new Set(['monolith', 'layered_service', 'microservice', 'library', 'unknown']);
  let parsed: { architecture_style?: string; engineering_narrative?: string; repo_searchable_profile?: string };
  try {
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(stripped) as typeof parsed;
  } catch {
    return apiError(c, 'INTERNAL_ERROR', `Failed to parse Gemma JSON: ${raw.slice(0, 200)}`);
  }

  const architectureStyle = VALID_ARCH.has(parsed.architecture_style ?? '')
    ? parsed.architecture_style
    : 'unknown';
  const engineeringNarrative = parsed.engineering_narrative ?? '';
  const repoSearchableProfile = parsed.repo_searchable_profile ?? '';

  if (!engineeringNarrative || !repoSearchableProfile) {
    return apiError(c, 'INTERNAL_ERROR', 'Gemma response missing required fields');
  }

  // 7. Content hash (SHA-256 of key signals)
  const hashInput = `${repo.full_name}|${repo.sloc}|${prCount}|${repo.pr_quality_score}|v2.0.0`;
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput));
  const contentHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

  // 8. Persist to repo_engineering_signals
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO repo_engineering_signals (
       repo_id, signals_version, content_hash,
       test_touch_rate, mean_changed_files, p90_changed_files, issue_link_rate,
       complexity_band, swe_bench_eligibility_rate, architecture_style,
       review_density, commit_cadence, satd_density,
       test_style, challenge_surfaces,
       repo_searchable_profile, engineering_narrative, signal_json,
       model_used, model_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    'v2.0.0',
    contentHash,
    testTouchRate,
    meanChangedFiles,
    p90ChangedFiles,
    issueLinkRate,
    null, // complexity_band — skipped (needs mean_ccn classifier)
    sweBenchRate,
    architectureStyle,
    null, // review_density
    null, // commit_cadence
    null, // satd_density
    null, // test_style — skipped (needs test style classifier)
    null, // challenge_surfaces — skipped (needs surface classifier)
    repoSearchableProfile,
    engineeringNarrative,
    raw.slice(0, 8000),
    'google-ai/gemma-4-31b-it',
    'v1',
  ).run();

  // 9. Vectorize upsert — embed repo_searchable_profile + upsert to REPO_INDEX
  try {
    const embedResult = (await c.env.AI.run('@cf/baai/bge-large-en-v1.5', {
      text: [repoSearchableProfile],
    })) as { data?: number[][] };
    const vector = embedResult?.data?.[0];
    if (vector && Array.isArray(vector)) {
      await c.env.REPO_INDEX.upsert([{
        id: `repo_${id}`,
        values: vector,
        metadata: { disqualified: 0, admin_status: 'approved' },
      }]);
    }
  } catch (err) {
    // Non-fatal — D1 is authoritative. Log and continue.
    console.error(`[adminRepos] vectorize upsert failed for repo ${id}:`, err instanceof Error ? err.message : String(err));
  }

  return c.json({
    ok: true,
    id,
    content_hash: contentHash,
    narrative_len: engineeringNarrative.length,
    profile_len: repoSearchableProfile.length,
    architecture_style: architectureStyle,
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
      text: [query],
    })) as { data?: number[][] };
    const vector = embedResult?.data?.[0];
    if (!vector || !Array.isArray(vector)) {
      return apiError(c, 'INTERNAL_ERROR', 'embedding failed');
    }
    queryResult = await c.env.REPO_INDEX.query(vector, {
      topK: 30,
      filter: { admin_status: 'approved' },
    });
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
       AND qr.admin_status = 'approved'`,
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
