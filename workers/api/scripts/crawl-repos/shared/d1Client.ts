/**
 * Cloudflare D1 REST API client for the crawler.
 *
 * The crawler runs in Node.js (not a Worker), so it cannot use the D1
 * binding directly. Instead we hit the Cloudflare REST API:
 *   POST /accounts/{accountId}/d1/database/{databaseId}/query
 *
 * Required env vars:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN
 *   CLOUDFLARE_D1_DATABASE_ID
 */

import { logger } from './logger.js';
import type { D1Config, D1QueryResult } from './types.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';

export function loadD1Config(): D1Config {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken  = process.env['CLOUDFLARE_API_TOKEN'];
  const databaseId = process.env['CLOUDFLARE_D1_DATABASE_ID'];

  if (!accountId || !apiToken || !databaseId) {
    throw new Error(
      'Missing required env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_D1_DATABASE_ID',
    );
  }

  return { accountId, apiToken, databaseId };
}

export class D1Client {
  private readonly cfg: D1Config;

  constructor(cfg: D1Config) {
    this.cfg = cfg;
  }

  /** Execute a single SQL statement with positional parameters. */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: (string | number | null)[] = [],
  ): Promise<T[]> {
    const url = `${API_BASE}/accounts/${this.cfg.accountId}/d1/database/${this.cfg.databaseId}/query`;

    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.cfg.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`D1 HTTP ${res.status}: ${text}`);
    }

    const data = (await res.json()) as D1QueryResult;

    if (!data.success) {
      const msg = data.errors.map((e) => e.message).join('; ');
      throw new Error(`D1 query failed: ${msg}`);
    }

    return (data.result[0]?.results ?? []) as T[];
  }

  /**
   * Execute multiple statements as a batch.
   * D1 REST API processes them serially in a single transaction.
   */
  async batch(statements: Array<{ sql: string; params?: (string | number | null)[] }>): Promise<void> {
    // D1 batch endpoint
    const url = `${API_BASE}/accounts/${this.cfg.accountId}/d1/database/${this.cfg.databaseId}/query`;

    // D1 batch API: POST with array body
    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.cfg.apiToken}`,
        'Content-Type': 'application/json',
      },
      // Send as array for batch processing
      body: JSON.stringify(
        statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
      ),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`D1 batch HTTP ${res.status}: ${text}`);
    }

    const data = (await res.json()) as D1QueryResult | D1QueryResult[];
    const results = Array.isArray(data) ? data : [data];

    for (const r of results) {
      if (!r.success) {
        const msg = r.errors.map((e) => e.message).join('; ');
        throw new Error(`D1 batch failed: ${msg}`);
      }
    }
  }

  /**
   * Upsert in chunks to stay within D1's 100KB request body limit.
   * Each chunk runs as a separate batch call.
   */
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
