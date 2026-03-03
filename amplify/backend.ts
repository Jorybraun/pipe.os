import { defineBackend } from '@aws-amplify/backend';
import { Function as LambdaFunction, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
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

// Actual Function URL property (Amplify Gen 2)
// The .url property is on the resources object in Amplify Gen 2
const webhookUrl = (backend.schedulingWebhook.resources as any).url;
if (webhookUrl) {
  oauthLambda.addEnvironment('WEBHOOK_CALLBACK_URL', webhookUrl);
  webhookLambda.addEnvironment('WEBHOOK_CALLBACK_URL', webhookUrl);
}

// NOTE: SES_SENDER_EMAIL and APP_URL are now handled via secrets in the function's resource definition.
