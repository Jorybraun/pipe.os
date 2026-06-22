/**
 * Backfill orchestrator for living context re-ingestion.
 *
 * Coordinates multiple backfill tasks using checkpoint tracking.
 * Each backfill task processes a batch of source records, updating
 * its checkpoint after each batch so it can resume from where it
 * left off on restart.
 *
 * Acceptance criterion #8: deterministic, idempotent backfills.
 */

import {
  getCheckpoint,
  upsertCheckpoint,
  listCheckpoints,
  resetCheckpoint,
} from './backfillCheckpoint';
import type { BackfillCheckpoint, BackfillStatus } from './backfillCheckpoint';

export interface BackfillTaskDefinition {
  readonly name: string;
  readonly description: string;
  readonly sourceQuery: string;
  readonly batchSize: number;
}

export interface BackfillBatchResult {
  processedCount: number;
  lastProcessedId: string;
  hasMore: boolean;
}

export interface OrchestratorStatus {
  tasks: BackfillTaskStatus[];
  overallStatus: 'idle' | 'running' | 'completed' | 'failed' | 'partial';
  totalProcessed: number;
  totalRemaining: number | null;
}

export interface BackfillTaskStatus {
  name: string;
  description: string;
  checkpoint: BackfillCheckpoint | null;
  status: BackfillStatus | 'not_started';
}

const BACKFILL_TASKS: readonly BackfillTaskDefinition[] = [
  {
    name: 'person-graph-contacts',
    description: 'Re-ingest all contacts into the living person graph.',
    sourceQuery: `SELECT id FROM contacts WHERE id > ?1 ORDER BY id LIMIT ?2`,
    batchSize: 50,
  },
  {
    name: 'person-graph-candidates',
    description: 'Re-ingest all candidate applications into the person graph.',
    sourceQuery: `SELECT id FROM applications WHERE id > ?1 ORDER BY id LIMIT ?2`,
    batchSize: 50,
  },
  {
    name: 'repo-semantic-graph',
    description: 'Rebuild semantic graphs for all repositories.',
    sourceQuery: `SELECT id FROM repos WHERE id > ?1 ORDER BY id LIMIT ?2`,
    batchSize: 10,
  },
  {
    name: 'projection-outbox-rebuild',
    description: 'Requeue all projection outbox entries for Neo4j rebuild.',
    sourceQuery: `SELECT id FROM projection_outbox WHERE id > ?1 ORDER BY id LIMIT ?2`,
    batchSize: 100,
  },
] as const;

export function getBackfillTasks(): readonly BackfillTaskDefinition[] {
  return BACKFILL_TASKS;
}

export function getBackfillTask(name: string): BackfillTaskDefinition | undefined {
  return BACKFILL_TASKS.find((t) => t.name === name);
}

export async function getOrchestratorStatus(db: D1Database): Promise<OrchestratorStatus> {
  const checkpoints = await listCheckpoints(db);
  const checkpointByName = new Map(checkpoints.map((cp) => [cp.backfillName, cp]));

  const tasks: BackfillTaskStatus[] = BACKFILL_TASKS.map((task) => {
    const checkpoint = checkpointByName.get(task.name) ?? null;
    return {
      name: task.name,
      description: task.description,
      checkpoint,
      status: checkpoint?.status ?? 'not_started',
    };
  });

  let totalProcessed = 0;
  let totalRemaining: number | null = 0;
  let hasRunning = false;
  let hasFailed = false;
  let allCompleted = true;
  let anyStarted = false;

  for (const task of tasks) {
    if (task.checkpoint) {
      anyStarted = true;
      totalProcessed += task.checkpoint.processedCount;
      if (task.checkpoint.totalCount !== null) {
        totalRemaining = totalRemaining !== null
          ? totalRemaining + Math.max(0, task.checkpoint.totalCount - task.checkpoint.processedCount)
          : null;
      } else {
        totalRemaining = null;
      }
      if (task.checkpoint.status === 'running') hasRunning = true;
      if (task.checkpoint.status === 'failed') hasFailed = true;
      if (task.checkpoint.status !== 'completed') allCompleted = false;
    } else {
      allCompleted = false;
    }
  }

  let overallStatus: OrchestratorStatus['overallStatus'];
  if (!anyStarted) {
    overallStatus = 'idle';
  } else if (hasFailed) {
    overallStatus = 'failed';
  } else if (hasRunning) {
    overallStatus = 'running';
  } else if (allCompleted) {
    overallStatus = 'completed';
  } else {
    overallStatus = 'partial';
  }

  return { tasks, overallStatus, totalProcessed, totalRemaining };
}

export async function startBackfillTask(
  db: D1Database,
  taskName: string,
  totalCount?: number,
): Promise<BackfillCheckpoint> {
  const task = getBackfillTask(taskName);
  if (!task) throw new Error(`Unknown backfill task: ${taskName}`);

  const existing = await getCheckpoint(db, taskName);
  if (existing && existing.status === 'running') {
    return existing;
  }

  await upsertCheckpoint(db, taskName, '', 0, totalCount ?? null, 'running');
  const checkpoint = await getCheckpoint(db, taskName);
  if (!checkpoint) throw new Error(`Failed to create checkpoint for ${taskName}`);
  return checkpoint;
}

export async function advanceBackfillTask(
  db: D1Database,
  taskName: string,
  batch: BackfillBatchResult,
): Promise<BackfillCheckpoint> {
  const existing = await getCheckpoint(db, taskName);
  if (!existing) throw new Error(`No checkpoint found for ${taskName}`);

  const newProcessedCount = existing.processedCount + batch.processedCount;
  const newStatus: BackfillStatus = batch.hasMore ? 'running' : 'completed';

  await upsertCheckpoint(
    db,
    taskName,
    batch.lastProcessedId,
    newProcessedCount,
    existing.totalCount,
    newStatus,
  );

  const updated = await getCheckpoint(db, taskName);
  if (!updated) throw new Error(`Failed to update checkpoint for ${taskName}`);
  return updated;
}

export async function failBackfillTask(
  db: D1Database,
  taskName: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const existing = await getCheckpoint(db, taskName);
  if (!existing) throw new Error(`No checkpoint found for ${taskName}`);

  await upsertCheckpoint(
    db,
    taskName,
    existing.lastProcessedId,
    existing.processedCount,
    existing.totalCount,
    'failed',
    metadata,
  );
}

export async function resetBackfillTask(
  db: D1Database,
  taskName: string,
): Promise<boolean> {
  return resetCheckpoint(db, taskName);
}

export async function resetAllBackfillTasks(db: D1Database): Promise<number> {
  let count = 0;
  for (const task of BACKFILL_TASKS) {
    const removed = await resetCheckpoint(db, task.name);
    if (removed) count++;
  }
  return count;
}
