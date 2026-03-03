/**
 * Scheduling OAuth Lambda Handler
 *
 * Handles OAuth code exchange, token refresh, event type discovery,
 * and disconnection for scheduling providers (Calendly, Cal.com).
 *
 * Follows the questionAgent pattern: handler dispatches to action functions,
 * never throws — always returns a structured response.
 */

import type {
  OAuthRequest,
  OAuthResponse,
  OAuthAction,
  OAuthParams,
  TokenResponse,
  ProviderEventType,
} from './types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import crypto from 'crypto';

// ─── DynamoDB setup ──────────────────────────────────────────────────────────

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Table names are injected by Amplify via environment variables.
// Convention: AMPLIFY_DATA_<ModelName>_TABLE
// Fallback to hardcoded names for local development.
const CONNECTION_TABLE =
  process.env['SCHEDULINGCONNECTION_TABLE_NAME'] ??
  process.env['AMPLIFY_DATA_SCHEDULINGCONNECTION_TABLE'] ??
  'SchedulingConnection';

// ─── Provider config ─────────────────────────────────────────────────────────

interface ProviderOAuthConfig {
  tokenUrl: string;
  userInfoUrl?: string;
  eventTypesUrl?: string;
  webhookUrl?: string;
  clientId: string;
  clientSecret: string;
}

