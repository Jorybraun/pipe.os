/**
 * Unit tests for DevContainerDO internals (Step 10 — TTL destroy alarm).
 *
 * The DO is instantiated as a plain class with a fake ctx + env. The
 * `@cloudflare/containers` Container base class is stubbed (see
 * `stubs/cloudflare-containers.ts`) so schedule/stop/destroy become
 * inspectable spy methods instead of hitting sqlite or workerd.
 */

import { describe, it, expect } from 'vitest';
import { DevContainerDO } from '../durable-objects/DevContainerDO';
import type { Env } from '../types';

// The `@cloudflare/containers` type checker sees the real package, not the
// test stub, so the stub-only spy fields are invisible to TS. Cast through
// this intersection whenever we need to read them.
interface SpyFields {
  __schedules: Array<{ when: Date | number; callback: string; payload: unknown }>;
  __startCalls: unknown[];
  __destroyCalls: number;
  __stopCalls: Array<number | string>;
}
type SpyableDO = DevContainerDO & SpyFields;

// ─── D1 fake ────────────────────────────────────────────────────────────────

interface PreparedCall {
  sql: string;
  params: unknown[];
  ran: boolean;
}

interface FakeD1 extends D1Database {
  __calls: PreparedCall[];
}

function fakeD1(): FakeD1 {
  const calls: PreparedCall[] = [];
  const prepare = (sql: string): D1PreparedStatement => {
    const call: PreparedCall = { sql, params: [], ran: false };
    calls.push(call);
    const stmt = {
      bind: (...params: unknown[]) => {
        call.params = params;
        return stmt;
      },
      first: async () => null,
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

// ─── DO state fake ──────────────────────────────────────────────────────────

function buildState(): DurableObjectState<Record<string, never>> {
  const storage = new Map<string, unknown>();
  const fakeContainer = {
    running: false,
    start: async () => {},
    stop: async () => {},
    fetch: async () => new Response('', { status: 200 }),
    getTcpPort: () => null,
  };
  return {
    id: { toString: () => 'test', name: 'test', equals: () => false } as unknown as DurableObjectId,
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

function buildEnv(
  db: FakeD1 = fakeD1(),
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: db,
    DEV_CONTAINER_WARN_BEFORE_SECONDS: '60',
    ...overrides,
  } as unknown as Env;
}

async function init(
  instance: DevContainerDO,
  payload: {
    sessionId: string;
    expiresAt: string;
    ttlSeconds: number;
    repoGitUrl?: string | null;
    challengeBranch?: string | null;
    baseCommitSha?: string | null;
    agentType?: string | null;
  },
): Promise<Response> {
  return instance.fetch(
    new Request('https://do.internal/__init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoGitUrl: null,
        challengeBranch: null,
        baseCommitSha: null,
        ...payload,
      }),
    }),
  );
}

// ─── /__init scheduling ─────────────────────────────────────────────────────

describe('DevContainerDO /__init — Step 11 warn-then-expire scheduling', () => {
  it('starts the shared bridge/router port before marking the session READY', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    const res = await init(instance, {
      sessionId: 'sess_start',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ttlSeconds: 3600,
      repoGitUrl: 'https://github.com/example/repo.git',
      challengeBranch: 'challenge/fix',
    });

    expect(res.status).toBe(200);
    expect(instance.__startCalls).toHaveLength(1);

    const [startArg] = instance.__startCalls[0] as [
      {
        ports: number[];
        startOptions: { envVars: Record<string, string>; entrypoint?: string[] };
      },
    ];
    expect(startArg.ports).toEqual([8080]);
    expect(startArg.startOptions.envVars).toMatchObject({
      SESSION_ID: 'sess_start',
      WORKSPACE_DIR: '/workspace',
      AGENT_BRIDGE_PORT: '8080',
      CODE_SERVER_PORT: '8082',
      REPO_GIT_URL: 'https://github.com/example/repo.git',
      CHALLENGE_BRANCH: 'challenge/fix',
    });
    expect(startArg.startOptions.envVars).not.toHaveProperty('AGENT_TYPE');
    expect(startArg.startOptions).not.toHaveProperty('entrypoint');

    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    const ready = updates.find((c) => c.params[0] === 'READY');
    expect(ready?.params[2]).toEqual(expect.any(String));
    expect(ready?.params[5]).toBe('sess_start');
  });

  it('passes the exact challenge base commit to the container entrypoint', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;
    const baseCommitSha = 'f'.repeat(40);

    const res = await init(instance, {
      sessionId: 'sess_base_commit',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ttlSeconds: 3600,
      repoGitUrl: 'https://github.com/example/repo.git',
      baseCommitSha,
    });

    expect(res.status).toBe(200);
    const [startArg] = instance.__startCalls[0] as [
      {
        ports: number[];
        startOptions: { envVars: Record<string, string>; entrypoint?: string[] };
      },
    ];
    expect(startArg.startOptions.envVars).toMatchObject({
      REPO_GIT_URL: 'https://github.com/example/repo.git',
      CHALLENGE_BASE_COMMIT_SHA: baseCommitSha,
    });
    expect(startArg.startOptions.envVars).not.toHaveProperty('CHALLENGE_BRANCH');
  });

  it('passes through an explicit real agent type without inventing a default', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    const res = await init(instance, {
      sessionId: 'sess_agent',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ttlSeconds: 3600,
      agentType: 'devin',
    });

    expect(res.status).toBe(200);
    const [startArg] = instance.__startCalls[0] as [
      {
        ports: number[];
        startOptions: { envVars: Record<string, string>; entrypoint?: string[] };
      },
    ];
    expect(startArg.startOptions.envVars.AGENT_TYPE).toBe('devin');
  });

  it('marks the session ERROR when the container cannot start', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    instance.startAndWaitForPorts = async (...args: unknown[]) => {
      instance.__startCalls.push(args);
      throw new Error('port 8080 never opened');
    };

    const res = await init(instance, {
      sessionId: 'sess_start_fail',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ttlSeconds: 3600,
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'CONTAINER_START_FAILED',
        message: 'port 8080 never opened',
      },
    });
    expect(instance.__schedules).toHaveLength(0);

    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    const last = updates[updates.length - 1]!;
    expect(last.params[0]).toBe('ERROR');
    expect(last.params[4]).toBe('port 8080 never opened');
    expect(last.params[5]).toBe('sess_start_fail');
  });

  it('schedules an onWarn callback at expiresAt − WARN_BEFORE_SECONDS by default', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    const expireMs = Date.now() + 3600_000;
    const expiresAt = new Date(expireMs).toISOString();
    const res = await init(instance, {
      sessionId: 'sess_1',
      expiresAt,
      ttlSeconds: 3600,
    });

    expect(res.status).toBe(200);

    // Only the warn is scheduled at /__init time; onExpire gets rescheduled
    // later when onWarn fires.
    expect(instance.__schedules).toHaveLength(1);
    const [call] = instance.__schedules;
    expect(call?.callback).toBe('onWarn');
    expect(call?.when).toBeInstanceOf(Date);
    expect((call?.when as Date).getTime()).toBe(expireMs - 60_000);
  });

  it('schedules onExpire directly when the warn window exceeds remaining TTL', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    // 30s TTL but warn window is 60s → too late to warn, go straight to expire.
    const expireMs = Date.now() + 30_000;
    const expiresAt = new Date(expireMs).toISOString();
    const res = await init(instance, {
      sessionId: 'sess_short',
      expiresAt,
      ttlSeconds: 30,
    });

    expect(res.status).toBe(200);
    expect(instance.__schedules).toHaveLength(1);
    const [call] = instance.__schedules;
    expect(call?.callback).toBe('onExpire');
    expect((call?.when as Date).toISOString()).toBe(expiresAt);
  });

  it('respects a custom DEV_CONTAINER_WARN_BEFORE_SECONDS env value', async () => {
    const db = fakeD1();
    const env = buildEnv(db, {
      DEV_CONTAINER_WARN_BEFORE_SECONDS: '10',
    } as Partial<Env>);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    const expireMs = Date.now() + 60_000;
    const expiresAt = new Date(expireMs).toISOString();
    await init(instance, {
      sessionId: 'sess_custom',
      expiresAt,
      ttlSeconds: 60,
    });

    expect(instance.__schedules).toHaveLength(1);
    const [call] = instance.__schedules;
    expect(call?.callback).toBe('onWarn');
    expect((call?.when as Date).getTime()).toBe(expireMs - 10_000);
  });

  it('skips scheduling when expiresAt is not a valid date', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    const res = await init(instance, {
      sessionId: 'sess_bad',
      expiresAt: 'not-a-date',
      ttlSeconds: 3600,
    });

    // /__init still transitions to READY — the TTL alarm is an
    // independent failure mode that shouldn't abort launch.
    expect(res.status).toBe(200);
    expect(instance.__schedules).toHaveLength(0);
  });

  it('persists init payload to storage so onExpire can read sessionId later', async () => {
    const state = buildState();
    const env = buildEnv();
    const instance = new DevContainerDO(state, env);

    const expiresAt = new Date(Date.now() + 1800_000).toISOString();
    await init(instance, {
      sessionId: 'sess_cfg',
      expiresAt,
      ttlSeconds: 1800,
    });

    const stored = await state.storage.get<{ sessionId: string; expiresAt: string }>('config');
    expect(stored?.sessionId).toBe('sess_cfg');
    expect(stored?.expiresAt).toBe(expiresAt);
  });
});

