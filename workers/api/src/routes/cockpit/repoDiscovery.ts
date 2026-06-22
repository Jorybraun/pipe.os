/**
 * Repo Discovery routes — ADR-032, repo-discovery-pipeline.md
 *
 * Mounts under /api/v1/repos.
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Routes:
 *   POST   /discover              — start async discovery for a pipeline
 *   POST   /discover-by-skills    — legacy unsupported; source-backed context required
 *   GET    /jobs/:jobId           — poll discovery job status
 *   GET    /                      — list discovered repos (filterable)
 *   GET    /:repoId               — single repo detail
 *   PATCH  /:repoId               — accept or reject a repo
 *   POST   /:repoId/convert      — convert accepted repo to CODE_REVIEW challenge template
 *   POST   /:repoId/brief        — generate a challenge brief for an accepted repo
 *   POST   /briefs/save           — persist approved briefs as challenge templates
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { runDiscovery } from '../../lib/repoDiscovery/discover';
import { convertRepoToChallenge } from '../../lib/repoDiscovery/convertToChallenge';
import { fetchGitHubDiff } from '../../lib/fetchGitHubDiff';
import { createRoleAgentProvider } from '../../lib/llm/createProvider';
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

async function hasSourceBackedSimpleJdContext(db: D1Database, roleContextId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT cr.id
       FROM context_records cr
       JOIN context_record_source_refs crsr ON crsr.context_record_id = cr.id
      WHERE cr.scope_type = 'role_context'
        AND cr.scope_id = ?1
        AND cr.record_type = 'simple_job_description'
      LIMIT 1`,
  ).bind(roleContextId).first<{ id: string }>();
  return Boolean(row);
}

async function sourceBackedSimpleJdPersona(
  db: D1Database,
  roleCtx: {
    id: string;
    non_negotiable_skills_json: string | null;
    validation_metadata: string | null;
  },
): Promise<CandidatePersona | null> {
  const metadata = parseJsonColumn<{ source?: string } | null>(roleCtx.validation_metadata, null);
  if (metadata?.source !== 'simple_job_description') return null;

  const selectedTerms = parseJsonColumn<unknown>(roleCtx.non_negotiable_skills_json, []);
  if (!Array.isArray(selectedTerms)) return null;
  const mustHaveSkills = selectedTerms
    .filter((term): term is string => typeof term === 'string')
    .map((term) => term.trim())
    .filter(Boolean);
  if (mustHaveSkills.length === 0) return null;

  if (!await hasSourceBackedSimpleJdContext(db, roleCtx.id)) return null;

  return {
    seniority: '',
    archetype: 'Source-backed job description',
    mustHaveSkills,
    niceToHaveSkills: [],
    disposition: [],
    careerSignal: '',
    redFlags: [],
    dealbreakers: [],
  };
}

// ─── POST /discover ─────────────────────────────────────────────────────────

repoDiscovery.post('/discover', async (c) => {
  const userId = c.var.userId;
  const body = await c.req.json<{ pipelineId?: string }>().catch(() => ({} as { pipelineId?: string }));

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
    `SELECT id, rcd_json, persona_json, non_negotiable_skills_json, validation_metadata
       FROM role_contexts
      WHERE pipeline_id = ?1
        AND status = 'COMPLETE'
      ORDER BY updated_at DESC
      LIMIT 1`,
  ).bind(body.pipelineId).first<{
    id: string;
    rcd_json: string | null;
    persona_json: string | null;
    non_negotiable_skills_json: string | null;
    validation_metadata: string | null;
  }>();

  if (!roleCtx) {
    return apiError(c, 'BAD_REQUEST', 'Pipeline has no source-backed role context. Create a simple job description with literal selected terms, or run deterministic candidate-to-PR matching from persisted evidence. Role discovery is optional and is not required for repository matching.');
  }

  /** RCD primary, persona_json fallback — see ADR-040. */
  let persona: CandidatePersona | null = null;
  if (roleCtx.rcd_json) {
    const rcd = parseJsonColumn<{ consumer_slice?: CandidatePersona } | null>(roleCtx.rcd_json, null);
    if (rcd?.consumer_slice) persona = rcd.consumer_slice;
  }
  if (!persona && roleCtx.persona_json) {
    persona = parseJsonColumn<CandidatePersona | null>(roleCtx.persona_json, null);
  }
  if (!persona) {
    persona = await sourceBackedSimpleJdPersona(c.env.DB, roleCtx);
  }

  if (!persona) {
    return apiError(c, 'BAD_REQUEST', 'Pipeline has no source-backed role context. Create a simple job description with literal selected terms, or run deterministic candidate-to-PR matching from persisted evidence. Role discovery is optional and is not required for repository matching.');
  }
  if (!persona?.mustHaveSkills?.length) {
    return apiError(c, 'BAD_REQUEST', 'Role context has no source-backed selected terms. Select terms that appear in the original job description before discovering repositories.');
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

  // Wire the role-agent provider so discovery can run the ADR-036 §2.3
  // RCD-aware rerank. Missing → discovery falls back to matchRepos order.
  const rerankProvider = createRoleAgentProvider(c.env);

  // Run discovery in background
  const discoveryPromise = runDiscovery({
    db: c.env.DB,
    pipelineId: body.pipelineId,
    roleContextId: roleCtx.id,
    ownerId: userId,
    jobId: jobResult.id,
    persona,
    ...(rerankProvider ? { provider: rerankProvider } : {}),
    vectorize: c.env.REPO_INDEX,
    ai: c.env.AI,
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
  }>().catch(() => ({} as { status?: 'ACCEPTED' | 'REJECTED'; rejectionReason?: string }));

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

  const body = await c.req.json<{ prNumber?: number }>().catch(() => ({} as { prNumber?: number }));

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
      ...(body.prNumber !== undefined ? { prNumber: body.prNumber } : {}),
      ...(c.env.GITHUB_TOKEN !== undefined ? { githubToken: c.env.GITHUB_TOKEN } : {}),
    });

    return c.json(result, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiError(c, 'SERVER_ERROR', msg);
  }
});

