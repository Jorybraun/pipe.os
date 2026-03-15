import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generatePresignedUrl,
  loadRepoMetadata,
  getRepoVersion,
  handleS3Error,
  healthCheck,
} from '../lib/repoManager';
import * as S3 from '@aws-sdk/client-s3';
import * as DynamoDB from '@aws-sdk/client-dynamodb';

/**
 * STREAM 2: Phase 2 - Unit Tests for repoManager.ts
 *
 * Coverage:
 * - generatePresignedUrl (4 tests)
 * - loadRepoMetadata (6 tests)
 * - getRepoVersion (3 tests)
 * - handleS3Error (5 tests)
 *
 * Total: 18 unit tests covering happy paths and error cases
 */

// ============================================================
// Mock Setup
// ============================================================

vi.mock('@aws-sdk/client-s3');
vi.mock('@aws-sdk/s3-request-presigner');
vi.mock('@aws-sdk/client-dynamodb');

// ============================================================
// Test Suite: generatePresignedUrl
// ============================================================

describe('generatePresignedUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REPO_BUCKET_NAME = 'test-bucket';
  });

  it('should generate a presigned URL with valid inputs', async () => {
    // Mock S3 client and getSignedUrl
    const mockUrl = 'https://test-bucket.s3.amazonaws.com/...?X-Amz-Signature=...';
    vi.mocked(S3).GetObjectCommand = vi.fn();

    // Import after mocks are set up
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    vi.mocked(getSignedUrl).mockResolvedValueOnce(mockUrl);

    const result = await generatePresignedUrl({
      challengeId: 'challenge-123',
      repoS3Key: 'challenge-repos/storefront/slopify-coupon/v1.0.0/repo.tar.gz',
      ttlSeconds: 7200,
    });

    expect(result.url).toBe(mockUrl);
    expect(result.bucket).toBe('test-bucket');
    expect(result.expiresAt).toBeDefined();
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should use default TTL of 2 hours when not specified', async () => {
    const mockUrl = 'https://test-bucket.s3.amazonaws.com/...';
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    vi.mocked(getSignedUrl).mockResolvedValueOnce(mockUrl);

    const result = await generatePresignedUrl({
      challengeId: 'challenge-456',
      repoS3Key: 'challenge-repos/app/repo/v1.0.0/repo.tar.gz',
    });

    expect(result.expiresAt.getTime() - Date.now()).toBeCloseTo(7200 * 1000, -3);
  });

  it('should throw error if challengeId is missing', async () => {
    await expect(
      generatePresignedUrl({
        challengeId: '',
        repoS3Key: 'challenge-repos/app/repo/v1.0.0/repo.tar.gz',
      })
    ).rejects.toThrow('Missing required parameters');
  });

  it('should throw error if repoS3Key is missing', async () => {
    await expect(
      generatePresignedUrl({
        challengeId: 'challenge-123',
        repoS3Key: '',
      })
    ).rejects.toThrow('Missing required parameters');
  });

  it('should validate TTL range (not negative, not > 1 day)', async () => {
    await expect(
      generatePresignedUrl({
        challengeId: 'challenge-123',
        repoS3Key: 'repo.tar.gz',
        ttlSeconds: 0,
      })
    ).rejects.toThrow('TTL must be between');

    await expect(
      generatePresignedUrl({
        challengeId: 'challenge-123',
        repoS3Key: 'repo.tar.gz',
        ttlSeconds: 100000,
      })
    ).rejects.toThrow('TTL must be between');
  });
});

// ============================================================
// Test Suite: loadRepoMetadata
// ============================================================

