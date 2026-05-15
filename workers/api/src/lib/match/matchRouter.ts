/**
 * matchRouter.ts — Routing layer for role→candidate matching.
 *
 * Decides which store to query based on PRIMARY_MATCH_STORE env var:
 *   'd1'  (default) → Vectorize ANN + D1 hydration
 *   'neo4j'         → Cypher per-element matching + D1 hydration for metadata
 *
 * Fallback: when PRIMARY_MATCH_STORE=neo4j and Neo4j errors, automatically
 * falls back to D1 with structured logging.
 *
 * Feature flags:
 *   PRIMARY_MATCH_STORE = 'd1' | 'neo4j'
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
import { matchCandidatesVectorNative } from './matchVectorNative';
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
  /** D1-only: previous triangulated score from ingestion */
  triangulatedScore?: number | null;
  /** D1-only: searchable profile text */
  searchableProfile?: string | null;
}

/**
 * Route a role→candidate matching query to the appropriate store.
 *
 * @returns Ranked list of candidates with unified shape.
 */
export async function routeMatchRead(
  input: MatchRouterInput,
): Promise<UnifiedCandidateMatch[]> {
  const { roleContextId, db, env, limit = 20, ownerId } = input;
  const primaryStore = env.PRIMARY_MATCH_STORE ?? 'd1';
  const t0 = Date.now();

  if (primaryStore === 'neo4j') {
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
      console.error('[matchRouter] Neo4j read failed, falling back to D1:', msg);
      const fallbackResults = await matchViaD1({ roleContextId, db, env, limit, ownerId });
      const latency = Date.now() - t0;
      console.log(
        JSON.stringify({
          event: 'match_read',
          store: 'd1',
          latency_ms: latency,
          candidate_count: fallbackResults.length,
          role_context_id_hash: hashRoleId(roleContextId),
          fallback_reason: msg,
        }),
      );
      return fallbackResults;
    }
  }

  // Default D1 path
  const results = await matchViaD1({ roleContextId, db, env, limit, ownerId });
  const latency = Date.now() - t0;
  console.log(
    JSON.stringify({
      event: 'match_read',
      store: 'd1',
      latency_ms: latency,
      candidate_count: results.length,
      role_context_id_hash: hashRoleId(roleContextId),
    }),
  );
  return results;
}

// ─── D1 path: Vectorize ANN + hydration ─────────────────────────────────────

export async function matchViaD1(
  input: Omit<MatchRouterInput, 'philosophy'>,
): Promise<UnifiedCandidateMatch[]> {
  const { roleContextId, db, env, limit, ownerId } = input;

  // Resolve role embedding from D1
  const row = await db
    .prepare('SELECT embedding_json FROM role_contexts WHERE id = ?1')
    .bind(roleContextId)
    .first<{ embedding_json: string | null }>();
  const vector = parseEmbeddingJson(row?.embedding_json);
  if (!vector) {
    throw new Error(`No embedding found for role ${roleContextId}`);
  }

  const matches = await matchCandidatesVectorNative({
    db,
    targetIndex: env.CANDIDATE_INDEX,
    queryVector: vector,
    topK: limit,
    ownerId,
  });

  return matches.map((m) => ({
    candidateId: m.id,
    score: m.score,
    name: m.name,
    email: m.email,
    pipelineId: m.pipelineId,
    pipelineName: m.pipelineName,
    status: m.status,
    triangulatedScore: m.triangulatedScore,
    searchableProfile: m.searchableProfile,
  }));
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
