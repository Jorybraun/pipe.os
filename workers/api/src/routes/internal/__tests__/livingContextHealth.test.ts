import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import livingContextHealth from '../livingContextHealth';
import { Hono } from 'hono';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const checkpointMigration = readFileSync(
  new URL('../../../../migrations/0104_backfill_checkpoints.sql', import.meta.url),
  'utf8',
);
const gatesMigration = readFileSync(
  new URL('../../../../migrations/0105_rollout_gates.sql', import.meta.url),
  'utf8',
);

describe('GET /living-context-health', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
  });

  afterEach(() => {
    sqlite.close();
  });

  it('reports healthy when all tables exist', async () => {
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec('CREATE TABLE contacts (id TEXT PRIMARY KEY);');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-health', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { healthy: boolean; subsystems: Array<{ name: string; healthy: boolean }> };
    expect(body.healthy).toBe(true);
    expect(body.subsystems.find((s) => s.name === 'required_tables')?.healthy).toBe(true);
  });

  it('reports unhealthy when tables are missing', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-health', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { healthy: boolean; subsystems: Array<{ name: string; healthy: boolean }> };
    expect(body.healthy).toBe(false);
    expect(body.subsystems.find((s) => s.name === 'required_tables')?.healthy).toBe(false);
  });
});

describe('POST /living-context-rebuild-projections', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('enqueues rebuild jobs for all workspace persons', async () => {
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, created_at, updated_at)
      VALUES ('person-1', 'person:p1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, created_at, updated_at)
      VALUES ('person-2', 'person:p2', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, created_at, updated_at)
      VALUES ('wp-1', 'wp:1', 'ws-1', 'person-1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, created_at, updated_at)
      VALUES ('wp-2', 'wp:2', 'ws-1', 'person-2', datetime('now'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-rebuild-projections', {
      method: 'POST',
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; enqueued: number };
    expect(body.status).toBe('scheduled');
    expect(body.enqueued).toBe(2);

    const rows = sqlite.prepare(
      `SELECT aggregate_id, operation, status FROM projection_outbox WHERE operation = 'rebuild'`,
    ).all() as Array<{ aggregate_id: string; operation: string; status: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.aggregate_id).sort()).toEqual(['wp-1', 'wp-2']);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('returns zero when no workspace persons exist', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-rebuild-projections', {
      method: 'POST',
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; enqueued: number };
    expect(body.enqueued).toBe(0);
  });
});

describe('GET /living-context-stats', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec('CREATE TABLE contacts (id TEXT PRIMARY KEY);');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns entity counts and breakdowns for a populated graph', async () => {
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, created_at, updated_at)
      VALUES ('p-1', 'person:p1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, created_at, updated_at)
      VALUES ('wp-1', 'wp:1', 'ws-1', 'p-1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO interactions (id, ingestion_key, workspace_person_id, interaction_type, created_at, updated_at)
      VALUES ('i-1', 'int:1', 'wp-1', 'resume_upload', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO interactions (id, ingestion_key, workspace_person_id, interaction_type, created_at, updated_at)
      VALUES ('i-2', 'int:2', 'wp-1', 'meeting', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO artifacts (id, ingestion_key, interaction_id, artifact_type, created_at, updated_at)
      VALUES ('a-1', 'art:1', 'i-1', 'resume', datetime('now'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-stats', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      entities: Record<string, number>;
      interactionBreakdown: Record<string, number>;
      artifactBreakdown: Record<string, number>;
    };

    expect(body.entities.people).toBe(1);
    expect(body.entities.workspacePeople).toBe(1);
    expect(body.entities.interactions).toBe(2);
    expect(body.entities.artifacts).toBe(1);
    expect(body.interactionBreakdown).toEqual({
      resume_upload: 1,
      meeting: 1,
    });
    expect(body.artifactBreakdown).toEqual({ resume: 1 });
  });

  it('returns zero counts on empty graph', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-stats', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { entities: Record<string, number> };
    expect(body.entities.people).toBe(0);
    expect(body.entities.interactions).toBe(0);
  });
});

describe('GET /living-context-backfill', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(checkpointMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns per-task checkpoint detail', async () => {
    sqlite.exec(`
      INSERT INTO backfill_checkpoints (id, ingestion_key, task_key, status, processed, failed, metadata_json, created_at, updated_at)
      VALUES ('cp-1', 'backfill:candidates_to_living_context', 'candidates_to_living_context', 'completed', 42, 0,
              '{"description":"Backfill candidates","dependsOn":[]}',
              datetime('now', '-10 minutes'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO backfill_checkpoints (id, ingestion_key, task_key, status, processed, failed, total_items, metadata_json, started_at, created_at, updated_at)
      VALUES ('cp-2', 'backfill:resumes_to_living_context', 'resumes_to_living_context', 'running', 15, 2, 50,
              '{"description":"Backfill resumes","dependsOn":["candidates_to_living_context"]}',
              datetime('now', '-5 minutes'), datetime('now', '-5 minutes'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-backfill', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      overallStatus: string;
      totalTasks: number;
      completedCount: number;
      runningCount: number;
      failedCount: number;
      tasks: Array<{
        taskKey: string;
        status: string;
        processed: number;
        failed: number;
        progressPercent: number | null;
        description: string | null;
        dependsOn: string[];
      }>;
    };

    expect(body.overallStatus).toBe('running');
    expect(body.totalTasks).toBe(2);
    expect(body.completedCount).toBe(1);
    expect(body.runningCount).toBe(1);

    const candidatesTask = body.tasks.find((t) => t.taskKey === 'candidates_to_living_context');
    expect(candidatesTask?.status).toBe('completed');
    expect(candidatesTask?.processed).toBe(42);
    expect(candidatesTask?.dependsOn).toEqual([]);

    const resumesTask = body.tasks.find((t) => t.taskKey === 'resumes_to_living_context');
    expect(resumesTask?.status).toBe('running');
    expect(resumesTask?.processed).toBe(15);
    expect(resumesTask?.failed).toBe(2);
    expect(resumesTask?.progressPercent).toBe(30);
    expect(resumesTask?.dependsOn).toEqual(['candidates_to_living_context']);
  });

  it('returns unavailable when table does not exist', async () => {
    const emptySqlite = new Database(':memory:');
    const db = createMockD1(emptySqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-backfill', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { overallStatus: string; error: string };
    expect(body.overallStatus).toBe('unavailable');
    expect(body.error).toBeTruthy();

    emptySqlite.close();
  });
});
