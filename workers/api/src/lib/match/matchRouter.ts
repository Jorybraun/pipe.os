/**
 * matchRouter.ts — Routing layer for role→candidate matching.
 *
 * Neo4j-first: always uses Cypher per-element matching + D1 hydration for metadata.
 *
 * Target latency: <100ms
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../../types';
import type {
  RequirementMatch,
  DealbreakerFailure,
} from '../neo4j/matchingQueries';
import {
  matchCandidatesForRole,
} from '../neo4j/matchingQueries';
import { parseEmbeddingJson } from '../embedding/cosine';
import { buildNeo4jConfig, createNeo4jDriver } from '../neo4j/driver';

export interface MatchRouterInput {
  roleContextId: string;
  db: D1Database;
  env: Env;
  limit?: number;
  ownerId?: string;
}

export interface UnifiedCandidateMatch {
  candidateId: string;
  score: number;
  name?: string;
  email?: string;
  pipelineId?: string;
  pipelineName?: string;
  status?: string;
  /** Neo4j-only: per-requirement evidence */
  requirementMatches?: RequirementMatch[];
  /** Neo4j-only: failed dealbreakers (empty = passed all) */
  dealbreakerFailures?: DealbreakerFailure[];
}

/**
 * Route a role→candidate matching query through Neo4j.
 *
 * @returns Ranked list of candidates with unified shape.
 */
export async function routeMatchRead(
  input: MatchRouterInput,
): Promise<UnifiedCandidateMatch[]> {
  const { roleContextId, db, env } = input;
  const t0 = Date.now();

  try {
    const results = await matchViaNeo4j({ roleContextId, db, env });
    const latency = Date.now() - t0;
    console.log(
      JSON.stringify({
        event: 'match_read',
        store: 'neo4j',
        latency_ms: latency,
        candidate_count: results.length,
        role_context_id_hash: hashRoleId(roleContextId),
      }),
    );
    return results;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[matchRouter] Neo4j read failed:', msg);
    throw err;
  }
}

// ─── Neo4j path: Cypher per-element matching + D1 hydration ─────────────────

export async function matchViaNeo4j(
  input: Omit<MatchRouterInput, 'limit'>,
): Promise<UnifiedCandidateMatch[]> {
  const { roleContextId, db, env } = input;

  const config = buildNeo4jConfig(env);
  if (!config) {
    throw new Error('Neo4j config missing (NEO4J_URI or NEO4J_PASSWORD)');
  }
  const driver = createNeo4jDriver(config);

  try {
    // Run Cypher matching (result limit controlled by Role.result_limit in graph)
    const neo4jResults = await matchCandidatesForRole(driver, roleContextId);

    if (neo4jResults.length === 0) return [];

    // Hydrate candidate metadata from D1
    const candidateIds = neo4jResults.map((r) => r.candidate_id);
    const placeholders = candidateIds.map(() => '?').join(', ');
    let hydrateSql = `SELECT c.id, c.name, c.email, c.pipeline_id, p.title AS pipeline_name, ci.status, p.owner_id
         FROM candidates c
         LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
         JOIN pipelines p ON p.id = c.pipeline_id
         WHERE c.id IN (${placeholders})`;
    const hydrateParams: (string | number | boolean)[] = [...candidateIds];
    if (input.ownerId) {
      hydrateSql += ' AND p.owner_id = ?';
      hydrateParams.push(input.ownerId);
    }
    const { results: rows } = await db
      .prepare(hydrateSql)
      .bind(...hydrateParams)
      .all<{
        id: string;
        name: string;
        email: string;
        pipeline_id: string;
        pipeline_name: string;
        status: string | null;
        owner_id: string;
      }>();

    const rowMap = new Map(rows.map((r) => [r.id, r]));

    // Normalize Neo4j scores to [0, 1] using tanh so UI percentages work.
    // The Cypher score = avg(sim) * log(1 + count) can exceed 1.0;
    // tanh preserves ordering and asymptotically approaches 1.0.
    const mapped: UnifiedCandidateMatch[] = neo4jResults.map((r) => {
      const row = rowMap.get(r.candidate_id);
      return {
        candidateId: r.candidate_id,
        score: Math.tanh(r.overall_score),
        name: row?.name,
        email: row?.email,
        pipelineId: row?.pipeline_id,
        pipelineName: row?.pipeline_name,
        status: row?.status ?? undefined,
        requirementMatches: r.requirement_matches,
        dealbreakerFailures: [],
      };
    });

    return mapped;
  } finally {
    await driver.close();
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function hashRoleId(roleId: string): string {
  let h = 0;
  for (let i = 0; i < roleId.length; i++) {
    h = ((h << 5) - h + roleId.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}
