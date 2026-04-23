/**
 * Unit tests for review session v2 backend endpoints.
 *
 * Drives the real rpcAuth Hono app via app.request() with a fake D1 stub.
 * Mocks callImplementerAgent so no external AI calls are made.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rpcAuth } from '../routes/rpc';
import { signJwt } from '../lib/jwt';
import type { Env } from '../types';

vi.mock('../lib/implementerAgent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/implementerAgent')>();
  return {
    ...actual,
    callImplementerAgent: vi.fn(),
  };
});

import { callImplementerAgent } from '../lib/implementerAgent';

// ─── Fake D1 ─────────────────────────────────────────────────────────────────

interface PreparedCall {
  sql: string;
  params: unknown[];
  ran: boolean;
  firstResult: unknown;
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
    const call: PreparedCall = { sql, params: [], ran: false, firstResult: null };
    calls.push(call);

    const stmt = {
      bind: (...params: unknown[]) => {
        call.params = params;
        return stmt;
      },
      first: async () => {
        const match = (cfg.firstResponders ?? []).find((r) => sql.includes(r.match));
        const result = match ? match.value : null;
        call.firstResult = result;
        return result;
      },
      all: async () => ({ results: [] as unknown[], success: true, meta: {} }),
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function authHeader(candidateId = 'cand_1', pipelineId = 'pipe_1'): Promise<string> {
  const token = await signJwt({ sub: candidateId, pid: pipelineId }, 'test-secret');
  return `Bearer ${token}`;
}

function buildEnv(overrides: Partial<Env & { DB: FakeD1 }> = {}): Env & { DB: FakeD1 } {
  return {
    SESSION_TOKEN_SECRET: 'test-secret',
    DB: fakeD1(),
    ...overrides,
  } as Env & { DB: FakeD1 };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CANDIDATE = { current_stage_id: 'stage_1' };

const CHALLENGE_ROW = {
  id: 'ch_1',
  config: JSON.stringify({ isMultiTurn: true, maxRounds: 4, implementerPersona: 'junior' }),
  server_config: null,
  cached_diff_json: JSON.stringify({
    files: [
      {
        filename: 'src/index.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        hunks: [
          {
            header: '@@ -1,3 +1,4 @@',
            lines: [{ type: 'added', content: 'const x = 1;', lineNumber: 1 }],
          },
        ],
      },
    ],
  }),
  instructions: 'Review this PR',
  github_pr_title: 'Add feature',
  github_pr_description: 'This PR adds a feature',
  github_repo_url: 'https://github.com/test/repo',
  github_pr_number: 1,
};

const CHALLENGE_NON_MULTITURN = {
  ...CHALLENGE_ROW,
  config: JSON.stringify({ isMultiTurn: false }),
};

const ASSESSMENT_ROW = { id: 'assessment_1' };

const SESSION_PENDING = {
  id: 'sess_1',
  challenge_id: 'ch_1',
  assessment_id: 'assessment_1',
  candidate_id: 'cand_1',
  implementer_persona: 'junior',
  current_round: 0,
  max_rounds: 4,
  status: 'pending',
  transcript: JSON.stringify({ rounds: [] }),
  next_comment_id: 1,
  mode: 'bug_finding',
};

const SESSION_IN_PROGRESS = {
  id: 'sess_1',
  challenge_id: 'ch_1',
  assessment_id: 'assessment_1',
  candidate_id: 'cand_1',
  implementer_persona: 'junior',
  current_round: 1,
  max_rounds: 4,
  status: 'in_progress',
  transcript: JSON.stringify({
    rounds: [
      {
        round: 1,
        reviewer_comments: [
          {
            id: 1,
            what: 'Missing test',
            why: 'No coverage',
            category: null,
            severity: 'major',
            positive: false,
          },
        ],
        reviewer_summary: 'Initial review',
        implementer_responses: [
          { to_comment_id: 1, move: 'comment', content: 'Will add tests' },
        ],
      },
    ],
  }),
  next_comment_id: 2,
  mode: 'bug_finding',
};

const SESSION_MAX_ROUNDS = {
  ...SESSION_IN_PROGRESS,
  current_round: 4,
  max_rounds: 4,
};

const SESSION_OTHER_CANDIDATE = {
  ...SESSION_PENDING,
  candidate_id: 'cand_other',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(callImplementerAgent).mockReset();
  vi.mocked(callImplementerAgent).mockResolvedValue([
    { to_comment_id: 1, move: 'comment', content: 'Mock implementer response' },
  ]);
});

// ─── POST /rpc/review/session/init ───────────────────────────────────────────

describe('POST /rpc/review/session/init', () => {
  it('returns 400 when challengeId is missing', async () => {
    const env = buildEnv();
    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({}),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when challenge is not multi-turn', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM challenges', value: CHALLENGE_NON_MULTITURN },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch_1' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('not configured for multi-turn review');
  });

  it('creates a pending session for a new candidate/challenge/assessment', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
        { match: 'FROM assessments', value: ASSESSMENT_ROW },
        { match: 'candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3', value: null },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch_1' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionId: string;
      status: string;
      maxRounds: number;
      currentRound: number;
      pr: unknown;
    };
    expect(body.status).toBe('pending');
    expect(body.maxRounds).toBe(4);
    expect(body.currentRound).toBe(0);
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const insertCall = db.__calls.find((c) => c.sql.includes('INSERT INTO review_sessions'));
    expect(insertCall).toBeTruthy();
    expect(insertCall?.ran).toBe(true);
  });

  it('returns an existing session if one already exists', async () => {
    const existing = { ...SESSION_PENDING, id: 'sess_existing', current_round: 2, max_rounds: 6 };
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
        { match: 'FROM assessments', value: ASSESSMENT_ROW },
        { match: 'candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3', value: existing },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch_1' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionId: string;
      status: string;
      maxRounds: number;
      currentRound: number;
    };
    expect(body.sessionId).toBe('sess_existing');
    expect(body.status).toBe('pending');
    expect(body.maxRounds).toBe(6);
    expect(body.currentRound).toBe(2);
  });

  it('returns correct PR metadata and diff', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
        { match: 'FROM assessments', value: ASSESSMENT_ROW },
        { match: 'candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3', value: null },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch_1' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pr: {
        title: string | null;
        description: string | null;
        repoUrl: string | null;
        prNumber: number | null;
        diff: string;
      };
    };
    expect(body.pr.title).toBe('Add feature');
    expect(body.pr.description).toBe('This PR adds a feature');
    expect(body.pr.repoUrl).toBe('https://github.com/test/repo');
    expect(body.pr.prNumber).toBe(1);
    expect(body.pr.diff).toContain('const x = 1;');
  });
});

// ─── POST /rpc/review/session/:id/message ────────────────────────────────────

describe('POST /rpc/review/session/:id/message', () => {
  it('first message: pending → in_progress, requires annotations + summary', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'implementer_persona', value: SESSION_PENDING },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          annotations: [{ content: 'Missing edge-case handling', file: 'src/index.ts', line: 5 }],
          summary: 'Initial review round',
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      round: number;
      agentResponse: Array<{ to_comment_id: number; move: string; content: string }>;
      threads: unknown[];
    };
    expect(body.round).toBe(1);
    expect(body.agentResponse).toHaveLength(1);
    expect(body.agentResponse[0]!.to_comment_id).toBe(1);
    expect(body.threads).toHaveLength(1);

    const statusUpdate = db.__calls.find(
      (c) => c.sql.includes('UPDATE review_sessions') && c.sql.includes("status = 'in_progress'"),
    );
    expect(statusUpdate).toBeTruthy();
    expect(statusUpdate?.ran).toBe(true);

    const transcriptUpdate = db.__calls.find(
      (c) => c.sql.includes('UPDATE review_sessions') && c.sql.includes('transcript = ?1'),
    );
    expect(transcriptUpdate).toBeTruthy();
    expect(transcriptUpdate?.ran).toBe(true);
  });

  it('follow-up message: appends round, respects maxRounds', async () => {
    vi.mocked(callImplementerAgent).mockResolvedValue([
      { to_comment_id: 1, move: 'change', content: 'Fixed in commit abc' },
    ]);

    const db = fakeD1({
      firstResponders: [
        { match: 'implementer_persona', value: SESSION_IN_PROGRESS },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          replies: [{ toCommentId: 1, content: 'Please fix this' }],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { round: number };
    expect(body.round).toBe(2);

    const transcriptUpdate = db.__calls.find(
      (c) => c.sql.includes('UPDATE review_sessions') && c.sql.includes('transcript = ?1'),
    );
    expect(transcriptUpdate).toBeTruthy();
    expect(transcriptUpdate?.ran).toBe(true);
  });

  it('returns 400 when max rounds reached', async () => {
    const db = fakeD1({
      firstResponders: [{ match: 'implementer_persona', value: SESSION_MAX_ROUNDS }],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          replies: [{ toCommentId: 1, content: 'One more thing' }],
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MAX_ROUNDS_REACHED');
  });

  it('returns 403 for wrong candidate', async () => {
    const db = fakeD1({
      firstResponders: [{ match: 'implementer_persona', value: SESSION_OTHER_CANDIDATE }],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          annotations: [{ content: 'Bug' }],
          summary: 'Review',
        }),
      },
      env,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when no valid comments are provided', async () => {
    const db = fakeD1({
      firstResponders: [{ match: 'implementer_persona', value: SESSION_IN_PROGRESS }],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          replies: [{ toCommentId: null, content: '' }],
          newAnnotations: [],
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('No valid replies or annotations');
  });
});

// ─── POST /rpc/review/session/:id/complete ───────────────────────────────────

describe('POST /rpc/review/session/:id/complete', () => {
  it('returns 400 for invalid verdict', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: SESSION_IN_PROGRESS,
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'invalid', summary: 'Looks good' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when summary is missing', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: SESSION_IN_PROGRESS,
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'approve' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('transitions session to verdict_submitted and writes submission', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: SESSION_IN_PROGRESS,
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'approve', summary: 'Solid work overall.' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; sessionId: string };
    expect(body.status).toBe('verdict_submitted');
    expect(body.sessionId).toBe('sess_1');

    const updateSession = db.__calls.find(
      (c) => c.sql.includes('UPDATE review_sessions') && c.sql.includes("status = 'verdict_submitted'"),
    );
    expect(updateSession).toBeTruthy();
    expect(updateSession?.ran).toBe(true);

    const insertSub = db.__calls.find((c) => c.sql.includes('INSERT INTO challenge_submissions'));
    expect(insertSub).toBeTruthy();
    expect(insertSub?.ran).toBe(true);

    const updateAssessment = db.__calls.find(
      (c) => c.sql.includes('UPDATE assessments') && c.sql.includes("status = 'COMPLETED'"),
    );
    expect(updateAssessment).toBeTruthy();
    expect(updateAssessment?.ran).toBe(true);
  });

  it('returns 409 when session is not in_progress', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: SESSION_PENDING,
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'approve', summary: 'Looks good' }),
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
  });

  it('returns 403 for wrong candidate', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: SESSION_OTHER_CANDIDATE,
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'approve', summary: 'Looks good' }),
      },
      env,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
