/**
 * Dev Container Event Handler Lambda
 *
 * Triggered by ECS Task State Change events from EventBridge.
 * Translates raw ECS task statuses into the DevContainerSession lifecycle
 * and upserts the record via AppSync so clients receive real-time updates
 * through observeQuery subscriptions instead of polling.
 *
 * Required environment variables (injected via amplify/backend.ts):
 *   AMPLIFY_DATA_GRAPHQL_ENDPOINT — AppSync GraphQL endpoint
 *   CODE_SERVER_ALB_DOMAIN        — ALB domain for constructing containerUrl
 */

import type { EcsTaskStateChangeEvent, ContainerLifecycleStatus } from './types';
import { callAppSync } from './appsyncClient';

/**
 * Maps a raw ECS task lastStatus to our internal lifecycle status.
 * Mirrors the mapping in devContainerStatus/handler.ts.
 */
function mapEcsStatus(ecsStatus: string): ContainerLifecycleStatus {
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
    case 'DELETED':
      return 'STOPPED';
    default:
      return 'BOOTING';
  }
}

interface UpdateSessionResult {
  updateDevContainerSession?: { id: string; status: string } | null;
  createDevContainerSession?: { id: string; status: string } | null;
}

export async function handler(event: EcsTaskStateChangeEvent): Promise<void> {
  const { detail } = event;
  const { taskArn, lastStatus, tags, overrides } = detail;

  console.log('[devContainerEventHandler] ECS task state change:', {
    taskArn,
    lastStatus,
  });

  // Only process tasks tagged for this feature
  const purposeTag = tags?.find((t) => t.key === 'pipe:purpose')?.value;
  if (purposeTag !== 'dev-container') {
    console.log('[devContainerEventHandler] Ignoring unrelated task:', taskArn);
    return;
  }

  // Extract sessionId from task tags (set during launch)
  const sessionId =
    tags?.find((t) => t.key === 'pipe:session')?.value ??
    overrides?.containerOverrides
      ?.find((o) => o.name === 'code-server')
      ?.environment?.find((e) => e.name === 'SESSION_ID')?.value;

  if (!sessionId) {
    console.error('[devContainerEventHandler] No sessionId found on task:', taskArn);
    return;
  }

  const status = mapEcsStatus(lastStatus);

  // Construct containerUrl when the task is RUNNING (READY)
  let containerUrl: string | undefined;
  if (status === 'READY') {
    const albDomain = process.env.CODE_SERVER_ALB_DOMAIN;
    if (albDomain) {
      containerUrl = `https://${albDomain}/session/${sessionId}/`;
    }
  }

  const endpoint = process.env.AMPLIFY_DATA_GRAPHQL_ENDPOINT;
  if (!endpoint) {
    console.error('[devContainerEventHandler] AMPLIFY_DATA_GRAPHQL_ENDPOINT not set');
    return;
  }

  // The DevContainerSession record uses sessionId as its id (set at creation time).
  // Attempt to update; the record must already exist (created by devContainerLaunch).
  const updateMutation = /* GraphQL */ `
    mutation UpdateDevContainerSession($input: UpdateDevContainerSessionInput!) {
      updateDevContainerSession(input: $input) {
        id
        status
      }
    }
  `;

  const input: Record<string, unknown> = {
    id: sessionId,
    status,
    ...(containerUrl !== undefined && { containerUrl }),
  };

  try {
    await callAppSync<UpdateSessionResult>(endpoint, updateMutation, { input });
    console.log('[devContainerEventHandler] Updated session:', sessionId, '→', status);
  } catch (err) {
    console.error('[devContainerEventHandler] Failed to update session:', err);
    // Non-fatal: the session record may not exist yet if the launch Lambda hasn't finished
  }
}
