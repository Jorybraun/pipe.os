import { defineBackend } from '@aws-amplify/backend';
import { Function as LambdaFunction, FunctionUrlAuthType, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction as LambdaTarget } from 'aws-cdk-lib/aws-events-targets';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { questionAgent } from './functions/questionAgent/resource';
import { jobDescriptionAgent } from './functions/jobDescriptionAgent/resource';
import { scoringAgent } from './functions/scoringAgent/resource';
import { turnCredentials } from './functions/turnCredentials/resource';
import { schedulingWebhook } from './functions/schedulingWebhook/resource';
import { schedulingOAuth } from './functions/schedulingOAuth/resource';
import { devContainerLaunch } from './functions/devContainerLaunch/resource';
import { devContainerDestroy } from './functions/devContainerDestroy/resource';
import { devContainerStatus } from './functions/devContainerStatus/resource';
import { ecsStatusBridge } from './functions/ecsStatusBridge/resource';
import { notificationService } from './functions/notificationService/resource';
import { notificationStreamService } from './functions/notificationStreamService/resource';

import { getContainerLogs } from './functions/getContainerLogs/resource';
import { fetchGitHubPR } from './functions/fetchGitHubPR/resource';
import { listGitHubPRs } from './functions/listGitHubPRs/resource';
import { scoreCodeReview } from './functions/scoreCodeReview/resource';
import { submitCodeReview } from './functions/submitCodeReview/resource';

export const backend = defineBackend({
  auth,
  data,
  questionAgent,
  jobDescriptionAgent,
  scoringAgent,
  fetchGitHubPR,
  listGitHubPRs,
  scoreCodeReview,
  submitCodeReview,
  turnCredentials,
  schedulingWebhook,
  schedulingOAuth,
  devContainerLaunch,
  devContainerDestroy,
  devContainerStatus,
  ecsStatusBridge,
  notificationService,
  notificationStreamService,
  getContainerLogs,
});

// 1. DYNAMODB ACCESS & STREAM WIRING
const schedulingConnectionTable = backend.data.resources.tables['SchedulingConnection'];
const scheduledInterviewTable = backend.data.resources.tables['ScheduledInterview'];
const candidateTable = backend.data.resources.tables['Candidate'];
const stageTable = backend.data.resources.tables['Stage'];
const pipelineTable = backend.data.resources.tables['Pipeline'];

// ─── BREAK CIRCULAR DEPENDENCY: SSM FOR TABLE NAMES ──────────────────────────
// Handlers (schedulingWebhook, schedulingOAuth, notificationService) cannot 
// reference backend.data.resources directly without creating a CFN cycle.
// We store table names in SSM and read them at runtime.

// Use a literal prefix to avoid naming collisions and circular dependencies.
const ssmEnv = process.env.USER || 'default';
const ssmPrefix = `/pipe/${ssmEnv}`;

// Terraform-managed shared infrastructure always uses environment="dev" (see infra/terraform.tfvars).
// This is intentionally separate from ssmPrefix (which is per Amplify sandbox/branch).
// Lambdas that read Terraform outputs must use this prefix, not ssmPrefix.
const INFRA_SSM_PREFIX = '/pipe/dev';

const TABLE_NAME_PARAMS = {
  'SCHEDULINGCONNECTION': `${ssmPrefix}/tables/scheduling-connection`,
  'SCHEDULEDINTERVIEW': `${ssmPrefix}/tables/scheduled-interview`,
  'CANDIDATE': `${ssmPrefix}/tables/candidate`,
  'STAGE': `${ssmPrefix}/tables/stage`,
  'PIPELINE': `${ssmPrefix}/tables/pipeline`,
  'DEVCONTAINERSESSION': `${ssmPrefix}/tables/dev-container-session`,
};

new StringParameter(schedulingConnectionTable, 'SchedulingConnectionNameParam', {
  parameterName: TABLE_NAME_PARAMS.SCHEDULINGCONNECTION,
  stringValue: schedulingConnectionTable.tableName,
});
new StringParameter(scheduledInterviewTable, 'ScheduledInterviewNameParam', {
  parameterName: TABLE_NAME_PARAMS.SCHEDULEDINTERVIEW,
  stringValue: scheduledInterviewTable.tableName,
});
new StringParameter(candidateTable, 'CandidateNameParam', {
  parameterName: TABLE_NAME_PARAMS.CANDIDATE,
  stringValue: candidateTable.tableName,
});
new StringParameter(stageTable, 'StageNameParam', {
  parameterName: TABLE_NAME_PARAMS.STAGE,
  stringValue: stageTable.tableName,
});
new StringParameter(pipelineTable, 'PipelineNameParam', {
  parameterName: TABLE_NAME_PARAMS.PIPELINE,
  stringValue: pipelineTable.tableName,
});

