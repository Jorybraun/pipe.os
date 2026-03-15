import {
  generatePresignedUrl,
  loadRepoMetadata,
  getRepoVersion,
  handleS3Error,
  healthCheck,
  GeneratePresignedUrlResponse,
  RepoMetadata,
  S3ErrorResponse,
} from './lib/repoManager';

/**
 * STREAM 2: Code Review Challenge Backend Infrastructure
 * Phase 2: repoManagement Lambda Handler
 *
 * This Lambda function exposes repoManager utilities to the frontend and other Lambdas.
 *
 * Supported actions:
 * - generatePresignedUrl: Generate S3 presigned URL for repository download
 * - loadMetadata: Load and cache repository metadata
 * - getVersion: Query DynamoDB for repository version S3 key
 * - healthCheck: Verify service health
 */

// ============================================================
// Types
// ============================================================

interface GeneratePresignedUrlAction {
  action: 'generatePresignedUrl';
  challengeId: string;
  repoS3Key: string;
  ttlSeconds?: number;
}

interface LoadMetadataAction {
  action: 'loadMetadata';
  metadataS3Key: string;
  cacheKey?: string;
}

interface GetVersionAction {
  action: 'getVersion';
  repoId: string;
  version: string;
}

interface HealthCheckAction {
  action: 'healthCheck';
}

type HandlerEvent = GeneratePresignedUrlAction | LoadMetadataAction | GetVersionAction | HealthCheckAction;

interface SuccessResponse<T> {
  success: true;
  data: T;
}

interface ErrorResponse {
  success: false;
  error: {
    statusCode: number;
    message: string;
    userMessage: string;
  };
}

type HandlerResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

// ============================================================
// Lambda Handler
// ============================================================

/**
 * Main Lambda handler that routes requests to repoManager functions
 */
export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const startTime = Date.now();

  console.log('[repoManagement.handler] Request received', {
    action: event.action,
    timestamp: new Date().toISOString(),
  });

  try {
    // Route to appropriate action
    switch (event.action) {
      case 'generatePresignedUrl':
        return await handleGeneratePresignedUrl(event as GeneratePresignedUrlAction, startTime);

      case 'loadMetadata':
        return await handleLoadMetadata(event as LoadMetadataAction, startTime);

      case 'getVersion':
        return await handleGetVersion(event as GetVersionAction, startTime);

      case 'healthCheck':
        return await handleHealthCheck(startTime);

      default: {
        const unknownAction = String((event as Record<string, unknown>).action ?? 'unknown');
        console.warn('[repoManagement.handler] Unknown action', {
          action: unknownAction,
        });
        return {
          success: false,
          error: {
            statusCode: 400,
            message: 'InvalidAction',
            userMessage: `Unknown action: ${unknownAction}`,
          },
        };
      }
    }
  } catch (error) {
    // Catch-all error handler
    console.error('[repoManagement.handler] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration: Date.now() - startTime,
    });

    // Try to map S3 errors
    if (error instanceof Error && error.message.includes('S3') && error.message.includes('Error')) {
      const s3Error = handleS3Error(error);
      return {
        success: false,
        error: s3Error,
      };
    }

    return {
      success: false,
      error: {
        statusCode: 500,
        message: 'InternalServerError',
        userMessage: 'An internal error occurred. Please try again later.',
      },
    };
  }
}

// ============================================================
// Action Handlers
// ============================================================

/**
 * Handle generatePresignedUrl action
 */
async function handleGeneratePresignedUrl(
  event: GeneratePresignedUrlAction,
  startTime: number
): Promise<HandlerResponse<GeneratePresignedUrlResponse>> {
  try {
    // Validate required fields
    if (!event.challengeId || !event.repoS3Key) {
      console.warn('[repoManagement.handleGeneratePresignedUrl] Missing required parameters', {
        hasChallengeId: !!event.challengeId,
        hasRepoS3Key: !!event.repoS3Key,
      });

      return {
        success: false,
        error: {
          statusCode: 400,
          message: 'MissingParameters',
          userMessage: 'Missing required parameters: challengeId, repoS3Key',
        },
      };
    }

    // Call repoManager
    const result = await generatePresignedUrl({
      challengeId: event.challengeId,
      repoS3Key: event.repoS3Key,
      ttlSeconds: event.ttlSeconds,
    });

    console.log('[repoManagement.handleGeneratePresignedUrl] ✅ Success', {
      challengeId: event.challengeId,
      expiresAt: result.expiresAt.toISOString(),
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('[repoManagement.handleGeneratePresignedUrl] ❌ Error', {
      challengeId: event.challengeId,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });

    // Map S3 errors
    const s3Error = handleS3Error(error);
    return {
      success: false,
      error: s3Error,
    };
  }
}

/**
 * Handle loadMetadata action
 */
async function handleLoadMetadata(
  event: LoadMetadataAction,
  startTime: number
): Promise<HandlerResponse<RepoMetadata>> {
  try {
    // Validate required fields
    if (!event.metadataS3Key) {
      console.warn('[repoManagement.handleLoadMetadata] Missing required parameters', {
        hasMetadataS3Key: !!event.metadataS3Key,
      });

      return {
        success: false,
        error: {
          statusCode: 400,
          message: 'MissingParameters',
          userMessage: 'Missing required parameter: metadataS3Key',
        },
      };
    }

    // Call repoManager
    const result = await loadRepoMetadata(event.metadataS3Key, event.cacheKey);

    console.log('[repoManagement.handleLoadMetadata] ✅ Success', {
      repoId: result.repoId,
      version: result.version,
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('[repoManagement.handleLoadMetadata] ❌ Error', {
      metadataS3Key: event.metadataS3Key,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });

    // Map S3 errors
    const s3Error = handleS3Error(error);
    return {
      success: false,
      error: s3Error,
    };
  }
}

/**
 * Handle getVersion action
 */
async function handleGetVersion(
  event: GetVersionAction,
  startTime: number
): Promise<HandlerResponse<string | null>> {
  try {
    // Validate required fields
    if (!event.repoId || !event.version) {
      console.warn('[repoManagement.handleGetVersion] Missing required parameters', {
        hasRepoId: !!event.repoId,
        hasVersion: !!event.version,
      });

      return {
        success: false,
        error: {
          statusCode: 400,
          message: 'MissingParameters',
          userMessage: 'Missing required parameters: repoId, version',
        },
      };
    }

    // Call repoManager
    const result = await getRepoVersion(event.repoId, event.version);

    console.log('[repoManagement.handleGetVersion] ✅ Success', {
      repoId: event.repoId,
      version: event.version,
      found: !!result,
      duration: Date.now() - startTime,
    });

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('[repoManagement.handleGetVersion] ❌ Error', {
      repoId: event.repoId,
      version: event.version,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });

    return {
      success: false,
      error: {
        statusCode: 500,
        message: 'InternalServerError',
        userMessage: 'Failed to retrieve version information.',
      },
    };
  }
}

/**
 * Handle healthCheck action
 */
async function handleHealthCheck(startTime: number): Promise<HandlerResponse> {
  try {
    const result = await healthCheck();

    console.log('[repoManagement.handleHealthCheck] ✅ Health check complete', {
      healthy: result.healthy,
      duration: Date.now() - startTime,
    });

    return {
      success: true as const,
      data: result,
    };
  } catch (error) {
    console.error('[repoManagement.handleHealthCheck] ❌ Error', {
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });

    return {
      success: false,
      error: {
        statusCode: 500,
        message: 'HealthCheckFailed',
        userMessage: 'Service health check failed.',
      },
    };
  }
}

// ============================================================
// Export handler
// ============================================================

