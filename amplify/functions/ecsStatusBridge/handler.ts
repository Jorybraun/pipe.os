/**
 * ECS Status Bridge Lambda Handler
 *
 * Receives ECS Task State Change events from EventBridge and:
 *   1. Upserts DevContainerSession in AppSync (status sync → frontend subscriptions)
 *   2. On READY (ECS RUNNING): creates an ALB target group + listener rule so the
 *      session is reachable at http://{alb-domain}/session/{id}/
 *   3. On terminal STOPPED: cleans up the ALB target group + listener rule
 *
 * Architecture:
 *   ECS Task State Change → EventBridge → this Lambda
 *     → AppSync mutation  (DevContainerSession status update → frontend subscription)
 *     → ALB API           (per-session target group + listener rule lifecycle)
 *
 * Required environment variables (injected by backend.ts):
 *   APPSYNC_ENDPOINT          — AppSync GraphQL endpoint URL
 *   APPSYNC_API_KEY           — AppSync API key
 *   ALB_DOMAIN_SSM_PARAM      — SSM param name for the ALB DNS name (read at cold start)
 *   ALB_LISTENER_ARN_SSM_PARAM — SSM param name for the HTTP listener ARN (read at cold start)
 *   VPC_ID                    — VPC ID used when creating IP-based target groups
 */

import {
  ElasticLoadBalancingV2Client,
  CreateTargetGroupCommand,
  RegisterTargetsCommand,
  CreateRuleCommand,
  DeleteRuleCommand,
  DeleteTargetGroupCommand,
  DescribeRulesCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { EcsTaskStateChangeEvent, ContainerStatus } from './types';

const region = process.env.AWS_REGION ?? 'us-east-1';
const elb = new ElasticLoadBalancingV2Client({ region });
const ssm = new SSMClient({ region });

// Module-level cache — populated once per cold start, reused on warm invocations.
// After `terraform apply` updates SSM, the next cold start picks up the new values.
let _albConfig: { domain: string; listenerArn: string } | undefined;

async function getAlbConfig(): Promise<{ domain: string; listenerArn: string }> {
  if (_albConfig) return _albConfig;

  const domainParam = process.env.ALB_DOMAIN_SSM_PARAM;
  const listenerArnParam = process.env.ALB_LISTENER_ARN_SSM_PARAM;

  if (!domainParam || !listenerArnParam) {
    throw new Error('ALB_DOMAIN_SSM_PARAM or ALB_LISTENER_ARN_SSM_PARAM env var not set');
  }

  const [domainResult, listenerResult] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: domainParam })),
    ssm.send(new GetParameterCommand({ Name: listenerArnParam })),
  ]);

  const domain = domainResult.Parameter?.Value;
  const listenerArn = listenerResult.Parameter?.Value;

  if (!domain || !listenerArn) {
    throw new Error(`SSM params not populated yet: domain=${domain}, listenerArn=${listenerArn}`);
  }

  _albConfig = { domain, listenerArn };
  console.log('[ecsStatusBridge] ALB config loaded from SSM:', { domain, listenerArn });
  return _albConfig;
}

interface AppSyncError {
  message: string;
  errorType?: string;
}

interface AppSyncResponse {
  data?: Record<string, unknown> | null;
  errors?: AppSyncError[];
}

/**
 * Calls a GraphQL operation on the AppSync endpoint using API key authentication.
 */
async function callAppSync(
  endpoint: string,
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<AppSyncResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AppSync request failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<AppSyncResponse>;
}

/**
 * Maps ECS task lastStatus to the application ContainerStatus.
 */
function mapEcsStatus(ecsStatus: string, desiredStatus: string): ContainerStatus {
  switch (ecsStatus) {
    case 'PROVISIONING':
    case 'PENDING':
      return 'PROVISIONING';
    case 'ACTIVATING':
      return 'BOOTING';
    case 'RUNNING':
      return 'READY';
    case 'DEPROVISIONING':
    case 'STOPPING':
      return 'STOPPING';
    case 'STOPPED':
      return desiredStatus === 'STOPPED' ? 'STOPPING' : 'ERROR';
    default:
      return 'BOOTING';
  }
}

/**
 * Extracts the private IPv4 address of the first container in the ECS task.
 *
 * The address is available directly in the ECS Task State Change event payload
 * under containers[].networkInterfaces[].privateIpv4Address — no extra API call needed.
 */
function extractPrivateIp(
  containers: EcsTaskStateChangeEvent['detail']['containers'],
): string | undefined {
  for (const container of containers ?? []) {
    const ip = container.networkInterfaces?.[0]?.privateIpv4Address;
    if (ip) return ip;
  }
  return undefined;
}

interface AlbResources {
  targetGroupArn: string;
  ruleArn: string;
}

/**
 * Registers an active dev-container session with the ALB:
 *   1. Creates an IP-based target group pointing at the container's port 8080
 *   2. Creates a path-pattern listener rule: /session/{id}/* → target group
 *
 * Returns the ARNs of the created resources so they can be stored for later cleanup.
 */
