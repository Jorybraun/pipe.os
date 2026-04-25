/**
 * Email OAuth token refresh — mirrors scheduling token refresh pattern.
 *
 * Handles automatic token refresh for Gmail and Microsoft OAuth connections
 * with a 5-minute expiry buffer. Marks connections as EXPIRED on failure.
 */

import type { Env } from '../types';

// ─── Provider config ──────────────────────────────────────────────────────────

interface EmailProviderOAuthConfig {
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

export function getEmailProviderConfig(
  providerId: string,
  env: Env,
): EmailProviderOAuthConfig | null {
  switch (providerId) {
    case 'GMAIL':
      return {
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
        clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
        scopes: [
          'https://www.googleapis.com/auth/gmail.send',
          'openid',
          'email',
          'profile',
        ],
      };
    case 'MICROSOFT':
      return {
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
        clientId: env.MICROSOFT_OAUTH_CLIENT_ID ?? '',
        clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET ?? '',
        scopes: ['Mail.Send', 'User.Read', 'offline_access'],
      };
    default:
      return null;
  }
}

// ─── Token refresh ────────────────────────────────────────────────────────────

interface EmailConnectionRow {
  id: string;
  provider_id: string;
  access_token: string;
  refresh_token: string | null;
  token_expiry: string | null;
}

/**
 * Refresh an expired email OAuth token. Updates D1 on success;
 * marks connection EXPIRED on failure.
 */
async function refreshEmailToken(
  connection: EmailConnectionRow,
  env: Env,
): Promise<string | null> {
  if (!connection.refresh_token) return null;

  const config = getEmailProviderConfig(connection.provider_id, env);
  if (!config || !config.clientId) return null;

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

  const now = new Date().toISOString();

  if (!resp.ok) {
    console.error('[emailTokenRefresh] Refresh failed', {
      connectionId: connection.id,
      status: resp.status,
    });
    await env.DB.prepare(
      "UPDATE email_connections SET status = 'EXPIRED', updated_at = ? WHERE id = ?",
    )
      .bind(now, connection.id)
      .run();
    return null;
  }

  const tokens = (await resp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const tokenExpiry = new Date(
    Date.now() + (tokens.expires_in ?? 3600) * 1000,
  ).toISOString();

  await env.DB.prepare(
    `UPDATE email_connections
     SET access_token = ?, refresh_token = ?, token_expiry = ?,
         status = 'ACTIVE', updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      tokens.access_token,
      tokens.refresh_token ?? connection.refresh_token,
      tokenExpiry,
      now,
      connection.id,
    )
    .run();

  return tokens.access_token;
}

/**
 * Get a valid access token for an email connection, refreshing if needed.
 * Uses a 5-minute buffer before expiry (same as scheduling).
 */
export async function getValidEmailToken(
  connection: EmailConnectionRow,
  env: Env,
): Promise<string | null> {
  if (connection.token_expiry) {
    const bufferMs = 5 * 60 * 1000;
    if (Date.now() >= new Date(connection.token_expiry).getTime() - bufferMs) {
      return refreshEmailToken(connection, env);
    }
  }
  return connection.access_token;
}
