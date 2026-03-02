/**
 * Type definitions for Dev Container Destroy Lambda
 *
 * Handles stopping a running AWS Fargate task (code-server container)
 * when the interview session ends or the candidate destroys their environment.
 */

export interface DevContainerDestroyRequest {
  /** ECS task ARN returned by devContainerLaunch */
  taskArn: string;
}

export interface DevContainerDestroyResponse {
  success: true;
  /** Final task status after stop request */
  taskStatus: string;
}

export interface DevContainerDestroyError {
  success: false;
  error: string;
  code: 'MISSING_CONFIG' | 'TASK_NOT_FOUND' | 'ECS_ERROR' | 'INTERNAL_ERROR';
}
