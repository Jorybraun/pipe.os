/**
 * Challenge routes — Phase 2
 *
 * Mounts under /api/v1/challenges.
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Routes:
 *   GET    /api/v1/challenges/:challengeId          — load challenge (flat response)
 *   PUT    /api/v1/challenges/:challengeId          — full/partial update
 *   DELETE /api/v1/challenges/:challengeId          — delete challenge (204)
 *   POST   /api/v1/challenges/:challengeId/clone    — duplicate challenge
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { rowToResponse } from './stages';
import type { Env, Variables, ChallengeRow } from '../../types';

// ─── Validation ────────────────────────────────────────────────────────────────

const updateChallengeSchema = z.object({
  title: z
    .string()
    .min(1, 'title must not be empty')
    .max(400, 'title must be 400 characters or fewer')
    .optional(),
  type: z
    .enum(['CODE_REVIEW', 'CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER', 'FOLLOW_UP', 'INTAKE'])
    .optional(),
  instructions: z.string().nullable().optional(),
  config: z.union([z.record(z.unknown()), z.string()]).optional(),
  serverConfig: z.union([z.record(z.unknown()), z.string()]).optional(),
  githubRepoUrl: z.string().nullable().optional(),
  githubPrNumber: z.number().int().nullable().optional(),
  githubPrTitle: z.string().nullable().optional(),
  githubPrDescription: z.string().nullable().optional(),
  cachedDiffJson: z.unknown().optional(),
  cachedMetadata: z.unknown().optional(),
  diffCachedAt: z.string().nullable().optional(),
  groundTruth: z.string().nullable().optional(),
  groundTruthAnnotations: z.unknown().optional(),
});

// ─── Router ────────────────────────────────────────────────────────────────────

const challenges = new Hono<{ Bindings: Env; Variables: Variables }>();

challenges.use('*', authMiddleware);

// ─── GET /api/v1/challenges/:challengeId ─────────────────────────────────────

/**
 * Fetch a single challenge for the challenge editor.
 *
 * Returns a flat camelCase object — no `data` wrapper.
 * Includes `pipelineId` for breadcrumb navigation.
 */
