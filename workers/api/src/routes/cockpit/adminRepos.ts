/**
 * Admin repo management — human-in-the-loop approval for qualified_repos.
 *
 * Mounts under /api/v1/admin.
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Routes:
 *   GET   /api/v1/admin/repos          — list repos with optional status filter + pagination
 *   PATCH /api/v1/admin/repos/:id      — set admin_status ('pending' | 'approved' | 'denied')
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import type { Env, Variables } from '../../types';

const adminRepos = new Hono<{ Bindings: Env; Variables: Variables }>();

adminRepos.use('*', authMiddleware);

// ─── GET /api/v1/admin/repos ─────────────────────────────────────────────────
// Query params:
//   status  — 'pending' | 'approved' | 'denied' | 'all' (default: 'all')
//   page    — 1-based page number (default: 1)
//   limit   — rows per page, max 100 (default: 50)

adminRepos.get('/repos', async (c) => {
  const statusParam = c.req.query('status') ?? 'all';
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '50')));
  const offset = (page - 1) * limit;

  const validStatuses = ['pending', 'approved', 'denied'] as const;
  const filterByStatus = (validStatuses as readonly string[]).includes(statusParam);

  const where = filterByStatus ? 'WHERE admin_status = ?' : '';
  const baseParams: (string | number)[] = filterByStatus ? [statusParam] : [];

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM qualified_repos ${where}`,
  )
    .bind(...baseParams)
    .first<{ total: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT
       id, full_name, github_url, primary_language, stars,
       detected_domain, seniority_band, sloc, file_count,
       pr_quality_score, open_feature_issue_count, open_pr_count,
       admin_status, disqualified, disqualified_reason, crawled_at
     FROM qualified_repos
     ${where}
     ORDER BY stars DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...baseParams, limit, offset)
    .all<{
      id: number;
      full_name: string;
      github_url: string;
      primary_language: string;
      stars: number;
      detected_domain: string | null;
      seniority_band: string | null;
      sloc: number | null;
      file_count: number | null;
      pr_quality_score: number;
      open_feature_issue_count: number | null;
      open_pr_count: number | null;
      admin_status: string;
      disqualified: number;
      disqualified_reason: string | null;
      crawled_at: string;
    }>();

  return c.json({
    repos: results,
    total: countRow?.total ?? 0,
    page,
    limit,
  });
});

// ─── PATCH /api/v1/admin/repos/:id ───────────────────────────────────────────

const patchSchema = z.object({
  admin_status: z.enum(['pending', 'approved', 'denied']),
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

  const result = await c.env.DB.prepare(
    `UPDATE qualified_repos SET admin_status = ? WHERE id = ?`,
  )
    .bind(parsed.data.admin_status, id)
    .run();

  if (result.meta.changes === 0) return apiError(c, 'NOT_FOUND', 'repo not found');

  return c.json({ ok: true, id, admin_status: parsed.data.admin_status });
});

export { adminRepos };
