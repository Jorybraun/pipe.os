/**
 * Phone screening routes — Twilio Voice integration.
 *
 * Public routes (no auth, Twilio signature validation):
 *   POST /api/v1/phone/twiml            — TwiML webhook (Twilio calls when browser initiates)
 *   POST /api/v1/phone/recording-status  — Recording callback
 *   POST /api/v1/phone/call-status       — Call status updates
 *
 * Authenticated routes (Clerk JWT):
 *   GET  /api/v1/phone/connection        — Check Twilio config status
 *   POST /api/v1/phone/token             — Generate Twilio Access Token for browser
 *   POST /api/v1/phone/calls             — Create a phone call record
 *   GET  /api/v1/phone/calls             — List calls for a candidate
 *   PATCH /api/v1/phone/calls/:callId    — Update call (recruiter notes)
 *   GET  /api/v1/phone/calls/:callId/recording — Stream recording from R2
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import { validateTwilioSignature, generateTwilioAccessToken } from '../lib/twilioAuth';
import { transcribeAudioWhisper } from '../lib/transcribe';
import type { Env, Variables, PhoneCallRow } from '../types';

// ─── Validation ──────────────────────────────────────────────────────────────

const createCallSchema = z.object({
  candidateId: z.string().min(1),
  pipelineId: z.string().min(1),
});

const updateCallSchema = z.object({
  recruiterNotes: z.string().optional(),
});

// ─── Public routes (Twilio webhooks) ────────────────────────────────────────

const phonePublic = new Hono<{ Bindings: Env }>();

/**
 * TwiML webhook — Twilio calls this when the browser SDK initiates a call.
 * Returns TwiML XML to connect the call to the candidate's phone number.
 */
phonePublic.post('/twiml', async (c) => {
  const authToken = c.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return c.text('<Response><Say>Phone screening is not configured.</Say></Response>', 200, {
      'Content-Type': 'text/xml',
    });
  }

  // Parse form-encoded body
  const formData = await c.req.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = String(value);
  });

  // Validate Twilio signature
  const signature = c.req.header('X-Twilio-Signature') ?? '';
  const url = c.req.url;
  const valid = await validateTwilioSignature(authToken, signature, url, params);
  if (!valid) {
    console.error('[phone/twiml] Invalid Twilio signature');
    return c.text('Forbidden', 403);
  }

  const toNumber = params['To'] ?? '';
  const callSid = params['CallSid'] ?? '';

  if (!toNumber) {
    return c.text(
      '<Response><Say>No destination number provided.</Say></Response>',
      200,
      { 'Content-Type': 'text/xml' },
    );
  }

  // Build the worker base URL for callbacks
  const workerUrl = new URL(c.req.url);
  const baseUrl = `${workerUrl.protocol}//${workerUrl.host}`;

  // Update any INITIATED call record that matches this To number with the CallSid
  const db = c.env.DB;
  await db
    .prepare(
      `UPDATE phone_calls SET twilio_call_sid = ?, status = 'RINGING', updated_at = ?
       WHERE to_number = ? AND status = 'INITIATED' AND twilio_call_sid IS NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(callSid, new Date().toISOString(), toNumber)
    .run();

  // Return TwiML to connect the call with recording
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial record="record-from-answer-dual"
        recordingStatusCallback="${baseUrl}/api/v1/phone/recording-status"
        recordingStatusCallbackEvent="completed"
        action="${baseUrl}/api/v1/phone/call-status">
    <Number statusCallback="${baseUrl}/api/v1/phone/call-status"
            statusCallbackEvent="initiated ringing answered completed">${toNumber}</Number>
  </Dial>
</Response>`;

  return c.text(twiml, 200, { 'Content-Type': 'text/xml' });
});

/**
 * Recording status callback — Twilio sends this when a recording is ready.
 * Fetches the audio, stores in R2, triggers transcription.
 */
