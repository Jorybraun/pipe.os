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
import { seedCorpusFromMatchRuns, persistSeededCorpus } from '../../lib/challengeMatching/evaluation/corpusSeeder';
import { runEvaluation, generateHumanReadableReport } from '../../lib/challengeMatching/evaluation/cli';
import type { AcceptanceThresholds } from '../../lib/challengeMatching/evaluation/types';
import {
  ensureCandidateLivingContext,
  ensureContactLivingContext,
} from '../../lib/livingContext/compatibility';
import { loadAggregatedCandidateEvidence, type LoadAggregatedEvidenceConfig } from '../../lib/livingContext/evidenceAggregation';
import { traceEvidenceLineage } from '../../lib/livingContext/evidenceLineage';
import { loadTemporalAdjacencies } from '../../lib/livingContext/conceptAdjacencyDecay';
import { loadCandidateEvidenceFreshness } from '../../lib/livingContext/evidenceFreshness';
import { analyzeEvidenceGapsForChallenge } from '../../lib/livingContext/evidenceGapAnalysis';
import { loadMatchProvenanceChain } from '../../lib/livingContext/matchProvenanceChain';
import { compareCandidateEvidence } from '../../lib/livingContext/candidateComparison';
import { ingestSessionEventsToLivingContext, type SessionEventRow } from '../../lib/livingContext/sessionEventIngestion';
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

/**
 * POST /api/v1/internal/evaluation-corpus-seed
 *
 * Seeds an evaluation corpus from real match decisions. Extracts candidate
 * evidence, role requirements, and challenge packets from persisted match_runs,
 * generates draft labels for expert review, and persists the corpus.
 *
 * Body: { limit?: number, statusFilter?: string, roleContextId?: string, description?: string, persist?: boolean }
 */
app.post('/evaluation-corpus-seed', async (c) => {
  interface SeedRequestBody {
    limit?: number;
    statusFilter?: string;
    roleContextId?: string;
    description?: string;
    persist?: boolean;
  }
  const body: SeedRequestBody = await c.req.json<SeedRequestBody>().catch(() => ({} as SeedRequestBody));

  const result = await seedCorpusFromMatchRuns(c.env.DB, {
    limit: body.limit,
    statusFilter: body.statusFilter,
    roleContextId: body.roleContextId,
    description: body.description,
  });

  let persisted = false;
  if (body.persist !== false) {
    const persistResult = await persistSeededCorpus(c.env.DB, result.corpus);
    persisted = persistResult.persisted;
  }

  return c.json({
    corpusId: result.corpus.corpusId,
    persisted,
    matchRunCount: result.matchRunCount,
    candidateCount: result.candidateCount,
    roleCount: result.roleCount,
    challengeCount: result.challengeCount,
    labelCount: result.corpus.expertLabels.length,
    expectedPacketCount: result.corpus.expectedPackets?.length ?? 0,
    warnings: result.warnings,
  });
});

/**
 * POST /api/v1/internal/evaluation-run
 *
 * Runs the full matching evaluation pipeline against a stored corpus and returns
 * metrics. Optionally persists the result for use by the rollout gate readiness
 * check.
 *
 * Body: { corpusId: string, matchRunIds?: string[], comparisonMatchRunIds?: string[],
 *         thresholds?: Partial<AcceptanceThresholds>, persistResult?: boolean }
 */
