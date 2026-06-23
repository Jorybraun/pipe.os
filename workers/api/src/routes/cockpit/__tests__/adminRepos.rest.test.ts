import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env, Variables } from '../../../types';
import { adminRepos } from '../adminRepos';

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/', adminRepos);
  return app;
}

function createMockDb() {
  const countBind = vi.fn(() => ({
    first: vi.fn(async () => ({ total: 1 })),
  }));
  const listBind = vi.fn(() => ({
    all: vi.fn(async () => ({
      results: [{
        id: 7,
        full_name: 'pipe/source-backed-demo',
        github_url: 'https://github.com/pipe/source-backed-demo',
        primary_language: 'TypeScript',
        stars: 42,
        detected_domain: null,
        seniority_band: null,
        sloc: 1200,
        file_count: 12,
        mean_ccn: 2,
        pr_quality_score: 0.8,
        open_feature_issue_count: 0,
        open_pr_count: 0,
        has_ci: 1,
        has_tests: 1,
        test_framework: 'vitest',
        detected_stack_json: null,
        admin_status: 'approved',
        admin_reason: null,
        disqualified: 0,
        disqualified_reason: null,
        pass: 3,
        crawled_at: '2026-06-22T00:00:00Z',
        has_signals: 1,
        challenge_suitability_verdict: 'suitable',
        confidence_score: 0.9,
        confidence_verdict: 'high',
        top_skills_csv: null,
      }],
    })),
  }));
  const prepare = vi.fn((sql: string) => ({
    bind: sql.includes('COUNT(*)') ? countBind : listBind,
  }));

  return {
    db: { prepare } as unknown as D1Database,
    countBind,
    listBind,
  };
}

const baseEnv = {
  CLERK_SECRET_KEY: 'test',
  DEV_AUTH_BYPASS: 'true',
  DEV_BYPASS_USER_ID: 'owner-1',
} as unknown as Env;

describe('GET /repos', () => {
  it('honors pass=3 for the approved challenge repo bank', async () => {
    const { db, countBind, listBind } = createMockDb();
    const response = await createApp().request(
      '/repos?status=approved&pass=3&suitability=suitable&limit=12',
      {},
      { ...baseEnv, DB: db },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total: 1,
      repos: [{
        id: 7,
        github_url: 'https://github.com/pipe/source-backed-demo',
        pass: 3,
        challenge_suitability_verdict: 'suitable',
      }],
    });
    expect(countBind).toHaveBeenCalledWith('approved', 3, 'suitable');
    expect(listBind).toHaveBeenCalledWith('approved', 3, 'suitable', 12, 0);
  });
});

describe('GET /repos/lookup', () => {
  it('finds an exact crawler repo by GitHub URL for code review setup', async () => {
    const first = vi.fn(async () => ({
      id: 4128,
      full_name: 'mrousavy/react-native-vision-camera',
      github_url: 'https://github.com/mrousavy/react-native-vision-camera',
      primary_language: 'TypeScript',
      stars: 24000,
      admin_status: 'pending',
      disqualified: 0,
      pass: 2,
      challenge_suitability_verdict: 'suitable',
      confidence_score: 0.82,
      confidence_verdict: 'high',
    }));
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const response = await createApp().request(
      '/repos/lookup?repoUrl=https%3A%2F%2Fgithub.com%2Fmrousavy%2Freact-native-vision-camera.git&minPass=2&suitability=suitable',
      {},
      { ...baseEnv, DB: db },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      repo: {
        id: 4128,
        github_url: 'https://github.com/mrousavy/react-native-vision-camera',
        pass: 2,
        challenge_suitability_verdict: 'suitable',
      },
    });
    expect(bind).toHaveBeenCalledWith(
      'mrousavy/react-native-vision-camera',
      'https://github.com/mrousavy/react-native-vision-camera',
      2,
      'suitable',
    );
  });

  it('returns null when the exact repo is not in crawler evidence', async () => {
    const first = vi.fn(async () => null);
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const response = await createApp().request(
      '/repos/lookup?repoUrl=acme%2Fmissing&minPass=2&suitability=suitable',
      {},
      { ...baseEnv, DB: db },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ repo: null });
    expect(bind).toHaveBeenCalledWith(
      'acme/missing',
      'https://github.com/acme/missing',
      2,
      'suitable',
    );
  });

  it('rejects invalid lookup filters', async () => {
    const response = await createApp().request(
      '/repos/lookup?repoUrl=acme%2Fwidgets&minPass=banana',
      {},
      { ...baseEnv, DB: {} as D1Database },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid minPass filter.',
      },
    });
  });
});
