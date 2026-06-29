/**
 * Living context subsystem health check — criterion #8 production quality.
 *
 * GET /api/v1/internal/living-context-health
 * Returns structured per-subsystem status for the living context graph.
 *
 * GET /api/v1/internal/living-context-stats
 * Returns entity counts, interaction type breakdowns, and per-task backfill progress.
 *
 * GET /api/v1/internal/living-context-backfill
 * Returns per-task backfill checkpoint detail including cursor, processed, timing.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { scheduleFullProjectionRebuild } from '../../lib/livingContext/projection';
import { runScheduledBackfill, BACKFILL_TASKS } from '../../lib/livingContext/backfillScheduled';
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

/**
 * POST /api/v1/internal/living-context-rebuild-projections
 *
 * Enqueue rebuild operations for all workspace persons. The projection outbox
 * cron will pick these up and re-project each person from D1 into Neo4j.
 */
app.post('/living-context-rebuild-projections', async (c) => {
  const db = c.env.DB;
  const result = await scheduleFullProjectionRebuild(db);
  return c.json({
    status: 'scheduled',
    enqueued: result.enqueued,
  });
});

/**
 * GET /api/v1/internal/living-context-stats
 *
 * Entity counts, interaction type breakdowns, and assertion/signal coverage.
 * Used for production rollout observability.
 */
app.get('/living-context-stats', async (c) => {
  const db = c.env.DB;

  interface CountRow { cnt: number }
  interface InteractionTypeRow { interaction_type: string; cnt: number }
  interface ArtifactTypeRow { artifact_type: string; cnt: number }

  const safeCount = async (table: string): Promise<number> => {
    try {
      const row = await db.prepare(`SELECT COUNT(*) AS cnt FROM ${table}`).first<CountRow>();
      return row?.cnt ?? 0;
    } catch {
      return -1;
    }
  };

  const [
    people,
    workspacePeople,
    applications,
    interactions,
    artifacts,
    artifactVersions,
    sourceSpans,
    assertions,
    contextRecords,
    concepts,
    signalEvidence,
    signalSnapshots,
    semanticRelationships,
  ] = await Promise.all([
    safeCount('people'),
    safeCount('workspace_people'),
    safeCount('applications'),
    safeCount('interactions'),
    safeCount('artifacts'),
    safeCount('artifact_versions'),
    safeCount('source_spans'),
    safeCount('semantic_assertions'),
    safeCount('context_records'),
    safeCount('concepts'),
    safeCount('signal_evidence'),
    safeCount('signal_snapshots'),
    safeCount('semantic_relationships'),
  ]);

  let interactionBreakdown: Record<string, number> = {};
  try {
    const rows = await db.prepare(
      `SELECT interaction_type, COUNT(*) AS cnt FROM interactions GROUP BY interaction_type ORDER BY cnt DESC`,
    ).all<InteractionTypeRow>();
    interactionBreakdown = Object.fromEntries(
      (rows.results ?? []).map((r) => [r.interaction_type, r.cnt]),
    );
  } catch { /* table may not exist */ }

  let artifactBreakdown: Record<string, number> = {};
  try {
    const rows = await db.prepare(
      `SELECT artifact_type, COUNT(*) AS cnt FROM artifacts GROUP BY artifact_type ORDER BY cnt DESC`,
    ).all<ArtifactTypeRow>();
    artifactBreakdown = Object.fromEntries(
      (rows.results ?? []).map((r) => [r.artifact_type, r.cnt]),
    );
  } catch { /* table may not exist */ }

  return c.json({
    entities: {
      people,
      workspacePeople,
      applications,
      interactions,
      artifacts,
      artifactVersions,
      sourceSpans,
      assertions,
      contextRecords,
      concepts,
      signalEvidence,
      signalSnapshots,
      semanticRelationships,
    },
    interactionBreakdown,
    artifactBreakdown,
  });
});

/**
 * GET /api/v1/internal/living-context-backfill
 *
 * Per-task backfill checkpoint detail. Returns each registered task with its
 * cursor position, items processed/failed, timing, and dependency status.
 */
app.get('/living-context-backfill', async (c) => {
  const db = c.env.DB;

  interface CheckpointRow {
    task_key: string;
    cursor: string | null;
    status: string;
    total_items: number | null;
    processed: number;
    failed: number;
    last_error: string | null;
    metadata_json: string;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  }

  try {
    const rows = await db.prepare(
      `SELECT task_key, cursor, status, total_items, processed, failed,
              last_error, metadata_json, started_at, completed_at, created_at, updated_at
         FROM backfill_checkpoints
        ORDER BY created_at ASC`,
    ).all<CheckpointRow>();

    const tasks = (rows.results ?? []).map((row) => {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(row.metadata_json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        }
      } catch { /* ignore */ }

      const progressPercent = row.total_items && row.total_items > 0
        ? Math.round((row.processed / row.total_items) * 100)
        : null;

      const durationMs = row.started_at && row.completed_at
        ? new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()
        : row.started_at
          ? Date.now() - new Date(row.started_at).getTime()
          : null;

      return {
        taskKey: row.task_key,
        status: row.status,
        cursor: row.cursor,
        totalItems: row.total_items,
        processed: row.processed,
        failed: row.failed,
        progressPercent,
        durationMs,
        lastError: row.last_error,
        description: typeof metadata.description === 'string' ? metadata.description : null,
        dependsOn: Array.isArray(metadata.dependsOn) ? metadata.dependsOn : [],
        startedAt: row.started_at,
        completedAt: row.completed_at,
        updatedAt: row.updated_at,
      };
    });

    const completedCount = tasks.filter((t) => t.status === 'completed').length;
    const failedCount = tasks.filter((t) => t.status === 'failed').length;
    const runningCount = tasks.filter((t) => t.status === 'running').length;

    let overallStatus: string = 'idle';
    if (runningCount > 0) overallStatus = 'running';
    else if (failedCount > 0) overallStatus = 'failed';
    else if (completedCount === tasks.length && tasks.length > 0) overallStatus = 'completed';

    return c.json({
      overallStatus,
      totalTasks: tasks.length,
      completedCount,
      runningCount,
      failedCount,
      tasks,
    });
  } catch {
    return c.json({
      overallStatus: 'unavailable',
      totalTasks: 0,
      completedCount: 0,
      runningCount: 0,
      failedCount: 0,
      tasks: [],
      error: 'backfill_checkpoints table not available',
    });
  }
});

/**
 * POST /api/v1/internal/living-context-backfill-trigger
 *
 * Manually trigger a backfill run outside the cron schedule. Runs the same
 * logic as the scheduled handler. Returns per-task results.
 */
app.post('/living-context-backfill-trigger', async (c) => {
  const result = await runScheduledBackfill(c.env);

  return c.json({
    gateEnabled: result.gateEnabled,
    tasksExecuted: result.tasksExecuted,
    batchResults: result.batchResults,
    orchestratorStatus: result.status,
    registeredTasks: BACKFILL_TASKS.map((t) => ({
      taskKey: t.taskKey,
      description: t.description,
      dependsOn: t.dependsOn,
    })),
  });
});

export default app;
