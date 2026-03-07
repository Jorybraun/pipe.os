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

export const backend = defineBackend({
  auth,
  data,
  questionAgent,
  jobDescriptionAgent,
  scoringAgent,
  turnCredentials,
  schedulingWebhook,
  schedulingOAuth,
  devContainerLaunch,
  devContainerDestroy,
  devContainerStatus,
  ecsStatusBridge,
  notificationService,
  notificationStreamService,
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

const TABLE_NAME_PARAMS = {
  'SCHEDULINGCONNECTION': `${ssmPrefix}/tables/scheduling-connection`,
  'SCHEDULEDINTERVIEW': `${ssmPrefix}/tables/scheduled-interview`,
  'CANDIDATE': `${ssmPrefix}/tables/candidate`,
  'STAGE': `${ssmPrefix}/tables/stage`,
  'PIPELINE': `${ssmPrefix}/tables/pipeline`,
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
[candidateTable, scheduledInterviewTable, stageTable, pipelineTable, schedulingConnectionTable].forEach(t => {
  t.grantReadData(notificationStreamLambda);
});

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
ecsStatusBridgeLambda.addEnvironment('CODE_SERVER_ALB_DOMAIN', 'env.pipe.dev');

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
  // ecs:TagResource is required when passing a `tags:` array to RunTaskCommand
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
// ECS infrastructure provisioned 2026-03-06 in us-west-2 (account 642351122747).
// Not secrets — hardcoded like CODE_SERVER_ALB_DOMAIN above.
const ECS_CLUSTER_ARN = 'arn:aws:ecs:us-west-2:642351122747:cluster/pipe-dev-containers';
const ECS_TASK_DEFINITION = 'pipe-code-server:1';
const ECS_SUBNET_IDS = 'subnet-0685c349f437eab74,subnet-090c636f2ef014bca,subnet-0b8e9859485265163,subnet-0566aca6bb5e928be';
const ECS_SECURITY_GROUP_ID = 'sg-03ec946d1d7a814cf';

devContainerLaunchLambda.addEnvironment('ECS_CLUSTER_ARN', ECS_CLUSTER_ARN);
devContainerLaunchLambda.addEnvironment('ECS_TASK_DEFINITION', ECS_TASK_DEFINITION);
devContainerLaunchLambda.addEnvironment('ECS_SUBNET_IDS', ECS_SUBNET_IDS);
devContainerLaunchLambda.addEnvironment('ECS_SECURITY_GROUP_ID', ECS_SECURITY_GROUP_ID);
devContainerLaunchLambda.addEnvironment('CODE_SERVER_ALB_DOMAIN', 'env.pipe.dev');

devContainerStatusLambda.addEnvironment('ECS_CLUSTER_ARN', ECS_CLUSTER_ARN);
devContainerStatusLambda.addEnvironment('CODE_SERVER_ALB_DOMAIN', 'env.pipe.dev');
