/**
 * Type definitions for the Dev Container Event Handler Lambda.
 *
 * This Lambda is triggered by ECS Task State Change events from EventBridge.
 */

/**
 * ECS Task State Change event emitted by EventBridge when an ECS task
 * transitions between lifecycle states.
 *
 * AWS EventBridge event pattern:
 *   source: ["aws.ecs"]
 *   detail-type: ["ECS Task State Change"]
 */
export interface EcsTaskStateChangeEvent {
  version: string;
  id: string;
  source: 'aws.ecs';
  account: string;
  time: string;
  region: string;
  'detail-type': 'ECS Task State Change';
  detail: {
    taskArn: string;
    clusterArn: string;
    lastStatus: string;
    desiredStatus: string;
    tags?: Array<{ key: string; value: string }>;
    overrides?: {
      containerOverrides?: Array<{
        name: string;
        environment?: Array<{ name: string; value: string }>;
      }>;
    };
    containers?: Array<{
      name: string;
      lastStatus: string;
    }>;
  };
}

/**
 * Internal lifecycle status — mirrors DevContainerSession.status enum in the schema.
 */
export type ContainerLifecycleStatus =
  | 'PROVISIONING'
  | 'BOOTING'
  | 'READY'
  | 'STOPPING'
  | 'STOPPED'
  | 'ERROR';
