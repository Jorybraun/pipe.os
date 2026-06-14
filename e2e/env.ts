/**
 * Shared E2E environment config.
 *
 * Reads API_BASE / APP_BASE from process.env so the same specs work
 * against both local dev servers and the deployed Cloudflare test env.
 */

export const API_BASE: string =
  process.env.API_BASE || 'http://localhost:8787';

export const APP_BASE: string =
  process.env.APP_BASE || 'http://localhost:5173';

/** True when running against a remote (non-localhost) deployment. */
export const IS_REMOTE: boolean =
  !API_BASE.includes('localhost') || !APP_BASE.includes('localhost');
