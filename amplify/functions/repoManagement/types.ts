/**
 * STREAM 2: Phase 2 - Type Definitions for repoManagement
 *
 * Core types used throughout the repoManagement utilities.
 */

// ============================================================
// Presigned URL Types
// ============================================================

export interface GeneratePresignedUrlRequest {
  /**
   * Challenge ID for audit logging
   */
  challengeId: string;

  /**
   * Full S3 path to repository archive
   * Example: challenge-repos/storefront/slopify-coupon/v1.0.0/repo.tar.gz
   */
  repoS3Key: string;

  /**
   * Time-to-live for presigned URL in seconds
   * Default: 7200 (2 hours)
   * Maximum: 86400 (1 day)
   */
  ttlSeconds?: number;
}

export interface GeneratePresignedUrlResponse {
  /**
   * Full presigned URL that can be used to download the repository
   * Includes signature and expiration information
   */
  url: string;

  /**
   * Exact time when the presigned URL expires
   */
  expiresAt: Date;

  /**
   * S3 bucket name (for reference)
   */
  bucket: string;

  /**
   * S3 object key (for reference)
   */
  key: string;
}

// ============================================================
// Repository Metadata Types
// ============================================================

export interface BranchInfo {
  /**
   * Human-readable description of the branch
   */
  description: string;

  /**
   * Base branch for comparing diffs (e.g., "main")
   */
  baseBranch?: string;

  /**
   * Number of commits in this branch (optional)
   */
  commits?: number;

  /**
   * Author who created the branch (optional)
   */
  author?: string;

  /**
   * ISO 8601 timestamp when branch was created (optional)
   */
  createdAt?: string;
}

export interface BugEntry {
  /**
   * Unique identifier for the bug
   * Example: "pagination-off-by-one"
   */
  id: string;

  /**
   * Description of the bug
   */
  description: string;

  /**
   * Severity level
   */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Location in code (file path and line range)
   * Example: "src/server/services/couponService.ts:45-52"
   */
  location: string;

  /**
   * Expected fix or solution (optional)
   */
  expectedFix?: string;

  /**
   * Points awarded for finding this bug (optional)
   */
  points?: number;
}

export interface FeatureEntry {
  /**
   * Unique feature identifier
   */
  id: string;

  /**
   * Feature name
   */
  name: string;

  /**
   * Implementation status
   */
  status: 'planned' | 'implemented' | 'buggy' | 'deprecated';
}

export interface BuildStats {
  /**
   * Total number of files in the repository
   */
  totalFiles: number;

  /**
   * Total lines of code (approximate)
   */
  totalLines: number;

  /**
   * Number of npm/package dependencies
   */
  packageDependencies?: number;

  /**
   * Number of dev dependencies
   */
  devDependencies?: number;
}

export interface RepoMetadata {
  /**
   * Unique repository identifier
   * Example: "slopify-coupon"
   */
  repoId: string;

  /**
   * Version of this repository
   * Follows semantic versioning
   * Example: "1.0.0"
   */
  version: string;

  /**
   * Git branches available in this repository
   */
  branches: {
    [branchName: string]: BranchInfo;
  };

  /**
   * Known bugs in the repository (for code review challenges)
   */
  bugs?: BugEntry[];

  /**
   * Features/components in the repository
   */
  features?: FeatureEntry[];

  /**
   * Estimated time to complete challenge (in minutes)
   */
  estimatedTime: number;

  /**
   * Difficulty level
   */
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

  /**
   * Challenge instructions (markdown)
   */
  instructions: string;

  /**
   * Build and repository statistics
   */
  buildStats?: BuildStats;

  /**
   * Additional metadata (implementation-defined)
   */
  [key: string]: unknown;
}

// ============================================================
// Error Handling Types
// ============================================================

export interface S3ErrorResponse {
  /**
   * HTTP status code
   */
  statusCode: number;

  /**
   * AWS error code/message (technical)
   */
  message: string;

  /**
   * User-friendly error message (safe to display)
   */
  userMessage: string;
}

// ============================================================
// Lambda Handler Types
// ============================================================

export interface HandlerActionBase {
  /**
   * Action to perform
   */
  action: string;
}

export interface GeneratePresignedUrlAction extends HandlerActionBase {
  action: 'generatePresignedUrl';
  challengeId: string;
  repoS3Key: string;
  ttlSeconds?: number;
}

export interface LoadMetadataAction extends HandlerActionBase {
  action: 'loadMetadata';
  metadataS3Key: string;
  cacheKey?: string;
}

export interface GetVersionAction extends HandlerActionBase {
  action: 'getVersion';
  repoId: string;
  version: string;
}

export interface HealthCheckAction extends HandlerActionBase {
  action: 'healthCheck';
}

export type LambdaEvent = GeneratePresignedUrlAction | LoadMetadataAction | GetVersionAction | HealthCheckAction;

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ErrorDetail {
  statusCode: number;
  message: string;
  userMessage: string;
}

export interface ErrorResponseData {
  success: false;
  error: ErrorDetail;
}

export type LambdaResponse<T = unknown> = SuccessResponse<T> | ErrorResponseData;

// ============================================================
// Cache Types
// ============================================================

export interface CacheEntry<T> {
  /**
   * Cached data
   */
  data: T;

  /**
   * Timestamp when cache expires (milliseconds)
   */
  expiresAt: number;
}

// ============================================================
// Configuration Types
// ============================================================

export interface RepoManagerConfig {
  /**
   * S3 bucket name for repositories
   */
  bucketName: string;

  /**
   * AWS region
   */
  region: string;

  /**
   * DynamoDB table for RepoTemplate
   */
  repoTemplateTable: string;

  /**
   * Metadata cache TTL in seconds
   */
  metadataCacheTTL: number;

  /**
   * Default presigned URL TTL in seconds
   */
  defaultPresignedUrlTTL: number;
}

// ============================================================
// Health Check Types
// ============================================================

export interface HealthCheckResult {
  /**
   * Is the service healthy?
   */
  healthy: boolean;

  /**
   * Health status message
   */
  message: string;
}