// ─── Container lifecycle evidence ────────────────────────────────────────────

describe('DevContainerDO container lifecycle evidence', () => {
  it('marks an idle container as SLEEPING before stopping it', async () => {
    const db = fakeD1();
    const state = buildState();
    const env = buildEnv(db);
    const instance = new DevContainerDO(state, env) as SpyableDO;

    await init(instance, {
      sessionId: 'sess_sleep',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ttlSeconds: 3600,
    });
    instance.__stopCalls.length = 0;

    await instance.onActivityExpired();

    expect(instance.__stopCalls).toEqual([15]);
    expect(await state.storage.get('intentional_sleep_stop')).toBe(true);
    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    const last = updates[updates.length - 1]!;
    expect(last.params[0]).toBe('SLEEPING');
    expect(last.params[5]).toBe('sess_sleep');
  });

  it('does not convert an intentional sleep stop into an ERROR', async () => {
    const db = fakeD1();
    const state = buildState();
    const env = buildEnv(db);
    const instance = new DevContainerDO(state, env);

    await init(instance, {
      sessionId: 'sess_sleep_stop',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ttlSeconds: 3600,
    });
    await state.storage.put('intentional_sleep_stop', true);

    await instance.onStop({ exitCode: 0, reason: 'exit' });

    expect(await state.storage.get('intentional_sleep_stop')).toBeUndefined();
    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    expect(updates.every((call) => call.params[0] !== 'ERROR')).toBe(true);
  });

  it('marks a real wake as READY after an idle sleep', async () => {
    const db = fakeD1();
    const state = buildState();
    const env = buildEnv(db);
    const instance = new DevContainerDO(state, env);

    await init(instance, {
      sessionId: 'sess_wake',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ttlSeconds: 3600,
    });
    await state.storage.put('intentional_sleep_stop', true);

    await instance.onStart();

    expect(await state.storage.get('intentional_sleep_stop')).toBeUndefined();
    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    const last = updates[updates.length - 1]!;
    expect(last.params[0]).toBe('READY');
    expect(last.params[2]).toEqual(expect.any(String));
    expect(last.params[5]).toBe('sess_wake');
  });

  it('persists unexpected container stops as redacted ERROR diagnostics', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env);

    await init(instance, {
      sessionId: 'sess_crash',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ttlSeconds: 3600,
    });

    await instance.onStop({ exitCode: 137, reason: 'oom' });

    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    const last = updates[updates.length - 1]!;
    expect(last.params[0]).toBe('ERROR');
    expect(last.params[4]).toBe('Container stopped unexpectedly (exit code 137, reason oom).');
    expect(last.params[5]).toBe('sess_crash');
  });

  it('redacts likely secrets before persisting container errors', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env);
    const devinLikeSecret = 'cog_fakeServiceUserToken0123456789abcdef';

    await init(instance, {
      sessionId: 'sess_error_redact',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ttlSeconds: 3600,
    });

    await expect(instance.onError(new Error(
      `DEVIN_API_KEY=${devinLikeSecret} token=room-secret`,
    ))).rejects.toThrow(/DEVIN_API_KEY=/);

    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    const last = updates[updates.length - 1]!;
    expect(last.params[0]).toBe('ERROR');
    expect(last.params[4]).toContain('DEVIN_API_KEY=[redacted]');
    expect(last.params[4]).toContain('token=[redacted]');
    expect(last.params[4]).not.toContain('room-secret');
    expect(last.params[4]).not.toContain(devinLikeSecret);
    expect(last.params[5]).toBe('sess_error_redact');
  });
});

