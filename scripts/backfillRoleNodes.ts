#!/usr/bin/env node
/**
 * Backfill role_nodes for existing role_contexts rows.
 *
 * Queries role_contexts where status = 'COMPLETE' and rcd_json IS NOT NULL,
 * decomposes each RCD into role nodes, and persists them to D1 + Vectorize.
 *
 * Usage:
 *   npx tsx scripts/backfillRoleNodes.ts [--dry-run] [--batch=50] [--role-context-id=<id>]
 */

import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..', 'workers', 'api');

import {
  decomposeRcdIntoNodes,
  persistRoleNodes,
} from '../workers/api/src/lib/roleAgent/decomposeRcd';
import type { Env, RoleContextDocument } from '../workers/api/src/types';

const { values: args, positionals } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    batch: { type: 'string', default: '50' },
    'role-context-id': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: false,
});

if (args.help || positionals.includes('--help') || positionals.includes('-h')) {
  console.log(
    'Usage: npx tsx scripts/backfillRoleNodes.ts [--dry-run] [--batch=50] [--role-context-id=<id>]',
  );
  process.exit(0);
}

interface RoleContextNeedingBackfill {
  id: string;
  rcd_json: string;
}

interface ProcessResult {
  roleContextId: string;
  nodeCount: number;
  skipped: boolean;
  error: string | null;
}

async function fetchRolesNeedingBackfill(
  db: D1Database,
  opts: { batch: number; roleContextId?: string | undefined },
): Promise<RoleContextNeedingBackfill[]> {
  if (opts.roleContextId) {
    const result = await db
      .prepare(
        `SELECT id, rcd_json FROM role_contexts WHERE id = ? AND status = 'COMPLETE' AND rcd_json IS NOT NULL`,
      )
      .bind(opts.roleContextId)
      .all<RoleContextNeedingBackfill>();
    return result.results ?? [];
  }

  const result = await db
    .prepare(
      `SELECT id, rcd_json FROM role_contexts WHERE status = 'COMPLETE' AND rcd_json IS NOT NULL ORDER BY id LIMIT ?`,
    )
    .bind(opts.batch)
    .all<RoleContextNeedingBackfill>();
  return result.results ?? [];
}

async function hasActiveRoleNodes(db: D1Database, roleContextId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `SELECT COUNT(*) as count FROM role_nodes WHERE role_context_id = ? AND superseded_at IS NULL`,
    )
    .bind(roleContextId)
    .first<{ count: number }>();
  return (result?.count ?? 0) > 0;
}

async function processRole(
  env: Env,
  role: RoleContextNeedingBackfill,
  dryRun: boolean,
): Promise<ProcessResult> {
  const roleContextId = role.id;

  try {
    // Idempotency check — skip if active nodes already exist
    const alreadyHasNodes = await hasActiveRoleNodes(env.DB, roleContextId);
    if (alreadyHasNodes) {
      return { roleContextId, nodeCount: 0, skipped: true, error: null };
    }

    // Parse RCD JSON
    let rcd: RoleContextDocument;
    try {
      rcd = JSON.parse(role.rcd_json) as RoleContextDocument;
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return { roleContextId, nodeCount: 0, skipped: false, error: `RCD parse error: ${msg}` };
    }

    // Decompose into nodes
    const nodes = decomposeRcdIntoNodes(rcd, roleContextId);
    if (nodes.length === 0) {
      return { roleContextId, nodeCount: 0, skipped: false, error: 'No nodes produced' };
    }

    if (dryRun) {
      return { roleContextId, nodeCount: nodes.length, skipped: false, error: null };
    }

    // Persist to D1 and Vectorize
    await persistRoleNodes(nodes, env, env.DB);
    return { roleContextId, nodeCount: nodes.length, skipped: false, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { roleContextId, nodeCount: 0, skipped: false, error: msg };
  }
}

async function main() {
  const dryRun = Boolean(args['dry-run'] ?? false);
  const batch = parseInt(args.batch as string, 10) || 50;
  const roleContextId = args['role-context-id'] as string | undefined;

  let env: Env;

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
    env = proxy.env as Env;
    console.log('[backfill] Platform proxy ready');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backfill] Failed to get platform proxy: ${msg}`);
    process.exit(1);
  }

  console.log(`[backfill] Fetching role contexts needing backfill...`);
  const roles = await fetchRolesNeedingBackfill(env.DB, { batch, roleContextId });
  console.log(`[backfill] ${roles.length} role context(s) to process`);

  if (roles.length === 0) {
    console.log('[backfill] No role contexts need backfill.');
    return;
  }

  let totalProcessed = 0;
  let totalNodesWritten = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const role of roles) {
    const result = await processRole(env, role, dryRun);
    totalProcessed++;

    if (result.skipped) {
      totalSkipped++;
    } else if (result.error) {
      totalErrors++;
    } else {
      totalNodesWritten += result.nodeCount;
    }

    console.log(
      JSON.stringify({
        roleContextId: result.roleContextId,
        nodeCount: result.nodeCount,
        skipped: result.skipped,
        error: result.error,
      }),
    );
  }

  console.log('\n═══ Backfill Report ═══');
  console.log(`Role contexts processed: ${totalProcessed}`);
  console.log(`  Nodes written: ${totalNodesWritten}`);
  console.log(`  Skipped:       ${totalSkipped}`);
  console.log(`  Errors:        ${totalErrors}`);
  console.log(`Dry run:         ${dryRun}`);
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith('backfillRoleNodes.ts') ||
  false;

if (isMain) {
  main().catch((err) => {
    console.error('[backfill] Fatal error:', err);
    process.exit(1);
  });
}
