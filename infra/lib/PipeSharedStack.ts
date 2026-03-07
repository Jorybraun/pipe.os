/**
 * PipeSharedStack
 *
 * CDK stack for shared, environment-stable infrastructure that is NOT managed
 * by Amplify per-sandbox deployments. These resources are provisioned once per
 * environment (dev / prod) and shared across all Amplify sandboxes and branches.
 *
 * Resources defined here:
 *  - ECS Fargate cluster (pipe-{env}-dev-containers)
 *  - IAM task execution role (with CloudWatch Logs permissions)
 *  - code-server Fargate task definition (codercom/code-server:latest)
 *  - Security group for code-server containers
 *  - CloudWatch log group (/pipe/dev-containers/code-server)
 *  - SSM parameters (ARNs written here, read by Amplify Lambdas at runtime)
 *
 * Pending (add to this stack when building the ALB):
 *  - Application Load Balancer (env.pipe.dev)
 *  - HTTPS listener + path-based routing rules (/session/{id})
 *  - ALB security group
 *  - Route 53 alias record
 *
 * Deploy:
 *  cd infra && npx cdk deploy PipeSharedDev
 *
 * How Amplify consumes these:
 *  The stack writes ARNs to SSM parameters under /pipe/{env}/shared/*.
 *  devContainerLaunch / devContainerStatus Lambdas read them at runtime
 *  (or backend.ts injects them as env vars from the hardcoded constants
 *  until the SSM-read migration is complete — see infra/README.md).
 */

import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface PipeSharedStackProps extends StackProps {
  /** 'dev' or 'prod' — used to namespace resource names and SSM paths */
  environment: 'dev' | 'prod';
  /** Domain for the ALB (e.g. 'env.pipe.dev') */
  albDomain: string;
}