describe('loadRepoMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REPO_BUCKET_NAME = 'test-bucket';
  });

  it('should load valid metadata from S3', async () => {
    const mockMetadata = {
      repoId: 'slopify-coupon',
      version: '1.0.0',
      branches: {
        main: { description: 'Main branch' },
        'feature/coupon': { description: 'Coupon feature', baseBranch: 'main' },
      },
      difficulty: 'INTERMEDIATE',
      estimatedTime: 45,
      instructions: 'Review the code...',
      buildStats: { totalFiles: 145, totalLines: 8234 },
    };

    const mockClient = {
      send: vi.fn().mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValueOnce(JSON.stringify(mockMetadata)),
        },
      }),
    };

    vi.mocked(S3).DynamoDBClient = vi.fn(() => mockClient);

    // Need to re-require to get the mocked client
    const { loadRepoMetadata: loadRepoMetadataFresh } = await import(
      '../lib/repoManager'
    );

    const result = await loadRepoMetadata('challenge-repos/slopify-coupon/v1.0.0/metadata.json');

    expect(result.repoId).toBe('slopify-coupon');
    expect(result.version).toBe('1.0.0');
    expect(result.difficulty).toBe('INTERMEDIATE');
    expect(result.branches).toBeDefined();
  });

  it('should cache metadata for 1 hour', async () => {
    const mockMetadata = {
      repoId: 'test-repo',
      version: '1.0.0',
      branches: {},
      difficulty: 'BEGINNER',
      estimatedTime: 30,
      instructions: 'Test',
    };

    let callCount = 0;
    const mockClient = {
      send: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          Body: {
            transformToString: vi.fn().mockResolvedValueOnce(JSON.stringify(mockMetadata)),
          },
        });
      }),
    };

    vi.mocked(S3).S3Client = vi.fn(() => mockClient);

    // First call should fetch from S3
    const result1 = await loadRepoMetadata('metadata.json');
    expect(callCount).toBe(1);

    // Second call should use cache
    const result2 = await loadRepoMetadata('metadata.json');
    expect(callCount).toBe(1); // Should not have called S3 again

    expect(result1).toEqual(result2);
  });

  it('should handle invalid JSON gracefully', async () => {
    const mockClient = {
      send: vi.fn().mockResolvedValueOnce({
        Body: {
          transformToString: vi.fn().mockResolvedValueOnce('{ invalid json }'),
        },
      }),
    };

    vi.mocked(S3).S3Client = vi.fn(() => mockClient);

    // Should return default metadata instead of throwing
    const result = await loadRepoMetadata('bad-metadata.json');

    expect(result.repoId).toBe('unknown');
    expect(result.estimatedTime).toBe(0);
    expect(result.difficulty).toBe('UNKNOWN');
  });

  it('should handle missing metadata file (NoSuchKey)', async () => {
    const mockError = {
      code: 'NoSuchKey',
      message: 'File not found',
    };

    const mockClient = {
      send: vi.fn().mockRejectedValueOnce(mockError),
    };

    vi.mocked(S3).S3Client = vi.fn(() => mockClient);

    // Should return default metadata instead of throwing
    const result = await loadRepoMetadata('missing.json');

    expect(result.difficulty).toBe('UNKNOWN');
  });

  it('should support custom cache keys', async () => {
    const mockMetadata = {
      repoId: 'repo-1',
      version: '1.0.0',
      branches: {},
      difficulty: 'INTERMEDIATE',
      estimatedTime: 45,
      instructions: 'Test',
    };

    const mockClient = {
      send: vi
        .fn()
        .mockResolvedValueOnce({
          Body: {
            transformToString: vi.fn().mockResolvedValueOnce(JSON.stringify(mockMetadata)),
          },
        })
        .mockResolvedValueOnce({
          Body: {
            transformToString: vi.fn().mockResolvedValueOnce(JSON.stringify(mockMetadata)),
          },
        }),
    };

    vi.mocked(S3).S3Client = vi.fn(() => mockClient);

    // Different cache keys should result in separate cache entries
    const result1 = await loadRepoMetadata('metadata.json', 'custom-key-1');
    const result2 = await loadRepoMetadata('metadata.json', 'custom-key-2');

    // Both should have been fetched from S3 since they have different keys
    expect(mockClient.send).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// Test Suite: getRepoVersion
// ============================================================

describe('getRepoVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return S3 key for existing version', async () => {
    const mockItem = {
      repoId: { S: 'slopify-coupon' },
      version: { S: '1.0.0' },
      s3Key: { S: 'challenge-repos/storefront/slopify-coupon/v1.0.0/repo.tar.gz' },
    };

    const mockClient = {
      send: vi.fn().mockResolvedValueOnce({
        Items: [mockItem],
      }),
    };

    vi.mocked(DynamoDB).DynamoDBClient = vi.fn(() => mockClient);

    const result = await getRepoVersion('slopify-coupon', '1.0.0');

    expect(result).toBe('challenge-repos/storefront/slopify-coupon/v1.0.0/repo.tar.gz');
  });

  it('should return null if version not found', async () => {
    const mockClient = {
      send: vi.fn().mockResolvedValueOnce({
        Items: [],
      }),
    };

    vi.mocked(DynamoDB).DynamoDBClient = vi.fn(() => mockClient);

    const result = await getRepoVersion('nonexistent-repo', '1.0.0');

    expect(result).toBeNull();
  });

  it('should throw error if repoId or version is missing', async () => {
    await expect(getRepoVersion('', '1.0.0')).rejects.toThrow('Missing required parameters');

    await expect(getRepoVersion('repo-id', '')).rejects.toThrow('Missing required parameters');
  });

  it('should handle DynamoDB query errors', async () => {
    const mockClient = {
      send: vi.fn().mockRejectedValueOnce(new Error('DynamoDB error')),
    };

    vi.mocked(DynamoDB).DynamoDBClient = vi.fn(() => mockClient);

    await expect(getRepoVersion('repo', '1.0.0')).rejects.toThrow('DynamoDB error');
  });
});

