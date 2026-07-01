/**
 * REST tests for /rpc/dev-container/*.
 *
 * We drive the real rpcAuth Hono app via app.request() with a minimal
 * fake Env — no real D1 or DO. The fake D1 records every prepare/bind
 * call into a log so assertions can look for specific SQL fragments and
 * captured bind params.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rpcAuth, rpcPublic } from '../routes/rpc';
import { signJwt } from '../lib/jwt';
import { DevContainerDO } from '../durable-objects/DevContainerDO';
import type { Env } from '../types';

// ─── Fake D1 ─────────────────────────────────────────────────────────────────

interface PreparedCall {
  sql: string;
  params: unknown[];
  ran: boolean;
  firstResult: unknown;
}

interface StubConfig {
  /** Map from SQL substring → response row for `.first()` calls. */
  firstResponders?: Array<{
    match: string;
    value: unknown;
  }>;
}

interface FakeD1 extends D1Database {
  __calls: PreparedCall[];
}

function fakeD1(cfg: StubConfig = {}): FakeD1 {
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
        const match = (cfg.firstResponders ?? []).find((r) =>
          sql.includes(r.match),
        );
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

// ─── Fake DurableObject namespace for DevContainerDO ────────────────────────
//
// Actually instantiates the real DevContainerDO class with a minimal
// ctx.storage + the same fake D1, so the DO's real code runs and the test
// can assert D1 transitions end-to-end.

interface DoCall {
  sessionId: string;
  url: string;
  body: string | null;
}

interface FakeDevContainerNamespace extends DurableObjectNamespace {
  __calls: DoCall[];
}

function fakeDevContainerNamespace(env: Env): FakeDevContainerNamespace {
  const calls: DoCall[] = [];
  const instances = new Map<string, DevContainerDO>();

  function buildState(name: string): DurableObjectState<Record<string, never>> {
    const storage = new Map<string, unknown>();
    // Minimal container stub — satisfies the @cloudflare/containers Container
    // base class constructor check (ctx.container !== undefined) without
    // starting a real container process.
    const fakeContainer = {
      running: false,
      start: async () => {},
      stop: async () => {},
      fetch: async () => new Response('', { status: 200 }),
      getTcpPort: () => null,
    };
    return {
      id: { toString: () => name, name, equals: () => false } as unknown as DurableObjectId,
      storage: {
        get: async <T>(key: string) => storage.get(key) as T | undefined,
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
        delete: async (key: string) => storage.delete(key),
        deleteAll: async () => {
          storage.clear();
        },
        list: async () => new Map(),
        setAlarm: async () => {},
        getAlarm: async () => null,
        deleteAlarm: async () => {},
        sync: async () => {},
        transaction: async <T>(fn: (txn: unknown) => Promise<T>) => fn({}),
        transactionSync: <T>(fn: () => T) => fn(),
      } as unknown as DurableObjectStorage,
      container: fakeContainer as unknown as DurableObjectState['container'],
      waitUntil: () => {},
      blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
      abort: () => {},
      acceptWebSocket: () => {},
      getWebSockets: () => [],
      setWebSocketAutoResponse: () => {},
      getWebSocketAutoResponse: () => null,
      getWebSocketAutoResponseTimestamp: () => null,
      setHibernatableWebSocketEventTimeout: () => {},
      getHibernatableWebSocketEventTimeout: () => null,
      getTags: () => [],
    } as unknown as DurableObjectState<Record<string, never>>;
  }

  return {
    idFromName: (name: string) => ({
      toString: () => name,
      name,
      equals: () => false,
    }) as unknown as DurableObjectId,
    idFromString: (s: string) => ({ toString: () => s, name: s, equals: () => false }) as unknown as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'unique', name: 'unique', equals: () => false }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => {
      const name = id.toString();
      let instance = instances.get(name);
      if (!instance) {
        instance = new DevContainerDO(buildState(name), env);
        instances.set(name, instance);
      }
      return {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const req = input instanceof Request ? input : new Request(input, init);
          const clone = req.clone();
          const bodyText = req.method === 'POST' || req.method === 'PUT' ? await clone.text() : null;
          calls.push({ sessionId: name, url: req.url, body: bodyText });
          return instance!.fetch(req);
        },
        id,
        name,
      } as unknown as DurableObjectStub;
    },
    jurisdiction: () => ({} as unknown as DurableObjectNamespace),
    __calls: calls,
  } as unknown as FakeDevContainerNamespace;
}