phonePublic.post('/recording-status', async (c) => {
  const authToken = c.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return c.json({ error: 'Not configured' }, 500);

  const formData = await c.req.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = String(value);
  });

  // Validate signature
  const signature = c.req.header('X-Twilio-Signature') ?? '';
  const valid = await validateTwilioSignature(authToken, signature, c.req.url, params);
  if (!valid) {
    console.error('[phone/recording-status] Invalid Twilio signature');
    return c.text('Forbidden', 403);
  }

  const callSid = params['CallSid'] ?? '';
  const recordingSid = params['RecordingSid'] ?? '';
  const recordingUrl = params['RecordingUrl'] ?? '';
  const recordingStatus = params['RecordingStatus'] ?? '';
  const durationStr = params['RecordingDuration'] ?? '0';
  const duration = parseInt(durationStr, 10) || 0;

  if (recordingStatus !== 'completed' || !recordingUrl) {
    return c.json({ message: 'Ignored non-completed status' });
  }

  const db = c.env.DB;
  const now = new Date().toISOString();

  // Find the call record by Twilio CallSid
  const call = await db
    .prepare('SELECT id FROM phone_calls WHERE twilio_call_sid = ?')
    .bind(callSid)
    .first<{ id: string }>();

  if (!call) {
    console.error('[phone/recording-status] No call found for CallSid:', callSid);
    return c.json({ message: 'Call not found' }, 404);
  }

  // Fetch recording audio from Twilio (requires Basic Auth)
  const accountSid = c.env.TWILIO_ACCOUNT_SID ?? '';
  const audioUrl = `${recordingUrl}.mp3`;
  const audioResponse = await fetch(audioUrl, {
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
    },
  });

  if (!audioResponse.ok) {
    console.error('[phone/recording-status] Failed to fetch recording:', audioResponse.status);
    await db
      .prepare('UPDATE phone_calls SET status = ?, updated_at = ? WHERE id = ?')
      .bind('COMPLETED', now, call.id)
      .run();
    return c.json({ message: 'Recording fetch failed' });
  }

  const audioBuffer = await audioResponse.arrayBuffer();

  // Store in R2
  const r2Key = `call-recordings/${call.id}/${recordingSid}.mp3`;
  await c.env.STORAGE.put(r2Key, audioBuffer, {
    httpMetadata: { contentType: 'audio/mpeg' },
  });

  // Update call record
  await db
    .prepare(
      `UPDATE phone_calls
       SET recording_s3_key = ?, recording_url = ?, duration_seconds = ?,
           status = 'COMPLETED', transcription_status = 'PENDING', updated_at = ?
       WHERE id = ?`
    )
    .bind(r2Key, recordingUrl, duration, now, call.id)
    .run();

  // Fire-and-forget transcription via Workers AI Whisper (free)
  if (c.env.AI) {
    c.executionCtx.waitUntil(
      (async () => {
        try {
          await db
            .prepare('UPDATE phone_calls SET transcription_status = ? WHERE id = ?')
            .bind('PROCESSING', call.id)
            .run();

          const transcript = await transcribeAudioWhisper(c.env.AI, audioBuffer);

          await db
            .prepare(
              'UPDATE phone_calls SET transcription = ?, transcription_status = ?, updated_at = ? WHERE id = ?'
            )
            .bind(transcript, transcript ? 'COMPLETED' : 'FAILED', new Date().toISOString(), call.id)
            .run();
        } catch (err) {
          console.error('[phone/recording-status] Transcription failed:', err);
          await db
            .prepare('UPDATE phone_calls SET transcription_status = ? WHERE id = ?')
            .bind('FAILED', call.id)
            .run();
        }
      })(),
    );
  }

  return c.json({ message: 'OK' });
});

/**
 * Call status callback — Twilio sends status changes during the call lifecycle.
 */
