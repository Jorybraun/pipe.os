import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { Env } from '../../../types';

const processPipelineCandidateIngestionRetries = vi.fn(async () => ({
  scanned: 2,
  queued: 2,
  skipped: 0,
  failed: 0,
}));

vi.mock('../../../lib/candidateDiscovery/staleWorkersAiRetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/candidateDiscovery/staleWorkersAiRetry')>();
  return {
    ...actual,
    processPipelineCandidateIngestionRetries,
  };
});

const { ingestion } = await import('../ingestion');

function createMockDb(pipelineExists: boolean): Env['DB'] {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => (pipelineExists ? { id: 'pipeline-1' } : null),
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
  } as unknown as Env['DB'];
}

function createApp(pipelineExists = true): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    // @ts-expect-error — tests inject Worker bindings directly.
    c.env = {
      DB: createMockDb(pipelineExists),
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'owner-1',
    };
    await next();
  });
  app.route('/', ingestion);
  return app;
}

describe('POST /:pipelineId/ingestion/retry-failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues source-backed retries for a recruiter-owned pipeline', async () => {
    const app = createApp();

    const res = await app.request('/pipeline-1/ingestion/retry-failed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 2 }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      result: {
        scanned: 2,
        queued: 2,
        skipped: 0,
        failed: 0,
      },
    });
    expect(processPipelineCandidateIngestionRetries).toHaveBeenCalledWith(
      expect.objectContaining({ DB: expect.any(Object) }),
      expect.objectContaining({
        pipelineId: 'pipeline-1',
        ownerId: 'owner-1',
        limit: 2,
      }),
    );
  });

  it('does not retry ingestion for a pipeline the recruiter cannot access', async () => {
    const app = createApp(false);

    const res = await app.request('/pipeline-1/ingestion/retry-failed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 2 }),
    });

    expect(res.status).toBe(404);
    expect(processPipelineCandidateIngestionRetries).not.toHaveBeenCalled();
  });
});