function failingDevContainerNamespace(error: unknown): FakeDevContainerNamespace {
  const calls: DoCall[] = [];

  return {
    idFromName: (name: string) => ({
      toString: () => name,
      name,
      equals: () => false,
    }) as unknown as DurableObjectId,
    idFromString: (s: string) =>
      ({ toString: () => s, name: s, equals: () => false }) as unknown as DurableObjectId,
    newUniqueId: () =>
      ({ toString: () => 'unique', name: 'unique', equals: () => false }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => {
      const name = id.toString();
      return {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const req = input instanceof Request ? input : new Request(input, init);
          const clone = req.clone();
          const bodyText = req.method === 'POST' || req.method === 'PUT' ? await clone.text() : null;
          calls.push({ sessionId: name, url: req.url, body: bodyText });
          throw error;
        },
        id,
        name,
      } as unknown as DurableObjectStub;
    },
    jurisdiction: () => ({} as unknown as DurableObjectNamespace),
    __calls: calls,
  } as unknown as FakeDevContainerNamespace;
}

// ─── Proxy-only fake namespace ──────────────────────────────────────────────
//
// The proxy route hits `stub.fetch(rewrittenRequest)` — the real
// DevContainerDO.fetch() would call super.fetch() → containerFetch() →
// this.container.getTcpPort(), which throws under the minimal stub. For
// proxy tests we want to assert the route-level behavior (URL rewriting,
// auth, ownership, state filtering) without booting the real DO, so this
// namespace records the incoming forwarded Request and returns a canned
// response.

interface ProxyCall {
  sessionId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  search: string;
  path: string;
}

interface FakeProxyNamespace extends DurableObjectNamespace {
  __proxyCalls: ProxyCall[];
  __setResponse: (fn: () => Response) => void;
}

function fakeProxyNamespace(): FakeProxyNamespace {
  const calls: ProxyCall[] = [];
  let respond: () => Response = () => new Response('OK', { status: 200 });

  return {
    idFromName: (name: string) =>
      ({ toString: () => name, name, equals: () => false }) as unknown as DurableObjectId,
    idFromString: (s: string) =>
      ({ toString: () => s, name: s, equals: () => false }) as unknown as DurableObjectId,
    newUniqueId: () =>
      ({ toString: () => 'u', name: 'u', equals: () => false }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => {
      const name = id.toString();
      return {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const req = input instanceof Request ? input : new Request(input, init);
          const url = new URL(req.url);
          const headers: Record<string, string> = {};
          req.headers.forEach((v, k) => {
            headers[k] = v;
          });
          calls.push({
            sessionId: name,
            url: req.url,
            method: req.method,
            headers,
            search: url.search,
            path: url.pathname,
          });
          return respond();
        },
        id,
        name,
      } as unknown as DurableObjectStub;
    },
    jurisdiction: () => ({}) as unknown as DurableObjectNamespace,
    __proxyCalls: calls,
    __setResponse: (fn: () => Response) => {
      respond = fn;
    },
  } as unknown as FakeProxyNamespace;
}

// ─── Env stub ────────────────────────────────────────────────────────────────

interface TestEnv extends Record<string, unknown> {
  DB: FakeD1;
  DEV_CONTAINER: FakeDevContainerNamespace;
}

function buildEnv(overrides: Partial<TestEnv> & { DB?: FakeD1 } = {}): TestEnv {
  const db = overrides.DB ?? fakeD1();
  const env = {
    SESSION_TOKEN_SECRET: 'test-secret',
    DEV_CONTAINER_DEFAULT_TTL_SECONDS: '3600',
    DEV_CONTAINER_MAX_TTL_SECONDS: '7200',
    DEV_CONTAINER_WARN_BEFORE_SECONDS: '60',
    ...overrides,
    DB: db,
  } as TestEnv;
  env.DEV_CONTAINER =
    overrides.DEV_CONTAINER ?? fakeDevContainerNamespace(env as unknown as Env);
  return env;
}

