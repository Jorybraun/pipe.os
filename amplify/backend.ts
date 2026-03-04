import { defineBackend } from '@aws-amplify/backend';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { questionAgent } from './functions/questionAgent/resource';
import { jobDescriptionAgent } from './functions/jobDescriptionAgent/resource';
import { scoringAgent } from './functions/scoringAgent/resource';
import { turnCredentials } from './functions/turnCredentials/resource';
import { schedulingWebhook } from './functions/schedulingWebhook/resource';
import { schedulingOAuth } from './functions/schedulingOAuth/resource';

export const backend = defineBackend({
  auth,
  data,
  questionAgent,
  jobDescriptionAgent,
  scoringAgent,
  turnCredentials,
  schedulingWebhook,
  schedulingOAuth,
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