const devContainerSessionTable = backend.data.resources.tables['DevContainerSession'];
new StringParameter(devContainerSessionTable, 'DevContainerSessionNameParam', {
  parameterName: TABLE_NAME_PARAMS.DEVCONTAINERSESSION,
  stringValue: devContainerSessionTable.tableName,
});

// ─── PERMISSIONS & ENV FOR HANDLERS (Manual to avoid CFN Ref) ────────────────
const webhookLambda = backend.schedulingWebhook.resources.lambda as unknown as LambdaFunction;
const oauthLambda = backend.schedulingOAuth.resources.lambda as unknown as LambdaFunction;
const notificationLambda = backend.notificationService.resources.lambda as unknown as LambdaFunction;

[webhookLambda, oauthLambda, notificationLambda].forEach(l => {
  // Pass SSM parameter names as plain strings (no dependency)
  l.addEnvironment('SCHEDULINGCONNECTION_TABLE_SSM', TABLE_NAME_PARAMS.SCHEDULINGCONNECTION);
  l.addEnvironment('SCHEDULEDINTERVIEW_TABLE_SSM', TABLE_NAME_PARAMS.SCHEDULEDINTERVIEW);
  l.addEnvironment('CANDIDATE_TABLE_SSM', TABLE_NAME_PARAMS.CANDIDATE);
  l.addEnvironment('STAGE_TABLE_SSM', TABLE_NAME_PARAMS.STAGE);
  l.addEnvironment('PIPELINE_TABLE_SSM', TABLE_NAME_PARAMS.PIPELINE);

  // Grant permission to read SSM parameters
  l.addToRolePolicy(new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['ssm:GetParameter'],
    resources: [`arn:aws:ssm:*:*:parameter${ssmPrefix}/*`],
  }));

  // Grant DynamoDB access via wildcard to break Data -> Function -> Data cycle
  l.addToRolePolicy(new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'dynamodb:GetItem', 
      'dynamodb:PutItem', 
      'dynamodb:UpdateItem', 
      'dynamodb:DeleteItem', 
      'dynamodb:Query', 
      'dynamodb:Scan'
    ],
    resources: ['arn:aws:dynamodb:*:*:table/*'], 
  }));
});

// ─── STREAM WIRING (notificationStreamService: NOT a handler, so Ref is OK) ───
const notificationStreamLambda = backend.notificationStreamService.resources.lambda as unknown as LambdaFunction;

// Stream service needs access to all tables it reads during background processing
notificationStreamLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
  resources: [
    candidateTable.tableArn,
    scheduledInterviewTable.tableArn,
    stageTable.tableArn,
    pipelineTable.tableArn,
    schedulingConnectionTable.tableArn,
  ],
}));

notificationStreamLambda.addEventSource(new DynamoEventSource(candidateTable, {
  startingPosition: StartingPosition.LATEST,
  retryAttempts: 3,
}));

notificationStreamLambda.addEventSource(new DynamoEventSource(scheduledInterviewTable, {
  startingPosition: StartingPosition.LATEST,
  retryAttempts: 3,
}));

// Direct environment variables are fine here as it's not a handler (no circular dep)
notificationStreamLambda.addEnvironment('CANDIDATE_TABLE_NAME', candidateTable.tableName);
notificationStreamLambda.addEnvironment('STAGE_TABLE_NAME', stageTable.tableName);
notificationStreamLambda.addEnvironment('PIPELINE_TABLE_NAME', pipelineTable.tableName);
notificationStreamLambda.addEnvironment('SCHEDULEDINTERVIEW_TABLE_NAME', scheduledInterviewTable.tableName);
notificationStreamLambda.addEnvironment('SCHEDULINGCONNECTION_TABLE_NAME', schedulingConnectionTable.tableName);

// 2. SES & COGNITO PERMISSIONS (Shared by both notification services)
const { cfnUserPool } = backend.auth.resources.cfnResources;

