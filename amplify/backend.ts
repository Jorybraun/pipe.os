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

// Grant scheduling Lambdas direct DynamoDB access to SchedulingConnection
// and ScheduledInterview tables (allow.resource() isn't available on model auth)
const schedulingConnectionTable = backend.data.resources.tables['SchedulingConnection'];
const scheduledInterviewTable = backend.data.resources.tables['ScheduledInterview'];

schedulingConnectionTable.grantReadWriteData(backend.schedulingWebhook.resources.lambda);
schedulingConnectionTable.grantReadWriteData(backend.schedulingOAuth.resources.lambda);
scheduledInterviewTable.grantReadWriteData(backend.schedulingWebhook.resources.lambda);
scheduledInterviewTable.grantReadWriteData(backend.schedulingOAuth.resources.lambda);

// Pass table names to Lambdas so they can locate the DynamoDB tables at runtime.
// Amplify Gen 2 doesn't auto-inject table names — we must wire them explicitly.
// Cast from IFunction → Function to access addEnvironment (CDK-level method).
const webhookLambda = backend.schedulingWebhook.resources.lambda as LambdaFunction;
const oauthLambda = backend.schedulingOAuth.resources.lambda as LambdaFunction;

webhookLambda.addEnvironment(
  'SCHEDULINGCONNECTION_TABLE_NAME',
  schedulingConnectionTable.tableName,
);
webhookLambda.addEnvironment(
  'SCHEDULEDINTERVIEW_TABLE_NAME',
  scheduledInterviewTable.tableName,
);
oauthLambda.addEnvironment(
  'SCHEDULINGCONNECTION_TABLE_NAME',
  schedulingConnectionTable.tableName,
);
oauthLambda.addEnvironment(
  'SCHEDULEDINTERVIEW_TABLE_NAME',
  scheduledInterviewTable.tableName,
);

// ─── ecsStatusBridge: EventBridge → AppSync ──────────────────────────────────

// Inject the AppSync GraphQL endpoint and API key so the Lambda can call publishContainerStatus
const ecsStatusBridgeLambda = backend.ecsStatusBridge.resources.lambda as LambdaFunction;
const graphqlEndpoint =
  backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl;
const apiKey = backend.data.resources.cfnResources.cfnApiKey?.attrApiKey;

ecsStatusBridgeLambda.addEnvironment('APPSYNC_ENDPOINT', graphqlEndpoint);
if (apiKey) {
  ecsStatusBridgeLambda.addEnvironment('APPSYNC_API_KEY', apiKey);
}

// EventBridge rule: catch ECS Task State Changes for pipe-* clusters only.
// The rule filters to tasks tagged with pipe:purpose=dev-container so unrelated
// ECS activity in the same account does not invoke the bridge.
const ecsStatusBridgeRule = new Rule(
  backend.ecsStatusBridge.resources.lambda.stack,
  'EcsTaskStateChangeRule',
  {
    eventPattern: {
      source: ['aws.ecs'],
      detailType: ['ECS Task State Change'],
      detail: {
        clusterArn: [{ prefix: 'arn:aws:ecs:' }],
        tags: [
          {
            key: 'pipe:purpose',
            value: 'dev-container',
          },
        ],
      },
    },
    description:
      'Routes ECS Task State Change events for pipe dev-container tasks to ecsStatusBridge Lambda',
  }
);

ecsStatusBridgeRule.addTarget(
  new LambdaTarget(backend.ecsStatusBridge.resources.lambda)
);

