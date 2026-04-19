#!/usr/bin/env tsx
/**
 * mass-ingest-pass3.ts — Bulk approve + vectorize all Pass-3-analyzed repos.
 *
 * OVERRIDE NOTICE:
 *   This script explicitly overrides the ADR-033 (2026-04-17) human-gated-
 *   vectorization rule. Normally each repo requires a manual admin_verdict
 *   approval before ingest. This script bulk-approves all repos where Gemma
 *   returned challenge_suitability_verdict IN ('suitable', 'hold') and
 *   vectorized_at IS NULL.
 *
 *   Override approved by user (Jory Braun) on 2026-04-18 for the initial
 *   production seed of REPO_INDEX following the 3-pass crawl.
 *   Decision Log entry to be added to knowledge/STRATEGY.md by user.
 *
 * Usage:
 *   npx tsx scripts/mass-ingest-pass3.ts --dry-run
 *   npx tsx scripts/mass-ingest-pass3.ts --limit 10
 *   npx tsx scripts/mass-ingest-pass3.ts --verdict suitable --concurrency 3
 *   npx tsx scripts/mass-ingest-pass3.ts            # full run: all suitable+hold
 *
 * Env (from .dev.vars):
 *   CLOUDFLARE_ACCOUNT_ID       — Cloudflare account ID
 *   CLOUDFLARE_API_TOKEN        — Cloudflare API token with D1:Edit scope
 *   CLOUDFLARE_D1_DATABASE_ID   — D1 database ID
 *   WORKER_URL                  — Worker base URL (default: https://pipe-api.jorybraun.workers.dev)
 *   ADMIN_CLERK_TOKEN           — Clerk JWT for /api/v1/admin/* routes
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..');
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';
import { logger } from './crawl-repos/shared/logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_WORKER_URL = 'https://pipe-api.jorybraun.workers.dev';
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 5;
const MAX_SAFE_COUNT = 500;
const VECTORIZE_RETRY_DELAY_MS = 5_000;

// ─── Types ────────────────────────────────────────────────────────────────────

type Verdict = 'suitable' | 'hold';

interface TargetRepo {
  repo_id: number;
  full_name: string;
  challenge_suitability_verdict: Verdict;
}

type IngestStatus = 'ok' | 'failed' | 'skipped';

interface ReportRow {
  repo_id: number;
  full_name: string;
  verdict: Verdict;
  status: IngestStatus;
  message: string;
  vectorized_at: string;
}

interface IngestSuccess {
  ok: true;
  id: number;
  vectorized_at: string;
}

interface IngestError {
  error: { code: string; message: string };
}

type IngestResponse = IngestSuccess | IngestError;

interface ParsedArgs {
  dryRun: boolean;
  limit: number | null;
  concurrency: number;
  verdict: 'suitable' | 'hold' | 'both';
  iReallyMeanIt: boolean;
}

// ─── CLI Arg Parsing ─────────────────────────────────────────────────────────

function parseCliArgs(): ParsedArgs {
  const { values } = parseArgs({
    options: {
      'dry-run':         { type: 'boolean', default: false },
      'limit':           { type: 'string'  },
      'concurrency':     { type: 'string'  },
      'verdict':         { type: 'string'  },
      'i-really-mean-it': { type: 'boolean', default: false },
    },
  });

  const limitRaw = values['limit'];
  const concurrencyRaw = values['concurrency'];
  const verdictRaw = values['verdict'];

  let limit: number | null = null;
  if (limitRaw !== undefined) {
    limit = parseInt(limitRaw, 10);
    if (!Number.isFinite(limit) || limit <= 0) {
      logger.error('[mass-ingest] --limit must be a positive integer', { given: limitRaw });
      process.exit(1);
    }
  }

  let concurrency = DEFAULT_CONCURRENCY;
  if (concurrencyRaw !== undefined) {
    concurrency = parseInt(concurrencyRaw, 10);
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
      logger.error('[mass-ingest] --concurrency must be a positive integer', { given: concurrencyRaw });
      process.exit(1);
    }
    if (concurrency > MAX_CONCURRENCY) {
      logger.warn('[mass-ingest] --concurrency capped to max', { requested: concurrency, max: MAX_CONCURRENCY });
      concurrency = MAX_CONCURRENCY;
    }
  }

  let verdict: 'suitable' | 'hold' | 'both' = 'both';
  if (verdictRaw !== undefined) {
    if (verdictRaw !== 'suitable' && verdictRaw !== 'hold') {
      logger.error('[mass-ingest] --verdict must be "suitable" or "hold"', { given: verdictRaw });
      process.exit(1);
    }
    verdict = verdictRaw;
  }

  return {
    dryRun: values['dry-run'] ?? false,
    limit,
    concurrency,
    verdict,
    iReallyMeanIt: values['i-really-mean-it'] ?? false,
  };
}

// ─── Env Validation ───────────────────────────────────────────────────────────

interface Config {
  workerUrl: string;
  adminClerkToken: string;
}

function loadConfig(): Config {
  const workerUrl = process.env['WORKER_URL'] ?? DEFAULT_WORKER_URL;
  const adminClerkToken = process.env['ADMIN_CLERK_TOKEN'] ?? '';

  if (!adminClerkToken) {
    logger.error(
      '[mass-ingest] ADMIN_CLERK_TOKEN is not set.\n' +
      '  To get one:\n' +
      '  1. Open the Pipe admin dashboard in Chrome\n' +
      '  2. Open DevTools → Network tab\n' +
      '  3. Reload and click any /api/v1/admin/* request\n' +
      '  4. Copy the "Authorization: Bearer <token>" header value\n' +
      '  5. Add to .dev.vars:  ADMIN_CLERK_TOKEN=<token>\n' +
      '  Note: Clerk tokens expire in ~1 hour.',
    );
    process.exit(1);
  }

  return { workerUrl, adminClerkToken };
}

// ─── D1 Helpers ───────────────────────────────────────────────────────────────

async function fetchTargets(d1: D1Client, verdict: 'suitable' | 'hold' | 'both'): Promise<TargetRepo[]> {
  const verdictClause =
    verdict === 'both'
      ? `res.challenge_suitability_verdict IN ('suitable', 'hold')`
      : `res.challenge_suitability_verdict = '${verdict}'`;

  const sql = `
    SELECT res.repo_id, qr.full_name, res.challenge_suitability_verdict
    FROM repo_engineering_signals res
    JOIN qualified_repos qr ON qr.id = res.repo_id
    WHERE ${verdictClause}
      AND (res.vectorized_at IS NULL)
    ORDER BY res.repo_id
  `;

  const rows = await d1.query<TargetRepo>(sql);
  return rows;
}

async function bulkApprove(d1: D1Client, repoId: number, nowIso: string): Promise<void> {
  await d1.query(
    `UPDATE repo_engineering_signals
     SET admin_verdict = 'approved',
         verdict_at = ?,
         admin_feedback_text = 'bulk ingest 2026-04-18'
     WHERE repo_id = ?`,
    [nowIso, repoId],
  );
}

// ─── HTTP Ingest ─────────────────────────────────────────────────────────────

async function callIngest(
  workerUrl: string,
  token: string,
  repoId: number,
): Promise<IngestResponse> {
  const url = `${workerUrl}/api/v1/admin/repos/${repoId}/pass3/ingest`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const body = await res.json() as IngestResponse;
  return body;
}

// ─── Concurrency Helper ───────────────────────────────────────────────────────

/**
 * Worker-pool concurrency: N workers pull from a shared index until exhausted.
 * This avoids the semaphore-on-Promise.all anti-pattern.
 */