[notificationLambda, notificationStreamLambda].forEach(l => {
  l.addToRolePolicy(new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: ['*'],
  }));

  l.addEnvironment('USER_POOL_ID', cfnUserPool.ref);
  l.addToRolePolicy(new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['cognito-idp:AdminGetUser'],
    resources: [`arn:aws:cognito-idp:*:*:userpool/${cfnUserPool.ref}`],
  }));
});

// 3. ECS STATUS BRIDGE INTEGRATIONS
const ecsStatusBridgeLambda = backend.ecsStatusBridge.resources.lambda as unknown as LambdaFunction;
const graphqlEndpoint = backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl;
const apiKey = backend.data.resources.cfnResources.cfnApiKey?.attrApiKey;

ecsStatusBridgeLambda.addEnvironment('APPSYNC_ENDPOINT', graphqlEndpoint);
if (apiKey) {
  ecsStatusBridgeLambda.addEnvironment('APPSYNC_API_KEY', apiKey);
}
// ALB config — read from SSM at cold start so terraform apply auto-propagates values.
// Terraform writes to /pipe/dev/shared/alb/... (env=dev in terraform.tfvars).
// Must use INFRA_SSM_PREFIX, not ssmPrefix — these are shared infra, not per-sandbox.
const ALB_DOMAIN_SSM = `${INFRA_SSM_PREFIX}/shared/alb/domain`;
const ALB_LISTENER_ARN_SSM = `${INFRA_SSM_PREFIX}/shared/alb/listener-arn`;
ecsStatusBridgeLambda.addEnvironment('ALB_DOMAIN_SSM_PARAM', ALB_DOMAIN_SSM);
ecsStatusBridgeLambda.addEnvironment('ALB_LISTENER_ARN_SSM_PARAM', ALB_LISTENER_ARN_SSM);
// Default VPC in us-west-2 (used when creating IP-based ALB target groups)
ecsStatusBridgeLambda.addEnvironment('VPC_ID', 'vpc-0104c027aa8358758');

ecsStatusBridgeLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ssm:GetParameter'],
  // Needs access to both: sandbox params (ssmPrefix) and shared infra params (INFRA_SSM_PREFIX)
  resources: [
    `arn:aws:ssm:*:*:parameter${ssmPrefix}/*`,
    `arn:aws:ssm:*:*:parameter${INFRA_SSM_PREFIX}/*`,
  ],
}));

// ELB permissions: create/delete per-session target groups and listener rules
ecsStatusBridgeLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    'elasticloadbalancing:CreateTargetGroup',
    'elasticloadbalancing:DeleteTargetGroup',
    'elasticloadbalancing:RegisterTargets',
    'elasticloadbalancing:DeregisterTargets',
    'elasticloadbalancing:CreateRule',
    'elasticloadbalancing:DeleteRule',
    'elasticloadbalancing:DescribeRules',
  ],
  resources: ['*'],
}));

// DynamoDB permissions: write DevContainerSession records
ecsStatusBridgeLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
  resources: ['arn:aws:dynamodb:*:*:table/*'],
}));

// ECS permissions: describe tasks to get IP addresses
ecsStatusBridgeLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ecs:DescribeTasks'],
  resources: ['*'],
}));

// EC2 permissions: look up ENI public IP for direct container access
ecsStatusBridgeLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ec2:DescribeNetworkInterfaces'],
  resources: ['*'],
}));

const ecsStatusBridgeRule = new Rule(
  backend.ecsStatusBridge.resources.lambda.stack,
  'EcsTaskStateChangeRule',
  {
    eventPattern: {
      source: ['aws.ecs'],
      detailType: ['ECS Task State Change'],
    },
    description: 'Routes ECS Task State Change events to ecsStatusBridge',
  }
);
ecsStatusBridgeRule.addTarget(new LambdaTarget(backend.ecsStatusBridge.resources.lambda));

// 4. WEBHOOK FUNCTION URL & SSM
const webhookFunctionUrl = webhookLambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
});

const WEBHOOK_URL_SSM_PARAM = `${ssmPrefix}/scheduling/webhook-callback-url`;
new StringParameter(webhookFunctionUrl, 'WebhookCallbackUrlParam', {
  parameterName: WEBHOOK_URL_SSM_PARAM,
  stringValue: webhookFunctionUrl.url,
  description: 'Lambda Function URL for the scheduling webhook (Calendly/Cal.com)',
});

