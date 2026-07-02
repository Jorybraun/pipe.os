import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { BackfillOrchestrator } from '../backfillOrchestrator';
import type { BackfillTaskDefinition } from '../backfillOrchestrator';

const checkpointMigration = readFileSync(
  new URL('../../../../migrations/0106_backfill_checkpoints.sql', import.meta.url),
  'utf8',
);

describe('BackfillOrchestrator', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(checkpointMigration);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  const TASKS: BackfillTaskDefinition[] = [
    { taskKey: 'identity', description: 'Backfill person identities', dependsOn: [] },
    { taskKey: 'interactions', description: 'Backfill interactions', dependsOn: ['identity'] },
    { taskKey: 'projections', description: 'Rebuild projections', dependsOn: ['interactions'] },
  ];

  it('creates checkpoint rows for all registered tasks', async () => {
    const orchestrator = new BackfillOrchestrator(db, TASKS);
    await orchestrator.ensureCheckpoints();

    const status = await orchestrator.getStatus();
    expect(status.totalCount).toBe(3);
    expect(status.completedCount).toBe(0);
    expect(status.overallStatus).toBe('idle');
    expect(status.tasks.map((t) => t.taskKey)).toEqual(['identity', 'interactions', 'projections']);
  });

  it('only marks tasks as ready when dependencies are met', async () => {
    const orchestrator = new BackfillOrchestrator(db, TASKS);
    await orchestrator.ensureCheckpoints();

    const readyTasks = await orchestrator.getReadyTasks();
    expect(readyTasks).toEqual(['identity']);
  });

  it('tracks task lifecycle: pending → running → completed', async () => {
    const orchestrator = new BackfillOrchestrator(db, TASKS);
    await orchestrator.ensureCheckpoints();

    await orchestrator.markRunning('identity', 100);
    let status = await orchestrator.getStatus();
    expect(status.overallStatus).toBe('running');
    expect(status.tasks.find((t) => t.taskKey === 'identity')?.status).toBe('running');

    await orchestrator.updateProgress('identity', 'cursor-50', 50, 0);
    status = await orchestrator.getStatus();
    const identityTask = status.tasks.find((t) => t.taskKey === 'identity');
    expect(identityTask?.processed).toBe(50);
    expect(identityTask?.cursor).toBe('cursor-50');

    await orchestrator.markCompleted('identity');
    status = await orchestrator.getStatus();
    expect(status.completedCount).toBe(1);
    expect(status.tasks.find((t) => t.taskKey === 'identity')?.status).toBe('completed');

    const nextReady = await orchestrator.getReadyTasks();
    expect(nextReady).toEqual(['interactions']);
  });

  it('records failures with error messages', async () => {
    const orchestrator = new BackfillOrchestrator(db, TASKS);
    await orchestrator.ensureCheckpoints();

    await orchestrator.markRunning('identity', 100);
    await orchestrator.markFailed('identity', 'Database connection timeout');

    const status = await orchestrator.getStatus();
    expect(status.overallStatus).toBe('failed');
    expect(status.failedCount).toBe(1);

    const identityTask = status.tasks.find((t) => t.taskKey === 'identity');
    expect(identityTask?.status).toBe('failed');
    expect(identityTask?.lastError).toBe('Database connection timeout');
  });

  it('returns partial batches to pending while preserving cursor and progress', async () => {
    const orchestrator = new BackfillOrchestrator(db, TASKS);
    await orchestrator.ensureCheckpoints();

    await orchestrator.markRunning('identity', 100);
    await orchestrator.updateProgress('identity', 'cursor-50', 50, 0);
    await orchestrator.markPending('identity');

    const status = await orchestrator.getStatus();
    const identityTask = status.tasks.find((t) => t.taskKey === 'identity');
    expect(identityTask?.status).toBe('pending');
    expect(identityTask?.processed).toBe(50);
    expect(identityTask?.cursor).toBe('cursor-50');
    expect(await orchestrator.getReadyTasks()).toEqual(['identity']);
  });

  it('recovers stale running tasks so crashed batches can retry', async () => {
    const orchestrator = new BackfillOrchestrator(db, TASKS);
    await orchestrator.ensureCheckpoints();

    await orchestrator.markRunning('identity', 100);
    await orchestrator.updateProgress('identity', 'cursor-25', 25, 0);
    sqlite.prepare(
      `UPDATE backfill_checkpoints
          SET updated_at = '2026-06-30 15:00:00'
        WHERE task_key = 'identity'`,
    ).run();

    await orchestrator.recoverStaleRunning('2026-06-30 15:30:00');

    const status = await orchestrator.getStatus();
    const identityTask = status.tasks.find((t) => t.taskKey === 'identity');
    expect(identityTask?.status).toBe('pending');
    expect(identityTask?.processed).toBe(25);
    expect(identityTask?.cursor).toBe('cursor-25');
    expect(await orchestrator.getReadyTasks()).toEqual(['identity']);
  });

  it('resets all tasks back to pending', async () => {
    const orchestrator = new BackfillOrchestrator(db, TASKS);
    await orchestrator.ensureCheckpoints();

    await orchestrator.markRunning('identity', 100);
    await orchestrator.markCompleted('identity');
    await orchestrator.reset();

    const status = await orchestrator.getStatus();
    expect(status.overallStatus).toBe('idle');
    expect(status.completedCount).toBe(0);
    expect(status.tasks.every((t) => t.status === 'pending')).toBe(true);
  });

  it('resets a single task back to pending', async () => {
    const orchestrator = new BackfillOrchestrator(db, TASKS);
    await orchestrator.ensureCheckpoints();

    await orchestrator.markRunning('identity', 100);
    await orchestrator.markFailed('identity', 'transient error');
    await orchestrator.resetTask('identity');

    const status = await orchestrator.getStatus();
    expect(status.tasks.find((t) => t.taskKey === 'identity')?.status).toBe('pending');
    expect(status.failedCount).toBe(0);
  });

  it('ensureCheckpoints is idempotent', async () => {
    const orchestrator = new BackfillOrchestrator(db, TASKS);
    await orchestrator.ensureCheckpoints();
    await orchestrator.ensureCheckpoints();

    const status = await orchestrator.getStatus();
    expect(status.totalCount).toBe(3);
  });

  it('reports completed when all tasks finish', async () => {
    const orchestrator = new BackfillOrchestrator(db, TASKS);
    await orchestrator.ensureCheckpoints();

    for (const task of TASKS) {
      await orchestrator.markRunning(task.taskKey);
      await orchestrator.markCompleted(task.taskKey);
    }

    const status = await orchestrator.getStatus();
    expect(status.overallStatus).toBe('completed');
    expect(status.completedCount).toBe(3);
  });
});