phonePublic.post('/call-status', async (c) => {
  const authToken = c.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return c.json({ error: 'Not configured' }, 500);

  const formData = await c.req.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = String(value);
  });

  // Validate signature
  const signature = c.req.header('X-Twilio-Signature') ?? '';
  const valid = await validateTwilioSignature(authToken, signature, c.req.url, params);
  if (!valid) {
    console.error('[phone/call-status] Invalid Twilio signature');
    return c.text('Forbidden', 403);
  }

  const callSid = params['CallSid'] ?? '';
  const callStatus = params['CallStatus'] ?? '';
  const durationStr = params['CallDuration'] ?? '';
  const now = new Date().toISOString();

  // Map Twilio status to our status enum
  const statusMap: Record<string, string> = {
    initiated: 'INITIATED',
    ringing: 'RINGING',
    'in-progress': 'IN_PROGRESS',
    completed: 'COMPLETED',
    failed: 'FAILED',
    'no-answer': 'NO_ANSWER',
    busy: 'BUSY',
    canceled: 'CANCELLED',
  };

  const mappedStatus = statusMap[callStatus] ?? null;
  if (!mappedStatus || !callSid) {
    return c.json({ message: 'Ignored' });
  }

  const db = c.env.DB;
  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const values: unknown[] = [mappedStatus, now];

  if (durationStr) {
    updates.push('duration_seconds = ?');
    values.push(parseInt(durationStr, 10) || 0);
  }

  if (mappedStatus === 'IN_PROGRESS') {
    updates.push('started_at = ?');
    values.push(now);
  }

  if (['COMPLETED', 'FAILED', 'NO_ANSWER', 'BUSY', 'CANCELLED'].includes(mappedStatus)) {
    updates.push('ended_at = ?');
    values.push(now);
  }

  values.push(callSid);

  await db
    .prepare(`UPDATE phone_calls SET ${updates.join(', ')} WHERE twilio_call_sid = ?`)
    .bind(...values)
    .run();

  // Return TwiML for <Dial action> callback (expects XML response)
  return c.text(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    200,
    { 'Content-Type': 'text/xml' },
  );
});

// ─── Authenticated routes ───────────────────────────────────────────────────

const phoneAuth = new Hono<{ Bindings: Env; Variables: Variables }>();
phoneAuth.use('*', authMiddleware);

/**
 * GET /connection — Check if Twilio is configured at the platform level.
 */
phoneAuth.get('/connection', (c) => {
  const configured = !!(
    c.env.TWILIO_ACCOUNT_SID &&
    c.env.TWILIO_AUTH_TOKEN &&
    c.env.TWILIO_PHONE_NUMBER &&
    c.env.TWILIO_API_KEY_SID &&
    c.env.TWILIO_API_KEY_SECRET &&
    c.env.TWILIO_TWIML_APP_SID
  );

  return c.json({
    connected: configured,
    phoneNumber: configured ? c.env.TWILIO_PHONE_NUMBER : null,
  });
});

/**
 * POST /token — Generate a Twilio Access Token for the browser Voice SDK.
 */
phoneAuth.post('/token', async (c) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID } = c.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET || !TWILIO_TWIML_APP_SID) {
    return apiError(c, 'INTERNAL_ERROR', 'Twilio is not configured.');
  }

  const identity = c.var.userId;
  const token = await generateTwilioAccessToken({
    accountSid: TWILIO_ACCOUNT_SID,
    apiKeySid: TWILIO_API_KEY_SID,
    apiKeySecret: TWILIO_API_KEY_SECRET,
    twimlAppSid: TWILIO_TWIML_APP_SID,
    identity,
  });

  return c.json({ token, identity });
});

/**
 * POST /calls — Create a phone call record before dialing.
 */
phoneAuth.post('/calls', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json();
  const parsed = createCallSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { candidateId, pipelineId } = parsed.data;

  // Ownership check + fetch phone number
  const candidate = await db
    .prepare(
      `SELECT c.id, c.phone_number, c.pipeline_id
       FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first<{ id: string; phone_number: string | null; pipeline_id: string }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');
  if (!candidate.phone_number) {
    return apiError(c, 'VALIDATION_ERROR', 'Candidate has no phone number on file.');
  }

  const fromNumber = c.env.TWILIO_PHONE_NUMBER ?? '';
  if (!fromNumber) return apiError(c, 'INTERNAL_ERROR', 'Twilio phone number not configured.');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO phone_calls (id, candidate_id, pipeline_id, owner_id, direction, status, from_number, to_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'OUTBOUND', 'INITIATED', ?, ?, ?, ?)`
    )
    .bind(id, candidateId, pipelineId, userId, fromNumber, candidate.phone_number, now, now)
    .run();

  return c.json({
    call: {
      id,
      candidateId,
      pipelineId,
      direction: 'OUTBOUND',
      status: 'INITIATED',
      fromNumber,
      toNumber: candidate.phone_number,
      createdAt: now,
    },
  }, 201);
});

