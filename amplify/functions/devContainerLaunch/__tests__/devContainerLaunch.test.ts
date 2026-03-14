/**
 * Unit tests for devContainerLaunch Lambda
 * 
 * STREAM2-012: Comprehensive test coverage for Phase 3 implementation
 * - Happy path (non-repo): Basic container launch
 * - Happy path (code review): With presigned URL and branch info
 * - Error: Challenge not found
 * - Error: Challenge has no repository
 * - Error: Presigned URL generation fails
 * - Error: ECS launch fails
 * - Environment variables validation
 * - Backwards compatibility
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { ECSClient, RunTaskCommand, TagResourceCommand } from '@aws-sdk/client-ecs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../handler';
import * as repoManager from '../../repoManagement/lib/repoManager';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-ecs');
jest.mock('@aws-sdk/client-ssm');
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb');
jest.mock('../../repoManagement/lib/repoManager');

// Mock crypto module for deterministic testing
jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => Buffer.from('a'.repeat(48))), // 24 bytes hex = 48 chars
}));

describe('devContainerLaunch Lambda (Phase 3: STREAM2)', () => {
  const mockEnv = {
    AWS_REGION: 'us-east-1',
    ECS_CLUSTER_ARN: 'arn:aws:ecs:us-east-1:123456789:cluster/test',
    ECS_TASK_DEFINITION: 'code-server:3',
    ECS_SUBNET_IDS: 'subnet-1,subnet-2',
    ECS_SECURITY_GROUP_ID: 'sg-123',
    CHALLENGE_TABLE_SSM: '/pipe/challenge-table-name',
    DEFAULT_CONTAINER_IMAGE: 'account.dkr.ecr.us-east-1.amazonaws.com/code-server:latest',
    CODE_REVIEW_CONTAINER_IMAGE:
      'account.dkr.ecr.us-east-1.amazonaws.com/code-server:code-review-latest',
  };

  const mockEcsClient = ECSClient as jest.MockedClass<typeof ECSClient>;
  const mockSsmClient = SSMClient as jest.MockedClass<typeof SSMClient>;
  const mockDynamoClient = DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>;

  beforeEach(() => {
    // Set environment variables
    Object.assign(process.env, mockEnv);

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up environment
    Object.keys(mockEnv).forEach((key) => {
      delete (process.env as any)[key];
    });
  });

  describe('Happy Path: Non-Repo Challenge', () => {
    it('should launch basic container without challengeId', async () => {
      // Mock SSM (not needed for non-repo, but safe to have)
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      // Mock ECS RunTask
      (mockEcsClient.prototype.send as jest.Mock).mockResolvedValueOnce({
        tasks: [
          {
            taskArn: 'arn:aws:ecs:us-east-1:123456789:task/test-task-123',
          },
        ],
      });

      // Mock ECS TagResource
      (mockEcsClient.prototype.send as jest.Mock).mockResolvedValueOnce({});

      const event = {
        arguments: {
          sessionId: 'session-123',
        },
        typeName: 'Mutation',
        fieldName: 'devContainerLaunch',
        identity: {},
        source: {},
        request: {},
        prev: { result: {} },
      };

      const result = await handler(event as any);

      expect(result).toHaveProperty('sessionId', 'session-123');
      expect(result).toHaveProperty('taskArn');
      expect(result).toHaveProperty('status', 'PROVISIONING');
      expect(result).toHaveProperty('accessToken');
      expect((result as any).repoUrl).toBeUndefined();
      expect((result as any).branch).toBeUndefined();
    });

    it('should verify backwards compatibility with non-repo challenges', async () => {
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      (mockEcsClient.prototype.send as jest.Mock)
        .mockResolvedValueOnce({
          tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123456789:task/test-task-456' }],
        })
        .mockResolvedValueOnce({});

      const event = {
        arguments: {
          sessionId: 'session-456',
          // No challengeId provided
        },
        typeName: 'Mutation',
        fieldName: 'devContainerLaunch',
        identity: {},
        source: {},
        request: {},
        prev: { result: {} },
      };

      const result = await handler(event as any);

      // Verify default image was used (no presigned URL, so no code-review image)
      expect(mockEcsClient.prototype.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            overrides: expect.objectContaining({
              containerOverrides: expect.arrayContaining([
                expect.objectContaining({
                  image: mockEnv.DEFAULT_CONTAINER_IMAGE,
                }),
              ]),
            }),
          }),
        })
      );

      expect(result).toHaveProperty('status', 'PROVISIONING');
    });
  });

  describe('Happy Path: Code Review Challenge', () => {
    it('should launch code review container with presigned URL', async () => {
      // Mock SSM for Challenge table name
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      // Mock DynamoDB GetCommand for Challenge query
      const mockDdbSend = jest.fn();
      (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({
        send: mockDdbSend,
      });

      mockDdbSend.mockResolvedValueOnce({
        Item: {
          id: 'challenge-789',
          type: 'CODE_REVIEW',
          repoS3Key: 'challenge-repos/app/repo/v1/repo.tar.gz',
          repoBranch: 'feature/coupon-support',
          repoBaseBranch: 'main',
          repoMetadataS3Key: 'challenge-repos/app/repo/v1/metadata.json',
          codeReviewType: 'REVIEW_ONLY',
        },
      });

      // Mock repoManager.generatePresignedUrl
      (repoManager.generatePresignedUrl as jest.Mock).mockResolvedValueOnce({
        url: 'https://bucket.s3.amazonaws.com/path?presigned=url&expires=7200',
        expiresAt: new Date(Date.now() + 2 * 3600 * 1000),
        bucket: 'pipe-challenges-prod',
        key: 'challenge-repos/app/repo/v1/repo.tar.gz',
      });

      // Mock ECS RunTask
      (mockEcsClient.prototype.send as jest.Mock)
        .mockResolvedValueOnce({
          tasks: [
            {
              taskArn: 'arn:aws:ecs:us-east-1:123456789:task/test-task-789',
            },
          ],
        })
        .mockResolvedValueOnce({});

      const event = {
        arguments: {
          sessionId: 'session-789',
          challengeId: 'challenge-789',
        },
        typeName: 'Mutation',
        fieldName: 'devContainerLaunch',
        identity: {},
        source: {},
        request: {},
        prev: { result: {} },
      };

      const result = await handler(event as any);

      // Verify response includes code review fields
      expect(result).toHaveProperty('sessionId', 'session-789');
      expect(result).toHaveProperty('taskArn');
      expect((result as any).repoUrl).toBeDefined();
      expect((result as any).branch, 'feature/coupon-support');
      expect((result as any).baseBranch, 'main');

      // Verify presigned URL was called with correct parameters
      expect(repoManager.generatePresignedUrl).toHaveBeenCalledWith({
        challengeId: 'challenge-789',
        repoS3Key: 'challenge-repos/app/repo/v1/repo.tar.gz',
        ttlSeconds: 7200,
      });

      // Verify ECS environment variables include code review fields
      const ecsCall = (mockEcsClient.prototype.send as jest.Mock).mock.calls[0][0];
      const containerEnv = ecsCall.input.overrides.containerOverrides[0].environment;

      expect(containerEnv).toContainEqual({
        name: 'REPO_S3_URL',
        value: 'https://bucket.s3.amazonaws.com/path?presigned=url&expires=7200',
      });
      expect(containerEnv).toContainEqual({
        name: 'CHALLENGE_BRANCH',
        value: 'feature/coupon-support',
      });
      expect(containerEnv).toContainEqual({
        name: 'REPO_BASE_BRANCH',
        value: 'main',
      });
      expect(containerEnv).toContainEqual({
        name: 'CODE_REVIEW_TYPE',
        value: 'REVIEW_ONLY',
      });
    });

    it('should use code-review container image for code review challenges', async () => {
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      const mockDdbSend = jest.fn();
      (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({
        send: mockDdbSend,
      });

      mockDdbSend.mockResolvedValueOnce({
        Item: {
          id: 'challenge-img',
          repoS3Key: 'challenge-repos/app/repo/v1/repo.tar.gz',
          repoBranch: 'main',
          repoBaseBranch: 'main',
        },
      });

      (repoManager.generatePresignedUrl as jest.Mock).mockResolvedValueOnce({
        url: 'https://presigned-url',
        expiresAt: new Date(),
        bucket: 'bucket',
        key: 'key',
      });

      (mockEcsClient.prototype.send as jest.Mock)
        .mockResolvedValueOnce({
          tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123456789:task/test' }],
        })
        .mockResolvedValueOnce({});

      await handler({
        arguments: { sessionId: 'session', challengeId: 'challenge-img' },
      } as any);

      const ecsCall = (mockEcsClient.prototype.send as jest.Mock).mock.calls[0][0];
      const containerImage = ecsCall.input.overrides.containerOverrides[0].image;

      expect(containerImage).toBe(mockEnv.CODE_REVIEW_CONTAINER_IMAGE);
    });
  });

  describe('Error: Challenge Not Found', () => {
    it('should return error when challengeId is provided but not found', async () => {
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      const mockDdbSend = jest.fn();
      (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({
        send: mockDdbSend,
      });

      // Challenge not found
      mockDdbSend.mockResolvedValueOnce({
        Item: undefined,
      });

      const event = {
        arguments: {
          sessionId: 'session-error-1',
          challengeId: 'missing-challenge',
        },
        typeName: 'Mutation',
        fieldName: 'devContainerLaunch',
        identity: {},
        source: {},
        request: {},
        prev: { result: {} },
      };

      const result = await handler(event as any);

      expect(result).toHaveProperty('success', false);
      expect((result as any).code).toBe('ECS_ERROR');
      expect((result as any).error).toContain('Challenge not found');
    });
  });

  describe('Error: Challenge Has No Repository', () => {
    it('should return error when challenge has no repoS3Key', async () => {
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      const mockDdbSend = jest.fn();
      (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({
        send: mockDdbSend,
      });

      // Challenge found but no repoS3Key
      mockDdbSend.mockResolvedValueOnce({
        Item: {
          id: 'challenge-no-repo',
          type: 'QUIZ_MCQ', // Non-repo challenge type
          // No repoS3Key field
        },
      });

      const event = {
        arguments: {
          sessionId: 'session-error-2',
          challengeId: 'challenge-no-repo',
        },
        typeName: 'Mutation',
        fieldName: 'devContainerLaunch',
        identity: {},
        source: {},
        request: {},
        prev: { result: {} },
      };

      const result = await handler(event as any);

      expect(result).toHaveProperty('success', false);
      expect((result as any).code).toBe('ECS_ERROR');
      expect((result as any).error).toContain('has no repository');
    });
  });

  describe('Error: Presigned URL Generation Fails', () => {
    it('should return error when S3 access is denied', async () => {
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      const mockDdbSend = jest.fn();
      (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({
        send: mockDdbSend,
      });

      mockDdbSend.mockResolvedValueOnce({
        Item: {
          id: 'challenge-s3-error',
          repoS3Key: 'challenge-repos/app/repo/v1/repo.tar.gz',
          repoBranch: 'main',
        },
      });

      // S3 error from repoManager
      (repoManager.generatePresignedUrl as jest.Mock).mockRejectedValueOnce(
        new Error('S3 access denied')
      );

      (repoManager.handleS3Error as jest.Mock).mockReturnValueOnce({
        statusCode: 403,
        message: 'AccessDenied',
        userMessage: 'You do not have permission to access this repository.',
      });

      const event = {
        arguments: {
          sessionId: 'session-error-3',
          challengeId: 'challenge-s3-error',
        },
        typeName: 'Mutation',
        fieldName: 'devContainerLaunch',
        identity: {},
        source: {},
        request: {},
        prev: { result: {} },
      };

      const result = await handler(event as any);

      expect(result).toHaveProperty('success', false);
      expect((result as any).error).toContain('S3 Error');
    });
  });

  describe('Error: ECS Launch Fails', () => {
    it('should return error when ECS RunTask returns no tasks', async () => {
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      (mockEcsClient.prototype.send as jest.Mock).mockResolvedValueOnce({
        tasks: [], // Empty array — ECS failure
      });

      const event = {
        arguments: {
          sessionId: 'session-error-4',
        },
        typeName: 'Mutation',
        fieldName: 'devContainerLaunch',
        identity: {},
        source: {},
        request: {},
        prev: { result: {} },
      };

      const result = await handler(event as any);

      expect(result).toHaveProperty('success', false);
      expect((result as any).code).toBe('ECS_ERROR');
    });

    it('should return error when ECS RunTask returns failure', async () => {
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      (mockEcsClient.prototype.send as jest.Mock).mockResolvedValueOnce({
        tasks: [],
        failures: [{ reason: 'Task failed to launch' }],
      });

      const event = {
        arguments: {
          sessionId: 'session-error-5',
        },
        typeName: 'Mutation',
        fieldName: 'devContainerLaunch',
        identity: {},
        source: {},
        request: {},
        prev: { result: {} },
      };

      const result = await handler(event as any);

      expect(result).toHaveProperty('success', false);
      expect((result as any).error).toContain('Task failed to launch');
    });
  });

  describe('Environment Variable Validation', () => {
    it('should use default container images when env vars not set', async () => {
      // Clear image env vars
      delete process.env.DEFAULT_CONTAINER_IMAGE;
      delete process.env.CODE_REVIEW_CONTAINER_IMAGE;

      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      (mockEcsClient.prototype.send as jest.Mock)
        .mockResolvedValueOnce({
          tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123456789:task/test' }],
        })
        .mockResolvedValueOnce({});

      await handler({
        arguments: { sessionId: 'session-default-img' },
      } as any);

      const ecsCall = (mockEcsClient.prototype.send as jest.Mock).mock.calls[0][0];
      const containerImage = ecsCall.input.overrides.containerOverrides[0].image;

      // Should use hardcoded default
      expect(containerImage).toContain('code-server:latest');
    });

    it('should return error when required ECS env vars are missing', async () => {
      delete process.env.ECS_CLUSTER_ARN;

      const event = {
        arguments: { sessionId: 'session-missing-env' },
        typeName: 'Mutation',
        fieldName: 'devContainerLaunch',
        identity: {},
        source: {},
        request: {},
        prev: { result: {} },
      };

      const result = await handler(event as any);

      expect(result).toHaveProperty('success', false);
      expect((result as any).code).toBe('MISSING_CONFIG');
      expect((result as any).error).toContain('not configured');
    });
  });

  describe('Tags and Metadata', () => {
    it('should tag ECS task with challenge ID when code review', async () => {
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      const mockDdbSend = jest.fn();
      (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({
        send: mockDdbSend,
      });

      mockDdbSend.mockResolvedValueOnce({
        Item: {
          id: 'challenge-tag-test',
          repoS3Key: 'challenge-repos/app/repo/v1/repo.tar.gz',
          repoBranch: 'main',
        },
      });

      (repoManager.generatePresignedUrl as jest.Mock).mockResolvedValueOnce({
        url: 'https://presigned-url',
        expiresAt: new Date(),
        bucket: 'bucket',
        key: 'key',
      });

      (mockEcsClient.prototype.send as jest.Mock)
        .mockResolvedValueOnce({
          tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123456789:task/test' }],
        })
        .mockResolvedValueOnce({});

      await handler({
        arguments: { sessionId: 'session-tag', challengeId: 'challenge-tag-test' },
      } as any);

      // Verify TagResourceCommand called with challenge ID
      const tagCall = (mockEcsClient.prototype.send as jest.Mock).mock.calls[1][0];
      expect(tagCall.input.tags).toContainEqual({
        key: 'pipe:challenge',
        value: 'challenge-tag-test',
      });
    });
  });

  describe('Default Values and Edge Cases', () => {
    it('should use default branch names if not provided in challenge', async () => {
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      const mockDdbSend = jest.fn();
      (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({
        send: mockDdbSend,
      });

      mockDdbSend.mockResolvedValueOnce({
        Item: {
          id: 'challenge-default-branch',
          repoS3Key: 'challenge-repos/app/repo/v1/repo.tar.gz',
          // repoBranch and repoBaseBranch not provided
        },
      });

      (repoManager.generatePresignedUrl as jest.Mock).mockResolvedValueOnce({
        url: 'https://presigned-url',
        expiresAt: new Date(),
        bucket: 'bucket',
        key: 'key',
      });

      (mockEcsClient.prototype.send as jest.Mock)
        .mockResolvedValueOnce({
          tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123456789:task/test' }],
        })
        .mockResolvedValueOnce({});

      const result = await handler({
        arguments: { sessionId: 'session-default-branch', challengeId: 'challenge-default-branch' },
      } as any);

      // Verify environment has default values
      const ecsCall = (mockEcsClient.prototype.send as jest.Mock).mock.calls[0][0];
      const containerEnv = ecsCall.input.overrides.containerOverrides[0].environment;

      expect(containerEnv).toContainEqual({
        name: 'CHALLENGE_BRANCH',
        value: 'main', // Default
      });
      expect(containerEnv).toContainEqual({
        name: 'REPO_BASE_BRANCH',
        value: 'main', // Default
      });

      // Verify response
      expect((result as any).branch).toBeUndefined(); // No branch in challenge
      expect((result as any).baseBranch).toBeUndefined();
    });

    it('should handle null/undefined branch values gracefully', async () => {
      (mockSsmClient.prototype.send as jest.Mock).mockResolvedValue({
        Parameter: { Value: 'Challenge' },
      });

      const mockDdbSend = jest.fn();
      (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({
        send: mockDdbSend,
      });

      mockDdbSend.mockResolvedValueOnce({
        Item: {
          id: 'challenge-null-branch',
          repoS3Key: 'challenge-repos/app/repo/v1/repo.tar.gz',
          repoBranch: null,
          repoBaseBranch: undefined,
        },
      });

      (repoManager.generatePresignedUrl as jest.Mock).mockResolvedValueOnce({
        url: 'https://presigned-url',
        expiresAt: new Date(),
        bucket: 'bucket',
        key: 'key',
      });

      (mockEcsClient.prototype.send as jest.Mock)
        .mockResolvedValueOnce({
          tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123456789:task/test' }],
        })
        .mockResolvedValueOnce({});

      const result = await handler({
        arguments: { sessionId: 'session-null-branch', challengeId: 'challenge-null-branch' },
      } as any);

      // Should not throw
      expect(result).toHaveProperty('taskArn');
    });
  });
});
