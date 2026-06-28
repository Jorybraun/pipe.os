/**
 * Dev Container routes — Phase 3b Cloudflare Containers migration (ADR-037).
 *
 * Mounts under /rpc/dev-container via rpcAuth (candidate JWT).
 *
 * Routes:
 *   POST /rpc/dev-container/launch              — spin up DO + container
 *   GET  /rpc/dev-container/:sessionId/status   — countdown + state
 *   POST /rpc/dev-container/:sessionId/destroy  — manual teardown
 *   ALL  /rpc/dev-container/:sessionId/proxy/*  — code-server passthrough (HTTP + WS)
 *
 * All routes assume candidateAuth has already populated candidateId + pipelineId.
 * Ownership is re-checked against dev_container_sessions in D1 before any DO call.
 */

import { Hono } from 'hono';
import type { Env } from '../../types';
import type { CandidateVariables } from '../../middleware/candidateAuth';
import {
  computeEffectiveTtl,
  MIN_TTL_SECONDS,
  type TtlSource,
} from '../../lib/devContainerTtl';
import {
  insertSession,
  getChallengeTtlMeta,
  getSessionByIdForCandidate,
  markError,
  markStopped,
  mintExchangeToken,
  consumeExchangeToken,
} from '../../lib/devContainerSessions';
import { signJwt, verifyJwt } from '../../lib/jwt';

// ─── Defaults (used when the wrangler vars are not set) ─────────────────────

