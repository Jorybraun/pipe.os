import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env, Variables } from '../../../types';
import { repoDiscovery } from '../repoDiscovery';

function buildCtx(): { ctx: ExecutionContext; waitUntilAll: () => Promise<void> } {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        promises.push(promise);
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    waitUntilAll: async () => {
      await Promise.all(promises);
    },
  };
}

function createApp(db?: D1Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.env = {
      DB: db ?? {
        prepare: () => {
          throw new Error('DB should not be touched for disabled skill-only discovery');
        },
      },
      CLERK_SECRET_KEY: 'test',
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'test-user',
    } as unknown as Env;
    await next();
  });
  app.route('/', repoDiscovery);
  return app;
}

function createSourceBackedDiscoveryDb(options: { hasSimpleJdContext?: boolean } = {}) {
  const hasSimpleJdContext = options.hasSimpleJdContext ?? true;
  const seenSql: string[] = [];

  const db = {
    prepare: vi.fn((sql: string) => {
      seenSql.push(sql);
      const normalized = sql.replace(/\s+/g, ' ');
      const stmt = {
        bind: vi.fn(() => stmt),
        first: vi.fn(async () => {
          if (normalized.includes('SELECT id, owner_id FROM pipelines')) {
            return { id: 'pipe-1', owner_id: 'test-user' };
          }
          if (normalized.includes('FROM role_contexts')) {
            return {
              id: 'role-context-simple-jd',
              rcd_json: null,
              persona_json: null,
              non_negotiable_skills_json: JSON.stringify(['Kafka', 'order processing']),
              validation_metadata: JSON.stringify({
                source: 'simple_job_description',
                selectedTermsPersisted: ['Kafka', 'order processing'],
              }),
            };
          }
          if (normalized.includes('FROM context_records cr')
            && normalized.includes('context_record_source_refs')
            && normalized.includes("cr.record_type = 'simple_job_description'")) {
            return hasSimpleJdContext ? { id: 'context-record-simple-jd' } : null;
          }
          if (normalized.includes('INSERT INTO discovery_jobs')) {
            return { id: 'discovery-job-1' };
          }
          if (normalized.includes('SELECT qr.primary_language')) {
            return null;
          }
          return null;
        }),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ success: true })),
      };
      return stmt;
    }),
  } as unknown as D1Database;

  return { db, seenSql };
}

describe('POST /discover-by-skills', () => {
  it('rejects legacy skill-only discovery before creating a job', async () => {
    const response = await createApp().request('/discover-by-skills', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skills: ['Kafka', 'Node.js'] }),
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'SOURCE_BACKED_CONTEXT_REQUIRED',
        message: expect.stringContaining('Skill-only repository discovery is disabled'),
      },
    });
  });
});

describe('POST /discover', () => {
  it('starts discovery from a source-backed simple JD without requiring role discovery', async () => {
    const { db, seenSql } = createSourceBackedDiscoveryDb();
    const { ctx, waitUntilAll } = buildCtx();
    const response = await createApp(db).request('/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pipelineId: 'pipe-1' }),
    }, undefined, ctx);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      jobId: 'discovery-job-1',
      status: 'PENDING',
    });
    expect(seenSql.some((sql) => sql.includes('context_record_source_refs'))).toBe(true);

    await waitUntilAll();
  });

  it('rejects a simple JD when selected terms have no source-backed context record', async () => {
    const { db, seenSql } = createSourceBackedDiscoveryDb({ hasSimpleJdContext: false });
    const { ctx } = buildCtx();
    const response = await createApp(db).request('/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pipelineId: 'pipe-1' }),
    }, undefined, ctx);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: expect.stringContaining('source-backed role context'),
      },
    });
    expect(seenSql.some((sql) => sql.includes('context_record_source_refs'))).toBe(true);
    expect(seenSql.some((sql) => sql.includes('INSERT INTO discovery_jobs'))).toBe(false);
  });
});
