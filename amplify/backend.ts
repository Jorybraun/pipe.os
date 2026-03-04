import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { questionAgent } from './functions/questionAgent/resource';
import { jobDescriptionAgent } from './functions/jobDescriptionAgent/resource';
import { scoringAgent } from './functions/scoringAgent/resource';
import { turnCredentials } from './functions/turnCredentials/resource';
import { devContainerLaunch } from './functions/devContainerLaunch/resource';
import { devContainerDestroy } from './functions/devContainerDestroy/resource';
import { devContainerStatus } from './functions/devContainerStatus/resource';
import { devContainerEventHandler } from './functions/devContainerEventHandler/resource';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export const backend = defineBackend({
  auth,
  data,
  questionAgent,
  jobDescriptionAgent,
  scoringAgent,
  turnCredentials,
  devContainerLaunch,
  devContainerDestroy,
  devContainerStatus,
  devContainerEventHandler,
});

// ─── AppSync real-time: replace client polling with EventBridge → Lambda → AppSync ───

const graphqlEndpoint =
  backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl;

// Grant devContainerLaunch permission to call AppSync mutations and pass the endpoint
backend.devContainerLaunch.resources.lambda.addEnvironment(
  'AMPLIFY_DATA_GRAPHQL_ENDPOINT',
  graphqlEndpoint
);
backend.devContainerLaunch.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['appsync:GraphQL'],
    resources: [
      `${backend.data.resources.cfnResources.cfnGraphqlApi.attrArn}/*`,
    ],
  })
);

// Grant devContainerEventHandler permission to call AppSync mutations and pass the endpoint
backend.devContainerEventHandler.resources.lambda.addEnvironment(
  'AMPLIFY_DATA_GRAPHQL_ENDPOINT',
  graphqlEndpoint
);
backend.devContainerEventHandler.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['appsync:GraphQL'],
    resources: [
      `${backend.data.resources.cfnResources.cfnGraphqlApi.attrArn}/*`,
    ],
  })
);

// EventBridge rule: trigger devContainerEventHandler on every ECS task state change
// that belongs to this feature (tagged pipe:purpose = dev-container).
// ECS emits these events automatically — no explicit event bus configuration needed.
const eventStack = backend.createStack('DevContainerEventStack');

const ecsRule = new Rule(eventStack, 'DevContainerEcsStateChangeRule', {
  eventPattern: {
    source: ['aws.ecs'],
    detailType: ['ECS Task State Change'],
  },
  description:
    'Routes ECS task state changes for pipe dev containers to the devContainerEventHandler Lambda',
});

ecsRule.addTarget(
  new LambdaFunction(backend.devContainerEventHandler.resources.lambda)
);