// ─── onWarn ─────────────────────────────────────────────────────────────────

describe('DevContainerDO.onWarn — Step 11', () => {
  it('marks warned_at in D1 and reschedules onExpire at config.expiresAt', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    await init(instance, {
      sessionId: 'sess_warn',
      expiresAt,
      ttlSeconds: 600,
    });

    // Clear the onWarn schedule recorded at /__init time so we only assert
    // on what onWarn itself produces.
    instance.__schedules.length = 0;

    await instance.onWarn();

    // Rescheduled onExpire at the exact expiresAt.
    expect(instance.__schedules).toHaveLength(1);
    const [reschedule] = instance.__schedules;
    expect(reschedule?.callback).toBe('onExpire');
    expect((reschedule?.when as Date).toISOString()).toBe(expiresAt);

    // warned_at UPDATE went through (last UPDATE on the row).
    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    const last = updates[updates.length - 1]!;
    expect(last.sql).toContain('warned_at');
    // markWarned binds: warnedAt, sessionId
    expect(typeof last.params[0]).toBe('string');
    expect(last.params[1]).toBe('sess_warn');

    // Container is not destroyed yet — that's onExpire's job.
    expect(instance.__destroyCalls).toBe(0);
  });

  it('no-ops when the config payload is missing from storage', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    await instance.onWarn();

    expect(instance.__schedules).toHaveLength(0);
    const warnCall = db.__calls.find((c) =>
      c.sql.includes('UPDATE dev_container_sessions') && c.sql.includes('warned_at'),
    );
    expect(warnCall).toBeUndefined();
  });
});

