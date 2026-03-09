import { defineFunction } from '@aws-amplify/backend';

/**
 * Dev Container Destroy Lambda
 *
 * Stops a running AWS Fargate task (code-server container) when the
 * interview session ends or the candidate manually destroys the environment.
 *
 * Configure the following in Amplify Console → Functions → devContainerDestroy → Environment:
 *   ECS_CLUSTER_ARN — ARN of the ECS cluster
 */
export const devContainerDestroy = defineFunction({
  name: 'devContainerDestroy',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
