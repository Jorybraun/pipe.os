import { defineFunction } from '@aws-amplify/backend';

/**
 * Dev Container Event Handler Lambda
 *
 * Receives ECS task state change events from EventBridge and pushes
 * status updates to the DevContainerSession AppSync model.
 * This replaces client-side polling of getContainerStatus.
 *
 * Environment variables (injected by amplify/backend.ts):
 *   AMPLIFY_DATA_GRAPHQL_ENDPOINT — AppSync GraphQL endpoint URL
 *   ECS_CLUSTER_ARN               — ECS cluster ARN (for DescribeTasks)
 *   CODE_SERVER_ALB_DOMAIN        — ALB domain for constructing containerUrl
 */
export const devContainerEventHandler = defineFunction({
  name: 'devContainerEventHandler',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 30,
});