// Synchronous executionCtx that collects waitUntil promises so tests can await them.
function buildCtx(): { ctx: ExecutionContext; waitUntilAll: () => Promise<void> } {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      promises.push(p);
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

async function authHeader(): Promise<string> {
  const token = await signJwt(
    { sub: 'cand_1', pid: 'pipe_1' },
    'test-secret',
  );
  return `Bearer ${token}`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /rpc/dev-container/launch', () => {
  beforeEach(() => {
    // no global state to reset
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      buildEnv(),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('creates a LAUNCHING session with ttl_source=GLOBAL when no challenge is provided', async () => {
    const db = fakeD1();
    const env = buildEnv({ DB: db });
    const { ctx } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({}),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      sessionId: string;
      status: string;
      ttlSeconds: number;
      ttlSource: string;
      expiresAt: string;
    };

    expect(body.status).toBe('LAUNCHING');
    expect(body.ttlSeconds).toBe(3600);
    expect(body.ttlSource).toBe('GLOBAL');
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    // expiresAt should be ~3600s in the future
    const deltaMs = new Date(body.expiresAt).getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(3500_000);
    expect(deltaMs).toBeLessThan(3700_000);

    // D1 fake should have seen exactly one INSERT, not a challenge SELECT
    const insertCall = db.__calls.find((c) => c.sql.includes('INSERT INTO dev_container_sessions'));
    expect(insertCall).toBeTruthy();
    expect(insertCall?.ran).toBe(true);
    // bind order: id, sessionId, candidateId, challengeId, pipelineId, instanceType, ttlSeconds, ttlSource, expiresAt, repoGitUrl, challengeBranch
    expect(insertCall?.params[2]).toBe('cand_1');
    expect(insertCall?.params[3]).toBe(null);
    expect(insertCall?.params[4]).toBe('pipe_1');
    expect(insertCall?.params[5]).toBe('standard-1');
    expect(insertCall?.params[6]).toBe(3600);
    expect(insertCall?.params[7]).toBe('GLOBAL');
  });

  it('uses the per-challenge TTL when a challenge specifies dev_container_ttl_seconds', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM challenges',
          value: {
            id: 'chg_abc',
            dev_container_ttl_seconds: 1800,
            repo_git_url: null,
            challenge_branch: null,
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });
    const { ctx } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'chg_abc' }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ttlSeconds: number; ttlSource: string };
    expect(body.ttlSeconds).toBe(1800);
    expect(body.ttlSource).toBe('CHALLENGE');

    const insertCall = db.__calls.find((c) =>
      c.sql.includes('INSERT INTO dev_container_sessions'),
    );
    expect(insertCall?.params[3]).toBe('chg_abc');
    expect(insertCall?.params[6]).toBe(1800);
    expect(insertCall?.params[7]).toBe('CHALLENGE');
  });

  it('clamps a challenge TTL above the hard cap down to DEV_CONTAINER_MAX_TTL_SECONDS', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM challenges',
          value: {
            id: 'chg_huge',
            dev_container_ttl_seconds: 999_999,
            repo_git_url: null,
            challenge_branch: null,
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });
    const { ctx } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'chg_huge' }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ttlSeconds: number };
    expect(body.ttlSeconds).toBe(7200);
  });

  it('invokes the DevContainer DO /__init and flips D1 row to READY', async () => {
    const db = fakeD1();
    const env = buildEnv({ DB: db });
    const { ctx, waitUntilAll } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({}),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { sessionId: string; expiresAt: string };

    // Drain the DO init promise queued on waitUntil.
    await waitUntilAll();

    // The DO namespace fake should have recorded one /__init fetch to the
    // session-scoped DO, with the expiresAt + ttl payload.
    expect(env.DEV_CONTAINER.__calls).toHaveLength(1);
    const doCall = env.DEV_CONTAINER.__calls[0];
    if (!doCall) throw new Error('expected a recorded DO call');
    expect(doCall.sessionId).toBe(body.sessionId);
    expect(doCall.url).toContain('/__init');
    const initPayload = JSON.parse(doCall.body ?? '{}') as {
      sessionId: string;
      expiresAt: string;
      ttlSeconds: number;
    };
    expect(initPayload.sessionId).toBe(body.sessionId);
    expect(initPayload.expiresAt).toBe(body.expiresAt);
    expect(initPayload.ttlSeconds).toBe(3600);

    // And the DO should have written an UPDATE to READY on the fake D1.
    const updateCall = db.__calls.find(
      (c) =>
        c.sql.includes('UPDATE dev_container_sessions') &&
        c.ran &&
        c.params[0] === 'READY',
    );
    expect(updateCall).toBeTruthy();
  });

  it('passes real Devin provider configuration to the container without returning secrets', async () => {
    const db = fakeD1();
    const env = buildEnv({
      DB: db,
      API_BASE_URL: 'https://api-dev.hire-pipe.com',
      DEVIN_API_KEY: 'test-devin-service-token',
      DEVIN_ORG_ID: 'test-devin-org',
    } as Partial<TestEnv>);
    const { ctx, waitUntilAll } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({}),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = await res.json() as { sessionId: string };
    await waitUntilAll();

    expect(env.DEV_CONTAINER.__calls).toHaveLength(1);
    const doCall = env.DEV_CONTAINER.__calls[0];
    if (!doCall) throw new Error('expected a recorded DO call');
    expect(doCall.sessionId).toBe(body.sessionId);
    const initPayload = JSON.parse(doCall.body ?? '{}') as {
      agentType?: string | null;
      agentApiKey?: string | null;
      agentOrgId?: string | null;
      pipeApiUrl?: string | null;
      roomToken?: string | null;
    };
    expect(initPayload).toMatchObject({
      agentType: 'devin',
      agentApiKey: 'test-devin-service-token',
      agentOrgId: 'test-devin-org',
      pipeApiUrl: 'https://api-dev.hire-pipe.com',
    });
    expect(initPayload.roomToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('test-devin-service-token');
  });

  it('marks the session ERROR with a redacted diagnostic when background DO init fails', async () => {
    const rawToken = 'session-secret-do-not-log';
    const rawServiceKey = 'cog_abcdefghijklmnopqrstuvwxyz123456';
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM dev_container_sessions',
          value: {
            id: 'row_1',
            session_id: 'sess_from_fake_d1',
            candidate_id: 'cand_1',
            challenge_id: null,
            pipeline_id: 'pipe_1',
            status: 'LAUNCHING',
            instance_type: 'standard-1',
            ttl_seconds: 3600,
            ttl_source: 'GLOBAL',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            warned_at: null,
            url: null,
            repo_git_url: null,
            challenge_branch: null,
            started_at: null,
            stopped_at: null,
            error_message: null,
            created_at: '2026-04-10T00:00:00.000Z',
            updated_at: '2026-04-10T00:00:00.000Z',
          },
        },
      ],
    });
    const env = buildEnv({
      DB: db,
      DEV_CONTAINER: failingDevContainerNamespace(
        new Error(
          `spawn failed DEVIN_API_KEY=${rawServiceKey} url=https://example.test/auth?token=${rawToken}`,
        ),
      ),
    });
    const { ctx, waitUntilAll } = buildCtx();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const res = await rpcAuth.request(
        '/dev-container/launch',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: await authHeader(),
          },
          body: JSON.stringify({}),
        },
        env,
        ctx,
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { sessionId: string; status: string };
      expect(body.status).toBe('LAUNCHING');

      await waitUntilAll();

      expect(env.DEV_CONTAINER.__calls).toHaveLength(1);
      const updateCall = db.__calls.find(
        (c) =>
          c.sql.includes('UPDATE dev_container_sessions') &&
          c.ran &&
          c.params[0] === 'ERROR',
      );
      expect(updateCall).toBeTruthy();
      expect(updateCall?.params[5]).toBe(body.sessionId);

      const diagnostic = updateCall?.params[4];
      expect(typeof diagnostic).toBe('string');
      expect(diagnostic).toContain('Dev-container init request failed');
      expect(diagnostic).toContain('DEVIN_API_KEY=[redacted]');
      expect(diagnostic).toContain('token=[redacted]');
      expect(diagnostic).not.toContain(rawServiceKey);
      expect(diagnostic).not.toContain(rawToken);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('GET /rpc/dev-container/:sessionId/status', () => {
  it('returns 404 when the session does not exist for this candidate', async () => {
    const db = fakeD1({
      firstResponders: [
        // No match for dev_container_sessions → first() returns null
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/dev-container/sess_unknown/status',
      {
        method: 'GET',
        headers: { Authorization: await authHeader() },
      },
      env,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 200 with status + expiresAt when the session is owned by the candidate', async () => {
    const expiresAt = new Date(Date.now() + 1800_000).toISOString();
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM dev_container_sessions',
          value: {
            id: 'row_1',
            session_id: 'sess_1',
            candidate_id: 'cand_1',
            challenge_id: null,
            pipeline_id: 'pipe_1',
            status: 'READY',
            instance_type: 'standard-1',
            ttl_seconds: 1800,
            ttl_source: 'CHALLENGE',
            expires_at: expiresAt,
            warned_at: null,
            url: 'https://example.test/proxy/',
            repo_git_url: null,
            challenge_branch: null,
            started_at: null,
            stopped_at: null,
            error_message: null,
            created_at: '2026-04-10T00:00:00.000Z',
            updated_at: '2026-04-10T00:00:00.000Z',
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/dev-container/sess_1/status',
      {
        method: 'GET',
        headers: { Authorization: await authHeader() },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionId: string;
      status: string;
      ttlSeconds: number;
      ttlSource: string;
      expiresAt: string;
      warnedAt: string | null;
      url: string | null;
      expiringSoon: boolean;
      errorMessage: string | null;
    };
    expect(body.sessionId).toBe('sess_1');
    expect(body.status).toBe('READY');
    expect(body.ttlSeconds).toBe(1800);
    expect(body.ttlSource).toBe('CHALLENGE');
    expect(body.expiresAt).toBe(expiresAt);
    expect(body.warnedAt).toBe(null);
    expect(body.url).toBe('https://example.test/proxy/');
    expect(body.expiringSoon).toBe(false);
    expect(body.errorMessage).toBe(null);

    // Ownership query binds (sessionId, candidateId)
    const selectCall = db.__calls.find((c) =>
      c.sql.includes('FROM dev_container_sessions'),
    );
    expect(selectCall?.params[0]).toBe('sess_1');
    expect(selectCall?.params[1]).toBe('cand_1');
  });

  it('reports expiringSoon=true once warned_at is populated', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM dev_container_sessions',
          value: {
            id: 'row_1',
            session_id: 'sess_1',
            candidate_id: 'cand_1',
            challenge_id: null,
            pipeline_id: 'pipe_1',
            status: 'READY',
            instance_type: 'standard-1',
            ttl_seconds: 3600,
            ttl_source: 'GLOBAL',
            expires_at: new Date(Date.now() + 30_000).toISOString(),
            warned_at: new Date().toISOString(),
            url: null,
            repo_git_url: null,
            challenge_branch: null,
            started_at: null,
            stopped_at: null,
            error_message: null,
            created_at: '2026-04-10T00:00:00.000Z',
            updated_at: '2026-04-10T00:00:00.000Z',
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/dev-container/sess_1/status',
      {
        method: 'GET',
        headers: { Authorization: await authHeader() },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { expiringSoon: boolean };
    expect(body.expiringSoon).toBe(true);
  });
});

// ─── Step 12: Per-challenge TTL override ────────────────────────────────────

describe('POST /rpc/dev-container/launch — per-challenge TTL (Step 12)', () => {
  it('Test A: per-challenge TTL overrides the global default', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM challenges',
          value: {
            id: 'ch-1',
            dev_container_ttl_seconds: 1800,
            repo_git_url: null,
            challenge_branch: null,
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });
    const { ctx } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch-1' }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ttlSeconds: number; ttlSource: string };
    expect(body.ttlSeconds).toBe(1800);
    expect(body.ttlSource).toBe('CHALLENGE');

    const insertCall = db.__calls.find((c) =>
      c.sql.includes('INSERT INTO dev_container_sessions'),
    );
    expect(insertCall?.ran).toBe(true);
    expect(insertCall?.params[3]).toBe('ch-1');
    expect(insertCall?.params[6]).toBe(1800);
    expect(insertCall?.params[7]).toBe('CHALLENGE');
  });

  it('Test B: per-challenge TTL above hardCap is clamped to DEV_CONTAINER_MAX_TTL_SECONDS', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM challenges',
          value: {
            id: 'ch-2',
            dev_container_ttl_seconds: 99999,
            repo_git_url: null,
            challenge_branch: null,
          },
        },
      ],
    });
    const env = buildEnv({
      DB: db,
      DEV_CONTAINER_MAX_TTL_SECONDS: '7200',
    } as Partial<TestEnv>);
    const { ctx } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch-2' }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ttlSeconds: number; ttlSource: string };
    expect(body.ttlSeconds).toBe(7200);
    expect(body.ttlSource).toBe('CHALLENGE');
  });

  it('Test C: missing challenge row falls back to global default', async () => {
    // No firstResponders for challenges → first() returns null
    const db = fakeD1();
    const env = buildEnv({ DB: db });
    const { ctx } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch-nonexistent' }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ttlSeconds: number; ttlSource: string };
    expect(body.ttlSource).toBe('GLOBAL');
    expect(body.ttlSeconds).toBe(3600);
  });
});

