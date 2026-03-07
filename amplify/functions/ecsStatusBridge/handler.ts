/**
 * ECS Status Bridge Lambda Handler
 *
 * Receives ECS Task State Change events from EventBridge and upserts the
 * DevContainerSession model in AppSync using API Key authorization.
 *
 * Architecture:
 *   ECS Task State Change → EventBridge → this Lambda → AppSync mutation
 *   → DevContainerSession model update → Frontend subscription (instant)
 *
 * Required environment variables (injected by backend.ts at deploy time):
 *   APPSYNC_ENDPOINT       — AppSync GraphQL endpoint URL (CDK token)
 *   APPSYNC_API_KEY        — AppSync API key (CDK token)
 *   CODE_SERVER_ALB_DOMAIN — ALB domain for constructing the container URL
 */

import type { EcsTaskStateChangeEvent, ContainerStatus } from './types';

type AppSyncResult = { errors?: Array<{ message: string; errorType?: string }> };

/**
 * Calls a GraphQL mutation on the AppSync endpoint using API key authentication.
 */
async function callAppSync(
  endpoint: string,
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<AppSyncResult> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AppSync request failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<AppSyncResult>;
}

/**
 * Maps ECS task lastStatus to the application ContainerStatus.
 */
function mapEcsStatus(ecsStatus: string, desiredStatus: string): ContainerStatus {
  switch (ecsStatus) {
    case 'PROVISIONING':
    case 'PENDING':
      return 'PROVISIONING';
    case 'ACTIVATING':
      return 'BOOTING';
    case 'RUNNING':
      return 'READY';
    case 'DEPROVISIONING':
    case 'STOPPING':
      return 'STOPPING';
    case 'STOPPED':
      return desiredStatus === 'STOPPED' ? 'STOPPING' : 'ERROR';
    default:
      return 'BOOTING';
  }
}

const CREATE_SESSION_MUTATION = /* GraphQL */ `
  mutation CreateDevContainerSession($input: CreateDevContainerSessionInput!) {
    createDevContainerSession(input: $input) {
      taskArn
      status
    }
  }
`;

const UPDATE_SESSION_MUTATION = /* GraphQL */ `
  mutation UpdateDevContainerSession($input: UpdateDevContainerSessionInput!) {
    updateDevContainerSession(input: $input) {
      taskArn
      status
    }
  }
`;

export async function handler(event: EcsTaskStateChangeEvent): Promise<void> {
  const { detail } = event;
  const { taskArn, lastStatus, desiredStatus, tags, overrides } = detail;

  console.log('[ecsStatusBridge] ECS Task State Change:', {
    taskArn,
    lastStatus,
    desiredStatus,
  });

  // Extract sessionId from task tags (primary) or container env var (fallback)
  const sessionId =
    tags?.find((t) => t.key === 'pipe:session')?.value ??
    overrides?.containerOverrides
      ?.find((o) => o.name === 'code-server')
      ?.environment?.find((e) => e.name === 'SESSION_ID')?.value;

  if (!sessionId) {
    console.warn(
      '[ecsStatusBridge] No pipe:session tag found on task, skipping:',
      taskArn
    );
    return;
  }

  const appStatus = mapEcsStatus(lastStatus, desiredStatus);

  const endpoint = process.env.APPSYNC_ENDPOINT;
  const apiKey = process.env.APPSYNC_API_KEY;

  if (!endpoint || !apiKey) {
    console.error('[ecsStatusBridge] APPSYNC_ENDPOINT or APPSYNC_API_KEY is not set');
    return;
  }

  // Build the container URL when the task reaches RUNNING
  let url: string | undefined;
  if (appStatus === 'READY') {
    const albDomain = process.env.CODE_SERVER_ALB_DOMAIN;
    if (albDomain) {
      url = `https://${albDomain}/session/${sessionId}/`;
    }
  }

  const input: Record<string, unknown> = {
    taskArn,
    sessionId,
    status: appStatus,
    ...(url !== undefined ? { url } : {}),
  };

  try {
    const result = await callAppSync(endpoint, apiKey, UPDATE_SESSION_MUTATION, { input });

    // DynamoDB returns "conditional request failed" (not "not found") when the
    // item doesn't exist yet and Amplify's optimistic locking condition fails.
    const isNotFound = result.errors?.some(
      (e) =>
        e.message.includes('not found') ||
        e.errorType?.includes('NotFound') ||
        e.message.includes('conditional request failed'),
    );

    if (isNotFound) {
      console.log('[ecsStatusBridge] Session not found, creating:', taskArn);
      await callAppSync(endpoint, apiKey, CREATE_SESSION_MUTATION, { input });
    } else if (result.errors) {
      throw new Error(result.errors[0].message);
    }

    console.log('[ecsStatusBridge] Synchronized status:', appStatus);
  } catch (err) {
    console.error('[ecsStatusBridge] Failed to sync status to AppSync:', err);
  }
}
