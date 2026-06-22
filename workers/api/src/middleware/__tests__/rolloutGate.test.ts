import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireGate, isFeatureEnabled, _clearGateCache } from '../rolloutGate';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import type { Env } from '../../types';

describe('rolloutGate middleware', () => {
  it('allows request when gate is enabled', async () => {
    const app = new Hono();
    app.get('/test', requireGate('living_context_ingestion'), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 404 when gate is disabled', async () => {
    const app = new Hono();
    app.get('/test', requireGate('nonexistent_gate'), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string; message: string };
    expect(body.error).toBe('NOT_FOUND');
    expect(body.message).toContain('not currently available');
  });

  it('allows canary gates (canary is enabled)', async () => {
    const app = new Hono();
    app.get('/test', requireGate('contact_living_context'), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('allows internal_only gates (internal_only is enabled)', async () => {
    const app = new Hono();
    app.get('/test', requireGate('repo_overlay_visualization'), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('chains with other middleware', async () => {
    const app = new Hono();
    const order: string[] = [];

    const firstMiddleware = async (_c: unknown, next: () => Promise<void>): Promise<void> => {
      order.push('first');
      await next();
    };

    app.get('/test', firstMiddleware, requireGate('deterministic_matching'), (c) => {
      order.push('handler');
      return c.json({ ok: true });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(order).toEqual(['first', 'handler']);
  });
});

// --- D1-backed middleware tests ---

describe('rolloutGate middleware with D1', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  function applyMigrations(): void {
    const migrationsDir = resolve(__dirname, '../../../migrations');
    const sql = readFileSync(resolve(migrationsDir, '0096_rollout_gates.sql'), 'utf-8');
    sqlite.exec(sql);
  }

  beforeEach(() => {
    _clearGateCache();
    sqlite = new Database(':memory:');
    db = createMockD1(sqlite);
    applyMigrations();
  });

  afterEach(() => {
    _clearGateCache();
    sqlite.close();
  });

  function createAppWithD1(gateKey: string): Hono<{ Bindings: Env }> {
    const app = new Hono<{ Bindings: Env }>();
    app.get('/test', requireGate(gateKey), (c) => c.json({ ok: true }));
    return app;
  }

  it('reads gate state from D1 when DB binding is present', async () => {
    const app = createAppWithD1('living_context_ingestion');
    const res = await app.request('/test', {}, { DB: db } as unknown as Env);
    expect(res.status).toBe(200);
  });

  it('blocks request when D1 gate is disabled', async () => {
    sqlite.prepare(
      "UPDATE rollout_gates SET stage = 'disabled' WHERE gate_key = 'expert_labelled_evaluation'",
    ).run();

    const app = createAppWithD1('expert_labelled_evaluation');
    const res = await app.request('/test', {}, { DB: db } as unknown as Env);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });

  it('allows request after D1 gate is re-enabled', async () => {
    sqlite.prepare(
      "UPDATE rollout_gates SET stage = 'disabled' WHERE gate_key = 'expert_labelled_evaluation'",
    ).run();

    const app = createAppWithD1('expert_labelled_evaluation');

    const blocked = await app.request('/test', {}, { DB: db } as unknown as Env);
    expect(blocked.status).toBe(404);

    _clearGateCache();
    sqlite.prepare(
      "UPDATE rollout_gates SET stage = 'canary' WHERE gate_key = 'expert_labelled_evaluation'",
    ).run();

    const allowed = await app.request('/test', {}, { DB: db } as unknown as Env);
    expect(allowed.status).toBe(200);
  });

  it('uses cache on second request (no extra D1 query)', async () => {
    const app = createAppWithD1('living_context_ingestion');

    const res1 = await app.request('/test', {}, { DB: db } as unknown as Env);
    expect(res1.status).toBe(200);

    sqlite.prepare(
      "UPDATE rollout_gates SET stage = 'disabled' WHERE gate_key = 'living_context_ingestion'",
    ).run();

    const res2 = await app.request('/test', {}, { DB: db } as unknown as Env);
    expect(res2.status).toBe(200);
  });

  it('falls back to hardcoded defaults when D1 throws', async () => {
    const brokenDb = {
      prepare() {
        return {
          bind() { return this; },
          async first() { throw new Error('D1 unavailable'); },
          async all() { throw new Error('D1 unavailable'); },
          async run() { throw new Error('D1 unavailable'); },
        };
      },
    } as unknown as D1Database;

    const app = createAppWithD1('living_context_ingestion');
    const res = await app.request('/test', {}, { DB: brokenDb } as unknown as Env);
    expect(res.status).toBe(200);
  });

  it('falls back to hardcoded defaults when DB is undefined', async () => {
    const app = createAppWithD1('living_context_ingestion');
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });
});

describe('isFeatureEnabled', () => {
  it('returns true for GA gates', () => {
    expect(isFeatureEnabled('living_context_ingestion')).toBe(true);
    expect(isFeatureEnabled('deterministic_matching')).toBe(true);
    expect(isFeatureEnabled('repo_graph_backfill')).toBe(true);
  });

  it('returns true for canary gates', () => {
    expect(isFeatureEnabled('contact_living_context')).toBe(true);
    expect(isFeatureEnabled('match_explanation')).toBe(true);
  });

  it('returns true for internal_only gates', () => {
    expect(isFeatureEnabled('repo_overlay_visualization')).toBe(true);
    expect(isFeatureEnabled('expert_labelled_evaluation')).toBe(true);
  });

  it('returns false for unknown gates', () => {
    expect(isFeatureEnabled('does_not_exist')).toBe(false);
  });
});