async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < items.length) {
        const idx = i++;
        const item = items[idx];
        if (item !== undefined) {
          await fn(item, idx);
        }
      }
    }),
  );
}

// ─── CSV Writing ──────────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  // Always quote; double any internal quotes.
  return `"${value.replace(/"/g, '""')}"`;
}

function buildCsv(rows: ReportRow[]): string {
  const header = 'repo_id,full_name,verdict,status,message,vectorized_at';
  const lines = rows.map((r) =>
    [
      String(r.repo_id),
      csvEscape(r.full_name),
      csvEscape(r.verdict),
      csvEscape(r.status),
      csvEscape(r.message),
      csvEscape(r.vectorized_at),
    ].join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseCliArgs();
  const d1 = new D1Client(loadD1Config());

  // Config check — validate ADMIN_CLERK_TOKEN first (even in dry-run, print it
  // so the user knows they're set up correctly).
  const config = loadConfig();

  logger.info('[mass-ingest] Starting', {
    dryRun: args.dryRun,
    limit: args.limit ?? 'none',
    concurrency: args.concurrency,
    verdict: args.verdict,
    workerUrl: config.workerUrl,
    tokenPresent: true, // never log the token itself
  });

  // Fetch targets from D1.
  logger.info('[mass-ingest] Querying D1 for targets...');
  let targets = await fetchTargets(d1, args.verdict);

  // Count breakdown for summary.
  const suitableCount = targets.filter((r) => r.challenge_suitability_verdict === 'suitable').length;
  const holdCount     = targets.filter((r) => r.challenge_suitability_verdict === 'hold').length;

  logger.info('[mass-ingest] Target summary', {
    total: targets.length,
    suitable: suitableCount,
    hold: holdCount,
  });

  // Sanity guard: refuse > MAX_SAFE_COUNT without explicit override flag.
  if (targets.length > MAX_SAFE_COUNT && !args.iReallyMeanIt) {
    logger.error(
      `[mass-ingest] Target count (${targets.length}) exceeds safety threshold (${MAX_SAFE_COUNT}). ` +
      `Pass --i-really-mean-it to proceed anyway.`,
    );
    process.exit(1);
  }

  // Apply limit if specified.
  if (args.limit !== null) {
    targets = targets.slice(0, args.limit);
    logger.info('[mass-ingest] Limit applied', { limit: args.limit, effectiveCount: targets.length });
  }

  // Dry-run: print preview table and exit.
  if (args.dryRun) {
    logger.info('[mass-ingest] DRY RUN — no D1 writes or ingest calls will be made.');
    console.log('\nPreview (first 50):');
    console.log('  repo_id  verdict    full_name');
    console.log('  -------  ---------  --------------------------------');
    for (const repo of targets.slice(0, 50)) {
      console.log(`  ${String(repo.repo_id).padEnd(7)}  ${repo.challenge_suitability_verdict.padEnd(9)}  ${repo.full_name}`);
    }
    if (targets.length > 50) {
      console.log(`  ... and ${targets.length - 50} more`);
    }
    console.log(`\nWould process ${targets.length} repos (${suitableCount} suitable, ${holdCount} hold).\n`);
    return;
  }

  // Real run: process with concurrency.
  const report: ReportRow[] = [];
  let okCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const nowIso = new Date().toISOString();

  await withConcurrency(targets, args.concurrency, async (repo) => {
    const { repo_id, full_name, challenge_suitability_verdict: verdict } = repo;

    // Step A: Approve in D1.
    try {
      await bulkApprove(d1, repo_id, nowIso);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[mass-ingest] D1 approve failed', { repo_id, full_name, error: msg });
      failedCount++;
      report.push({ repo_id, full_name, verdict, status: 'failed', message: `D1 approve error: ${msg}`, vectorized_at: '' });
      return;
    }

    // Step B: Call ingest endpoint, with one retry on vectorize failure.
    const attemptIngest = async (): Promise<IngestResponse> =>
      callIngest(config.workerUrl, config.adminClerkToken, repo_id);

    let ingestResult: IngestResponse;
    try {
      ingestResult = await attemptIngest();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[mass-ingest] Ingest HTTP error', { repo_id, full_name, error: msg });
      failedCount++;
      report.push({ repo_id, full_name, verdict, status: 'failed', message: `HTTP error: ${msg}`, vectorized_at: '' });
      return;
    }

    // Handle structured errors.
    if (!('ok' in ingestResult)) {
      const { code, message } = ingestResult.error;

      // VALIDATION_ERROR (HTTP 422, not 400 — see apiError map) with "admin_verdict must be approved"
      // means our UPDATE didn't land before the ingest call raced ahead.
      if (code === 'VALIDATION_ERROR' && message.includes('admin_verdict must be')) {
        logger.warn('[mass-ingest] D1 update did not land before ingest call (verdict mismatch)', {
          repo_id,
          full_name,
          errorCode: code,
        });
        skippedCount++;
        report.push({ repo_id, full_name, verdict, status: 'skipped', message: `verdict not landed: ${message}`, vectorized_at: '' });
        return;
      }

      // 500 INTERNAL_ERROR "vectorize failed" — retry once with backoff.
      if (code === 'INTERNAL_ERROR' && message.includes('vectorize failed')) {
        logger.warn('[mass-ingest] Vectorize failed, retrying once after delay', {
          repo_id,
          full_name,
          delayMs: VECTORIZE_RETRY_DELAY_MS,
        });
        await new Promise<void>((r) => setTimeout(r, VECTORIZE_RETRY_DELAY_MS));

        let retryResult: IngestResponse;
        try {
          retryResult = await attemptIngest();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('[mass-ingest] Retry HTTP error', { repo_id, full_name, error: msg });
          failedCount++;
          report.push({ repo_id, full_name, verdict, status: 'failed', message: `retry HTTP error: ${msg}`, vectorized_at: '' });
          return;
        }

        if ('ok' in retryResult) {
          logger.info('[mass-ingest] [OK] retry succeeded', { repo_id, full_name, vectorized_at: retryResult.vectorized_at });
          okCount++;
          report.push({ repo_id, full_name, verdict, status: 'ok', message: 'vectorized (retry)', vectorized_at: retryResult.vectorized_at });
        } else {
          const retryMsg = retryResult.error.message;
          logger.error('[mass-ingest] [FAIL] retry also failed', { repo_id, full_name, error: retryMsg });
          failedCount++;
          report.push({ repo_id, full_name, verdict, status: 'failed', message: `vectorize retry failed: ${retryMsg}`, vectorized_at: '' });
        }
        return;
      }

      // Any other error — log + skip, don't abort.
      logger.error('[mass-ingest] [FAIL] ingest returned error', { repo_id, full_name, code, message });
      failedCount++;
      report.push({ repo_id, full_name, verdict, status: 'failed', message: `${code}: ${message}`, vectorized_at: '' });
      return;
    }

    // Success.
    logger.info('[mass-ingest] [OK]', { repo_id, full_name, vectorized_at: ingestResult.vectorized_at });
    okCount++;
    report.push({ repo_id, full_name, verdict, status: 'ok', message: 'vectorized', vectorized_at: ingestResult.vectorized_at });
  });

  // Final counts.
  logger.info('[mass-ingest] Complete', {
    total: targets.length,
    ok: okCount,
    failed: failedCount,
    skipped: skippedCount,
  });

  // Sort report by repo_id so successive runs produce clean diffs.
  report.sort((a, b) => a.repo_id - b.repo_id);

  // Write CSV report.
  const csvPath = resolve(apiRoot, 'scripts/mass-ingest-pass3-report.csv');
  await writeFile(csvPath, buildCsv(report), 'utf8');
  logger.info('[mass-ingest] Report written', { path: csvPath });
}

main().catch((err: unknown) => {
  logger.error('[mass-ingest] Fatal error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
