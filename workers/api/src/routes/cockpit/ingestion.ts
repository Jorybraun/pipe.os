/**
 * Ingestion routes — recruiter-facing API for the Ingestion stage UI.
 *
 * GET  /api/v1/pipelines/:pipelineId/ingestion
 *      List all candidates' ingestion status for a pipeline.
 *
 * POST /api/v1/pipelines/:pipelineId/ingestion/:candidateId/feedback
 *      Record recruiter thumbs up/down on a match.
 *
 * POST /api/v1/pipelines/:pipelineId/ingestion/:candidateId/reingest
 *      Reset ingestion to pending and re-run the full pipeline.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { parseResume, extractTextFromPDF } from '../../lib/cvParser';
import { runCandidateIngestion } from '../../lib/candidateDiscovery/orchestrate';
import type { Env, Variables } from '../../types';

const feedbackSchema = z.object({
  thumb: z.enum(['up', 'down']),
  reason: z.string().max(1000).optional(),
  triangulatedScore: z.number().optional(),
  roleRepoAlignment: z.number().optional(),
  candidateRepoFit: z.number().optional(),
  roleCandidateCosine: z.number().optional(),
});

const ingestion = new Hono<{ Bindings: Env; Variables: Variables }>();
ingestion.use('*', authMiddleware);

// ─── GET /:pipelineId/ingestion ─────────────────────────────────────────────

interface IngestionListRow {
  candidate_id: string;
  candidate_name: string;
  status: string;
  candidate_searchable_profile: string | null;
  matched_repo_name: string | null;
  triangulated_score: number | null;
  dimensions_json: string | null;
  reasoning_json: string | null;
  error_text: string | null;
  created_at: string;
  updated_at: string;
}

function snakeToCamelDimensions(dimensions: Record<string, number> | null) {
  if (!dimensions) return null;
  return {
    skillCoverage: dimensions.skill_coverage ?? 0,
    semanticSimilarity: dimensions.semantic_similarity ?? 0,
    situationFit: dimensions.situation_fit ?? 0,
    roleAlignment: dimensions.role_alignment ?? 0,
  };
}

ingestion.get('/:pipelineId/ingestion', async (c) => {
  const userId = c.var.userId;
  const { pipelineId } = c.req.param();
  const db = c.env.DB;

  // Ownership check
  const pipeline = await db
    .prepare('SELECT id FROM pipelines WHERE id = ? AND owner_id = ?')
    .bind(pipelineId, userId)
    .first<{ id: string }>();

  if (!pipeline) {
    return apiError(c, 'NOT_FOUND', 'Pipeline not found.');
  }

  const rows = await db
    .prepare(
      `SELECT
         c.id AS candidate_id,
         c.name AS candidate_name,
         ci.status,
         ci.candidate_searchable_profile,
         qr.full_name AS matched_repo_name,
         ci.triangulated_score,
         ci.dimensions_json,
         ci.reasoning_json,
         ci.error_text,
         ci.created_at,
         ci.updated_at
       FROM candidates c
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
       LEFT JOIN qualified_repos qr ON qr.id = ci.matched_repo_id
       WHERE c.pipeline_id = ?
       ORDER BY ci.updated_at DESC NULLS LAST, c.name ASC`,
    )
    .bind(pipelineId)
    .all<IngestionListRow>();

  const results = (rows.results ?? []).map((r) => {
    const dimensions = r.dimensions_json
      ? (JSON.parse(r.dimensions_json) as Record<string, number>)
      : null;
    const reasoning = r.reasoning_json
      ? (JSON.parse(r.reasoning_json) as { matches: string[]; mismatches: string[] })
      : null;

    return {
      candidateId: r.candidate_id,
      candidateName: r.candidate_name,
      status: (r.status ?? 'pending') as 'pending' | 'profile_generated' | 'embedded' | 'matched' | 'failed',
      candidateSearchableProfile: r.candidate_searchable_profile ?? '',
      matchedRepoName: r.matched_repo_name,
      triangulatedScore: r.triangulated_score,
      dimensions: snakeToCamelDimensions(dimensions),
      reasoning,
      errorText: r.error_text,
    };
  });

  return c.json({ results });
});

// ─── POST /:pipelineId/ingestion/:candidateId/feedback ──────────────────────

ingestion.post('/:pipelineId/ingestion/:candidateId/feedback', async (c) => {
  const userId = c.var.userId;
  const { pipelineId, candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check via candidate→pipeline join
  const candidate = await db
    .prepare(
      `SELECT c.id, c.pipeline_id, ci.matched_repo_id
       FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       LEFT JOIN candidate_ingestion ci ON ci.candidate_id = c.id
       WHERE c.id = ? AND p.owner_id = ?`,
    )
    .bind(candidateId, userId)
    .first<{ id: string; pipeline_id: string; matched_repo_id: number | null }>();

  if (!candidate) {
    return apiError(c, 'NOT_FOUND', 'Candidate not found.');
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'BAD_REQUEST', 'Invalid JSON body.');
  }

  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'BAD_REQUEST', parsed.error.message);
  }

  const { thumb, reason, triangulatedScore, roleRepoAlignment, candidateRepoFit, roleCandidateCosine } =
    parsed.data;

  // Find the candidate's current stage for the feedback record
  const stageRow = await db
    .prepare(
      `SELECT s.id AS stage_id
       FROM stages s
       WHERE s.pipeline_id = ? AND s.stage_type = 'INGESTION'
       LIMIT 1`,
    )
    .bind(candidate.pipeline_id)
    .first<{ stage_id: string }>();

  const stageId = stageRow?.stage_id ?? 'unknown';

  const id = cryptoRandomId();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO match_feedback (
         id, candidate_id, repo_id, pipeline_id, stage_id,
         thumb, reason, triangulated_score, role_repo_alignment,
         candidate_repo_fit, role_candidate_cosine, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      candidateId,
      candidate.matched_repo_id,
      candidate.pipeline_id,
      stageId,
      thumb,
      reason ?? null,
      triangulatedScore ?? null,
      roleRepoAlignment ?? null,
      candidateRepoFit ?? null,
      roleCandidateCosine ?? null,
      now,
    )
    .run();

  return c.json({ success: true, feedbackId: id });
});

// ─── GET /:pipelineId/ingestion/:candidateId/feedback ───────────────────────

ingestion.get('/:pipelineId/ingestion/:candidateId/feedback', async (c) => {
  const userId = c.var.userId;
  const { pipelineId, candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check
  const candidate = await db
    .prepare(
      `SELECT c.id
       FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ? AND c.pipeline_id = ?`,
    )
    .bind(candidateId, userId, pipelineId)
    .first<{ id: string }>();

  if (!candidate) {
    return apiError(c, 'NOT_FOUND', 'Candidate not found.');
  }

  const rows = await db
    .prepare(
      `SELECT thumb, reason, triangulated_score, role_repo_alignment,
              candidate_repo_fit, role_candidate_cosine, created_at
       FROM match_feedback
       WHERE candidate_id = ? AND pipeline_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(candidateId, pipelineId)
    .all<{
      thumb: string;
      reason: string | null;
      triangulated_score: number | null;
      role_repo_alignment: number | null;
      candidate_repo_fit: number | null;
      role_candidate_cosine: number | null;
      created_at: string;
    }>();

  const feedback = (rows.results ?? []).map((r) => ({
    thumb: r.thumb,
    reason: r.reason,
    triangulatedScore: r.triangulated_score,
    roleRepoAlignment: r.role_repo_alignment,
    candidateRepoFit: r.candidate_repo_fit,
    roleCandidateCosine: r.role_candidate_cosine,
    createdAt: r.created_at,
  }));

  return c.json({ feedback });
});

// ─── POST /:pipelineId/ingestion/:candidateId/reingest ──────────────────────

ingestion.post('/:pipelineId/ingestion/:candidateId/reingest', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check + fetch resume key
  const candidate = await db
    .prepare(
      `SELECT c.id, c.name, c.pipeline_id, c.resume_s3_key
       FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`,
    )
    .bind(candidateId, userId)
    .first<{ id: string; name: string; pipeline_id: string; resume_s3_key: string | null }>();

  if (!candidate) {
    return apiError(c, 'NOT_FOUND', 'Candidate not found.');
  }

  if (!candidate.resume_s3_key) {
    return apiError(c, 'BAD_REQUEST', 'Candidate has no resume on file.');
  }

  // Fetch resume from R2
  const object = await c.env.STORAGE.get(candidate.resume_s3_key);
  if (!object) {
    return apiError(c, 'NOT_FOUND', 'Resume file not found in storage.');
  }

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const buffer = await object.arrayBuffer();

  // Extract text + parse
  let resumeText = '';
  let parsed: Record<string, unknown> = { skills: [] };

  if (contentType === 'application/pdf') {
    try {
      resumeText = await extractTextFromPDF(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return apiError(c, 'UNPROCESSABLE_ENTITY', `PDF text extraction failed: ${msg}`);
    }
  } else {
    // For non-PDF, try decoding as UTF-8 text (best effort)
    try {
      resumeText = new TextDecoder().decode(buffer);
    } catch {
      return apiError(c, 'UNPROCESSABLE_ENTITY', 'Unsupported resume format.');
    }
  }

  if (resumeText.trim().length < 20) {
    return apiError(c, 'UNPROCESSABLE_ENTITY', 'Resume contains insufficient text.');
  }

  try {
    const parsedCV = await parseResume({
      env: c.env,
      contentType,
      fileBuffer: buffer,
    });
    if (parsedCV) {
      parsed = parsedCV as unknown as Record<string, unknown>;
    }
  } catch (err) {
    console.error('[ingestion/reingest] parseResume failed:', err);
    // Continue with empty parsed CV — the discovery agent can work from raw text
  }

  // Reset ingestion status
  await db
    .prepare(
      `INSERT INTO candidate_ingestion (candidate_id, status, created_at, updated_at)
       VALUES (?1, 'pending', ?2, ?2)
       ON CONFLICT(candidate_id) DO UPDATE SET
         status = 'pending',
         error_text = NULL,
         profile_generated_at = NULL,
         profile_embedded_at = NULL,
         matched_at = NULL,
         matched_repo_id = NULL,
         triangulated_score = NULL,
         dimensions_json = NULL,
         reasoning_json = NULL,
         match_philosophy = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(candidateId, new Date().toISOString())
    .run();

  // Fire-and-forget re-ingestion
  runCandidateIngestion({
    env: c.env,
    db,
    candidateId,
    parsed: parsed as { skills: string[] },
    resumeText,
  }).catch((err) => {
    console.error('[ingestion/reingest] background ingestion error:', err);
  });

  return c.json({ success: true, message: 'Re-ingestion started.' });
});

// ─── Utility ────────────────────────────────────────────────────────────────

function cryptoRandomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { ingestion };
