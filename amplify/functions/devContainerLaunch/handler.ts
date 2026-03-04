/**
 * Dev Container Launch Lambda Handler
 *
 * Calls ECS.RunTask to spin up a Fargate container running code-server.
 * Creates a DevContainerSession record in AppSync so the client can
 * subscribe via observeQuery instead of polling getContainerStatus.
 *
 * Required environment variables:
 *   ECS_CLUSTER_ARN               — ARN of the ECS cluster
 *   ECS_TASK_DEFINITION           — Task definition family:revision (e.g. pipe-code-server:3)
 *   ECS_SUBNET_IDS                — Comma-separated list of subnet IDs for the task
 *   ECS_SECURITY_GROUP_ID         — Security group ID that allows inbound on port 8080
 *   CODE_SERVER_ALB_DOMAIN        — Domain of the ALB that routes to containers (e.g. env.pipe.dev)
 *   AMPLIFY_DATA_GRAPHQL_ENDPOINT — AppSync GraphQL endpoint (injected by amplify/backend.ts)
 */

import {
  ECSClient,
  RunTaskCommand,
  type RunTaskCommandInput,
} from '@aws-sdk/client-ecs';
import type {
  DevContainerLaunchRequest,
  DevContainerLaunchResponse,
  DevContainerLaunchError,
} from './types';
import { callAppSync } from '../devContainerEventHandler/appsyncClient';

const region = process.env.AWS_REGION ?? 'us-east-1';
const ecs = new ECSClient({ region });

export async function handler(
  event: DevContainerLaunchRequest
): Promise<DevContainerLaunchResponse | DevContainerLaunchError> {
  const { sessionId } = event;

  console.log('[devContainerLaunch] Launching container for session:', sessionId);

  // Validate required environment variables
  const clusterArn = process.env.ECS_CLUSTER_ARN;
  const taskDefinition = process.env.ECS_TASK_DEFINITION;
  const subnetIds = process.env.ECS_SUBNET_IDS;
  const securityGroupId = process.env.ECS_SECURITY_GROUP_ID;

  if (!clusterArn || !taskDefinition || !subnetIds || !securityGroupId) {
    console.error('[devContainerLaunch] Missing required environment variables', {
      clusterArn: !!clusterArn,
      taskDefinition: !!taskDefinition,
      subnetIds: !!subnetIds,
      securityGroupId: !!securityGroupId,
    });
    return {
      success: false,
      error: 'Server is not configured for dev containers. Set ECS_* environment variables.',
      code: 'MISSING_CONFIG',
    };
  }

  const input: RunTaskCommandInput = {
    cluster: clusterArn,
    taskDefinition,
    launchType: 'FARGATE',
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: subnetIds.split(',').map((s) => s.trim()),
        securityGroups: [securityGroupId],
        // Public IP required to pull the code-server image from Docker Hub
        assignPublicIp: 'ENABLED',
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: 'code-server',
          environment: [
            { name: 'SESSION_ID', value: sessionId },
            { name: 'PASSWORD', value: sessionId }, // Use sessionId as one-time password
          ],
        },
      ],
    },
    tags: [
      { key: 'pipe:session', value: sessionId },
      { key: 'pipe:purpose', value: 'dev-container' },
    ],
  };

  try {
    const result = await ecs.send(new RunTaskCommand(input));

    const task = result.tasks?.[0];
    const failure = result.failures?.[0];

    if (failure || !task?.taskArn) {
      console.error('[devContainerLaunch] ECS RunTask failure:', failure);
      return {
        success: false,
        error: failure?.reason ?? 'ECS did not return a task ARN',
        code: 'ECS_ERROR',
      };
    }

    console.log('[devContainerLaunch] Task launched:', task.taskArn);

    // Create the DevContainerSession record so the client can subscribe
    // via observeQuery instead of polling getContainerStatus.
    // We use sessionId as the record id for stable client-side lookups.
    const endpoint = process.env.AMPLIFY_DATA_GRAPHQL_ENDPOINT;
    if (endpoint) {
      const createMutation = /* GraphQL */ `
        mutation CreateDevContainerSession($input: CreateDevContainerSessionInput!) {
          createDevContainerSession(input: $input) {
            id
            sessionId
            status
          }
        }
      `;
      try {
        await callAppSync(endpoint, createMutation, {
          input: {
            id: sessionId,
            sessionId,
            taskArn: task.taskArn,
            status: 'PROVISIONING',
          },
        });
        console.log('[devContainerLaunch] DevContainerSession record created:', sessionId);
      } catch (err) {
        // Non-fatal: the session record creation failure means the client
        // subscription won't receive the initial PROVISIONING state, but
        // subsequent EventBridge-triggered updates will still be delivered.
        console.error('[devContainerLaunch] Failed to create DevContainerSession:', err);
      }
    } else {
      console.warn('[devContainerLaunch] AMPLIFY_DATA_GRAPHQL_ENDPOINT not set; skipping session record creation');
    }

    return {
      sessionId,
      taskArn: task.taskArn,
      status: 'PROVISIONING',
      launchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[devContainerLaunch] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      code: 'INTERNAL_ERROR',
    };
  }
}
