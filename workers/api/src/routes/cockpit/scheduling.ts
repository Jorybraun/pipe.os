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
 *   GET    /api/v1/scheduling/interviews/:id  — scheduled interview detail
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
import {
  LivingContextStore,
  deterministicEntityId,
  ensureCandidateLivingContext,
  ensureContactLivingContext,
  loadCandidateLivingContext,
  loadContactLivingContext,
} from '../../lib/livingContext';
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
  candidateId: z.string().min(1).optional(),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  recipientName: z.string().trim().min(1).max(200).optional(),
  recipientEmail: z.string().trim().email().optional(),
  meetingType: z.enum(['DIRECT_VIDEO_CALL', 'SCREENING_INTERVIEW']).optional(),
  interviewType: z.enum(['VIDEO', 'TECHNICAL', 'SCREENING', 'CODE_REVIEW']).optional(),
  scheduledAt: z.string().optional(),
  schedulingProvider: z.enum(['CALENDLY', 'CAL_COM', 'MANUAL']).optional(),
  schedulingUrl: z.string().optional(),
}).superRefine((value, ctx) => {
  const hasCandidate = Boolean(value.candidateId);
  const hasRecipient = Boolean(value.recipientName && value.recipientEmail);
  if (!hasCandidate && !hasRecipient) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'candidateId or recipientName plus recipientEmail is required.',
      path: ['recipientEmail'],
    });
  }
  if (!hasCandidate && (value.pipelineId || value.stageId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'pipelineId and stageId require candidateId.',
      path: ['candidateId'],
    });
  }
});