/**
 * GET /calls — List phone calls for a candidate.
 */
phoneAuth.get('/calls', async (c) => {
  const userId = c.var.userId;
  const candidateId = c.req.query('candidateId');
  if (!candidateId) return apiError(c, 'VALIDATION_ERROR', 'candidateId is required.');

  const db = c.env.DB;

  // Ownership check
  const candidate = await db
    .prepare(
      `SELECT c.id FROM candidates c
       JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.owner_id = ?`
    )
    .bind(candidateId, userId)
    .first<{ id: string }>();

  if (!candidate) return apiError(c, 'NOT_FOUND', 'Candidate not found.');

  const { results } = await db
    .prepare(
      `SELECT id, candidate_id, pipeline_id, direction, status, from_number, to_number,
              twilio_call_sid, duration_seconds, recording_s3_key, transcription,
              transcription_status, recruiter_notes, started_at, ended_at, created_at
       FROM phone_calls
       WHERE candidate_id = ?
       ORDER BY created_at DESC`
    )
    .bind(candidateId)
    .all<PhoneCallRow>();

  const calls = (results ?? []).map(mapCallRow);

  return c.json({ calls });
});

/**
 * PATCH /calls/:callId — Update recruiter notes on a call.
 */
phoneAuth.patch('/calls/:callId', async (c) => {
  const userId = c.var.userId;
  const { callId } = c.req.param();
  const db = c.env.DB;

  // Ownership check
  const call = await db
    .prepare('SELECT id FROM phone_calls WHERE id = ? AND owner_id = ?')
    .bind(callId, userId)
    .first<{ id: string }>();

  if (!call) return apiError(c, 'NOT_FOUND', 'Call not found.');

  const body = await c.req.json();
  const parsed = updateCallSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (parsed.data.recruiterNotes !== undefined) {
    updates.push('recruiter_notes = ?');
    values.push(parsed.data.recruiterNotes);
  }

  if (updates.length === 0) return apiError(c, 'VALIDATION_ERROR', 'No fields to update.');

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(callId);

  await db
    .prepare(`UPDATE phone_calls SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true });
});

/**
 * GET /calls/:callId/recording — Stream call recording from R2.
 */
phoneAuth.get('/calls/:callId/recording', async (c) => {
  const userId = c.var.userId;
  const { callId } = c.req.param();
  const db = c.env.DB;

  const call = await db
    .prepare('SELECT recording_s3_key FROM phone_calls WHERE id = ? AND owner_id = ?')
    .bind(callId, userId)
    .first<{ recording_s3_key: string | null }>();

  if (!call) return apiError(c, 'NOT_FOUND', 'Call not found.');
  if (!call.recording_s3_key) return apiError(c, 'NOT_FOUND', 'No recording available.');

  const object = await c.env.STORAGE.get(call.recording_s3_key);
  if (!object) return apiError(c, 'NOT_FOUND', 'Recording file not found in storage.');

  return new Response(object.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapCallRow(row: PhoneCallRow): Record<string, unknown> {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    pipelineId: row.pipeline_id,
    direction: row.direction,
    status: row.status,
    fromNumber: row.from_number,
    toNumber: row.to_number,
    twilioCallSid: row.twilio_call_sid,
    durationSeconds: row.duration_seconds,
    recordingS3Key: row.recording_s3_key,
    transcription: row.transcription,
    transcriptionStatus: row.transcription_status,
    recruiterNotes: row.recruiter_notes,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export { phonePublic, phoneAuth };
