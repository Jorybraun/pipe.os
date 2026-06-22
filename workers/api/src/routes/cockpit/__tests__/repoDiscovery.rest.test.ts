import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env, Variables } from '../../../types';
import { repoDiscovery } from '../repoDiscovery';

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.env = {
      DB: {
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
