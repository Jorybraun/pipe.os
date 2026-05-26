#!/usr/bin/env node
/**
 * Backfill candidate embeddings for existing candidate_ingestion rows.
 *
 * Queries all rows where profile_version IS NULL or < 'candidate-v3',
 * augments the existing candidate_searchable_profile with structured JSON
 * signals from the adjacent D1 columns, calls embedAndUpsertCandidate, and
 * persists the new vector + version to D1 + Vectorize.
 *
 * Usage:
 *   npx tsx scripts/backfillCandidateEmbeddings.ts
 *   npx tsx scripts/backfillCandidateEmbeddings.ts --dry-run
 */

import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..', 'workers', 'api');

import {
  runBackfill,
  type BackfillEnv,
  type BackfillCandidateRow,
} from '../workers/api/src/lib/candidateDiscovery/backfill';

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    batch: { type: 'string', default: '5' },
  },
  strict: false,
});

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

  let rows: BackfillCandidateRow[] = [];
  if (dryRun) {
    console.log(
      `[backfill] Dry run — would query: SELECT ... FROM candidate_ingestion WHERE profile_version IS NULL OR profile_version < 'candidate-v3'`
    );
  } else if (env) {
    const result = await env.DB.prepare(
      `SELECT candidate_id,
              candidate_searchable_profile,
              key_concepts_json,
              career_context_json,
              situation_signature_json
         FROM candidate_ingestion
        WHERE profile_version IS NULL
           OR profile_version < 'candidate-v3'`
    ).all<BackfillCandidateRow>();
    rows = result.results ?? [];
  }

  await runBackfill(env, rows, { dryRun, batchSize });
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith('backfillCandidateEmbeddings.ts') ||
  false;

if (isMain) {
  main().catch((err) => {
    console.error('[backfill] Fatal error:', err);
    process.exit(1);
  });
}
