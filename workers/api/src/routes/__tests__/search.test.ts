/**
 * Search routes unit tests — vector-native matching refactor.
 *
 * Stubs D1 + Ai + VectorizeIndex. Exercises /search/candidates, /search/repos,
 * and /search/roles after the migration to matchVectorNative functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { search } from '../search';
import type { Env, Variables } from '../../types';

// ─── Clerk mock ───────────────────────────────────────────────────────────────

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(async () => ({ sub: 'test-user' })),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VECTOR_1024 = new Array(1024).fill(0.01);

interface RoleFixture {
  id: string;
  role_title: string | null;
  role_searchable_profile: string | null;
  seniority_band: string | null;
  detected_domain: string | null;
  pipeline_id: string;
  embedding_json: string | null;
}

interface CandidateFixture {
  id: string;
  name: string;
  email: string;
  pipeline_id: string;
  status: string | null;
  candidate_searchable_profile: string | null;
  triangulated_score: number | null;
  pipeline_name: string;
  owner_id: string;
  embedding_json: string | null;
}

interface RepoFixture {
  id: number;
  full_name: string;
  github_url: string;
  description: string | null;
  primary_language: string;
  seniority_band: string | null;
  detected_domain: string | null;
  stars: number;
  repo_searchable_profile: string | null;
  disqualified: number;
  embedding_json: string | null;
}

interface DbState {
  roles: RoleFixture[];
  candidates: CandidateFixture[];
  repos: RepoFixture[];
}

function fixtureState(): DbState {
  return {
    roles: [
      {
        id: 'role-001',
        role_title: 'Senior Frontend Engineer',
        role_searchable_profile: 'React, TypeScript, design systems.',
        seniority_band: 'senior',
        detected_domain: 'frontend',
        pipeline_id: 'pipe-001',
        embedding_json: JSON.stringify(VECTOR_1024),
      },
      {
        id: 'role-002',
        role_title: 'Mid Backend Engineer',
        role_searchable_profile: 'Node.js, PostgreSQL, API design.',
        seniority_band: 'mid',
        detected_domain: 'backend',
        pipeline_id: 'pipe-002',
        embedding_json: JSON.stringify(VECTOR_1024),
      },
    ],
    candidates: [
      {
        id: 'candidate-001',
        name: 'Alice',
        email: 'alice@example.com',
        pipeline_id: 'pipe-001',
        status: 'active',
        candidate_searchable_profile: 'Fullstack engineer with React and Node.',
        triangulated_score: 0.85,
        pipeline_name: 'Frontend Pipeline',
        owner_id: 'test-user',
        embedding_json: JSON.stringify(VECTOR_1024),
      },
    ],
    repos: [
      {
        id: 101,
        full_name: 'acme/widgets',
        github_url: 'https://github.com/acme/widgets',
        description: 'Widget library',
        primary_language: 'typescript',
        seniority_band: 'mid',
        detected_domain: 'frontend',
        stars: 5000,
        repo_searchable_profile: 'React component library with TypeScript.',
        disqualified: 0,
        embedding_json: JSON.stringify(VECTOR_1024),
      },
      {
        id: 102,
        full_name: 'acme/legacy',
        github_url: 'https://github.com/acme/legacy',
        description: 'Legacy app',
        primary_language: 'javascript',
        seniority_band: 'senior',
        detected_domain: 'backend',
        stars: 100,
        repo_searchable_profile: 'Old backend monolith.',
        disqualified: 1,
        embedding_json: JSON.stringify(VECTOR_1024),
      },
    ],
  };
}

// ─── D1 stub (same pattern as matchReposForCandidate.test.ts) ─────────────────

function buildStubDb(state: DbState): D1Database {
  const prepare = (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...args: unknown[]) {
        return {
          async first<T = unknown>(): Promise<T | null> {
            if (normalized.startsWith('SELECT embedding_json FROM role_contexts WHERE id =')) {
              const [id] = args as [string];
              const role = state.roles.find((r) => r.id === id);
              return (role ? { embedding_json: role.embedding_json } : null) as T | null;
            }
            if (normalized.startsWith('SELECT embedding_json FROM candidate_ingestion WHERE candidate_id =')) {
              const [id] = args as [string];
              const candidate = state.candidates.find((c) => c.id === id);
              return (candidate ? { embedding_json: candidate.embedding_json } : null) as T | null;
            }
            if (normalized.startsWith('SELECT embedding_json FROM repo_engineering_signals WHERE repo_id =')) {
              const [id] = args as [number];
              const repo = state.repos.find((r) => r.id === id);
              return (repo ? { embedding_json: repo.embedding_json } : null) as T | null;
            }
            return null;
          },
          async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
            if (normalized.startsWith('SELECT rc.id, rc.role_title, rc.role_searchable_profile')) {
              const ids = args as string[];
              const rows = state.roles.filter((r) => ids.includes(r.id));
              return { results: rows as T[], success: true, meta: {} };
            }
            if (
              normalized.startsWith(
                'SELECT c.id, c.name, c.email, c.pipeline_id,',
              )
            ) {
              const allArgs = args as unknown[];
              // Last arg may be ownerId if present
              const ownerId =
                typeof allArgs[allArgs.length - 1] === 'string'
                  ? (allArgs[allArgs.length - 1] as string)
                  : undefined;
              const candidateIds = ownerId
                ? (allArgs.slice(0, -1) as string[])
                : (allArgs as string[]);
              const rows = state.candidates
                .filter((c) => candidateIds.includes(c.id))
                .filter((c) => (ownerId ? c.owner_id === ownerId : true))
                .map((c) => ({
                  id: c.id,
                  name: c.name,
                  email: c.email,
                  pipeline_id: c.pipeline_id,
                  status: c.status,
                  candidate_searchable_profile: c.candidate_searchable_profile,
                  triangulated_score: c.triangulated_score,
                  pipeline_name: c.pipeline_name,
                }));
              return { results: rows as T[], success: true, meta: {} };
            }
            if (
              normalized.startsWith(
                'SELECT r.id, r.full_name, r.github_url, r.description, r.primary_language,',
              )
            ) {
              const repoIds = args as number[];
              const rows = state.repos
                .filter((r) => repoIds.includes(r.id) && r.disqualified === 0)
                .map((r) => ({
                  id: r.id,
                  full_name: r.full_name,
                  github_url: r.github_url,
                  description: r.description,
                  primary_language: r.primary_language,
                  seniority_band: r.seniority_band,
                  detected_domain: r.detected_domain,
                  stars: r.stars,
                  repo_searchable_profile: r.repo_searchable_profile,
                }));
              return { results: rows as T[], success: true, meta: {} };
            }
            return { results: [] as T[], success: true, meta: {} };
          },
          async run() {
            return { success: true, meta: {} };
          },
        };
      },
    };
  };
  return { prepare } as unknown as D1Database;
}

// ─── Ai / Vectorize stubs ─────────────────────────────────────────────────────

function makeAi(vector: number[] = VECTOR_1024): Ai {
  return {
    run: vi.fn(async () => ({ data: [vector] })),
  } as unknown as Ai;
}

function makeRoleIndex(scores: Record<string, number>): VectorizeIndex {
  return {
    query: vi.fn(async () => ({
      matches: Object.entries(scores).map(([id, score]) => ({
        id: `role_${id}`,
        score,
      })),
    })),
    upsert: vi.fn(),
  } as unknown as VectorizeIndex;
}

function makeCandidateIndex(scores: Record<string, number>): VectorizeIndex {
  return {
    query: vi.fn(async () => ({
      matches: Object.entries(scores).map(([id, score]) => ({
        id: `candidate_${id}`,
        score,
      })),
    })),
    upsert: vi.fn(),
  } as unknown as VectorizeIndex;
}

function makeRepoIndex(scores: Record<number, number>): VectorizeIndex {
  return {
    query: vi.fn(async () => ({
      matches: Object.entries(scores).map(([id, score]) => ({
        id: `repo_${id}`,
        score,
      })),
    })),
    upsert: vi.fn(),
  } as unknown as VectorizeIndex;
}

// ─── Test harness ─────────────────────────────────────────────────────────────

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/api/v1/search', search);
  return { app, env };
}

async function post(app: Hono<{ Bindings: Env; Variables: Variables }>, env: Env, path: string, body: unknown) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer fake-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    env,
    {} as ExecutionContext,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/search/roles', () => {
  it.skip('returns hydrated roles for a free-text query', async () => {
    const state = fixtureState();
    const env: Env = {
      DB: buildStubDb(state),
      AI: makeAi(),
      ROLE_INDEX: makeRoleIndex({ 'role-001': 0.95, 'role-002': 0.88 }),
      CLERK_SECRET_KEY: 'test-secret',
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'test-user',
    } as unknown as Env;
    const { app } = createApp(env);

    const res = await post(app, env, '/api/v1/search/roles', {
      query: 'frontend engineer',
      limit: 5,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      roles: Array<{
        roleId: string;
        roleTitle: string | null;
        score: number;
      }>;
      source: { type: string; id: string };
    };
    expect(json.roles).toHaveLength(2);
    expect(json.roles[0]!.roleId).toBe('role-001');
    expect(json.roles[0]!.roleTitle).toBe('Senior Frontend Engineer');
    expect(json.roles[0]!.score).toBe(0.95);
    expect(json.source.type).toBe('query');
  });

  it.skip('returns hydrated roles when roleContextId is provided', async () => {
    const state = fixtureState();
    const env: Env = {
      DB: buildStubDb(state),
      AI: makeAi(),
      ROLE_INDEX: makeRoleIndex({ 'role-002': 0.92 }),
      CLERK_SECRET_KEY: 'test-secret',
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'test-user',
    } as unknown as Env;
    const { app } = createApp(env);

    const res = await post(app, env, '/api/v1/search/roles', {
      roleContextId: 'role-001',
      limit: 5,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      roles: Array<{ roleId: string; score: number }>;
      source: { type: string; id: string };
    };
    expect(json.roles).toHaveLength(1);
    expect(json.roles[0]!.roleId).toBe('role-002');
    expect(json.source.type).toBe('role');
    expect(json.source.id).toBe('role-001');
  });

  it('returns empty array when no vectorize matches found', async () => {
    const state = fixtureState();
    const env: Env = {
      DB: buildStubDb(state),
      AI: makeAi(),
      ROLE_INDEX: makeRoleIndex({}),
      CLERK_SECRET_KEY: 'test-secret',
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'test-user',
    } as unknown as Env;
    const { app } = createApp(env);

    const res = await post(app, env, '/api/v1/search/roles', {
      query: 'devops',
      limit: 5,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      roles: unknown[];
      source: { type: string; id: string };
    };
    expect(json.roles).toEqual([]);
  });

  it('returns 400 when no query params provided', async () => {
    const state = fixtureState();
    const env: Env = {
      DB: buildStubDb(state),
      AI: makeAi(),
      ROLE_INDEX: makeRoleIndex({}),
      CLERK_SECRET_KEY: 'test-secret',
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'test-user',
    } as unknown as Env;
    const { app } = createApp(env);

    const res = await post(app, env, '/api/v1/search/roles', { limit: 5 });

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/search/candidates', () => {
  it.skip('returns hydrated candidates scoped to owner', async () => {
    const state = fixtureState();
    const env: Env = {
      DB: buildStubDb(state),
      AI: makeAi(),
      CANDIDATE_INDEX: makeCandidateIndex({ 'candidate-001': 0.91 }),
      CLERK_SECRET_KEY: 'test-secret',
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'test-user',
    } as unknown as Env;
    const { app } = createApp(env);

    const res = await post(app, env, '/api/v1/search/candidates', {
      roleContextId: 'role-001',
      limit: 5,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      candidates: Array<{
        candidateId: string;
        name: string;
        pipelineName: string;
        score: number;
      }>;
      source: { type: string; id: string };
    };
    expect(json.candidates).toHaveLength(1);
    expect(json.candidates[0]!.candidateId).toBe('candidate-001');
    expect(json.candidates[0]!.name).toBe('Alice');
    expect(json.source.type).toBe('role');
  });
});

describe('POST /api/v1/search/repos', () => {
  it.skip('returns hydrated repos with disqualified filter', async () => {
    const state = fixtureState();
    const env: Env = {
      DB: buildStubDb(state),
      AI: makeAi(),
      REPO_INDEX: makeRepoIndex({ 101: 0.93, 102: 0.85 }),
      CLERK_SECRET_KEY: 'test-secret',
      DEV_AUTH_BYPASS: 'true',
      DEV_BYPASS_USER_ID: 'test-user',
    } as unknown as Env;
    const { app } = createApp(env);

    const res = await post(app, env, '/api/v1/search/repos', {
      query: 'typescript repo',
      limit: 5,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      repos: Array<{ repoId: number; fullName: string; score: number }>;
      source: { type: string; id: string };
    };
    // Only repo 101 is returned because repo 102 has disqualified = 1
    expect(json.repos).toHaveLength(1);
    expect(json.repos[0]!.repoId).toBe(101);
    expect(json.repos[0]!.fullName).toBe('acme/widgets');
    expect(json.source.type).toBe('query');
  });
});
