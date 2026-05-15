/**
 * Vector-Native Matching Engine — unified ANN retrieval for the shared
 * candidate/repo/role embedding space.
 *
 * All three entity types embed into the same BGE-large-en-v1.5 1024-dim space.
 * This module provides fast (<100ms) approximate nearest-neighbor retrieval
 * with metadata filtering, plus D1 hydration for the result payload.
 *
 * Architecture:
 *   Stage 1: ANN query against the target Vectorize index with metadata filters
 *   Stage 2: Hydrate match IDs from D1 (repo/candidate/role rows)
 *   Stage 3: (caller responsibility) LLM rerank on the shortlist
 *
 * This replaces SQL graph matching as the primary retrieval mechanism.
 * SQL graph matching becomes a fallback guardrail when ANN returns empty.
 */

import { preprocessForEmbedding } from '../embedding/preprocess';

// ─── Types ──────────────────────────────────────────────────────────────────

export type EntityType = 'candidate' | 'repo' | 'role';
export type TargetIndex = 'REPO_INDEX' | 'CANDIDATE_INDEX' | 'ROLE_INDEX';

export interface VectorMatchInput {
  /** The source entity's embedding vector. Either provide this OR queryText. */
  queryVector?: number[];
  /** Raw text to embed and query with. Either provide this OR queryVector. */
  queryText?: string;
  /** The Vectorize index to query. */
  targetIndex: VectorizeIndex;
  /** Optional metadata filters (Vectorize index-side filtering). */
  metadataFilters?: Record<string, string | number | boolean>;
  /** How many neighbors to retrieve. */
  topK?: number;
  /** AI binding — required if queryText is provided (needs live embed). */
  ai?: Ai;
}

export interface VectorMatchResult {
  /** Matched entity ID (without prefix — repo_id, candidate_id, role_context_id). */
  id: string;
  /** ANN similarity score [0, 1]. Higher = closer. */
  score: number;
  /** Metadata attached to the vector at index time. */
  metadata: Record<string, unknown>;
}

export interface HydratedRepoMatch extends VectorMatchResult {
  /** Hydrated fields from qualified_repos + repo_engineering_signals */
  fullName: string;
  githubUrl: string;
  description: string | null;
  primaryLanguage: string;
  seniorityBand: string | null;
  detectedDomain: string | null;
  stars: number;
  repoSearchableProfile: string | null;
}

export interface HydratedCandidateMatch extends VectorMatchResult {
  /** Hydrated fields from candidates + candidate_ingestion */
  name: string;
  email: string;
  pipelineId: string;
  pipelineName: string;
  status: string;
  searchableProfile: string | null;
  triangulatedScore: number | null;
}

export interface HydratedRoleMatch extends VectorMatchResult {
  /** Hydrated fields from role_contexts */
  roleTitle: string | null;
  roleSearchableProfile: string | null;
  seniorityBand: string | null;
  detectedDomain: string | null;
  pipelineId: string;
}

const BGE_MODEL = '@cf/baai/bge-large-en-v1.5';
const EXPECTED_DIM = 1024;

// ─── Core ANN query ─────────────────────────────────────────────────────────

async function resolveQueryVector(input: VectorMatchInput): Promise<number[]> {
  if (input.queryVector) {
    if (input.queryVector.length !== EXPECTED_DIM) {
      throw new Error(
        `[matchVectorNative] queryVector dim mismatch: got ${input.queryVector.length}, expected ${EXPECTED_DIM}`,
      );
    }
    return input.queryVector;
  }

  if (!input.queryText) {
    throw new Error('[matchVectorNative] provide either queryVector or queryText');
  }
  if (!input.ai) {
    throw new Error('[matchVectorNative] ai binding required when using queryText');
  }

  const normalized = preprocessForEmbedding(input.queryText, 'query');
  const embedResult = (await input.ai.run(BGE_MODEL, {
    text: [normalized],
  })) as { data?: number[][] };

  const vector = embedResult?.data?.[0];
  if (!vector || !Array.isArray(vector) || vector.length !== EXPECTED_DIM) {
    throw new Error('[matchVectorNative] failed to embed queryText');
  }
  return vector;
}

/**
 * Run ANN query against the target index. Returns raw matches with IDs and scores.
 * This is the fast path — no D1 hydration.
 */
export async function queryVectorIndex(
  input: VectorMatchInput,
): Promise<VectorMatchResult[]> {
  const vector = await resolveQueryVector(input);
  const topK = input.topK ?? 20;

  const queryOpts: VectorizeQueryOptions = {
    topK,
    ...(input.metadataFilters ? { filter: input.metadataFilters } : {}),
  };

  const result = await input.targetIndex.query(vector, queryOpts);

  const matches: VectorMatchResult[] = [];
  for (const m of result?.matches ?? []) {
    const id = stripPrefix(m.id);
    if (!id) continue;
    matches.push({
      id,
      score: m.score,
      metadata: (m.metadata ?? {}) as Record<string, unknown>,
    });
  }

  return matches;
}

// ─── Hydrated queries ───────────────────────────────────────────────────────

/**
 * Query repos from a source vector/text. Hydrates from qualified_repos.
 */
