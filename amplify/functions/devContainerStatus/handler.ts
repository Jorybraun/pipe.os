/**
 * Dev Container Status Lambda Handler
 *
 * Describes an ECS task and maps its status to the internal container
 * lifecycle. Used as a fallback when the AppSync subscription times out.
 *
 * The URL is constructed from the container's public IP + the ALB domain
 * configured via CODE_SERVER_ALB_DOMAIN.
 *
 * Required environment variables:
 *   ECS_CLUSTER_ARN        — ARN of the ECS cluster
 *   CODE_SERVER_ALB_DOMAIN — ALB domain that fronts the containers (e.g. env.pipe.dev)
 */

import {
  ECSClient,
  DescribeTasksCommand,
} from '@aws-sdk/client-ecs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type {
  DevContainerStatusRequest,
  DevContainerStatusResponse,
  DevContainerStatusError,
  ContainerLifecycleStatus,
} from './types';

const region = process.env.AWS_REGION ?? 'us-east-1';
const ecs = new ECSClient({ region });
const ssm = new SSMClient({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// Module-level cache — populated once per cold start.
let _albDomain: string | undefined;

async function getAlbDomain(): Promise<string | undefined> {
  if (_albDomain !== undefined) return _albDomain;

  const param = process.env.ALB_DOMAIN_SSM_PARAM;
  if (!param) return undefined;

  try {
    const result = await ssm.send(new GetParameterCommand({ Name: param }));
    _albDomain = result.Parameter?.Value ?? '';
    return _albDomain || undefined;
  } catch (err) {
    console.warn('[devContainerStatus] Could not read ALB domain from SSM:', err);
    return undefined;
  }
}

/**
 * Maps the raw ECS task lastStatus to our internal lifecycle status.
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

export async function handler(
  event: DevContainerStatusRequest
): Promise<DevContainerStatusResponse | DevContainerStatusError> {
  // Amplify Gen 2 direct Lambda resolvers pass the full AppSync event.
  // Query arguments are nested under event.arguments, not at the top level.
  const { taskArn } = event.arguments;

  console.log('[devContainerStatus] Checking status for task:', taskArn);

  const clusterArn = process.env.ECS_CLUSTER_ARN;
  const albDomain = await getAlbDomain();

  if (!clusterArn) {
    return {
      success: false,
      error: 'Server is not configured for dev containers. Set ECS_CLUSTER_ARN.',
      code: 'MISSING_CONFIG',
    };
  }

  try {
    const result = await ecs.send(
      new DescribeTasksCommand({
        cluster: clusterArn,
        tasks: [taskArn],
      })
    );

    const task = result.tasks?.[0];
    const failure = result.failures?.[0];

    if (failure || !task) {
      return {
        success: false,
        error: failure?.reason ?? 'Task not found',
        code: 'TASK_NOT_FOUND',
      };
    }

    const ecsStatus = task.lastStatus ?? 'UNKNOWN';
    const lifecycleStatus = mapEcsStatus(ecsStatus);

    // Query DynamoDB for the URL instead of constructing it
    let containerUrl: string | undefined;
    if (lifecycleStatus === 'READY') {
      const tableNameParam = process.env.DEVCONTAINERSESSION_TABLE_SSM;
      if (tableNameParam) {
        try {
          const paramResult = await ssm.send(new GetParameterCommand({ Name: tableNameParam }));
          const tableName = paramResult.Parameter?.Value;
          if (tableName) {
            const result = await ddb.send(new GetCommand({
              TableName: tableName,
              Key: { taskArn },
            }));
            containerUrl = result.Item?.url;
          }
        } catch (err) {
          console.warn('[devContainerStatus] Failed to query DynamoDB for URL:', err);
        }
      }
    }

    console.log('[devContainerStatus] Task status:', ecsStatus, '→', lifecycleStatus);

    return {
      status: lifecycleStatus,
      containerUrl,
      ecsStatus,
    };
  } catch (err) {
    console.error('[devContainerStatus] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      code: 'INTERNAL_ERROR',
    };
  }
}