oauthLambda.addEnvironment('WEBHOOK_URL_SSM_PARAM', WEBHOOK_URL_SSM_PARAM);
oauthLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ssm:GetParameter'],
  resources: [`arn:aws:ssm:*:*:parameter${WEBHOOK_URL_SSM_PARAM}`],
}));

// 5. DEV CONTAINER PERMISSIONS
const devContainerLaunchLambda = backend.devContainerLaunch.resources.lambda as unknown as LambdaFunction;
const devContainerDestroyLambda = backend.devContainerDestroy.resources.lambda as unknown as LambdaFunction;
const devContainerStatusLambda = backend.devContainerStatus.resources.lambda as unknown as LambdaFunction;

devContainerLaunchLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ecs:RunTask', 'ecs:TagResource'],
  resources: ['*'],
}));

devContainerLaunchLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['iam:PassRole'],
  resources: ['*'],
}));

devContainerDestroyLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ecs:StopTask'],
  resources: ['*'],
}));

devContainerStatusLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ecs:DescribeTasks'],
  resources: ['*'],
}));

// ─── DEV CONTAINER ENV VARS ─────────────────────────────────────────────────
// ECS infrastructure provisioned via Terraform in us-west-2 (account 642351122747).
// Updated 2026-03-06 with latest terraform output values.
const ECS_CLUSTER_ARN = 'arn:aws:ecs:us-west-2:642351122747:cluster/pipe-dev-containers';
const ECS_TASK_DEFINITION = 'pipe-code-server'; // no revision — ECS uses latest active
const ECS_SUBNET_IDS = 'subnet-0685c349f437eab74,subnet-090c636f2ef014bca,subnet-0b8e9859485265163,subnet-0566aca6bb5e928be';
const ECS_SECURITY_GROUP_ID = 'sg-050602fd4d8e2cd4e';

devContainerLaunchLambda.addEnvironment('ECS_CLUSTER_ARN', ECS_CLUSTER_ARN);
devContainerLaunchLambda.addEnvironment('ECS_TASK_DEFINITION', ECS_TASK_DEFINITION);
devContainerLaunchLambda.addEnvironment('ECS_SUBNET_IDS', ECS_SUBNET_IDS);
devContainerLaunchLambda.addEnvironment('ECS_SECURITY_GROUP_ID', ECS_SECURITY_GROUP_ID);

devContainerDestroyLambda.addEnvironment('ECS_CLUSTER_ARN', ECS_CLUSTER_ARN);

devContainerStatusLambda.addEnvironment('ECS_CLUSTER_ARN', ECS_CLUSTER_ARN);
devContainerStatusLambda.addEnvironment('ALB_DOMAIN_SSM_PARAM', ALB_DOMAIN_SSM);
devContainerStatusLambda.addEnvironment('DEVCONTAINERSESSION_TABLE_SSM', TABLE_NAME_PARAMS.DEVCONTAINERSESSION);
devContainerStatusLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ssm:GetParameter'],
  resources: [
    `arn:aws:ssm:*:*:parameter${ssmPrefix}/*`,
    `arn:aws:ssm:*:*:parameter${INFRA_SSM_PREFIX}/*`,
  ],
}));
devContainerStatusLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['dynamodb:GetItem'],
  resources: ['arn:aws:dynamodb:*:*:table/*'],
}));

// 6. CONTAINER LOGS PERMISSIONS
// GetLogEvents requires the log-group ARN (no trailing :*) AND a log-stream ARN.
// FilterLogEvents (kept for legacy) also needs the log-group ARN without trailing :*.
// Include both patterns so IAM matches correctly regardless of ARN suffix convention.
const getContainerLogsLambda = backend.getContainerLogs.resources.lambda as unknown as LambdaFunction;

getContainerLogsLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['logs:GetLogEvents', 'logs:FilterLogEvents', 'logs:DescribeLogStreams'],
  resources: [
    // Log group ARN (required for FilterLogEvents; also needed by GetLogEvents)
    'arn:aws:logs:*:*:log-group:/pipe/dev-containers/code-server',
    // Log stream ARN wildcard (required for GetLogEvents on any stream in this group)
    'arn:aws:logs:*:*:log-group:/pipe/dev-containers/code-server:log-stream:*',
  ],
}));
