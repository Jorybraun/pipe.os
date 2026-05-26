/**
 * Backfill script: Update existing Role nodes in Neo4j with matching policy.
 *
 * Reads all role_contexts from D1, resolves policy from
 * pipeline_match_config / role_contexts config, and MERGEs the policy
 * properties onto the corresponding Role nodes in Neo4j.
 *
 * Usage:
 *   npx tsx scripts/backfillRolePolicies.ts
 *
 * Requires D1_DATABASE_PATH env var (local SQLite path) or a .dev.vars file.
 */

import Database from 'better-sqlite3';
import { buildNeo4jConfig, getNeo4jDriver } from '../src/lib/neo4j/driver';
import { runWriteQuery } from '../src/lib/neo4j/query';
import { resolvePolicyFromConfig } from '../src/lib/neo4j/writeRoleGraph';

const D1_PATH = process.env['D1_DATABASE_PATH'] ?? '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite';
const NEO4J_URI = process.env['NEO4J_URI'] ?? 'bolt://localhost:7687';
const NEO4J_USER = process.env['NEO4J_USER'] ?? 'neo4j';
const NEO4J_PASSWORD = process.env['NEO4J_PASSWORD'] ?? 'pipe-local-dev';

async function main() {
  console.log('[backfillRolePolicies] starting...');

  // Find SQLite file
  const { globSync } = await import('glob');
  const files = globSync(D1_PATH);
  if (files.length === 0) {
    console.error('[backfillRolePolicies] no D1 SQLite files found at', D1_PATH);
    process.exit(1);
  }
  const dbPath = files[0]!;
  console.log('[backfillRolePolicies] using D1:', dbPath);

  const db = new Database(dbPath);

  // Load all role contexts with their config
  const rows = db
    .prepare(
      `SELECT rc.id, rc.pipeline_id,
              rc.match_philosophy AS rc_phil, rc.tolerance AS rc_tol,
              pmc.match_philosophy AS pmc_phil, pmc.tolerance AS pmc_tol, pmc.hybrid_mix_ratio
       FROM role_contexts rc
       LEFT JOIN pipeline_match_config pmc ON pmc.pipeline_id = rc.pipeline_id`,
    )
    .all() as Array<{
      id: string;
      pipeline_id: string;
      rc_phil: string | null;
      rc_tol: string | null;
      pmc_phil: string | null;
      pmc_tol: string | null;
      hybrid_mix_ratio: number | null;
    }>;

  console.log('[backfillRolePolicies] found', rows.length, 'roles');

  if (rows.length === 0) {
    console.log('[backfillRolePolicies] nothing to do');
    db.close();
    return;
  }

  // Connect to Neo4j
  const config = buildNeo4jConfig({ NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD });
  if (!config) {
    console.error('[backfillRolePolicies] Neo4j config missing');
    process.exit(1);
  }
  const driver = getNeo4jDriver(config);

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const policy = resolvePolicyFromConfig({
      tolerance: row.pmc_tol ?? row.rc_tol,
      match_philosophy: row.pmc_phil ?? row.rc_phil,
      hybrid_mix_ratio: row.hybrid_mix_ratio ?? undefined,
    });

    try {
      await runWriteQuery(driver, `
        MATCH (r:Role {role_context_id: $role_context_id})
        SET r.similarity_threshold = $similarity_threshold,
            r.confidence_threshold = $confidence_threshold,
            r.dealbreaker_threshold = $dealbreaker_threshold,
            r.evidence_cap = $evidence_cap,
            r.result_limit = $result_limit,
            r.match_philosophy = $match_philosophy,
            r.hybrid_mix_ratio = $hybrid_mix_ratio,
            r.updated_at = $updated_at
      `, {
        role_context_id: row.id,
        similarity_threshold: policy.similarity_threshold,
        confidence_threshold: policy.confidence_threshold,
        dealbreaker_threshold: policy.dealbreaker_threshold,
        evidence_cap: policy.evidence_cap,
        result_limit: policy.result_limit,
        match_philosophy: policy.match_philosophy,
        hybrid_mix_ratio: policy.hybrid_mix_ratio,
        updated_at: Math.floor(Date.now() / 1000),
      });
      updated++;
      console.log('[backfillRolePolicies] updated', row.id);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[backfillRolePolicies] failed for', row.id, ':', msg);
    }
  }

  await driver.close();
  db.close();

  console.log(
    JSON.stringify({
      event: 'backfillRolePolicies.complete',
      total: rows.length,
      updated,
      failed,
    }),
  );
}

main().catch((err) => {
  console.error('[backfillRolePolicies] fatal:', err);
  process.exit(1);
});