challenges.get('/:challengeId', async (c) => {
  const userId = c.var.userId;
  const challengeId = c.req.param('challengeId');

  const row = await c.env.DB.prepare(
    `SELECT ch.*, s.pipeline_id, p.owner_id AS pipeline_owner_id
     FROM challenges ch
     JOIN stages s ON s.id = ch.stage_id
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE ch.id = ?1`,
  )
    .bind(challengeId)
    .first<ChallengeRow & { pipeline_id: string; pipeline_owner_id: string }>();

  if (!row) return apiError(c, 'NOT_FOUND', 'Challenge not found.');
  if (row.pipeline_owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this challenge.');

  return c.json({
    ...rowToResponse(row, row.stage_id),
    pipelineId: row.pipeline_id,
  });
});

// ─── PUT /api/v1/challenges/:challengeId ─────────────────────────────────────

/**
 * Partial update of a challenge.
 *
 * Only supplied fields are written. config/serverConfig may be passed as
 * a parsed object or a JSON string — both are normalised to stored JSON text.
 * Returns the updated challenge (flat, no `data` wrapper).
 */
challenges.put('/:challengeId', async (c) => {
  const userId = c.var.userId;
  const challengeId = c.req.param('challengeId');

  const existing = await c.env.DB.prepare(
    `SELECT ch.id, p.owner_id AS pipeline_owner_id
     FROM challenges ch
     JOIN stages s ON s.id = ch.stage_id
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE ch.id = ?1`,
  )
    .bind(challengeId)
    .first<{ id: string; pipeline_owner_id: string }>();

  if (!existing) return apiError(c, 'NOT_FOUND', 'Challenge not found.');
  if (existing.pipeline_owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this challenge.');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = updateChallengeSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const input = parsed.data;
  const now = new Date().toISOString();

  // ── Phase 1 columns (always present) ────────────────────────────────────────
  const p1Clauses: string[] = ['updated_at = ?1'];
  const p1Bindings: unknown[] = [now];

  const addP1 = (column: string, value: unknown) => {
    p1Bindings.push(value);
    p1Clauses.push(`${column} = ?${p1Bindings.length}`);
  };

  if (input.title !== undefined) addP1('title', input.title);
  if (input.type !== undefined) addP1('type', input.type);
  if (input.instructions !== undefined) addP1('instructions', input.instructions);

  if (input.config !== undefined) {
    addP1(
      'config',
      typeof input.config === 'string' ? input.config : JSON.stringify(input.config),
    );
  }

  if (input.serverConfig !== undefined) {
    addP1(
      'server_config',
      typeof input.serverConfig === 'string'
        ? input.serverConfig
        : JSON.stringify(input.serverConfig),
    );
  }

  // Always run the Phase 1 UPDATE (it always has at least `updated_at`).
  p1Bindings.push(challengeId);
  await c.env.DB.prepare(
    `UPDATE challenges SET ${p1Clauses.join(', ')} WHERE id = ?${p1Bindings.length}`,
  )
    .bind(...p1Bindings)
    .run();

  // ── Phase 2 columns (added in migration 0002 — may not exist yet) ───────────
  const hasPhase2Input =
    input.githubRepoUrl !== undefined ||
    input.githubPrNumber !== undefined ||
    input.githubPrTitle !== undefined ||
    input.githubPrDescription !== undefined ||
    input.cachedDiffJson !== undefined ||
    input.cachedMetadata !== undefined ||
    input.diffCachedAt !== undefined ||
    input.groundTruth !== undefined ||
    input.groundTruthAnnotations !== undefined;

  if (hasPhase2Input) {
    const p2Clauses: string[] = [];
    const p2Bindings: unknown[] = [];

    const addP2 = (column: string, value: unknown) => {
      p2Bindings.push(value);
      p2Clauses.push(`${column} = ?${p2Bindings.length}`);
    };

    if (input.githubRepoUrl !== undefined) addP2('github_repo_url', input.githubRepoUrl);
    if (input.githubPrNumber !== undefined) addP2('github_pr_number', input.githubPrNumber);
    if (input.githubPrTitle !== undefined) addP2('github_pr_title', input.githubPrTitle);
    if (input.githubPrDescription !== undefined)
      addP2('github_pr_description', input.githubPrDescription);

    if (input.cachedDiffJson !== undefined) {
      addP2(
        'cached_diff_json',
        input.cachedDiffJson === null
          ? null
          : typeof input.cachedDiffJson === 'string'
            ? input.cachedDiffJson
            : JSON.stringify(input.cachedDiffJson),
      );
    }

    if (input.cachedMetadata !== undefined) {
      addP2(
        'cached_metadata',
        input.cachedMetadata === null
          ? null
          : typeof input.cachedMetadata === 'string'
            ? input.cachedMetadata
            : JSON.stringify(input.cachedMetadata),
      );
    }

    if (input.diffCachedAt !== undefined) addP2('diff_cached_at', input.diffCachedAt);
    if (input.groundTruth !== undefined) addP2('ground_truth', input.groundTruth);

    if (input.groundTruthAnnotations !== undefined) {
      addP2(
        'ground_truth_annotations',
        input.groundTruthAnnotations === null
          ? null
          : typeof input.groundTruthAnnotations === 'string'
            ? input.groundTruthAnnotations
            : JSON.stringify(input.groundTruthAnnotations),
      );
    }

    if (p2Clauses.length > 0) {
      p2Bindings.push(challengeId);
      try {
        await c.env.DB.prepare(
          `UPDATE challenges SET ${p2Clauses.join(', ')} WHERE id = ?${p2Bindings.length}`,
        )
          .bind(...p2Bindings)
          .run();
      } catch {
        // Phase 2 columns not yet migrated — Phase 1 fields already saved, continue.
      }
    }
  }

  const row = await c.env.DB.prepare(
    `SELECT ch.*, s.pipeline_id
     FROM challenges ch
     JOIN stages s ON s.id = ch.stage_id
     WHERE ch.id = ?1`,
  )
    .bind(challengeId)
    .first<ChallengeRow & { pipeline_id: string }>();

  if (!row) return apiError(c, 'INTERNAL_ERROR', 'Failed to fetch updated challenge.');

  return c.json({
    ...rowToResponse(row, row.stage_id),
    pipelineId: row.pipeline_id,
  });
});

// ─── DELETE /api/v1/challenges/:challengeId ───────────────────────────────────

/**
 * Delete a challenge by ID.
 *
 * Ownership verified via stage → pipeline chain.
 * Returns 204 on success.
 */
challenges.delete('/:challengeId', async (c) => {
  const userId = c.var.userId;
  const challengeId = c.req.param('challengeId');

  const ownerRow = await c.env.DB.prepare(
    `SELECT p.owner_id
     FROM challenges ch
     JOIN stages s ON s.id = ch.stage_id
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE ch.id = ?1`,
  )
    .bind(challengeId)
    .first<{ owner_id: string }>();

  if (!ownerRow) return apiError(c, 'NOT_FOUND', 'Challenge not found.');
  if (ownerRow.owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this challenge.');

  // Delete child review_sessions first (no ON DELETE CASCADE in schema)
  await c.env.DB.prepare('DELETE FROM review_sessions WHERE challenge_id = ?1')
    .bind(challengeId)
    .run();

  await c.env.DB.prepare('DELETE FROM challenges WHERE id = ?1')
    .bind(challengeId)
    .run();

  return new Response(null, { status: 204 });
});

// ─── POST /api/v1/challenges/:challengeId/clone ───────────────────────────────

/**
 * Clone a challenge — creates a copy with title "(original) (Clone)".
 *
 * Returns 201 { id, title, type, stageId, pipelineId }
 */
challenges.post('/:challengeId/clone', async (c) => {
  const userId = c.var.userId;
  const challengeId = c.req.param('challengeId');

  const body = await c.req.json<{ newId?: string }>().catch((): { newId?: string } => ({}));
  const clientNewId = typeof body?.newId === 'string' && body.newId ? body.newId : null;

  const original = await c.env.DB.prepare(
    `SELECT ch.*, s.pipeline_id, p.owner_id AS pipeline_owner_id
     FROM challenges ch
     JOIN stages s ON s.id = ch.stage_id
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE ch.id = ?1`,
  )
    .bind(challengeId)
    .first<ChallengeRow & { pipeline_id: string; pipeline_owner_id: string }>();

  if (!original) return apiError(c, 'NOT_FOUND', 'Challenge not found.');
  if (original.pipeline_owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this challenge.');

  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(sort_order) AS max_order FROM challenges WHERE stage_id = ?1',
  )
    .bind(original.stage_id)
    .first<{ max_order: number | null }>();

  const nextOrder = (maxRow?.max_order ?? -1) + 1;
  const newId = clientNewId ?? generateId();
  const newTitle = `${original.title} (Clone)`;

  // Phase 1 core columns first.
  await c.env.DB.prepare(
    `INSERT INTO challenges (id, stage_id, type, sort_order, title, instructions, config, server_config)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      newId,
      original.stage_id,
      original.type,
      nextOrder,
      newTitle,
      original.instructions ?? null,
      original.config ?? null,
      original.server_config ?? null,
    )
    .run();

  // Phase 2 columns — applied in a follow-up UPDATE; ignored if migration not yet applied.
  const hasPhase2 =
    original.github_repo_url ||
    original.github_pr_number ||
    original.github_pr_title ||
    original.cached_diff_json ||
    original.cached_metadata ||
    original.diff_cached_at ||
    original.ground_truth_annotations ||
    original.ground_truth;

  if (hasPhase2) {
    try {
      await c.env.DB.prepare(
        `UPDATE challenges
         SET github_repo_url = ?1,
             github_pr_number = ?2,
             github_pr_title = ?3,
             github_pr_description = ?4,
             cached_diff_json = ?5,
             cached_metadata = ?6,
             diff_cached_at = ?7,
             ground_truth_annotations = ?8,
             ground_truth = ?9
         WHERE id = ?10`,
      )
        .bind(
          original.github_repo_url ?? null,
          original.github_pr_number ?? null,
          original.github_pr_title ?? null,
          original.github_pr_description ?? null,
          original.cached_diff_json ?? null,
          original.cached_metadata ?? null,
          original.diff_cached_at ?? null,
          original.ground_truth_annotations ?? null,
          original.ground_truth ?? null,
          newId,
        )
        .run();
    } catch {
      // Phase 2 columns not yet migrated — core data copied, continue.
    }
  }

  return c.json(
    {
      id: newId,
      title: newTitle,
      type: original.type,
      stageId: original.stage_id,
      pipelineId: original.pipeline_id,
    },
    201,
  );
});

// ─── Utility ──────────────────────────────────────────────────────────────────

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { challenges };
