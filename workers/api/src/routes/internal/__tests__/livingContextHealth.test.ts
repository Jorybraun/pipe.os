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
