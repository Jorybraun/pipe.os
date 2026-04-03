/**
 * Email routes — recruiter-triggered notifications.
 *
 * POST /api/v1/candidates/:candidateId/send-invite  — resend invitation email
 * POST /api/v1/candidates/:candidateId/send-result  — send stage result email
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import { sendNotificationEmail } from '../lib/email';
import type { Env, Variables } from '../types';

const emailRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
emailRoutes.use('*', authMiddleware);

// POST /:candidateId/send-invite — resend the invitation email
emailRoutes.post('/:candidateId/send-invite', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  if (!c.env.RESEND_API_KEY) {
    return apiError(c, 'SERVICE_UNAVAILABLE', 'Email service not configured.');
  }

  const candidate = await db
    .prepare(
      `SELECT c.name, c.email, c.invite_token, c.current_stage_id, c.pipeline_id,
              p.title AS pipeline_title
       FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first<{
      name: string;
      email: string;
      invite_token: string;
      current_stage_id: string | null;
      pipeline_id: string;
      pipeline_title: string;
    }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const baseUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';
  const assessUrl = `${baseUrl}/assess/${candidate.invite_token}`;

  let stageTemplatesJson: string | null = null;
  if (candidate.current_stage_id) {
    const stageRow = await db
      .prepare('SELECT notification_templates FROM stages WHERE id = ?')
      .bind(candidate.current_stage_id)
      .first<{ notification_templates: string | null }>();
    stageTemplatesJson = stageRow?.notification_templates ?? null;
  }

  const result = await sendNotificationEmail({
    apiKey: c.env.RESEND_API_KEY,
    trigger: 'INVITATION',
    to: candidate.email,
    variables: {
      name: candidate.name,
      email: candidate.email,
      pipelineName: candidate.pipeline_title,
      assessUrl,
    },
    stageTemplatesJson,
  });

  if (!result) {
    return apiError(c, 'INTERNAL_ERROR', 'Failed to send email.');
  }

  return c.json({ success: true, emailId: result.id });
});

// POST /:candidateId/send-result — send stage result (SUCCESS or FAILURE)
const sendResultSchema = z.object({
  trigger: z.enum(['SUCCESS', 'FAILURE']),
  stageId: z.string().min(1),
});

emailRoutes.post('/:candidateId/send-result', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  if (!c.env.RESEND_API_KEY) {
    return apiError(c, 'SERVICE_UNAVAILABLE', 'Email service not configured.');
  }

  const body = await c.req.json();
  const parsed = sendResultSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { trigger, stageId } = parsed.data;

  const candidate = await db
    .prepare(
      `SELECT c.name, c.email, c.pipeline_id, p.title AS pipeline_title
       FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first<{
      name: string;
      email: string;
      pipeline_id: string;
      pipeline_title: string;
    }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const stage = await db
    .prepare('SELECT title, notification_templates FROM stages WHERE id = ? AND pipeline_id = ?')
    .bind(stageId, candidate.pipeline_id)
    .first<{ title: string; notification_templates: string | null }>();

  if (!stage) return apiError(c, 'NOT_FOUND', 'Stage not found.');

  const result = await sendNotificationEmail({
    apiKey: c.env.RESEND_API_KEY,
    trigger,
    to: candidate.email,
    variables: {
      name: candidate.name,
      email: candidate.email,
      pipelineName: candidate.pipeline_title,
      stageName: stage.title,
    },
    stageTemplatesJson: stage.notification_templates,
  });

  if (!result) {
    return apiError(c, 'INTERNAL_ERROR', 'Failed to send email.');
  }

  return c.json({ success: true, emailId: result.id });
});

export { emailRoutes };