async function registerSessionWithAlb(
  sessionId: string,
  containerIp: string,
  vpcId: string,
  listenerArn: string,
): Promise<AlbResources> {
  // ALB target group name: 1-32 chars, [a-zA-Z0-9-] only, cannot start/end with hyphen.
  // Strip hyphens from the UUID before slicing — slicing a hyphenated UUID at a fixed
  // offset can land on a hyphen, which AWS rejects. Hex chars alone are unique enough.
  // 'pipe-s-' (7) + 25 hex chars = 32 chars max, guaranteed no trailing hyphen.
  const safeSuffix = sessionId.replace(/-/g, '').slice(0, 25);
  const tgName = `pipe-s-${safeSuffix}`;

  const tg = await elb.send(new CreateTargetGroupCommand({
    Name: tgName,
    Protocol: 'HTTP',
    Port: 8080,
    VpcId: vpcId,
    TargetType: 'ip',
    HealthCheckPath: `/session/${sessionId}/`,
    HealthCheckIntervalSeconds: 30,
    HealthyThresholdCount: 2,
    UnhealthyThresholdCount: 3,
    // Accept all 2xx/3xx/4xx responses — code-server redirects (302) unauthenticated requests
    Matcher: { HttpCode: '200-404' },
  }));

  const targetGroupArn = tg.TargetGroups?.[0]?.TargetGroupArn;
  if (!targetGroupArn) {
    throw new Error(`Failed to create target group for session ${sessionId}`);
  }

  // Register the container's private IP as the sole target
  await elb.send(new RegisterTargetsCommand({
    TargetGroupArn: targetGroupArn,
    Targets: [{ Id: containerIp, Port: 8080 }],
  }));

  // Find the next available listener rule priority (2–49999; 1 reserved for HTTP→HTTPS redirect)
  const { Rules } = await elb.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
  const usedPriorities = new Set(
    (Rules ?? [])
      .map((r) => parseInt(r.Priority ?? '', 10))
      .filter((p) => !isNaN(p)),
  );
  let priority = 2;
  while (usedPriorities.has(priority) && priority < 50000) priority++;

  const ruleResult = await elb.send(new CreateRuleCommand({
    ListenerArn: listenerArn,
    Priority: priority,
    Conditions: [
      { Field: 'path-pattern', Values: [`/session/${sessionId}/*`] },
    ],
    Actions: [
      { Type: 'forward', TargetGroupArn: targetGroupArn },
    ],
  }));

  const ruleArn = ruleResult.Rules?.[0]?.RuleArn;
  if (!ruleArn) {
    // Roll back the target group to avoid orphaned resources
    await elb.send(new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn })).catch(() => {});
    throw new Error(`Failed to create listener rule for session ${sessionId}`);
  }

  console.log('[ecsStatusBridge] ALB resources created:', {
    sessionId,
    targetGroupArn,
    ruleArn,
    priority,
  });

  return { targetGroupArn, ruleArn };
}

/**
 * Cleans up ALB resources for a stopped session.
 * The listener rule must be deleted before the target group.
 */
async function deregisterSessionFromAlb(
  targetGroupArn: string,
  ruleArn: string,
): Promise<void> {
  await elb.send(new DeleteRuleCommand({ RuleArn: ruleArn }));
  await elb.send(new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn }));
  console.log('[ecsStatusBridge] ALB resources deleted:', { targetGroupArn, ruleArn });
}

const CREATE_SESSION_MUTATION = /* GraphQL */ `
  mutation CreateDevContainerSession($input: CreateDevContainerSessionInput!) {
    createDevContainerSession(input: $input) {
      taskArn
      status
    }
  }
`;

const UPDATE_SESSION_MUTATION = /* GraphQL */ `
  mutation UpdateDevContainerSession($input: UpdateDevContainerSessionInput!) {
    updateDevContainerSession(input: $input) {
      taskArn
      status
      albTargetGroupArn
      albListenerRuleArn
    }
  }
`;

// Used on STOPPED to retrieve stored ALB ARNs for cleanup
const GET_SESSION_QUERY = /* GraphQL */ `
  query GetDevContainerSession($taskArn: String!) {
    getDevContainerSession(taskArn: $taskArn) {
      taskArn
      albTargetGroupArn
      albListenerRuleArn
    }
  }
`;

