/**
 * Role embedding lifecycle tests.
 *
 * Covers buildAndStoreRoleEmbedding (success, skip, error paths)
 * and runBackfill (dry-run, batching, short-profile skip, JD+persona build).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { buildAndStoreRoleEmbedding } from '../roleContexts';
import { buildRoleSearchableProfile } from '../../../lib/roleDiscovery/buildRoleProfile';
import { runBackfill, type BackfillEnv, type BackfillRoleContextRow } from '../../../lib/roleDiscovery/backfill';
import type { RoleContextRow, Env } from '../../../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface DbCalls {
  updates: Array<{ sql: string; args: unknown[] }>;
}

function buildStubDb(row: RoleContextRow | null, calls: DbCalls): D1Database {
  const prepare = (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>(): Promise<T | null> {
            if (normalized.includes('SELECT * FROM role_contexts WHERE id =')) {
              return (row as T | null) ?? null;
            }
            return null;
          },
          async all<T>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
            return { results: [] as T[], success: true, meta: {} };
          },
          async run() {
            calls.updates.push({ sql: normalized, args });
            return { success: true, meta: {} };
          },
        };
      },
    };
  };
  return { prepare } as unknown as D1Database;
}

function makeAi(vector: number[] = new Array(1024).fill(0.01)): Ai {
  return { run: vi.fn(async () => ({ data: [vector] })) } as unknown as Ai;
}

function makeVectorize(): VectorizeIndex {
  return {
    upsert: vi.fn(async () => ({ ids: [], count: 1 })),
    query: vi.fn(),
  } as unknown as VectorizeIndex;
}

function buildRoleContextRow(overrides: Partial<RoleContextRow> = {}): RoleContextRow {
  return {
    id: 'rc-1',
    owner_id: 'test-user',
    pipeline_id: null,
    baseline: JSON.stringify({ title: 'Senior Engineer' }),
    question_budget: 8,
    questions_asked: 0,
    status: 'COMPLETE',
    knowledge_state: '{}',
    exchanges: '[]',
    persona_json: null,
    job_description_md: null,
    rcd_version: null,
    rcd_json: null,
    validation_metadata: null,
    bars_overrides: null,
    recruitment_brief_json: null,
    role_searchable_profile: null,
    embedding_json: null,
    created_at: '2026-04-10T00:00:00Z',
    updated_at: '2026-04-10T00:00:00Z',
    ...overrides,
  } as RoleContextRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ─── buildAndStoreRoleEmbedding ──────────────────────────────────────────────

describe('buildAndStoreRoleEmbedding', () => {
  it('success path: profile embeds, D1 updated with embedding_json and updated_at', async () => {
    const row = buildRoleContextRow({ id: 'rc-1', pipeline_id: 'pipe-1' });
    const calls: DbCalls = { updates: [] };
    const db = buildStubDb(row, calls);
    const ai = makeAi();
    const vectorize = makeVectorize();

    const env = { DB: db, AI: ai, ROLE_INDEX: vectorize } as unknown as Env;

    await buildAndStoreRoleEmbedding(env, 'rc-1', 'A'.repeat(250), { seniority: 'senior' });

    // Two UPDATEs: role_searchable_profile, then embedding_json
    expect(calls.updates.length).toBe(2);
    expect(calls.updates[0]!.sql).toContain('role_searchable_profile = ?');
    expect(calls.updates[1]!.sql).toContain('embedding_json = ?');
    expect(calls.updates[1]!.args[0]).toBe(JSON.stringify(new Array(1024).fill(0.01)));
    expect(typeof calls.updates[1]!.args[1]).toBe('string'); // updated_at ISO string
    expect(calls.updates[1]!.args[2]).toBe('bge-large-en-v1.5-2024'); // embedding_model_version
    expect(calls.updates[1]!.args[3]).toBe('rc-1');

    // AI + Vectorize called
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(vectorize.upsert).toHaveBeenCalledTimes(1);

    // Vectorize metadata contains pipeline_id
    const upsertCall = vi.mocked(vectorize.upsert).mock.calls[0]![0];
    expect(upsertCall[0]!.metadata).toMatchObject({ pipeline_id: 'pipe-1' });
  });

  it('skips short profile (<50 chars)', async () => {
    const calls: DbCalls = { updates: [] };
    const db = buildStubDb(buildRoleContextRow(), calls);
    const ai = makeAi();
    const vectorize = makeVectorize();
    const env = { DB: db, AI: ai, ROLE_INDEX: vectorize } as unknown as Env;

    await buildAndStoreRoleEmbedding(env, 'rc-1', 'tiny', { seniority: 'senior' });

    expect(calls.updates.length).toBe(0);
    expect(ai.run).not.toHaveBeenCalled();
    expect(vectorize.upsert).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('profile too short'),
    );
  });

  it('handles missing role context after update gracefully', async () => {
    const calls: DbCalls = { updates: [] };
    // Return null on the SELECT * that happens after the first UPDATE
    const db = buildStubDb(null, calls);
    const ai = makeAi();
    const vectorize = makeVectorize();
    const env = { DB: db, AI: ai, ROLE_INDEX: vectorize } as unknown as Env;

    await buildAndStoreRoleEmbedding(env, 'rc-1', 'A'.repeat(250), { seniority: 'senior' });

    // First UPDATE still ran (profile persisted)
    expect(calls.updates.length).toBe(1);
    expect(calls.updates[0]!.sql).toContain('role_searchable_profile');

    // No embedding attempted because row was missing
    expect(ai.run).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('not found after profile update'),
    );
  });

  it('catches embedding failure and logs without throwing', async () => {
    const row = buildRoleContextRow({ id: 'rc-1' });
    const calls: DbCalls = { updates: [] };
    const db = buildStubDb(row, calls);
    const ai = { run: vi.fn(async () => ({ data: [new Array(512).fill(0.01)] })) } as unknown as Ai;
    const vectorize = makeVectorize();
    const env = { DB: db, AI: ai, ROLE_INDEX: vectorize } as unknown as Env;

    // Should not throw even though embedding returns wrong dim
    await expect(
      buildAndStoreRoleEmbedding(env, 'rc-1', 'A'.repeat(250), { seniority: 'senior' }),
    ).resolves.toBeUndefined();

    // First UPDATE (profile) ran, but second (embedding) did not because embedAndUpsertRole threw
    expect(calls.updates.length).toBe(1);
    expect(calls.updates[0]!.sql).toContain('role_searchable_profile');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('role embed failed'),
      expect.any(String),
    );
  });

  it('builds metadata correctly from rcd_json', async () => {
    const rcd = {
      technical_context: {
        seniority_band: 'senior',
      },
    };
    const row = buildRoleContextRow({
      id: 'rc-1',
      pipeline_id: 'pipe-1',
      rcd_json: JSON.stringify(rcd),
    });
    const calls: DbCalls = { updates: [] };
    const db = buildStubDb(row, calls);
    const ai = makeAi();
    const vectorize = makeVectorize();
    const env = { DB: db, AI: ai, ROLE_INDEX: vectorize } as unknown as Env;

    await buildAndStoreRoleEmbedding(env, 'rc-1', 'A'.repeat(250), { seniority: 'senior' });

    const upsertCall = vi.mocked(vectorize.upsert).mock.calls[0]![0];
    expect(upsertCall[0]!.metadata).toEqual({
      pipeline_id: 'pipe-1',
      seniority_band: 'senior',
    });
  });

  it('ignores invalid rcd_json when building metadata', async () => {
    const row = buildRoleContextRow({
      id: 'rc-1',
      rcd_json: 'not-json',
    });
    const calls: DbCalls = { updates: [] };
    const db = buildStubDb(row, calls);
    const ai = makeAi();
    const vectorize = makeVectorize();
    const env = { DB: db, AI: ai, ROLE_INDEX: vectorize } as unknown as Env;

    await buildAndStoreRoleEmbedding(env, 'rc-1', 'A'.repeat(250), { seniority: 'senior' });

    const upsertCall = vi.mocked(vectorize.upsert).mock.calls[0]![0];
    expect(upsertCall[0]!.metadata).toEqual({});
  });
});

// ─── buildRoleSearchableProfile ──────────────────────────────────────────────

describe('buildRoleSearchableProfile', () => {
  it('uses job description when >= 200 chars and strips markdown headings', () => {
    const jd = '# Title\n\n' + 'A'.repeat(200);
    const result = buildRoleSearchableProfile(jd, {});
    expect(result).not.toContain('# Title');
    expect(result).toContain('A'.repeat(200));
  });

  it('falls back to persona when JD is short', () => {
    const persona = {
      seniority: 'senior',
      archetype: 'Backend engineer',
      mustHaveSkills: ['Go', 'Rust'],
      niceToHaveSkills: ['Kubernetes'],
    };
    const result = buildRoleSearchableProfile('short', persona);
    expect(result).toContain('senior');
    expect(result).toContain('Backend engineer');
    expect(result).toContain('Go');
    expect(result).toContain('Rust');
    expect(result).toContain('Kubernetes');
  });

  it('returns empty string when both JD and persona are empty', () => {
    const result = buildRoleSearchableProfile('', {});
    expect(result).toBe('');
  });
});

// ─── runBackfill ─────────────────────────────────────────────────────────────

describe('runBackfill', () => {
  function makeBackfillEnv(calls: DbCalls): BackfillEnv {
    const prepare = (sql: string) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              calls.updates.push({ sql: normalized, args });
              return { success: true, meta: {} };
            },
            async all<T>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
              return { results: [] as T[], success: true, meta: {} };
            },
            async first<T>(): Promise<T | null> {
              return null;
            },
          };
        },
      };
    };
    return {
      DB: { prepare } as unknown as D1Database,
      AI: makeAi(),
      ROLE_INDEX: makeVectorize(),
    };
  }

  it('dry run does not modify data', async () => {
    const calls: DbCalls = { updates: [] };
    const rows: BackfillRoleContextRow[] = [
      {
        id: 'rc-1',
        role_searchable_profile: 'A'.repeat(100),
        job_description_md: null,
        persona_json: null,
        pipeline_id: null,
        rcd_json: null,
      },
    ];

    const result = await runBackfill(null, rows, { dryRun: true, batchSize: 5 });

    expect(calls.updates.length).toBe(0);
    expect(result.processed).toBe(1); // processed is still counted in finally
    expect(result.succeeded).toBe(0);
  });

  it('processes rows in batches', async () => {
    const calls: DbCalls = { updates: [] };
    const env = makeBackfillEnv(calls);
    const rows: BackfillRoleContextRow[] = [
      { id: 'rc-1', role_searchable_profile: 'A'.repeat(100), job_description_md: null, persona_json: null, pipeline_id: null, rcd_json: null },
      { id: 'rc-2', role_searchable_profile: 'B'.repeat(100), job_description_md: null, persona_json: null, pipeline_id: null, rcd_json: null },
    ];

    const result = await runBackfill(env, rows, { dryRun: false, batchSize: 1 });

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(2);
    // Each row gets 1 update: embedding_json (profile already exists)
    expect(calls.updates.length).toBe(2);
  });

  it('skips short profiles', async () => {
    const calls: DbCalls = { updates: [] };
    const env = makeBackfillEnv(calls);
    const rows: BackfillRoleContextRow[] = [
      { id: 'rc-1', role_searchable_profile: 'short', job_description_md: null, persona_json: null, pipeline_id: null, rcd_json: null },
    ];

    const result = await runBackfill(env, rows, { dryRun: false, batchSize: 5 });

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(calls.updates.length).toBe(0);
  });

  it('builds profile from job_description_md and persona_json when role_searchable_profile is absent', async () => {
    const calls: DbCalls = { updates: [] };
    const env = makeBackfillEnv(calls);
    const rows: BackfillRoleContextRow[] = [
      {
        id: 'rc-1',
        role_searchable_profile: null,
        job_description_md: '## Role\n\n' + 'X'.repeat(250),
        persona_json: JSON.stringify({ seniority: 'mid', archetype: 'Fullstack' }),
        pipeline_id: null,
        rcd_json: null,
      },
    ];

    const result = await runBackfill(env, rows, { dryRun: false, batchSize: 5 });

    expect(result.succeeded).toBe(1);
    // Two updates: role_searchable_profile (first time built) + embedding_json
    expect(calls.updates.length).toBe(2);
    expect(calls.updates[0]!.sql).toContain('role_searchable_profile');
    expect(calls.updates[1]!.sql).toContain('embedding_json');
    // Profile should have markdown stripped and contain the JD content
    const profileArg = calls.updates[0]!.args[0] as string;
    expect(profileArg).not.toContain('##');
    expect(profileArg).toContain('X'.repeat(250));
  });

  it('falls back to persona profile when JD is short and role_searchable_profile is absent', async () => {
    const calls: DbCalls = { updates: [] };
    const env = makeBackfillEnv(calls);
    const rows: BackfillRoleContextRow[] = [
      {
        id: 'rc-1',
        role_searchable_profile: null,
        job_description_md: 'short',
        persona_json: JSON.stringify({ seniority: 'senior', mustHaveSkills: ['React', 'Node'] }),
        pipeline_id: null,
        rcd_json: null,
      },
    ];

    const result = await runBackfill(env, rows, { dryRun: false, batchSize: 5 });

    expect(result.succeeded).toBe(1);
    const profileArg = calls.updates[0]!.args[0] as string;
    expect(profileArg).toContain('senior');
    expect(profileArg).toContain('React');
    expect(profileArg).toContain('Node');
  });

  it('counts failures when embedding throws', async () => {
    const calls: DbCalls = { updates: [] };
    const env = makeBackfillEnv(calls);
    env.AI = { run: vi.fn(async () => ({ data: [new Array(512).fill(0.01)] })) } as unknown as Ai;
    const rows: BackfillRoleContextRow[] = [
      { id: 'rc-1', role_searchable_profile: 'A'.repeat(100), job_description_md: null, persona_json: null, pipeline_id: null, rcd_json: null },
    ];

    const result = await runBackfill(env, rows, { dryRun: false, batchSize: 5 });

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    // Profile already existed, so no profile update; embedding failed before embedding_json update
    expect(calls.updates.length).toBe(0);
  });

  it('includes metadata from pipeline_id and rcd_json', async () => {
    const calls: DbCalls = { updates: [] };
    const env = makeBackfillEnv(calls);
    const rows: BackfillRoleContextRow[] = [
      {
        id: 'rc-1',
        role_searchable_profile: 'A'.repeat(100),
        job_description_md: null,
        persona_json: null,
        pipeline_id: 'pipe-1',
        rcd_json: JSON.stringify({ technical_context: { seniority_band: 'lead' } }),
      },
    ];

    await runBackfill(env, rows, { dryRun: false, batchSize: 5 });

    const upsertCall = vi.mocked(env.ROLE_INDEX.upsert).mock.calls[0]![0];
    expect(upsertCall[0]!.metadata).toEqual({
      pipeline_id: 'pipe-1',
      seniority_band: 'lead',
    });
  });
});
