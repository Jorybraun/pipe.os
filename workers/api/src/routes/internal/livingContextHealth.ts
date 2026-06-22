/**
 * Living context subsystem health check.
 *
 * GET /api/v1/internal/living-context-health
 *
 * Returns structured status of all living context subsystems:
 *   - Rollout gate configuration
 *   - Backfill orchestrator status
 *   - Projection outbox depth
 *   - D1 table presence
 *
 * Auth: requires ADMIN_TTL_OVERRIDE_SECRET in X-Admin-Token header.
 */

import { Hono } from 'hono';
import type { Env } from '../../types';
import { loadGatesFromD1, validateD1GatePrerequisites } from '../../lib/livingContext/rollout';
import { getOrchestratorStatus } from '../../lib/livingContext/backfillOrchestrator';

interface SubsystemStatus {
  name: string;
  healthy: boolean;
  detail: Record<string, unknown>;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/living-context-health', async (c) => {
  const adminToken = c.req.header('X-Admin-Token');
  const expectedToken = c.env.ADMIN_TTL_OVERRIDE_SECRET;
  if (!expectedToken || adminToken !== expectedToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const subsystems: SubsystemStatus[] = [];

  const rolloutResult = await checkRolloutGates(c.env.DB);
  subsystems.push(rolloutResult);

  const backfillResult = await checkBackfillOrchestrator(c.env.DB);
  subsystems.push(backfillResult);

  const projectionResult = await checkProjectionOutbox(c.env.DB);
  subsystems.push(projectionResult);

  const tablesResult = await checkRequiredTables(c.env.DB);
  subsystems.push(tablesResult);

  const healthy = subsystems.every((s) => s.healthy);
  return c.json({ healthy, subsystems });
});

async function checkRolloutGates(db: D1Database): Promise<SubsystemStatus> {
  try {
    const gates = await loadGatesFromD1(db);
    const errors = await validateD1GatePrerequisites(db);
    const gaSummary = gates.filter((g) => g.stage === 'general_availability').map((g) => g.key);
    const disabledSummary = gates.filter((g) => g.stage === 'disabled').map((g) => g.key);
    return {
      name: 'rollout_gates',
      healthy: errors.length === 0,
      detail: {
        totalGates: gates.length,
        prerequisiteErrors: errors,
        gaGates: gaSummary,
        disabledGates: disabledSummary,
      },
    };
  } catch (err: unknown) {
    return {
      name: 'rollout_gates',
      healthy: false,
      detail: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

async function checkBackfillOrchestrator(db: D1Database): Promise<SubsystemStatus> {
  try {
    const status = await getOrchestratorStatus(db);
    return {
      name: 'backfill_orchestrator',
      healthy: status.overallStatus !== 'failed',
      detail: {
        overallStatus: status.overallStatus,
        totalProcessed: status.totalProcessed,
        totalRemaining: status.totalRemaining,
        tasks: status.tasks.map((t) => ({
          name: t.name,
          status: t.status,
          processedCount: t.checkpoint?.processedCount ?? 0,
        })),
      },
    };
  } catch (err: unknown) {
    return {
      name: 'backfill_orchestrator',
      healthy: false,
      detail: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

async function checkProjectionOutbox(db: D1Database): Promise<SubsystemStatus> {
  try {
    const pending = await db.prepare(
      `SELECT COUNT(*) as count FROM projection_outbox WHERE status = 'pending'`,
    ).first<{ count: number }>();
    const failed = await db.prepare(
      `SELECT COUNT(*) as count FROM projection_outbox WHERE status = 'failed'`,
    ).first<{ count: number }>();
    const stale = await db.prepare(
      `SELECT COUNT(*) as count FROM projection_outbox
       WHERE status = 'processing' AND locked_at <= datetime('now', '-10 minutes')`,
    ).first<{ count: number }>();
    return {
      name: 'projection_outbox',
      healthy: (failed?.count ?? 0) === 0 && (stale?.count ?? 0) === 0,
      detail: {
        pending: pending?.count ?? 0,
        failed: failed?.count ?? 0,
        staleProcessing: stale?.count ?? 0,
      },
    };
  } catch (err: unknown) {
    return {
      name: 'projection_outbox',
      healthy: false,
      detail: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

const REQUIRED_TABLES = [
  'semantic_assertions',
  'source_spans',
  'concepts',
  'assertion_concepts',
  'projection_outbox',
  'rollout_gates',
  'backfill_checkpoints',
  'review_challenge_packets',
  'match_runs',
] as const;

async function checkRequiredTables(db: D1Database): Promise<SubsystemStatus> {
  try {
    const missing: string[] = [];
    for (const table of REQUIRED_TABLES) {
      const exists = await db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      ).bind(table).first<{ name: string }>();
      if (!exists) missing.push(table);
    }
    return {
      name: 'required_tables',
      healthy: missing.length === 0,
      detail: {
        checked: REQUIRED_TABLES.length,
        missing,
      },
    };
  } catch (err: unknown) {
    return {
      name: 'required_tables',
      healthy: false,
      detail: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

export { app as livingContextHealth };
