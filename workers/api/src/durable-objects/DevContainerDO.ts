/**
 * DevContainerDO — Durable Object backing a single dev-container session.
 *
 * Phase 3b (ADR-037). One instance per `sessionId`. The DO owns:
 *   - session config persisted to ctx.storage
 *   - D1 status transitions (LAUNCHING → READY → STOPPED/EXPIRED)
 *   - the `code-server` container lifecycle via @cloudflare/containers
 *   - TTL warn-then-expire bisection via this.schedule() (Steps 10–11)
 *   - (Step 9) proxy passthrough to the container's :8080 for the code-server iframe
 *   - baked bridge/router support for AI assistant/Devin and code-server traffic
 *
 * The DO is addressed by `sessionId` (idFromName). All internal routes use
 * the `/__*` prefix so they cannot collide with the proxy passthrough path
 * the candidate's iframe hits.
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types';
import { markError, markExpired, markStatus, markWarned } from '../lib/devContainerSessions';

const DEFAULT_WARN_BEFORE_SECONDS = 60;
const INTENTIONAL_SLEEP_KEY = 'intentional_sleep_stop';
const MAX_CONTAINER_DIAGNOSTIC_CHARS = 1_000;
const CODE_SERVER_ENTRYPOINT = '/usr/local/bin/entrypoint.sh';

type ContainerStorageSql = (strings: TemplateStringsArray, ...values: unknown[]) => unknown[];

interface InitPayload {
  sessionId: string;
  expiresAt: string;
  ttlSeconds: number;
  repoGitUrl: string | null;
  challengeBranch: string | null;
  baseCommitSha?: string | null;
  challengePacketContentHash?: string | null;
  agentType?: string | null;
  agentApiKey?: string | null;
  agentOrgId?: string | null;
  pipeApiUrl?: string | null;
  roomToken?: string | null;
}

function buildEnvVars(payload: InitPayload): Record<string, string> {
  const agentType = payload.agentType?.trim();
  const env: Record<string, string> = {
    SESSION_ID: payload.sessionId,
    PASSWORD: 'pipe',
    WORKSPACE_DIR: '/workspace',
    AGENT_BRIDGE_PORT: '8080',
    CODE_SERVER_PORT: '8082',
  };
  if (agentType) env.AGENT_TYPE = agentType;
  if (payload.repoGitUrl) env.REPO_GIT_URL = payload.repoGitUrl;
  if (payload.challengeBranch) env.CHALLENGE_BRANCH = payload.challengeBranch;
  if (payload.baseCommitSha) env.CHALLENGE_BASE_COMMIT_SHA = payload.baseCommitSha;
  if (payload.challengePacketContentHash) env.CHALLENGE_PACKET_CONTENT_HASH = payload.challengePacketContentHash;
  if (payload.agentApiKey) env.DEVIN_API_KEY = payload.agentApiKey;
  if (payload.agentOrgId) env.DEVIN_ORG_ID = payload.agentOrgId;
  if (payload.pipeApiUrl) env.PIPE_API_URL = payload.pipeApiUrl;
  if (payload.roomToken) env.ROOM_TOKEN = payload.roomToken;
  return env;
}

export class DevContainerDO extends Container<Env> {
  // The baked bridge/router owns the Cloudflare-facing port. It handles
  // AI assistant/Devin endpoints directly and proxies everything else to code-server.
  defaultPort = 8080;
  requiredPorts = [8080];

  // Sleep the DO after 10 minutes of inactivity so we don't pay for idle.
  sleepAfter = '10m';
  private initializing = false;

  override async alarm(alarmProps?: { isRetry: boolean; retryCount: number }): Promise<void> {
    this.ensureContainerSchedulerSchema();
    await super.alarm(alarmProps);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/__init' && request.method === 'POST') {
      return this.handleInit(request);
    }
    if (url.pathname === '/__destroy' && request.method === 'POST') {
      return this.handleDestroy();
    }
    // After DO hibernation `this.envVars` is lost (instance property), so
    // rehydrate from storage before `super.fetch()` kicks off startContainer.
    await this.rehydrateEnvVarsIfMissing();
    return super.fetch(request);
  }

  private async rehydrateEnvVarsIfMissing(): Promise<void> {
    if (this.envVars && Object.keys(this.envVars).length > 0) return;
    const config = (await this.ctx.storage.get<InitPayload>('config')) ?? null;
    if (!config) return;
    this.envVars = buildEnvVars(config);
  }

  private async handleInit(request: Request): Promise<Response> {
    let payload: InitPayload;
    try {
      payload = (await request.json()) as InitPayload;
    } catch {
      return new Response(
        JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Persist config so future DO invocations (destroy, proxy, alarms) can
    // read it without re-querying D1.
    await this.ctx.storage.put('config', payload);

    // Populate env vars for the container entrypoint. The proxy path
    // re-hydrates this from storage after hibernation.
    this.envVars = buildEnvVars(payload);

    try {
      // Use the Docker image entrypoint for repo cloning and code-server startup.
      // Passing the full bridge script through Container.start() exceeded the
      // runtime value limit and caused the VM to exit before port 8080 opened.
      this.initializing = true;
      await this.startAndWaitForPorts({
        ports: this.requiredPorts,
        startOptions: {
          envVars: this.envVars,
          entrypoint: [CODE_SERVER_ENTRYPOINT],
          enableInternet: true,
        },
        cancellationOptions: {
          instanceGetTimeoutMS: 90_000,
          portReadyTimeoutMS: 180_000,
          waitInterval: 1_000,
        },
      });
    } catch (err) {
      this.initializing = false;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[DevContainerDO.handleInit] start failed:', err);
      await markError(this.env.DB, payload.sessionId, sanitizeContainerDiagnostic(message));
      return new Response(
        JSON.stringify({ error: { code: 'CONTAINER_START_FAILED', message } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
    this.initializing = false;

    // Only mark the session READY after the code-server port is actually
    // listening. The iframe proxy depends on this being an honest state.
    const startedAt = new Date().toISOString();
    await markStatus(this.env.DB, payload.sessionId, 'READY', {
      startedAt,
    });

    // Step 11: schedule the warn-then-expire bisection. The base class
    // multiplexes schedules on top of a single alarm. We first fire
    // `onWarn` at `expiresAt − WARN_BEFORE_SECONDS` so the candidate can
    // see a countdown; `onWarn` then reschedules `onExpire` at the real
    // `expiresAt`. If the configured TTL is already shorter than the warn
    // window, we skip the warning and go straight to destroy.
    const expireAt = new Date(payload.expiresAt);
    if (!Number.isNaN(expireAt.getTime())) {
      const warnBeforeSeconds = parseWarnSeconds(this.env.DEV_CONTAINER_WARN_BEFORE_SECONDS);
      const warnAt = new Date(expireAt.getTime() - warnBeforeSeconds * 1000);
      try {
        this.ensureContainerSchedulerSchema();
        if (warnAt.getTime() > Date.now()) {
          await this.schedule(warnAt, 'onWarn');
        } else {
          await this.schedule(expireAt, 'onExpire');
        }
      } catch (err) {
        console.error('[DevContainerDO.handleInit] schedule failed:', err);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sessionId: payload.sessionId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  override async onStart(): Promise<void> {
    if (this.initializing) return;
    const config = await this.loadConfig();
    if (!config) return;
    await this.ctx.storage.delete(INTENTIONAL_SLEEP_KEY);
    await markStatus(this.env.DB, config.sessionId, 'READY', {
      startedAt: new Date().toISOString(),
    });
  }

  override async onStop(params: { exitCode: number; reason: string }): Promise<void> {
    const config = await this.loadConfig();
    if (!config) return;
    const wasIntentionalStop = (await this.ctx.storage.get<boolean>(INTENTIONAL_SLEEP_KEY)) === true;
    if (wasIntentionalStop) {
      await this.ctx.storage.delete(INTENTIONAL_SLEEP_KEY);
      return;
    }
    const message = sanitizeContainerDiagnostic(
      `Container stopped unexpectedly (exit code ${params.exitCode}, reason ${params.reason}).`,
    );
    await markError(this.env.DB, config.sessionId, message);
  }

  override async onActivityExpired(): Promise<void> {
    const config = await this.loadConfig();
    if (config) {
      await this.ctx.storage.put(INTENTIONAL_SLEEP_KEY, true);
      await markStatus(this.env.DB, config.sessionId, 'SLEEPING');
    }
    await super.onActivityExpired();
  }

  override async onError(error: unknown): Promise<void> {
    if (!this.initializing) {
      const config = await this.loadConfig();
      if (config) {
        const message = sanitizeContainerDiagnostic(
          error instanceof Error ? error.message : String(error),
        );
        await markError(this.env.DB, config.sessionId, message);
      }
    }
    throw error instanceof Error ? error : new Error(String(error));
  }

  private async loadConfig(): Promise<InitPayload | null> {
    return (await this.ctx.storage.get<InitPayload>('config')) ?? null;
  }

  private ensureContainerSchedulerSchema(): void {
    const sql = (this as unknown as { sql?: ContainerStorageSql }).sql;
    if (typeof sql !== 'function') return;

    const runSql = sql.bind(this) as ContainerStorageSql;
    runSql`
      CREATE TABLE IF NOT EXISTS container_schedules (
        id TEXT PRIMARY KEY NOT NULL DEFAULT (randomblob(9)),
        callback TEXT NOT NULL,
        payload TEXT,
        type TEXT NOT NULL CHECK(type IN ('scheduled', 'delayed')),
        time INTEGER NOT NULL,
        delayInSeconds INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `;
  }

  /**
   * Manual destroy handler. Called when the candidate clicks "END SESSION".
   * Stops the container and clears storage. D1 status is already marked
   * STOPPED by the route handler before calling this.
   */
  private async handleDestroy(): Promise<Response> {
    const config = (await this.ctx.storage.get<InitPayload>('config')) ?? null;

    // Stop the container if it's running. Safe to call when already stopped.
    try {
      await this.ctx.storage.put(INTENTIONAL_SLEEP_KEY, true);
      await this.destroy();
    } catch (err) {
      console.error('[DevContainerDO.handleDestroy] destroy() failed:', err);
      // Continue — the container may already be stopped
    }

    // Wipe storage so the DO can be garbage-collected and alarms won't refire.
    try {
      await this.ctx.storage.deleteAll();
    } catch (err) {
      console.error('[DevContainerDO.handleDestroy] deleteAll failed:', err);
    }

    return new Response(
      JSON.stringify({ ok: true, sessionId: config?.sessionId ?? null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * TTL warning callback. Fires at `expiresAt − WARN_BEFORE_SECONDS`.
   * Writes `warned_at` to D1 (the cockpit + the frontend hook read this
   * to surface the countdown toast) and reschedules `onExpire` at the
   * real `expiresAt`. Public because the scheduler dispatches callbacks
   * reflectively via `this[row.callback](...)`.
   */
  async onWarn(): Promise<void> {
    const config = (await this.ctx.storage.get<InitPayload>('config')) ?? null;
    if (!config) {
      console.error('[DevContainerDO.onWarn] missing config in storage — skipping');
      return;
    }

    const warnedAt = new Date().toISOString();
    try {
      await markWarned(this.env.DB, config.sessionId, warnedAt);
    } catch (err) {
      console.error('[DevContainerDO.onWarn] markWarned failed:', err);
    }

    const expireAt = new Date(config.expiresAt);
    if (!Number.isNaN(expireAt.getTime())) {
      try {
        this.ensureContainerSchedulerSchema();
        await this.schedule(expireAt, 'onExpire');
      } catch (err) {
        console.error('[DevContainerDO.onWarn] schedule(onExpire) failed:', err);
      }
    }
  }

  /**
   * TTL expiry callback. Invoked by the Container scheduler when
   * `expiresAt` is reached. Stops the container and marks the D1 row
   * as EXPIRED so the cockpit can distinguish manual destroy from
   * timed-out sessions.
   *
   * Named `onExpire` so the scheduler's reflective dispatch
   * (`this[row.callback](...)`) can find it.
   */
  async onExpire(): Promise<void> {
    const config = (await this.ctx.storage.get<InitPayload>('config')) ?? null;
    if (!config) {
      console.error('[DevContainerDO.onExpire] missing config in storage — skipping');
      return;
    }

    // Kill the container if it's still running. Safe to call when stopped.
    try {
      await this.ctx.storage.put(INTENTIONAL_SLEEP_KEY, true);
      await this.destroy();
    } catch (err) {
      console.error('[DevContainerDO.onExpire] destroy() failed:', err);
    }

    const stoppedAt = new Date().toISOString();
    try {
      await markExpired(this.env.DB, config.sessionId, stoppedAt);
    } catch (err) {
      console.error('[DevContainerDO.onExpire] markExpired failed:', err);
    }

    // Wipe storage so a future DO restart doesn't re-fire the callback.
    try {
      await this.ctx.storage.deleteAll();
    } catch (err) {
      console.error('[DevContainerDO.onExpire] deleteAll failed:', err);
    }
  }
}

function parseWarnSeconds(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_WARN_BEFORE_SECONDS;
  }
  return parsed;
}

function sanitizeContainerDiagnostic(value: string): string {
  const redacted = value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, 'sk-[redacted]')
    .replace(/\b(cog_[A-Za-z0-9]{16,})\b/g, 'cog_[redacted]')
    .replace(/\b((?:DEVIN_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*)[^\s]+/gi, '$1[redacted]')
    .replace(/([?&](?:api_key|key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .trim();
  if (redacted.length <= MAX_CONTAINER_DIAGNOSTIC_CHARS) return redacted;
  return `${redacted.slice(0, MAX_CONTAINER_DIAGNOSTIC_CHARS)}\n[diagnostic truncated]`;
}
