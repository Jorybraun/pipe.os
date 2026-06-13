/**
 * API client for the Meetings Worker.
 *
 * Thin fetch wrapper that:
 *   - Resolves the base URL from VITE_MEETINGS_API_URL (default: http://localhost:8788)
 *   - Injects an Authorization: Bearer <token> header via a caller-supplied
 *     getToken function (keeps Clerk out of this module)
 *   - Parses structured error bodies from the Worker
 *   - Returns typed JSON on success
 *
 * Usage:
 *   const api = createApiClient({ getToken: () => clerkAuth.getToken() });
 *   const { contacts } = await api.get<{ contacts: Contact[] }>('/api/v1/contacts');
 *   await api.post('/api/v1/contacts', { email: 'test@example.com' });
 *   await api.del('/api/v1/contacts/abc123');
 */

import { ApiError, type ApiErrorBody } from './types';

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'http://localhost:8788';

export interface ApiClientConfig {
  /**
   * Function that resolves the current session JWT.
   * Should return null when no session is active (the request will still be
   * sent; the Worker will reject it with 401).
   */
  getToken: () => Promise<string | null> | string | null;
  /** Override the base URL. Defaults to VITE_MEETINGS_API_URL or http://localhost:8788. */
  baseUrl?: string;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  del(path: string): Promise<void>;
}

/**
 * Factory function that returns a typed API client bound to the given config.
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl =
    config.baseUrl ??
    (typeof import.meta !== 'undefined' &&
    typeof import.meta.env !== 'undefined' &&
    import.meta.env.VITE_MEETINGS_API_URL
      ? import.meta.env.VITE_MEETINGS_API_URL
      : DEFAULT_BASE_URL);

  /**
   * Build the Authorization header, or return an empty record when there is no
   * active session token.
   */
  async function authHeader(): Promise<Record<string, string>> {
    const token = await config.getToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Parse the response body.
   *
   * On 2xx with content, parse as JSON and return.
   * On 2xx with no content (204), return undefined cast to T.
   * On non-2xx, attempt to parse as ApiErrorBody and throw ApiError.
   * If the error body is not parseable, throw a generic ApiError.
   */
  async function handleResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      // 204 No Content — nothing to parse
      if (response.status === 204) {
        return undefined as unknown as T;
      }
      return (await response.json()) as T;
    }

    // Non-2xx: try to extract structured error
    let errorBody: ApiErrorBody | null = null;
    try {
      errorBody = (await response.json()) as ApiErrorBody;
    } catch {
      // Response body is not JSON
    }

    const code = errorBody?.error?.code ?? 'UNKNOWN_ERROR';
    const message =
      errorBody?.error?.message ?? `HTTP ${response.status}: ${response.statusText}`;

    throw new ApiError(code, message, response.status);
  }

  // ─── Public methods ─────────────────────────────────────────────────────────

  async function get<T>(path: string): Promise<T> {
    const headers = await authHeader();
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    return handleResponse<T>(response);
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const headers = await authHeader();
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response);
  }

  async function patch<T>(path: string, body: unknown): Promise<T> {
    const headers = await authHeader();
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response);
  }

  async function put<T>(path: string, body: unknown): Promise<T> {
    const headers = await authHeader();
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return handleResponse<T>(response);
  }

  async function del(path: string): Promise<void> {
    const headers = await authHeader();
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    await handleResponse<void>(response);
  }

  return { get, post, patch, put, del };
}
