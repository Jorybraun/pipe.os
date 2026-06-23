/**
 * devContainerClient — typed REST client for the Cloudflare dev-container routes.
 *
 * Mirrors the Hono sub-app at `workers/api/src/routes/assessment/devContainer.ts`:
 *   POST /rpc/dev-container/launch
 *   GET  /rpc/dev-container/:sessionId/status
 *   POST /rpc/dev-container/:sessionId/destroy
 *
 * Auth: candidate session JWT as `Authorization: Bearer <token>`. The proxy
 * passthrough route is NOT called via this client — the iframe hits it
 * directly with `?token=…` query fallback for WebSocket upgrades.
 */

export type DevContainerStatus =
  | 'LAUNCHING'
  | 'READY'
  | 'SLEEPING'
  | 'ERROR'
  | 'STOPPED'
  | 'EXPIRED';

export type TtlSource = 'GLOBAL' | 'CHALLENGE' | 'OVERRIDE';

export interface LaunchRequest {
  challengeId?: string | null;
  /** Only honored with an admin secret header. Plain candidates cannot override TTL. */
  ttlSecondsOverride?: number | null;
}

export interface LaunchResponse {
  sessionId: string;
  status: 'LAUNCHING';
  ttlSeconds: number;
  ttlSource: TtlSource;
  expiresAt: string;
}

export interface StatusResponse {
  sessionId: string;
  status: DevContainerStatus;
  ttlSeconds: number;
  ttlSource: TtlSource;
  expiresAt: string;
  warnedAt: string | null;
  url: string | null;
  expiringSoon: boolean;
}

export interface DestroyResponse {
  sessionId: string;
  status: 'STOPPED' | 'EXPIRED';
}

export class DevContainerApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'DevContainerApiError';
    this.code = code;
    this.status = status;
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

interface RuntimeLocation {
  hostname: string;
  origin: string;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveDevContainerApiBase(
  envBaseUrl: string | undefined = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL,
  runtimeLocation: RuntimeLocation | undefined =
    typeof window !== 'undefined'
      ? { hostname: window.location.hostname, origin: window.location.origin }
      : undefined,
): string {
  if (envBaseUrl?.trim()) return normalizeBaseUrl(envBaseUrl.trim());

  if (
    runtimeLocation &&
    runtimeLocation.hostname !== 'localhost' &&
    runtimeLocation.hostname !== '127.0.0.1'
  ) {
    return runtimeLocation.origin;
  }

  return 'http://localhost:8787';
}

function apiBase(): string {
  return resolveDevContainerApiBase();
}

async function parseError(res: Response): Promise<DevContainerApiError> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  const code = body.error?.code ?? `HTTP_${res.status}`;
  const message = body.error?.message ?? `Request failed with ${res.status}`;
  return new DevContainerApiError(code, message, res.status);
}

function authHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function launchDevContainer(
  body: LaunchRequest,
  token: string | null,
): Promise<LaunchResponse> {
  const res = await fetch(`${apiBase()}/rpc/dev-container/launch`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as LaunchResponse;
}

export async function getDevContainerStatus(
  sessionId: string,
  token: string | null,
): Promise<StatusResponse> {
  const res = await fetch(
    `${apiBase()}/rpc/dev-container/${encodeURIComponent(sessionId)}/status`,
    { method: 'GET', headers: authHeaders(token) },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as StatusResponse;
}

export async function destroyDevContainer(
  sessionId: string,
  token: string | null,
): Promise<DestroyResponse> {
  const res = await fetch(
    `${apiBase()}/rpc/dev-container/${encodeURIComponent(sessionId)}/destroy`,
    { method: 'POST', headers: authHeaders(token) },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as DestroyResponse;
}

export interface ExchangeTokenResponse {
  exchangeToken: string;
  expiresAt: string;
}

/**
 * Request a short-lived, single-use exchange token for iframe auth.
 * This prevents the full candidate JWT from leaking via Referer headers
 * and browser history when embedded in the iframe URL.
 */
export async function getExchangeToken(
  sessionId: string,
  token: string | null,
): Promise<ExchangeTokenResponse> {
  const res = await fetch(
    `${apiBase()}/rpc/dev-container/${encodeURIComponent(sessionId)}/exchange-token`,
    { method: 'POST', headers: authHeaders(token) },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ExchangeTokenResponse;
}

/**
 * Build the proxy URL the iframe should load. Uses a short-lived exchange
 * token instead of the full candidate JWT to prevent token leakage via
 * Referer headers and browser history.
 *
 * The exchange token is single-use and expires in 30 seconds — enough time
 * for the iframe to load. After consumption, subsequent requests from within
 * the iframe (WebSocket upgrades, assets) are handled by code-server's
 * internal session, not by re-validating the exchange token.
 */
export function buildProxyIframeUrl(sessionId: string, exchangeToken: string): string {
  const base = `${apiBase()}/rpc/dev-container-proxy/${encodeURIComponent(sessionId)}/`;
  const url = new URL(base);
  url.searchParams.set('exchangeToken', exchangeToken);
  return url.toString();
}
