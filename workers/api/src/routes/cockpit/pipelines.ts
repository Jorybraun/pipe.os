import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { createPipelineSchema } from '../../validation/pipelines';
import { expandPreset } from '../../lib/presets';
import { getScreenerStage } from '../../lib/screener';

import type { Env, Variables, PipelineWithCountsRow } from '../../types';

const pipelines = new Hono<{ Bindings: Env; Variables: Variables }>();

// All pipeline routes require a valid Clerk JWT.
pipelines.use('*', authMiddleware);

const matchConfigSchema = z.object({
  match_philosophy: z.enum(['tailored', 'hybrid', 'validate']).nullable().optional(),
  tolerance: z.enum(['strict', 'moderate', 'lenient']).nullable().optional(),
  stage_linkage: z.enum(['shared-repo', 'per-stage']).nullable().optional(),
  automation_granularity: z.enum(['per-pipeline', 'per-candidate', 'per-stage', 'recruiter-override']).nullable().optional(),
  hybrid_mix_ratio: z.number().min(0).max(1).nullable().optional(),
});

type MatchConfigPatch = z.infer<typeof matchConfigSchema>;

function patchValue<K extends keyof MatchConfigPatch>(
  input: MatchConfigPatch,
  key: K,
  fallback: NonNullable<MatchConfigPatch[K]> | null,
): MatchConfigPatch[K] | null {
  return Object.prototype.hasOwnProperty.call(input, key) ? (input[key] ?? null) : fallback;
}

// ─── GET /api/v1/pipelines ────────────────────────────────────────────────────

/**
 * List all pipelines owned by the authenticated user.
 *
 * Query params:
 *   status — filter by 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
 *   q      — case-insensitive title search
 *   page   — page number (1-based, default 1)
 *   limit  — items per page (default 20, max 100)
 */