export class PipeSharedStack extends Stack {
  public readonly cluster: ecs.Cluster;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly codeServerSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: PipeSharedStackProps) {
    super(scope, id, props);

    const { environment, albDomain } = props;
    const prefix = `pipe-${environment}`;
    const ssmPrefix = `/pipe/${environment}/shared`;

    // ── VPC ─────────────────────────────────────────────────────────────────
    // Use the default VPC — same as the manually provisioned resources.
    // Switch to a custom VPC (private subnets + NAT GW) before production.
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // ── CLOUDWATCH LOG GROUP ─────────────────────────────────────────────────
    // Created here (not by ECS auto-create) so we control retention and naming.
    // The IAM role below grants CreateLogGroup — but pre-creating the group is
    // safer (avoids IAM races on first task launch).
    const logGroup = new logs.LogGroup(this, 'CodeServerLogGroup', {
      logGroupName: `/pipe/dev-containers/code-server`,
      retention: environment === 'prod' ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_WEEK,
    });

    // ── IAM TASK EXECUTION ROLE ──────────────────────────────────────────────
    // ECS uses this role to pull the container image and write task logs.
    // AmazonECSTaskExecutionRolePolicy covers ECR + basic CloudWatch.
    // The inline policy covers log group creation (required on first launch).
    const executionRole = new iam.Role(this, 'EcsTaskExecutionRole', {
      roleName: `${prefix}-ecs-task-execution`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        ),
      ],
    });

    // logs:CreateLogGroup was missing on the manually-provisioned role —
    // caused ResourceInitializationError at task startup. Always include it.
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogStreams',
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/pipe/*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/pipe/*:*`,
        ],
      })
    );

    // ── ECS CLUSTER ──────────────────────────────────────────────────────────
    this.cluster = new ecs.Cluster(this, 'DevContainerCluster', {
      clusterName: `${prefix}-dev-containers`,
      vpc,
      containerInsights: environment === 'prod',
    });

    // ── FARGATE TASK DEFINITION ──────────────────────────────────────────────
    // 1 vCPU / 2 GB — sufficient for code-server + a small Node.js / Python project.
    // Increase to 2 vCPU / 4 GB if candidates run heavier workloads.
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'CodeServerTaskDef', {
      family: `${prefix}-code-server`,
      cpu: 1024,
      memoryLimitMiB: 2048,
      executionRole,
    });

    this.taskDefinition.addContainer('code-server', {
      containerName: 'code-server',
      image: ecs.ContainerImage.fromRegistry('codercom/code-server:latest'),
      portMappings: [{ containerPort: 8080, protocol: ecs.Protocol.TCP }],
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: 'code-server',
      }),
      // SESSION_ID and PASSWORD are injected at task launch time by the
      // devContainerLaunch Lambda via RunTask overrides — not hardcoded here.
      environment: {},
    });

    // ── SECURITY GROUP ───────────────────────────────────────────────────────
    this.codeServerSg = new ec2.SecurityGroup(this, 'CodeServerSg', {
      vpc,
      securityGroupName: `${prefix}-code-server`,
      description: `[${environment}] code-server containers — port 8080`,
      allowAllOutbound: true,
    });

    // TODO: Before production — restrict this to the ALB security group only:
    //   this.codeServerSg.addIngressRule(albSg, ec2.Port.tcp(8080), 'from ALB only');
    // For now: open to world so containers are directly accessible during dev.
    this.codeServerSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8080),
      'code-server HTTP — LOCK TO ALB SG BEFORE PROD'
    );

    // ── SSM PARAMETERS ───────────────────────────────────────────────────────
    // Amplify Lambdas read these at runtime so rotating infra values doesn't
    // require editing amplify/backend.ts or redeploying the Amplify stack.
    //
    // Current state: backend.ts uses hardcoded ARN strings instead (temporary).
    // Migration: replace the const ARN values in backend.ts with SSM reads,
    // then delete the hardcoded constants.
    new ssm.StringParameter(this, 'ClusterArnParam', {
      parameterName: `${ssmPrefix}/ecs/cluster-arn`,
      stringValue: this.cluster.clusterArn,
      description: `[${environment}] ECS cluster ARN for dev containers`,
    });

    new ssm.StringParameter(this, 'TaskDefinitionArnParam', {
      parameterName: `${ssmPrefix}/ecs/task-definition-arn`,
      stringValue: this.taskDefinition.taskDefinitionArn,
      description: `[${environment}] ECS task definition ARN for code-server`,
    });

    new ssm.StringParameter(this, 'SecurityGroupIdParam', {
      parameterName: `${ssmPrefix}/ecs/security-group-id`,
      stringValue: this.codeServerSg.securityGroupId,
      description: `[${environment}] Security group ID for code-server containers`,
    });

    new ssm.StringParameter(this, 'AlbDomainParam', {
      parameterName: `${ssmPrefix}/alb/domain`,
      stringValue: albDomain,
      description: `[${environment}] ALB domain for session URL construction`,
    });

    // ── CLOUDFORMATION OUTPUTS ───────────────────────────────────────────────
    // These are the values you copy into amplify/backend.ts until the SSM
    // migration is complete. Print them after every CDK deploy.
    new CfnOutput(this, 'ClusterArn', {
      exportName: `${prefix}-ecs-cluster-arn`,
      value: this.cluster.clusterArn,
      description: 'ECS_CLUSTER_ARN env var for devContainerLaunch Lambda',
    });

    new CfnOutput(this, 'TaskDefinitionFamily', {
      exportName: `${prefix}-task-definition-family`,
      value: `${prefix}-code-server`,
      description: 'ECS_TASK_DEFINITION env var for devContainerLaunch Lambda',
    });

    new CfnOutput(this, 'SecurityGroupId', {
      exportName: `${prefix}-code-server-sg-id`,
      value: this.codeServerSg.securityGroupId,
      description: 'ECS_SECURITY_GROUP_ID env var for devContainerLaunch Lambda',
    });

    new CfnOutput(this, 'LogGroupName', {
      exportName: `${prefix}-code-server-log-group`,
      value: logGroup.logGroupName,
    });
  }
}
