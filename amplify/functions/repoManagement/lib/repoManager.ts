import { S3Client, GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

/**
 * STREAM 2: Code Review Challenge Backend Infrastructure
 * Phase 2: S3 Integration & Repository Management
 *
 * This module provides utilities for:
 * - Generating presigned S3 URLs for repository archives (2-hour TTL)
 * - Loading and caching repository metadata (1-hour TTL)
 * - Querying DynamoDB for repository template versions
 * - Mapping S3 errors to user-friendly HTTP responses
 */

// ============================================================
// Types
// ============================================================

export interface GeneratePresignedUrlRequest {
  challengeId: string;
  repoS3Key: string;
  ttlSeconds?: number; // Default: 7200 (2 hours)
}

export interface GeneratePresignedUrlResponse {
  url: string; // Full presigned URL
  expiresAt: Date;
  bucket: string;
  key: string;
}

export interface RepoMetadata {
  repoId: string;
  version: string;
  branches: {
    [key: string]: {
      description: string;
      baseBranch?: string;
      commits?: number;
      author?: string;
      createdAt?: string;
    };
  };
  bugs?: Array<{
    id: string;
    description: string;
    severity: string;
    location: string;
    expectedFix?: string;
    points?: number;
  }>;
  estimatedTime: number;
  difficulty: string;
  instructions: string;
  buildStats?: {
    totalFiles: number;
    totalLines: number;
    packageDependencies?: number;
    devDependencies?: number;
  };
  features?: Array<{
    id: string;
    name: string;
    status: string;
  }>;
}

export interface S3ErrorResponse {
  statusCode: number;
  message: string;
  userMessage: string;
}

// ============================================================
// Configuration
// ============================================================

const BUCKET_NAME = process.env.REPO_BUCKET_NAME || 'pipe-challenges-prod';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const DEFAULT_TTL_SECONDS = 7200; // 2 hours
const METADATA_CACHE_TTL_SECONDS = 3600; // 1 hour

// ============================================================
// Cache Management
// ============================================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const metadataCache = new Map<string, CacheEntry<RepoMetadata>>();

/**
 * Get from cache if not expired
 */
function getFromCache(key: string): RepoMetadata | null {
  const entry = metadataCache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    metadataCache.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Store in cache with TTL
 */
function setInCache(key: string, data: RepoMetadata, ttlSeconds: number): void {
  metadataCache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

// ============================================================
// AWS Clients
// ============================================================

const s3Client = new S3Client({ region: AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });

// ============================================================
// Function 1: generatePresignedUrl
// ============================================================

/**
 * Generate a presigned URL for downloading a repository archive from S3.
 *
 * Features:
 * - Read-only GetObject permission (no PutObject)
 * - Configurable TTL (default: 2 hours)
 * - Returns expiration timestamp
 * - CloudWatch logging
 * - Comprehensive error handling
 *
 * @param request - GeneratePresignedUrlRequest
 * @returns GeneratePresignedUrlResponse with URL and metadata
 * @throws Error if URL generation fails
 */
export async function generatePresignedUrl(
  request: GeneratePresignedUrlRequest
): Promise<GeneratePresignedUrlResponse> {
  const { challengeId, repoS3Key, ttlSeconds = DEFAULT_TTL_SECONDS } = request;

  console.log('[repoManager.generatePresignedUrl] Generating presigned URL', {
    challengeId,
    repoS3Key,
    ttlSeconds,
  });

  try {
    // Validate inputs
    if (!challengeId || !repoS3Key) {
      throw new Error('Missing required parameters: challengeId, repoS3Key');
    }

    if (ttlSeconds <= 0 || ttlSeconds > 86400) {
      throw new Error('TTL must be between 1 and 86400 seconds');
    }

    // Create S3 GetObject command (read-only)
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: repoS3Key,
    });

    // Generate presigned URL
    const url = await getSignedUrl(s3Client, command, {
      expiresIn: ttlSeconds,
    });

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    console.log('[repoManager.generatePresignedUrl] ✅ URL generated successfully', {
      challengeId,
      bucket: BUCKET_NAME,
      keyPrefix: repoS3Key.substring(0, 50),
      expiresIn: ttlSeconds,
      expiresAt: expiresAt.toISOString(),
    });

    return {
      url,
      expiresAt,
      bucket: BUCKET_NAME,
      key: repoS3Key,
    };
  } catch (error) {
    console.error('[repoManager.generatePresignedUrl] ❌ Error:', {
      challengeId,
      repoS3Key,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================
// Function 2: loadRepoMetadata
// ============================================================

/**
 * Load repository metadata from S3 JSON file with caching.
 *
 * Features:
 * - 1-hour in-memory cache to prevent repeated S3 calls
 * - Metadata validation and error recovery
 * - CloudWatch logging (cache hits vs. S3 fetches)
 * - Graceful fallback for malformed JSON
 *
 * @param metadataS3Key - S3 path to metadata.json
 * @param cacheKey - Optional custom cache key (default: metadata:{S3Key})
 * @returns RepoMetadata object
 * @throws Error if S3 fetch fails critically
 */
export async function loadRepoMetadata(
  metadataS3Key: string,
  cacheKey?: string
): Promise<RepoMetadata> {
  const key = cacheKey || `metadata:${metadataS3Key}`;

  console.log('[repoManager.loadRepoMetadata] Loading metadata', {
    s3Key: metadataS3Key,
    cacheKey: key,
  });

  try {
    // Check cache first
    const cached = getFromCache(key);
    if (cached) {
      console.log('[repoManager.loadRepoMetadata] ✅ Cache hit', {
        cacheKey: key,
        repoId: cached.repoId,
      });
      return cached;
    }

    console.log('[repoManager.loadRepoMetadata] Cache miss, fetching from S3', {
      s3Key: metadataS3Key,
    });

    // Fetch from S3
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: metadataS3Key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error('S3 response body is empty');
    }

    // Convert stream to string
    const bodyString = await response.Body.transformToString('utf-8');

    // Parse JSON
    let metadata: RepoMetadata;
    try {
      metadata = JSON.parse(bodyString) as RepoMetadata;
    } catch (parseError) {
      console.warn('[repoManager.loadRepoMetadata] ⚠️ Malformed JSON, returning defaults', {
        s3Key: metadataS3Key,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });

      // Return minimal valid metadata
      metadata = {
        repoId: 'unknown',
        version: 'unknown',
        branches: {},
        estimatedTime: 0,
        difficulty: 'UNKNOWN',
        instructions: 'Unable to load repository metadata. Please contact support.',
      };
    }

    // Validate required fields
    if (!metadata.repoId || !metadata.version || !metadata.difficulty || !metadata.estimatedTime) {
      console.warn('[repoManager.loadRepoMetadata] ⚠️ Missing required fields', {
        s3Key: metadataS3Key,
        hasRepoId: !!metadata.repoId,
        hasVersion: !!metadata.version,
        hasDifficulty: !!metadata.difficulty,
        hasEstimatedTime: !!metadata.estimatedTime,
      });
    }

    // Cache the result
    setInCache(key, metadata, METADATA_CACHE_TTL_SECONDS);

    console.log('[repoManager.loadRepoMetadata] ✅ Metadata fetched and cached', {
      repoId: metadata.repoId,
      version: metadata.version,
      difficulty: metadata.difficulty,
      cacheTTL: METADATA_CACHE_TTL_SECONDS,
    });

    return metadata;
  } catch (error) {
    console.error('[repoManager.loadRepoMetadata] ❌ Error:', {
      metadataS3Key,
      error: error instanceof Error ? error.message : String(error),
    });

    // Return minimal fallback metadata instead of throwing
    // This prevents complete failure if metadata fetch fails
    return {
      repoId: 'unknown',
      version: 'unknown',
      branches: {},
      estimatedTime: 0,
      difficulty: 'UNKNOWN',
      instructions: 'Metadata unavailable',
    };
  }
}

// ============================================================
// Function 3: getRepoVersion
// ============================================================

/**
 * Query DynamoDB RepoTemplate table for a specific repository version.
 *
 * Features:
 * - Looks up RepoTemplate by repoId and version
 * - Returns S3 key for that version
 * - CloudWatch logging
 * - Proper error handling
 *
 * @param repoId - Repository ID (e.g., "slopify-coupon")
 * @param version - Version string (e.g., "1.0.0")
 * @returns S3 key for the version, or null if not found
 * @throws Error if DynamoDB query fails
 */
export async function getRepoVersion(
  repoId: string,
  version: string
): Promise<string | null> {
  console.log('[repoManager.getRepoVersion] Querying DynamoDB', {
    repoId,
    version,
  });

  try {
    // Validate inputs
    if (!repoId || !version) {
      throw new Error('Missing required parameters: repoId, version');
    }

    // Query RepoTemplate table
    // Note: This assumes RepoTemplate table exists with proper GSI
    const tableName = process.env.REPO_TEMPLATE_TABLE || 'RepoTemplate';

    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'repoId = :repoId AND #version = :version',
      ExpressionAttributeNames: {
        '#version': 'version',
      },
      ExpressionAttributeValues: {
        ':repoId': { S: repoId },
        ':version': { S: version },
      },
    });

    const response = await dynamoClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      console.log('[repoManager.getRepoVersion] Version not found', {
        repoId,
        version,
      });
      return null;
    }

    // Unmarshall DynamoDB item
    const item = unmarshall(response.Items[0]);
    const s3Key = (item as any).s3Key;

    if (!s3Key) {
      console.warn('[repoManager.getRepoVersion] ⚠️ s3Key missing from item', {
        repoId,
        version,
      });
      return null;
    }

    console.log('[repoManager.getRepoVersion] ✅ Version found', {
      repoId,
      version,
      s3KeyPrefix: s3Key.substring(0, 50),
    });

    return s3Key;
  } catch (error) {
    console.error('[repoManager.getRepoVersion] ❌ Error:', {
      repoId,
      version,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================
// Function 4: handleS3Error
// ============================================================

/**
 * Map S3 errors to user-friendly HTTP responses.
 *
 * Features:
 * - Converts AWS SDK errors to HTTP status codes
 * - Provides user-safe error messages (no AWS internals exposed)
 * - Comprehensive error logging
 *
 * Supported error mappings:
 * - NoSuchKey → 404 "Repository not found"
 * - AccessDenied → 403 "Permission denied"
 * - SignatureDoesNotMatch → 403 "Invalid credentials"
 * - ThrottlingException → 429 "Service busy, please retry"
 * - Network errors → 503 "Service unavailable"
 * - Unknown → 500 "Repository service error"
 *
 * @param error - Any error object from S3 operations
 * @returns S3ErrorResponse with status code and messages
 */
export function handleS3Error(error: any): S3ErrorResponse {
  // Log full error for debugging
  console.error('[repoManager.handleS3Error] Processing S3 error', {
    errorName: error?.name,
    errorCode: error?.$metadata?.httpStatusCode || error?.code,
    errorMessage: error?.message,
    fullError: JSON.stringify(error, null, 2),
  });

  // Determine error type and map to response
  const errorCode = error?.code || error?.name || '';
  const httpStatus = error?.$metadata?.httpStatusCode;

  // NoSuchKey - Repository or file not found
  if (errorCode === 'NoSuchKey' || httpStatus === 404) {
    return {
      statusCode: 404,
      message: 'NoSuchKey',
      userMessage: 'Repository archive not found. Please check the S3 path or contact your administrator.',
    };
  }

  // AccessDenied - Permission issue
  if (errorCode === 'AccessDenied' || httpStatus === 403) {
    return {
      statusCode: 403,
      message: 'AccessDenied',
      userMessage:
        'You do not have permission to access this repository. Please contact your administrator.',
    };
  }

  // SignatureDoesNotMatch - Invalid AWS credentials
  if (errorCode === 'SignatureDoesNotMatch') {
    return {
      statusCode: 403,
      message: 'SignatureDoesNotMatch',
      userMessage: 'Authentication failed. Please try again or contact support.',
    };
  }

  // ThrottlingException - S3 rate limited
  if (errorCode === 'ThrottlingException' || httpStatus === 429) {
    return {
      statusCode: 429,
      message: 'ThrottlingException',
      userMessage: 'Service is busy. Please retry in a few moments.',
    };
  }

  // ServiceUnavailable - S3 service down
  if (errorCode === 'ServiceUnavailable' || httpStatus === 503) {
    return {
      statusCode: 503,
      message: 'ServiceUnavailable',
      userMessage: 'Repository service is temporarily unavailable. Please try again later.',
    };
  }

  // Network timeout
  if (
    errorCode === 'RequestTimeout' ||
    errorCode === 'TimeoutError' ||
    error?.message?.includes('timeout')
  ) {
    return {
      statusCode: 504,
      message: 'RequestTimeout',
      userMessage: 'Request timed out. Please try again.',
    };
  }

  // Default - Unknown error
  console.warn('[repoManager.handleS3Error] Unknown error type, returning 500', {
    errorCode,
    httpStatus,
  });

  return {
    statusCode: 500,
    message: 'InternalServerError',
    userMessage: 'An error occurred while processing your request. Please try again later.',
  };
}

// ============================================================
// Health Check
// ============================================================

/**
 * Verify S3 connectivity and configuration
 */
export async function healthCheck(): Promise<{ healthy: boolean; message: string }> {
  try {
    console.log('[repoManager.healthCheck] Starting health check');

    // Try to list objects in bucket (will fail if bucket doesn't exist or no permission)
    // We just need to verify connectivity, so we'll use a minimal approach
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: 'healthcheck-marker.txt',
    });

    try {
      await s3Client.send(command);
    } catch (error: any) {
      // NoSuchKey is OK - it means the bucket is accessible
      if (error?.code === 'NoSuchKey') {
        console.log('[repoManager.healthCheck] ✅ S3 bucket is accessible');
        return { healthy: true, message: 'S3 bucket is accessible' };
      }
      // Any other error means connectivity issue
      throw error;
    }

    return { healthy: true, message: 'repoManager is healthy' };
  } catch (error) {
    console.error('[repoManager.healthCheck] ❌ Health check failed', error);
    return {
      healthy: false,
      message: `repoManager health check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================
// Export all functions
// ============================================================

export default {
  generatePresignedUrl,
  loadRepoMetadata,
  getRepoVersion,
  handleS3Error,
  healthCheck,
};
