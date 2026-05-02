/**
 * Ingestion status route tests — SSE + JSON paths.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ingestionStatus } from '../ingestionStatus';
import type { Env } from '../../../types';

function createMockDB(row: Record<string, unknown> | null) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => row,
        all: async () => ({ results: row ? [row] : [] }),
      }),
    }),
  } as unknown as Env['DB'];
}

function createApp(row: Record<string, unknown> | null) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    // @ts-expect-error — override bindings in tests
    c.env = { DB: createMockDB(row), CLERK_SECRET_KEY: 'test' };
    await next();
  });
  app.route('/', ingestionStatus);
  return app;
}

describe('GET /:candidateId/ingestion-status (non-streaming)', () => {
  it('returns 404 when ingestion record is missing', async () => {
    const app = createApp(null);
    const res = await app.request('/123/ingestion-status', {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns the ingestion row as JSON', async () => {
    const app = createApp({
      status: 'pending',
      candidate_searchable_profile: 'profile',
      key_concepts_json: '[]',
      career_context_json: '{}',
      situation_signature_json: '{}',
      profile_version: '1',
      model_used: 'gpt-4',
      error_text: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });
    const res = await app.request('/123/ingestion-status', {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('pending');
  });
});

describe('GET /:candidateId/ingestion-status (SSE)', () => {
  it('emits status + done events for a terminal state and closes', async () => {
    const app = createApp({
      status: 'completed',
      candidate_searchable_profile: 'profile',
      key_concepts_json: '[]',
      career_context_json: '{}',
      situation_signature_json: '{}',
      profile_version: '1',
      model_used: 'gpt-4',
      error_text: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    const res = await app.request('/123/ingestion-status', {
      headers: { Accept: 'text/event-stream' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let statusCount = 0;
    let doneReceived = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          const eventName = line.replace('event: ', '').trim();
          if (eventName === 'status') statusCount++;
          if (eventName === 'done') doneReceived = true;
        }
      }

      if (doneReceived) break;
    }

    expect(statusCount).toBeGreaterThanOrEqual(1);
    expect(doneReceived).toBe(true);
  });

  it('emits error event when record is missing', async () => {
    const app = createApp(null);

    const res = await app.request('/123/ingestion-status', {
      headers: { Accept: 'text/event-stream' },
    });

    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let errorReceived = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          const eventName = line.replace('event: ', '').trim();
          if (eventName === 'error') errorReceived = true;
        }
      }

      if (errorReceived) break;
    }

    expect(errorReceived).toBe(true);
  });
});
