/**
 * Dev Container Launch Lambda Handler
 *
 * Calls ECS.RunTask to spin up a Fargate container running code-server.
 * Returns the task ARN immediately — status updates are pushed to the
 * frontend via AppSync subscriptions (onContainerStatusChanged).
 *
 * STREAM2-011 through STREAM2-015: Enhanced for code review challenges
 * - Accepts optional challengeId parameter
 * - Queries Challenge model for repository metadata
 * - Calls repoManager to generate presigned S3 URL (2-hour TTL)
 * - Passes REPO_S3_URL + branch info to ECS as environment variables
 * - Selects appropriate Docker image based on challenge type
 * - Maintains backward compatibility for non-repo challenges
 *
 * Required environment variables:
 *   ECS_CLUSTER_ARN              — ARN of the ECS cluster
 *   ECS_TASK_DEFINITION          — Task definition family:revision (e.g. pipe-code-server:3)
 *   ECS_SUBNET_IDS               — Comma-separated list of subnet IDs for the task
 *   ECS_SECURITY_GROUP_ID        — Security group ID that allows inbound on port 8080
 *   CODE_SERVER_ALB_DOMAIN       — Domain of the ALB that routes to containers
 *
 * STREAM2 environment variables:
 *   CHALLENGE_TABLE_SSM          — SSM parameter name containing Challenge table name
 *   REPO_BUCKET_NAME             — S3 bucket for repository archives (default: pipe-challenges-prod)
 *   DEFAULT_CONTAINER_IMAGE      — Docker image for non-repo challenges
 *   CODE_REVIEW_CONTAINER_IMAGE  — Docker image for repo-based code review challenges
 */

import {
  ECSClient,
  RunTaskCommand,
  TagResourceCommand,
  type RunTaskCommandInput,
} from '@aws-sdk/client-ecs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'crypto';
import type {
  DevContainerLaunchRequest,
  DevContainerLaunchResponse,
  DevContainerLaunchError,
} from './types';
import { generatePresignedUrl, handleS3Error } from '../repoManagement/lib/repoManager';

