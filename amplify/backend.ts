import { defineBackend } from '@aws-amplify/backend';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
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
});

// ─── Scheduling Permissions ──────────────────────────────────────────────────

const schedulingConnectionTable = backend.data.resources.tables['SchedulingConnection'];
const scheduledInterviewTable = backend.data.resources.tables['ScheduledInterview'];

schedulingConnectionTable.grantReadWriteData(backend.schedulingWebhook.resources.lambda);
schedulingConnectionTable.grantReadWriteData(backend.schedulingOAuth.resources.lambda);
scheduledInterviewTable.grantReadWriteData(backend.schedulingWebhook.resources.lambda);
scheduledInterviewTable.grantReadWriteData(backend.schedulingOAuth.resources.lambda);

const webhookLambda = backend.schedulingWebhook.resources.lambda as LambdaFunction;
const oauthLambda = backend.schedulingOAuth.resources.lambda as LambdaFunction;

webhookLambda.addEnvironment('SCHEDULINGCONNECTION_TABLE_NAME', schedulingConnectionTable.tableName);
webhookLambda.addEnvironment('SCHEDULEDINTERVIEW_TABLE_NAME', scheduledInterviewTable.tableName);
oauthLambda.addEnvironment('SCHEDULINGCONNECTION_TABLE_NAME', schedulingConnectionTable.tableName);
oauthLambda.addEnvironment('SCHEDULEDINTERVIEW_TABLE_NAME', scheduledInterviewTable.tableName);

// ─── ecsStatusBridge: EventBridge → AppSync ──────────────────────────────────

const ecsStatusBridgeLambda = backend.ecsStatusBridge.resources.lambda as LambdaFunction;

// Inject AppSync config directly — these are CDK tokens resolved at deploy time.
// The Lambda uses API key auth (x-api-key) since DevContainerSession is now
// authorized via allow.publicApiKey().to(['create','update']).
const graphqlEndpoint = backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl;
const apiKey = backend.data.resources.cfnResources.cfnApiKey?.attrApiKey;

ecsStatusBridgeLambda.addEnvironment('APPSYNC_ENDPOINT', graphqlEndpoint);
if (apiKey) {
  ecsStatusBridgeLambda.addEnvironment('APPSYNC_API_KEY', apiKey);
}

// Pass the ALB domain used for code-server URLs
ecsStatusBridgeLambda.addEnvironment('CODE_SERVER_ALB_DOMAIN', 'env.pipe.dev');

// EventBridge rule: catch ECS Task State Changes for all tasks.
// The Lambda handler filters for relevant tasks via tags.
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