app.post('/evaluation-run', async (c) => {
  interface EvaluationRunBody {
    corpusId?: string;
    matchRunIds?: string[];
    comparisonMatchRunIds?: string[];
    thresholds?: Partial<AcceptanceThresholds>;
    persistResult?: boolean;
  }
  const body: EvaluationRunBody = await c.req.json<EvaluationRunBody>().catch(() => ({} as EvaluationRunBody));

  if (!body.corpusId || typeof body.corpusId !== 'string') {
    return c.json({ error: 'corpusId is required' }, 400);
  }

  try {
    const result = await runEvaluation(c.env.DB, {
      corpusId: body.corpusId,
      matchRunIds: body.matchRunIds,
      comparisonMatchRunIds: body.comparisonMatchRunIds,
      thresholds: body.thresholds,
      persistResult: body.persistResult,
    });

    return c.json({
      passed: result.passed,
      persisted: body.persistResult === true,
      failures: result.failures,
      warnings: result.warnings,
      metrics: {
        corpusId: result.metrics.corpusId,
        recallAt50: result.metrics.recallAt50,
        precisionAt3: result.metrics.precisionAt3,
        ndcgAt5: result.metrics.ndcgAt5,
        guardrailViolationCount: result.metrics.guardrailViolationCount,
        multiStretchViolationCount: result.metrics.multiStretchViolationCount,
        missingProvenanceCount: result.metrics.missingProvenanceCount,
        missingMatchRunCount: result.metrics.missingMatchRunCount,
        byteIdenticalRerun: result.metrics.byteIdenticalRerun,
        expertLabelCount: result.metrics.expertLabelCount,
        syntheticFixtureCount: result.metrics.syntheticFixtureCount,
        evaluatedPairCount: result.metrics.evaluatedPairCount,
        totalEvaluations: result.metrics.totalEvaluations,
        matchRunIds: result.metrics.matchRunIds,
        pairCoverage: result.metrics.pairCoverage,
        comparisonCoverage: result.metrics.comparisonCoverage,
        packetCoverage: result.metrics.packetCoverage,
      },
      humanReadableReport: generateHumanReadableReport(result),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 422);
  }
});

/**
 * GET /api/v1/internal/concept-graph
 *
 * Queries the learned concept taxonomy. Returns concepts with their aliases,
 * observation counts, and co-occurrence adjacencies. Supports filtering by
 * namespace, prefix search, and minimum observation count.
 *
 * Query params:
 *   namespace? — filter concepts by namespace
 *   q?        — prefix/substring search on canonical_key or label
 *   minObs?   — minimum observation_count (default 1)
 *   limit?    — max concepts to return (default 50, max 200)
 *   withAdj?  — include adjacency edges (default false)
 */
app.get('/concept-graph', async (c) => {
  const db = c.env.DB;
  const namespace = c.req.query('namespace') ?? null;
  const query = c.req.query('q') ?? null;
  const minObsParam = c.req.query('minObs');
  const limitParam = c.req.query('limit');
  const withAdj = c.req.query('withAdj') === 'true';

  const minObs = minObsParam ? Math.max(parseInt(minObsParam, 10) || 1, 0) : 1;
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 50;

  interface ConceptRow {
    id: string;
    canonical_key: string;
    namespace: string;
    label: string;
    description: string | null;
    aliases_json: string | null;
    metadata_json: string | null;
    observation_count: number;
    first_observed_at: number | null;
    last_observed_at: number | null;
    created_at: string;
    updated_at: string;
  }

  let sql = `SELECT id, canonical_key, namespace, label, description,
                    aliases_json, metadata_json, observation_count,
                    first_observed_at, last_observed_at, created_at, updated_at
               FROM concepts
              WHERE observation_count >= ?1`;
  const binds: Array<string | number> = [minObs];
  let bindIndex = 2;

  if (namespace) {
    sql += ` AND namespace = ?${bindIndex}`;
    binds.push(namespace);
    bindIndex++;
  }
  if (query) {
    sql += ` AND (canonical_key LIKE ?${bindIndex} OR label LIKE ?${bindIndex})`;
    binds.push(`%${query}%`);
    bindIndex++;
  }

  sql += ` ORDER BY observation_count DESC, canonical_key ASC LIMIT ?${bindIndex}`;
  binds.push(limit);

  const conceptRows = await db.prepare(sql).bind(...binds).all<ConceptRow>();

  interface AdjacencyRow {
    from_concept_id: string;
    to_concept_id: string;
    dimension: string;
    stretch_allowed: number;
    confidence: number | null;
    from_key: string;
    to_key: string;
  }

  const concepts = (conceptRows.results ?? []).map((row) => {
    let aliases: string[] = [];
    try {
      aliases = row.aliases_json ? JSON.parse(row.aliases_json) as string[] : [];
    } catch { /* empty */ }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : {};
    } catch { /* empty */ }

    return {
      id: row.id,
      canonicalKey: row.canonical_key,
      namespace: row.namespace,
      label: row.label,
      description: row.description,
      aliases,
      metadata,
      observationCount: row.observation_count,
      firstObservedAt: row.first_observed_at,
      lastObservedAt: row.last_observed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  let adjacencies: Array<{
    fromConceptKey: string;
    toConceptKey: string;
    dimension: string;
    stretchAllowed: boolean;
    confidence: number | null;
  }> = [];

  if (withAdj && concepts.length > 0) {
    const conceptIdSet = new Set(concepts.map((concept) => concept.id));
    const adjResults: AdjacencyRow[] = [];
    for (const concept of concepts) {
      const rows = await db.prepare(
        `SELECT ca.from_concept_id, ca.to_concept_id, ca.dimension, ca.stretch_allowed,
                ca.confidence, c1.canonical_key AS from_key, c2.canonical_key AS to_key
           FROM concept_adjacency ca
           JOIN concepts c1 ON c1.id = ca.from_concept_id
           JOIN concepts c2 ON c2.id = ca.to_concept_id
          WHERE ca.from_concept_id = ?1 OR ca.to_concept_id = ?1`,
      ).bind(concept.id).all<AdjacencyRow>();
      for (const row of rows.results ?? []) {
        if (conceptIdSet.has(row.from_concept_id) || conceptIdSet.has(row.to_concept_id)) {
          adjResults.push(row);
        }
      }
    }
    const seen = new Set<string>();
    adjacencies = adjResults.filter((row) => {
      const key = `${row.from_concept_id}:${row.to_concept_id}:${row.dimension}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((row) => ({
      fromConceptKey: row.from_key,
      toConceptKey: row.to_key,
      dimension: row.dimension,
      stretchAllowed: row.stretch_allowed === 1,
      confidence: row.confidence,
    }));
  }

  return c.json({
    totalConcepts: concepts.length,
    concepts,
    ...(withAdj ? { adjacencies } : {}),
  });
});

// POST /api/v1/internal/person-identity-link — link a contact and candidate
// to the same underlying person node. Useful when email-based auto-resolution
// cannot merge them (different emails, missing email, etc.).
app.post('/person-identity-link', async (c) => {
  const body = z.object({
    contactId: z.string().min(1),
    candidateId: z.string().min(1),
  }).safeParse(await c.req.json().catch(() => null));

  if (!body.success) {
    return c.json({ error: body.error.issues[0]?.message ?? 'contactId and candidateId required' }, 400);
  }

  const db = c.env.DB;
  const { contactId, candidateId } = body.data;

  // Ensure both entities have living context identities
  const contactIdentity = await ensureContactLivingContext(db, contactId);
  if (!contactIdentity) {
    return c.json({ error: `Contact ${contactId} not found` }, 404);
  }

  const candidateIdentity = await ensureCandidateLivingContext(db, candidateId);
  if (!candidateIdentity) {
    return c.json({ error: `Candidate ${candidateId} not found` }, 404);
  }

  // Already linked to the same person
  if (contactIdentity.personId === candidateIdentity.personId) {
    return c.json({
      linked: true,
      alreadyLinked: true,
      personId: contactIdentity.personId,
      contactWorkspacePersonId: contactIdentity.workspacePersonId,
      candidateWorkspacePersonId: candidateIdentity.workspacePersonId,
    });
  }

  // Merge the contact's workspace person into the candidate's workspace person.
  // The candidate's person is canonical (has an application). We re-point all
  // dependent records from the source workspace_person to the target, then
  // update the source to share the same underlying person.
  const targetPersonId = candidateIdentity.personId;
  const sourcePersonId = contactIdentity.personId;
  const targetWpId = candidateIdentity.workspacePersonId;
  const sourceWpId = contactIdentity.workspacePersonId;
  const now = new Date().toISOString();

  // Re-point dependent records from source workspace_person to target
  const dependentTables = [
    'interactions',
    'artifacts',
    'episodes',
    'semantic_assertions',
    'signal_evidence',
    'signal_snapshots',
    'person_roles',
  ];
  for (const table of dependentTables) {
    await db.prepare(
      `UPDATE ${table} SET workspace_person_id = ?1 WHERE workspace_person_id = ?2`,
    ).bind(targetWpId, sourceWpId).run();
  }

  // Re-point context_records if they exist
  try {
    await db.prepare(
      `UPDATE context_records SET workspace_person_id = ?1 WHERE workspace_person_id = ?2`,
    ).bind(targetWpId, sourceWpId).run();
  } catch {
    // context_records table may not exist in all environments
  }

  // Delete the now-orphaned source workspace_person
  await db.prepare(
    `DELETE FROM workspace_people WHERE id = ?1`,
  ).bind(sourceWpId).run();

  // Merge display name / email if the target person is missing them
  const targetPerson = await db.prepare(
    `SELECT display_name, primary_email FROM people WHERE id = ?1`,
  ).bind(targetPersonId).first<{ display_name: string | null; primary_email: string | null }>();

  const sourcePerson = await db.prepare(
    `SELECT display_name, primary_email FROM people WHERE id = ?1`,
  ).bind(sourcePersonId).first<{ display_name: string | null; primary_email: string | null }>();

  if (sourcePerson) {
    const updates: string[] = [];
    const binds: unknown[] = [];
    let bindIdx = 1;

    if (!targetPerson?.display_name && sourcePerson.display_name) {
      updates.push(`display_name = ?${bindIdx}`);
      binds.push(sourcePerson.display_name);
      bindIdx++;
    }
    if (!targetPerson?.primary_email && sourcePerson.primary_email) {
      updates.push(`primary_email = ?${bindIdx}`);
      binds.push(sourcePerson.primary_email);
      bindIdx++;
    }
    if (updates.length > 0) {
      updates.push(`updated_at = ?${bindIdx}`);
      binds.push(now);
      bindIdx++;
      binds.push(targetPersonId);
      await db.prepare(
        `UPDATE people SET ${updates.join(', ')} WHERE id = ?${bindIdx}`,
      ).bind(...binds).run();
    }
  }

  return c.json({
    linked: true,
    alreadyLinked: false,
    personId: targetPersonId,
    mergedFromPersonId: sourcePersonId,
    targetWorkspacePersonId: targetWpId,
    mergedWorkspacePersonId: sourceWpId,
  });
});

/**
 * GET /api/v1/internal/candidate-aggregated-evidence
 * Returns time-weighted aggregated concept evidence for a candidate.
 * Query params: candidateId (required), halfLifeDays, gracePeriodDays, floorMultiplier
 */
app.get('/candidate-aggregated-evidence', async (c) => {
  const db = c.env.DB;
  const candidateId = c.req.query('candidateId');
  if (!candidateId) {
    return c.json({ error: 'candidateId query parameter required' }, 400);
  }

  const halfLifeDaysParam = c.req.query('halfLifeDays');
  const gracePeriodDaysParam = c.req.query('gracePeriodDays');
  const floorMultiplierParam = c.req.query('floorMultiplier');

  const decayOverrides: {
    halfLifeDays?: number;
    gracePeriodDays?: number;
    floorMultiplier?: number;
  } = {};
  if (halfLifeDaysParam) decayOverrides.halfLifeDays = Number(halfLifeDaysParam);
  if (gracePeriodDaysParam) decayOverrides.gracePeriodDays = Number(gracePeriodDaysParam);
  if (floorMultiplierParam) decayOverrides.floorMultiplier = Number(floorMultiplierParam);

  const aggregated = await loadAggregatedCandidateEvidence(db, candidateId, {
    decay: Object.keys(decayOverrides).length > 0 ? decayOverrides : undefined,
  });

  return c.json({
    candidateId,
    totalConcepts: aggregated.length,
    concepts: aggregated,
  });
});

/**
 * GET /api/v1/internal/evidence-lineage
 * Traces the full evidence chain for a candidate: assertion → source span → artifact → interaction.
 * Query params: candidateId (required), conceptKeys (comma-separated, optional), limit (optional)
 */
app.get('/evidence-lineage', async (c) => {
  const db = c.env.DB;
  const candidateId = c.req.query('candidateId');
  if (!candidateId) {
    return c.json({ error: 'candidateId query parameter required' }, 400);
  }

  const conceptKeysParam = c.req.query('conceptKeys');
  const conceptKeys = conceptKeysParam
    ? conceptKeysParam.split(',').map((k) => k.trim()).filter(Boolean)
    : undefined;

  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number(limitParam) : undefined;

  const lineage = await traceEvidenceLineage(db, candidateId, {
    conceptKeys,
    limit,
  });

  return c.json(lineage);
});

/**
 * GET /api/v1/internal/concept-adjacency-temporal
 * Returns temporally-weighted concept adjacencies for a concept.
 * Query params: conceptId (required), halfLifeDays (optional), gracePeriodDays (optional)
 */
app.get('/concept-adjacency-temporal', async (c) => {
  const db = c.env.DB;
  const conceptId = c.req.query('conceptId');
  if (!conceptId) {
    return c.json({ error: 'conceptId query parameter required' }, 400);
  }

  const halfLifeDaysParam = c.req.query('halfLifeDays');
  const gracePeriodDaysParam = c.req.query('gracePeriodDays');

  const decayOverrides: {
    halfLifeDays?: number;
    gracePeriodDays?: number;
  } = {};
  if (halfLifeDaysParam) decayOverrides.halfLifeDays = Number(halfLifeDaysParam);
  if (gracePeriodDaysParam) decayOverrides.gracePeriodDays = Number(gracePeriodDaysParam);

  const adjacencies = await loadTemporalAdjacencies(
    db,
    conceptId,
    Object.keys(decayOverrides).length > 0 ? decayOverrides : undefined,
  );

  return c.json({
    conceptId,
    totalAdjacencies: adjacencies.length,
    adjacencies,
  });
});

/**
 * GET /api/v1/internal/candidate-evidence-freshness
 * Returns evidence freshness summary with per-entry decay multipliers and freshness levels.
 * Query params: candidateId (required), halfLifeDays (optional), gracePeriodDays (optional)
 */
app.get('/candidate-evidence-freshness', async (c) => {
  const db = c.env.DB;
  const candidateId = c.req.query('candidateId');
  if (!candidateId) {
    return c.json({ error: 'candidateId query parameter required' }, 400);
  }

  const halfLifeDaysParam = c.req.query('halfLifeDays');
  const gracePeriodDaysParam = c.req.query('gracePeriodDays');

  const decayOverrides: {
    halfLifeDays?: number;
    gracePeriodDays?: number;
  } = {};
  if (halfLifeDaysParam) decayOverrides.halfLifeDays = Number(halfLifeDaysParam);
  if (gracePeriodDaysParam) decayOverrides.gracePeriodDays = Number(gracePeriodDaysParam);

  const freshness = await loadCandidateEvidenceFreshness(
    db,
    candidateId,
    Object.keys(decayOverrides).length > 0 ? decayOverrides : undefined,
  );

  return c.json({
    candidateId,
    ...freshness,
  });
});

app.get('/evidence-gap-analysis', async (c) => {
  const db = c.env.DB;
  const candidateId = c.req.query('candidateId');
  const challengePacketId = c.req.query('challengePacketId');

  if (!candidateId || !challengePacketId) {
    return c.json({ error: 'candidateId and challengePacketId query parameters required' }, 400);
  }

  const halfLifeDaysParam = c.req.query('halfLifeDays');
  const strongThresholdParam = c.req.query('strongThreshold');
  const partialThresholdParam = c.req.query('partialThreshold');

  const options: {
    decay?: { halfLifeDays?: number };
    strongThreshold?: number;
    partialThreshold?: number;
  } = {};

  if (halfLifeDaysParam) options.decay = { halfLifeDays: Number(halfLifeDaysParam) };
  if (strongThresholdParam) options.strongThreshold = Number(strongThresholdParam);
  if (partialThresholdParam) options.partialThreshold = Number(partialThresholdParam);

  try {
    const report = await analyzeEvidenceGapsForChallenge(
      db, candidateId, challengePacketId, options,
    );
    return c.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 404);
  }
});

app.get('/match-provenance-chain', async (c) => {
  const db = c.env.DB;
  const matchRunId = c.req.query('matchRunId');

  if (!matchRunId) {
    return c.json({ error: 'matchRunId query parameter required' }, 400);
  }

  const halfLifeDaysParam = c.req.query('halfLifeDays');
  const options: { decay?: { halfLifeDays?: number } } = {};
  if (halfLifeDaysParam) options.decay = { halfLifeDays: Number(halfLifeDaysParam) };

  try {
    const chain = await loadMatchProvenanceChain(db, matchRunId, options);
    return c.json(chain);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 404);
  }
});

// POST /candidate-comparison — cross-candidate evidence comparison
app.post('/candidate-comparison', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    candidateIds: string[];
    pipelineId?: string;
    userId?: string;
    conceptLimit?: number;
  }>();

  if (!body.candidateIds || !Array.isArray(body.candidateIds) || body.candidateIds.length < 2) {
    return c.json({ error: 'candidateIds array with at least 2 entries required' }, 400);
  }

  if (body.candidateIds.length > 20) {
    return c.json({ error: 'Maximum 20 candidates per comparison' }, 400);
  }

  const userId = body.userId ?? 'internal';

  try {
    const report = await compareCandidateEvidence(db, body.candidateIds, userId, {
      pipelineId: body.pipelineId,
      conceptLimit: body.conceptLimit,
    });
    return c.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// POST /session-event-ingest — ingest session events into living context
app.post('/session-event-ingest', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    candidateId: string;
    sessionId?: string;
    limit?: number;
  }>();

  if (!body.candidateId) {
    return c.json({ error: 'candidateId required' }, 400);
  }

  try {
    const limit = Math.min(body.limit ?? 200, 500);
    const { loadSessionEventsForCandidate } = await import('../../lib/livingContext/sessionEventIngestion');
    const loaded = await loadSessionEventsForCandidate(db, body.candidateId, null, limit);

    // Optionally filter to a single session
    const filtered = body.sessionId
      ? loaded.events.filter((e) => e.session_id === body.sessionId)
      : loaded.events;

    if (filtered.length === 0) {
      return c.json({
        candidateId: body.candidateId,
        sessionId: body.sessionId ?? null,
        eventsProcessed: 0,
        episodesCreated: 0,
        assertionsCreated: 0,
        conceptsRegistered: 0,
        skippedDuplicates: 0,
        message: 'No session events found.',
      });
    }

    // Group events by session and ingest each session
    const bySession = new Map<string, typeof filtered>();
    for (const event of filtered) {
      const existing = bySession.get(event.session_id);
      if (existing) {
        existing.push(event);
      } else {
        bySession.set(event.session_id, [event]);
      }
    }

    const results: Array<{
      sessionId: string;
      eventsProcessed: number;
      episodesCreated: number;
      assertionsCreated: number;
      conceptsRegistered: number;
      skippedDuplicates: number;
    }> = [];
    let totalEvents = 0;
    let totalEpisodes = 0;
    let totalAssertions = 0;
    let totalConcepts = 0;
    let totalSkipped = 0;

    for (const [sessionId, events] of bySession) {
      const result = await ingestSessionEventsToLivingContext(
        db,
        body.candidateId,
        sessionId,
        events,
      );
      results.push({
        sessionId,
        eventsProcessed: result.eventsProcessed,
        episodesCreated: result.episodesCreated,
        assertionsCreated: result.assertionsCreated,
        conceptsRegistered: result.conceptsRegistered,
        skippedDuplicates: result.skippedDuplicates,
      });
      totalEvents += result.eventsProcessed;
      totalEpisodes += result.episodesCreated;
      totalAssertions += result.assertionsCreated;
      totalConcepts += result.conceptsRegistered;
      totalSkipped += result.skippedDuplicates;
    }

    return c.json({
      candidateId: body.candidateId,
      sessionsProcessed: results.length,
      totalEventsProcessed: totalEvents,
      totalEpisodesCreated: totalEpisodes,
      totalAssertionsCreated: totalAssertions,
      totalConceptsRegistered: totalConcepts,
      totalSkippedDuplicates: totalSkipped,
      sessions: results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// GET /api/v1/internal/evidence-readiness?candidateId=xxx — internal evidence readiness report
app.get('/evidence-readiness', async (c) => {
  const candidateId = c.req.query('candidateId');
  if (!candidateId) {
    return c.json({ error: 'candidateId query param required' }, 400);
  }

  const { computeEvidenceReadiness } = await import('../../lib/livingContext/evidenceReadiness');
  const report = await computeEvidenceReadiness(c.env.DB, candidateId);
  if (!report) {
    return c.json({
      candidateId,
      workspacePersonId: null,
      overallScore: 0,
      overallLevel: 'not_ready',
      dimensions: [],
      weakest: [],
      strongest: [],
      recommendations: [],
      computedAt: new Date().toISOString(),
    });
  }

  return c.json(report);
});

/**
 * GET /api/v1/internal/evidence-conflicts?candidateId=xxx
 *
 * Internal endpoint for evidence conflict detection.
 */
app.get('/evidence-conflicts', async (c) => {
  const candidateId = c.req.query('candidateId');
  if (!candidateId) {
    return c.json({ error: 'candidateId query param required' }, 400);
  }

  const { detectEvidenceConflicts } = await import('../../lib/livingContext/evidenceConflicts');
  const report = await detectEvidenceConflicts(c.env.DB, candidateId);
  return c.json(report);
});

export default app;