// ─── POST /discover-by-skills ──────────────────────────────────────────────

repoDiscovery.post('/discover-by-skills', async (c) => {
  return c.json({
    error: {
      code: 'SOURCE_BACKED_CONTEXT_REQUIRED',
      message: 'Skill-only repository discovery is disabled. Create a source-backed job description or use deterministic candidate-to-PR matching so repository selection can be explained from persisted evidence.',
    },
  }, 410);
});

// ─── POST /:repoId/brief ──────────────────────────────────────────────────

interface GitHubPRItem {
  number: number;
  title: string;
  merged_at: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
}

repoDiscovery.post('/:repoId/brief', async (c) => {
  const userId = c.var.userId;
  const repoId = c.req.param('repoId');
  const body = await c.req.json<{ skills?: string[] }>().catch(() => ({} as { skills?: string[] }));

  const repo = await c.env.DB.prepare(
    `SELECT * FROM discovered_repos WHERE id = ?1 AND owner_id = ?2`,
  ).bind(repoId, userId).first<DiscoveredRepoRow>();

  if (!repo) {
    return apiError(c, 'NOT_FOUND', 'Repo not found');
  }

  const repoUrl = `https://github.com/${repo.github_owner}/${repo.github_repo}`;
  const githubToken = c.env.GITHUB_TOKEN;

  // Fetch merged PRs
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'PIPE-OS/1.0',
  };
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

  let suggestedPRs: Array<{ number: number; title: string; additions: number; deletions: number }> = [];

  try {
    const prResponse = await fetch(
      `https://api.github.com/repos/${repo.github_owner}/${repo.github_repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`,
      { headers },
    );

    if (prResponse.ok) {
      const prs = (await prResponse.json()) as GitHubPRItem[];
      suggestedPRs = prs
        .filter((pr) => pr.merged_at !== null)
        .filter((pr) => pr.changed_files >= 3 && pr.changed_files <= 50)
        .filter((pr) => (pr.additions + pr.deletions) >= 20)
        .slice(0, 5)
        .map((pr) => ({
          number: pr.number,
          title: pr.title,
          additions: pr.additions,
          deletions: pr.deletions,
        }));
    }
  } catch {
    // PR fetch is best-effort — brief still works without it
  }

  // Generate suggested implementation tasks based on repo metadata
  const skills = body.skills ?? [];
  const lang = repo.primary_language ?? 'TypeScript';
  const suggestedTasks = [
    `Implement a new feature using ${lang} in the ${repo.github_repo} codebase`,
    `Add comprehensive test coverage for an existing module`,
    `Refactor a key component to improve maintainability`,
  ];

  // Build brief title and description
  const title = `${repo.github_repo}: ${lang} Challenge`;
  const description = [
    `Challenge based on ${repo.github_owner}/${repo.github_repo}`,
    repo.stars ? `(${repo.stars >= 1000 ? `${(repo.stars / 1000).toFixed(1)}k` : repo.stars} stars).` : '.',
    suggestedPRs.length > 0
      ? `${suggestedPRs.length} recent merged PRs available for code review.`
      : 'No suitable PRs found for code review; consider implementation tasks.',
    skills.length > 0 ? `Skills: ${skills.join(', ')}.` : '',
  ].filter(Boolean).join(' ');

  return c.json({
    title,
    description,
    suggestedPRs,
    suggestedTasks,
  });
});