// ─── onExpire ────────────────────────────────────────────────────────────────

describe('DevContainerDO.onExpire — Step 10', () => {
  it('destroys the container and marks D1 EXPIRED', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    await init(instance, {
      sessionId: 'sess_expire',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ttlSeconds: 60,
    });

    // Clear the schedule spy so we only assert on expire-side activity.
    instance.__schedules.length = 0;
    instance.__destroyCalls = 0;

    await instance.onExpire();

    expect(instance.__destroyCalls).toBe(1);

    // Two UPDATE calls total: READY from /__init, then EXPIRED from onExpire.
    // We want the last one.
    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const last = updates[updates.length - 1]!;
    // devContainerSessions.markStatus binds: status, url, startedAt, stoppedAt, errorMessage, sessionId
    expect(last.params[0]).toBe('EXPIRED');
    expect(typeof last.params[3]).toBe('string'); // stoppedAt
    expect(last.params[5]).toBe('sess_expire');
  });

  it('does not record the expiry destroy stop as an unexpected container error', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env);

    await init(instance, {
      sessionId: 'sess_expire_cleanly',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ttlSeconds: 60,
    });

    instance.destroy = async () => {
      await instance.onStop({ exitCode: 0, reason: 'exit' });
    };

    await instance.onExpire();

    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    expect(updates.some((call) => call.params[0] === 'ERROR')).toBe(false);
    const last = updates[updates.length - 1]!;
    expect(last.params[0]).toBe('EXPIRED');
    expect(last.params[5]).toBe('sess_expire_cleanly');
  });

  it('no-ops when the config payload is missing from storage', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env) as SpyableDO;

    // No /__init — storage is empty.
    await instance.onExpire();

    expect(instance.__destroyCalls).toBe(0);
    const updateCall = db.__calls.find((c) =>
      c.sql.includes('UPDATE dev_container_sessions'),
    );
    expect(updateCall).toBeUndefined();
  });

  it('wipes storage after expiring so a DO restart does not refire', async () => {
    const state = buildState();
    const env = buildEnv();
    const instance = new DevContainerDO(state, env);

    await init(instance, {
      sessionId: 'sess_wipe',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      ttlSeconds: 120,
    });

    expect(await state.storage.get('config')).toBeTruthy();

    await instance.onExpire();

    expect(await state.storage.get('config')).toBeUndefined();
  });

  it('still marks EXPIRED even when destroy() throws', async () => {
    const db = fakeD1();
    const env = buildEnv(db);
    const instance = new DevContainerDO(buildState(), env);

    await init(instance, {
      sessionId: 'sess_force',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ttlSeconds: 60,
    });

    instance.destroy = async () => {
      throw new Error('container already stopped');
    };

    await instance.onExpire();

    const updates = db.__calls.filter(
      (c) => c.sql.includes('UPDATE dev_container_sessions') && c.ran,
    );
    const last = updates[updates.length - 1]!;
    expect(last.params[0]).toBe('EXPIRED');
  });
});
