/**
 * Tests for GET /api/v1/candidates/:candidateId/ingestion-status
 *
 * Covers both the JSON fallback path (no Accept: text/event-stream) and the
 * SSE streaming path. Uses a fake D1 to stub DB responses and the Clerk
 * local-dev bypass (CLERK_SECRET_KEY === 'test') to avoid real JWTs.
 */

import { describe, it, expect } from 'vitest';
import { ingestionStatus } from '../routes/cockpit/ingestionStatus';
import type { Env } from '../types';

interface PreparedCall {
  sql: string;
  params: unknown[];
  firstResult: unknown;
  ran: boolean;
}

interface FakeD1 extends D1Database {
  __calls: PreparedCall[];
}

function fakeD1(firstResponders: Array<{ match: string; value: unknown }> = []): FakeD1 {
  const calls: PreparedCall[] = [];

  const prepare = (sql: string): D1PreparedStatement => {
    const call: PreparedCall = { sql, params: [], firstResult: null, ran: false };
    calls.push(call);

    const stmt = {
      bind: (...params: unknown[]) => {
        call.params = params;
        return stmt;
      },
      first: async () => {
        const match = firstResponders.find((r) => sql.includes(r.match));
        const result = match ? match.value : null;
        call.firstResult = result;
        return result;
      },
      run: async () => {
        call.ran = true;
        return { success: true, meta: { changes: 1 } };
      },
      all: async () => ({ results: [], success: true, meta: { changes: 0 } }),
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

function buildEnv(db: FakeD1): Env {
  return {
    CLERK_SECRET_KEY: 'test',
    DB: db as unknown as D1Database,
  } as unknown as Env;
}

// ─── JSON fallback tests ─────────────────────────────────────────────────────

describe('GET /:candidateId/ingestion-status (JSON fallback)', () => {
  it('returns 401 when Authorization header is missing and bypass is not set', async () => {
    const db = fakeD1();
    const env = { DB: db } as unknown as Env;

    const res = await ingestionStatus.request(
      '/cand_1/ingestion-status',
      { method: 'GET', headers: {} },
      env,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 404 when candidate does not exist or is not owned by user', async () => {
    const db = fakeD1();
    const env = buildEnv(db);

    const res = await ingestionStatus.request(
      '/cand_1/ingestion-status',
      { method: 'GET', headers: {} },
      env,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns not_started when no ingestion row exists', async () => {
    const db = fakeD1([
      {
        match: 'FROM candidates',
        value: { id: 'cand_1' },
      },
    ]);
    const env = buildEnv(db);

    const res = await ingestionStatus.request(
      '/cand_1/ingestion-status',
      { method: 'GET', headers: {} },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('not_started');
  });

  it('returns ingestion row as JSON when one exists', async () => {
    const db = fakeD1([
      {
        match: 'FROM candidates',
        value: { id: 'cand_1' },
      },
      {
        match: 'FROM candidate_ingestion',
        value: {
          status: 'processing',
          candidate_searchable_profile: 'profile text',
          key_concepts_json: '{}',
          career_context_json: '{}',
          situation_signature_json: '{}',
          profile_version: 1,
          model_used: 'gpt-4',
          error_text: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      },
    ]);
    const env = buildEnv(db);

    const res = await ingestionStatus.request(
      '/cand_1/ingestion-status',
      { method: 'GET', headers: {} },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('processing');
    expect(body.candidate_searchable_profile).toBe('profile text');
    expect(body.profile_version).toBe(1);
    expect(body.model_used).toBe('gpt-4');
  });
});

// ─── SSE streaming tests ─────────────────────────────────────────────────────

describe('GET /:candidateId/ingestion-status (SSE)', () => {
  it('returns SSE headers and a done event immediately for not_started', async () => {
    const db = fakeD1([
      {
        match: 'FROM candidates',
        value: { id: 'cand_1' },
      },
      // no candidate_ingestion row → first() returns null
    ]);
    const env = buildEnv(db);

    const res = await ingestionStatus.request(
      '/cand_1/ingestion-status',
      {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('event: status');
    expect(text).toContain('"status":"not_started"');
    expect(text).toContain('event: done');
  });

  it('emits status then done for a terminal state', async () => {
    const db = fakeD1([
      {
        match: 'FROM candidates',
        value: { id: 'cand_1' },
      },
      {
        match: 'FROM candidate_ingestion',
        value: {
          status: 'matched',
          candidate_searchable_profile: null,
          key_concepts_json: null,
          career_context_json: null,
          situation_signature_json: null,
          profile_version: 2,
          model_used: 'gpt-4o',
          error_text: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      },
    ]);
    const env = buildEnv(db);

    const res = await ingestionStatus.request(
      '/cand_1/ingestion-status',
      {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      env,
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: status');
    expect(text).toContain('"status":"matched"');
    expect(text).toContain('event: done');
    expect(text).toContain('"status":"matched"');
  });

  it('returns an SSE error event when candidate not found', async () => {
    const db = fakeD1();
    const env = buildEnv(db);

    const res = await ingestionStatus.request(
      '/cand_1/ingestion-status',
      {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      env,
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toContain('NOT_FOUND');
  });
});