const DEFAULT_GLOBAL_TTL = 3600; // 60 min
const DEFAULT_MAX_TTL = 7200; // 2 hours
const DEFAULT_INSTANCE_TYPE = 'standard-1';
const MAX_DEV_CONTAINER_INIT_DIAGNOSTIC_CHARS = 1_000;

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeDevContainerInitDiagnostic(value: string): string {
  const redacted = value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, 'sk-[redacted]')
    .replace(/\b(cog_[A-Za-z0-9]{16,})\b/g, 'cog_[redacted]')
    .replace(/\b((?:DEVIN_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*)[^\s]+/gi, '$1[redacted]')
    .replace(/([?&](?:api_key|key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .trim();
  if (redacted.length <= MAX_DEV_CONTAINER_INIT_DIAGNOSTIC_CHARS) return redacted;
  return `${redacted.slice(0, MAX_DEV_CONTAINER_INIT_DIAGNOSTIC_CHARS)}\n[diagnostic truncated]`;
}

async function markInitFailedIfStillLaunching(input: {
  db: D1Database;
  sessionId: string;
  candidateId: string;
  diagnostic: string;
}): Promise<void> {
  const session = await getSessionByIdForCandidate(input.db, input.sessionId, input.candidateId);
  if (!session || session.status !== 'LAUNCHING') return;
  await markError(input.db, input.sessionId, input.diagnostic);
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const devContainer = new Hono<{
  Bindings: Env;
  Variables: CandidateVariables;
}>();

// ─── POST /launch ────────────────────────────────────────────────────────────

interface LaunchRequestBody {
  challengeId?: string | null;
  ttlSecondsOverride?: number | null;
}

interface LaunchResponseBody {
  sessionId: string;
  status: 'LAUNCHING';
  ttlSeconds: number;
  ttlSource: TtlSource;
  expiresAt: string;
}

devContainer.post('/launch', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  let body: LaunchRequestBody;
  try {
    body = (await c.req.json()) as LaunchRequestBody;
  } catch {
    body = {};
  }

  const challengeId =
    typeof body.challengeId === 'string' && body.challengeId.trim() !== ''
      ? body.challengeId.trim()
      : null;

  // Look up per-challenge TTL + repo metadata, if a challenge was specified.
  let challengeTtl: number | null = null;
  let repoGitUrl: string | null = null;
  let challengeBranch: string | null = null;
  if (challengeId) {
    const meta = await getChallengeTtlMeta(c.env.DB, challengeId, candidateId);
    if (meta) {
      challengeTtl = meta.dev_container_ttl_seconds;
      repoGitUrl = meta.repo_git_url;
      challengeBranch = meta.challenge_branch;
    }
  }

  // For pipeline-free candidates (standalone dev container challenge),
  // look up the repo URL from the scheduled_interviews table.
  if (!pipelineId && !repoGitUrl) {
    const interview = await c.env.DB.prepare(
      `SELECT github_repo_url, github_pr_number
       FROM scheduled_interviews
       WHERE candidate_id = ?1
         AND interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')
         AND stage_id IS NULL
         AND status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(candidateId).first<{ github_repo_url: string | null; github_pr_number: number | null }>();

    if (interview?.github_repo_url) {
      repoGitUrl = interview.github_repo_url;
    }
  }

  if (!pipelineId && !repoGitUrl) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'No repository URL configured for this dev container challenge.' } }, 400);
  }

  // Per-launch admin override is honored only with the shared secret header.
  let override: number | null = null;
  const overrideHeader = c.req.header('X-Pipe-Admin-Override');
  const adminSecret = c.env.ADMIN_TTL_OVERRIDE_SECRET;
  if (
    overrideHeader &&
    adminSecret &&
    overrideHeader === adminSecret &&
    typeof body.ttlSecondsOverride === 'number'
  ) {
    override = body.ttlSecondsOverride;
  }

  const globalDefault = parseIntEnv(
    c.env.DEV_CONTAINER_DEFAULT_TTL_SECONDS,
    DEFAULT_GLOBAL_TTL,
  );
  const hardCap = parseIntEnv(
    c.env.DEV_CONTAINER_MAX_TTL_SECONDS,
    DEFAULT_MAX_TTL,
  );

  let effective;
  try {
    effective = computeEffectiveTtl({
      globalDefault,
      challengeTtl,
      override,
      hardCap,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid TTL configuration.';
    const isUserError = message.includes(`>= ${MIN_TTL_SECONDS}s`);
    return c.json(
      {
        error: {
          code: isUserError ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
          message,
        },
      },
      isUserError ? 400 : 500,
    );
  }

  const sessionId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + effective.ttlSeconds * 1000,
  ).toISOString();

  try {
    await insertSession(c.env.DB, {
      id,
      sessionId,
      candidateId,
      challengeId,
      pipelineId: pipelineId ?? null,
      instanceType: DEFAULT_INSTANCE_TYPE,
      ttlSeconds: effective.ttlSeconds,
      ttlSource: effective.source,
      expiresAt,
      repoGitUrl,
      challengeBranch,
    });
  } catch (err) {
    console.error('[devContainer.launch] insert failed:', err);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to create session.' } },
      500,
    );
  }

  // Fire-and-forget the DO /__init call. The handler returns 201 LAUNCHING
  // immediately; the DO flips the D1 row to READY once the container is up.
  // Using executionCtx.waitUntil keeps the promise alive past the response.
  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);
  const initPromise = doStub
    .fetch('https://do.internal/__init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        expiresAt,
        ttlSeconds: effective.ttlSeconds,
        repoGitUrl,
        challengeBranch,
        agentType: 'devin',
        agentApiKey: c.env.DEVIN_API_KEY ?? null,
        agentOrgId: c.env.DEVIN_ORG_ID ?? null,
        pipeApiUrl: c.env.API_BASE_URL
          ?? c.env.APP_BASE_URL
          ?? `https://${c.req.header('host') ?? 'api.pipe.os'}`,
      }),
    })
    .then(async (response) => {
      if (response.ok) return;
      const responseText = await response.text().catch(() => '');
      const diagnostic = sanitizeDevContainerInitDiagnostic(
        `Dev-container init returned HTTP ${response.status}${responseText ? `: ${responseText}` : ''}`,
      );
      console.error('[devContainer.launch] DO init returned non-OK:', diagnostic);
      await markInitFailedIfStillLaunching({
        db: c.env.DB,
        sessionId,
        candidateId,
        diagnostic,
      });
    })
    .catch(async (err: unknown) => {
      const diagnostic = sanitizeDevContainerInitDiagnostic(
        `Dev-container init request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error('[devContainer.launch] DO init failed:', diagnostic);
      await markInitFailedIfStillLaunching({
        db: c.env.DB,
        sessionId,
        candidateId,
        diagnostic,
      });
    });
  c.executionCtx.waitUntil(initPromise);

  const response: LaunchResponseBody = {
    sessionId,
    status: 'LAUNCHING',
    ttlSeconds: effective.ttlSeconds,
    ttlSource: effective.source,
    expiresAt,
  };
  return c.json(response, 201);
});

// ─── GET /:sessionId/status ──────────────────────────────────────────────────

interface StatusResponseBody {
  sessionId: string;
  status: string;
  ttlSeconds: number;
  ttlSource: TtlSource;
  expiresAt: string;
  warnedAt: string | null;
  url: string | null;
  expiringSoon: boolean;
  errorMessage: string | null;
}

devContainer.get('/:sessionId/status', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      404,
    );
  }

  const response: StatusResponseBody = {
    sessionId: row.session_id,
    status: row.status,
    ttlSeconds: row.ttl_seconds,
    ttlSource: row.ttl_source,
    expiresAt: row.expires_at,
    warnedAt: row.warned_at,
    url: row.url,
    expiringSoon: row.warned_at != null,
    errorMessage: row.error_message,
  };
  return c.json(response, 200);
});

// ─── POST /:sessionId/destroy ────────────────────────────────────────────────

devContainer.post('/:sessionId/destroy', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      404,
    );
  }

  // Idempotent: already terminal states are success.
  if (row.status === 'STOPPED' || row.status === 'EXPIRED') {
    return c.json({ sessionId: row.session_id, status: row.status }, 200);
  }

  const stoppedAt = new Date().toISOString();
  try {
    await markStopped(c.env.DB, sessionId, stoppedAt);
  } catch (err) {
    console.error('[devContainer.destroy] update failed:', err);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to destroy session.' } },
      500,
    );
  }

  // Tell the DO to stop the container and clear storage. Fire-and-forget
  // since the D1 status is already STOPPED — even if the DO call fails,
  // the session is logically terminated. The container will eventually
  // time out via the TTL alarm if this fails.
  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);
  const destroyPromise = doStub
    .fetch('https://do.internal/__destroy', { method: 'POST' })
    .catch((err: unknown) => {
      console.error('[devContainer.destroy] DO destroy failed:', err);
    });
  // waitUntil keeps the promise alive past the response; falls back to
  // fire-and-forget in test environments where executionCtx is not available.
  try {
    c.executionCtx.waitUntil(destroyPromise);
  } catch {
    // Test environment — no executionCtx available. The promise fires but
    // may not complete before the test exits. Acceptable for unit tests.
  }

  return c.json({ sessionId, status: 'STOPPED' }, 200);
});

// ─── POST /:sessionId/exchange-token ─────────────────────────────────────────
//
// Mint a short-lived, single-use exchange token for iframe auth. The client
// calls this endpoint with the candidate JWT, then embeds the exchange token
// in the iframe URL. This prevents the full JWT from leaking via Referer
// headers and browser history.

interface ExchangeTokenResponseBody {
  exchangeToken: string;
  expiresAt: string;
}

devContainer.post('/:sessionId/exchange-token', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  // Verify ownership before minting a token
  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      404,
    );
  }

  try {
    const { token, expiresAt } = await mintExchangeToken(
      c.env.DB,
      sessionId,
      candidateId,
    );
    const response: ExchangeTokenResponseBody = {
      exchangeToken: token,
      expiresAt,
    };
    return c.json(response, 201);
  } catch (err) {
    console.error('[devContainer.exchangeToken] mint failed:', err);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to mint exchange token.' } },
      500,
    );
  }
});

// ─── ALL /:sessionId/proxy/* ─────────────────────────────────────────────────
//
// Transparent passthrough to the code-server container. Supports HTTP and
// WebSocket upgrades.
//
// Auth is handled in two ways:
//   1. candidateAuth middleware has set candidateId from JWT (header or ?token=)
//   2. ?exchangeToken= query param — consumed here, bypasses JWT requirement
//
// We strip the `/rpc/dev-container/:sessionId/proxy` prefix before forwarding
// so code-server sees the path it expects (root = `/`, assets = `/static/…`).

const PROXY_ALLOWED_STATUS: ReadonlySet<string> = new Set(['READY', 'SLEEPING']);
const PROXY_COOKIE_NAME = 'pipe_dev_container_proxy';
const PROXY_COOKIE_MAX_AGE_SECONDS = 3600;

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return rawValue.join('=') || null;
  }
  return null;
}

function buildProxyCookie(sessionId: string, token: string): string {
  return [
    `${PROXY_COOKIE_NAME}=${token}`,
    `Path=/rpc/dev-container-proxy/${encodeURIComponent(sessionId)}`,
    `Max-Age=${PROXY_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

function withProxyCookie(response: Response, sessionId: string, token: string | null): Response {
  if (!token) return response;
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', buildProxyCookie(sessionId, token));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

devContainer.all('/:sessionId/proxy/*', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      404,
    );
  }

  if (!PROXY_ALLOWED_STATUS.has(row.status)) {
    const code =
      row.status === 'LAUNCHING'
        ? 'NOT_READY'
        : row.status === 'ERROR'
          ? 'CONTAINER_ERROR'
          : 'SESSION_ENDED';
    const http = row.status === 'LAUNCHING' ? 425 : 410;
    return c.json(
      { error: { code, message: `Session is ${row.status}.` } },
      http,
    );
  }

  // Rewrite the URL to drop the proxy prefix. Anchors on the literal
  // `/proxy/` marker so we don't depend on Worker mount depth (`/rpc` in
  // production, `''` in unit tests driving the sub-app directly).
  const incoming = new URL(c.req.url);
  const marker = `/${sessionId}/proxy`;
  const markerIdx = incoming.pathname.indexOf(marker);
  const innerPath =
    markerIdx >= 0 ? incoming.pathname.slice(markerIdx + marker.length) || '/' : '/';
  const innerUrl = new URL(`https://do.internal${innerPath}${incoming.search}`);
  // The candidate session token is a Worker-layer secret — don't leak it
  // into the container environment on every request.
  innerUrl.searchParams.delete('token');

  const forwarded = new Request(innerUrl.toString(), c.req.raw);

  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);

  try {
    return await doStub.fetch(forwarded);
  } catch (err) {
    console.error('[devContainer.proxy] upstream failed:', err);
    return c.json(
      { error: { code: 'BAD_GATEWAY', message: 'Container proxy failed.' } },
      502,
    );
  }
});

// ─── Exchange-token proxy (public, no candidateAuth) ────────────────────────
//
// Separate router for iframe access via exchange tokens. This bypasses the
// candidateAuth middleware entirely — the exchange token IS the auth.
// Mounted on rpcPublic at /rpc/dev-container-proxy.

export const devContainerProxyPublic = new Hono<{ Bindings: Env }>();

devContainerProxyPublic.all('/:sessionId/*', async (c) => {
  const sessionId = c.req.param('sessionId');
  const url = new URL(c.req.url);
  const exchangeToken = url.searchParams.get('exchangeToken');
  let candidateId: string | null = null;
  let proxyCookieToken: string | null = null;

  if (exchangeToken) {
    // Consume the exchange token — single-use, validates ownership for the
    // first iframe request. We then set a scoped proxy cookie so code-server
    // redirects and asset requests do not need to keep the query token.
    const consumed = await consumeExchangeToken(c.env.DB, exchangeToken);
    if (!consumed) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired exchange token.' } },
        401,
      );
    }

    // Verify the token was issued for this session.
    if (consumed.sessionId !== sessionId) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Token not valid for this session.' } },
        403,
      );
    }

    const secret = c.env.SESSION_TOKEN_SECRET;
    if (!secret) {
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Auth not configured.' } },
        500,
      );
    }

    candidateId = consumed.candidateId;
    proxyCookieToken = await signJwt(
      { sub: consumed.candidateId, pid: sessionId },
      secret,
      PROXY_COOKIE_MAX_AGE_SECONDS,
    );
  } else {
    const secret = c.env.SESSION_TOKEN_SECRET;
    const cookieToken = readCookie(c.req.header('Cookie'), PROXY_COOKIE_NAME);
    const payload = secret && cookieToken ? await verifyJwt(cookieToken, secret) : null;
    if (!payload || payload.pid !== sessionId) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid proxy session.' } },
        401,
      );
    }
    candidateId = payload.sub;
  }

  // Look up the session to check status (we already validated ownership via token)
  const row = await getSessionByIdForCandidate(c.env.DB, sessionId, candidateId);
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      404,
    );
  }

  if (!PROXY_ALLOWED_STATUS.has(row.status)) {
    const code =
      row.status === 'LAUNCHING'
        ? 'NOT_READY'
        : row.status === 'ERROR'
          ? 'CONTAINER_ERROR'
          : 'SESSION_ENDED';
    const http = row.status === 'LAUNCHING' ? 425 : 410;
    return c.json(
      { error: { code, message: `Session is ${row.status}.` } },
      http,
    );
  }

  // Rewrite URL for the DO proxy
  const incoming = new URL(c.req.url);
  const marker = `/${sessionId}`;
  const markerIdx = incoming.pathname.indexOf(marker);
  const innerPath =
    markerIdx >= 0 ? incoming.pathname.slice(markerIdx + marker.length) || '/' : '/';
  const innerUrl = new URL(`https://do.internal${innerPath}${incoming.search}`);
  // Strip exchange token from forwarded request
  innerUrl.searchParams.delete('exchangeToken');

  const forwarded = new Request(innerUrl.toString(), c.req.raw);

  const doId = c.env.DEV_CONTAINER.idFromName(sessionId);
  const doStub = c.env.DEV_CONTAINER.get(doId);

  try {
    const response = await doStub.fetch(forwarded);
    return withProxyCookie(response, sessionId, proxyCookieToken);
  } catch (err) {
    console.error('[devContainerProxyPublic] upstream failed:', err);
    return c.json(
      { error: { code: 'BAD_GATEWAY', message: 'Container proxy failed.' } },
      502,
    );
  }
});