const region = process.env.AWS_REGION ?? 'us-east-1';
const ecs = new ECSClient({ region });
const ssm = new SSMClient({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// Cache for table names retrieved from SSM
let _challengeTableName: string | undefined;

/**
 * Retrieve Challenge table name from SSM Parameter Store
 * STREAM2-011: Required for querying Challenge model
 */
async function getChallengeTableName(): Promise<string> {
  if (_challengeTableName !== undefined) return _challengeTableName;

  const paramName = process.env.CHALLENGE_TABLE_SSM;
  if (!paramName) {
    throw new Error('CHALLENGE_TABLE_SSM environment variable not set');
  }

  try {
    const result = await ssm.send(new GetParameterCommand({ Name: paramName }));
    _challengeTableName = result.Parameter?.Value;
    if (!_challengeTableName) {
      throw new Error(`SSM parameter ${paramName} is empty`);
    }
    console.log('[devContainerLaunch] Retrieved Challenge table name from SSM:', {
      paramName,
      tableNamePrefix: _challengeTableName.substring(0, 20),
    });
    return _challengeTableName;
  } catch (error) {
    console.error('[devContainerLaunch] Failed to retrieve Challenge table name from SSM:', {
      paramName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Query Challenge model from DynamoDB
 * STREAM2-011: Fetch repoS3Key, repoBranch, repoBaseBranch, repoMetadataS3Key
 */
async function getChallenge(challengeId: string): Promise<any> {
  console.log('[devContainerLaunch] 📋 Querying Challenge model', { challengeId });

  const tableName = await getChallengeTableName();

  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { id: challengeId },
      })
    );

    const challenge = result.Item;
    if (!challenge) {
      throw new Error(`Challenge not found: ${challengeId}`);
    }

    console.log('[devContainerLaunch] ✅ Challenge found', {
      challengeId,
      type: challenge.type,
      hasRepo: !!challenge.repoS3Key,
    });

    return challenge;
  } catch (error) {
    console.error('[devContainerLaunch] ❌ Failed to query Challenge', {
      challengeId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function handler(
  event: DevContainerLaunchRequest
): Promise<DevContainerLaunchResponse | DevContainerLaunchError> {
  const startTime = Date.now();

  // Amplify Gen 2 direct Lambda resolvers pass the full AppSync event.
  // Mutation arguments are nested under event.arguments, not at the top level.
  const { sessionId, challengeId } = event.arguments;

  console.log('[devContainerLaunch] 🚀 Launching container', {
    sessionId,
    challengeId,
    isCodeReview: !!challengeId,
  });

  const clusterArn = process.env.ECS_CLUSTER_ARN;
  const taskDefinition = process.env.ECS_TASK_DEFINITION;
  const subnetIds = process.env.ECS_SUBNET_IDS;
  const securityGroupId = process.env.ECS_SECURITY_GROUP_ID;

  if (!clusterArn || !taskDefinition || !subnetIds || !securityGroupId) {
    console.error('[devContainerLaunch] ❌ Missing required environment variables', {
      clusterArn: !!clusterArn,
      taskDefinition: !!taskDefinition,
      subnetIds: !!subnetIds,
      securityGroupId: !!securityGroupId,
    });
    return {
      success: false,
      error: 'Server is not configured for dev containers. Set ECS_* environment variables.',
      code: 'MISSING_CONFIG',
    };
  }

  try {
    // ============================================
    // PHASE: REPO_LOOKUP (if code review challenge)
    // ============================================
    let presignedUrl: string | undefined;
    let challenge: any = null;

    if (challengeId) {
      console.log('[devContainerLaunch] PHASE: REPO_LOOKUP', {
        timestamp: new Date().toISOString(),
        challengeId,
      });

      challenge = await getChallenge(challengeId);

      // Check if challenge has repository
      if (!challenge.repoS3Key) {
        throw new Error(
          `Challenge ${challengeId} has no repository. Ensure repoS3Key is set for code review challenges.`
        );
      }

      console.log('[devContainerLaunch] ✅ Challenge has repository', {
        repoS3Key: challenge.repoS3Key,
        repoBranch: challenge.repoBranch,
        repoBaseBranch: challenge.repoBaseBranch,
      });

      // ============================================
      // PHASE: PRESIGNED_URL_GENERATION
      // ============================================
      console.log('[devContainerLaunch] PHASE: PRESIGNED_URL_GENERATION', {
        timestamp: new Date().toISOString(),
        repoS3Key: challenge.repoS3Key,
      });

      try {
        const urlResponse = await generatePresignedUrl({
          challengeId,
          repoS3Key: challenge.repoS3Key,
          ttlSeconds: 7200, // 2 hours
        });

        presignedUrl = urlResponse.url;

        console.log('[devContainerLaunch] ✅ Presigned URL generated', {
          expiresAt: urlResponse.expiresAt.toISOString(),
          bucket: urlResponse.bucket,
        });
      } catch (error) {
        // Handle S3 errors from repoManager
        const s3Error = handleS3Error(error);
        console.error('[devContainerLaunch] ❌ Failed to generate presigned URL', {
          statusCode: s3Error.statusCode,
          message: s3Error.message,
          userMessage: s3Error.userMessage,
        });
        throw new Error(`S3 Error: ${s3Error.userMessage}`);
      }
    }

    // ============================================
    // Generate per-session access token
    // ============================================
    // 24 bytes = 192 bits entropy (exceeds NIST SP800-132 minimum for session tokens)
    // Never log or expose this value
    const accessToken = randomBytes(24).toString('hex');

    // ============================================
    // Prepare ECS environment variables
    // ============================================
    const environment: Array<{ name: string; value: string }> = [
      { name: 'SESSION_ID', value: sessionId },
      { name: 'PASSWORD', value: accessToken },
      { name: 'CHALLENGE_ID', value: challengeId || '' },
    ];

    // Add code review specific environment variables if repo is present
    if (presignedUrl && challenge) {
      environment.push(
        { name: 'REPO_S3_URL', value: presignedUrl },
        { name: 'CHALLENGE_BRANCH', value: challenge.repoBranch || 'main' },
        { name: 'REPO_BASE_BRANCH', value: challenge.repoBaseBranch || 'main' },
        {
          name: 'CODE_REVIEW_TYPE',
          value: challenge.codeReviewType || 'REVIEW_ONLY',
        }
      );

      console.log('[devContainerLaunch] 📦 Code review environment variables set', {
        branch: challenge.repoBranch,
        baseBranch: challenge.repoBaseBranch,
      });
    }

    // ============================================
    // Select container image based on challenge type
    // ============================================
    const containerImage = presignedUrl
      ? process.env.CODE_REVIEW_CONTAINER_IMAGE ||
        'account.dkr.ecr.us-east-1.amazonaws.com/code-server:code-review-latest'
      : process.env.DEFAULT_CONTAINER_IMAGE ||
        'account.dkr.ecr.us-east-1.amazonaws.com/code-server:latest';

    console.log('[devContainerLaunch] 🐳 Container image selected', {
      isCodeReview: !!presignedUrl,
      image: containerImage.substring(0, 80) + (containerImage.length > 80 ? '...' : ''),
    });

    // ============================================
    // PHASE: ECS_LAUNCH
    // ============================================
    console.log('[devContainerLaunch] PHASE: ECS_LAUNCH', {
      timestamp: new Date().toISOString(),
      clusterArn,
      taskDefinition,
    });

    const input: RunTaskCommandInput = {
      cluster: clusterArn,
      taskDefinition,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: subnetIds.split(',').map((s) => s.trim()),
          securityGroups: [securityGroupId],
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: 'code-server',
            // @ts-ignore - AWS SDK v3 type definitions missing 'image' field in ContainerOverride
            // The field is valid according to ECS API documentation
            image: containerImage,
            command: ['--bind-addr', '0.0.0.0:8080'],
            environment,
          } as any,
        ],
      },
      enableECSManagedTags: true,
      tags: [
        { key: 'pipe:session', value: sessionId },
        { key: 'pipe:purpose', value: 'dev-container' },
        ...(challengeId ? [{ key: 'pipe:challenge', value: challengeId }] : []),
      ],
    };

    const result = await ecs.send(new RunTaskCommand(input));

    const task = result.tasks?.[0];
    const failure = result.failures?.[0];

    if (failure || !task?.taskArn) {
      console.error('[devContainerLaunch] ❌ ECS RunTask failure', {
        failure: failure?.reason,
      });
      return {
        success: false,
        error: failure?.reason ?? 'ECS did not return a task ARN',
        code: 'ECS_ERROR',
      };
    }

    console.log('[devContainerLaunch] ✅ ECS task launched', {
      taskArn: task.taskArn,
      durationMs: Date.now() - startTime,
    });

    // Tag the task (RunTask tags parameter doesn't work reliably, must use TagResource)
    try {
      await ecs.send(
        new TagResourceCommand({
          resourceArn: task.taskArn,
          tags: [
            { key: 'pipe:session', value: sessionId },
            { key: 'pipe:purpose', value: 'dev-container' },
            ...(challengeId ? [{ key: 'pipe:challenge', value: challengeId }] : []),
          ],
        })
      );
      console.log('[devContainerLaunch] ✅ Task tagged successfully');
    } catch (err) {
      console.error('[devContainerLaunch] ⚠️ Failed to tag task:', err);
      // Non-fatal — don't fail the launch
    }

    // ============================================
    // PHASE: READY
    // ============================================
    console.log('[devContainerLaunch] PHASE: READY', {
      timestamp: new Date().toISOString(),
      totalDurationMs: Date.now() - startTime,
      repoUrl: presignedUrl ? '***PRESIGNED_URL***' : undefined,
      branch: challenge?.repoBranch,
    });

    return {
      sessionId,
      taskArn: task.taskArn,
      status: 'PROVISIONING',
      launchedAt: new Date().toISOString(),
      accessToken,
      // STREAM2: Include code review fields if present
      repoUrl: presignedUrl ? presignedUrl : undefined,
      branch: challenge?.repoBranch,
      baseBranch: challenge?.repoBaseBranch,
    };
  } catch (err) {
    console.error('[devContainerLaunch] ❌ Unexpected error', {
      sessionId,
      challengeId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    // Map specific error types
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (errorMessage.includes('Challenge not found')) {
      return {
        success: false,
        error: `Challenge not found: ${challengeId}`,
        code: 'ECS_ERROR',
      };
    }

    if (errorMessage.includes('repository')) {
      return {
        success: false,
        error: `Repository configuration error: ${errorMessage}`,
        code: 'ECS_ERROR',
      };
    }

    if (errorMessage.includes('S3 Error')) {
      return {
        success: false,
        error: errorMessage,
        code: 'ECS_ERROR',
      };
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      code: 'INTERNAL_ERROR',
    };
  }
}
