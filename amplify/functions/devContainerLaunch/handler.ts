/**
 * Dev Container Launch Lambda Handler
 *
 * Calls ECS.RunTask to spin up a Fargate container running code-server.
 * Returns the task ARN immediately — status updates are pushed to the
 * frontend via AppSync subscriptions (onContainerStatusChanged).
 *
 * Required environment variables:
 *   ECS_CLUSTER_ARN        — ARN of the ECS cluster
 *   ECS_TASK_DEFINITION    — Task definition family:revision (e.g. pipe-code-server:3)
 *   ECS_SUBNET_IDS         — Comma-separated list of subnet IDs for the task
 *   ECS_SECURITY_GROUP_ID  — Security group ID that allows inbound on port 8080
 *   CODE_SERVER_ALB_DOMAIN — Domain of the ALB that routes to containers (e.g. env.pipe.dev)
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

const region = process.env.AWS_REGION ?? 'us-east-1';
const ecs = new ECSClient({ region });

export async function handler(
  event: DevContainerLaunchRequest
): Promise<DevContainerLaunchResponse | DevContainerLaunchError> {
  // Amplify Gen 2 direct Lambda resolvers pass the full AppSync event.
  // Mutation arguments are nested under event.arguments, not at the top level.
  const { sessionId } = event.arguments;

  console.log('[devContainerLaunch] Launching container for session:', sessionId);

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
        assignPublicIp: 'ENABLED',
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: 'code-server',
          // Override the container command so code-server serves at the ALB sub-path.
          // Without --base-path, code-server loads assets from / and breaks when
          // accessed via /session/{id}/* through the ALB path-based routing rule.
          command: [
            '--bind-addr', '0.0.0.0:8080',
            '--auth', 'password',
            '--base-path', `/session/${sessionId}`,
          ],
          environment: [
            { name: 'SESSION_ID', value: sessionId },
            { name: 'PASSWORD', value: sessionId },
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
