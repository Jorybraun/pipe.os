/**
 * Cloudflare D1 client for the crawler.
 *
 * Calls the D1 REST API directly with a scoped API token. Retries transient
 * auth / rate-limit / network blips with exponential backoff so long-running
 * crawl jobs don't fail partway through.
 *
 * Required env vars:
 *   CLOUDFLARE_ACCOUNT_ID      — Cloudflare account ID
 *   CLOUDFLARE_API_TOKEN       — Cloudflare API token with `D1:Edit`
 *   CLOUDFLARE_D1_DATABASE_ID  — D1 database ID
 */

import { logger } from './logger.js';
import type { D1Config } from './types.js';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 20_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Cloudflare error codes treated as transient.
 * Auth codes (10000 / 7403) are NOT retried: with a properly-scoped Account API
 * token they indicate misconfiguration and should fail fast. Retrying them only
 * masks the real problem and wastes ~30s per row on a bad token.
 */
const TRANSIENT_CODES = new Set<number>([
  7500, // Internal
  9999, // Unknown
]);

/** Cloudflare auth error codes — fail fast with a helpful message. */
const AUTH_CODES = new Set<number>([
  10000, // Authentication error
  7403,  // Account not authorized to access this service (token missing D1:Edit)
  9109,  // Unauthorized to access requested resource
]);

export function loadD1Config(): D1Config {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'] ?? '';
  const databaseId = process.env['CLOUDFLARE_D1_DATABASE_ID'] ?? '';

  if (!accountId) throw new Error('Missing required env var: CLOUDFLARE_ACCOUNT_ID');
  if (!apiToken) throw new Error('Missing required env var: CLOUDFLARE_API_TOKEN (needs D1:Edit scope)');
  if (!databaseId) throw new Error('Missing required env var: CLOUDFLARE_D1_DATABASE_ID');

  return { accountId, apiToken, databaseId };
}