function getProviderConfig(providerId: string): ProviderOAuthConfig | null {
  switch (providerId) {
    case 'CALENDLY':
      return {
        tokenUrl: 'https://auth.calendly.com/oauth/token',
        userInfoUrl: 'https://api.calendly.com/users/me',
        eventTypesUrl: 'https://api.calendly.com/event_types',
        webhookUrl: 'https://api.calendly.com/webhook_subscriptions',
        clientId: (process.env['CALENDLY_CLIENT_ID'] ?? '').trim(),
        clientSecret: (process.env['CALENDLY_CLIENT_SECRET'] ?? '').trim(),
      };
    case 'CAL_COM':
      return {
        tokenUrl: 'https://app.cal.com/api/auth/oauth/token',
        eventTypesUrl: 'https://api.cal.com/v1/event-types',
        webhookUrl: 'https://api.cal.com/v1/webhooks',
        clientId: (process.env['CALCOM_CLIENT_ID'] ?? '').trim(),
        clientSecret: (process.env['CALCOM_CLIENT_SECRET'] ?? '').trim(),
      };
    default:
      return null;
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Lambda handler entry point.
 *
 * Called via the `exchangeSchedulingOAuth` AppSync mutation.
 * Dispatches to the appropriate action handler.
 */
export async function handler(event: OAuthRequest): Promise<OAuthResponse> {
  const startTime = Date.now();

  // AppSync passes arguments as JSON — parse if stringified
  const rawAction = event.arguments?.action;
  const rawParams = event.arguments?.params;
  const action = rawAction as OAuthAction;
  const params: OAuthParams =
    typeof rawParams === 'string' ? JSON.parse(rawParams) : rawParams ?? {};

  // Extract identity from AppSync context (Cognito user pool)
  const identity = (event as unknown as Record<string, unknown>).identity as
    | { sub?: string; username?: string; claims?: Record<string, string> }
    | undefined;
  const recruiterId = identity?.sub ?? identity?.username ?? 'unknown';

  console.log('[schedulingOAuth] Starting request', {
    action,
    providerId: params?.providerId,
    recruiterId,
  });

  try {
    switch (action) {
      case 'exchange':
        return await handleExchange(params, recruiterId);

      case 'refresh':
        return await handleRefresh(params);

      case 'fetchEventTypes':
        return await handleFetchEventTypes(params);

      case 'disconnect':
        return await handleDisconnect(params);

      case 'registerWebhook':
        return await handleRegisterWebhook(params, recruiterId);

      default:
        console.warn('[schedulingOAuth] Unknown action', { action });
        return {
          success: false,
          message: `Unknown action: ${String(action)}`,
        };
    }
  } catch (error) {
    console.error('[schedulingOAuth] Fatal error', {
      action,
      error: error instanceof Error ? error.message : String(error),
      processingTime: Date.now() - startTime,
    });

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ─── B1: Exchange — OAuth code → tokens → SchedulingConnection ──────────────

async function handleExchange(
  params: OAuthParams,
  recruiterId: string,
): Promise<OAuthResponse> {
  const { code, redirectUri, providerId } = params;

  if (!code || !redirectUri || !providerId) {
    return {
      success: false,
      message: 'Missing required parameters: code, redirectUri, providerId',
    };
  }

  const config = getProviderConfig(providerId);
  if (!config) {
    return { success: false, message: `Unknown provider: ${providerId}` };
  }

  console.log('[schedulingOAuth] Exchange: requesting tokens', {
    providerId,
    redirectUri,
    clientIdLength: config.clientId.length,
    hasCodeVerifier: !!params.codeVerifier,
    codeVerifierLength: params.codeVerifier?.length ?? 0,
    tokenUrl: config.tokenUrl,
  });

  // 1. Exchange code for tokens
  // Both Calendly (OAuth 2.1 + PKCE) and Cal.com accept client credentials
  // in the POST body. Calendly explicitly requires code_verifier for PKCE.
  const tokenParams: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  };
  if (params.codeVerifier) {
    tokenParams['code_verifier'] = params.codeVerifier;
  }

  const tokenHeaders: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: tokenHeaders,
    body: new URLSearchParams(tokenParams),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    console.error('[schedulingOAuth] Token exchange failed', {
      status: tokenResponse.status,
      body: errorBody.slice(0, 500),
    });
    return {
      success: false,
      message: `Token exchange failed: ${tokenResponse.status} — ${errorBody.slice(0, 300)}`,
    };
  }

  const tokens = (await tokenResponse.json()) as TokenResponse;

  // 2. Fetch user info (optional — for display)
  let accountEmail = '';
  let accountName = '';
  if (providerId === 'CALENDLY' && config.userInfoUrl) {
    try {
      const userResp = await fetch(config.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userResp.ok) {
        const userData = (await userResp.json()) as {
          resource?: { name?: string; email?: string; uri?: string };
        };
        accountEmail = userData.resource?.email ?? '';
        accountName = userData.resource?.name ?? '';
      }
    } catch (err) {
      console.warn('[schedulingOAuth] Failed to fetch user info', { err });
    }
  }

  // 3. Generate webhook secret for HMAC verification
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  // 4. Calculate token expiry
  const expiresIn = tokens.expires_in ?? 7200; // Default 2 hours
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  // 5. Create SchedulingConnection record
  const connectionId = crypto.randomUUID();
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: CONNECTION_TABLE,
      Item: {
        id: connectionId,
        recruiterId,
        providerId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiry,
        accountEmail,
        accountName,
        webhookSecret,
        webhookId: null,
        status: 'ACTIVE',
        connectedAt: now,
        lastSyncAt: null,
        owner: recruiterId,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  console.log('[schedulingOAuth] Connection created', {
    connectionId,
    providerId,
    accountEmail,
  });

  // 6. Register webhook subscription with provider (best-effort)
  let webhookId: string | null = null;
  try {
    webhookId = await registerWebhook(
      connectionId,
      providerId,
      tokens.access_token,
      webhookSecret,
      config,
      accountEmail,
    );

    if (webhookId) {
      await ddb.send(
        new UpdateCommand({
          TableName: CONNECTION_TABLE,
          Key: { id: connectionId },
          UpdateExpression: 'SET webhookId = :wid, updatedAt = :now',
          ExpressionAttributeValues: {
            ':wid': webhookId,
            ':now': new Date().toISOString(),
          },
        }),
      );
    }
  } catch (err) {
    console.warn('[schedulingOAuth] Webhook registration failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    success: true,
    message: 'Connected successfully',
    data: {
      connectionId,
      providerId,
      accountEmail,
      accountName,
      status: 'ACTIVE',
      webhookRegistered: !!webhookId,
    },
  };
}

// ─── B2: Refresh — token refresh flow ────────────────────────────────────────

async function handleRefresh(params: OAuthParams): Promise<OAuthResponse> {
  const { connectionId } = params;

  if (!connectionId) {
    return { success: false, message: 'Missing connectionId' };
  }

  // 1. Fetch connection
  const { Item: connection } = await ddb.send(
    new GetCommand({
      TableName: CONNECTION_TABLE,
      Key: { id: connectionId },
    }),
  );

  if (!connection) {
    return { success: false, message: 'Connection not found' };
  }

  const providerId = connection['providerId'] as string;
  const refreshToken = connection['refreshToken'] as string | null;

  if (!refreshToken) {
    return { success: false, message: 'No refresh token available' };
  }

  const config = getProviderConfig(providerId);
  if (!config) {
    return { success: false, message: `Unknown provider: ${providerId}` };
  }

  // 2. Refresh the token
  const refreshResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!refreshResponse.ok) {
    const errorBody = await refreshResponse.text();
    console.error('[schedulingOAuth] Token refresh failed', {
      status: refreshResponse.status,
      body: errorBody.slice(0, 500),
    });

    // Mark connection as expired
    await ddb.send(
      new UpdateCommand({
        TableName: CONNECTION_TABLE,
        Key: { id: connectionId },
        UpdateExpression: 'SET #s = :status, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':status': 'EXPIRED',
          ':now': new Date().toISOString(),
        },
      }),
    );

    return {
      success: false,
      message: 'Token refresh failed — connection marked as expired',
    };
  }

  const tokens = (await refreshResponse.json()) as TokenResponse;
  const expiresIn = tokens.expires_in ?? 7200;
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  // 3. Update connection with new tokens
  await ddb.send(
    new UpdateCommand({
      TableName: CONNECTION_TABLE,
      Key: { id: connectionId },
      UpdateExpression:
        'SET accessToken = :at, refreshToken = :rt, tokenExpiry = :exp, #s = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':at': tokens.access_token,
        ':rt': tokens.refresh_token ?? refreshToken,
        ':exp': tokenExpiry,
        ':status': 'ACTIVE',
        ':now': new Date().toISOString(),
      },
    }),
  );

  console.log('[schedulingOAuth] Token refreshed', { connectionId, providerId });

  return {
    success: true,
    message: 'Token refreshed successfully',
    data: { tokenExpiry },
  };
}

// ─── B3: FetchEventTypes — list provider event types ─────────────────────────

async function handleFetchEventTypes(
  params: OAuthParams,
): Promise<OAuthResponse> {
  const { connectionId } = params;

  if (!connectionId) {
    return { success: false, message: 'Missing connectionId' };
  }

  // 1. Fetch connection + ensure token is valid
  const connection = await getConnectionAndRefreshIfNeeded(connectionId);
  if (!connection) {
    return { success: false, message: 'Connection not found or expired' };
  }

  const providerId = connection['providerId'] as string;
  const accessToken = connection['accessToken'] as string;
  const config = getProviderConfig(providerId);
  if (!config || !config.eventTypesUrl) {
    return { success: false, message: 'Provider does not support event types' };
  }

  // 2. Fetch event types from provider API
  let eventTypes: ProviderEventType[] = [];

  if (providerId === 'CALENDLY') {
    eventTypes = await fetchCalendlyEventTypes(accessToken, config);
  } else if (providerId === 'CAL_COM') {
    eventTypes = await fetchCalComEventTypes(accessToken, config);
  }

  console.log('[schedulingOAuth] Fetched event types', {
    connectionId,
    providerId,
    count: eventTypes.length,
  });

  return {
    success: true,
    message: `Found ${eventTypes.length} event types`,
    data: eventTypes,
  };
}

// ─── Disconnect ──────────────────────────────────────────────────────────────

async function handleDisconnect(params: OAuthParams): Promise<OAuthResponse> {
  const { connectionId } = params;

  if (!connectionId) {
    return { success: false, message: 'Missing connectionId' };
  }

  // 1. Fetch connection
  const { Item: connection } = await ddb.send(
    new GetCommand({
      TableName: CONNECTION_TABLE,
      Key: { id: connectionId },
    }),
  );

  if (!connection) {
    return { success: false, message: 'Connection not found' };
  }

  const providerId = connection['providerId'] as string;
  const accessToken = connection['accessToken'] as string;
  const webhookId = connection['webhookId'] as string | null;

  // 2. Delete webhook subscription from provider (best-effort)
  if (webhookId) {
    try {
      await deleteWebhook(providerId, accessToken, webhookId);
    } catch (err) {
      console.warn('[schedulingOAuth] Webhook deletion failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Update connection status to REVOKED
  await ddb.send(
    new UpdateCommand({
      TableName: CONNECTION_TABLE,
      Key: { id: connectionId },
      UpdateExpression: 'SET #s = :status, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':status': 'REVOKED',
        ':now': new Date().toISOString(),
      },
    }),
  );

  console.log('[schedulingOAuth] Connection disconnected', {
    connectionId,
    providerId,
  });

  return {
    success: true,
    message: 'Disconnected successfully',
  };
}

// ─── B5: RegisterWebhook — register webhook on existing connection ───────────

/**
 * Register (or re-register) a webhook subscription for an existing connection.
 * Use this when the initial registration failed (e.g. missing Function URL)
 * or to update the callback URL after infrastructure changes.
 */
async function handleRegisterWebhook(params: OAuthParams, recruiterId: string): Promise<OAuthResponse> {
  const { connectionId } = params;

  if (!connectionId) {
    return { success: false, message: 'Missing connectionId' };
  }

  const { Item: connection } = await ddb.send(
    new GetCommand({
      TableName: CONNECTION_TABLE,
      Key: { id: connectionId },
    }),
  );

  if (!connection) {
    return { success: false, message: 'Connection not found' };
  }

  // Access check
  if (connection['recruiterId'] !== recruiterId) {
    return { success: false, message: 'Access denied' };
  }

  if (connection['status'] !== 'ACTIVE') {
    return { success: false, message: `Connection is ${connection['status'] as string}, not ACTIVE` };
  }

  const providerId = connection['providerId'] as string;
  const accessToken = connection['accessToken'] as string;
  const webhookSecret = connection['webhookSecret'] as string;
  const existingWebhookId = connection['webhookId'] as string | null;
  const accountEmail = connection['accountEmail'] as string;

  const config = getProviderConfig(providerId);
  if (!config) {
    return { success: false, message: `Unknown provider: ${providerId}` };
  }

  // Delete existing webhook if present (best-effort)
  if (existingWebhookId) {
    try {
      await deleteWebhook(providerId, accessToken, existingWebhookId);
      console.log('[schedulingOAuth] Deleted stale webhook', { existingWebhookId });
    } catch (err) {
      console.warn('[schedulingOAuth] Stale webhook deletion failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Register new webhook
  const webhookId = await registerWebhook(
    connectionId,
    providerId,
    accessToken,
    webhookSecret,
    config,
    accountEmail,
  );

  if (!webhookId) {
    return { success: false, message: 'Webhook registration failed — check Lambda logs' };
  }

  // Save webhookId to connection
  await ddb.send(
    new UpdateCommand({
      TableName: CONNECTION_TABLE,
      Key: { id: connectionId },
      UpdateExpression: 'SET webhookId = :wid, updatedAt = :now',
      ExpressionAttributeValues: {
        ':wid': webhookId,
        ':now': new Date().toISOString(),
      },
    }),
  );

  console.log('[schedulingOAuth] Webhook registered', {
    connectionId,
    providerId,
    webhookId,
  });

  return {
    success: true,
    message: 'Webhook registered successfully',
    data: { webhookId },
  };
}

// ─── Helper: Get connection with auto-refresh ────────────────────────────────

async function getConnectionAndRefreshIfNeeded(
  connectionId: string,
): Promise<Record<string, unknown> | null> {
  const { Item: connection } = await ddb.send(
    new GetCommand({
      TableName: CONNECTION_TABLE,
      Key: { id: connectionId },
    }),
  );

  if (!connection) return null;
  if (connection['status'] === 'REVOKED') return null;

  // Check if token is expired or within 5 minutes of expiry
  const tokenExpiry = connection['tokenExpiry'] as string | undefined;
  if (tokenExpiry) {
    const expiryTime = new Date(tokenExpiry).getTime();
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    if (Date.now() >= expiryTime - bufferMs) {
      console.log('[schedulingOAuth] Token near expiry, refreshing', {
        connectionId,
      });

      const refreshResult = await handleRefresh({ connectionId });
      if (!refreshResult.success) {
        console.error('[schedulingOAuth] Auto-refresh failed', {
          connectionId,
        });
        return null;
      }

      // Re-fetch updated connection
      const { Item: refreshed } = await ddb.send(
        new GetCommand({
          TableName: CONNECTION_TABLE,
          Key: { id: connectionId },
        }),
      );
      return refreshed ?? null;
    }
  }

  return connection;
}

// ─── Helper: Fetch Calendly event types ──────────────────────────────────────

async function fetchCalendlyEventTypes(
  accessToken: string,
  config: ProviderOAuthConfig,
): Promise<ProviderEventType[]> {
  // First get the user URI
  const userResp = await fetch(config.userInfoUrl!, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userResp.ok) {
    console.error('[schedulingOAuth] Calendly user info failed', {
      status: userResp.status,
    });
    return [];
  }

  const userData = (await userResp.json()) as {
    resource?: { uri?: string };
  };
  const userUri = userData.resource?.uri;
  if (!userUri) return [];

  // Then fetch event types for this user
  const resp = await fetch(
    `${config.eventTypesUrl}?user=${encodeURIComponent(userUri)}&active=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!resp.ok) {
    console.error('[schedulingOAuth] Calendly event types failed', {
      status: resp.status,
    });
    return [];
  }

  const data = (await resp.json()) as {
    collection?: Array<{
      uri?: string;
      name?: string;
      duration?: number;
      scheduling_url?: string;
    }>;
  };

  return (data.collection ?? []).map((et) => ({
    id: et.uri ?? '',
    name: et.name ?? 'Unnamed',
    durationMinutes: et.duration ?? 30,
    url: et.scheduling_url ?? '',
  }));
}

// ─── Helper: Fetch Cal.com event types ───────────────────────────────────────

async function fetchCalComEventTypes(
  accessToken: string,
  config: ProviderOAuthConfig,
): Promise<ProviderEventType[]> {
  const resp = await fetch(config.eventTypesUrl!, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    console.error('[schedulingOAuth] Cal.com event types failed', {
      status: resp.status,
    });
    return [];
  }

  const data = (await resp.json()) as {
    event_types?: Array<{
      id?: number;
      title?: string;
      length?: number;
      slug?: string;
    }>;
  };

  return (data.event_types ?? []).map((et) => ({
    id: String(et.id ?? ''),
    name: et.title ?? 'Unnamed',
    durationMinutes: et.length ?? 30,
    url: et.slug ? `https://cal.com/${et.slug}` : '',
  }));
}

// ─── Helper: Register webhook with provider ──────────────────────────────────

async function registerWebhook(
  connectionId: string,
  providerId: string,
  accessToken: string,
  webhookSecret: string,
  config: ProviderOAuthConfig,
  _accountEmail: string,
): Promise<string | null> {
  // The webhook callback URL is stored in SSM Parameter Store to avoid
  // a CloudFormation circular dependency (both Lambdas are in the same stack).
  // Read it at runtime via SSM GetParameter.
  const ssmParamName = process.env['WEBHOOK_URL_SSM_PARAM'];
  if (!ssmParamName) {
    const errorMsg = '[schedulingOAuth] WEBHOOK_URL_SSM_PARAM not set. Cannot register webhook.';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  const ssmClient = new SSMClient({});
  const ssmResp = await ssmClient.send(new GetParameterCommand({ Name: ssmParamName }));
  const callbackUrlBase = ssmResp.Parameter?.Value;
  if (!callbackUrlBase) {
    const errorMsg = `[schedulingOAuth] SSM parameter ${ssmParamName} has no value. Deploy may be incomplete.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Append connectionId as a query parameter so the webhook handler
  // can find the connection directly without a ScanCommand.
  const callbackUrl = `${callbackUrlBase}?connectionId=${encodeURIComponent(connectionId)}`;

  if (providerId === 'CALENDLY') {
    // First get the user URI (organization URI for org-level webhooks)
    const userResp = await fetch(config.userInfoUrl!, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResp.ok) return null;

    const userData = (await userResp.json()) as {
      resource?: { uri?: string; current_organization?: string };
    };
    const orgUri = userData.resource?.current_organization;
    const userUri = userData.resource?.uri;

    const resp = await fetch(config.webhookUrl!, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: callbackUrl,
        events: ['invitee.created', 'invitee.canceled'],
        organization: orgUri,
        user: userUri,
        scope: 'user',
        signing_key: webhookSecret,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error('[schedulingOAuth] Calendly webhook registration failed', {
        status: resp.status,
        body: body.slice(0, 500),
      });
      return null;
    }

    const result = (await resp.json()) as {
      resource?: { uri?: string };
    };
    return result.resource?.uri ?? null;
  }

  if (providerId === 'CAL_COM') {
    const resp = await fetch(config.webhookUrl!, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriberUrl: callbackUrl,
        eventTriggers: [
          'BOOKING_CREATED',
          'BOOKING_CANCELLED',
          'MEETING_ENDED',
        ],
        active: true,
        secret: webhookSecret,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error('[schedulingOAuth] Cal.com webhook registration failed', {
        status: resp.status,
        body: body.slice(0, 500),
      });
      return null;
    }

    const result = (await resp.json()) as {
      webhook?: { id?: number };
    };
    return result.webhook?.id ? String(result.webhook.id) : null;
  }

  return null;
}

// ─── Helper: Delete webhook from provider ────────────────────────────────────

async function deleteWebhook(
  providerId: string,
  accessToken: string,
  webhookId: string,
): Promise<void> {
  if (providerId === 'CALENDLY') {
    // Calendly webhook URI is the full URL
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
