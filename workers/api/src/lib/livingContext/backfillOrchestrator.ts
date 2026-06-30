import { deterministicEntityId, stableJson } from './persistence';
import type { JsonValue } from './types';

export type BackfillTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface BackfillCheckpoint {
  id: string;
  taskKey: string;
  cursor: string | null;
  status: BackfillTaskStatus;
  totalItems: number | null;
  processed: number;
  failed: number;
  lastError: string | null;
  metadata: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackfillTaskDefinition {
  taskKey: string;
  description: string;
  dependsOn: string[];
}

interface CheckpointRow {
  id: string;
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

function parseCheckpoint(row: CheckpointRow): BackfillCheckpoint {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    taskKey: row.task_key,
    cursor: row.cursor,
    status: row.status as BackfillTaskStatus,
    totalItems: row.total_items,
    processed: row.processed,
    failed: row.failed,
    lastError: row.last_error,
    metadata,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface BackfillOrchestratorStatus {
  overallStatus: 'idle' | 'running' | 'completed' | 'failed';
  tasks: BackfillCheckpoint[];
  completedCount: number;
  totalCount: number;
  failedCount: number;
}

/**
 * Multi-task backfill orchestrator with checkpoint tracking.
 *
 * Tasks are registered with dependencies. The orchestrator ensures that a task
 * only runs after all its dependencies complete. Each task persists its cursor
 * in D1 so restarts resume from the last committed checkpoint.
 */
export class BackfillOrchestrator {
  constructor(
    private readonly db: D1Database,
    private readonly tasks: BackfillTaskDefinition[],
  ) {}

  async ensureCheckpoints(): Promise<void> {
    for (const task of this.tasks) {
      const ingestionKey = `backfill:${task.taskKey}`;
      const id = await deterministicEntityId('backfill_checkpoint', ingestionKey);
      await this.db.prepare(
        `INSERT INTO backfill_checkpoints (
           id, ingestion_key, task_key, status, metadata_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, 'pending', ?4, datetime('now'), datetime('now'))
         ON CONFLICT(ingestion_key) DO NOTHING`,
      ).bind(
        id,
        ingestionKey,
        task.taskKey,
        stableJson({ description: task.description, dependsOn: task.dependsOn } as unknown as JsonValue),
      ).run();
    }
  }

  async getStatus(): Promise<BackfillOrchestratorStatus> {
    const rows = await this.db.prepare(
      `SELECT id, task_key, cursor, status, total_items, processed, failed,
              last_error, metadata_json, started_at, completed_at, created_at, updated_at
         FROM backfill_checkpoints
        ORDER BY created_at ASC`,
    ).all<CheckpointRow>();

    const tasks = (rows.results ?? []).map(parseCheckpoint);
    const completedCount = tasks.filter((t) => t.status === 'completed').length;
    const failedCount = tasks.filter((t) => t.status === 'failed').length;
    const runningCount = tasks.filter((t) => t.status === 'running').length;

    let overallStatus: BackfillOrchestratorStatus['overallStatus'] = 'idle';
    if (runningCount > 0) overallStatus = 'running';
    else if (failedCount > 0) overallStatus = 'failed';
    else if (completedCount === tasks.length && tasks.length > 0) overallStatus = 'completed';

    return {
      overallStatus,
      tasks,
      completedCount,
      totalCount: tasks.length,
      failedCount,
    };
  }

  async getReadyTasks(): Promise<string[]> {
    const status = await this.getStatus();
    const completedKeys = new Set(
      status.tasks.filter((t) => t.status === 'completed').map((t) => t.taskKey),
    );
    const ready: string[] = [];
    for (const def of this.tasks) {
      const checkpoint = status.tasks.find((t) => t.taskKey === def.taskKey);
      if (!checkpoint || checkpoint.status !== 'pending') continue;
      const depsReady = def.dependsOn.every((dep) => completedKeys.has(dep));
      if (depsReady) ready.push(def.taskKey);
    }
    return ready;
  }

  async markRunning(taskKey: string, totalItems?: number): Promise<void> {
    await this.db.prepare(
      `UPDATE backfill_checkpoints
          SET status = 'running', total_items = ?2, started_at = datetime('now'), updated_at = datetime('now')
        WHERE task_key = ?1 AND status = 'pending'`,
    ).bind(taskKey, totalItems ?? null).run();
  }

  async updateProgress(taskKey: string, cursor: string, processed: number, failed: number): Promise<void> {
    await this.db.prepare(
      `UPDATE backfill_checkpoints
          SET cursor = ?2, processed = ?3, failed = ?4, updated_at = datetime('now')
        WHERE task_key = ?1 AND status = 'running'`,
    ).bind(taskKey, cursor, processed, failed).run();
  }

  async markCompleted(taskKey: string): Promise<void> {
    await this.db.prepare(
      `UPDATE backfill_checkpoints
          SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
        WHERE task_key = ?1 AND status = 'running'`,
    ).bind(taskKey).run();
  }

  async markPending(taskKey: string): Promise<void> {
    await this.db.prepare(
      `UPDATE backfill_checkpoints
          SET status = 'pending', updated_at = datetime('now')
        WHERE task_key = ?1 AND status = 'running'`,
    ).bind(taskKey).run();
  }

  async markFailed(taskKey: string, error: string): Promise<void> {
    await this.db.prepare(
      `UPDATE backfill_checkpoints
          SET status = 'failed', last_error = ?2, updated_at = datetime('now')
        WHERE task_key = ?1 AND status = 'running'`,
    ).bind(taskKey, error).run();
  }

  async reset(): Promise<void> {
    await this.db.prepare(
      `UPDATE backfill_checkpoints
          SET status = 'pending', cursor = NULL, processed = 0, failed = 0,
              last_error = NULL, started_at = NULL, completed_at = NULL,
              updated_at = datetime('now')`,
    ).run();
  }

  async resetTask(taskKey: string): Promise<void> {
    await this.db.prepare(
      `UPDATE backfill_checkpoints
          SET status = 'pending', cursor = NULL, processed = 0, failed = 0,
              last_error = NULL, started_at = NULL, completed_at = NULL,
              updated_at = datetime('now')
        WHERE task_key = ?1`,
    ).bind(taskKey).run();
  }
}
