/**
 * Type definitions for Dev Container Status Lambda
 *
 * Polls the status of a running AWS Fargate task and resolves the
 * code-server URL once the container is ready.
 */

export interface DevContainerStatusRequest {
  /** ECS task ARN returned by devContainerLaunch */
  taskArn: string;
}

/**
 * Lifecycle status mapped from raw ECS task status.
 *
 * PROVISIONING — ECS is allocating compute resources for the task
 * BOOTING      — Container image is being pulled / runtime is starting
 * READY        — code-server is up; containerUrl is populated
 * STOPPING     — Container is shutting down (Destroy was called)
 * STOPPED      — Task is fully stopped
 */
export type ContainerLifecycleStatus =
  | 'PROVISIONING'
  | 'BOOTING'
  | 'READY'
  | 'STOPPING'
  | 'STOPPED';

export interface DevContainerStatusResponse {
  /** Mapped lifecycle status */
  status: ContainerLifecycleStatus;
  /** Public URL to the code-server iframe. Only populated when status = 'READY'. */
  containerUrl?: string;
  /** Raw ECS task status for debugging */
  ecsStatus?: string;
}

export interface DevContainerStatusError {
  success: false;
  error: string;
  code: 'MISSING_CONFIG' | 'TASK_NOT_FOUND' | 'ECS_ERROR' | 'INTERNAL_ERROR';
}
