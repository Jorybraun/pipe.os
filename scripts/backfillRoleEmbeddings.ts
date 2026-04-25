#!/usr/bin/env node
/**
 * Backfill role embeddings for existing role_contexts rows.
 *
 * Queries all rows where embedding_json IS NULL, builds a searchable profile
 * from job_description_md + persona_json (or re-uses an existing
 * role_searchable_profile), calls embedAndUpsertRole, and persists the vector
 * to D1 + Vectorize.
 *
 * Usage:
 *   npx tsx scripts/backfillRoleEmbeddings.ts
 *   npx tsx scripts/backfillRoleEmbeddings.ts --dry-run
 */

import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..', 'workers', 'api');

import { runBackfill, type BackfillEnv, type BackfillRoleContextRow } from '../workers/api/src/lib/roleDiscovery/backfill';

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    batch: { type: 'string', default: '5' },
  },
  strict: false,
});

function now(): string {
  return new Date().toISOString();
}

async function main() {
  const dryRun = args['dry-run'] ?? false;
  const batchSize = parseInt(args.batch as string, 10) || 5;

  let env: BackfillEnv | null = null;

  if (!dryRun) {
    try {
      let wrangler: typeof import('wrangler');
      try {
        wrangler = await import('wrangler');
      } catch {
        // Fall back to workers/api node_modules if running from project root
        wrangler = await import(
          resolve(apiRoot, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js')
        );
      }
      const proxy = await wrangler.getPlatformProxy({
        persist: { path: resolve(apiRoot, '.wrangler', 'state') },
      });
      env = proxy.env as BackfillEnv;
      console.log('[backfill] Platform proxy ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill] Failed to get platform proxy: ${msg}`);
      process.exit(1);
    }
  }

  let rows: BackfillRoleContextRow[] = [];
  if (dryRun) {
    console.log('[backfill] Dry run — would query: SELECT ... FROM role_contexts WHERE embedding_json IS NULL');
  } else if (env) {
    const result = await env.DB.prepare(
      `SELECT id, role_searchable_profile, job_description_md, persona_json, pipeline_id, rcd_json
       FROM role_contexts
       WHERE embedding_json IS NULL`,
    ).all<BackfillRoleContextRow>();
    rows = result.results ?? [];
  }

  await runBackfill(env, rows, { dryRun, batchSize });
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith('backfillRoleEmbeddings.ts') ||
  false;

if (isMain) {
  main().catch((err) => {
    console.error('[backfill] Fatal error:', err);
    process.exit(1);
  });
}
