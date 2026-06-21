/**
 * Internal projection rebuild endpoint.
 *
 * POST /api/v1/internal/projection-rebuild
 * Triggers on-demand Neo4j projection outbox processing.
 *
 * Query params:
 *   limit  — max outbox entries to process (default 50, max 500)
 *   force  — if "true", resets all stale/failed entries to pending first
 *
 * Auth: requires ADMIN_TTL_OVERRIDE_SECRET in X-Admin-Token header.
 * This is an internal ops endpoint, not recruiter/candidate facing.
 */

import { Hono } from 'hono';
import type { Env } from '../../types';
import { processProjectionOutbox, listCheckpoints, resetCheckpoint } from '../../lib/livingContext';

const app = new Hono<{ Bindings: Env }>();

app.post('/projection-rebuild', async (c) => {
  const adminToken = c.req.header('X-Admin-Token');
  const expectedToken = c.env.ADMIN_TTL_OVERRIDE_SECRET;
  if (!expectedToken || adminToken !== expectedToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const limitParam = c.req.query('limit');
  const forceParam = c.req.query('force');
  const limit = Math.min(Math.max(1, Number(limitParam) || 50), 500);

  if (forceParam === 'true') {
    await c.env.DB.prepare(
      `UPDATE projection_outbox
          SET status = 'pending',
              available_at = datetime('now'),
              locked_at = NULL,
              locked_by = NULL,
              updated_at = datetime('now')
        WHERE projection_type = 'neo4j'
          AND status IN ('failed', 'processing')
          AND locked_at <= datetime('now', '-5 minutes')`,
    ).run();
  }

  const result = await processProjectionOutbox(c.env, limit);

  const pending = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM projection_outbox
      WHERE projection_type = 'neo4j' AND status = 'pending'`,
  ).first<{ count: number }>();

  return c.json({
    processed: result.completed,
    failed: result.failed,
    remainingPending: pending?.count ?? 0,
    limit,
    forced: forceParam === 'true',
  });
});

app.get('/projection-status', async (c) => {
  const adminToken = c.req.header('X-Admin-Token');
  const expectedToken = c.env.ADMIN_TTL_OVERRIDE_SECRET;
  if (!expectedToken || adminToken !== expectedToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const stats = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as count
       FROM projection_outbox
      WHERE projection_type = 'neo4j'
      GROUP BY status`,
  ).all<{ status: string; count: number }>();

  const lastCompleted = await c.env.DB.prepare(
    `SELECT completed_at FROM projection_outbox
      WHERE projection_type = 'neo4j' AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1`,
  ).first<{ completed_at: string | null }>();

  const lastFailed = await c.env.DB.prepare(
    `SELECT last_error, updated_at FROM projection_outbox
      WHERE projection_type = 'neo4j' AND status = 'failed'
      ORDER BY updated_at DESC LIMIT 1`,
  ).first<{ last_error: string | null; updated_at: string | null }>();

  return c.json({
    statusBreakdown: stats.results ?? [],
    lastCompleted: lastCompleted?.completed_at ?? null,
    lastFailedError: lastFailed?.last_error ?? null,
    lastFailedAt: lastFailed?.updated_at ?? null,
  });
});

app.get('/backfill-status', async (c) => {
  const adminToken = c.req.header('X-Admin-Token');
  const expectedToken = c.env.ADMIN_TTL_OVERRIDE_SECRET;
  if (!expectedToken || adminToken !== expectedToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const checkpoints = await listCheckpoints(c.env.DB);
  return c.json({ checkpoints });
});

app.post('/backfill-reset', async (c) => {
  const adminToken = c.req.header('X-Admin-Token');
  const expectedToken = c.env.ADMIN_TTL_OVERRIDE_SECRET;
  if (!expectedToken || adminToken !== expectedToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const name = c.req.query('name');
  if (!name) {
    return c.json({ error: 'Missing required query parameter: name' }, 400);
  }

  const removed = await resetCheckpoint(c.env.DB, name);
  return c.json({ removed, backfillName: name });
});

export const projectionRebuild = app;
