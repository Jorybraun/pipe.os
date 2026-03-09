import { defineFunction } from '@aws-amplify/backend';

/**
 * ECS Status Bridge Lambda
 *
 * Triggered by EventBridge when ECS task state changes for the pipe cluster.
 * Maps ECS statuses to application statuses and publishes them via the
 * AppSync `publishContainerStatus` mutation, which triggers the
 * `onContainerStatusChanged` subscription on the frontend.
 *
 * Configure the following in Amplify Console -> Functions -> ecsStatusBridge -> Environment:
 *   APPSYNC_ENDPOINT       - AppSync GraphQL endpoint URL
 *   CODE_SERVER_ALB_DOMAIN - ALB domain that routes to containers (e.g. env.pipe.dev)
 */
export const ecsStatusBridge = defineFunction({
  name: 'ecsStatusBridge',
  entry: './handler.ts',
  resourceGroupName: 'data',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 15,
});