pipelines.get('/', async (c) => {
  const userId = c.var.userId;
  const statusFilter = c.req.query('status');
  const searchQuery = c.req.query('q');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;

  // Build parameterised WHERE clause fragments.
  const conditions: string[] = ['p.owner_id = ?1'];
  const bindings: (string | number)[] = [userId];

  if (statusFilter) {
    bindings.push(statusFilter);
    conditions.push(`p.status = ?${bindings.length}`);
  }

  if (searchQuery) {
    bindings.push(`%${searchQuery}%`);
    conditions.push(`p.title LIKE ?${bindings.length}`);
  }

  const whereClause = conditions.join(' AND ');

  // Count total for pagination metadata.
  const countSql = `SELECT COUNT(*) as total FROM pipelines p WHERE ${whereClause}`;
  const countStmt = c.env.DB.prepare(countSql).bind(...bindings);
  const countRow = await countStmt.first<{ total: number }>();
  const total = countRow?.total ?? 0;

  // Main paginated query.
  const sql = `
    SELECT
      p.id,
      p.title,
      p.level,
      p.status,
      p.creation_mode,
      p.created_at,
      p.updated_at,
      COUNT(DISTINCT s.id) AS stage_count,
      COUNT(DISTINCT c.id) AS candidate_count
    FROM pipelines p
    LEFT JOIN stages s ON s.pipeline_id = p.id
    LEFT JOIN candidates c ON c.pipeline_id = p.id AND c.status != 'ARCHIVED'
    WHERE ${whereClause}
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT ?${bindings.length + 1} OFFSET ?${bindings.length + 2}
  `;

  const stmt = c.env.DB.prepare(sql).bind(...bindings, limit, offset);
  const { results } = await stmt.all<PipelineWithCountsRow>();

  const pipelineList = (results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    level: row.level,
    status: row.status,
    creationMode: row.creation_mode,
    stageCount: row.stage_count,
    candidateCount: row.candidate_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return c.json({
    pipelines: pipelineList,
    total,
    page,
    limit,
  });
});

// ─── POST /api/v1/pipelines ───────────────────────────────────────────────────

/**
 * Create a new pipeline.
 *
 * If `presetId` is provided, the preset's stages and challenges are inserted
 * in the same D1 batch as the pipeline — atomic, all-or-nothing.
 *
 * Returns 201 with the created pipeline summary.
 */
pipelines.post('/', async (c) => {
  const userId = c.var.userId;

  // Parse and validate request body.
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = createPipelineSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const input = parsed.data;

  // Resolve preset stages/challenges if a presetId was supplied.
  const preset = input.presetId ? expandPreset(input.presetId) : null;
  if (input.presetId && !preset) {
    return apiError(c, 'VALIDATION_ERROR', `Unknown presetId: "${input.presetId}".`);
  }

  // Generate IDs up-front so we can reference them in child inserts.
  // D1's DEFAULT clause only runs on INSERT — we need the IDs for FK references
  // in a batch, so we generate them in the worker instead.
  const pipelineId = generateId();
  const stackJson = input.stack ? JSON.stringify(input.stack) : null;
  const creationMode = input.presetId ? 'PRESET' : (input.creationMode ?? 'BLANK');

  // Build the batch of statements: pipeline + stages + challenges.
  const statements: D1PreparedStatement[] = [];

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO pipelines (id, owner_id, title, level, stack, description, status, creation_mode)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(
      pipelineId,
      userId,
      input.title,
      input.level ?? null,
      stackJson,
      input.description ?? null,
      input.status,
      creationMode,
    ),
  );

  // Build stage list: automatic screener first by default, then preset stages shifted
  // down by 1. Roleless interview plans can opt out and add exact interviews via
  // POST /api/v1/pipelines/:pipelineId/stages.
  const screener = getScreenerStage();
  const presetStages = preset?.stages ?? [];
  // Shift existing preset stages down by 1 to make room for the screener at sortOrder 0.
  const shiftedPresetStages = presetStages.map((s) => ({
    ...s,
    sortOrder: s.sortOrder + 1,
  }));
  const defaultStages = input.createDefaultStages ? [screener] : [];
  const allStages = [...defaultStages, ...shiftedPresetStages];
  let totalChallenges = 0;

  for (const stage of allStages) {
    const stageId = generateId();

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO stages (id, pipeline_id, title, description, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(
        stageId,
        pipelineId,
        stage.title,
        stage.description ?? null,
        stage.sortOrder,
      ),
    );

    // If this is the automatic screener, set stage_type and screening_format.
    if (stage.title === screener.title && stage.sortOrder === 0) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE stages SET stage_type = 'SCREENING', screening_format = 'ONLINE' WHERE id = ?1`,
        ).bind(stageId),
      );
    }

    for (let ci = 0; ci < stage.challenges.length; ci++) {
      const challenge = stage.challenges[ci];
      if (!challenge) continue;

      const challengeId = generateId();
      // Pack expansion already has config as a JSON string; presets have objects.
      const configJson = typeof challenge.config === 'string'
        ? challenge.config
        : JSON.stringify(challenge.config);
      const serverConfigJson = challenge.serverConfig
        ? (typeof challenge.serverConfig === 'string'
            ? challenge.serverConfig
            : JSON.stringify(challenge.serverConfig))
        : null;

      statements.push(
        c.env.DB.prepare(
          `INSERT INTO challenges (id, stage_id, type, sort_order, title, instructions, config, server_config)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        ).bind(
          challengeId,
          stageId,
          challenge.type,
          ci,
          challenge.title,
          challenge.instructions,
          configJson,
          serverConfigJson,
        ),
      );

      totalChallenges++;
    }
  }

  // Execute as a D1 batch — atomic, rolls back on any failure.
  await c.env.DB.batch(statements);

  const createdAt = new Date().toISOString();
  const pipelinePayload = {
    id: pipelineId,
    title: input.title,
    level: input.level,
    status: input.status,
    stageCount: allStages.length,
    createdAt,
  };

  return c.json(
    {
      // Flat fields (stage-detail.spec.ts seedPipeline reads body.id directly).
      // Also nested under `data` and `pipeline` for other spec compatibility.
      ...pipelinePayload,
      data: pipelinePayload,
      pipeline: pipelinePayload,
    },
    201,
  );
});

// ─── PATCH /api/v1/pipelines/:id ─────────────────────────────────────────────