export async function handler(event: EcsTaskStateChangeEvent): Promise<void> {
  const { detail } = event;
  const { taskArn, lastStatus, desiredStatus, tags, overrides, containers } = detail;

  console.log('[ecsStatusBridge] ECS Task State Change:', {
    taskArn,
    lastStatus,
    desiredStatus,
  });

  // Extract sessionId from task tags (primary) or container env var override (fallback)
  const sessionId =
    tags?.find((t) => t.key === 'pipe:session')?.value ??
    overrides?.containerOverrides
      ?.find((o) => o.name === 'code-server')
      ?.environment?.find((e) => e.name === 'SESSION_ID')?.value;

  if (!sessionId) {
    console.warn('[ecsStatusBridge] No pipe:session tag on task, skipping:', taskArn);
    return;
  }

  const appStatus = mapEcsStatus(lastStatus, desiredStatus);
  const endpoint = process.env.APPSYNC_ENDPOINT;
  const apiKey = process.env.APPSYNC_API_KEY;

  if (!endpoint || !apiKey) {
    console.error('[ecsStatusBridge] APPSYNC_ENDPOINT or APPSYNC_API_KEY is not set');
    return;
  }

  // ── ALB REGISTRATION (READY) ─────────────────────────────────────────────
  // When the ECS task reaches RUNNING, register the container with the ALB so
  // the session is reachable at http://{alb-domain}/session/{id}/
  let albTargetGroupArn: string | undefined;
  let albListenerRuleArn: string | undefined;
  let albDomain: string | undefined;

  if (appStatus === 'READY') {
    const vpcId = process.env.VPC_ID;
    const containerIp = extractPrivateIp(containers);

    if (!vpcId) {
      console.warn('[ecsStatusBridge] VPC_ID not set — skipping ALB registration');
    } else if (!containerIp) {
      console.warn(
        '[ecsStatusBridge] No container private IP in event — skipping ALB registration for session:',
        sessionId,
      );
    } else {
      try {
        const albConfig = await getAlbConfig();
        albDomain = albConfig.domain;
        const albResult = await registerSessionWithAlb(sessionId, containerIp, vpcId, albConfig.listenerArn);
        albTargetGroupArn = albResult.targetGroupArn;
        albListenerRuleArn = albResult.ruleArn;
      } catch (err) {
        // Non-fatal: status sync continues even if ALB registration fails
        console.error('[ecsStatusBridge] ALB registration failed (non-fatal):', err);
      }
    }
  }

  // Build URL — HTTP until Route 53 + ACM HTTPS are configured (see Linear: HAS-47)
  if (!albDomain && appStatus === 'READY') {
    try {
      albDomain = (await getAlbConfig()).domain;
    } catch {
      // non-fatal — URL will be undefined
    }
  }
  const url =
    appStatus === 'READY' && albDomain
      ? `http://${albDomain}/session/${sessionId}/`
      : undefined;

  // ── APPSYNC STATUS SYNC ────────────────────────────────────────────────────
  const input: Record<string, unknown> = {
    taskArn,
    sessionId,
    status: appStatus,
  };
  if (url !== undefined) input['url'] = url;
  if (albTargetGroupArn !== undefined) input['albTargetGroupArn'] = albTargetGroupArn;
  if (albListenerRuleArn !== undefined) input['albListenerRuleArn'] = albListenerRuleArn;

  try {
    const result = await callAppSync(endpoint, apiKey, UPDATE_SESSION_MUTATION, { input });

    // DynamoDB returns "conditional request failed" when the item doesn't exist
    // yet (Amplify optimistic locking). In that case, create it instead.
    const isNotFound = result.errors?.some(
      (e) =>
        e.message.includes('not found') ||
        e.errorType?.includes('NotFound') ||
        e.message.includes('conditional request failed'),
    );

    if (isNotFound) {
      console.log('[ecsStatusBridge] Session not found, creating:', taskArn);
      await callAppSync(endpoint, apiKey, CREATE_SESSION_MUTATION, { input });
    } else if (result.errors) {
      throw new Error(result.errors[0].message);
    }

    console.log('[ecsStatusBridge] Synchronized status:', appStatus);
  } catch (err) {
    console.error('[ecsStatusBridge] Failed to sync status to AppSync:', err);
  }

  // ── ALB DEREGISTRATION (STOPPED) ─────────────────────────────────────────
  // When the ECS task stops, delete the ALB target group and listener rule that
  // were created when the task reached RUNNING. Retrieve their ARNs from DynamoDB.
  if (lastStatus === 'STOPPED') {
    try {
      const queryResult = await callAppSync(endpoint, apiKey, GET_SESSION_QUERY, { taskArn });

      // Narrow the AppSync response to the expected session shape
      const sessionRecord = queryResult.data?.['getDevContainerSession'] as {
        albTargetGroupArn?: string;
        albListenerRuleArn?: string;
      } | null | undefined;

      if (sessionRecord?.albTargetGroupArn && sessionRecord.albListenerRuleArn) {
        await deregisterSessionFromAlb(
          sessionRecord.albTargetGroupArn,
          sessionRecord.albListenerRuleArn,
        );
      } else {
        console.log('[ecsStatusBridge] No ALB resources to clean up for session:', sessionId);
      }
    } catch (err) {
      // Non-fatal: the container is already stopped; orphaned ALB resources can
      // be cleaned up manually if needed
      console.error('[ecsStatusBridge] ALB deregistration failed (non-fatal):', err);
    }
  }
}
