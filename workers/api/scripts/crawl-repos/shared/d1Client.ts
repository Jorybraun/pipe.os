/**
 * Cloudflare D1 client for the crawler.
 *
 * Uses `wrangler d1 execute --remote` under the hood — wrangler handles auth
 * via CLOUDFLARE_API_TOKEN automatically, bypassing REST API token scope issues.
 *
 * Required env vars:
 *   CLOUDFLARE_API_TOKEN       — Cloudflare API token (wrangler uses this)
 *   CLOUDFLARE_D1_DATABASE_ID  — D1 database ID (used to look up the name)
 *
 * Optional:
 *   CLOUDFLARE_D1_DATABASE_NAME — override the DB name (default: derived from wrangler.jsonc)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import type { D1Config } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRANGLER_BIN = resolve(__dirname, '../../../node_modules/.bin/wrangler');
const WRANGLER_JSONC = resolve(__dirname, '../../../../wrangler.jsonc');

function stripJsoncComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, '');
}

function resolveDatabaseName(databaseId: string): string {
  const override = process.env['CLOUDFLARE_D1_DATABASE_NAME'];
  if (override) return override;

  try {
    const raw = readFileSync(WRANGLER_JSONC, 'utf-8');
    const parsed = JSON.parse(stripJsoncComments(raw)) as {
      d1_databases?: Array<{ database_name: string; database_id: string }>;
    };
    const match = parsed.d1_databases?.find((db) => db.database_id === databaseId);
    if (match) return match.database_name;
  } catch {
    // fall through to default
  }

  return 'pipe-db';
}

export function loadD1Config(): D1Config {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  const apiToken  = process.env['CLOUDFLARE_API_TOKEN'] ?? '';
  const databaseId = process.env['CLOUDFLARE_D1_DATABASE_ID'];

  if (!databaseId) {
    throw new Error('Missing required env var: CLOUDFLARE_D1_DATABASE_ID');
  }

  return { accountId, apiToken, databaseId };
}

/** Substitute ? placeholders with literal values (safe for number/null/string). */
function interpolateSql(sql: string, params: (string | number | null)[]): string {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const p = params[i++];
    if (p === null || p === undefined) return 'NULL';
    if (typeof p === 'number') return String(p);
    return `'${String(p).replace(/'/g, "''")}'`;
  });
}

export class D1Client {
  private readonly dbName: string;

  constructor(cfg: D1Config) {
    this.dbName = resolveDatabaseName(cfg.databaseId);
    logger.debug('[d1] Using database', { name: this.dbName });
  }

  /** Execute a single SQL statement with positional parameters. */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: (string | number | null)[] = [],
  ): Promise<T[]> {
    const interpolated = interpolateSql(sql, params);

    // Strip CLOUDFLARE_API_TOKEN so wrangler falls back to its stored OAuth credentials.
    // The cfut_ user tokens fail the D1 REST API; wrangler's own OAuth login works.
    const env = { ...process.env };
    delete env['CLOUDFLARE_API_TOKEN'];

    let stdout: string;
    try {
      stdout = execFileSync(
        WRANGLER_BIN,
        ['d1', 'execute', this.dbName, '--remote', '--json', '--command', interpolated],
        { encoding: 'utf-8', env, stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const detail = e.stderr || e.stdout || e.message || String(err);
      throw new Error(`D1 exec failed: ${detail}`);
    }

    // wrangler --json writes an array: [{ results, success, meta }]
    // Strip any non-JSON preamble lines (wrangler may emit banner to stdout in some versions)
    const jsonStart = stdout.indexOf('[');
    if (jsonStart === -1) throw new Error(`D1: no JSON in wrangler output: ${stdout.slice(0, 200)}`);
    const parsed = JSON.parse(stdout.slice(jsonStart)) as Array<{
      results: T[];
      success: boolean;
      error?: string;
    }>;

    if (!parsed[0]?.success) {
      throw new Error(`D1 query failed: ${parsed[0]?.error ?? 'unknown'}`);
    }

    return parsed[0]?.results ?? [];
  }

  /** Execute multiple statements serially. */
  async batch(statements: Array<{ sql: string; params?: (string | number | null)[] }>): Promise<void> {
    if (statements.length === 0) return;
    for (const stmt of statements) {
      await this.query(stmt.sql, stmt.params ?? []);
    }
  }

  /** Upsert in chunks to avoid hitting wrangler command-size limits. */
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
