/**
 * Type definitions for the ECS Status Bridge Lambda
 *
 * This Lambda receives ECS Task State Change events from EventBridge and
 * publishes container status updates to AppSync subscribers.
 */

/**
 * ECS Task State Change event delivered by EventBridge.
 * Only the fields we use are typed here.
 */
export interface EcsTaskStateChangeEvent {
  source: 'aws.ecs';
  'detail-type': 'ECS Task State Change';
  region: string;
  detail: {
    taskArn: string;
    clusterArn: string;
    lastStatus: string;
    desiredStatus: string;
    /** Tags attached to the ECS task */
    tags?: Array<{ key: string; value: string }>;
    /** Free-form field set at RunTask time; we store sessionId here as fallback */
    startedBy?: string;
    containers?: Array<{
      name: string;
      lastStatus: string;
      networkInterfaces?: Array<{ privateIpv4Address: string }>;
    }>;
    overrides?: {
      containerOverrides?: Array<{
        name: string;
        environment?: Array<{ name: string; value: string }>;
      }>;
    };
  };
}

/**
 * Internal container lifecycle status published to AppSync subscribers.
 *
 * PROVISIONING — ECS is allocating compute resources
 * BOOTING      — Container image is being pulled / runtime is starting
 * READY        — code-server is up; url is populated
 * STOPPING     — Container is shutting down
 * ERROR        — Task stopped unexpectedly
 */
export type ContainerStatus =
  | 'PROVISIONING'
  | 'BOOTING'
  | 'READY'
  | 'STOPPING'
  | 'ERROR';
