/**
 * DevContainerDO — Durable Object backing a single dev-container session.
 *
 * Phase 3b (ADR-037). One instance per `sessionId`. The DO owns:
 *   - session config persisted to ctx.storage
 *   - D1 status transitions (LAUNCHING → READY → STOPPED/EXPIRED)
 *   - the `code-server` container lifecycle via @cloudflare/containers
 *   - TTL warn-then-expire bisection via this.schedule() (Steps 10–11)
 *   - (Step 9) proxy passthrough to the container's :8080 for the code-server iframe
 *
 * The DO is addressed by `sessionId` (idFromName). All internal routes use
 * the `/__*` prefix so they cannot collide with the proxy passthrough path
 * the candidate's iframe hits.
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types';
import { markExpired, markStatus, markWarned } from '../lib/devContainerSessions';

const DEFAULT_WARN_BEFORE_SECONDS = 60;

interface InitPayload {
  sessionId: string;
  expiresAt: string;
  ttlSeconds: number;
  repoGitUrl: string | null;
  challengeBranch: string | null;
}

function buildEnvVars(payload: InitPayload): Record<string, string> {
  const env: Record<string, string> = {
    SESSION_ID: payload.sessionId,
  };
  if (payload.repoGitUrl) env.REPO_GIT_URL = payload.repoGitUrl;
  if (payload.challengeBranch) env.CHALLENGE_BRANCH = payload.challengeBranch;
  return env;
}

export class DevContainerDO extends Container<Env> {
  // Bind container to port 8080 — the port code-server listens on.
  defaultPort = 8080;

  // Sleep the DO after 10 minutes of inactivity so we don't pay for idle.
  sleepAfter = '10m';

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/__init' && request.method === 'POST') {
      return this.handleInit(request);
    }
    // Everything else is a proxy passthrough to the code-server container.
    // Container.fetch forwards to containerFetch which supports HTTP + WS
    // upgrades — both ends of the socket are managed by the DO.
    //
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

    // Pre-container-proxy (Step 7): flip the D1 row straight to READY so the
    // candidate can exit the LAUNCHING state. Step 9 adds proxy passthrough.
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
