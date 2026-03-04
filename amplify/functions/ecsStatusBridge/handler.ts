/**
 * ECS Status Bridge Lambda Handler
 *
 * Receives ECS Task State Change events from EventBridge and publishes
 * real-time status updates to frontend clients via the AppSync
 * `publishContainerStatus` mutation (which triggers the
 * `onContainerStatusChanged` subscription).
 *
 * Architecture:
 *   ECS Task State Change → EventBridge → this Lambda → AppSync mutation
 *   → AppSync subscription → Frontend (instant update)
 *
 * Required environment variables:
 *   APPSYNC_ENDPOINT       — AppSync GraphQL endpoint URL
 *   APPSYNC_API_KEY        — AppSync API key (injected by backend.ts at deploy time)
 *   CODE_SERVER_ALB_DOMAIN — ALB domain for constructing the container URL
 */

import type { EcsTaskStateChangeEvent, ContainerStatus } from './types';

// ─── AppSync helper ──────────────────────────────────────────────────────────

type PublishStatusVariables = {
  taskArn: string;
  sessionId: string;
  status: string;
  url?: string;
};

/**
 * Calls a GraphQL mutation on the AppSync endpoint using API key authentication.
 */
async function callAppSync(
  endpoint: string,
  apiKey: string,
  query: string,
  variables: PublishStatusVariables
): Promise<void> {
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

  const result = (await response.json()) as { errors?: Array<{ message: string }> };
  if (result.errors && result.errors.length > 0) {
    throw new Error(`AppSync mutation error: ${result.errors[0].message}`);
  }
}

// ─── ECS status mapping ──────────────────────────────────────────────────────

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

// ─── GraphQL mutation ────────────────────────────────────────────────────────

const PUBLISH_STATUS_MUTATION = /* GraphQL */ `
  mutation PublishContainerStatus(
    $taskArn: String!
    $sessionId: String!
    $status: String!
    $url: String
  ) {
    publishContainerStatus(
      taskArn: $taskArn
      sessionId: $sessionId
      status: $status
      url: $url
    ) {
      taskArn
      sessionId
      status
      url
      updatedAt
    }
  }
`;

// ─── Handler ────────────────────────────────────────────────────────────────

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

  const variables: PublishStatusVariables = {
    taskArn,
    sessionId,
    status: appStatus,
  };
  if (url !== undefined) {
    variables.url = url;
  }

  try {
    await callAppSync(endpoint, apiKey, PUBLISH_STATUS_MUTATION, variables);
    console.log('[ecsStatusBridge] Published status:', appStatus, 'for session:', sessionId);
  } catch (err) {
    console.error('[ecsStatusBridge] Failed to publish status to AppSync:', err);
    // Do not rethrow — EventBridge will retry on Lambda errors, so we log and exit cleanly
  }
}

