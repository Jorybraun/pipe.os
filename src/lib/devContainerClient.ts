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

function apiBase(): string {
  return import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';
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

/**
 * Build the proxy URL the iframe should load. The Worker's `candidateAuth`
 * middleware accepts `?token=…` as a fallback for WebSocket upgrades, so
 * the token is embedded in the iframe src rather than an Authorization
 * header (which iframes cannot set).
 */
export function buildProxyIframeUrl(sessionId: string, token: string | null): string {
  const base = `${apiBase()}/rpc/dev-container/${encodeURIComponent(sessionId)}/proxy/`;
  if (!token) return base;
  const url = new URL(base);
  url.searchParams.set('token', token);
  return url.toString();
}
