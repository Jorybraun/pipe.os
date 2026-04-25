import type { Context } from 'hono';
import type { Env, Variables } from '../types';

/**
 * Maps well-known error codes to HTTP status codes.
 */
const ERROR_STATUS_MAP: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  INTERNAL_ERROR: 500,
};

/**
 * Structured error helper — creates a typed JSON error response.
 *
 * Usage inside route handlers:
 *   return apiError(c, 'NOT_FOUND', 'Pipeline not found.');
 */
export function apiError(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  code: keyof typeof ERROR_STATUS_MAP,
  message: string,
): Response {
  const status = (ERROR_STATUS_MAP[code] ?? 500) as
    | 400
    | 401
    | 403
    | 404
    | 409
    | 422
    | 500;
  return c.json({ error: { code, message } }, status);
}

/**
 * Global error handler for the Hono app.
 *
 * Catches unhandled exceptions and converts them to a consistent JSON shape.
 * Register via `app.onError(globalErrorHandler)`.
 */
export function globalErrorHandler(
  err: Error,
  c: Context,
): Response {
  console.error('[globalErrorHandler] Unhandled error:', err.message, err.stack);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
    500,
  );
}
