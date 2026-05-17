/**
 * Unified semantic search — dual-layer embedding (D1 ground truth + Vectorize ANN).
 *
 * POST /api/v1/search/candidates  — search candidates by role, repo, or free text
 * POST /api/v1/search/repos       — search repos by role, candidate, or free text
 * POST /api/v1/search/roles       — search roles by candidate, repo, or free text
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
import { preprocessForEmbedding } from '../lib/embedding/preprocess';
import { routeMatchRead } from '../lib/match/matchRouter';

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

const roleSearchSchema = z.object({
  candidateId: z.string().optional(),
  repoId: z.number().int().positive().optional(),
  roleContextId: z.string().optional(),
  query: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).default(20),
});

const BGE_MODEL = '@cf/baai/bge-large-en-v1.5';

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
      const normalized = preprocessForEmbedding(query, 'query');
      const embedResult = (await ai.run(BGE_MODEL, {
        text: [normalized],
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

  const matchResults = await routeMatchRead({
    roleContextId,
    db: c.env.DB,
    env: c.env,
    limit,
    ownerId: userId,
  });

  const candidates = matchResults.map((m) => ({
    candidateId: m.candidateId,
    name: m.name ?? '',
    email: m.email ?? '',
    pipelineId: m.pipelineId ?? '',
    pipelineName: m.pipelineName ?? '',
    status: m.status ?? 'pending',
    searchableProfile: '',
    score: m.score,
    requirementMatches: m.requirementMatches,
    dealbreakerFailures: m.dealbreakerFailures,
  }));

  return c.json({
    candidates,
    source: { type: 'role', id: roleContextId },
    store: 'neo4j',
  });
});

// ─── POST /api/v1/search/repos ───────────────────────────────────────────────

search.post('/repos', async (c) => {
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

  // TODO: Replace Vectorize ANN with Neo4j Cypher repo matching
  return c.json({ repos: [], source: { type: 'query', id: query ?? '' } });
});

// ─── POST /api/v1/search/roles ───────────────────────────────────────────────

search.post('/roles', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'invalid JSON body');
  }

  const parsed = roleSearchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'invalid body');
  }

  const { candidateId, repoId, roleContextId, query, limit } = parsed.data;
  if (!candidateId && !repoId && !roleContextId && !query) {
    return apiError(c, 'VALIDATION_ERROR', 'provide at least one of candidateId, repoId, roleContextId, or query');
  }

  // TODO: Replace Vectorize ANN with Neo4j Cypher role matching
  return c.json({ roles: [], source: { type: 'query', id: query ?? '' } });
});

export { search };
