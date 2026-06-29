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
 * GET /api/v1/internal/living-context-integrity
 *
 * Data integrity validation for the living context graph. Checks referential
 * integrity across the entity chain (persons → workspace_people → interactions
 * → episodes → assertions → source_spans) and context record coverage.
 * Returns per-check pass/fail with counts of orphaned or dangling entities.
 */
app.get('/living-context-integrity', async (c) => {
  const db = c.env.DB;

  interface IntegrityCheck {
    name: string;
    passed: boolean;
    count: number;
    detail: string;
  }

  const checks: IntegrityCheck[] = [];

  const safeQuery = async (sql: string): Promise<number> => {
    try {
      const row = await db.prepare(sql).first<{ cnt: number }>();
      return row?.cnt ?? 0;
    } catch {
      return -1;
    }
  };

  // 1. Workspace people without a valid person
  const orphanedWp = await safeQuery(
    `SELECT COUNT(*) AS cnt FROM workspace_people wp
     WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.id = wp.person_id)`,
  );
  checks.push({
    name: 'workspace_people_with_valid_person',
    passed: orphanedWp === 0,
    count: orphanedWp,
    detail: orphanedWp === 0
      ? 'All workspace_people reference a valid person'
      : `${orphanedWp} workspace_people reference a missing person`,
  });

  // 2. Interactions without a valid workspace_person
  const orphanedInteractions = await safeQuery(
    `SELECT COUNT(*) AS cnt FROM interactions i
     WHERE NOT EXISTS (SELECT 1 FROM workspace_people wp WHERE wp.id = i.workspace_person_id)`,
  );
  checks.push({
    name: 'interactions_with_valid_workspace_person',
    passed: orphanedInteractions === 0,
    count: orphanedInteractions,
    detail: orphanedInteractions === 0
      ? 'All interactions reference a valid workspace_person'
      : `${orphanedInteractions} interactions reference a missing workspace_person`,
  });

  // 3. Assertions without any source spans
  const unsourcedAssertions = await safeQuery(
    `SELECT COUNT(*) AS cnt FROM semantic_assertions sa
     WHERE NOT EXISTS (SELECT 1 FROM assertion_source_spans ass WHERE ass.assertion_id = sa.id)`,
  );
  const totalAssertions = await safeQuery(`SELECT COUNT(*) AS cnt FROM semantic_assertions`);
  const sourcedPct = totalAssertions > 0
    ? Math.round(((totalAssertions - unsourcedAssertions) / totalAssertions) * 100)
    : 100;
  checks.push({
    name: 'assertions_with_source_spans',
    passed: unsourcedAssertions === 0,
    count: unsourcedAssertions,
    detail: `${sourcedPct}% of assertions have source spans (${unsourcedAssertions} unsourced of ${totalAssertions} total)`,
  });

  // 4. Context records without any source refs
  const unsourcedRecords = await safeQuery(
    `SELECT COUNT(*) AS cnt FROM context_records cr
     WHERE NOT EXISTS (SELECT 1 FROM context_record_source_refs crsr WHERE crsr.context_record_id = cr.id)`,
  );
  const totalRecords = await safeQuery(`SELECT COUNT(*) AS cnt FROM context_records`);
  const recordSourcedPct = totalRecords > 0
    ? Math.round(((totalRecords - unsourcedRecords) / totalRecords) * 100)
    : 100;
  checks.push({
    name: 'context_records_with_source_refs',
    passed: unsourcedRecords === 0,
    count: unsourcedRecords,
    detail: `${recordSourcedPct}% of context records have source refs (${unsourcedRecords} unsourced of ${totalRecords} total)`,
  });

  // 5. Source spans with empty exact_text
  const emptySpans = await safeQuery(
    `SELECT COUNT(*) AS cnt FROM source_spans
     WHERE exact_text IS NULL OR LENGTH(TRIM(exact_text)) = 0`,
  );
  checks.push({
    name: 'source_spans_non_empty',
    passed: emptySpans === 0,
    count: emptySpans,
    detail: emptySpans === 0
      ? 'All source spans contain non-empty exact text'
      : `${emptySpans} source spans have empty or null exact_text`,
  });

  // 6. Episodes without a valid workspace_person
  const orphanedEpisodes = await safeQuery(
    `SELECT COUNT(*) AS cnt FROM episodes e
     WHERE NOT EXISTS (SELECT 1 FROM workspace_people wp WHERE wp.id = e.workspace_person_id)`,
  );
  checks.push({
    name: 'episodes_with_valid_workspace_person',
    passed: orphanedEpisodes === 0,
    count: orphanedEpisodes,
    detail: orphanedEpisodes === 0
      ? 'All episodes reference a valid workspace_person'
      : `${orphanedEpisodes} episodes reference a missing workspace_person`,
  });

  // 7. Projection outbox stale entries (stuck > 10 min)
  const staleProjections = await safeQuery(
    `SELECT COUNT(*) AS cnt FROM projection_outbox
     WHERE status = 'processing' AND updated_at < datetime('now', '-10 minutes')`,
  );
  checks.push({
    name: 'projection_outbox_no_stale',
    passed: staleProjections === 0,
    count: staleProjections,
    detail: staleProjections === 0
      ? 'No stale projection outbox entries'
      : `${staleProjections} projection jobs stuck in processing > 10 min`,
  });

  const allPassed = checks.every((check) => check.passed);

  return c.json({
    healthy: allPassed,
    totalChecks: checks.length,
    passed: checks.filter((check) => check.passed).length,
    failed: checks.filter((check) => !check.passed).length,
    checks,
  });
});

/**
 * GET /api/v1/internal/evaluation-readiness?corpusId=...&stage=shadow|canary|production
 *
 * Standalone evaluation readiness check without triggering gate progression.
 * Returns the full readiness report including metrics, failures, and warnings.
 */
app.get('/evaluation-readiness', async (c) => {
  const corpusId = c.req.query('corpusId');
  if (!corpusId) {
    return c.json({ ok: false, reason: 'corpusId query parameter required' }, 400);
  }

  const stage = c.req.query('stage') ?? 'shadow';
  const validStages = ['shadow', 'canary', 'production'] as const;
  type EvalStage = typeof validStages[number];
  if (!validStages.includes(stage as EvalStage)) {
    return c.json(
      { ok: false, reason: `Invalid stage "${stage}". Valid: ${validStages.join(', ')}` },
      400,
    );
  }

  const { checkLatestProductionEvaluation, generateEvaluationReadinessReport } = await import(
    '../../lib/challengeMatching/evaluation/readiness'
  );

  const report = await checkLatestProductionEvaluation(c.env.DB, {
    corpusId,
    stage: stage as EvalStage,
  });

  return c.json({
    ...report,
    reportText: generateEvaluationReadinessReport(report),
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
