import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import { sendTransactionalEmail } from '../../lib/transactionalEmail';
import { waitlist } from '../waitlist';
import type { Env, Variables } from '../../types';

vi.mock('../../lib/transactionalEmail', () => ({
  sendTransactionalEmail: vi.fn(async () => ({ provider: 'resend', id: 'email-1' })),
}));

const waitlistMigration = readFileSync(
  new URL('../../../migrations/0074_waitlist.sql', import.meta.url),
  'utf8',
);

const sendEmailMock = vi.mocked(sendTransactionalEmail);

function createSqlite(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec(waitlistMigration);
  return sqlite;
}

function createEnv(sqlite: BetterSqliteDb, overrides: Partial<Env> = {}): Env {
  return {
    DB: createMockD1(sqlite),
    WAITLIST_NOTIFY_EMAIL: 'founder@hire-pipe.com',
    PILOT_BOOKING_URL: 'https://cal.com/hans-pipe/pilot',
    ...overrides,
  } as Env;
}

function createApp(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/api/v1/waitlist', waitlist);
  return app;
}

function buildCtx(): { ctx: ExecutionContext; waitUntilAll: () => Promise<void> } {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      promises.push(promise);
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return {
    ctx,
    waitUntilAll: async () => {
      await Promise.all(promises);
    },
  };
}

function postLead(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  env: Env,
  ctx: ExecutionContext,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(
    '/api/v1/waitlist',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
    ctx,
  );
}

const LEAD = {
  email: 'vp-eng@acme.dev',
  name: 'Robin Vega',
  company: 'Acme',
  role: 'vp-engineering',
  teamSize: '11-50',
  painPoint: 'Senior backend hires take 90 days',
};

describe('POST /api/v1/waitlist — lead capture with founder alert + auto-reply', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = createSqlite();
    sendEmailMock.mockClear();
    sendEmailMock.mockResolvedValue({ provider: 'resend', id: 'email-1' });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('stores the lead and returns 201', async () => {
    const app = createApp();
    const { ctx, waitUntilAll } = buildCtx();

    const res = await postLead(app, createEnv(sqlite), ctx, LEAD);
    await waitUntilAll();

    expect(res.status).toBe(201);
    const row = sqlite
      .prepare('SELECT email, name, company FROM waitlist WHERE email = ?')
      .get(LEAD.email) as { email: string; name: string; company: string } | undefined;
    expect(row).toEqual({ email: LEAD.email, name: LEAD.name, company: LEAD.company });
  });

  it('sends a founder alert containing the lead details, reply-to the lead', async () => {
    const app = createApp();
    const { ctx, waitUntilAll } = buildCtx();

    const res = await postLead(app, createEnv(sqlite), ctx, LEAD);
    await waitUntilAll();

    expect(res.status).toBe(201);
    const founderCall = sendEmailMock.mock.calls
      .map(([, input]) => input)
      .find((input) => input.to === 'founder@hire-pipe.com');
    expect(founderCall).toBeDefined();
    expect(founderCall?.replyTo).toBe(LEAD.email);
    expect(founderCall?.subject).toContain(LEAD.email);
    const body = `${founderCall?.text ?? ''}${founderCall?.html ?? ''}`;
    expect(body).toContain(LEAD.name);
    expect(body).toContain(LEAD.company);
    expect(body).toContain(LEAD.painPoint);
  });

  it('sends the lead an auto-reply containing the pilot booking link', async () => {
    const app = createApp();
    const { ctx, waitUntilAll } = buildCtx();

    const res = await postLead(app, createEnv(sqlite), ctx, LEAD);
    await waitUntilAll();

    expect(res.status).toBe(201);
    const autoReply = sendEmailMock.mock.calls
      .map(([, input]) => input)
      .find((input) => input.to === LEAD.email);
    expect(autoReply).toBeDefined();
    const body = `${autoReply?.text ?? ''}${autoReply?.html ?? ''}`;
    expect(body).toContain('https://cal.com/hans-pipe/pilot');
  });

  it('still returns 201 and stores the lead when email sending fails', async () => {
    const app = createApp();
    const { ctx, waitUntilAll } = buildCtx();
    sendEmailMock.mockRejectedValue(new Error('resend down'));

    const res = await postLead(app, createEnv(sqlite), ctx, LEAD);
    await waitUntilAll();

    expect(res.status).toBe(201);
    const row = sqlite.prepare('SELECT email FROM waitlist WHERE email = ?').get(LEAD.email);
    expect(row).toBeDefined();
  });

  it('skips the founder alert when WAITLIST_NOTIFY_EMAIL is unset but still auto-replies', async () => {
    const app = createApp();
    const { ctx, waitUntilAll } = buildCtx();

    const env = createEnv(sqlite, { WAITLIST_NOTIFY_EMAIL: undefined });
    const res = await postLead(app, env, ctx, LEAD);
    await waitUntilAll();

    expect(res.status).toBe(201);
    const recipients = sendEmailMock.mock.calls.map(([, input]) => input.to);
    expect(recipients).not.toContain('founder@hire-pipe.com');
    expect(recipients).toContain(LEAD.email);
  });

  it('omits the booking link from the auto-reply when PILOT_BOOKING_URL is unset', async () => {
    const app = createApp();
    const { ctx, waitUntilAll } = buildCtx();

    const env = createEnv(sqlite, { PILOT_BOOKING_URL: undefined });
    const res = await postLead(app, env, ctx, LEAD);
    await waitUntilAll();

    expect(res.status).toBe(201);
    const autoReply = sendEmailMock.mock.calls
      .map(([, input]) => input)
      .find((input) => input.to === LEAD.email);
    expect(autoReply).toBeDefined();
    const body = `${autoReply?.text ?? ''}${autoReply?.html ?? ''}`;
    expect(body).not.toContain('cal.com');
  });

  it('notifies again when a returning lead resubmits (upsert path)', async () => {
    const app = createApp();
    const first = buildCtx();
    await postLead(app, createEnv(sqlite), first.ctx, LEAD);
    await first.waitUntilAll();
    sendEmailMock.mockClear();

    const second = buildCtx();
    const res = await postLead(app, createEnv(sqlite), second.ctx, {
      ...LEAD,
      message: 'Following up — we have budget approved now.',
    });
    await second.waitUntilAll();

    expect(res.status).toBe(201);
    const founderCall = sendEmailMock.mock.calls
      .map(([, input]) => input)
      .find((input) => input.to === 'founder@hire-pipe.com');
    expect(founderCall).toBeDefined();
    const body = `${founderCall?.text ?? ''}${founderCall?.html ?? ''}`;
    expect(body).toContain('budget approved');
  });

  it('sends no emails for an invalid submission', async () => {
    const app = createApp();
    const { ctx, waitUntilAll } = buildCtx();

    const res = await postLead(app, createEnv(sqlite), ctx, { email: 'not-an-email' });
    await waitUntilAll();

    expect(res.status).toBe(422);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