/**
 * Update a pipeline by ID.
 *
 * Supports updating: status, title.
 * Business rule: DRAFT → ACTIVE requires at least 1 stage.
 *
 * Returns the updated pipeline object.
 */
pipelines.patch('/:id', async (c) => {
  const userId = c.var.userId;
  const pipelineId = c.req.param('id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const schema = z.object({
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
    title: z.string().min(1).max(200).optional(),
    level: z.enum(['Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Lead', 'Manager']).optional().nullable(),
    stack: z.array(z.string()).optional(),
    description: z.string().optional().nullable(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const input = parsed.data;
  const hasField = input.status !== undefined || input.title !== undefined || input.level !== undefined || input.stack !== undefined || input.description !== undefined;
  if (!hasField) {
    return apiError(c, 'VALIDATION_ERROR', 'At least one field (status, title, level, stack, description) must be provided.');
  }

  // Ownership check.
  const existing = await c.env.DB.prepare(
    'SELECT owner_id, status FROM pipelines WHERE id = ?1',
  )
    .bind(pipelineId)
    .first<{ owner_id: string; status: string }>();

  if (!existing) {
    return apiError(c, 'NOT_FOUND', 'Pipeline not found.');
  }
  if (existing.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this pipeline.');
  }

  // Business rule: DRAFT → ACTIVE requires ≥1 stage.
  if (input.status === 'ACTIVE' && existing.status === 'DRAFT') {
    const stageCount = await c.env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM stages WHERE pipeline_id = ?1',
    )
      .bind(pipelineId)
      .first<{ cnt: number }>();

    if (!stageCount || stageCount.cnt === 0) {
      return apiError(c, 'VALIDATION_ERROR', 'Pipeline must have at least 1 stage before publishing.');
    }
  }

  // Build SET clause dynamically.
  const setClauses: string[] = [];
  const bindings: (string | number | null)[] = [];
  let bindIdx = 1;

  if (input.status !== undefined) {
    setClauses.push(`status = ?${bindIdx}`);
    bindings.push(input.status);
    bindIdx++;
  }
  if (input.title !== undefined) {
    setClauses.push(`title = ?${bindIdx}`);
    bindings.push(input.title);
    bindIdx++;
  }
  if (input.level !== undefined) {
    setClauses.push(`level = ?${bindIdx}`);
    bindings.push(input.level);
    bindIdx++;
  }
  if (input.stack !== undefined) {
    setClauses.push(`stack = ?${bindIdx}`);
    bindings.push(JSON.stringify(input.stack));
    bindIdx++;
  }
  if (input.description !== undefined) {
    setClauses.push(`description = ?${bindIdx}`);
    bindings.push(input.description);
    bindIdx++;
  }

  setClauses.push(`updated_at = ?${bindIdx}`);
  bindings.push(new Date().toISOString());
  bindIdx++;

  bindings.push(pipelineId);

  await c.env.DB.prepare(
    `UPDATE pipelines SET ${setClauses.join(', ')} WHERE id = ?${bindIdx}`,
  )
    .bind(...bindings)
    .run();

  // Return updated pipeline.
  const updated = await c.env.DB.prepare(
    `SELECT id, title, level, stack, description, status, creation_mode, created_at, updated_at
     FROM pipelines WHERE id = ?1`,
  )
    .bind(pipelineId)
    .first();

  return c.json({
    id: updated!.id as string,
    title: updated!.title as string,
    level: updated!.level as string | null,
    stack: updated!.stack ? (JSON.parse(updated!.stack as string) as string[]) : null,
    description: updated!.description as string | null,
    status: updated!.status as string,
    creationMode: updated!.creation_mode as string | null,
    createdAt: updated!.created_at as string,
    updatedAt: updated!.updated_at as string,
  });
});

// ─── PATCH /api/v1/pipelines/:id/match-config ───────────────────────────────

/**
 * Upsert the per-pipeline matching policy used by candidate code-stage gates.
 */
pipelines.patch('/:id/match-config', async (c) => {
  const userId = c.var.userId;
  const pipelineId = c.req.param('id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = matchConfigSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const input = parsed.data;
  if (Object.keys(input).length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'At least one match config field must be provided.');
  }

  const pipeline = await c.env.DB.prepare(
    'SELECT owner_id FROM pipelines WHERE id = ?1',
  )
    .bind(pipelineId)
    .first<{ owner_id: string }>();

  if (!pipeline) {
    return apiError(c, 'NOT_FOUND', 'Pipeline not found.');
  }
  if (pipeline.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this pipeline.');
  }

  const existing = await c.env.DB.prepare(
    `SELECT match_philosophy, tolerance, stage_linkage, automation_granularity, hybrid_mix_ratio
       FROM pipeline_match_config
      WHERE pipeline_id = ?1`,
  )
    .bind(pipelineId)
    .first<{
      match_philosophy: 'tailored' | 'hybrid' | 'validate' | null;
      tolerance: 'strict' | 'moderate' | 'lenient' | null;
      stage_linkage: 'shared-repo' | 'per-stage' | null;
      automation_granularity: 'per-pipeline' | 'per-candidate' | 'per-stage' | 'recruiter-override' | null;
      hybrid_mix_ratio: number | null;
    }>();

  const next = {
    matchPhilosophy: patchValue(input, 'match_philosophy', existing?.match_philosophy ?? null),
    tolerance: patchValue(input, 'tolerance', existing?.tolerance ?? null),
    stageLinkage: patchValue(input, 'stage_linkage', existing?.stage_linkage ?? 'shared-repo'),
    automationGranularity: patchValue(input, 'automation_granularity', existing?.automation_granularity ?? 'per-candidate'),
    hybridMixRatio: patchValue(input, 'hybrid_mix_ratio', existing?.hybrid_mix_ratio ?? 0.6),
  };

  await c.env.DB.prepare(
    `INSERT INTO pipeline_match_config (
       pipeline_id, match_philosophy, tolerance, stage_linkage,
       automation_granularity, hybrid_mix_ratio, recruiter_override_audit_json, updated_at
     )
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())
     ON CONFLICT(pipeline_id) DO UPDATE SET
       match_philosophy = excluded.match_philosophy,
       tolerance = excluded.tolerance,
       stage_linkage = excluded.stage_linkage,
       automation_granularity = excluded.automation_granularity,
       hybrid_mix_ratio = excluded.hybrid_mix_ratio,
       recruiter_override_audit_json = excluded.recruiter_override_audit_json,
       updated_at = unixepoch()`,
  )
    .bind(
      pipelineId,
      next.matchPhilosophy,
      next.tolerance,
      next.stageLinkage,
      next.automationGranularity,
      next.hybridMixRatio,
      JSON.stringify({ updatedBy: userId, patch: input }),
    )
    .run();

  return c.json({
    pipelineId,
    matchPhilosophy: next.matchPhilosophy,
    tolerance: next.tolerance,
    stageLinkage: next.stageLinkage,
    automationGranularity: next.automationGranularity,
    hybridMixRatio: next.hybridMixRatio,
  });
});

// ─── DELETE /api/v1/pipelines/:id ────────────────────────────────────────────

/**
 * Delete a pipeline by ID.
 *
 * Verifies ownership before deleting. ON DELETE CASCADE in the schema ensures
 * child stages and challenges are removed automatically.
 *
 * Returns 204 on success.
 */
pipelines.delete('/:id', async (c) => {
  const userId = c.var.userId;
  const pipelineId = c.req.param('id');

  // Ownership check — single SELECT before the DELETE.
  const row = await c.env.DB.prepare(
    'SELECT owner_id FROM pipelines WHERE id = ?1',
  )
    .bind(pipelineId)
    .first<{ owner_id: string }>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Pipeline not found.');
  }

  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this pipeline.');
  }

  await c.env.DB.prepare('DELETE FROM pipelines WHERE id = ?1').bind(pipelineId).run();

  return new Response(null, { status: 204 });
});

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Generates a 32-character lowercase hex ID — equivalent to a UUID without hyphens.
 * Matches the DEFAULT clause used in the D1 schema.
 */
function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { pipelines };
