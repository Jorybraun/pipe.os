import { defineFunction } from '@aws-amplify/backend';

/**
 * Dev Container Status Lambda
 *
 * Describes an ECS task and maps its status to the internal container
 * lifecycle (PROVISIONING → BOOTING → READY → STOPPING → STOPPED).
 * Also resolves the code-server URL once the container is READY.
 *
 * Used as a fallback when the AppSync subscription (onContainerStatusChanged)
 * times out after 120 seconds.
 *
 * Configure the following in Amplify Console → Functions → devContainerStatus → Environment:
 *   ECS_CLUSTER_ARN        — ARN of the ECS cluster
 *   CODE_SERVER_ALB_DOMAIN — ALB domain that routes to containers (e.g. env.pipe.dev)
 */
export const devContainerStatus = defineFunction({
  name: 'devContainerStatus',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 15,
});
