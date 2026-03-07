/**
 * Dev Container Destroy Lambda Handler
 *
 * Calls ECS.StopTask to terminate a running Fargate container.
 * Should be called when the candidate clicks "Destroy Environment" or
 * when the session timeout elapses.
 *
 * Required environment variables:
 *   ECS_CLUSTER_ARN — ARN of the ECS cluster
 */

import {
  ECSClient,
  StopTaskCommand,
} from '@aws-sdk/client-ecs';
import type {
  DevContainerDestroyRequest,
  DevContainerDestroyResponse,
  DevContainerDestroyError,
} from './types';

const region = process.env.AWS_REGION ?? 'us-east-1';
const ecs = new ECSClient({ region });

export async function handler(
  event: DevContainerDestroyRequest
): Promise<DevContainerDestroyResponse | DevContainerDestroyError> {
  // Amplify Gen 2 direct Lambda resolvers pass the full AppSync event.
  // Mutation arguments are nested under event.arguments, not at the top level.
  const { taskArn } = event.arguments;

  console.log('[devContainerDestroy] Stopping task:', taskArn);

  const clusterArn = process.env.ECS_CLUSTER_ARN;

  if (!clusterArn) {
    console.error('[devContainerDestroy] ECS_CLUSTER_ARN is not set');
    return {
      success: false,
      error: 'Server is not configured for dev containers. Set ECS_CLUSTER_ARN.',
      code: 'MISSING_CONFIG',
    };
  }

  try {
    const result = await ecs.send(
      new StopTaskCommand({
        cluster: clusterArn,
        task: taskArn,
        reason: 'Candidate destroyed environment via Pipe sandbox',
      })
    );

    const taskStatus = result.task?.lastStatus ?? 'STOPPING';

    console.log('[devContainerDestroy] Task stopped, status:', taskStatus);

    return {
      success: true,
      taskStatus,
    };
  } catch (err) {
    const isNotFound =
      err instanceof Error && err.name === 'InvalidParameterException';

    if (isNotFound) {
      return {
        success: false,
        error: `Task not found: ${taskArn}`,
        code: 'TASK_NOT_FOUND',
      };
    }

    console.error('[devContainerDestroy] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      code: 'INTERNAL_ERROR',
    };
  }
}