// ─── Step 13: Per-launch admin override ─────────────────────────────────────

describe('POST /rpc/dev-container/launch — admin TTL override (Step 13)', () => {
  it('Test D: correct admin header + secret → override is honored', async () => {
    const db = fakeD1();
    const env = buildEnv({
      DB: db,
      ADMIN_TTL_OVERRIDE_SECRET: 'test-secret',
    } as Partial<TestEnv>);
    const { ctx } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
          'X-Pipe-Admin-Override': 'test-secret',
        },
        body: JSON.stringify({ ttlSecondsOverride: 1200 }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ttlSeconds: number; ttlSource: string };
    expect(body.ttlSeconds).toBe(1200);
    expect(body.ttlSource).toBe('OVERRIDE');

    const insertCall = db.__calls.find((c) =>
      c.sql.includes('INSERT INTO dev_container_sessions'),
    );
    expect(insertCall?.params[6]).toBe(1200);
    expect(insertCall?.params[7]).toBe('OVERRIDE');
  });

  it('Test E: no admin header → override body field is silently ignored', async () => {
    const db = fakeD1();
    const env = buildEnv({ DB: db });
    const { ctx } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ ttlSecondsOverride: 1200 }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ttlSeconds: number; ttlSource: string };
    expect(body.ttlSource).toBe('GLOBAL');
    expect(body.ttlSeconds).toBe(3600);
  });

  it('Test F: wrong admin header value → override is ignored', async () => {
    const db = fakeD1();
    const env = buildEnv({
      DB: db,
      ADMIN_TTL_OVERRIDE_SECRET: 'correct-secret',
    } as Partial<TestEnv>);
    const { ctx } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
          'X-Pipe-Admin-Override': 'wrong-value',
        },
        body: JSON.stringify({ ttlSecondsOverride: 1200 }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ttlSeconds: number; ttlSource: string };
    expect(body.ttlSource).toBe('GLOBAL');
  });

  it('Test G: admin override beats per-challenge TTL and global default', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM challenges',
          value: {
            id: 'ch-3',
            dev_container_ttl_seconds: 1800,
            repo_git_url: null,
            challenge_branch: null,
          },
        },
      ],
    });
    const env = buildEnv({
      DB: db,
      ADMIN_TTL_OVERRIDE_SECRET: 'admin-secret',
    } as Partial<TestEnv>);
    const { ctx } = buildCtx();

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
          'X-Pipe-Admin-Override': 'admin-secret',
        },
        body: JSON.stringify({ challengeId: 'ch-3', ttlSecondsOverride: 600 }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ttlSeconds: number; ttlSource: string };
    expect(body.ttlSeconds).toBe(600);
    expect(body.ttlSource).toBe('OVERRIDE');
  });

  it('Test H: admin override below MIN_TTL_SECONDS (30s) returns 400 BAD_REQUEST', async () => {
    const db = fakeD1();
    const env = buildEnv({
      DB: db,
      ADMIN_TTL_OVERRIDE_SECRET: 'test-secret',
    } as Partial<TestEnv>);

    const res = await rpcAuth.request(
      '/dev-container/launch',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
          'X-Pipe-Admin-Override': 'test-secret',
        },
        body: JSON.stringify({ ttlSecondsOverride: 10 }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
  });
});