// ─── POST /briefs/save ─────────────────────────────────────────────────────

interface BriefSaveItem {
  repoId: string;
  title: string;
  description: string;
  difficulty: 'JUNIOR' | 'MID' | 'SENIOR';
  skills: string[];
  challengeTypes: Array<'CODE_REVIEW' | 'CODE_IMPLEMENTATION'>;
  suggestedPRs: Array<{ number: number; title: string; additions: number; deletions: number }>;
  suggestedTasks: string[];
}

repoDiscovery.post('/briefs/save', async (c) => {
  const userId = c.var.userId;
  const body = await c.req.json<{ briefs?: BriefSaveItem[] }>().catch(() => ({} as { briefs?: BriefSaveItem[] }));

  if (!body.briefs?.length) {
    return apiError(c, 'BAD_REQUEST', 'briefs array is required');
  }

  const now = new Date().toISOString();
  const createdTemplates: Array<{ id: string; type: string; title: string; repoId: string }> = [];

  for (const brief of body.briefs) {
    // Verify repo ownership
    const repo = await c.env.DB.prepare(
      `SELECT * FROM discovered_repos WHERE id = ?1 AND owner_id = ?2`,
    ).bind(brief.repoId, userId).first<DiscoveredRepoRow>();

    if (!repo) continue;

    const repoUrl = `https://github.com/${repo.github_owner}/${repo.github_repo}`;

    // Create CODE_REVIEW template if applicable and PRs exist
    if (brief.challengeTypes.includes('CODE_REVIEW') && brief.suggestedPRs.length > 0) {
      const bestPR = brief.suggestedPRs[0]!;
      const config = JSON.stringify({
        repoUrl,
        prNumber: bestPR.number,
        prTitle: bestPR.title,
        language: repo.primary_language ?? 'TypeScript',
        diff: [], // Will be populated when candidate starts
      });
      const serverConfig = JSON.stringify({
        groundTruth: [],
        repoOwner: repo.github_owner,
        repoName: repo.github_repo,
      });

      const result = await c.env.DB.prepare(`
        INSERT INTO challenge_templates (
          type, title, instructions, difficulty, primary_skill, secondary_skills,
          config, server_config, source, is_published,
          created_by, created_at, updated_at
        ) VALUES (
          'CODE_REVIEW', ?1, ?2, ?3, ?4, ?5,
          ?6, ?7, 'AI_GENERATED', 0,
          ?8, ?9, ?9
        )
        RETURNING id
      `).bind(
        `Review: ${brief.title}`.slice(0, 200),
        brief.description,
        brief.difficulty,
        repo.primary_language ?? 'TypeScript',
        JSON.stringify(brief.skills),
        config,
        serverConfig,
        userId,
        now,
      ).first<{ id: string }>();

      if (result) {
        createdTemplates.push({ id: result.id, type: 'CODE_REVIEW', title: brief.title, repoId: brief.repoId });
      }
    }

    // Create CODE_IMPLEMENTATION template if applicable
    if (brief.challengeTypes.includes('CODE_IMPLEMENTATION') && brief.suggestedTasks.length > 0) {
      const config = JSON.stringify({
        repoUrl,
        language: repo.primary_language ?? 'TypeScript',
        tasks: brief.suggestedTasks,
      });

      const result = await c.env.DB.prepare(`
        INSERT INTO challenge_templates (
          type, title, instructions, difficulty, primary_skill, secondary_skills,
          config, source, is_published,
          created_by, created_at, updated_at
        ) VALUES (
          'CODE_IMPLEMENTATION', ?1, ?2, ?3, ?4, ?5,
          ?6, 'AI_GENERATED', 0,
          ?7, ?8, ?8
        )
        RETURNING id
      `).bind(
        `Implement: ${brief.title}`.slice(0, 200),
        brief.description,
        brief.difficulty,
        repo.primary_language ?? 'TypeScript',
        JSON.stringify(brief.skills),
        config,
        userId,
        now,
      ).first<{ id: string }>();

      if (result) {
        createdTemplates.push({ id: result.id, type: 'CODE_IMPLEMENTATION', title: brief.title, repoId: brief.repoId });
      }
    }

    // Update repo status
    await c.env.DB.prepare(
      `UPDATE discovered_repos SET status = 'CHALLENGE_READY', updated_at = ?1 WHERE id = ?2`,
    ).bind(now, brief.repoId).run();
  }

  return c.json({ created: createdTemplates }, 201);
});

export { repoDiscovery };
