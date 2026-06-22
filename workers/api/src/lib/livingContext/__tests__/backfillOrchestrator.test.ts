/**
 * Backfill orchestrator proof test — acceptance criterion #8
 *
 * Proves:
 * - Orchestrator tracks status across all registered backfill tasks
 * - Starting a task creates a running checkpoint
 * - Advancing a task updates progress and completes on final batch
 * - Failed tasks record failure metadata
 * - Reset clears individual and all task checkpoints
 * - Overall status reflects combined task states
 * - Re-starting a running task is idempotent
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  getBackfillTasks,
  getBackfillTask,
  getOrchestratorStatus,
  startBackfillTask,
  advanceBackfillTask,
  failBackfillTask,
  resetBackfillTask,
  resetAllBackfillTasks,
} from '../backfillOrchestrator';

let sqlite: BetterSqliteDb;
let db: D1Database;

function applyMigrations(): void {
  const migrationsDir = resolve(__dirname, '../../../../migrations');
  const migrationFile = resolve(migrationsDir, '0095_backfill_checkpoints.sql');
  const sql = readFileSync(migrationFile, 'utf-8');
  sqlite.exec(sql);
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  db = createMockD1(sqlite);
  applyMigrations();
});

afterEach(() => {
  sqlite.close();
});

describe('backfill orchestrator — criterion #8', () => {
  it('provides registered backfill task definitions', () => {
    const tasks = getBackfillTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(4);
    for (const task of tasks) {
      expect(task.name).toBeTruthy();
      expect(task.description).toBeTruthy();
      expect(task.sourceQuery).toBeTruthy();
      expect(task.batchSize).toBeGreaterThan(0);
    }
  });

  it('looks up individual tasks by name', () => {
    const task = getBackfillTask('person-graph-contacts');
    expect(task).toBeDefined();
    expect(task!.name).toBe('person-graph-contacts');
    expect(getBackfillTask('nonexistent')).toBeUndefined();
  });

  it('reports idle status when no tasks have started', async () => {
    const status = await getOrchestratorStatus(db);
    expect(status.overallStatus).toBe('idle');
    expect(status.totalProcessed).toBe(0);
    for (const task of status.tasks) {
      expect(task.status).toBe('not_started');
      expect(task.checkpoint).toBeNull();
    }
  });

  it('starts a backfill task and creates a running checkpoint', async () => {
    const checkpoint = await startBackfillTask(db, 'person-graph-contacts', 200);
    expect(checkpoint.backfillName).toBe('person-graph-contacts');
    expect(checkpoint.status).toBe('running');
    expect(checkpoint.processedCount).toBe(0);
    expect(checkpoint.totalCount).toBe(200);
  });

  it('advances a task through batches and completes', async () => {
    await startBackfillTask(db, 'person-graph-contacts', 100);

    const after1 = await advanceBackfillTask(db, 'person-graph-contacts', {
      processedCount: 50,
      lastProcessedId: 'contact-50',
      hasMore: true,
    });
    expect(after1.status).toBe('running');
    expect(after1.processedCount).toBe(50);
    expect(after1.lastProcessedId).toBe('contact-50');

    const after2 = await advanceBackfillTask(db, 'person-graph-contacts', {
      processedCount: 50,
      lastProcessedId: 'contact-100',
      hasMore: false,
    });
    expect(after2.status).toBe('completed');
    expect(after2.processedCount).toBe(100);
    expect(after2.completedAt).not.toBeNull();
  });

  it('records failure with metadata', async () => {
    await startBackfillTask(db, 'repo-semantic-graph', 30);
    await advanceBackfillTask(db, 'repo-semantic-graph', {
      processedCount: 5,
      lastProcessedId: 'repo-5',
      hasMore: true,
    });

    await failBackfillTask(db, 'repo-semantic-graph', {
      error: 'Connection timeout',
      failedAt: 'repo-6',
    });

    const status = await getOrchestratorStatus(db);
    const task = status.tasks.find((t) => t.name === 'repo-semantic-graph');
    expect(task!.status).toBe('failed');
    expect(task!.checkpoint!.processedCount).toBe(5);
  });

  it('reset clears an individual task', async () => {
    await startBackfillTask(db, 'person-graph-contacts', 100);
    const removed = await resetBackfillTask(db, 'person-graph-contacts');
    expect(removed).toBe(true);

    const status = await getOrchestratorStatus(db);
    const task = status.tasks.find((t) => t.name === 'person-graph-contacts');
    expect(task!.status).toBe('not_started');
  });

  it('resetAll clears all task checkpoints', async () => {
    await startBackfillTask(db, 'person-graph-contacts', 100);
    await startBackfillTask(db, 'person-graph-candidates', 50);

    const cleared = await resetAllBackfillTasks(db);
    expect(cleared).toBe(2);

    const status = await getOrchestratorStatus(db);
    expect(status.overallStatus).toBe('idle');
  });

  it('reports partial status when only some tasks are started', async () => {
    await startBackfillTask(db, 'person-graph-contacts', 100);
    await advanceBackfillTask(db, 'person-graph-contacts', {
      processedCount: 100,
      lastProcessedId: 'contact-100',
      hasMore: false,
    });

    const status = await getOrchestratorStatus(db);
    expect(status.overallStatus).toBe('partial');
    expect(status.totalProcessed).toBe(100);
  });

  it('reports completed when all registered tasks are done', async () => {
    for (const task of getBackfillTasks()) {
      await startBackfillTask(db, task.name, 10);
      await advanceBackfillTask(db, task.name, {
        processedCount: 10,
        lastProcessedId: `${task.name}-10`,
        hasMore: false,
      });
    }

    const status = await getOrchestratorStatus(db);
    expect(status.overallStatus).toBe('completed');
    expect(status.totalRemaining).toBe(0);
  });

  it('reports failed status when any task has failed', async () => {
    await startBackfillTask(db, 'person-graph-contacts', 100);
    await failBackfillTask(db, 'person-graph-contacts');

    const status = await getOrchestratorStatus(db);
    expect(status.overallStatus).toBe('failed');
  });

  it('re-starting a running task is idempotent', async () => {
    const first = await startBackfillTask(db, 'person-graph-contacts', 100);
    await advanceBackfillTask(db, 'person-graph-contacts', {
      processedCount: 30,
      lastProcessedId: 'contact-30',
      hasMore: true,
    });

    const second = await startBackfillTask(db, 'person-graph-contacts', 100);
    expect(second.processedCount).toBe(30);
    expect(second.status).toBe('running');
  });

  it('rejects unknown task names', async () => {
    await expect(startBackfillTask(db, 'nonexistent')).rejects.toThrow('Unknown backfill task');
  });
});
