/**
 * Type definitions for Dev Container Launch Lambda
 *
 * Handles spinning up an AWS Fargate task that runs a code-server
 * (VS Code in the browser) for a candidate interview session.
 *
 * STREAM2-011: Extended for code review challenges with optional challengeId parameter
 */

export interface DevContainerLaunchArguments {
  /** Unique identifier for this interview session */
  sessionId: string;
  /** 
   * Optional: Challenge ID for code review challenges
   * STREAM2: When provided, Lambda queries Challenge model and generates presigned S3 URL
   */
  challengeId?: string;
}

/**
 * Amplify Gen 2 direct Lambda resolvers receive the full AppSync event.
 * Mutation arguments are nested under `event.arguments`, not at the top level.
 */
export interface DevContainerLaunchRequest {
  arguments: DevContainerLaunchArguments;
  typeName: string;
  fieldName: string;
  identity: Record<string, unknown>;
  source: unknown;
  request: Record<string, unknown>;
  prev: { result: Record<string, unknown> };
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
  /** Per-session code-server password — store securely, never log */
  accessToken: string;
  
  /**
   * STREAM2: Code review challenge response fields
   * These are present only when code review challenge is launched
   */
  /** Presigned S3 URL for repository download (2-hour TTL) */
  repoUrl?: string;
  /** Git branch for the challenge (e.g., "feature/coupon-support") */
  branch?: string;
  /** Base branch for diff calculation (e.g., "main") */
  baseBranch?: string;
}

export interface DevContainerLaunchError {
  success: false;
  error: string;
  code: 'MISSING_CONFIG' | 'ECS_ERROR' | 'INTERNAL_ERROR';
}