describe('POST /rpc/dev-container/:sessionId/destroy', () => {
  it('returns 404 when the session does not exist', async () => {
    const db = fakeD1();
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/dev-container/sess_unknown/destroy',
      {
        method: 'POST',
        headers: { Authorization: await authHeader() },
      },
      env,
    );

    expect(res.status).toBe(404);
  });

  it('marks the session STOPPED and returns 200', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM dev_container_sessions',
          value: {
            id: 'row_1',
            session_id: 'sess_1',
            candidate_id: 'cand_1',
            challenge_id: null,
            pipeline_id: 'pipe_1',
            status: 'READY',
            instance_type: 'standard-1',
            ttl_seconds: 3600,
            ttl_source: 'GLOBAL',
            expires_at: new Date(Date.now() + 1800_000).toISOString(),
            warned_at: null,
            url: null,
            repo_git_url: null,
            challenge_branch: null,
            started_at: null,
            stopped_at: null,
            error_message: null,
            created_at: '2026-04-10T00:00:00.000Z',
            updated_at: '2026-04-10T00:00:00.000Z',
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/dev-container/sess_1/destroy',
      {
        method: 'POST',
        headers: { Authorization: await authHeader() },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('STOPPED');

    // Should have issued an UPDATE with status = 'STOPPED'
    const updateCall = db.__calls.find(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall?.params[0]).toBe('STOPPED');
  });

  it('is idempotent — returns 200 without issuing a second UPDATE when already STOPPED', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM dev_container_sessions',
          value: {
            id: 'row_1',
            session_id: 'sess_1',
            candidate_id: 'cand_1',
            challenge_id: null,
            pipeline_id: 'pipe_1',
            status: 'STOPPED',
            instance_type: 'standard-1',
            ttl_seconds: 3600,
            ttl_source: 'GLOBAL',
            expires_at: new Date(Date.now() + 1800_000).toISOString(),
            warned_at: null,
            url: null,
            repo_git_url: null,
            challenge_branch: null,
            started_at: null,
            stopped_at: new Date().toISOString(),
            error_message: null,
            created_at: '2026-04-10T00:00:00.000Z',
            updated_at: '2026-04-10T00:00:00.000Z',
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/dev-container/sess_1/destroy',
      {
        method: 'POST',
        headers: { Authorization: await authHeader() },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('STOPPED');

    // No UPDATE should have run on the second destroy
    const updateCall = db.__calls.find(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    expect(updateCall).toBeUndefined();
  });
});

// ─── Step 9: Proxy passthrough ───────────────────────────────────────────────

describe('ALL /rpc/dev-container/:sessionId/proxy/* (Step 9)', () => {
  function readySessionRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'row_1',
      session_id: 'sess_1',
      candidate_id: 'cand_1',
      challenge_id: null,
      pipeline_id: 'pipe_1',
      status: 'READY',
      instance_type: 'standard-1',
      ttl_seconds: 3600,
      ttl_source: 'GLOBAL',
      expires_at: new Date(Date.now() + 1800_000).toISOString(),
      warned_at: null,
      url: null,
      repo_r2_key: null,
      challenge_branch: null,
      base_branch: null,
      started_at: null,
      stopped_at: null,
      error_message: null,
      created_at: '2026-04-10T00:00:00.000Z',
      updated_at: '2026-04-10T00:00:00.000Z',
      ...overrides,
    };
  }

  function buildProxyEnv(row: unknown): TestEnv {
    const db = fakeD1({
      firstResponders: [{ match: 'FROM dev_container_sessions', value: row }],
    });
    const env = buildEnv({ DB: db });
    // Swap the DO namespace for one that doesn't boot the real container class.
    env.DEV_CONTAINER = fakeProxyNamespace() as unknown as FakeDevContainerNamespace;
    return env;
  }

  it('returns 401 when the Authorization header is missing', async () => {
    const env = buildProxyEnv(readySessionRow());
    const res = await rpcAuth.request(
      '/dev-container/sess_1/proxy/',
      { method: 'GET' },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the session does not belong to the candidate', async () => {
    const env = buildProxyEnv(null);
    const res = await rpcAuth.request(
      '/dev-container/sess_1/proxy/',
      { method: 'GET', headers: { Authorization: await authHeader() } },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('rewrites the URL, strips the candidate token, and forwards to the DO stub', async () => {
    const env = buildProxyEnv(readySessionRow());
    const proxyNs = env.DEV_CONTAINER as unknown as FakeProxyNamespace;
    proxyNs.__setResponse(() =>
      new Response('hello from code-server', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const res = await rpcAuth.request(
      '/dev-container/sess_1/proxy/static/code-server.js?token=leak-me&v=1',
      {
        method: 'GET',
        headers: {
          Authorization: await authHeader(),
          'X-Requested-With': 'iframe',
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello from code-server');

    expect(proxyNs.__proxyCalls).toHaveLength(1);
    const forwarded = proxyNs.__proxyCalls[0]!;
    expect(forwarded.sessionId).toBe('sess_1');
    // Prefix stripped — container sees the inner path
    expect(forwarded.path).toBe('/static/code-server.js');
    // Session JWT removed but app query params preserved
    expect(forwarded.search).toBe('?v=1');
    // Custom headers pass through
    expect(forwarded.headers['x-requested-with']).toBe('iframe');
  });

  it('forwards root `/` when the path has no trailing segment', async () => {
    const env = buildProxyEnv(readySessionRow());
    const proxyNs = env.DEV_CONTAINER as unknown as FakeProxyNamespace;

    const res = await rpcAuth.request(
      '/dev-container/sess_1/proxy/',
      { method: 'GET', headers: { Authorization: await authHeader() } },
      env,
    );

    expect(res.status).toBe(200);
    expect(proxyNs.__proxyCalls[0]?.path).toBe('/');
  });

  it('returns 425 NOT_READY while the session is still LAUNCHING', async () => {
    const env = buildProxyEnv(readySessionRow({ status: 'LAUNCHING' }));
    const res = await rpcAuth.request(
      '/dev-container/sess_1/proxy/',
      { method: 'GET', headers: { Authorization: await authHeader() } },
      env,
    );
    expect(res.status).toBe(425);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('NOT_READY');
  });

  it('returns 410 SESSION_ENDED once the session is STOPPED', async () => {
    const env = buildProxyEnv(readySessionRow({ status: 'STOPPED' }));
    const res = await rpcAuth.request(
      '/dev-container/sess_1/proxy/index.html',
      { method: 'GET', headers: { Authorization: await authHeader() } },
      env,
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('SESSION_ENDED');
  });

  it('accepts a SLEEPING session — the DO will wake the container', async () => {
    const env = buildProxyEnv(readySessionRow({ status: 'SLEEPING' }));
    const proxyNs = env.DEV_CONTAINER as unknown as FakeProxyNamespace;
    const res = await rpcAuth.request(
      '/dev-container/sess_1/proxy/',
      { method: 'GET', headers: { Authorization: await authHeader() } },
      env,
    );
    expect(res.status).toBe(200);
    expect(proxyNs.__proxyCalls).toHaveLength(1);
  });

  it('passes candidate-auth query token for WebSocket upgrades via the ?token= fallback', async () => {
    const env = buildProxyEnv(readySessionRow());
    const proxyNs = env.DEV_CONTAINER as unknown as FakeProxyNamespace;

    const token = await signJwt({ sub: 'cand_1', pid: 'pipe_1' }, 'test-secret');
    const res = await rpcAuth.request(
      `/dev-container/sess_1/proxy/vscode?token=${token}&ws=1`,
      {
        method: 'GET',
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    const forwarded = proxyNs.__proxyCalls[0]!;
    // candidate token stripped, remaining query preserved
    expect(forwarded.search).toBe('?ws=1');
    expect(forwarded.path).toBe('/vscode');
    // Upgrade header passed through
    expect(forwarded.headers['upgrade']).toBe('websocket');
  });

  it('sets a scoped proxy cookie so iframe redirects work after the exchange token is consumed', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'UPDATE dev_container_exchange_tokens',
          value: {
            session_id: 'sess_1',
            candidate_id: 'cand_1',
          },
        },
        {
          match: 'FROM dev_container_sessions',
          value: readySessionRow(),
        },
      ],
    });
    const env = buildEnv({ DB: db });
    env.DEV_CONTAINER = fakeProxyNamespace() as unknown as FakeDevContainerNamespace;
    const proxyNs = env.DEV_CONTAINER as unknown as FakeProxyNamespace;
    proxyNs.__setResponse(
      () =>
        new Response('redirect', {
          status: 302,
          headers: { Location: './?folder=/workspace' },
        }),
    );

    const first = await rpcPublic.request(
      '/dev-container-proxy/sess_1/?exchangeToken=exchange_1',
      { method: 'GET' },
      env,
    );

    expect(first.status).toBe(302);
    expect(first.headers.get('Location')).toBe('./?folder=/workspace');
    const setCookie = first.headers.get('Set-Cookie');
    expect(setCookie).toContain('pipe_dev_container_proxy=');
    expect(setCookie).toContain('Path=/rpc/dev-container-proxy/sess_1');
    expect(proxyNs.__proxyCalls).toHaveLength(1);
    expect(proxyNs.__proxyCalls[0]?.search).toBe('');

    proxyNs.__setResponse(() => new Response('code-server html', { status: 200 }));
    const cookie = setCookie?.split(';')[0] ?? '';
    const redirected = await rpcPublic.request(
      '/dev-container-proxy/sess_1/?folder=/workspace',
      {
        method: 'GET',
        headers: { Cookie: cookie },
      },
      env,
    );

    expect(redirected.status).toBe(200);
    expect(await redirected.text()).toBe('code-server html');
    expect(proxyNs.__proxyCalls).toHaveLength(2);
    expect(proxyNs.__proxyCalls[1]?.search).toBe('?folder=%2Fworkspace');
  });
});
