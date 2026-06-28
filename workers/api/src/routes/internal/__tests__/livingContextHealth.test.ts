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