export const INTERVIEW_STATUS_VALUES = [
  'INVITED',
  'SCHEDULED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

const updateInterviewSchema = z.object({
  status: z.enum(INTERVIEW_STATUS_VALUES).optional(),
  scheduledAt: z.string().optional(),
  meetingUrl: z.string().optional(),
  recruiterNotes: z.string().optional(),
});

const inviteToCallSchema = z.object({
  email: z.string().email(),
  message: z.string().max(1000).optional(),
});

// ─── Status transition validation ───────────────────────────────────────────

export const SCHEDULED_INTERVIEW_STATUS_TRANSITIONS: Record<string, string[]> = {
  INVITED: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['ACTIVE', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  ACTIVE: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: ['INVITED'],
  NO_SHOW: ['SCHEDULED', 'CANCELLED'],
};

export function canInterviewStatusTransition(from: string, to: string): boolean {
  return SCHEDULED_INTERVIEW_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

function buildInternalVideoUrl(c: { env: Env }, interview: { id: string; stage_id: string | null; candidate_id: string | null; meeting_url: string | null }): string | null {
  if (interview.meeting_url) return interview.meeting_url;
  if (!interview.candidate_id) return null;
  const baseUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';
  const sessionStageId = interview.stage_id ?? interview.id;
  return `${baseUrl}/video/${sessionStageId}--${interview.candidate_id}`;
}

type InterviewLivingContext = Awaited<ReturnType<typeof loadCandidateLivingContext>>;

async function loadScheduledInterviewLivingContext(
  db: D1Database,
  ownerId: string,
  interview: {
    id: string;
    candidate_id: string | null;
    recipient_email: string | null;
  },
): Promise<InterviewLivingContext> {
  if (interview.candidate_id) {
    await ensureCandidateLivingContext(db, interview.candidate_id);
    return loadCandidateLivingContext(db, interview.candidate_id);
  }

  const recipientEmail = interview.recipient_email?.trim().toLowerCase();
  const recipientContact = recipientEmail
    ? await db.prepare(
      `SELECT id
         FROM contacts
        WHERE owner_id = ?1
          AND lower(email) = ?2
        ORDER BY updated_at DESC
        LIMIT 1`,
    ).bind(ownerId, recipientEmail).first<{ id: string }>()
    : null;
  const meetingContact = recipientContact
    ? null
    : await db.prepare(
      `SELECT c.id
         FROM meetings m
         JOIN meeting_participants mp ON mp.meeting_id = m.id
         JOIN contacts c ON c.id = mp.contact_id
        WHERE m.scheduled_interview_id = ?1
          AND m.owner_id = ?2
        ORDER BY mp.created_at DESC
        LIMIT 1`,
    ).bind(interview.id, ownerId).first<{ id: string }>();
  const contactId = recipientContact?.id ?? meetingContact?.id ?? null;
  if (!contactId) return null;

  await ensureContactLivingContext(db, contactId);
  return loadContactLivingContext(db, contactId);
}

async function ensureRecipientContact(
  db: D1Database,
  ownerId: string,
  recipient: { name: string; email: string },
): Promise<string> {
  const email = recipient.email.trim().toLowerCase();
  const name = recipient.name.trim();
  const existing = await db.prepare(
    `SELECT id
       FROM contacts
      WHERE owner_id = ?1
        AND lower(email) = ?2
      ORDER BY updated_at DESC
      LIMIT 1`,
  ).bind(ownerId, email).first<{ id: string }>();
  const now = new Date().toISOString();

  if (existing) {
    await db.prepare(
      `UPDATE contacts
          SET name = COALESCE(NULLIF(name, ''), ?1),
              updated_at = ?2
        WHERE id = ?3`,
    ).bind(name, now, existing.id).run();
    await ensureContactLivingContext(db, existing.id);
    return existing.id;
  }

  const contactId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO contacts (
       id, owner_id, email, name, type, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, 'lead', ?5, ?5)`,
  ).bind(contactId, ownerId, email, name, now).run();
  await ensureContactLivingContext(db, contactId);
  return contactId;
}

function lineCount(value: string): number {
  return Math.max(1, value.split('\n').length);
}

function contactFirstInterviewSourceText(input: {
  recipientName: string;
  recipientEmail: string;
  meetingType: string;
  interviewType: string;
  scheduledAt: string | null;
  schedulingProvider: string | null;
  schedulingUrl: string | null;
  createdAt: string;
}): string {
  return [
    'Contact-first interview invite',
    `Recipient name: ${input.recipientName}`,
    `Recipient email: ${input.recipientEmail}`,
    `Meeting type: ${input.meetingType}`,
    `Interview type: ${input.interviewType}`,
    `Scheduled at: ${input.scheduledAt ?? 'unscheduled'}`,
    `Scheduling provider: ${input.schedulingProvider ?? 'none'}`,
    `Scheduling URL: ${input.schedulingUrl ?? 'none'}`,
    `Created at: ${input.createdAt}`,
  ].join('\n');
}

async function persistContactFirstInterviewInviteContext(
  db: D1Database,
  input: {
    contactId: string;
    ownerId: string;
    interviewId: string;
    recipientName: string;
    recipientEmail: string;
    meetingType: string;
    interviewType: string;
    scheduledAt: string | null;
    schedulingProvider: string | null;
    schedulingUrl: string | null;
    createdAt: string;
  },
): Promise<void> {
  const identity = await ensureContactLivingContext(db, input.contactId);
  if (!identity) return;

  const store = new LivingContextStore(db, () => input.createdAt);
  const interaction = await store.upsertInteraction({
    ingestionKey: `scheduled-interview:${input.interviewId}:contact:${input.contactId}`,
    workspacePersonId: identity.workspacePersonId,
    interactionType: input.meetingType === 'DIRECT_VIDEO_CALL'
      ? 'direct_video_call'
      : 'screening_interview',
    externalReference: input.interviewId,
    startedAt: input.scheduledAt,
    metadata: {
      scheduledInterviewId: input.interviewId,
      meetingType: input.meetingType,
      interviewType: input.interviewType,
    },
  });
  const artifact = await store.upsertArtifact({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    artifactType: 'scheduled_interview_invite',
    logicalKey: `${input.interviewId}:invite`,
    metadata: {
      scheduledInterviewId: input.interviewId,
      contactId: input.contactId,
      ownerId: input.ownerId,
    },
  });
  const sourceText = contactFirstInterviewSourceText(input);
  const contentHash = await deterministicEntityId('content', sourceText);
  const version = await store.createArtifactVersion({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite:${contentHash}`,
    artifactId: artifact.id,
    versionNumber: 1,
    contentHash,
    mediaType: 'text/plain',
    contentText: sourceText,
    byteLength: new TextEncoder().encode(sourceText).byteLength,
    metadata: {
      scheduledInterviewId: input.interviewId,
      source: 'contact_first_interview_create',
    },
  });
  const span = await store.createSourceSpan({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite:${version.id}:full`,
    artifactVersionId: version.id,
    stableSegmentId: 'invite-full',
    byteStart: 0,
    byteEnd: new TextEncoder().encode(sourceText).byteLength,
    charStart: 0,
    charEnd: sourceText.length,
    lineStart: 1,
    lineEnd: lineCount(sourceText),
    exactText: sourceText,
    metadata: {
      scheduledInterviewId: input.interviewId,
      source: 'contact_first_interview_create',
    },
  });
  await store.upsertContextRecord({
    ingestionKey: `scheduled-interview:${input.interviewId}:invite-context`,
    workspacePersonId: identity.workspacePersonId,
    interactionId: interaction.id,
    recordType: 'scheduled_interview_invite',
    predicate: 'preserves contact-first interview invite',
    narrative: `Contact-first interview invite for ${input.recipientName}.`,
    qualifiers: {
      scheduledInterviewId: input.interviewId,
      contactId: input.contactId,
      meetingType: input.meetingType,
      interviewType: input.interviewType,
    },
    confidence: 1,
    extractionVersion: 'scheduled-interview-create-v1',
    observedAt: input.createdAt,
    sources: [{ sourceSpanId: span.id, evidenceRole: 'source' }],
    entities: [
      {
        entityType: 'scheduled_interview',
        entityId: input.interviewId,
        relationship: 'source_event',
      },
      {
        entityType: 'contact',
        entityId: input.contactId,
        relationship: 'participant',
      },
    ],
  });
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
      scope: 'scheduled_events:read',
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    const authUrl = `https://auth.calendly.com/oauth/authorize?${params.toString()}`;
    console.log('[scheduling] Generated Calendly auth URL:', authUrl);

    return c.json({
      authUrl,
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
      scope: 'READ_BOOKING READ_PROFILE',
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

// GET /connection/:id/event-types — list event types for a specific connection
schedulingAuth.get('/connection/:id/event-types', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;
  const { id: connectionId } = c.req.param();

  const connection = await db
    .prepare(
      `SELECT id, provider_id, access_token, token_expiry, refresh_token
       FROM scheduling_connections
       WHERE id = ? AND owner_id = ? AND status = 'ACTIVE'`
    )
    .bind(connectionId, userId)
    .first<{
      id: string;
      provider_id: string;
      access_token: string;
      token_expiry: string | null;
      refresh_token: string | null;
    }>();

  if (!connection) {
    return apiError(c, 'NOT_FOUND', 'Connection not found.');
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

  let eventTypes: Array<{ id: string; name: string; durationMinutes: number; url: string; schedulingUrl: string }> = [];

  if (connection.provider_id === 'CALENDLY') {
    try {
      const userRes = await fetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!userRes.ok) {
        return apiError(c, 'INTERNAL_ERROR', 'Failed to fetch Calendly user.');
      }
      const userData = await userRes.json() as { resource?: { uri?: string } };
      const userUri = userData.resource?.uri;
      if (!userUri) {
        return apiError(c, 'INTERNAL_ERROR', 'Could not resolve Calendly user URI.');
      }

      const etRes = await fetch(
        `https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}&active=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!etRes.ok) {
        return apiError(c, 'INTERNAL_ERROR', 'Failed to fetch Calendly event types.');
      }
      const etData = await etRes.json() as { collection?: Array<{ uri: string; name: string; duration: number; scheduling_url: string }> };
      eventTypes = (etData.collection || []).map((et) => ({
        id: et.uri,
        name: et.name,
        durationMinutes: et.duration,
        url: et.uri,
        schedulingUrl: et.scheduling_url,
      }));
    } catch (err) {
      console.error('[scheduling] Calendly event types fetch error:', err);
      return apiError(c, 'INTERNAL_ERROR', 'Failed to fetch event types.');
    }
  }

  return c.json({ eventTypes });
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

  let eventTypes: Array<{ id: string; name: string; durationMinutes: number; url: string; schedulingUrl: string }> = [];

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
              si.interview_type, si.meeting_type, si.status,
              si.scheduled_at, si.meeting_url, si.scheduling_provider,
              si.scheduling_url, si.external_event_id, si.recruiter_notes,
              si.sync_source, si.last_synced_at, si.invite_link_sent_at,
              si.email_sent_at, si.recipient_name, si.recipient_email,
              si.matched_repo_id, si.github_repo_url, si.github_pr_number,
              si.completed_at, si.created_at, si.updated_at,
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
      candidate_id: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
      interview_type: string | null;
      meeting_type: string | null;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
      external_event_id: string | null;
      recruiter_notes: string | null;
      sync_source: string | null;
      last_synced_at: string | null;
      invite_link_sent_at: string | null;
      email_sent_at: string | null;
      recipient_name: string | null;
      recipient_email: string | null;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      completed_at: string | null;
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
    meetingType: r.meeting_type,
    status: r.status,
    scheduledAt: r.scheduled_at,
    meetingUrl: buildInternalVideoUrl(c, r),
    schedulingProvider: r.scheduling_provider,
    schedulingUrl: r.scheduling_url,
    externalEventId: r.external_event_id,
    recruiterNotes: r.recruiter_notes,
    syncSource: r.sync_source,
    lastSyncedAt: r.last_synced_at,
    inviteLinkSentAt: r.invite_link_sent_at,
    emailSentAt: r.email_sent_at,
    recipientName: r.recipient_name,
    recipientEmail: r.recipient_email,
    matchedRepoId: r.matched_repo_id,
    githubRepoUrl: r.github_repo_url,
    githubPrNumber: r.github_pr_number,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    candidateName: r.candidate_name,
    candidateEmail: r.candidate_email,
    pipelineTitle: r.pipeline_title,
    stageTitle: r.stage_title,
  }));

  return c.json({ interviews });
});

// GET /interviews/:id — scheduled interview detail
schedulingAuth.get('/interviews/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const interview = await db
    .prepare(
      `SELECT si.id, si.candidate_id, si.pipeline_id, si.stage_id,
              si.interview_type, si.meeting_type, si.status,
              si.scheduled_at, si.meeting_url, si.scheduling_provider,
              si.scheduling_url, si.external_event_id, si.recruiter_notes,
              si.sync_source, si.last_synced_at, si.invite_link_sent_at,
              si.email_sent_at, si.recipient_name, si.recipient_email,
              si.matched_repo_id, si.github_repo_url, si.github_pr_number,
              si.submission_json, si.completed_at, si.created_at, si.updated_at,
              c.name AS candidate_name, c.email AS candidate_email,
              p.title AS pipeline_title,
              s.title AS stage_title
       FROM scheduled_interviews si
       LEFT JOIN candidates c ON c.id = si.candidate_id
       LEFT JOIN pipelines p ON p.id = si.pipeline_id
       LEFT JOIN stages s ON s.id = si.stage_id
       WHERE si.id = ? AND si.owner_id = ?`
    )
    .bind(id, userId)
    .first<{
      id: string;
      candidate_id: string | null;
      pipeline_id: string | null;
      stage_id: string | null;
      interview_type: string | null;
      meeting_type: string | null;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
      external_event_id: string | null;
      recruiter_notes: string | null;
      sync_source: string | null;
      last_synced_at: string | null;
      invite_link_sent_at: string | null;
      email_sent_at: string | null;
      recipient_name: string | null;
      recipient_email: string | null;
      matched_repo_id: number | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      submission_json: string | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
      candidate_name: string | null;
      candidate_email: string | null;
      pipeline_title: string | null;
      stage_title: string | null;
    }>();

  if (!interview) return apiError(c, 'NOT_FOUND', 'Interview not found.');

  const transcriptArtifact = await db
    .prepare(
      `SELECT id, scheduled_interview_id, status, transcript_json, error_message,
              created_at, updated_at
       FROM transcript_artifacts
       WHERE scheduled_interview_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .bind(id)
    .first<{
      id: string;
      scheduled_interview_id: string;
      status: string;
      transcript_json: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }>();

  const linkedMeeting = await db
    .prepare(
      `SELECT m.id, m.title, m.description, m.status, m.scheduled_at,
              m.started_at, m.ended_at, m.duration_secs, m.meeting_url,
              m.meeting_type, m.transcript_status, m.transcript_summary,
              m.recording_r2_key, m.created_at, m.updated_at,
              mr.id AS room_id, mr.session_id, mr.status AS room_status
       FROM meetings m
       LEFT JOIN meeting_rooms mr ON mr.meeting_id = m.id
       WHERE m.scheduled_interview_id = ? AND m.owner_id = ?
       ORDER BY m.created_at DESC
       LIMIT 1`
    )
    .bind(id, userId)
    .first<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      scheduled_at: string | null;
      started_at: string | null;
      ended_at: string | null;
      duration_secs: number | null;
      meeting_url: string | null;
      meeting_type: string;
      transcript_status: string;
      transcript_summary: string | null;
      recording_r2_key: string | null;
      created_at: string;
      updated_at: string;
      room_id: string | null;
      session_id: string | null;
      room_status: string | null;
    }>();

  const livingContext = await loadScheduledInterviewLivingContext(db, userId, interview);

  return c.json({
    interview: {
      id: interview.id,
      candidateId: interview.candidate_id,
      pipelineId: interview.pipeline_id,
      stageId: interview.stage_id,
      interviewType: interview.interview_type ?? 'VIDEO',
      meetingType: interview.meeting_type,
      status: interview.status,
      scheduledAt: interview.scheduled_at,
      meetingUrl: buildInternalVideoUrl(c, interview),
      schedulingProvider: interview.scheduling_provider,
      schedulingUrl: interview.scheduling_url,
      externalEventId: interview.external_event_id,
      recruiterNotes: interview.recruiter_notes,
      syncSource: interview.sync_source,
      lastSyncedAt: interview.last_synced_at,
      inviteLinkSentAt: interview.invite_link_sent_at,
      emailSentAt: interview.email_sent_at,
      recipientName: interview.recipient_name,
      recipientEmail: interview.recipient_email,
      candidateName: interview.candidate_name,
      candidateEmail: interview.candidate_email,
      pipelineTitle: interview.pipeline_title,
      stageTitle: interview.stage_title,
      matchedRepoId: interview.matched_repo_id,
      githubRepoUrl: interview.github_repo_url,
      githubPrNumber: interview.github_pr_number,
      submissionJson: interview.submission_json,
      completedAt: interview.completed_at,
      transcriptArtifact: transcriptArtifact ? {
        id: transcriptArtifact.id,
        interviewId: transcriptArtifact.scheduled_interview_id,
        status: transcriptArtifact.status,
        transcriptJson: transcriptArtifact.transcript_json,
        errorMessage: transcriptArtifact.error_message,
        createdAt: transcriptArtifact.created_at,
        updatedAt: transcriptArtifact.updated_at,
      } : null,
      linkedMeeting: linkedMeeting ? {
        id: linkedMeeting.id,
        title: linkedMeeting.title,
        description: linkedMeeting.description,
        status: linkedMeeting.status,
        scheduledAt: linkedMeeting.scheduled_at,
        startedAt: linkedMeeting.started_at,
        endedAt: linkedMeeting.ended_at,
        durationSecs: linkedMeeting.duration_secs,
        meetingUrl: linkedMeeting.meeting_url,
        meetingType: linkedMeeting.meeting_type,
        transcriptStatus: linkedMeeting.transcript_status,
        transcriptSummary: linkedMeeting.transcript_summary,
        recordingR2Key: linkedMeeting.recording_r2_key,
        room: linkedMeeting.room_id ? {
          id: linkedMeeting.room_id,
          sessionId: linkedMeeting.session_id,
          status: linkedMeeting.room_status,
        } : null,
        createdAt: linkedMeeting.created_at,
        updatedAt: linkedMeeting.updated_at,
      } : null,
      livingContext,
      createdAt: interview.created_at,
      updatedAt: interview.updated_at,
    },
  });
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
    // No scheduling provider connected — return empty sync result instead of 404.
    // The frontend calls this as a best-effort background sync.
    return c.json({ synced: 0, message: 'No active scheduling connection.' });
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

  const {
    candidateId,
    pipelineId,
    stageId,
    recipientName,
    recipientEmail,
    meetingType,
    interviewType,
    scheduledAt,
    schedulingProvider,
    schedulingUrl,
  } = parsed.data;

  let candidate: { id: string; pipeline_id: string | null } | null = null;
  if (candidateId) {
    candidate = await db
      .prepare('SELECT id, pipeline_id FROM candidates WHERE id = ? AND owner_id = ?')
      .bind(candidateId, userId)
      .first<{ id: string; pipeline_id: string | null }>();
    if (!candidate) return apiError(c, 'NOT_FOUND', 'Person not found.');
  }

  if (stageId && !pipelineId) {
    return apiError(c, 'VALIDATION_ERROR', 'stageId requires pipelineId.');
  }

  if (pipelineId) {
    if (!candidate) {
      return apiError(c, 'VALIDATION_ERROR', 'pipelineId requires candidateId.');
    }
    const pipeline = await db
      .prepare('SELECT id, title FROM pipelines WHERE id = ? AND owner_id = ?')
      .bind(pipelineId, userId)
      .first<{ id: string; title: string }>();
    if (!pipeline) return apiError(c, 'NOT_FOUND', 'Role not found.');

    if (candidate.pipeline_id && candidate.pipeline_id !== pipelineId) {
      return apiError(c, 'VALIDATION_ERROR', 'Person belongs to a different role.');
    }

    if (stageId) {
      const stage = await db
        .prepare('SELECT id FROM stages WHERE id = ? AND pipeline_id = ?')
        .bind(stageId, pipelineId)
        .first<{ id: string }>();
      if (!stage) return apiError(c, 'NOT_FOUND', 'Round not found.');
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const effectiveMeetingType = meetingType ?? (candidateId ? 'SCREENING_INTERVIEW' : 'DIRECT_VIDEO_CALL');
  const effectiveInterviewType = interviewType ?? 'VIDEO';
  const contactId = !candidateId && recipientName && recipientEmail
    ? await ensureRecipientContact(db, userId, { name: recipientName, email: recipientEmail })
    : null;

  await db
    .prepare(
      `INSERT INTO scheduled_interviews
       (id, candidate_id, pipeline_id, stage_id, owner_id, status,
        interview_type, meeting_type, scheduled_at, scheduling_provider,
        scheduling_url, recipient_name, recipient_email, sync_source,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'INVITED', ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?)`
    )
    .bind(
      id, candidateId ?? null, pipelineId ?? null, stageId ?? null, userId,
      effectiveInterviewType, effectiveMeetingType, scheduledAt ?? null,
      schedulingProvider ?? null, schedulingUrl ?? null,
      recipientName ?? null, recipientEmail?.trim().toLowerCase() ?? null,
      now, now,
    )
    .run();

  if (contactId && recipientName && recipientEmail) {
    await persistContactFirstInterviewInviteContext(db, {
      contactId,
      ownerId: userId,
      interviewId: id,
      recipientName,
      recipientEmail: recipientEmail.trim().toLowerCase(),
      meetingType: effectiveMeetingType,
      interviewType: effectiveInterviewType,
      scheduledAt: scheduledAt ?? null,
      schedulingProvider: schedulingProvider ?? null,
      schedulingUrl: schedulingUrl ?? null,
      createdAt: now,
    });
  }

  return c.json({
    interview: {
      id,
      candidateId: candidateId ?? null,
      contactId,
      pipelineId: pipelineId ?? null,
      stageId: stageId ?? null,
      recipientName: recipientName ?? null,
      recipientEmail: recipientEmail?.trim().toLowerCase() ?? null,
      meetingType: effectiveMeetingType,
      status: 'INVITED',
      interviewType: effectiveInterviewType,
      scheduledAt: scheduledAt ?? null,
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

  if (parsed.data.status && !canInterviewStatusTransition(interview.status, parsed.data.status)) {
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

// POST /interviews/:id/invite — send a video call invitation email
schedulingAuth.post('/interviews/:id/invite', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  if (!c.env.RESEND_API_KEY) {
    return apiError(c, 'SERVICE_UNAVAILABLE', 'Email service not configured.');
  }

  const body = await c.req.json();
  const parsed = inviteToCallSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { email, message: customMessage } = parsed.data;

  // Fetch interview with enriched data
  const interview = await db
    .prepare(
      `SELECT si.id, si.candidate_id, si.pipeline_id, si.stage_id, si.status,
              si.scheduled_at, si.meeting_url,
              c.name AS candidate_name, c.email AS candidate_email,
              p.title AS pipeline_title,
              s.title AS stage_title
       FROM scheduled_interviews si
       LEFT JOIN candidates c ON c.id = si.candidate_id
       LEFT JOIN pipelines p ON p.id = si.pipeline_id
       LEFT JOIN stages s ON s.id = si.stage_id
       WHERE si.id = ? AND si.owner_id = ?`
    )
    .bind(id, userId)
    .first<{
      id: string;
      candidate_id: string;
      pipeline_id: string | null;
      stage_id: string | null;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      candidate_name: string | null;
      candidate_email: string | null;
      pipeline_title: string | null;
      stage_title: string | null;
    }>();

  if (!interview) return apiError(c, 'NOT_FOUND', 'Interview not found.');

  // Build the meeting link — prefer existing meetingUrl, else generate app video link
  const baseUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';
  const meetingUrl = interview.meeting_url
    ?? `${baseUrl}/video/${interview.stage_id ?? interview.id}--${interview.candidate_id}`;

  const scheduledTime = interview.scheduled_at
    ? new Date(interview.scheduled_at).toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      })
    : null;

  const escapeHtml = (str: string): string =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const candidateName = escapeHtml(interview.candidate_name ?? email.split('@')[0] ?? 'there');
  const pipelineTitle = escapeHtml(interview.pipeline_title ?? 'Interview');
  const stageTitle = escapeHtml(interview.stage_title ?? '');
  const safeMeetingUrl = encodeURI(meetingUrl);

  // Build HTML email
  const customBlock = customMessage
    ? `<p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px; padding: 16px; background: rgba(255,255,255,0.05); border-left: 3px solid rgba(96,165,250,0.4); border-radius: 4px;">${escapeHtml(customMessage)}</p>`
    : '';

  const timeBlock = scheduledTime
    ? `<p style="font-size: 14px; margin: 0 0 8px 0;"><strong style="color: #888;">When:</strong> ${scheduledTime}</p>`
    : '';

  const html = `<div style="font-family: 'Space Mono', monospace; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0c0c0e;">
  <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 24px; color: #ffffff;">Hi ${candidateName},</h1>
  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
    You've been invited to a video call for <strong>${pipelineTitle}</strong>.
  </p>
  ${customBlock}
  <div style="padding: 20px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 32px;">
    ${stageTitle ? `<p style="font-size: 14px; margin: 0 0 8px 0;"><strong style="color: #888;">Stage:</strong> ${stageTitle}</p>` : ''}
    ${timeBlock}
    <p style="font-size: 14px; margin: 0;"><strong style="color: #888;">Link:</strong> <a href="${safeMeetingUrl}" style="color: #60a5fa;">Join Video Call</a></p>
  </div>
  <a href="${safeMeetingUrl}" style="display: inline-block; padding: 14px 32px; background: #ffffff; color: #0c0c0e; text-decoration: none; font-weight: 700; font-size: 14px; letter-spacing: 0.5px; border: none;">
    JOIN VIDEO CALL →
  </a>
  <p style="font-size: 12px; color: #666; margin-top: 40px;">
    If the button doesn't work, copy this link:<br/>
    <a href="${safeMeetingUrl}" style="color: #888;">${escapeHtml(meetingUrl)}</a>
  </p>
</div>`;

  const rawPipelineTitle = interview.pipeline_title ?? 'Interview';
  const subject = scheduledTime
    ? `Video call invitation — ${rawPipelineTitle} (${scheduledTime})`
    : `Video call invitation — ${rawPipelineTitle}`;

  // Send the email via Resend with our custom video-call HTML
  const { Resend } = await import('resend');
  const resend = new Resend(c.env.RESEND_API_KEY);
  let result: { id: string } | null = null;
  try {
    const sendResult = await resend.emails.send({
      from: 'Pipe <onboarding@resend.dev>',
      to: email,
      subject,
      html,
    });
    result = sendResult.error ? null : (sendResult.data ?? null);
  } catch (err) {
    console.error('[scheduling/invite] Email send failed:', err);
  }

  // Update the interview to track the invite
  const now = new Date().toISOString();
  if (result) {
    await db
      .prepare(
        `UPDATE scheduled_interviews
         SET invite_link_sent_at = ?, email_sent_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(now, now, now, id)
      .run();
  }

  // If the meeting URL wasn't previously set, store it
  if (!interview.meeting_url) {
    await db
      .prepare('UPDATE scheduled_interviews SET meeting_url = ?, updated_at = ? WHERE id = ?')
      .bind(meetingUrl, now, id)
      .run();
  }

  if (!result) {
    return c.json({ success: false, emailSent: false, meetingUrl }, 502);
  }

  return c.json({
    success: true,
    emailSent: true,
    meetingUrl,
  });
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
  if (!canInterviewStatusTransition(interview.status, normalized.status)) {
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
): Promise<Array<{ id: string; name: string; durationMinutes: number; url: string; schedulingUrl: string }>> {
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
    url: et.uri ?? '',
    schedulingUrl: et.scheduling_url ?? '',
  }));
}

async function fetchCalComEventTypes(
  accessToken: string,
  config: ProviderOAuthConfig,
): Promise<Array<{ id: string; name: string; durationMinutes: number; url: string; schedulingUrl: string }>> {
  const resp = await fetch(config.eventTypesUrl!, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return [];

  const data = await resp.json() as {
    event_types?: Array<{ id?: number; title?: string; length?: number; slug?: string }>;
  };

  return (data.event_types ?? []).map((et) => {
    const url = et.slug ? `https://cal.com/${et.slug}` : '';
    return {
      id: String(et.id ?? ''),
      name: et.title ?? 'Unnamed',
      durationMinutes: et.length ?? 30,
      url,
      schedulingUrl: url,
    };
  });
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
