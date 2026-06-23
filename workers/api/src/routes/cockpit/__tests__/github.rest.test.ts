import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env, Variables } from '../../../types';
import { github } from '../github';

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/', github);
  return app;
}

const env = {
  CLERK_SECRET_KEY: 'test',
  DEV_AUTH_BYPASS: 'true',
  DEV_BYPASS_USER_ID: 'owner-1',
  GITHUB_TOKEN: 'github-token',
} as unknown as Env;

describe('GET /pulls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns only merged pull requests when requested for review challenge selection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        'https://api.github.com/repos/acme/widgets/pulls?state=closed&sort=updated&direction=desc&per_page=50',
      );
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer github-token');
      return new Response(JSON.stringify([
        {
          number: 42,
          title: 'Fix order retry state',
          body: 'Adds deterministic retry handling.',
          user: { login: 'ada', avatar_url: 'https://example.com/ada.png' },
          state: 'closed',
          draft: false,
          created_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-02T00:00:00Z',
          merged_at: '2026-06-02T01:00:00Z',
          html_url: 'https://github.com/acme/widgets/pull/42',
          labels: [{ name: 'bug' }],
          base: { ref: 'main' },
          head: { ref: 'retry-fix' },
        },
        {
          number: 41,
          title: 'Abandoned experiment',
          body: null,
          user: { login: 'grace', avatar_url: 'https://example.com/grace.png' },
          state: 'closed',
          draft: false,
          created_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-01T02:00:00Z',
          merged_at: null,
          html_url: 'https://github.com/acme/widgets/pull/41',
          labels: [],
          base: { ref: 'main' },
          head: { ref: 'experiment' },
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const response = await createApp().request(
      '/pulls?repoUrl=https%3A%2F%2Fgithub.com%2Facme%2Fwidgets&state=closed&merged=true',
      {},
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        prs: [{
          number: 42,
          title: 'Fix order retry state',
          description: 'Adds deterministic retry handling.',
          author: 'ada',
          avatar: 'https://example.com/ada.png',
          state: 'merged',
          draft: false,
          createdAt: '2026-06-01T00:00:00Z',
          updatedAt: '2026-06-02T00:00:00Z',
          mergedAt: '2026-06-02T01:00:00Z',
          htmlUrl: 'https://github.com/acme/widgets/pull/42',
          labels: ['bug'],
          baseBranch: 'main',
          featureBranch: 'retry-fix',
        }],
      },
    });
  });

  it('rejects invalid pull request list query options', async () => {
    const response = await createApp().request(
      '/pulls?repoUrl=https%3A%2F%2Fgithub.com%2Facme%2Fwidgets&state=garbage',
      {},
      env,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid GitHub pull request query.',
      },
    });
  });
});
