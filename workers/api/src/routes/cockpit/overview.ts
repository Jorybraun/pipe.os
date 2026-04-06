/**
 * Overview route — GET /api/v1/pipelines/:pipelineId/overview
 *
 * Returns the full pipeline overview in a single response:
 * pipeline metadata, stages with challenge counts, candidates, interviews.
 * Replaces ~20 individual Amplify calls with one Worker round-trip.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import type { Env, Variables } from '../../types';

const overview = new Hono<{ Bindings: Env; Variables: Variables }>();

overview.use('*', authMiddleware);

// GET /:pipelineId/overview
overview.get('/:pipelineId/overview', async (c) => {
  const userId = c.var.userId;
  const { pipelineId } = c.req.param();
  const db = c.env.DB;

  // 1. Pipeline with ownership check
  const pipeline = await db
    .prepare(
      `SELECT id, title, level, status, creation_mode, created_at, updated_at
       FROM pipelines WHERE id = ? AND owner_id = ?`
    )
    .bind(pipelineId, userId)
    .first();

  if (!pipeline) {
    return apiError(c, 'NOT_FOUND', 'Pipeline not found.');
  }

  // 2. Stages with challenge counts
  const stagesResult = await db
    .prepare(
      `SELECT s.id, s.title, s.pipeline_id, s.sort_order, s.description,
              s.time_limit, s.mode, s.stage_type, s.is_scheduled,
              s.created_at, s.updated_at,
              (SELECT COUNT(*) FROM challenges ch WHERE ch.stage_id = s.id) AS challenge_count
       FROM stages s
       WHERE s.pipeline_id = ?
       ORDER BY s.sort_order ASC`
    )
    .bind(pipelineId)
    .all();

  // 3. Candidates
  const candidatesResult = await db
    .prepare(
      `SELECT c.id, c.name, c.email, c.invite_token, c.status,
              c.current_stage_id, c.created_at,
              (SELECT AVG(a.score) FROM assessments a
               WHERE a.candidate_id = c.id AND a.score IS NOT NULL) AS avg_score
       FROM candidates c
       WHERE c.pipeline_id = ? AND c.status != 'ARCHIVED'
       ORDER BY c.created_at ASC`
    )
    .bind(pipelineId)
    .all();

  // 4. Interviews
  const interviewsResult = await db
    .prepare(
      `SELECT * FROM scheduled_interviews
       WHERE pipeline_id = ? AND status IN ('SCHEDULED', 'INVITED')
       ORDER BY scheduled_at ASC`
    )
    .bind(pipelineId)
    .all();

  // 5. Role context (if this pipeline was created via AI discovery)
  const roleContextRow = await db
    .prepare(
      `SELECT id, baseline, knowledge_state, exchanges, question_budget,
              questions_asked, status, created_at
       FROM role_contexts
       WHERE pipeline_id = ? AND status = 'COMPLETE'
       LIMIT 1`
    )
    .bind(pipelineId)
    .first();

  return c.json({
    pipeline: {
      id: pipeline.id as string,
      title: pipeline.title as string,
      level: pipeline.level as string | null,
      status: pipeline.status as string,
      creationMode: pipeline.creation_mode as string | null,
      stageCount: stagesResult.results.length,
      candidateCount: candidatesResult.results.length,
      createdAt: pipeline.created_at as string,
      updatedAt: pipeline.updated_at as string,
    },
    stages: stagesResult.results.map((s) => ({
      id: s.id as string,
      title: s.title as string,
      pipelineId: s.pipeline_id as string,
      sortOrder: s.sort_order as number,
      description: s.description as string | null,
      timeLimit: s.time_limit as number | null,
      mode: s.mode as string | null,
      challengeCount: s.challenge_count as number,
      stageType: (s.stage_type as string | null) ?? null,
      isScheduled: !!(s.is_scheduled as number),
      createdAt: s.created_at as string,
      updatedAt: s.updated_at as string,
    })),
    candidates: candidatesResult.results.map((cd) => ({
      id: cd.id as string,
      name: cd.name as string | null,
      email: cd.email as string | null,
      inviteToken: cd.invite_token as string,
      status: cd.status as string,
      currentStageId: cd.current_stage_id as string | null,
      score: cd.avg_score != null ? Math.round(cd.avg_score as number) : null,
      createdAt: cd.created_at as string,
    })),
    interviews: interviewsResult.results.map((iv) => ({
      id: iv.id as string,
      candidateId: iv.candidate_id as string,
      stageId: iv.stage_id as string,
      status: iv.status as string,
      scheduledAt: iv.scheduled_at as string | null,
      meetingUrl: iv.meeting_url as string | null,
    })),
    roleContext: roleContextRow
      ? {
          id: roleContextRow.id as string,
          baseline: JSON.parse((roleContextRow.baseline as string) || '{}'),
          knowledgeState: JSON.parse((roleContextRow.knowledge_state as string) || '{}'),
          questionsAsked: roleContextRow.questions_asked as number,
          questionBudget: roleContextRow.question_budget as number,
          createdAt: roleContextRow.created_at as string,
        }
      : null,
  });
});

export { overview };