export interface D1ClientOptions {
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface WranglerD1ClientOptions {
  command?: string;
  envName?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  configPaths?: string[];
  spawnSyncImpl?: typeof spawnSync;
}

function resolveRequestTimeoutMs(value: number | undefined): number {
  const candidate = value ?? Number(process.env['D1_REQUEST_TIMEOUT_MS'] ?? DEFAULT_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(candidate) || candidate <= 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.round(candidate);
}

interface D1RestResponse<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
  result?: Array<{
    success: boolean;
    results: T[];
    meta?: Record<string, unknown>;
  }>;
}

function backoff(attempt: number): number {
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = Math.random() * 0.3 * exp;
  return Math.round(exp + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class D1Client {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: D1Config, options: D1ClientOptions = {}) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;
    this.headers = {
      'Authorization': `Bearer ${cfg.apiToken}`,
      'Content-Type': 'application/json',
    };
    this.requestTimeoutMs = resolveRequestTimeoutMs(options.requestTimeoutMs);
    this.fetchImpl = options.fetchImpl ?? fetch;
    logger.debug('[d1] Client ready', { databaseId: cfg.databaseId });
  }

  /** Execute a single SQL statement with positional parameters, with retry/backoff. */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: (string | number | null)[] = [],
  ): Promise<T[]> {
    let lastErr: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ sql, params }),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });

        const bodyText = await res.text();
        let body: D1RestResponse<T>;
        try {
          body = JSON.parse(bodyText) as D1RestResponse<T>;
        } catch {
          throw new TransientError(`D1: non-JSON response (status ${res.status}): ${bodyText.slice(0, 200)}`);
        }

        if (res.status === 429 || res.status >= 500) {
          throw new TransientError(`D1 HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
        }

        if (!body.success) {
          const err = body.errors?.[0];
          const code = err?.code ?? 0;
          const msg = err?.message ?? 'unknown error';
          if (AUTH_CODES.has(code)) {
            throw new Error(
              `D1 auth failed (code ${code}): ${msg}. ` +
              `Check that CLOUDFLARE_API_TOKEN is an Account API token with "D1:Edit" permission ` +
              `(create one at https://dash.cloudflare.com/profile/api-tokens). ` +
              `User tokens with the "cfut_" prefix do not have D1 REST access.`,
            );
          }
          if (TRANSIENT_CODES.has(code)) {
            throw new TransientError(`D1 code ${code}: ${msg}`);
          }
          throw new Error(`D1 query failed: code ${code}: ${msg}`);
        }

        return body.result?.[0]?.results ?? [];
      } catch (err) {
        lastErr = err;

        const transient = err instanceof TransientError || isNetworkError(err);
        if (!transient || attempt === MAX_ATTEMPTS - 1) break;

        const waitMs = backoff(attempt);
        logger.warn('[d1] Transient error, retrying', {
          attempt: attempt + 1,
          waitMs,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(waitMs);
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** Execute multiple statements serially (each with its own retry). */
  async batch(statements: Array<{ sql: string; params?: (string | number | null)[] }>): Promise<void> {
    if (statements.length === 0) return;
    for (const stmt of statements) {
      await this.query(stmt.sql, stmt.params ?? []);
    }
  }

  /** Upsert in chunks. With the REST API each statement is one fast HTTP call, so chunking is just for logging cadence. */
  async upsertChunked(
    statements: Array<{ sql: string; params?: (string | number | null)[] }>,
    chunkSize = 50,
  ): Promise<void> {
    for (let i = 0; i < statements.length; i += chunkSize) {
      const chunk = statements.slice(i, i + chunkSize);
      logger.debug('[d1] Executing chunk', { offset: i, size: chunk.length });
      await this.batch(chunk);
    }
  }
}

function sqlLiteral(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot bind non-finite number to D1 query: ${value}`);
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

export function bindD1Sql(
  sql: string,
  params: (string | number | null)[] = [],
): string {
  if (params.length === 0) return sql;
  if (/\?\d+/.test(sql)) {
    return sql.replace(/\?(\d+)/g, (_match, rawIndex: string) => {
      const value = params[Number(rawIndex) - 1];
      if (value === undefined) throw new Error(`Missing D1 query parameter ?${rawIndex}`);
      return sqlLiteral(value);
    });
  }
  let nextParam = 0;
  return sql.replace(/\?/g, () => {
    const value = params[nextParam];
    nextParam += 1;
    if (value === undefined) throw new Error(`Missing D1 query parameter ?${nextParam}`);
    return sqlLiteral(value);
  });
}

function resolveWranglerCommand(env: NodeJS.ProcessEnv): string {
  if (env['WRANGLER_BIN']) return env['WRANGLER_BIN'];
  const candidates = process.platform === 'win32'
    ? ['node_modules/.bin/wrangler.cmd', 'workers/api/node_modules/.bin/wrangler.cmd']
    : ['node_modules/.bin/wrangler', 'workers/api/node_modules/.bin/wrangler'];
  return candidates.find((candidate) => existsSync(candidate)) ?? 'wrangler';
}

export function resolveWranglerD1DatabaseName(
  databaseIdOrName: string,
  {
    env = process.env,
    configPaths = ['wrangler.jsonc', 'workers/api/wrangler.jsonc'],
    readFile = readFileSync,
  }: {
    env?: NodeJS.ProcessEnv;
    configPaths?: string[];
    readFile?: typeof readFileSync;
  } = {},
): string {
  const explicit = env['CODE_REVIEW_RELIABILITY_D1_DATABASE_NAME']
    ?? env['MATCHING_EVALUATION_D1_DATABASE_NAME']
    ?? env['CLOUDFLARE_D1_DATABASE_NAME'];
  if (explicit) return explicit;

  for (const configPath of configPaths) {
    try {
      const config = readFile(configPath, 'utf8');
      const databaseBlocks = config.match(/\{[^{}]*"database_name"[^{}]*"database_id"[^{}]*\}/g) ?? [];
      for (const block of databaseBlocks) {
        const name = block.match(/"database_name"\s*:\s*"([^"]+)"/)?.[1];
        const id = block.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
        if (name && id && id === databaseIdOrName) return name;
      }
    } catch {
      // Try the next possible config location.
    }
  }

  return databaseIdOrName;
}

export class WranglerD1Client {
  private readonly command: string;
  private readonly envName: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cwd: string;
  private readonly databaseName: string;
  private readonly spawnSyncImpl: typeof spawnSync;

  constructor(databaseIdOrName: string, options: WranglerD1ClientOptions = {}) {
    this.env = options.env ?? process.env;
    this.command = options.command ?? resolveWranglerCommand(this.env);
    this.envName = options.envName ?? this.env['WRANGLER_D1_ENV'] ?? 'dev';
    this.cwd = options.cwd ?? process.cwd();
    this.databaseName = resolveWranglerD1DatabaseName(databaseIdOrName, {
      env: this.env,
      configPaths: options.configPaths,
    });
    this.spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
    logger.debug('[d1] Wrangler client ready', { databaseName: this.databaseName });
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: (string | number | null)[] = [],
  ): Promise<T[]> {
    const boundSql = bindD1Sql(sql, params);
    const result = this.spawnSyncImpl(this.command, [
      'd1',
      'execute',
      this.databaseName,
      '--env',
      this.envName,
      '--remote',
      '--json',
      '--command',
      boundSql,
    ], {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = result.stderr || result.stdout || `exit code ${result.status}`;
      throw new Error(`Wrangler D1 query failed: ${detail.slice(0, 1000)}`);
    }

    let body: unknown;
    try {
      body = JSON.parse(result.stdout);
    } catch {
      throw new Error(`Wrangler D1 returned non-JSON output: ${String(result.stdout).slice(0, 300)}`);
    }
    const statement = Array.isArray(body) ? body[0] : null;
    if (
      !statement
      || typeof statement !== 'object'
      || (statement as { success?: unknown }).success !== true
    ) {
      throw new Error(`Wrangler D1 statement failed: ${JSON.stringify(statement ?? body).slice(0, 300)}`);
    }
    const results = (statement as { results?: unknown }).results;
    return Array.isArray(results) ? results as T[] : [];
  }

  async batch(statements: Array<{ sql: string; params?: (string | number | null)[] }>): Promise<void> {
    if (statements.length === 0) return;
    for (const statement of statements) {
      await this.query(statement.sql, statement.params ?? []);
    }
  }

  async upsertChunked(
    statements: Array<{ sql: string; params?: (string | number | null)[] }>,
    chunkSize = 50,
  ): Promise<void> {
    for (let i = 0; i < statements.length; i += chunkSize) {
      const chunk = statements.slice(i, i + chunkSize);
      logger.debug('[d1] Executing Wrangler chunk', { offset: i, size: chunk.length });
      await this.batch(chunk);
    }
  }
}

class TransientError extends Error {}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('aborted') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('enotfound')
  );
}
