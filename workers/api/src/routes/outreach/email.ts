/**
 * Email routes — recruiter-triggered notifications.
 *
 * POST /api/v1/candidates/:candidateId/send-invite  — resend invitation email
 * POST /api/v1/candidates/:candidateId/send-result  — send stage result email
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { sendNotificationEmail } from '../../lib/email';
import type { EmailConnection } from '../../lib/email';
import { getValidEmailToken } from '../../lib/emailTokenRefresh';
import type { Env, Variables } from '../../types';

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
  let bookingUrl: string | undefined;
  let stageName: string | undefined;

  if (candidate.current_stage_id) {
    const stageRow = await db
      .prepare('SELECT title, mode, notification_templates, is_scheduled, scheduling_event_type_id FROM stages WHERE id = ?')
      .bind(candidate.current_stage_id)
      .first<{ title: string; mode: string | null; notification_templates: string | null; is_scheduled: number | null; scheduling_event_type_id: string | null }>();
    stageTemplatesJson = stageRow?.notification_templates ?? null;
    stageName = stageRow?.title;
  }

  // Check ANY stage in the pipeline for scheduling (not just current stage)
  {
    const scheduledStage = await db
      .prepare(
        `SELECT mode, is_scheduled, scheduling_event_type_id FROM stages
         WHERE pipeline_id = ? AND (is_scheduled = 1 OR mode = 'LIVE_VIDEO')
         LIMIT 1`
      )
      .bind(candidate.pipeline_id)
      .first<{ mode: string | null; is_scheduled: number | null; scheduling_event_type_id: string | null }>();

    console.log('[email] Scheduled stage in pipeline:', scheduledStage ? { is_scheduled: scheduledStage.is_scheduled, mode: scheduledStage.mode, scheduling_event_type_id: scheduledStage.scheduling_event_type_id } : 'NONE');
    if (scheduledStage) {
      const conn = await db
        .prepare(
          `SELECT access_token, provider_id FROM scheduling_connections
           WHERE owner_id = ? AND status = 'ACTIVE' LIMIT 1`
        )
        .bind(userId)
        .first<{ access_token: string; provider_id: string }>();

      console.log('[email] Scheduling connection:', { found: !!conn, provider: conn?.provider_id });
      if (conn && conn.provider_id === 'CALENDLY') {
        try {
          if (scheduledStage.scheduling_event_type_id) {
            console.log('[email] Fetching event type:', scheduledStage.scheduling_event_type_id);
            const etRes = await fetch(scheduledStage.scheduling_event_type_id, {
              headers: { Authorization: `Bearer ${conn.access_token}` },
            });
            console.log('[email] Event type response:', { status: etRes.status });
            if (etRes.ok) {
              const etData = await etRes.json() as { resource?: { scheduling_url?: string } };
              console.log('[email] Event type data scheduling_url:', etData.resource?.scheduling_url);
              bookingUrl = etData.resource?.scheduling_url;
            } else {
              const errText = await etRes.text();
              console.error('[email] Event type fetch failed:', errText);
            }
          } else {
            // Fallback: first active event type
            console.log('[email] No event type configured, using fallback');
            const userRes = await fetch('https://api.calendly.com/users/me', {
              headers: { Authorization: `Bearer ${conn.access_token}` },
            });
            console.log('[email] /users/me response:', { status: userRes.status });
            if (userRes.ok) {
              const userData = await userRes.json() as { resource?: { uri?: string } };
              const userUri = userData.resource?.uri;
              console.log('[email] User URI:', userUri);
              if (userUri) {
                const etListRes = await fetch(
                  `https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}&active=true&count=1`,
                  { headers: { Authorization: `Bearer ${conn.access_token}` } },
                );
                console.log('[email] Event types list response:', { status: etListRes.status });
                if (etListRes.ok) {
                  const etList = await etListRes.json() as { collection?: { scheduling_url?: string }[] };
                  console.log('[email] Event types collection:', JSON.stringify(etList.collection?.map(e => e.scheduling_url)));
                  bookingUrl = etList.collection?.[0]?.scheduling_url;
                }
              }
            } else {
              const errText = await userRes.text();
              console.error('[email] /users/me failed:', errText);
            }
          }
        } catch (err) {
          console.error('[email] Calendly fetch error:', err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  console.log('[email] Final bookingUrl:', bookingUrl ?? 'NONE');

  // Look up recruiter's OAuth email connection (Gmail / Microsoft)
  let emailConnection: EmailConnection | null = null;
  const emailConn = await db
    .prepare(
      `SELECT id, provider_id, access_token, token_expiry, refresh_token, account_email
       FROM email_connections WHERE owner_id = ? AND status = 'ACTIVE' LIMIT 1`,
    )
    .bind(userId)
    .first<{
      id: string;
      provider_id: string;
      access_token: string;
      token_expiry: string | null;
      refresh_token: string | null;
      account_email: string;
    }>();

  if (emailConn) {
    const validToken = await getValidEmailToken(emailConn, c.env);
    if (validToken) {
      emailConnection = {
        provider: emailConn.provider_id as 'GMAIL' | 'MICROSOFT',
        accessToken: validToken,
        accountEmail: emailConn.account_email,
      };
    }
  }

  const result = await sendNotificationEmail({
    apiKey: c.env.RESEND_API_KEY,
    trigger: 'INVITATION',
    to: candidate.email,
    variables: {
      name: candidate.name,
      email: candidate.email,
      pipelineName: candidate.pipeline_title,
      ...(stageName ? { stageName } : {}),
      assessUrl,
      ...(bookingUrl ? { bookingUrl } : {}),
    },
    stageTemplatesJson,
    emailConnection,
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

  // Look up recruiter's OAuth email connection (Gmail / Microsoft)
  let emailConnection: EmailConnection | null = null;
  const emailConn = await db
    .prepare(
      `SELECT id, provider_id, access_token, token_expiry, refresh_token, account_email
       FROM email_connections WHERE owner_id = ? AND status = 'ACTIVE' LIMIT 1`,
    )
    .bind(userId)
    .first<{
      id: string;
      provider_id: string;
      access_token: string;
      token_expiry: string | null;
      refresh_token: string | null;
      account_email: string;
    }>();

  if (emailConn) {
    const validToken = await getValidEmailToken(emailConn, c.env);
    if (validToken) {
      emailConnection = {
        provider: emailConn.provider_id as 'GMAIL' | 'MICROSOFT',
        accessToken: validToken,
        accountEmail: emailConn.account_email,
      };
    }
  }

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
    emailConnection,
  });

  if (!result) {
    return apiError(c, 'INTERNAL_ERROR', 'Failed to send email.');
  }

  return c.json({ success: true, emailId: result.id });
});

export { emailRoutes };
