/**
 * Candidate routes — Phase 2
 *
 * POST /api/v1/pipelines/:pipelineId/candidates — create candidate with invite token
 * PATCH /api/v1/candidates/:candidateId — update (move stage, update status)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import type { Env, Variables } from '../types';

// ─── Validation ──────────────────────────────────────────────────────────────

const createCandidateSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  email: z.string().email('valid email required'),
  currentStageId: z.string().optional(),
});

const updateCandidateSchema = z.object({
  currentStageId: z.string().optional(),
  status: z.enum(['INVITED', 'IN_PROGRESS', 'COMPLETED']).optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
});

// ─── Pipeline-scoped routes ──────────────────────────────────────────────────

const pipelineCandidates = new Hono<{ Bindings: Env; Variables: Variables }>();
pipelineCandidates.use('*', authMiddleware);

// POST /:pipelineId/candidates
pipelineCandidates.post('/:pipelineId/candidates', async (c) => {
  const userId = c.var.userId;
  const { pipelineId } = c.req.param();
  const db = c.env.DB;

  // Ownership check
  const pipeline = await db
    .prepare('SELECT id FROM pipelines WHERE id = ? AND owner_id = ?')
    .bind(pipelineId, userId)
    .first();
  if (!pipeline) return apiError(c, 'NOT_FOUND', 'Pipeline not found.');

  const body = await c.req.json();
  const parsed = createCandidateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { name, email, currentStageId: requestedStageId } = parsed.data;
  const id = crypto.randomUUID();
  const inviteToken = crypto.randomUUID();
  const now = new Date().toISOString();

  // Use requested stage or fall back to first stage
  let stageId = requestedStageId ?? null;
  if (!stageId) {
    const firstStage = await db
      .prepare(
        'SELECT id FROM stages WHERE pipeline_id = ? ORDER BY sort_order ASC LIMIT 1'
      )
      .bind(pipelineId)
      .first();
    stageId = (firstStage?.id as string) ?? null;
  }

  await db
    .prepare(
      `INSERT INTO candidates (id, pipeline_id, owner_id, name, email, invite_token, status, current_stage_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'INVITED', ?, ?, ?)`
    )
    .bind(id, pipelineId, userId, name, email, inviteToken, stageId, now, now)
    .run();

  return c.json({
    candidate: {
      id,
      name,
      email,
      inviteToken,
      status: 'INVITED',
      currentStageId: stageId,
    },
  }, 201);
});

// ─── Flat candidate routes ───────────────────────────────────────────────────

const candidateOps = new Hono<{ Bindings: Env; Variables: Variables }>();
candidateOps.use('*', authMiddleware);

// PATCH /:candidateId
candidateOps.patch('/:candidateId', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check via pipeline
  const candidate = await db
    .prepare(
      `SELECT c.id, c.pipeline_id FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const body = await c.req.json();
  const parsed = updateCandidateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (parsed.data.currentStageId !== undefined) {
    updates.push('current_stage_id = ?');
    values.push(parsed.data.currentStageId);
  }
  if (parsed.data.status !== undefined) {
    updates.push('status = ?');
    values.push(parsed.data.status);
  }
  if (parsed.data.name !== undefined) {
    updates.push('name = ?');
    values.push(parsed.data.name);
  }
  if (parsed.data.email !== undefined) {
    updates.push('email = ?');
    values.push(parsed.data.email);
  }

  if (updates.length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'No fields to update.');
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(candidateId);

  await db
    .prepare(`UPDATE candidates SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true });
});

export { pipelineCandidates, candidateOps };
