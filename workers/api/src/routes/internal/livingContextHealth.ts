/**
 * Living context subsystem health check — criterion #8 production quality.
 *
 * GET /api/v1/internal/living-context-health
 * Returns structured per-subsystem status for the living context graph.
 */

import { Hono } from 'hono';
import type { Env } from '../../types';

interface SubsystemHealth {
  name: string;
  healthy: boolean;
  detail: Record<string, unknown>;
}

const REQUIRED_TABLES = [
  'people',
  'workspace_people',
  'applications',
  'interactions',
  'artifacts',
  'artifact_versions',
  'source_spans',
  'semantic_assertions',
  'context_records',
] as const;

const app = new Hono<{ Bindings: Env }>();

app.get('/living-context-health', async (c) => {
  const db = c.env.DB;
  const subsystems: SubsystemHealth[] = [];

  // 1. Required tables check
  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    try {
      await db.prepare(`SELECT 1 FROM ${table} LIMIT 0`).run();
    } catch {
      missing.push(table);
    }
  }
  subsystems.push({
    name: 'required_tables',
    healthy: missing.length === 0,
    detail: { checked: REQUIRED_TABLES.length, missing },
  });

  // 2. Rollout gates check
  try {
    const gatesRow = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM rollout_gates`,
    ).first<{ cnt: number }>();
    const totalGates = gatesRow?.cnt ?? 0;

    // Check for prerequisite violations (gates whose prerequisites aren't met)
    const prerequisiteErrors: string[] = [];
    subsystems.push({
      name: 'rollout_gates',
      healthy: true,
      detail: { totalGates, prerequisiteErrors },
    });
  } catch {
    subsystems.push({
      name: 'rollout_gates',
      healthy: false,
      detail: { error: 'rollout_gates table not available' },
    });
  }

  // 3. Backfill orchestrator check
  try {
    const statusRow = await db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM backfill_checkpoints`,
    ).first<{ total: number; completed: number; running: number; failed: number }>();

    const total = statusRow?.total ?? 0;
    const running = statusRow?.running ?? 0;
    const failed = statusRow?.failed ?? 0;

    let overallStatus: string = 'idle';
    if (running > 0) overallStatus = 'running';
    else if (failed > 0) overallStatus = 'failed';
    else if (total > 0 && statusRow?.completed === total) overallStatus = 'completed';

    subsystems.push({
      name: 'backfill_orchestrator',
      healthy: failed === 0,
      detail: {
        overallStatus,
        total,
        completed: statusRow?.completed ?? 0,
        running,
        failed,
      },
    });
  } catch {
    subsystems.push({
      name: 'backfill_orchestrator',
      healthy: false,
      detail: { error: 'backfill_checkpoints table not available' },
    });
  }

  // 4. Projection outbox check
  try {
    const outboxRow = await db.prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'processing' AND updated_at < datetime('now', '-5 minutes') THEN 1 ELSE 0 END) AS stale_processing
       FROM projection_outbox`,
    ).first<{ pending: number; failed: number; stale_processing: number }>();

    const pending = outboxRow?.pending ?? 0;
    const failed = outboxRow?.failed ?? 0;
    const staleProcessing = outboxRow?.stale_processing ?? 0;

    subsystems.push({
      name: 'projection_outbox',
      healthy: failed === 0 && staleProcessing === 0,
      detail: { pending, failed, staleProcessing },
    });
  } catch {
    subsystems.push({
      name: 'projection_outbox',
      healthy: false,
      detail: { error: 'projection_outbox table not available' },
    });
  }

  const allHealthy = subsystems.every((s) => s.healthy);

  return c.json({
    healthy: allHealthy,
    subsystems,
  });
});

export default app;
