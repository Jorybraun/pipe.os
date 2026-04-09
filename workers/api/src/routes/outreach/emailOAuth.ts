/**
 * Email OAuth routes — connect Gmail / Microsoft for send-as.
 *
 * Recruiter routes (Clerk JWT auth):
 *   POST   /api/v1/email/connect       — return OAuth authorization URL
 *   POST   /api/v1/email/callback      — exchange code for tokens
 *   GET    /api/v1/email/connection     — get active email connection
 *   DELETE /api/v1/email/connection     — disconnect provider
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { getEmailProviderConfig } from '../../lib/emailTokenRefresh';
import type { Env, Variables } from '../../types';

const emailOAuth = new Hono<{ Bindings: Env; Variables: Variables }>();
emailOAuth.use('*', authMiddleware);

// ─── Validation ─────────────────────────────────────────────────────────────

const connectSchema = z.object({
  providerId: z.enum(['GMAIL', 'MICROSOFT']),
  redirectUri: z.string().url(),
  codeChallenge: z.string().optional(),
});

const callbackSchema = z.object({
  providerId: z.enum(['GMAIL', 'MICROSOFT']),
  code: z.string().min(1),
  redirectUri: z.string().url(),
  codeVerifier: z.string().optional(),
});

// ─── POST /connect — return OAuth authorization URL ─────────────────────────

emailOAuth.post('/connect', async (c) => {
  const body = await c.req.json();
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { providerId, redirectUri, codeChallenge } = parsed.data;
  const config = getEmailProviderConfig(providerId, c.env);
  if (!config || !config.clientId) {
    return apiError(c, 'SERVICE_UNAVAILABLE', `${providerId} email integration not configured.`);
  }

  if (providerId === 'GMAIL') {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: config.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    return c.json({
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    });
  }

  if (providerId === 'MICROSOFT') {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: config.scopes.join(' '),
      response_mode: 'query',
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    return c.json({
      authUrl: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`,
    });
  }

  return apiError(c, 'VALIDATION_ERROR', `Unknown provider: ${providerId}`);
});

// ─── POST /callback — exchange code for tokens ──────────────────────────────

emailOAuth.post('/callback', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json();
  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { providerId, code, redirectUri, codeVerifier } = parsed.data;
  const config = getEmailProviderConfig(providerId, c.env);
  if (!config || !config.clientId) {
    return apiError(c, 'SERVICE_UNAVAILABLE', `${providerId} email integration not configured.`);
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
    console.error('[emailOAuth] Token exchange failed', {
      status: tokenResponse.status,
      body: errorBody.slice(0, 500),
    });
    return apiError(c, 'INTERNAL_ERROR', `Token exchange failed: ${tokenResponse.status}`);
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  // Fetch user info to get sender email + display name
  let accountEmail = '';
  let accountName = '';

  try {
    const userResp = await fetch(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (userResp.ok) {
      if (providerId === 'GMAIL') {
        const data = (await userResp.json()) as { email?: string; name?: string };
        accountEmail = data.email ?? '';
        accountName = data.name ?? '';
      } else {
        const data = (await userResp.json()) as {
          mail?: string;
          userPrincipalName?: string;
          displayName?: string;
        };
        accountEmail = data.mail ?? data.userPrincipalName ?? '';
        accountName = data.displayName ?? '';
      }
    }
  } catch (err) {
    console.warn('[emailOAuth] Failed to fetch user info', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!accountEmail) {
    return apiError(c, 'INTERNAL_ERROR', 'Could not determine account email from provider.');
  }

  const expiresIn = tokens.expires_in ?? 3600;
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
  const connectionId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Revoke any existing ACTIVE connections for this user+provider
  await db
    .prepare(
      `UPDATE email_connections SET status = 'REVOKED', updated_at = ?
       WHERE owner_id = ? AND provider_id = ? AND status = 'ACTIVE'`,
    )
    .bind(now, userId, providerId)
    .run();

  // Create new connection
  await db
    .prepare(
      `INSERT INTO email_connections
       (id, owner_id, provider_id, access_token, refresh_token, token_expiry,
        account_email, account_name, status, connected_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    )
    .bind(
      connectionId,
      userId,
      providerId,
      tokens.access_token,
      tokens.refresh_token ?? null,
      tokenExpiry,
      accountEmail,
      accountName,
      now,
      now,
      now,
    )
    .run();

  return c.json({
    connection: {
      id: connectionId,
      providerId,
      accountEmail,
      accountName,
      status: 'ACTIVE',
    },
  });
});

// ─── GET /connection — current active email connection ──────────────────────

emailOAuth.get('/connection', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const row = await db
    .prepare(
      `SELECT id, provider_id, account_email, account_name, status, connected_at
       FROM email_connections
       WHERE owner_id = ? AND status = 'ACTIVE'
       ORDER BY connected_at DESC LIMIT 1`,
    )
    .bind(userId)
    .first<{
      id: string;
      provider_id: string;
      account_email: string;
      account_name: string | null;
      status: string;
      connected_at: string;
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
    },
  });
});

// ─── DELETE /connection — disconnect email provider ─────────────────────────

emailOAuth.delete('/connection', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const row = await db
    .prepare(
      `SELECT id, provider_id, access_token
       FROM email_connections
       WHERE owner_id = ? AND status = 'ACTIVE'
       ORDER BY connected_at DESC LIMIT 1`,
    )
    .bind(userId)
    .first<{ id: string; provider_id: string; access_token: string }>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'No active email connection.');
  }

  // Best-effort token revocation
  try {
    if (row.provider_id === 'GMAIL') {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(row.access_token)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
    }
    // Microsoft has no standard revocation endpoint — just mark as revoked in D1
  } catch (err) {
    console.warn('[emailOAuth] Token revocation failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      "UPDATE email_connections SET status = 'REVOKED', updated_at = ? WHERE id = ?",
    )
    .bind(now, row.id)
    .run();

  return c.json({ success: true });
});

export { emailOAuth };