export async function matchReposVectorNative(
  input: VectorMatchInput & { db: D1Database },
): Promise<HydratedRepoMatch[]> {
  const { db, ...queryInput } = input;
  const matches = await queryVectorIndex(queryInput);
  if (matches.length === 0) return [];

  const repoIds = matches.map((m) => Number(m.id));
  const placeholders = repoIds.map(() => '?').join(', ');

  const { results } = await db
    .prepare(
      `SELECT
         r.id, r.full_name, r.github_url, r.description, r.primary_language,
         r.seniority_band, r.detected_domain, r.stars,
         es.repo_searchable_profile
       FROM qualified_repos r
       LEFT JOIN repo_engineering_signals es ON es.repo_id = r.id
       WHERE r.id IN (${placeholders})
         AND r.disqualified = 0`,
    )
    .bind(...repoIds)
    .all<{
      id: number;
      full_name: string;
      github_url: string;
      description: string | null;
      primary_language: string;
      seniority_band: string | null;
      detected_domain: string | null;
      stars: number;
      repo_searchable_profile: string | null;
    }>();

  const rowMap = new Map(results.map((r) => [r.id, r]));

  return matches
    .map((m) => {
      const row = rowMap.get(Number(m.id));
      if (!row) return null;
      return {
        ...m,
        fullName: row.full_name,
        githubUrl: row.github_url,
        description: row.description,
        primaryLanguage: row.primary_language,
        seniorityBand: row.seniority_band,
        detectedDomain: row.detected_domain,
        stars: row.stars,
        repoSearchableProfile: row.repo_searchable_profile,
      };
    })
    .filter((m): m is HydratedRepoMatch => m !== null);
}

/**
 * Query candidates from a source vector/text. Hydrates from candidates + ingestion.
 */
export async function matchCandidatesVectorNative(
  input: VectorMatchInput & { db: D1Database; ownerId?: string },
): Promise<HydratedCandidateMatch[]> {
  const { db, ownerId, ...queryInput } = input;
  const matches = await queryVectorIndex(queryInput);
  if (matches.length === 0) return [];

  const candidateIds = matches.map((m) => m.id);
  const placeholders = candidateIds.map(() => '?').join(', ');

  let sql = `SELECT
       c.id, c.name, c.email, c.pipeline_id,
       ci.status, ci.candidate_searchable_profile, ci.triangulated_score,
       p.title AS pipeline_name
     FROM candidates c
     LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
     JOIN pipelines p ON p.id = c.pipeline_id
     WHERE c.id IN (${placeholders})`;
  const params: (string | number | boolean)[] = [...candidateIds];

  if (ownerId) {
    sql += ' AND p.owner_id = ?';
    params.push(ownerId);
  }

  const { results } = await db.prepare(sql).bind(...params).all<{
    id: string;
    name: string;
    email: string;
    pipeline_id: string;
    status: string | null;
    candidate_searchable_profile: string | null;
    triangulated_score: number | null;
    pipeline_name: string;
  }>();

  const rowMap = new Map(results.map((r) => [r.id, r]));

  return matches
    .map((m) => {
      const row = rowMap.get(m.id);
      if (!row) return null;
      return {
        ...m,
        name: row.name,
        email: row.email,
        pipelineId: row.pipeline_id,
        pipelineName: row.pipeline_name,
        status: row.status ?? 'pending',
        searchableProfile: row.candidate_searchable_profile,
        triangulatedScore: row.triangulated_score,
      };
    })
    .filter((m): m is HydratedCandidateMatch => m !== null);
}

/**
 * Query roles from a source vector/text. Hydrates from role_contexts.
 */
export async function matchRolesVectorNative(
  input: VectorMatchInput & { db: D1Database },
): Promise<HydratedRoleMatch[]> {
  const { db, ...queryInput } = input;
  const matches = await queryVectorIndex(queryInput);
  if (matches.length === 0) return [];

  const roleIds = matches.map((m) => m.id);
  const placeholders = roleIds.map(() => '?').join(', ');

  const { results } = await db
    .prepare(
      `SELECT
         rc.id, rc.role_title, rc.role_searchable_profile,
         rc.seniority_band, rc.detected_domain, rc.pipeline_id
       FROM role_contexts rc
       WHERE rc.id IN (${placeholders})`,
    )
    .bind(...roleIds)
    .all<{
      id: string;
      role_title: string | null;
      role_searchable_profile: string | null;
      seniority_band: string | null;
      detected_domain: string | null;
      pipeline_id: string;
    }>();

  const rowMap = new Map(results.map((r) => [r.id, r]));

  return matches
    .map((m) => {
      const row = rowMap.get(m.id);
      if (!row) return null;
      return {
        ...m,
        roleTitle: row.role_title,
        roleSearchableProfile: row.role_searchable_profile,
        seniorityBand: row.seniority_band,
        detectedDomain: row.detected_domain,
        pipelineId: row.pipeline_id,
      };
    })
    .filter((m): m is HydratedRoleMatch => m !== null);
}

// ─── Utility ────────────────────────────────────────────────────────────────

function stripPrefix(prefixedId: string): string | null {
  const patterns = [
    /^candidate_(.+)$/, // candidate_{uuid}
    /^repo_(\d+)$/, // repo_{id}
    /^role_(.+)$/, // role_{uuid}
  ];
  for (const pat of patterns) {
    const m = prefixedId.match(pat);
    if (m?.[1]) return m[1];
  }
  // If no prefix matched, return as-is (fallback)
  return prefixedId;
}
