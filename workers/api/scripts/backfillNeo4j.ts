#!/usr/bin/env tsx
/**
 * Backfill existing D1 data into Neo4j.
 *
 * Reads from the local D1 SQLite file and writes candidate/role projections to
 * Neo4j using the canonical write functions.
 *
 * Usage:
 *   npx tsx scripts/backfillNeo4j.ts [--candidates] [--roles]
 *
 * Repo projection from legacy repo_nodes is intentionally disabled. Use
 * ingestReposToNeo4j.ts so repo projection rebuilds from source-backed D1
 * review packet/context records instead.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .dev.vars for NEO4J_* config
import dotenv from 'dotenv';
dotenv.config({ path: resolve('.dev.vars') });

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

import { buildNeo4jConfig, getNeo4jDriver, closeNeo4jDriver } from '../src/lib/neo4j/driver';
import { writeCandidateGraph } from '../src/lib/neo4j/writeCandidateGraph';
import { writeRoleGraph } from '../src/lib/neo4j/writeRoleGraph';

const DB_PATH = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c7052d4c5f690270845d2e1be0b13a62fc3f47b010c62f2243a64980dbf38f15.sqlite';
export const LEGACY_REPO_BACKFILL_DISABLED =
  'Legacy repo_nodes -> Neo4j backfill is disabled. Run scripts/ingestReposToNeo4j.ts to rebuild repo projection from source-backed review packet/context records.';

interface CandidateRow {
  id: string;
  created_at: number | null;
}

interface CandidateNodeRow {
  id: string;
  candidate_id: string;
  node_type: string;
  narrative_text: string;
  embedding_json: string | null;
  confidence: number | null;
  captured_at: number | null;
  superseded_at: number | null;
  source_type: string;
  source_reference: string | null;
  extracted_properties_json: string | null;
  supersedes: string | null;
  decomposition_version: string | null;
  created_at: number;
  updated_at: number;
}

interface RoleContextRow {
  id: string;
  pipeline_id: string | null;
  rcd_json: string | null;
}

interface RoleNodeRow {
  id: string;
  role_context_id: string;
  rcd_version: string;
  node_type: string;
  narrative_text: string;
  extracted_properties_json: string;
  embedding_json: string | null;
  source_section: string;
  source_stakeholder: string | null;
  weight: number | null;
  superseded_at: number | null;
}

const env = {
  NEO4J_URI: process.env['NEO4J_URI'],
  NEO4J_USER: process.env['NEO4J_USER'],
  NEO4J_PASSWORD: process.env['NEO4J_PASSWORD'],
};

function getDb() {
  return new Database(DB_PATH);
}

async function backfillCandidates(db: any) {
  console.log('\n--- Candidates ---');
  const candidates = db.prepare('SELECT id, created_at FROM candidates').all() as CandidateRow[];
  console.log(`Found ${candidates.length} candidates in D1`);

  // Get profile statuses from candidate_ingestion
  const ingestionStatuses = db.prepare('SELECT candidate_id, status FROM candidate_ingestion').all() as Array<{ candidate_id: string; status: string | null }>;
  const statusByCandidate = new Map<string, string>();
  for (const row of ingestionStatuses) {
    if (row.status) statusByCandidate.set(row.candidate_id, row.status);
  }

  const nodes = db.prepare(`
    SELECT id, candidate_id, node_type, narrative_text, embedding_json,
           confidence, captured_at, superseded_at, source_type,
           source_reference, extracted_properties_json, supersedes,
           decomposition_version, created_at, updated_at
    FROM candidate_nodes
    WHERE superseded_at IS NULL
  `).all() as CandidateNodeRow[];

  const nodesByCandidate = new Map<string, CandidateNodeRow[]>();
  for (const n of nodes) {
    const list = nodesByCandidate.get(n.candidate_id) ?? [];
    list.push(n);
    nodesByCandidate.set(n.candidate_id, list);
  }

  for (const c of candidates) {
    const candidateNodes = nodesByCandidate.get(c.id) ?? [];
    await writeCandidateGraph({
      candidateId: c.id,
      profileState: statusByCandidate.get(c.id) ?? 'seed',
      nodes: candidateNodes.map((n) => ({
        id: n.id,
        candidate_id: n.candidate_id,
        narrative_text: n.narrative_text,
        embedding_json: n.embedding_json,
        confidence: n.confidence,
        node_type: n.node_type as any,
        source_type: n.source_type,
        source_reference: n.source_reference,
        captured_at: n.captured_at ?? 0,
        superseded_at: n.superseded_at,
        extracted_properties_json: n.extracted_properties_json,
        supersedes: n.supersedes,
        decomposition_version: n.decomposition_version,
        created_at: n.created_at,
        updated_at: n.updated_at,
      })),
      env,
    });
  }

  console.log(`✓ Backfilled ${candidates.length} candidates with ${nodes.length} active nodes`);
}

async function backfillRoles(db: any) {
  console.log('\n--- Roles ---');
  const roles = db.prepare('SELECT id, pipeline_id, rcd_json FROM role_contexts').all() as RoleContextRow[];
  console.log(`Found ${roles.length} roles in D1`);

  const nodes = db.prepare(`
    SELECT id, role_context_id, rcd_version, node_type, narrative_text,
           extracted_properties_json, embedding_json, source_section,
           source_stakeholder, weight, superseded_at
    FROM role_nodes
    WHERE superseded_at IS NULL
  `).all() as RoleNodeRow[];

  const nodesByRole = new Map<string, RoleNodeRow[]>();
  for (const n of nodes) {
    const list = nodesByRole.get(n.role_context_id) ?? [];
    list.push(n);
    nodesByRole.set(n.role_context_id, list);
  }

  for (const r of roles) {
    const roleNodes = nodesByRole.get(r.id) ?? [];
    if (roleNodes.length === 0) continue;

    // Parse rcd_json to get rcd_version and pipeline_id
    let rcdVersion = 'unknown';
    let pipelineId = r.pipeline_id ?? r.id;
    try {
      const rcd = JSON.parse(r.rcd_json ?? '{}');
      rcdVersion = rcd.rcd_version ?? 'unknown';
      pipelineId = rcd.pipeline_id ?? r.pipeline_id ?? r.id;
    } catch {
      // ignore
    }

    await writeRoleGraph({
      roleContextId: r.id,
      pipelineId,
      rcdVersion,
      nodes: roleNodes.map((n) => ({
        id: n.id,
        role_context_id: n.role_context_id,
        rcd_version: n.rcd_version,
        node_type: n.node_type as any,
        narrative_text: n.narrative_text,
        extracted_properties_json: n.extracted_properties_json,
        embedding_json: n.embedding_json,
        source_section: n.source_section,
        source_stakeholder: n.source_stakeholder,
        weight: n.weight,
        superseded_at: n.superseded_at,
      })),
      env,
    });
  }

  console.log(`✓ Backfilled ${roles.length} roles with ${nodes.length} active nodes`);
}

export async function backfillRepos(_db: unknown): Promise<never> {
  throw new Error(LEGACY_REPO_BACKFILL_DISABLED);
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const doCandidates = all || args.includes('--candidates');
  const doRoles = all || args.includes('--roles');
  const doRepos = all || args.includes('--repos');

  if (!doCandidates && !doRoles && !doRepos) {
    console.log('Usage: npx tsx scripts/backfillNeo4j.ts [--candidates] [--roles] [--repos] [--all]');
    console.log('  --repos / --all fail closed; use scripts/ingestReposToNeo4j.ts for repo projection.');
    process.exit(1);
  }

  const config = buildNeo4jConfig(env);
  if (!config) {
    console.error('Missing Neo4j config. Set NEO4J_URI and NEO4J_PASSWORD in .dev.vars');
    process.exit(1);
  }

  // Verify connection
  const driver = getNeo4jDriver(config);
  const session = driver.session();
  try {
    const result = await session.run('RETURN 1 AS n');
    const n = result.records[0]?.get('n');
    if (n !== 1 && n?.toNumber?.() !== 1) {
      throw new Error('Neo4j health check failed');
    }
    console.log('✓ Neo4j connection verified');
  } finally {
    await session.close();
  }

  const db = getDb();

  try {
    if (doCandidates) await backfillCandidates(db);
    if (doRoles) await backfillRoles(db);
    if (doRepos) await backfillRepos(db);
  } finally {
    db.close();
    await closeNeo4jDriver();
  }

  console.log('\nBackfill complete.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
