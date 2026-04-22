/**
 * Unified semantic search — dual-layer embedding (D1 ground truth + Vectorize ANN).
 *
 * POST /api/v1/search/candidates  — search candidates by role, repo, or free text
 * POST /api/v1/search/repos       — search repos by role, candidate, or free text
 *
 * Query vector resolution (first match wins):
 *   1. roleContextId → role_contexts.embedding_json
 *   2. candidateId   → candidate_ingestion.embedding_json
 *   3. repoId        → repo_engineering_signals.embedding_json
 *   4. query         → live BGE embed
 *
 * Returns top-K Vectorize matches hydrated from D1.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import { parseEmbeddingJson } from '../lib/embedding/cosine';
import type { Env, Variables } from '../types';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();
search.use('*', authMiddleware);

const candidateSearchSchema = z.object({
  roleContextId: z.string().optional(),
  repoId: z.number().int().positive().optional(),
  candidateId: z.string().optional(),
  query: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).default(20),
});

const repoSearchSchema = z.object({
  roleContextId: z.string().optional(),
  candidateId: z.string().optional(),
  repoId: z.number().int().positive().optional(),
  query: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).default(20),
});

const BGE_MODEL = '@cf/baai/bge-large-en-v1.5';
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

interface VectorSource {
  vector: number[];
  sourceType: 'role' | 'candidate' | 'repo' | 'query';
  sourceId: string;
}

async function resolveQueryVector(
  db: D1Database,
  ai: Ai,
  input: {
    roleContextId?: string | undefined;
    candidateId?: string | undefined;
    repoId?: number | undefined;
    query?: string | undefined;
  },
): Promise<VectorSource | null> {
  const { roleContextId, candidateId, repoId, query } = input;

  if (roleContextId) {
    const row = await db
      .prepare('SELECT embedding_json FROM role_contexts WHERE id = ?1')
      .bind(roleContextId)
      .first<{ embedding_json: string | null }>();
    const vec = parseEmbeddingJson(row?.embedding_json);
    if (vec) return { vector: vec, sourceType: 'role', sourceId: roleContextId };
  }

  if (candidateId) {
    const row = await db
      .prepare('SELECT embedding_json FROM candidate_ingestion WHERE candidate_id = ?1')
      .bind(candidateId)
      .first<{ embedding_json: string | null }>();
    const vec = parseEmbeddingJson(row?.embedding_json);
    if (vec) return { vector: vec, sourceType: 'candidate', sourceId: candidateId };
  }

  if (repoId) {
    const row = await db
      .prepare('SELECT embedding_json FROM repo_engineering_signals WHERE repo_id = ?1')
      .bind(repoId)
      .first<{ embedding_json: string | null }>();
    const vec = parseEmbeddingJson(row?.embedding_json);
    if (vec) return { vector: vec, sourceType: 'repo', sourceId: String(repoId) };
  }

  if (query) {
    try {
      const embedResult = (await ai.run(BGE_MODEL, {
        text: [BGE_QUERY_PREFIX + query],
      })) as { data?: number[][] };
      const vector = embedResult?.data?.[0];
      if (vector && Array.isArray(vector) && vector.length === 1024) {
        return { vector, sourceType: 'query', sourceId: query.slice(0, 80) };
      }
    } catch (err) {
      console.error('[search] query embed failed:', err);
    }
  }

  return null;
}

// ─── POST /api/v1/search/candidates ──────────────────────────────────────────

search.post('/candidates', async (c) => {
  const userId = c.var.userId;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'invalid JSON body');
  }

  const parsed = candidateSearchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'invalid body');
  }

  const { roleContextId, repoId, candidateId, query, limit } = parsed.data;
  if (!roleContextId && !repoId && !candidateId && !query) {
    return apiError(c, 'VALIDATION_ERROR', 'provide at least one of roleContextId, repoId, candidateId, or query');
  }

  const source = await resolveQueryVector(c.env.DB, c.env.AI, {
    roleContextId,
    repoId,
    candidateId,
    query,
  });
  if (!source) {
    return apiError(c, 'NOT_FOUND', 'no embedding found for the provided source, and query embed failed');
  }

  let matches: Array<{ id: string; score: number }> = [];
  try {
    const result = await c.env.CANDIDATE_INDEX.query(source.vector, { topK: limit });
    for (const m of result?.matches ?? []) {
      const idMatch = m.id.match(/^candidate_(.+)$/);
      if (idMatch?.[1]) {
        matches.push({ id: idMatch[1], score: m.score });
      }
    }
  } catch (err) {
    console.error('[search/candidates] vectorize query failed:', err);
    return apiError(c, 'INTERNAL_ERROR', 'vector search failed');
  }

  if (matches.length === 0) {
    return c.json({ candidates: [], source: { type: source.sourceType, id: source.sourceId } });
  }

  const placeholders = matches.map(() => '?').join(', ');
  const { results } = await c.env.DB.prepare(
    `SELECT
       c.id, c.name, c.email, c.pipeline_id,
       ci.status, ci.candidate_searchable_profile, ci.triangulated_score,
       p.name AS pipeline_name
     FROM candidates c
     LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
     JOIN pipelines p ON p.id = c.pipeline_id
     WHERE c.id IN (${placeholders})
       AND p.owner_id = ?`
  ).bind(...matches.map((m) => m.id), userId).all<{
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

  const candidates = matches
    .map((m) => {
      const row = rowMap.get(m.id);
      if (!row) return null;
      return {
        candidateId: row.id,
        name: row.name,
        email: row.email,
        pipelineId: row.pipeline_id,
        pipelineName: row.pipeline_name,
        status: row.status ?? 'pending',
        searchableProfile: row.candidate_searchable_profile ?? '',
        triangulatedScore: row.triangulated_score,
        score: m.score,
      };
    })
    .filter(Boolean);

  return c.json({
    candidates,
    source: { type: source.sourceType, id: source.sourceId },
  });
});

// ─── POST /api/v1/search/repos ───────────────────────────────────────────────

search.post('/repos', async (c) => {
  const userId = c.var.userId;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'invalid JSON body');
  }

  const parsed = repoSearchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'invalid body');
  }

  const { roleContextId, candidateId, repoId, query, limit } = parsed.data;
  if (!roleContextId && !candidateId && !repoId && !query) {
    return apiError(c, 'VALIDATION_ERROR', 'provide at least one of roleContextId, candidateId, repoId, or query');
  }

  const source = await resolveQueryVector(c.env.DB, c.env.AI, {
    roleContextId,
    candidateId,
    repoId,
    query,
  });
  if (!source) {
    return apiError(c, 'NOT_FOUND', 'no embedding found for the provided source, and query embed failed');
  }

  let matches: Array<{ id: number; score: number }> = [];
  try {
    const result = await c.env.REPO_INDEX.query(source.vector, {
      topK: limit,
      filter: { disqualified: 0 },
    });
    for (const m of result?.matches ?? []) {
      const idMatch = m.id.match(/^repo_(\d+)$/);
      if (idMatch?.[1]) {
        matches.push({ id: Number(idMatch[1]), score: m.score });
      }
    }
  } catch (err) {
    console.error('[search/repos] vectorize query failed:', err);
    return apiError(c, 'INTERNAL_ERROR', 'vector search failed');
  }

  if (matches.length === 0) {
    return c.json({ repos: [], source: { type: source.sourceType, id: source.sourceId } });
  }

  const placeholders = matches.map(() => '?').join(', ');
  const { results } = await c.env.DB.prepare(
    `SELECT
       r.id, r.full_name, r.github_url, r.description, r.primary_language,
       r.stars, r.seniority_band, r.detected_domain,
       es.challenge_suitability_verdict, es.repo_searchable_profile
     FROM qualified_repos r
     LEFT JOIN repo_engineering_signals es ON es.repo_id = r.id
     WHERE r.id IN (${placeholders})
       AND r.disqualified = 0`
  ).bind(...matches.map((m) => m.id)).all<{
    id: number;
    full_name: string;
    github_url: string;
    description: string | null;
    primary_language: string;
    stars: number;
    seniority_band: string | null;
    detected_domain: string | null;
    challenge_suitability_verdict: string | null;
    repo_searchable_profile: string | null;
  }>();

  const rowMap = new Map(results.map((r) => [r.id, r]));

  const repos = matches
    .map((m) => {
      const row = rowMap.get(m.id);
      if (!row) return null;
      return {
        repoId: row.id,
        fullName: row.full_name,
        githubUrl: row.github_url,
        description: row.description,
        primaryLanguage: row.primary_language,
        stars: row.stars,
        seniorityBand: row.seniority_band,
        detectedDomain: row.detected_domain,
        challengeSuitability: row.challenge_suitability_verdict,
        searchableProfile: row.repo_searchable_profile ?? '',
        score: m.score,
      };
    })
    .filter(Boolean);

  return c.json({
    repos,
    source: { type: source.sourceType, id: source.sourceId },
  });
});

export { search };
