/**
 * Tests for candidate routes — POST, GET, PATCH, DELETE.
 *
 * Uses a fake D1 stub and the Clerk local-dev bypass
 * (CLERK_SECRET_KEY === 'test') to avoid real JWTs.
 */

import { describe, it, expect } from 'vitest';
import { pipelineCandidates, candidateOps } from '../routes/cockpit/candidates';
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
      all: async () => {
        const match = firstResponders.find((r) => sql.includes(r.match));
        const result = match ? match.value : null;
        if (Array.isArray(result)) {
          return { results: result, success: true, meta: { changes: 0 } };
        }
        return { results: [], success: true, meta: { changes: 0 } };
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

function buildEnv(db: FakeD1): Env {
  return {
    CLERK_SECRET_KEY: 'test',
    DB: db as unknown as D1Database,
  } as unknown as Env;
}

// ─── POST /api/v1/pipelines/:pipelineId/candidates ───────────────────────────

describe('POST /api/v1/pipelines/:pipelineId/candidates', () => {
  it('rejects names containing forbidden XSS patterns with 400', async () => {
    const db = fakeD1([
      { match: 'FROM pipelines', value: { id: 'pipe_1', title: 'Test' } },
      { match: 'FROM stages', value: { id: 'stage_1' } },
    ]);
    const env = buildEnv(db);

    const res = await pipelineCandidates.request(
      '/pipe_1/candidates',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '<script>alert(1)</script>', email: 'xss@test.com' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('forbidden');
  });

  it('strips benign < and > characters from names', async () => {
    const db = fakeD1([
      { match: 'FROM pipelines', value: { id: 'pipe_1', title: 'Test' } },
      { match: 'FROM stages', value: { id: 'stage_1' } },
      { match: 'FROM candidates', value: null },
    ]);
    const env = buildEnv(db);

    const res = await pipelineCandidates.request(
      '/pipe_1/candidates',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hello <World>', email: 'hello@world.com' }),
      },
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { candidate?: { name?: string } };
    expect(body.candidate?.name).toBe('Hello World');
  });

  it('rejects duplicate email in the same pipeline', async () => {
    const db = fakeD1([
      { match: 'FROM pipelines', value: { id: 'pipe_1', title: 'Test' } },
      { match: 'FROM stages', value: { id: 'stage_1' } },
      { match: 'FROM candidates', value: { id: 'cand_1' } },
    ]);
    const env = buildEnv(db);

    const res = await pipelineCandidates.request(
      '/pipe_1/candidates',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', email: 'alice@test.com' }),
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe('Email already exists in this pipeline');
    expect(body.error?.code).toBe('CONFLICT');
  });
});

// ─── GET /api/v1/candidates/:candidateId ─────────────────────────────────────

describe('GET /api/v1/candidates/:candidateId', () => {
  it('returns ingestion object even when optional columns are null', async () => {
    const db = fakeD1([
      {
        match: 'c.id = ? AND p.owner_id',
        value: {
          id: 'cand_1',
          name: 'Bob',
          email: 'bob@test.com',
          status: 'INVITED',
          pipeline_id: 'pipe_1',
          current_stage_id: 'stage_1',
          resume_s3_key: null,
          phone_number: null,
          invite_token: 'tok_1',
          skills: null,
          years_of_experience: null,
          current_role: null,
          education: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      },
      {
        match: 'FROM candidate_ingestion',
        value: {
          id: 'ing_1',
          status: 'failed',
          candidate_searchable_profile: null,
          key_concepts_json: null,
          profile_version: null,
          model_used: null,
          decomposition_version: null,
          triangulated_score: null,
          role_candidate_cosine: null,
          dimensions_json: null,
          reasoning_json: null,
          match_philosophy: null,
          career_context_json: null,
          situation_signature_json: null,
          key_situations_json: null,
          github_url: null,
          last_enriched_at: null,
          profile_generated_at: null,
          profile_embedded_at: null,
          matched_at: null,
          error_text: 'Something went wrong',
          github_calendar_json: null,
          profile_sections_json: null,
          matched_repo_id: null,
        },
      },
    ]);
    const env = buildEnv(db);

    const res = await candidateOps.request(
      '/cand_1',
      { method: 'GET', headers: {} },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ingestion: { status: string; errorText: string } | null };
    expect(body.ingestion).not.toBeNull();
    expect(body.ingestion?.status).toBe('failed');
    expect(body.ingestion?.errorText).toBe('Something went wrong');
  });
});

// ─── PATCH /api/v1/candidates/:candidateId ───────────────────────────────────

describe('PATCH /api/v1/candidates/:candidateId', () => {
  it('rejects names containing forbidden XSS patterns with 400 on PATCH', async () => {
    const db = fakeD1([
      {
        match: 'c.id = ? AND p.owner_id',
        value: { id: 'cand_1', pipeline_id: 'pipe_1' },
      },
    ]);
    const env = buildEnv(db);

    const res = await candidateOps.request(
      '/cand_1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '<script src=x>' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('forbidden');
  });

  it('strips benign < and > characters from names on PATCH', async () => {
    const db = fakeD1([
      {
        match: 'c.id = ? AND p.owner_id',
        value: { id: 'cand_1', pipeline_id: 'pipe_1' },
      },
    ]);
    const env = buildEnv(db);

    const res = await candidateOps.request(
      '/cand_1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice <Bob>' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success?: boolean };
    expect(body.success).toBe(true);

    const updateCall = db.__calls.find((c) => c.sql.includes('UPDATE candidates'));
    expect(updateCall?.params).toContain('Alice Bob');
  });
});

// ─── DELETE /api/v1/candidates/:candidateId ──────────────────────────────────

describe('DELETE /api/v1/candidates/:candidateId', () => {
  it('hard deletes a candidate and all related rows', async () => {
    const db = fakeD1([
      {
        match: 'c.id = ? AND p.owner_id',
        value: { id: 'cand_1' },
      },
    ]);
    const env = buildEnv(db);

    const res = await candidateOps.request(
      '/cand_1',
      { method: 'DELETE', headers: {} },
      env,
    );

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();

    const deleteCalls = db.__calls.filter((c) => c.sql.trim().startsWith('DELETE FROM'));
    const tablesDeleted = deleteCalls.map((c) => {
      const m = c.sql.match(/DELETE FROM\s+(\w+)/i);
      return m ? m[1] : '';
    });
    expect(tablesDeleted).toContain('candidates');
    expect(tablesDeleted).toContain('candidate_profile_state');
  });

  it('returns 404 when deleting a non-existent candidate', async () => {
    const db = fakeD1([
      {
        match: 'c.id = ? AND p.owner_id',
        value: null,
      },
    ]);
    const env = buildEnv(db);

    const res = await candidateOps.request(
      '/nonexistent',
      { method: 'DELETE', headers: {} },
      env,
    );

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/v1/candidates/:candidateId/assignments ─────────────────────────

describe('GET /api/v1/candidates/:candidateId/assignments', () => {
  it('returns a list of candidate challenge assignments', async () => {
    const db = fakeD1([
      {
        match: 'c.id = ? AND p.owner_id',
        value: { id: 'cand_1' },
      },
      {
        match: 'FROM candidate_challenge_assignment',
        value: [
          {
            stage_id: 'stage_1',
            challenge_id: 'chal_1',
            repo_id: 42,
            github_repo_url: 'https://github.com/org/repo',
            github_pr_number: 7,
            issue_number: 99,
            assigned_at: '2026-02-01T10:00:00.000Z',
          },
        ],
      },
    ]);
    const env = buildEnv(db);

    const res = await candidateOps.request(
      '/cand_1/assignments',
      { method: 'GET', headers: {} },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assignments: Array<{
        stageId: string;
        challengeId: string;
        repoId: number;
        githubRepoUrl: string;
        githubPrNumber: number;
        issueNumber: number;
        assignedAt: string;
      }>;
    };
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0].stageId).toBe('stage_1');
    expect(body.assignments[0].challengeId).toBe('chal_1');
    expect(body.assignments[0].repoId).toBe(42);
    expect(body.assignments[0].githubRepoUrl).toBe('https://github.com/org/repo');
    expect(body.assignments[0].githubPrNumber).toBe(7);
    expect(body.assignments[0].issueNumber).toBe(99);
    expect(body.assignments[0].assignedAt).toBe('2026-02-01T10:00:00.000Z');
  });

  it('returns 404 when candidate does not exist', async () => {
    const db = fakeD1([
      {
        match: 'c.id = ? AND p.owner_id',
        value: null,
      },
    ]);
    const env = buildEnv(db);

    const res = await candidateOps.request(
      '/nonexistent/assignments',
      { method: 'GET', headers: {} },
      env,
    );

    expect(res.status).toBe(404);
  });
});

// ─── POST /api/v1/candidates/:candidateId/refresh-link ───────────────────────

describe('POST /api/v1/candidates/:candidateId/refresh-link', () => {
  it('regenerates invite token and wipes previous attempts', async () => {
    const db = fakeD1([
      {
        match: 'c.id = ? AND p.owner_id',
        value: { id: 'cand_1', status: 'COMPLETED' },
      },
    ]);
    const env = buildEnv(db);

    const res = await candidateOps.request(
      '/cand_1/refresh-link',
      { method: 'POST', headers: {} },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { inviteToken: string };
    expect(body.inviteToken).toBeDefined();
    expect(typeof body.inviteToken).toBe('string');

    const updateCall = db.__calls.find((c) =>
      c.sql.includes("UPDATE candidates SET invite_token = ?"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.sql).toContain("status = 'INVITED'");
    expect(updateCall?.params[2]).toBe('cand_1');
  });

  it('returns 404 when candidate does not exist', async () => {
    const db = fakeD1([
      {
        match: 'c.id = ? AND p.owner_id',
        value: null,
      },
    ]);
    const env = buildEnv(db);

    const res = await candidateOps.request(
      '/nonexistent/refresh-link',
      { method: 'POST', headers: {} },
      env,
    );

    expect(res.status).toBe(404);
  });
});