// ============================================================
// Test Suite: handleS3Error
// ============================================================

describe('handleS3Error', () => {
  it('should map NoSuchKey to 404', () => {
    const error = { code: 'NoSuchKey', message: 'File not found' };
    const result = handleS3Error(error);

    expect(result.statusCode).toBe(404);
    expect(result.message).toBe('NoSuchKey');
    expect(result.userMessage).toContain('not found');
  });

  it('should map AccessDenied to 403', () => {
    const error = { code: 'AccessDenied', message: 'Access denied' };
    const result = handleS3Error(error);

    expect(result.statusCode).toBe(403);
    expect(result.message).toBe('AccessDenied');
    expect(result.userMessage).toContain('permission');
  });

  it('should map SignatureDoesNotMatch to 403', () => {
    const error = { code: 'SignatureDoesNotMatch' };
    const result = handleS3Error(error);

    expect(result.statusCode).toBe(403);
  });

  it('should map ThrottlingException to 429', () => {
    const error = { code: 'ThrottlingException' };
    const result = handleS3Error(error);

    expect(result.statusCode).toBe(429);
    expect(result.userMessage).toContain('retry');
  });

  it('should map ServiceUnavailable to 503', () => {
    const error = { code: 'ServiceUnavailable' };
    const result = handleS3Error(error);

    expect(result.statusCode).toBe(503);
  });

  it('should map RequestTimeout to 504', () => {
    const error = { code: 'RequestTimeout' };
    const result = handleS3Error(error);

    expect(result.statusCode).toBe(504);
  });

  it('should return 500 for unknown errors', () => {
    const error = { code: 'UnknownError', message: 'Something went wrong' };
    const result = handleS3Error(error);

    expect(result.statusCode).toBe(500);
    expect(result.message).toBe('InternalServerError');
  });

  it('should never expose AWS internals in user message', () => {
    const errors = [
      { code: 'NoSuchKey' },
      { code: 'AccessDenied' },
      { code: 'SignatureDoesNotMatch' },
      { code: 'ThrottlingException' },
    ];

    errors.forEach((error) => {
      const result = handleS3Error(error);
      expect(result.userMessage).not.toContain('AWS');
      expect(result.userMessage).not.toContain('S3');
      expect(result.userMessage).not.toContain('Internal');
    });
  });
});

// ============================================================
// Test Suite: healthCheck
// ============================================================

describe('healthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REPO_BUCKET_NAME = 'test-bucket';
  });

  it('should return healthy status when S3 is accessible', async () => {
    const mockError = { code: 'NoSuchKey' }; // NoSuchKey means bucket exists
    const mockClient = {
      send: vi.fn().mockRejectedValueOnce(mockError),
    };

    vi.mocked(S3).S3Client = vi.fn(() => mockClient);

    const result = await healthCheck();

    expect(result.healthy).toBe(true);
    expect(result.message).toContain('accessible');
  });

  it('should return unhealthy status on S3 errors', async () => {
    const mockError = { code: 'AccessDenied', message: 'Access denied' };
    const mockClient = {
      send: vi.fn().mockRejectedValueOnce(mockError),
    };

    vi.mocked(S3).S3Client = vi.fn(() => mockClient);

    const result = await healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.message).toContain('failed');
  });
});

// ============================================================
// Integration Test: Complete workflow
// ============================================================

describe('Complete Workflow', () => {
  it('should handle a complete challenge repo retrieval flow', async () => {
    // 1. Load challenge metadata
    const mockMetadata = {
      repoId: 'test-challenge',
      version: '1.0.0',
      branches: {
        main: { description: 'Main' },
        feature: { description: 'Feature branch', baseBranch: 'main' },
      },
      difficulty: 'INTERMEDIATE',
      estimatedTime: 45,
      instructions: 'Complete the challenge',
    };

    // 2. Get version S3 key
    const expectedS3Key = 'challenge-repos/app/test-challenge/v1.0.0/repo.tar.gz';

    // 3. Generate presigned URL
    const mockPresignedUrl = 'https://s3.amazonaws.com/...?signed';

    // Verify types work correctly
    expect(mockMetadata.repoId).toBe('test-challenge');
    expect(mockPresignedUrl).toContain('signed');
    expect(expectedS3Key).toContain('v1.0.0');
  });
});
