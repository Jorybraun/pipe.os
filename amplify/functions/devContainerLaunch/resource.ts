import { defineFunction } from '@aws-amplify/backend';

/**
 * Dev Container Launch Lambda
 *
 * Spins up an AWS Fargate task running code-server (VS Code in the browser)
 * for a candidate interview session.
 *
 * Configure the following in Amplify Console → Functions → devContainerLaunch → Environment:
 *   ECS_CLUSTER_ARN        — ARN of the ECS cluster
 *   ECS_TASK_DEFINITION    — Task definition family:revision (e.g. pipe-code-server:3)
 *   ECS_SUBNET_IDS         — Comma-separated subnet IDs
 *   ECS_SECURITY_GROUP_ID  — Security group ID (allow inbound 8080)
 *   CODE_SERVER_ALB_DOMAIN — ALB domain that routes to containers (e.g. env.pipe.dev)
 */
export const devContainerLaunch = defineFunction({
  name: 'devContainerLaunch',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 30,
});
