/**
 * Repo Discovery routes — CR-13, repo-discovery-pipeline.md
 *
 * Mounts under /api/v1/repos.
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Routes:
 *   POST   /discover           — start async discovery for a pipeline
 *   GET    /jobs/:jobId        — poll discovery job status
 *   GET    /                   — list discovered repos (filterable)
 *   GET    /:repoId            — single repo detail
 *   PATCH  /:repoId            — accept or reject a repo
 *   POST   /:repoId/convert   — convert accepted repo to CODE_REVIEW challenge template
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { runDiscovery } from '../../lib/repoDiscovery/discover';
import { convertRepoToChallenge } from '../../lib/repoDiscovery/convertToChallenge';
import type {
  Env,
  Variables,
  CandidatePersona,
  DiscoveredRepoRow,
  DiscoveryJobRow,
} from '../../types';
import { toRepoResponse, toJobResponse } from '../../types';

const repoDiscovery = new Hono<{ Bindings: Env; Variables: Variables }>();
repoDiscovery.use('*', authMiddleware);

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseJsonColumn<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ─── POST /discover ─────────────────────────────────────────────────────────

repoDiscovery.post('/discover', async (c) => {
  const userId = c.var.userId;
  const body = await c.req.json<{ pipelineId?: string }>().catch(() => ({}));

  if (!body.pipelineId) {
    return apiError(c, 'BAD_REQUEST', 'pipelineId is required');
  }

  // Verify pipeline ownership
  const pipeline = await c.env.DB.prepare(
    `SELECT id, owner_id FROM pipelines WHERE id = ?1`,
  ).bind(body.pipelineId).first<{ id: string; owner_id: string }>();

  if (!pipeline || pipeline.owner_id !== userId) {
    return apiError(c, 'NOT_FOUND', 'Pipeline not found');
  }

  // Find role context with persona
  const roleCtx = await c.env.DB.prepare(
    `SELECT id, persona_json FROM role_contexts WHERE pipeline_id = ?1 AND status = 'COMPLETE' ORDER BY updated_at DESC LIMIT 1`,
  ).bind(body.pipelineId).first<{ id: string; persona_json: string | null }>();

  if (!roleCtx?.persona_json) {
    return apiError(c, 'BAD_REQUEST', 'Pipeline has no completed role discovery. Run role discovery first.');
  }

  const persona = parseJsonColumn<CandidatePersona | null>(roleCtx.persona_json, null);
  if (!persona?.mustHaveSkills?.length) {
    return apiError(c, 'BAD_REQUEST', 'Role persona has no mustHaveSkills. Cannot discover repos.');
  }

  // Check for Libraries.io API key
  if (!c.env.LIBRARIES_IO_API_KEY) {
    return apiError(c, 'SERVER_ERROR', 'LIBRARIES_IO_API_KEY is not configured');
  }

  // Create discovery job
  const jobResult = await c.env.DB.prepare(`
    INSERT INTO discovery_jobs (pipeline_id, role_context_id, owner_id, status)
    VALUES (?1, ?2, ?3, 'PENDING')
    RETURNING id
  `).bind(body.pipelineId, roleCtx.id, userId).first<{ id: string }>();

  if (!jobResult) {
    return apiError(c, 'SERVER_ERROR', 'Failed to create discovery job');
  }

  // Run discovery in background
  const discoveryPromise = runDiscovery({
    db: c.env.DB,
    pipelineId: body.pipelineId,
    roleContextId: roleCtx.id,
    ownerId: userId,
    jobId: jobResult.id,
    persona,
    librariesIoApiKey: c.env.LIBRARIES_IO_API_KEY,
    githubToken: c.env.GITHUB_TOKEN,
  });

  c.executionCtx.waitUntil(discoveryPromise);

  return c.json({ jobId: jobResult.id, status: 'PENDING' }, 202);
});

// ─── GET /jobs/:jobId ───────────────────────────────────────────────────────

repoDiscovery.get('/jobs/:jobId', async (c) => {
  const userId = c.var.userId;
  const jobId = c.req.param('jobId');

  const job = await c.env.DB.prepare(
    `SELECT * FROM discovery_jobs WHERE id = ?1 AND owner_id = ?2`,
  ).bind(jobId, userId).first<DiscoveryJobRow>();

  if (!job) {
    return apiError(c, 'NOT_FOUND', 'Discovery job not found');
  }

  return c.json({ job: toJobResponse(job) });
});

// ─── GET / ──────────────────────────────────────────────────────────────────

repoDiscovery.get('/', async (c) => {
  const userId = c.var.userId;
  const pipelineId = c.req.query('pipelineId');
  const status = c.req.query('status');

  if (!pipelineId) {
    return apiError(c, 'BAD_REQUEST', 'pipelineId query parameter is required');
  }

  let query = `SELECT * FROM discovered_repos WHERE pipeline_id = ?1 AND owner_id = ?2`;
  const binds: unknown[] = [pipelineId, userId];

  if (status) {
    query += ` AND status = ?3`;
    binds.push(status);
  }

  query += ` ORDER BY quality_score DESC, stars DESC`;

  const stmt = binds.length === 3
    ? c.env.DB.prepare(query).bind(binds[0], binds[1], binds[2])
    : c.env.DB.prepare(query).bind(binds[0], binds[1]);

  const { results } = await stmt.all<DiscoveredRepoRow>();

  return c.json({ repos: (results ?? []).map(toRepoResponse) });
});

// ─── GET /:repoId ───────────────────────────────────────────────────────────

repoDiscovery.get('/:repoId', async (c) => {
  const userId = c.var.userId;
  const repoId = c.req.param('repoId');

  const repo = await c.env.DB.prepare(
    `SELECT * FROM discovered_repos WHERE id = ?1 AND owner_id = ?2`,
  ).bind(repoId, userId).first<DiscoveredRepoRow>();

  if (!repo) {
    return apiError(c, 'NOT_FOUND', 'Repo not found');
  }

  return c.json({ repo: toRepoResponse(repo) });
});

// ─── PATCH /:repoId ────────────────────────────────────────────────────────

repoDiscovery.patch('/:repoId', async (c) => {
  const userId = c.var.userId;
  const repoId = c.req.param('repoId');

  const body = await c.req.json<{
    status?: 'ACCEPTED' | 'REJECTED';
    rejectionReason?: string;
  }>().catch(() => ({}));

  if (!body.status || !['ACCEPTED', 'REJECTED'].includes(body.status)) {
    return apiError(c, 'BAD_REQUEST', 'status must be ACCEPTED or REJECTED');
  }

  const repo = await c.env.DB.prepare(
    `SELECT * FROM discovered_repos WHERE id = ?1 AND owner_id = ?2`,
  ).bind(repoId, userId).first<DiscoveredRepoRow>();

  if (!repo) {
    return apiError(c, 'NOT_FOUND', 'Repo not found');
  }

  if (!['DISCOVERED', 'ASSESSED'].includes(repo.status)) {
    return apiError(c, 'BAD_REQUEST', `Cannot change status from ${repo.status} to ${body.status}`);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    UPDATE discovered_repos
    SET status = ?1, rejection_reason = ?2, updated_at = ?3
    WHERE id = ?4
  `).bind(body.status, body.rejectionReason ?? null, now, repoId).run();

  const updated = await c.env.DB.prepare(
    `SELECT * FROM discovered_repos WHERE id = ?1`,
  ).bind(repoId).first<DiscoveredRepoRow>();

  return c.json({ repo: updated ? toRepoResponse(updated) : null });
});

// ─── POST /:repoId/convert ─────────────────────────────────────────────────

repoDiscovery.post('/:repoId/convert', async (c) => {
  const userId = c.var.userId;
  const repoId = c.req.param('repoId');

  const body = await c.req.json<{ prNumber?: number }>().catch(() => ({}));

  const repo = await c.env.DB.prepare(
    `SELECT * FROM discovered_repos WHERE id = ?1 AND owner_id = ?2`,
  ).bind(repoId, userId).first<DiscoveredRepoRow>();

  if (!repo) {
    return apiError(c, 'NOT_FOUND', 'Repo not found');
  }

  if (repo.status !== 'ACCEPTED') {
    return apiError(c, 'BAD_REQUEST', `Repo must be ACCEPTED before conversion (current: ${repo.status})`);
  }

  try {
    const result = await convertRepoToChallenge(c.env.DB, repo, {
      prNumber: body.prNumber,
      githubToken: c.env.GITHUB_TOKEN,
    });

    return c.json(result, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 'SERVER_ERROR', msg);
  }
});

export { repoDiscovery };
