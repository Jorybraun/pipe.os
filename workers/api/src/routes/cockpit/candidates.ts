/**
 * Candidate routes — Phase 2 + Phase 3
 *
 * POST  /api/v1/pipelines/:pipelineId/candidates — create candidate with invite token
 * GET   /api/v1/candidates/:candidateId          — recruiter: full profile with submissions
 * PATCH /api/v1/candidates/:candidateId          — update (move stage, update status)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { parseResume, persistParsedCV } from '../../lib/cvParser';
import { sendNotificationEmail } from '../../lib/email';
import type { Env, Variables } from '../../types';

// ─── Validation ──────────────────────────────────────────────────────────────

const createCandidateSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  email: z.string().email('valid email required'),
  currentStageId: z.string().optional(),
});

const updateCandidateSchema = z.object({
  currentStageId: z.string().optional(),
  status: z.enum(['INVITED', 'IN_PROGRESS', 'COMPLETED']).optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  resumeS3Key: z.string().optional(),
  phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be E.164 format').optional().nullable(),
});

/** Maximum file size for CV uploads: 10 MB. */
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/** MIME types accepted for CV/resume uploads. */
const ALLOWED_RESUME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// ─── Pipeline-scoped routes ──────────────────────────────────────────────────

const pipelineCandidates = new Hono<{ Bindings: Env; Variables: Variables }>();
pipelineCandidates.use('*', authMiddleware);

