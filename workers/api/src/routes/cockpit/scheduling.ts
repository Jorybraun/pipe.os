/**
 * Scheduling routes — OAuth, webhooks, and interview management.
 *
 * Recruiter routes (Clerk JWT auth):
 *   POST   /api/v1/scheduling/connect       — initiate OAuth flow
 *   POST   /api/v1/scheduling/callback       — OAuth token exchange
 *   GET    /api/v1/scheduling/connection      — get current connection
 *   DELETE /api/v1/scheduling/connection      — disconnect provider
 *   GET    /api/v1/scheduling/event-types     — list provider event types
 *   GET    /api/v1/scheduling/interviews      — list scheduled interviews
 *   POST   /api/v1/scheduling/interviews      — create scheduled interview
 *   PATCH  /api/v1/scheduling/interviews/:id  — update interview status
 *
 * Public route (webhook, no auth):
 *   POST   /api/v1/scheduling/webhook         — receive provider webhook events
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { sendNotificationEmail } from '../../lib/email';
import type { Env, Variables } from '../../types';

// ─── Provider config ────────────────────────────────────────────────────────

interface ProviderOAuthConfig {
  tokenUrl: string;
  userInfoUrl?: string;
  eventTypesUrl?: string;
  webhookUrl?: string;
  clientId: string;
  clientSecret: string;
}

function getProviderConfig(providerId: string, env: Env): ProviderOAuthConfig | null {
  const calendlyClientId = (env as unknown as Record<string, string>)['CALENDLY_CLIENT_ID'] ?? '';
  const calendlyClientSecret = (env as unknown as Record<string, string>)['CALENDLY_CLIENT_SECRET'] ?? '';
  const calcomClientId = (env as unknown as Record<string, string>)['CALCOM_CLIENT_ID'] ?? '';
  const calcomClientSecret = (env as unknown as Record<string, string>)['CALCOM_CLIENT_SECRET'] ?? '';

  switch (providerId) {
    case 'CALENDLY':
      return {
        tokenUrl: 'https://auth.calendly.com/oauth/token',
        userInfoUrl: 'https://api.calendly.com/users/me',
        eventTypesUrl: 'https://api.calendly.com/event_types',
        webhookUrl: 'https://api.calendly.com/webhook_subscriptions',
        clientId: calendlyClientId.trim(),
        clientSecret: calendlyClientSecret.trim(),
      };
    case 'CAL_COM':
      return {
        tokenUrl: 'https://app.cal.com/api/auth/oauth/token',
        eventTypesUrl: 'https://api.cal.com/v1/event-types',
        webhookUrl: 'https://api.cal.com/v1/webhooks',
        clientId: calcomClientId.trim(),
        clientSecret: calcomClientSecret.trim(),
      };
    default:
      return null;
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

const connectSchema = z.object({
  providerId: z.enum(['CALENDLY', 'CAL_COM']),
  redirectUri: z.string().url(),
  codeChallenge: z.string().optional(),
});

const callbackSchema = z.object({
  providerId: z.enum(['CALENDLY', 'CAL_COM']),
  code: z.string().min(1),
  redirectUri: z.string().url(),
  codeVerifier: z.string().optional(),
});

const createInterviewSchema = z.object({
  candidateId: z.string().min(1),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  interviewType: z.enum(['VIDEO', 'TECHNICAL', 'SCREENING']).optional(),
  schedulingProvider: z.enum(['CALENDLY', 'CAL_COM', 'MANUAL']).optional(),
  schedulingUrl: z.string().optional(),
});

const updateInterviewSchema = z.object({
  status: z.enum(['INVITED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  scheduledAt: z.string().optional(),
  meetingUrl: z.string().optional(),
  recruiterNotes: z.string().optional(),
});

// ─── Status transition validation ───────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  INVITED: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: ['INVITED'],
  NO_SHOW: ['SCHEDULED', 'CANCELLED'],
};

function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Authenticated routes ───────────────────────────────────────────────────

const schedulingAuth = new Hono<{ Bindings: Env; Variables: Variables }>();
schedulingAuth.use('*', authMiddleware);

// POST /connect — return OAuth authorization URL
schedulingAuth.post('/connect', async (c) => {
  const body = await c.req.json();
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { providerId, redirectUri, codeChallenge } = parsed.data;

  if (providerId === 'CALENDLY') {
    const clientId = ((c.env as unknown as Record<string, string>)['CALENDLY_CLIENT_ID'] ?? '').trim();
    if (!clientId) {
      return apiError(c, 'SERVICE_UNAVAILABLE', 'Calendly not configured.');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    return c.json({
      authUrl: `https://auth.calendly.com/oauth/authorize?${params.toString()}`,
    });
  }

  if (providerId === 'CAL_COM') {
    const clientId = ((c.env as unknown as Record<string, string>)['CALCOM_CLIENT_ID'] ?? '').trim();
    if (!clientId) {
      return apiError(c, 'SERVICE_UNAVAILABLE', 'Cal.com not configured.');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
    });

    return c.json({
      authUrl: `https://app.cal.com/auth/oauth2/authorize?${params.toString()}`,
    });
  }

  return apiError(c, 'VALIDATION_ERROR', `Unknown provider: ${providerId}`);
});

// POST /callback — exchange OAuth code for tokens
schedulingAuth.post('/callback', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json();
  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { providerId, code, redirectUri, codeVerifier } = parsed.data;
  const config = getProviderConfig(providerId, c.env);
  if (!config || !config.clientId) {
    return apiError(c, 'SERVICE_UNAVAILABLE', `${providerId} not configured.`);
  }

  // Debug: log what credentials are being used
  console.log('[scheduling] Token exchange config', {
    clientId: config.clientId ? `${config.clientId.slice(0, 8)}...` : 'EMPTY',
    clientSecretLen: config.clientSecret?.length ?? 0,
    redirectUri,
    codeLen: code.length,
  });

  // Exchange code for tokens
  const tokenParams: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  };
  if (codeVerifier) {
    tokenParams['code_verifier'] = codeVerifier;
  }

  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(tokenParams),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    console.error('[scheduling] Token exchange failed', {
      status: tokenResponse.status,
      body: errorBody.slice(0, 500),
    });
    return apiError(c, 'INTERNAL_ERROR', `Token exchange failed: ${tokenResponse.status}`);
  }

  const tokens = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  // Fetch user info for display (Calendly only)
  let accountEmail = '';
  let accountName = '';
  if (providerId === 'CALENDLY' && config.userInfoUrl) {
    try {
      const userResp = await fetch(config.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userResp.ok) {
        const userData = await userResp.json() as {
          resource?: { name?: string; email?: string };
        };
        accountEmail = userData.resource?.email ?? '';
        accountName = userData.resource?.name ?? '';
      }
    } catch (err) {
      console.warn('[scheduling] Failed to fetch user info', { err });
    }
  }

  // Generate webhook secret
  const webhookSecretBytes = new Uint8Array(32);
  crypto.getRandomValues(webhookSecretBytes);
  const webhookSecret = Array.from(webhookSecretBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const expiresIn = tokens.expires_in ?? 7200;
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
  const connectionId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Revoke any existing ACTIVE connections for this user+provider
  await db
    .prepare(
      `UPDATE scheduling_connections SET status = 'REVOKED', updated_at = ?
       WHERE owner_id = ? AND provider_id = ? AND status = 'ACTIVE'`
    )
    .bind(now, userId, providerId)
    .run();

  // Create new connection
  await db
    .prepare(
      `INSERT INTO scheduling_connections
       (id, owner_id, provider_id, access_token, refresh_token, token_expiry,
        account_email, account_name, webhook_secret, webhook_id, status,
        connected_at, last_sync_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'ACTIVE', ?, NULL, ?, ?)`
    )
    .bind(
      connectionId, userId, providerId,
      tokens.access_token, tokens.refresh_token ?? null, tokenExpiry,
      accountEmail, accountName, webhookSecret,
      now, now, now,
    )
    .run();

  // Register webhook with provider (best-effort)
  let webhookId: string | null = null;
  try {
    webhookId = await registerProviderWebhook(
      connectionId, providerId, tokens.access_token,
      webhookSecret, config, c.env,
    );

    if (webhookId) {
      await db
        .prepare('UPDATE scheduling_connections SET webhook_id = ?, updated_at = ? WHERE id = ?')
        .bind(webhookId, new Date().toISOString(), connectionId)
        .run();
    }
  } catch (err) {
    console.warn('[scheduling] Webhook registration failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return c.json({
    connection: {
      id: connectionId,
      providerId,
      accountEmail,
      accountName,
      status: 'ACTIVE',
      webhookRegistered: !!webhookId,
    },
  });
});

// GET /connection — current active connection
schedulingAuth.get('/connection', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const row = await db
    .prepare(
      `SELECT id, provider_id, account_email, account_name, status,
              connected_at, last_sync_at
       FROM scheduling_connections
       WHERE owner_id = ? AND status = 'ACTIVE'
       ORDER BY connected_at DESC LIMIT 1`
    )
    .bind(userId)
    .first<{
      id: string;
      provider_id: string;
      account_email: string | null;
      account_name: string | null;
      status: string;
      connected_at: string;
      last_sync_at: string | null;
    }>();

  if (!row) {
    return c.json({ connection: null });
  }

  return c.json({
    connection: {
      id: row.id,
      providerId: row.provider_id,
      accountEmail: row.account_email,
      accountName: row.account_name,
      status: row.status,
      connectedAt: row.connected_at,
      lastSyncAt: row.last_sync_at,
    },
  });
});

// DELETE /connection — disconnect provider
schedulingAuth.delete('/connection', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const connection = await db
    .prepare(
      `SELECT id, provider_id, access_token, webhook_id
       FROM scheduling_connections
       WHERE owner_id = ? AND status = 'ACTIVE'
       ORDER BY connected_at DESC LIMIT 1`
    )
    .bind(userId)
    .first<{
      id: string;
      provider_id: string;
      access_token: string;
      webhook_id: string | null;
    }>();

  if (!connection) {
    return apiError(c, 'NOT_FOUND', 'No active connection.');
  }

  // Delete webhook from provider (best-effort)
  if (connection.webhook_id) {
    try {
      await deleteProviderWebhook(
        connection.provider_id, connection.access_token, connection.webhook_id,
      );
    } catch (err) {
      console.warn('[scheduling] Webhook deletion failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await db
    .prepare(
      `UPDATE scheduling_connections SET status = 'REVOKED', updated_at = ? WHERE id = ?`
    )
    .bind(new Date().toISOString(), connection.id)
    .run();

  return c.json({ success: true });
});

// GET /event-types — list provider event types
schedulingAuth.get('/event-types', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const connection = await db
    .prepare(
      `SELECT id, provider_id, access_token, token_expiry, refresh_token
       FROM scheduling_connections
       WHERE owner_id = ? AND status = 'ACTIVE'
       ORDER BY connected_at DESC LIMIT 1`
    )
    .bind(userId)
    .first<{
      id: string;
      provider_id: string;
      access_token: string;
      token_expiry: string | null;
      refresh_token: string | null;
    }>();

  if (!connection) {
    return apiError(c, 'NOT_FOUND', 'No active connection.');
  }

  // Auto-refresh if needed
  let accessToken = connection.access_token;
  if (connection.token_expiry) {
    const expiryTime = new Date(connection.token_expiry).getTime();
    const bufferMs = 5 * 60 * 1000;
    if (Date.now() >= expiryTime - bufferMs && connection.refresh_token) {
      const refreshed = await refreshToken(connection, c.env);
      if (refreshed) {
        accessToken = refreshed;
      } else {
        return apiError(c, 'INTERNAL_ERROR', 'Token refresh failed.');
      }
    }
  }

  const config = getProviderConfig(connection.provider_id, c.env);
  if (!config?.eventTypesUrl) {
    return apiError(c, 'INTERNAL_ERROR', 'Provider does not support event types.');
  }

  let eventTypes: Array<{ id: string; name: string; durationMinutes: number; url: string }> = [];

  if (connection.provider_id === 'CALENDLY') {
    eventTypes = await fetchCalendlyEventTypes(accessToken, config);
  } else if (connection.provider_id === 'CAL_COM') {
    eventTypes = await fetchCalComEventTypes(accessToken, config);
  }

  return c.json({ eventTypes });
});

// GET /interviews — list scheduled interviews
schedulingAuth.get('/interviews', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const result = await db
    .prepare(
      `SELECT si.id, si.candidate_id, si.pipeline_id, si.stage_id,
              si.interview_type, si.status,
              si.scheduled_at, si.meeting_url, si.scheduling_provider,
              si.scheduling_url, si.recruiter_notes, si.sync_source,
              si.last_synced_at, si.created_at, si.updated_at,
              c.name AS candidate_name, c.email AS candidate_email,
              p.title AS pipeline_title,
              s.title AS stage_title
       FROM scheduled_interviews si
       LEFT JOIN candidates c ON c.id = si.candidate_id
       LEFT JOIN pipelines p ON p.id = si.pipeline_id
       LEFT JOIN stages s ON s.id = si.stage_id
       WHERE si.owner_id = ?
       ORDER BY si.scheduled_at ASC`
    )
    .bind(userId)
    .all<{
      id: string;
      candidate_id: string;
      pipeline_id: string | null;
      stage_id: string | null;
      interview_type: string | null;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
      recruiter_notes: string | null;
      sync_source: string | null;
      last_synced_at: string | null;
      created_at: string;
      updated_at: string;
      candidate_name: string | null;
      candidate_email: string | null;
      pipeline_title: string | null;
      stage_title: string | null;
    }>();

  const interviews = (result.results ?? []).map((r) => ({
    id: r.id,
    candidateId: r.candidate_id,
    pipelineId: r.pipeline_id,
    stageId: r.stage_id,
    interviewType: r.interview_type,
    status: r.status,
    scheduledAt: r.scheduled_at,
    meetingUrl: r.meeting_url,
    schedulingProvider: r.scheduling_provider,
    schedulingUrl: r.scheduling_url,
    recruiterNotes: r.recruiter_notes,
    syncSource: r.sync_source,
    lastSyncedAt: r.last_synced_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    candidateName: r.candidate_name,
    candidateEmail: r.candidate_email,
    pipelineTitle: r.pipeline_title,
    stageTitle: r.stage_title,
  }));

  return c.json({ interviews });
});

// POST /interviews/sync — poll Calendly for recent events and update interviews
schedulingAuth.post('/interviews/sync', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  // Get active Calendly connection
  const conn = await db
    .prepare(
      `SELECT id, access_token, provider_id, token_expiry, refresh_token
       FROM scheduling_connections
       WHERE owner_id = ? AND status = 'ACTIVE' AND provider_id = 'CALENDLY' LIMIT 1`
    )
    .bind(userId)
    .first<{ id: string; access_token: string; provider_id: string; token_expiry: string | null; refresh_token: string | null }>();

  if (!conn) {
    return apiError(c, 'NOT_FOUND', 'No active Calendly connection.');
  }

  // Refresh token if expired
  if (conn.token_expiry && new Date(conn.token_expiry) < new Date()) {
    const refreshed = await refreshToken(conn as Parameters<typeof refreshToken>[0], c.env);
    if (!refreshed) {
      return apiError(c, 'UNAUTHORIZED', 'Calendly token expired and refresh failed.');
    }
    conn.access_token = refreshed;
  }

  // Fetch current user URI
  const userRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${conn.access_token}` },
  });
  if (!userRes.ok) {
    return apiError(c, 'INTERNAL_ERROR', 'Failed to fetch Calendly user.');
  }
  const userData = await userRes.json() as { resource?: { uri?: string } };
  const userUri = userData.resource?.uri;
  if (!userUri) {
    return apiError(c, 'INTERNAL_ERROR', 'Could not resolve Calendly user URI.');
  }

  // Fetch recent scheduled events (last 30 days)
  const minDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const eventsRes = await fetch(
    `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${minDate}&status=active&count=50`,
    { headers: { Authorization: `Bearer ${conn.access_token}` } },
  );
  if (!eventsRes.ok) {
    console.error('[scheduling/sync] Failed to fetch events:', eventsRes.status);
    return apiError(c, 'INTERNAL_ERROR', 'Failed to fetch Calendly events.');
  }

  const eventsData = await eventsRes.json() as {
    collection?: Array<{
      uri: string;
      start_time: string;
      end_time: string;
      status: string;
      location?: { join_url?: string };
    }>;
  };

  const events = eventsData.collection ?? [];
  let synced = 0;
  const now = new Date().toISOString();

  // Get all INVITED interviews for this user
  const invited = await db
    .prepare(
      `SELECT si.id, si.candidate_id, c.email AS candidate_email
       FROM scheduled_interviews si
       JOIN candidates c ON c.id = si.candidate_id
       WHERE si.owner_id = ? AND si.status = 'INVITED'`
    )
    .bind(userId)
    .all<{ id: string; candidate_id: string; candidate_email: string | null }>();

  // For each event, fetch invitees and try to match to our interviews
  for (const event of events) {
    const inviteesRes = await fetch(
      `${event.uri}/invitees`,
      { headers: { Authorization: `Bearer ${conn.access_token}` } },
    );
    if (!inviteesRes.ok) continue;

    const inviteesData = await inviteesRes.json() as {
      collection?: Array<{ email: string; uri: string }>;
    };

    for (const invitee of inviteesData.collection ?? []) {
      // Match by candidate email
      const match = invited.results?.find(
        (i) => i.candidate_email?.toLowerCase() === invitee.email.toLowerCase()
      );
      if (!match) continue;

      const meetingUrl = event.location?.join_url ?? null;

      await db
        .prepare(
          `UPDATE scheduled_interviews
           SET status = 'SCHEDULED', scheduled_at = ?, meeting_url = ?,
               external_event_id = ?, scheduling_provider = 'CALENDLY',
               sync_source = 'POLL', last_synced_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(event.start_time, meetingUrl, event.uri, now, now, match.id)
        .run();

      synced++;
    }
  }

  // Update connection sync timestamp
  await db
    .prepare('UPDATE scheduling_connections SET last_sync_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, conn.id)
    .run();

  return c.json({ synced, total: events.length });
});

// POST /interviews — create scheduled interview
schedulingAuth.post('/interviews', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json();
  const parsed = createInterviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { candidateId, pipelineId, stageId, schedulingProvider, schedulingUrl } = parsed.data;

  // Ownership check
  const pipeline = await db
    .prepare('SELECT id, title FROM pipelines WHERE id = ? AND owner_id = ?')
    .bind(pipelineId, userId)
    .first<{ id: string; title: string }>();
  if (!pipeline) return apiError(c, 'NOT_FOUND', 'Pipeline not found.');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO scheduled_interviews
       (id, candidate_id, pipeline_id, stage_id, owner_id, status,
        scheduling_provider, scheduling_url, sync_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'INVITED', ?, ?, 'MANUAL', ?, ?)`
    )
    .bind(
      id, candidateId, pipelineId, stageId, userId,
      schedulingProvider ?? null, schedulingUrl ?? null,
      now, now,
    )
    .run();

  return c.json({
    interview: {
      id,
      candidateId,
      pipelineId,
      stageId,
      status: 'INVITED',
      schedulingProvider: schedulingProvider ?? null,
      schedulingUrl: schedulingUrl ?? null,
    },
  }, 201);
});

// PATCH /interviews/:id — update interview
schedulingAuth.patch('/interviews/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const interview = await db
    .prepare(
      'SELECT id, status FROM scheduled_interviews WHERE id = ? AND owner_id = ?'
    )
    .bind(id, userId)
    .first<{ id: string; status: string }>();

  if (!interview) return apiError(c, 'NOT_FOUND', 'Interview not found.');

  const body = await c.req.json();
  const parsed = updateInterviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  if (parsed.data.status && !canTransition(interview.status, parsed.data.status)) {
    return apiError(c, 'VALIDATION_ERROR',
      `Cannot transition from ${interview.status} to ${parsed.data.status}`);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (parsed.data.status) {
    updates.push('status = ?');
    values.push(parsed.data.status);
  }
  if (parsed.data.scheduledAt) {
    updates.push('scheduled_at = ?');
    values.push(parsed.data.scheduledAt);
  }
  if (parsed.data.meetingUrl) {
    updates.push('meeting_url = ?');
    values.push(parsed.data.meetingUrl);
  }
  if (parsed.data.recruiterNotes !== undefined) {
    updates.push('recruiter_notes = ?');
    values.push(parsed.data.recruiterNotes);
  }

  if (updates.length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'No fields to update.');
  }

  updates.push('sync_source = ?');
  values.push('MANUAL');
  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db
    .prepare(`UPDATE scheduled_interviews SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true });
});

// ─── Public webhook route ───────────────────────────────────────────────────

const schedulingPublic = new Hono<{ Bindings: Env }>();

// POST /webhook — receive Calendly/Cal.com webhook events
schedulingPublic.post('/webhook', async (c) => {
  const db = c.env.DB;
  const headers = Object.fromEntries(
    Object.entries(c.req.header()).map(([k, v]) => [k.toLowerCase(), v]),
  );

  // Identify provider from headers
  const isCalendly =
    'calendly-webhook-signature' in headers ||
    (headers['user-agent'] ?? '').includes('Calendly');
  const isCalCom = 'x-cal-signature-v2' in headers;

  const providerId = isCalendly ? 'CALENDLY' : isCalCom ? 'CAL_COM' : null;
  if (!providerId) {
    return c.json({ message: 'Unknown provider' }, 400);
  }

  // Find active connection for this provider
  const connection = await db
    .prepare(
      `SELECT id, owner_id, webhook_secret
       FROM scheduling_connections
       WHERE provider_id = ? AND status = 'ACTIVE'
       ORDER BY connected_at DESC LIMIT 1`
    )
    .bind(providerId)
    .first<{ id: string; owner_id: string; webhook_secret: string | null }>();

  if (!connection) {
    return c.json({ message: 'No active connection' }, 404);
  }

  // Verify HMAC signature
  const payloadStr = await c.req.text();

  if (connection.webhook_secret) {
    const sigHeader = isCalendly ? 'calendly-webhook-signature' : 'x-cal-signature-v2';
    const signature = headers[sigHeader];

    if (!signature) {
      return c.json({ message: 'Missing signature' }, 401);
    }

    const isValid = await verifyWebhookSignature(
      providerId, payloadStr, signature, connection.webhook_secret,
    );
    if (!isValid) {
      return c.json({ message: 'Invalid signature' }, 401);
    }
  }

  // Parse and normalize payload
  const payload = JSON.parse(payloadStr) as Record<string, unknown>;
  const normalized = normalizeWebhookPayload(providerId, payload);

  if (!normalized) {
    return c.json({ message: 'Could not normalize payload' }, 200);
  }

  // Find matching scheduled interview
  let interview: { id: string; status: string } | null = null;

  // Try by external event ID first
  if (normalized.externalEventId) {
    interview = await db
      .prepare(
        'SELECT id, status FROM scheduled_interviews WHERE external_event_id = ?'
      )
      .bind(normalized.externalEventId)
      .first<{ id: string; status: string }>();
  }

  // Fallback: match by candidate email
  if (!interview && normalized.candidateEmail) {
    interview = await db
      .prepare(
        `SELECT si.id, si.status
         FROM scheduled_interviews si
         JOIN candidates c ON c.id = si.candidate_id
         WHERE c.email = ? AND si.status = 'INVITED'
         ORDER BY si.created_at DESC LIMIT 1`
      )
      .bind(normalized.candidateEmail)
      .first<{ id: string; status: string }>();
  }

  if (!interview) {
    console.log('[scheduling/webhook] No matching interview', {
      externalEventId: normalized.externalEventId,
      candidateEmail: normalized.candidateEmail,
    });
    return c.json({ message: 'No matching interview' }, 200);
  }

  // Validate status transition
  if (!canTransition(interview.status, normalized.status)) {
    console.warn('[scheduling/webhook] Invalid transition', {
      from: interview.status,
      to: normalized.status,
    });
    return c.json({ message: 'Transition not allowed' }, 200);
  }

  // Update interview
  const now = new Date().toISOString();
  const updateFields = [
    'status = ?', 'sync_source = ?', 'last_synced_at = ?',
    'external_event_id = ?', 'updated_at = ?',
  ];
  const updateValues: unknown[] = [
    normalized.status, 'WEBHOOK', now,
    normalized.externalEventId, now,
  ];

  if (normalized.scheduledAt) {
    updateFields.push('scheduled_at = ?');
    updateValues.push(normalized.scheduledAt);
  }
  if (normalized.meetingUrl) {
    updateFields.push('meeting_url = ?');
    updateValues.push(normalized.meetingUrl);
  }

  updateValues.push(interview.id);

  await db
    .prepare(`UPDATE scheduled_interviews SET ${updateFields.join(', ')} WHERE id = ?`)
    .bind(...updateValues)
    .run();

  // Update connection lastSyncAt
  await db
    .prepare('UPDATE scheduling_connections SET last_sync_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, connection.id)
    .run();

  // Send email notification if interview was just scheduled
  if (normalized.status === 'SCHEDULED' && c.env.RESEND_API_KEY) {
    const interviewData = await db
      .prepare(
        `SELECT si.candidate_id, si.pipeline_id, si.stage_id,
                c.name, c.email, p.title AS pipeline_title, s.title AS stage_title,
                s.notification_templates
         FROM scheduled_interviews si
         JOIN candidates c ON c.id = si.candidate_id
         JOIN pipelines p ON p.id = si.pipeline_id
         JOIN stages s ON s.id = si.stage_id
         WHERE si.id = ?`
      )
      .bind(interview.id)
      .first<{
        candidate_id: string;
        pipeline_id: string;
        stage_id: string;
        name: string;
        email: string;
        pipeline_title: string;
        stage_title: string;
        notification_templates: string | null;
      }>();

    if (interviewData) {
      const scheduledTime = normalized.scheduledAt
        ? new Date(normalized.scheduledAt).toLocaleString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
          })
        : '';
      const meetingUrl = normalized.meetingUrl ?? '';

      // Email the candidate
      c.executionCtx.waitUntil(
        sendNotificationEmail({
          apiKey: c.env.RESEND_API_KEY,
          trigger: 'SCHEDULED',
          to: interviewData.email,
          variables: {
            name: interviewData.name,
            email: interviewData.email,
            pipelineName: interviewData.pipeline_title,
            stageName: interviewData.stage_title,
            scheduledTime,
            bookingUrl: meetingUrl,
          },
          stageTemplatesJson: interviewData.notification_templates,
        }),
      );

      // Email the recruiter
      const recruiter = await db
        .prepare('SELECT email FROM users WHERE id = ?')
        .bind(connection.owner_id)
        .first<{ email: string }>();

      // Fallback: try Clerk user metadata or scheduling connection account email
      const recruiterEmail = recruiter?.email
        ?? (await db
            .prepare('SELECT account_email FROM scheduling_connections WHERE id = ?')
            .bind(connection.id)
            .first<{ account_email: string | null }>()
          )?.account_email;

      if (recruiterEmail) {
        c.executionCtx.waitUntil(
          sendNotificationEmail({
            apiKey: c.env.RESEND_API_KEY,
            trigger: 'SCHEDULED',
            to: recruiterEmail,
            variables: {
              name: interviewData.name,
              email: interviewData.email,
              pipelineName: interviewData.pipeline_title,
              stageName: interviewData.stage_title,
              scheduledTime,
              bookingUrl: meetingUrl,
            },
            stageTemplatesJson: interviewData.notification_templates,
          }),
        );
      }
    }
  }

  console.log('[scheduling/webhook] Interview updated', {
    interviewId: interview.id,
    newStatus: normalized.status,
  });

  return c.json({ message: 'Interview updated', interviewId: interview.id });
});

// ─── Helpers: Provider API calls ────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function refreshToken(
  connection: { id: string; provider_id: string; access_token: string; refresh_token: string | null },
  env: Env,
): Promise<string | null> {
  if (!connection.refresh_token) return null;

  const config = getProviderConfig(connection.provider_id, env);
  if (!config) return null;

  const resp = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!resp.ok) {
    console.error('[scheduling] Token refresh failed', { status: resp.status });
    await env.DB
      .prepare("UPDATE scheduling_connections SET status = 'EXPIRED', updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), connection.id)
      .run();
    return null;
  }

  const tokens = await resp.json() as TokenResponse;
  const expiresIn = tokens.expires_in ?? 7200;
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  await env.DB
    .prepare(
      `UPDATE scheduling_connections
       SET access_token = ?, refresh_token = ?, token_expiry = ?, status = 'ACTIVE', updated_at = ?
       WHERE id = ?`
    )
    .bind(
      tokens.access_token,
      tokens.refresh_token ?? connection.refresh_token,
      tokenExpiry,
      new Date().toISOString(),
      connection.id,
    )
    .run();

  return tokens.access_token;
}

async function fetchCalendlyEventTypes(
  accessToken: string,
  config: ProviderOAuthConfig,
): Promise<Array<{ id: string; name: string; durationMinutes: number; url: string }>> {
  const userResp = await fetch(config.userInfoUrl!, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userResp.ok) return [];

  const userData = await userResp.json() as { resource?: { uri?: string } };
  const userUri = userData.resource?.uri;
  if (!userUri) return [];

  const resp = await fetch(
    `${config.eventTypesUrl}?user=${encodeURIComponent(userUri)}&active=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!resp.ok) return [];

  const data = await resp.json() as {
    collection?: Array<{
      uri?: string; name?: string; duration?: number; scheduling_url?: string;
    }>;
  };

  return (data.collection ?? []).map((et) => ({
    id: et.uri ?? '',
    name: et.name ?? 'Unnamed',
    durationMinutes: et.duration ?? 30,
    url: et.scheduling_url ?? '',
  }));
}

async function fetchCalComEventTypes(
  accessToken: string,
  config: ProviderOAuthConfig,
): Promise<Array<{ id: string; name: string; durationMinutes: number; url: string }>> {
  const resp = await fetch(config.eventTypesUrl!, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return [];

  const data = await resp.json() as {
    event_types?: Array<{ id?: number; title?: string; length?: number; slug?: string }>;
  };

  return (data.event_types ?? []).map((et) => ({
    id: String(et.id ?? ''),
    name: et.title ?? 'Unnamed',
    durationMinutes: et.length ?? 30,
    url: et.slug ? `https://cal.com/${et.slug}` : '',
  }));
}

async function registerProviderWebhook(
  connectionId: string,
  providerId: string,
  accessToken: string,
  webhookSecret: string,
  config: ProviderOAuthConfig,
  env: Env,
): Promise<string | null> {
  const baseUrl = env.APP_BASE_URL ?? 'https://api.pipe.build';
  const callbackUrl = `${baseUrl}/api/v1/scheduling/webhook?connectionId=${encodeURIComponent(connectionId)}`;

  if (providerId === 'CALENDLY' && config.webhookUrl) {
    const userResp = await fetch(config.userInfoUrl!, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResp.ok) return null;

    const userData = await userResp.json() as {
      resource?: { uri?: string; current_organization?: string };
    };

    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: callbackUrl,
        events: ['invitee.created', 'invitee.canceled'],
        organization: userData.resource?.current_organization,
        user: userData.resource?.uri,
        scope: 'user',
        signing_key: webhookSecret,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error('[scheduling] Calendly webhook registration failed', {
        status: resp.status, body: body.slice(0, 500),
      });
      return null;
    }

    const result = await resp.json() as { resource?: { uri?: string } };
    return result.resource?.uri ?? null;
  }

  if (providerId === 'CAL_COM' && config.webhookUrl) {
    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriberUrl: callbackUrl,
        eventTriggers: ['BOOKING_CREATED', 'BOOKING_CANCELLED', 'MEETING_ENDED'],
        active: true,
        secret: webhookSecret,
      }),
    });

    if (!resp.ok) return null;

    const result = await resp.json() as { webhook?: { id?: number } };
    return result.webhook?.id ? String(result.webhook.id) : null;
  }

  return null;
}

async function deleteProviderWebhook(
  providerId: string,
  accessToken: string,
  webhookId: string,
): Promise<void> {
  if (providerId === 'CALENDLY') {
    await fetch(webhookId, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } else if (providerId === 'CAL_COM') {
    await fetch(`https://api.cal.com/v1/webhooks/${webhookId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
}

// ─── Webhook signature verification ─────────────────────────────────────────

async function verifyWebhookSignature(
  providerId: string,
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  if (providerId === 'CALENDLY') {
    // Calendly: t=<timestamp>,v1=<hex_signature>
    const parts = signature.split(',');
    const tPart = parts.find((p) => p.startsWith('t='));
    const v1Part = parts.find((p) => p.startsWith('v1='));

    let data: string;
    let receivedSig: string;

    if (tPart && v1Part) {
      const timestamp = tPart.slice(2);
      receivedSig = v1Part.slice(3);
      data = `${timestamp}.${payload}`;
    } else {
      receivedSig = signature;
      data = payload;
    }

    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return expected === receivedSig;
  }

  if (providerId === 'CAL_COM') {
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return expected === signature;
  }

  return false;
}

// ─── Webhook payload normalization ──────────────────────────────────────────

interface NormalizedEvent {
  externalEventId: string;
  status: string;
  scheduledAt: string | null;
  meetingUrl: string | null;
  candidateEmail: string | null;
}

function normalizeWebhookPayload(
  providerId: string,
  payload: Record<string, unknown>,
): NormalizedEvent | null {
  if (providerId === 'CALENDLY') {
    const event = payload['event'] as string | undefined;
    const p = payload['payload'] as Record<string, unknown> | undefined;
    if (!p) return null;

    const scheduledEvent = p['scheduled_event'] as Record<string, unknown> | undefined;
    const location = scheduledEvent?.['location'] as Record<string, unknown> | undefined;

    return {
      externalEventId: (scheduledEvent?.['uri'] as string) ?? (p['uri'] as string) ?? '',
      status: event === 'invitee.canceled' ? 'CANCELLED' : 'SCHEDULED',
      scheduledAt: (scheduledEvent?.['start_time'] as string) ?? null,
      meetingUrl: (location?.['join_url'] as string) ?? null,
      candidateEmail: (p['email'] as string) ?? null,
    };
  }

  if (providerId === 'CAL_COM') {
    const triggerEvent = payload['triggerEvent'] as string | undefined;
    const p = payload['payload'] as Record<string, unknown> | undefined;
    if (!p) return null;

    const attendees = p['attendees'] as Array<Record<string, unknown>> | undefined;
    const firstAttendee = attendees?.[0];

    let status: string;
    switch (triggerEvent) {
      case 'BOOKING_CREATED': status = 'SCHEDULED'; break;
      case 'BOOKING_CANCELLED': status = 'CANCELLED'; break;
      case 'MEETING_ENDED': status = 'COMPLETED'; break;
      default: status = 'SCHEDULED';
    }

    return {
      externalEventId: String(p['id'] ?? ''),
      status,
      scheduledAt: (p['startTime'] as string) ?? null,
      meetingUrl: (p['metadata']as Record<string, unknown>)?.['videoCallUrl'] as string ?? null,
      candidateEmail: (firstAttendee?.['email'] as string) ?? null,
    };
  }

  return null;
}

export { schedulingAuth, schedulingPublic };
