import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import { createPipelineSchema } from '../validation/pipelines';
import { expandPreset } from '../lib/presets';
import type { Env, Variables, PipelineWithCountsRow } from '../types';

const pipelines = new Hono<{ Bindings: Env; Variables: Variables }>();

// All pipeline routes require a valid Clerk JWT.
pipelines.use('*', authMiddleware);

// ─── GET /api/v1/pipelines ────────────────────────────────────────────────────

/**
 * List all pipelines owned by the authenticated user.
 *
 * Query params:
 *   status — filter by 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
 *   q      — case-insensitive title search
 */
pipelines.get('/', async (c) => {
  const userId = c.var.userId;
  const statusFilter = c.req.query('status');
  const searchQuery = c.req.query('q');

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

  // Phase 1: candidates table does not exist — candidateCount hardcoded to 0.
  // Phase 2: replace `0 AS candidate_count` with a LEFT JOIN on the candidates table.
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
      0 AS candidate_count
    FROM pipelines p
    LEFT JOIN stages s ON s.pipeline_id = p.id
    WHERE ${whereClause}
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `;

  const stmt = c.env.DB.prepare(sql).bind(...bindings);
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

  return c.json({ pipelines: pipelineList });
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
      input.level,
      stackJson,
      input.description ?? null,
      input.status,
      creationMode,
    ),
  );

  const stages = preset?.stages ?? [];
  let totalChallenges = 0;

  for (const stage of stages) {
    const stageId = generateId();

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO stages (id, pipeline_id, title, description, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(stageId, pipelineId, stage.title, stage.description ?? null, stage.sortOrder),
    );

    for (let ci = 0; ci < stage.challenges.length; ci++) {
      const challenge = stage.challenges[ci];
      if (!challenge) continue;

      const challengeId = generateId();
      const configJson = JSON.stringify(challenge.config);
      const serverConfigJson = challenge.serverConfig
        ? JSON.stringify(challenge.serverConfig)
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

  return c.json(
    {
      pipeline: {
        id: pipelineId,
        title: input.title,
        level: input.level,
        status: input.status,
        stageCount: stages.length,
        createdAt: new Date().toISOString(),
      },
    },
    201,
  );
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
