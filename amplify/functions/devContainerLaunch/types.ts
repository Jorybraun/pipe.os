/**
 * Type definitions for Dev Container Launch Lambda
 *
 * Handles spinning up an AWS Fargate task that runs a code-server
 * (VS Code in the browser) for a candidate interview session.
 */

export interface DevContainerLaunchRequest {
  /** Unique identifier for this interview session */
  sessionId: string;
}

export interface DevContainerLaunchResponse {
  /** Session ID echoed back for client correlation */
  sessionId: string;
  /** ECS task ARN — use this to poll status and destroy the container */
  taskArn: string;
  /** Initial status immediately after RunTask call */
  status: 'PROVISIONING';
  /** ISO timestamp of when the task was launched */
  launchedAt: string;
}

export interface DevContainerLaunchError {
  success: false;
  error: string;
  code: 'MISSING_CONFIG' | 'ECS_ERROR' | 'INTERNAL_ERROR';
}
