import { defineBackend } from '@aws-amplify/backend';
import { Function as LambdaFunction, FunctionUrlAuthType, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { questionAgent } from './functions/questionAgent/resource';
import { jobDescriptionAgent } from './functions/jobDescriptionAgent/resource';
import { scoringAgent } from './functions/scoringAgent/resource';
import { turnCredentials } from './functions/turnCredentials/resource';
import { schedulingWebhook } from './functions/schedulingWebhook/resource';
import { schedulingOAuth } from './functions/schedulingOAuth/resource';
import { notificationService } from './functions/notificationService/resource';

export const backend = defineBackend({
  auth,
  data,
  questionAgent,
  jobDescriptionAgent,
  scoringAgent,
  turnCredentials,
  schedulingWebhook,
  schedulingOAuth,
  notificationService,
});

// 1. DYNAMODB ACCESS & STREAM WIRING
const schedulingConnectionTable = backend.data.resources.tables['SchedulingConnection'];
const scheduledInterviewTable = backend.data.resources.tables['ScheduledInterview'];
const candidateTable = backend.data.resources.tables['Candidate'];
const stageTable = backend.data.resources.tables['Stage'];
const pipelineTable = backend.data.resources.tables['Pipeline'];

// Grant scheduling Lambdas direct DynamoDB access
schedulingConnectionTable.grantReadWriteData(backend.schedulingWebhook.resources.lambda);
schedulingConnectionTable.grantReadWriteData(backend.schedulingOAuth.resources.lambda);
scheduledInterviewTable.grantReadWriteData(backend.schedulingWebhook.resources.lambda);
scheduledInterviewTable.grantReadWriteData(backend.schedulingOAuth.resources.lambda);
candidateTable.grantReadData(backend.schedulingWebhook.resources.lambda);

// Grant notificationService access to all relevant tables
candidateTable.grantReadData(backend.notificationService.resources.lambda);
scheduledInterviewTable.grantReadWriteData(backend.notificationService.resources.lambda);
stageTable.grantReadData(backend.notificationService.resources.lambda);
pipelineTable.grantReadData(backend.notificationService.resources.lambda);
schedulingConnectionTable.grantReadData(backend.notificationService.resources.lambda);

// Attach notificationService to DynamoDB Streams
backend.notificationService.resources.lambda.addEventSource(new DynamoEventSource(candidateTable, {
  startingPosition: StartingPosition.LATEST,
  retryAttempts: 3,
}));

backend.notificationService.resources.lambda.addEventSource(new DynamoEventSource(scheduledInterviewTable, {
  startingPosition: StartingPosition.LATEST,
  retryAttempts: 3,
}));

// 2. SES PERMISSIONS
backend.notificationService.resources.lambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ses:SendEmail', 'ses:SendRawEmail'],
  resources: ['*'], // Scope down to specific verified identities in production
}));

// 3. ENVIRONMENT VARIABLES
const webhookLambda = backend.schedulingWebhook.resources.lambda as unknown as LambdaFunction;
const oauthLambda = backend.schedulingOAuth.resources.lambda as unknown as LambdaFunction;
const notificationLambda = backend.notificationService.resources.lambda as unknown as LambdaFunction;

// Pass table names to Lambdas
const tableEnv = {
  'SCHEDULINGCONNECTION_TABLE_NAME': schedulingConnectionTable.tableName,
  'SCHEDULEDINTERVIEW_TABLE_NAME': scheduledInterviewTable.tableName,
  'CANDIDATE_TABLE_NAME': candidateTable.tableName,
  'STAGE_TABLE_NAME': stageTable.tableName,
  'PIPELINE_TABLE_NAME': pipelineTable.tableName,
};

[webhookLambda, oauthLambda, notificationLambda].forEach(l => {
  Object.entries(tableEnv).forEach(([k, v]) => l.addEnvironment(k, v));
});

// 4. WEBHOOK FUNCTION URL
// Create a public Function URL on the webhook Lambda so Calendly/Cal.com can POST to it.
// Auth is handled by HMAC signature verification inside the handler, not IAM.
const webhookFunctionUrl = webhookLambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE, // Public — HMAC-verified in handler
});

// Store the Function URL in SSM Parameter Store to BREAK circular dependency.
// Passing webhookFunctionUrl.url directly as an env var to oauthLambda creates a CFN
// circular dependency because both Lambdas are in resourceGroupName: 'data' (same nested stack).
// The chain: OAuth Lambda → Function URL → Webhook Lambda → FunctionDirectiveStack → OAuth Lambda.
// By storing in SSM and reading at runtime, we avoid any CFN Ref/GetAtt between the resources.
const WEBHOOK_URL_SSM_PARAM = '/pipe/scheduling/webhook-callback-url';
new StringParameter(webhookFunctionUrl, 'WebhookCallbackUrlParam', {
  parameterName: WEBHOOK_URL_SSM_PARAM,
  stringValue: webhookFunctionUrl.url,
  description: 'Lambda Function URL for the scheduling webhook (Calendly/Cal.com)',
});

// Pass the SSM parameter name as a plain string — no CFN token, no dependency
oauthLambda.addEnvironment('WEBHOOK_URL_SSM_PARAM', WEBHOOK_URL_SSM_PARAM);

// Grant OAuth Lambda SSM read permission with hardcoded ARN (no CFN reference to break cycle)
oauthLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ssm:GetParameter'],
  resources: [`arn:aws:ssm:*:*:parameter${WEBHOOK_URL_SSM_PARAM}`],
}));

// 5. COGNITO PERMISSIONS (for recruiter notifications)
// The notificationService needs to look up recruiter emails from Cognito
// when the webhook updates an interview status (SCHEDULED / CANCELLED).
const { cfnUserPool } = backend.auth.resources.cfnResources;
notificationLambda.addEnvironment('USER_POOL_ID', cfnUserPool.ref);
notificationLambda.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['cognito-idp:AdminGetUser'],
  resources: [`arn:aws:cognito-idp:*:*:userpool/${cfnUserPool.ref}`],
}));

// NOTE: SES_SENDER_EMAIL and APP_URL are now handled via secrets in the function's resource definition.