// POST /:pipelineId/candidates
pipelineCandidates.post('/:pipelineId/candidates', async (c) => {
  const userId = c.var.userId;
  const { pipelineId } = c.req.param();
  const db = c.env.DB;

  // Ownership check — fetch title for email
  const pipeline = await db
    .prepare('SELECT id, title FROM pipelines WHERE id = ? AND owner_id = ?')
    .bind(pipelineId, userId)
    .first<{ id: string; title: string }>();
  if (!pipeline) return apiError(c, 'NOT_FOUND', 'Pipeline not found.');

  const body = await c.req.json();
  const parsed = createCandidateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { name, email, currentStageId: requestedStageId } = parsed.data;
  const id = crypto.randomUUID();
  const inviteToken = crypto.randomUUID();
  const now = new Date().toISOString();

  // Use requested stage or fall back to first stage
  let stageId = requestedStageId ?? null;
  if (!stageId) {
    const firstStage = await db
      .prepare(
        'SELECT id FROM stages WHERE pipeline_id = ? ORDER BY sort_order ASC LIMIT 1'
      )
      .bind(pipelineId)
      .first();
    stageId = (firstStage?.id as string) ?? null;
  }

  await db
    .prepare(
      `INSERT INTO candidates (id, pipeline_id, owner_id, name, email, invite_token, status, current_stage_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'INVITED', ?, ?, ?)`
    )
    .bind(id, pipelineId, userId, name, email, inviteToken, stageId, now, now)
    .run();

  // Create scheduled_interviews row for scheduled/LIVE_VIDEO stages
  if (stageId) {
    const stageCheck = await db
      .prepare('SELECT mode, is_scheduled FROM stages WHERE id = ?')
      .bind(stageId)
      .first<{ mode: string | null; is_scheduled: number | null }>();

    if (stageCheck?.is_scheduled || stageCheck?.mode === 'LIVE_VIDEO') {
      const interviewId = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO scheduled_interviews (id, candidate_id, pipeline_id, stage_id, owner_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'INVITED', ?, ?)`
        )
        .bind(interviewId, id, pipelineId, stageId, userId, now, now)
        .run();
    }
  }

  // Fire-and-forget invitation email via Resend
  if (c.env.RESEND_API_KEY) {
    const baseUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';
    const assessUrl = `${baseUrl}/assess/${inviteToken}`;

    // Fetch stage info (mode, templates) and scheduling connection for booking URL
    let stageTemplatesJson: string | null = null;
    let bookingUrl: string | undefined;
    let stageName: string | undefined;

    if (stageId) {
      const stageRow = await db
        .prepare('SELECT title, mode, notification_templates, is_scheduled, scheduling_event_type_id FROM stages WHERE id = ?')
        .bind(stageId)
        .first<{ title: string; mode: string | null; notification_templates: string | null; is_scheduled: number | null; scheduling_event_type_id: string | null }>();
      stageTemplatesJson = stageRow?.notification_templates ?? null;
      stageName = stageRow?.title;

      // If stage is scheduled (LIVE_VIDEO or is_scheduled flag), look up booking URL
      console.log('[candidates] Stage check:', { is_scheduled: stageRow?.is_scheduled, mode: stageRow?.mode, scheduling_event_type_id: stageRow?.scheduling_event_type_id });
      if (stageRow?.is_scheduled || stageRow?.mode === 'LIVE_VIDEO') {
        const conn = await db
          .prepare(
            `SELECT access_token, provider_id FROM scheduling_connections
             WHERE owner_id = ? AND status = 'ACTIVE' LIMIT 1`
          )
          .bind(userId)
          .first<{ access_token: string; provider_id: string }>();

        console.log('[candidates] Scheduling connection:', { found: !!conn, provider: conn?.provider_id });
        if (conn && conn.provider_id === 'CALENDLY') {
          try {
            // Use stage-specific event type or fetch the first available one
            const eventTypeUri = stageRow.scheduling_event_type_id;
            if (eventTypeUri) {
              console.log('[candidates] Fetching event type:', eventTypeUri);
              const etRes = await fetch(eventTypeUri, {
                headers: { Authorization: `Bearer ${conn.access_token}` },
              });
              console.log('[candidates] Event type response:', { status: etRes.status });
              if (etRes.ok) {
                const etData = await etRes.json() as { resource?: { scheduling_url?: string } };
                console.log('[candidates] Event type scheduling_url:', etData.resource?.scheduling_url);
                bookingUrl = etData.resource?.scheduling_url;
              } else {
                const errText = await etRes.text();
                console.error('[candidates] Event type fetch failed:', errText);
              }
            } else {
              // No event type configured — use first available from the account
              console.log('[candidates] No event type configured, using fallback');
              const userRes = await fetch('https://api.calendly.com/users/me', {
                headers: { Authorization: `Bearer ${conn.access_token}` },
              });
              console.log('[candidates] /users/me response:', { status: userRes.status });
              if (userRes.ok) {
                const userData = await userRes.json() as { resource?: { uri?: string } };
                const userUri = userData.resource?.uri;
                console.log('[candidates] User URI:', userUri);
                if (userUri) {
                  const etListRes = await fetch(
                    `https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}&active=true&count=1`,
                    { headers: { Authorization: `Bearer ${conn.access_token}` } },
                  );
                  console.log('[candidates] Event types list response:', { status: etListRes.status });
                  if (etListRes.ok) {
                    const etList = await etListRes.json() as { collection?: { scheduling_url?: string }[] };
                    console.log('[candidates] Event types collection:', JSON.stringify(etList.collection?.map(e => e.scheduling_url)));
                    bookingUrl = etList.collection?.[0]?.scheduling_url;
                  }
                }
              } else {
                const errText = await userRes.text();
                console.error('[candidates] /users/me failed:', errText);
              }
            }
          } catch (err) {
            console.error('[candidates] Calendly fetch error:', err instanceof Error ? err.message : String(err));
          }
        }
      }
    }

    console.log('[candidates] Final bookingUrl:', bookingUrl ?? 'NONE');

    c.executionCtx.waitUntil(
      sendNotificationEmail({
        apiKey: c.env.RESEND_API_KEY,
        trigger: 'INVITATION',
        to: email,
        variables: {
          name,
          email,
          pipelineName: pipeline.title,
          ...(stageName ? { stageName } : {}),
          assessUrl,
          ...(bookingUrl ? { bookingUrl } : {}),
        },
        stageTemplatesJson,
      }),
    );
  }

  return c.json({
    candidate: {
      id,
      name,
      email,
      inviteToken,
      status: 'INVITED',
      currentStageId: stageId,
    },
  }, 201);
});

// ─── Flat candidate routes ───────────────────────────────────────────────────

const candidateOps = new Hono<{ Bindings: Env; Variables: Variables }>();
candidateOps.use('*', authMiddleware);

// GET /:candidateId — full profile with stages + challenge submissions
candidateOps.get('/:candidateId', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check via pipeline
  const candidate = await db
    .prepare(
      `SELECT c.id, c.name, c.email, c.status, c.pipeline_id,
              c.current_stage_id, c.resume_s3_key, c.phone_number,
              c.skills, c.years_of_experience, c.current_role, c.education,
              c.created_at, c.updated_at
       FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first<{
      id: string;
      name: string | null;
      email: string | null;
      status: string;
      pipeline_id: string;
      current_stage_id: string | null;
      resume_s3_key: string | null;
      phone_number: string | null;
      skills: string | null;
      years_of_experience: number | null;
      current_role: string | null;
      education: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  // Fetch stages with challenges for this pipeline
  const stagesResult = await db
    .prepare(
      `SELECT id, title, sort_order, mode
       FROM stages
       WHERE pipeline_id = ?
       ORDER BY sort_order ASC`
    )
    .bind(candidate.pipeline_id)
    .all<{ id: string; title: string; sort_order: number; mode: string | null }>();

  const stages = stagesResult.results ?? [];

  // Fetch all challenges for those stages — include server_config for recruiter view
  // (correctOptionId, ideal answers etc. are recruiter-visible on the profile)
  const challengesResult = await db
    .prepare(
      `SELECT id, stage_id, type, title, instructions, config, server_config, sort_order
       FROM challenges
       WHERE stage_id IN (SELECT id FROM stages WHERE pipeline_id = ?)
       ORDER BY sort_order ASC`
    )
    .bind(candidate.pipeline_id)
    .all<{
      id: string;
      stage_id: string;
      type: string;
      title: string;
      instructions: string | null;
      config: string | null;
      server_config: string | null;
      sort_order: number;
    }>();

  const challenges = challengesResult.results ?? [];

  // Fetch all challenge submissions for this candidate
  const submissionsResult = await db
    .prepare(
      `SELECT id, challenge_id, score, feedback, response_json, submitted_at, scored_at
       FROM challenge_submissions
       WHERE candidate_id = ?
       ORDER BY submitted_at ASC`
    )
    .bind(candidateId)
    .all<{
      id: string;
      challenge_id: string;
      score: number | null;
      feedback: string | null;
      response_json: string | null;
      submitted_at: string | null;
      scored_at: string | null;
    }>();

  const submissions = submissionsResult.results ?? [];

  // Map submissions by challenge_id for quick lookup
  const submissionsByChallenge = new Map(
    submissions.map((s) => [s.challenge_id, s])
  );

  // Fetch scheduled interviews for this candidate
  const interviewsResult = await db
    .prepare(
      `SELECT id, stage_id, status, scheduled_at, meeting_url, scheduling_provider
       FROM scheduled_interviews
       WHERE candidate_id = ?`
    )
    .bind(candidateId)
    .all<{
      id: string;
      stage_id: string;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
    }>();

  const interviewsByStage = new Map(
    (interviewsResult.results ?? []).map((iv) => [iv.stage_id, iv])
  );

  // Build stages with nested challenges + submissions
  const stagesWithChallenges = stages.map((stage) => {
    const stageChallenges = challenges
      .filter((ch) => ch.stage_id === stage.id)
      .map((ch) => {
        const sub = submissionsByChallenge.get(ch.id);
        // Merge server_config into config for recruiter view
        // (e.g. correctOptionId for MCQ, idealAnswer for SHORT_ANSWER)
        const publicConfig = ch.config
          ? (JSON.parse(ch.config) as Record<string, unknown>)
          : {};
        const serverConfig = ch.server_config
          ? (JSON.parse(ch.server_config) as Record<string, unknown>)
          : {};
        const mergedConfig = { ...publicConfig, ...serverConfig };
        return {
          id: ch.id,
          type: ch.type,
          title: ch.title,
          instructions: ch.instructions,
          config: mergedConfig,
          order: ch.sort_order,
          submission: sub
            ? {
                id: sub.id,
                score: sub.score,
                feedback: sub.feedback,
                response: sub.response_json
                  ? (JSON.parse(sub.response_json) as Record<string, unknown>)
                  : null,
                submittedAt: sub.submitted_at,
                scoredAt: sub.scored_at,
              }
            : null,
        };
      });
    const interview = interviewsByStage.get(stage.id);
    return {
      id: stage.id,
      title: stage.title,
      order: stage.sort_order,
      mode: stage.mode,
      challenges: stageChallenges,
      ...(interview ? {
        scheduledInterview: {
          id: interview.id,
          status: interview.status,
          scheduledAt: interview.scheduled_at,
          meetingUrl: interview.meeting_url,
          provider: interview.scheduling_provider,
        },
      } : {}),
    };
  });

  // Compute overall average score from all submissions with scores
  const scoredSubs = submissions.filter((s) => s.score !== null);
  const avgScore =
    scoredSubs.length > 0
      ? Math.round(
          scoredSubs.reduce((sum, s) => sum + (s.score ?? 0), 0) /
            scoredSubs.length
        )
      : null;

  // Fetch phone calls for this candidate (table may not exist if migration 0008 not applied)
  let phoneCallsResults: Array<{
    id: string; candidate_id: string; pipeline_id: string;
    direction: string; status: string; from_number: string; to_number: string;
    twilio_call_sid: string | null; duration_seconds: number | null;
    recording_s3_key: string | null; transcription: string | null;
    transcription_status: string | null; recruiter_notes: string | null;
    started_at: string | null; ended_at: string | null; created_at: string;
  }> = [];
  try {
    const phoneCallsResult = await db
      .prepare(
        `SELECT id, candidate_id, pipeline_id, direction, status, from_number, to_number,
                twilio_call_sid, duration_seconds, recording_s3_key, transcription,
                transcription_status, recruiter_notes, started_at, ended_at, created_at
         FROM phone_calls
         WHERE candidate_id = ?
         ORDER BY created_at DESC`
      )
      .bind(candidateId)
      .all();
    phoneCallsResults = (phoneCallsResult.results ?? []) as typeof phoneCallsResults;
  } catch {
    // phone_calls table may not exist yet
  }

  const phoneCalls = phoneCallsResults.map((pc) => ({
    id: pc.id,
    candidateId: pc.candidate_id,
    pipelineId: pc.pipeline_id,
    direction: pc.direction,
    status: pc.status,
    fromNumber: pc.from_number,
    toNumber: pc.to_number,
    twilioCallSid: pc.twilio_call_sid,
    durationSeconds: pc.duration_seconds,
    recordingS3Key: pc.recording_s3_key,
    transcription: pc.transcription,
    transcriptionStatus: pc.transcription_status,
    recruiterNotes: pc.recruiter_notes,
    startedAt: pc.started_at,
    endedAt: pc.ended_at,
    createdAt: pc.created_at,
  }));

  return c.json({
    candidate: {
      id: candidate.id,
      name: candidate.name,
      email: candidate.email,
      phoneNumber: candidate.phone_number,
      status: candidate.status,
      pipelineId: candidate.pipeline_id,
      currentStageId: candidate.current_stage_id,
      resumeS3Key: candidate.resume_s3_key,
      skills: candidate.skills ? (JSON.parse(candidate.skills) as string[]) : null,
      yearsOfExperience: candidate.years_of_experience,
      currentRole: candidate.current_role,
      education: candidate.education ? (JSON.parse(candidate.education) as string[]) : null,
      score: avgScore,
      createdAt: candidate.created_at,
      updatedAt: candidate.updated_at,
    },
    stages: stagesWithChallenges,
    phoneCalls,
  });
});

// POST /:candidateId/resume — direct upload of CV/resume to R2
candidateOps.post('/:candidateId/resume', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check via pipeline
  const candidate = await db
    .prepare(
      `SELECT c.id FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first<{ id: string }>();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request must be multipart/form-data.');
  }

  const fileEntry = formData.get('file');
  if (!(fileEntry instanceof File)) {
    return apiError(c, 'VALIDATION_ERROR', 'No file field found in the request.');
  }

  if (!ALLOWED_RESUME_TYPES.has(fileEntry.type)) {
    return apiError(c, 'VALIDATION_ERROR', 'Only PDF and DOCX files are accepted.');
  }

  if (fileEntry.size > MAX_RESUME_BYTES) {
    return apiError(c, 'VALIDATION_ERROR', 'File exceeds the 10 MB limit.');
  }

  // Sanitise the filename — strip path traversal attempts, keep extension only
  const rawName = fileEntry.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const r2Key = `candidate-documents/${candidateId}/${rawName}`;

  // Upload to R2
  const arrayBuffer = await fileEntry.arrayBuffer();
  await c.env.STORAGE.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: fileEntry.type },
    customMetadata: { candidateId, originalName: fileEntry.name },
  });

  // Persist the R2 key on the candidate record
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE candidates SET resume_s3_key = ?, updated_at = ? WHERE id = ?`)
    .bind(r2Key, now, candidateId)
    .run();

  // Parse the resume for structured data (skills, role, experience)
  const isMock = c.env.MOCK_AI === 'true';
  const parsed = await parseResume({
    fileBuffer: arrayBuffer,
    contentType: fileEntry.type,
    ...(c.env.MISTRAL_API_KEY ? { apiKey: c.env.MISTRAL_API_KEY } : {}),
    mock: isMock,
  });

  if (parsed) {
    await persistParsedCV(db, candidateId, parsed);
  }

  return c.json({ success: true, r2Key, parsed }, 201);
});

// GET /:candidateId/resume — stream CV/resume from R2 to the recruiter
candidateOps.get('/:candidateId/resume', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check — also fetch the stored R2 key
  const candidate = await db
    .prepare(
      `SELECT c.resume_s3_key FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first<{ resume_s3_key: string | null }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');
  if (!candidate.resume_s3_key) return apiError(c, 'NOT_FOUND', 'No resume on file.');

  const object = await c.env.STORAGE.get(candidate.resume_s3_key);
  if (!object) {
    return apiError(c, 'NOT_FOUND', 'Resume file not found in storage.');
  }

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  // Derive a download filename from the R2 key (last path segment)
  const filename = candidate.resume_s3_key.split('/').at(-1) ?? 'resume';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
});

// PATCH /:candidateId
candidateOps.patch('/:candidateId', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check via pipeline
  const candidate = await db
    .prepare(
      `SELECT c.id, c.pipeline_id FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first();
  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const body = await c.req.json();
  const parsed = updateCandidateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (parsed.data.currentStageId !== undefined) {
    updates.push('current_stage_id = ?');
    values.push(parsed.data.currentStageId);
  }
  if (parsed.data.status !== undefined) {
    updates.push('status = ?');
    values.push(parsed.data.status);
  }
  if (parsed.data.name !== undefined) {
    updates.push('name = ?');
    values.push(parsed.data.name);
  }
  if (parsed.data.email !== undefined) {
    updates.push('email = ?');
    values.push(parsed.data.email);
  }
  if (parsed.data.resumeS3Key !== undefined) {
    updates.push('resume_s3_key = ?');
    values.push(parsed.data.resumeS3Key);
  }
  if (parsed.data.phoneNumber !== undefined) {
    updates.push('phone_number = ?');
    values.push(parsed.data.phoneNumber);
  }

  if (updates.length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'No fields to update.');
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(candidateId);

  await db
    .prepare(`UPDATE candidates SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true });
});

// POST /:candidateId/refresh-link — regenerate invite token
candidateOps.post('/:candidateId/refresh-link', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  // Ownership check via pipeline
  const candidate = await db
    .prepare(
      `SELECT c.id, c.status FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first<{ id: string; status: string }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const newToken = crypto.randomUUID();
  const now = new Date().toISOString();

  // Wipe previous attempt data so the candidate starts fresh
  await db.batch([
    db.prepare(`DELETE FROM review_sessions WHERE candidate_id = ?`).bind(candidateId),
    db.prepare(`DELETE FROM challenge_submissions WHERE candidate_id = ?`).bind(candidateId),
    db.prepare(`DELETE FROM assessments WHERE candidate_id = ?`).bind(candidateId),
    db.prepare(
      `UPDATE candidates SET invite_token = ?, status = 'INVITED', updated_at = ? WHERE id = ?`
    ).bind(newToken, now, candidateId),
  ]);

  return c.json({ inviteToken: newToken });
});

// DELETE /:candidateId — archive a candidate (soft delete)
candidateOps.delete('/:candidateId', async (c) => {
  const userId = c.var.userId;
  const { candidateId } = c.req.param();
  const db = c.env.DB;

  const candidate = await db
    .prepare(
      `SELECT c.id FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first<{ id: string }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  await db.prepare(
    `UPDATE candidates SET status = 'ARCHIVED', updated_at = ? WHERE id = ?`
  ).bind(new Date().toISOString(), candidateId).run();

  return c.json({ success: true });
});

export { pipelineCandidates, candidateOps };
