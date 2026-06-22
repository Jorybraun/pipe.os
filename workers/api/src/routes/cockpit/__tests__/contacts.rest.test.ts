import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { contacts } from '../contacts';
import type { Env } from '../../../types';

function createMockDB() {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('SELECT id FROM contacts')) return { id: 'contact-1' };
              if (sql.includes('FROM workspace_people wp')) return null;
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as Env['DB'];
}

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    // @ts-expect-error override bindings in route tests
    c.env = {
      DB: createMockDB(),
      CLERK_SECRET_KEY: 'test',
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'test-user',
    };
    await next();
  });
  app.route('/', contacts);
  return app;
}

describe('GET /:id/living-context', () => {
  it('returns an empty read-model-shaped graph for contacts without context yet', async () => {
    const response = await createApp().request('/contact-1/living-context');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      person: null,
      summary: {
        interactionCount: 0,
        artifactCount: 0,
        contextRecordCount: 0,
        assertionCount: 0,
        signalCount: 0,
        sourceSpanCount: 0,
      },
      interactions: [],
      artifacts: [],
      contextRecords: [],
      assertions: [],
      signals: [],
      relationships: [],
    });
  });
});
