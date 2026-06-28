/**
 * Candidate RPC ingestion-status tests.
 *
 * These drive the real /rpc app because the candidate UI polls this route
 * directly while waiting for source-backed matching.
 */

import { describe, expect, it, vi } from 'vitest';
import { rpcAuth } from '../routes/rpc';
import { signJwt } from '../lib/jwt';
import type { Env } from '../types';

vi.mock('../lib/candidateDiscovery/orchestrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/candidateDiscovery/orchestrate')>();
  return {
    ...actual,
    runCandidateIngestion: vi.fn(async () => undefined),
  };
});

import { runCandidateIngestion } from '../lib/candidateDiscovery/orchestrate';

interface PreparedCall {
  sql: string;
  params: unknown[];
  ran: boolean;
}

interface FakeD1Config {
  firstResponders?: Array<{ match: string; value: unknown }>;
}

interface FakeD1 extends D1Database {
  __calls: PreparedCall[];
}

function fakeD1(cfg: FakeD1Config = {}): FakeD1 {
  const calls: PreparedCall[] = [];

  const prepare = (sql: string): D1PreparedStatement => {
    const call: PreparedCall = { sql, params: [], ran: false };
    calls.push(call);

    const stmt = {
      bind: (...params: unknown[]) => {
        call.params = params;
        return stmt;
      },
      first: async () => {
        const match = (cfg.firstResponders ?? []).find((responder) =>
          sql.includes(responder.match),
        );
        return match ? match.value : null;
      },
      all: async () => ({ results: [], success: true, meta: {} }),
      run: async () => {
        call.ran = true;
        return { success: true, meta: { changes: 1 } };
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement;

    return stmt;
  };

  return {
    prepare,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    __calls: calls,
  } as unknown as FakeD1;
}

function fakeStorage(text: string): R2Bucket {
  return {
    get: vi.fn(async () => ({ text: async () => text })),
  } as unknown as R2Bucket;
}

function buildEnv(overrides: Partial<Env & { DB: FakeD1 }> = {}): Env & { DB: FakeD1 } {
  return {
    SESSION_TOKEN_SECRET: 'test-secret',
    DB: fakeD1(),
    ...overrides,
  } as Env & { DB: FakeD1 };
}

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

async function authHeader(candidateId = 'cand_1'): Promise<string> {
  const token = await signJwt({ sub: candidateId, pid: null }, 'test-secret');
  return `Bearer ${token}`;
}

describe('GET /rpc/ingestion-status', () => {
  it('queues source-backed retry when the status row is a stale Workers AI model failure', async () => {
    const resumeText = 'Backend engineer building Cloudflare Workers queues, source-backed tests, and runtime recovery.';
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidate_ingestion',
          value: {
            status: 'failed',
            current_step: 'discover_profile',
            candidate_searchable_profile: null,
            key_concepts_json: null,
            error_text: 'Discovery failed: Cloudflare Workers AI call failed for model @cf/meta/llama-3.1-8b-instruct: 5028: This model was deprecated on 2026-05-30.',
            estimated_completion_at: null,
            updated_at: '2026-06-28T12:00:00.000Z',
          },
        },
        {
          match: 'retryable_standalone_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1/source',
            status: 'failed',
            current_step: 'discover_profile',
            error_text: 'Discovery failed: Cloudflare Workers AI call failed for model @cf/meta/llama-3.1-8b-instruct: 5028: This model was deprecated on 2026-05-30.',
          },
        },
      ],
    });
    const storage = fakeStorage(resumeText);
    const env = buildEnv({ DB: db, STORAGE: storage });
    const { ctx, waitUntilAll } = buildCtx();

    const res = await rpcAuth.request(
      '/ingestion-status',
      {
        method: 'GET',
        headers: { Authorization: await authHeader() },
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      status?: string;
      current_step?: string;
      error_text?: string | null;
      retry_queued?: boolean;
      retry_reason?: string;
    };
    expect(body).toMatchObject({
      status: 'pending',
      current_step: 'retry_queued',
      error_text: null,
      retry_queued: true,
      retry_reason: 'Retrying candidate evidence ingestion after a stale Workers AI model failure.',
    });
    expect(db.__calls.some((call) =>
      call.ran
      && call.sql.includes("status = 'pending'")
      && call.sql.includes("current_step = 'retry_queued'")
    )).toBe(true);

    await waitUntilAll();
    expect(storage.get).toHaveBeenCalledWith('text-intake/cand_1/source');
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand_1',
      resumeText,
      decompositionResult: null,
      parsed: expect.objectContaining({
        skills: expect.any(Array),
        experiences: expect.any(Array),
        projects: expect.any(Array),
      }),
    }));
  });

  it('queues source-backed retry when candidate ingestion stalls before matchable evidence exists', async () => {
    const resumeText = 'Frontend platform engineer building synchronized interview desktops, dev containers, and source-backed Vitest coverage.';
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidate_ingestion',
          value: {
            status: 'pending',
            current_step: 'decompose_resume',
            candidate_searchable_profile: null,
            key_concepts_json: null,
            error_text: null,
            estimated_completion_at: null,
            updated_at: '2026-06-28T18:00:00.000Z',
          },
        },
        {
          match: 'retryable_standalone_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1/stalled-source',
            status: 'pending',
            current_step: 'decompose_resume',
            error_text: null,
            updated_at: '2026-06-28T18:00:00.000Z',
          },
        },
      ],
    });
    const storage = fakeStorage(resumeText);
    const env = buildEnv({ DB: db, STORAGE: storage });
    const { ctx, waitUntilAll } = buildCtx();

    const res = await rpcAuth.request(
      '/ingestion-status',
      {
        method: 'GET',
        headers: { Authorization: await authHeader() },
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      status?: string;
      current_step?: string;
      error_text?: string | null;
      retry_queued?: boolean;
      retry_reason?: string;
    };
    expect(body).toMatchObject({
      status: 'pending',
      current_step: 'retry_queued',
      error_text: null,
      retry_queued: true,
      retry_reason: 'Retrying candidate evidence ingestion from the original source after the previous run stalled.',
    });

    await waitUntilAll();
    expect(storage.get).toHaveBeenCalledWith('text-intake/cand_1/stalled-source');
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand_1',
      resumeText,
      decompositionResult: null,
    }));
  });
});
