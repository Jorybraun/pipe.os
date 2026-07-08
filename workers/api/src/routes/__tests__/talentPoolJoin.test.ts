import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import { sendTransactionalEmail } from '../../lib/transactionalEmail';
import { talentPoolPublic } from '../talentPool';
import type { Env, Variables } from '../../types';

vi.mock('../../lib/candidateDiscovery/orchestrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/candidateDiscovery/orchestrate')>();
  return { ...actual, runCandidateIngestion: vi.fn(async () => undefined) };
});

vi.mock('../../lib/transactionalEmail', () => ({
  sendTransactionalEmail: vi.fn(async () => ({ provider: 'resend', id: 'email-1' })),
}));

const sendEmailMock = vi.mocked(sendTransactionalEmail);

const HOUSE_OWNER = 'user_house_talent_pool';

interface CandidateRow {
  id: string;
  owner_id: string;
  name: string | null;
  email: string | null;
  invite_token: string;
  status: string;
  pipeline_id: string | null;
}

function createSqlite(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      invite_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('INVITED', 'IN_PROGRESS', 'COMPLETED')),
      pipeline_id TEXT,
      current_stage_id TEXT,
      resume_s3_key TEXT,
      phone_number TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  return sqlite;
}

function createEnv(sqlite: BetterSqliteDb, overrides: Partial<Env> = {}): Env {
  return {
    DB: createMockD1(sqlite),
    APP_BASE_URL: 'https://app.hire-pipe.com',
    TALENT_POOL_HOUSE_OWNER_ID: HOUSE_OWNER,
    ...overrides,
  } as Env;
}

function createApp(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/rpc/talent', talentPoolPublic);
  return app;
}

function postJoin(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  env: Env,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(
    '/rpc/talent/join',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

function allCandidates(sqlite: BetterSqliteDb): CandidateRow[] {
  return sqlite.prepare('SELECT * FROM candidates').all() as CandidateRow[];
}

describe('POST /rpc/talent/join — self-serve talent pool entry', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = createSqlite();
    sendEmailMock.mockClear();
    sendEmailMock.mockResolvedValue({ provider: 'resend', id: 'email-1' });
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
  });

  it('returns 503 when self-serve join is not configured (no house owner)', async () => {
    const app = createApp();
    const env = createEnv(sqlite, { TALENT_POOL_HOUSE_OWNER_ID: undefined });

    const res = await postJoin(app, env, { email: 'dev@example.com' });

    expect(res.status).toBe(503);
    expect(allCandidates(sqlite)).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid email with 400 and sends nothing', async () => {
    const app = createApp();

    const res = await postJoin(app, createEnv(sqlite), { email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(allCandidates(sqlite)).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('creates a standalone house candidate and emails the intake link', async () => {
    const app = createApp();

    const res = await postJoin(app, createEnv(sqlite), {
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual({ ok: true, email: 'ada@example.com' });

    const rows = allCandidates(sqlite);
    expect(rows).toHaveLength(1);
    expect(rows[0].owner_id).toBe(HOUSE_OWNER);
    expect(rows[0].name).toBe('Ada Lovelace');
    expect(rows[0].email).toBe('ada@example.com');
    expect(rows[0].status).toBe('INVITED');
    expect(rows[0].pipeline_id).toBeNull();
    expect(rows[0].invite_token).toMatch(/^[0-9a-f]{32}$/);

    const email = sendEmailMock.mock.calls.map(([, input]) => input).find((i) => i.to === 'ada@example.com');
    expect(email).toBeDefined();
    const text = `${email?.text ?? ''}${email?.html ?? ''}`;
    expect(text).toContain(`https://app.hire-pipe.com/talent/${rows[0].invite_token}`);
  });

  it('never leaks the invite token or internal ids in the response body', async () => {
    const app = createApp();

    const res = await postJoin(app, createEnv(sqlite), { email: 'ada@example.com' });

    expect(res.status).toBe(201);
    const raw = await res.text();
    const row = allCandidates(sqlite)[0];
    expect(raw).not.toContain(row.invite_token);
    expect(raw).not.toContain(row.id);
    expect(raw).not.toContain(HOUSE_OWNER);
  });

  it('is idempotent per email: re-joining reuses the candidate and resends the same link', async () => {
    const app = createApp();
    await postJoin(app, createEnv(sqlite), { email: 'ada@example.com', name: 'Ada' });
    const firstToken = allCandidates(sqlite)[0].invite_token;
    sendEmailMock.mockClear();

    const res = await postJoin(app, createEnv(sqlite), { email: 'ADA@example.com' });

    expect(res.status).toBe(200);
    const rows = allCandidates(sqlite);
    expect(rows).toHaveLength(1);
    expect(rows[0].invite_token).toBe(firstToken);

    const email = sendEmailMock.mock.calls.map(([, input]) => input).find((i) => i.to === 'ada@example.com');
    const text = `${email?.text ?? ''}${email?.html ?? ''}`;
    expect(text).toContain(firstToken);
  });

  it('fails loudly when the link email cannot be sent, and a retry succeeds with the same candidate', async () => {
    const app = createApp();
    sendEmailMock.mockRejectedValueOnce(new Error('resend down'));

    const first = await postJoin(app, createEnv(sqlite), { email: 'ada@example.com' });
    expect(first.status).toBe(502);
    expect(allCandidates(sqlite)).toHaveLength(1);

    const retry = await postJoin(app, createEnv(sqlite), { email: 'ada@example.com' });
    expect(retry.status).toBe(200);
    expect(allCandidates(sqlite)).toHaveLength(1);
  });

  it('tolerates email failure in local dev (localhost app base), still without leaking the token', async () => {
    const app = createApp();
    const env = createEnv(sqlite, { APP_BASE_URL: 'http://localhost:5173' });
    sendEmailMock.mockRejectedValueOnce(new Error('resend test key restriction'));

    const res = await postJoin(app, env, { email: 'ada@example.com' });

    expect(res.status).toBe(201);
    const raw = await res.text();
    expect(raw).not.toContain(allCandidates(sqlite)[0].invite_token);
  });

  describe('Turnstile protection', () => {
    it('rejects joins without a turnstile token when TURNSTILE_SECRET_KEY is set', async () => {
      const app = createApp();
      const env = createEnv(sqlite, { TURNSTILE_SECRET_KEY: 'ts-secret' });

      const res = await postJoin(app, env, { email: 'ada@example.com' });

      expect(res.status).toBe(403);
      expect(allCandidates(sqlite)).toHaveLength(0);
    });

    it('rejects joins when Turnstile verification fails', async () => {
      const app = createApp();
      const env = createEnv(sqlite, { TURNSTILE_SECRET_KEY: 'ts-secret' });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));

      const res = await postJoin(app, env, { email: 'ada@example.com', turnstileToken: 'bad-token' });

      expect(res.status).toBe(403);
      expect(allCandidates(sqlite)).toHaveLength(0);
    });

    it('accepts joins with a valid Turnstile token', async () => {
      const app = createApp();
      const env = createEnv(sqlite, { TURNSTILE_SECRET_KEY: 'ts-secret' });
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const res = await postJoin(app, env, { email: 'ada@example.com', turnstileToken: 'good-token' });

      expect(res.status).toBe(201);
      expect(allCandidates(sqlite)).toHaveLength(1);
      const [verifyUrl, verifyInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(verifyUrl).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      expect(String(verifyInit.body)).toContain('ts-secret');
    });
  });
});
