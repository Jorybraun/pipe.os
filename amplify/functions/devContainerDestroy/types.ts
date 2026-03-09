/**
 * Type definitions for Dev Container Destroy Lambda
 *
 * Handles stopping a running AWS Fargate task (code-server container)
 * when the interview session ends or the candidate destroys their environment.
 */

export interface DevContainerDestroyArguments {
  /** ECS task ARN returned by devContainerLaunch */
  taskArn: string;
}

/**
 * Amplify Gen 2 direct Lambda resolvers receive the full AppSync event.
 * Mutation arguments are nested under `event.arguments`, not at the top level.
 */
export interface DevContainerDestroyRequest {
  arguments: DevContainerDestroyArguments;
  typeName: string;
  fieldName: string;
  identity: Record<string, unknown>;
  source: unknown;
  request: Record<string, unknown>;
  prev: { result: Record<string, unknown> };
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
