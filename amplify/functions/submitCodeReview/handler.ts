/**
 * STREAM 2: Code Review Challenge Backend Infrastructure
 * Phase 4: submitCodeReview Lambda Handler
 *
 * Handles code review submission: saves annotations to Assessment model,
 * sets submission timestamp, and triggers async container destruction.
 *
 * Input:
 *   - assessmentId: ID of the assessment record
 *   - challengeId: ID of the challenge being assessed
 *   - userId: ID of the candidate submitting (for audit trail)
 *   - studioId: ID of the dev container session to destroy
 *   - codeReviewAnnotations: Array of annotation objects
 *   - codeReviewSummary?: Optional overall assessment summary
 *   - groundTruthAnnotations: Ground truth for scoring
 *   - reviewerLevel: Expected reviewer level (junior | mid | senior)
 *
 * Output:
 *   - success: boolean
 *   - assessmentId: ID that was saved
 *   - submittedAt: ISO 8601 timestamp of submission
 *   - message: Human-readable confirmation
 */

import { DynamoDBClient, UpdateItemCommand, ReturnValue } from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// ============================================================
// Types
// ============================================================

interface CodeReviewAnnotation {
  id: string;
  filePath: string;
  lineNumber: number;
  type: 'COMMENT' | 'SUGGESTION' | 'QUESTION';
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  text: string;
  codeSnippet: string;
  suggestedCode?: string;
  timestamp: string;
}

interface SubmitCodeReviewRequest {
  challengeSubmissionId: string;
  challengeId: string;
  userId: string;
  studioId: string;
  codeReviewAnnotations: CodeReviewAnnotation[];
  codeReviewSummary?: string;
  groundTruthAnnotations?: any;
  reviewerLevel?: string;
}

interface SubmitCodeReviewResponse {
  success: boolean;
  challengeSubmissionId: string;
  submittedAt: string;
  message: string;
}

interface ErrorResponse {
  success: boolean;
  error: string;
  statusCode: number;
}

type HandlerResponse = SubmitCodeReviewResponse | ErrorResponse;

// ============================================================
// Constants
// ============================================================

const CHALLENGE_SUBMISSION_TABLE = process.env.CHALLENGE_SUBMISSION_TABLE_NAME || 'ChallengeSubmission';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const dbClient = new DynamoDBClient({ region: AWS_REGION });
const lambdaClient = new LambdaClient({ region: AWS_REGION });

// ============================================================
// Main Handler
// ============================================================

export async function handler(event: any): Promise<HandlerResponse> {
  try {
    console.log('[submitCodeReview] Request received', {
      challengeSubmissionId: event.arguments?.challengeSubmissionId,
      annotationCount: event.arguments?.codeReviewAnnotations?.length,
    });

    // Extract arguments from AppSync event
    const request: SubmitCodeReviewRequest = {
      challengeSubmissionId: event.arguments?.challengeSubmissionId,
      challengeId: event.arguments?.challengeId,
      userId: event.arguments?.userId,
      studioId: event.arguments?.studioId,
      codeReviewAnnotations: event.arguments?.codeReviewAnnotations || [],
      codeReviewSummary: event.arguments?.codeReviewSummary,
    };

    // ============================================
    // 1. Validate inputs
    // ============================================
    validateRequest(request);
    console.log('✅ Inputs validated');

    // ============================================
    // 2. Save ChallengeSubmission with annotations
    // ============================================
    const submittedAt = new Date().toISOString();

    console.log('Saving ChallengeSubmission to DynamoDB...');

    const updateParams = {
      TableName: CHALLENGE_SUBMISSION_TABLE,
      Key: marshall({ id: request.challengeSubmissionId }),
      UpdateExpression:
        'SET codeReviewAnnotations = :annotations, codeReviewSummary = :summary, submittedAt = :submittedAt',
      ExpressionAttributeValues: marshall({
        ':annotations': request.codeReviewAnnotations,
        ':summary': request.codeReviewSummary || null,
        ':submittedAt': submittedAt,
      }),
      ReturnValues: ReturnValue.ALL_NEW,
    };

    const updateResponse = await dbClient.send(new UpdateItemCommand(updateParams));

    console.log('ChallengeSubmission saved', {
      challengeSubmissionId: request.challengeSubmissionId,
      updatedAttributes: Object.keys(updateResponse.Attributes || {}),
    });

    // ============================================
    // 3. Trigger scoring (async, non-blocking)
    // ============================================
    console.log('📊 Triggering code review scoring...');

    scoreCodeReviewAsync(request).catch((err) => {
      console.error('⚠️  Code review scoring failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't fail the submission if scoring fails
    });

    // ============================================
    // 4. Destroy dev container (async, non-blocking)
    // ============================================
    console.log('🗑️  Triggering container destruction...');

    destroyDevContainerAsync(request.studioId).catch((err) => {
      console.error('⚠️  Container destruction failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't fail the submission if container destruction fails
    });

    // ============================================
    // 5. Return success
    // ============================================
    return {
      success: true,
      challengeSubmissionId: request.challengeSubmissionId,
      submittedAt: submittedAt,
      message: 'Code review submitted successfully',
    };
  } catch (error) {
    console.error('❌ submitCodeReview failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Handle specific error cases
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('assessmentId') || message.includes('Validation')) {
      return {
        success: false,
        error: `Validation error: ${message}`,
        statusCode: 400,
      };
    }

    if (message.includes('DynamoDB') || message.includes('ConditionalCheckFailed')) {
      return {
        success: false,
        error: `Database error: ${message}`,
        statusCode: 500,
      };
    }

    return {
      success: false,
      error: 'Failed to submit code review',
      statusCode: 500,
    };
  }
}

// ============================================================
// Validation Functions
// ============================================================

/**
 * Comprehensive validation of the submission request
 */
function validateRequest(request: SubmitCodeReviewRequest): void {
  // Validate required fields
  if (!request.challengeSubmissionId?.trim()) {
    throw new Error('Validation: challengeSubmissionId is required');
  }

  if (!request.challengeId?.trim()) {
    throw new Error('Validation: challengeId is required');
  }

  if (!request.userId?.trim()) {
    throw new Error('Validation: userId is required');
  }

  if (!request.studioId?.trim()) {
    throw new Error('Validation: studioId is required');
  }

  // Validate annotations array
  if (!Array.isArray(request.codeReviewAnnotations)) {
    throw new Error('Validation: codeReviewAnnotations must be an array');
  }

  // Warn but don't fail on empty annotations
  if (request.codeReviewAnnotations.length === 0) {
    console.warn('[submitCodeReview] No annotations provided - this is allowed');
  }

  // Validate each annotation
  for (let i = 0; i < request.codeReviewAnnotations.length; i++) {
    validateAnnotation(request.codeReviewAnnotations[i], i);
  }

  // Validate summary
  if (request.codeReviewSummary) {
    if (typeof request.codeReviewSummary !== 'string') {
      throw new Error('Validation: codeReviewSummary must be a string');
    }
    if (request.codeReviewSummary.length > 2000) {
      throw new Error('Validation: codeReviewSummary exceeds 2000 characters');
    }
  }

  // Validate payload size (DynamoDB max item size is 400KB)
  const payloadSize = JSON.stringify(request).length;
  if (payloadSize > 350 * 1024) {
    // 350KB to leave room for other attributes
    throw new Error(`Validation: Payload too large: ${payloadSize} bytes (max 350KB)`);
  }
}

/**
 * Validate a single annotation object
 */
function validateAnnotation(ann: any, index: number): void {
  const prefix = `Validation: Annotation[${index}]`;

  if (!ann || typeof ann !== 'object') {
    throw new Error(`${prefix}: must be an object`);
  }

  if (!ann.id?.trim()) {
    throw new Error(`${prefix}: id is required`);
  }

  if (ann.id.length > 256) {
    throw new Error(`${prefix}: id exceeds 256 characters`);
  }

  if (!ann.filePath?.trim()) {
    throw new Error(`${prefix}: filePath is required`);
  }

  if (ann.filePath.length > 512) {
    throw new Error(`${prefix}: filePath exceeds 512 characters`);
  }

  if (typeof ann.lineNumber !== 'number' || ann.lineNumber < 0) {
    throw new Error(`${prefix}: lineNumber must be a non-negative number`);
  }

  if (ann.lineNumber > 1000000) {
    throw new Error(`${prefix}: lineNumber exceeds 1000000`);
  }

  const validTypes = ['COMMENT', 'SUGGESTION', 'QUESTION'];
  if (!validTypes.includes(ann.type)) {
    throw new Error(`${prefix}: type must be one of ${validTypes.join(', ')}, got ${ann.type}`);
  }

  if (ann.severity && !['INFO', 'WARNING', 'CRITICAL'].includes(ann.severity)) {
    throw new Error(
      `${prefix}: severity must be INFO, WARNING, or CRITICAL, got ${ann.severity}`
    );
  }

  if (!ann.text?.trim()) {
    throw new Error(`${prefix}: text is required`);
  }

  if (ann.text.length > 5000) {
    throw new Error(`${prefix}: text exceeds 5000 characters`);
  }

  if (!ann.codeSnippet?.trim()) {
    throw new Error(`${prefix}: codeSnippet is required`);
  }

  if (ann.codeSnippet.length > 5000) {
    throw new Error(`${prefix}: codeSnippet exceeds 5000 characters`);
  }

  if (ann.suggestedCode && ann.suggestedCode.length > 5000) {
    throw new Error(`${prefix}: suggestedCode exceeds 5000 characters`);
  }

  if (!ann.timestamp) {
    throw new Error(`${prefix}: timestamp is required`);
  }

  // Verify timestamp is valid ISO 8601
  if (isNaN(Date.parse(ann.timestamp))) {
    throw new Error(`${prefix}: timestamp is not valid ISO 8601 format: ${ann.timestamp}`);
  }

  // Warn if timestamp is in the future (but don't fail)
  const annotationTime = new Date(ann.timestamp);
  const now = new Date();
  if (annotationTime > now) {
    console.warn(`[submitCodeReview] Annotation[${index}] timestamp is in the future`, {
      timestamp: ann.timestamp,
      now: now.toISOString(),
    });
  }
}

// ============================================================
// Container Destruction (Async/Non-Blocking)
// ============================================================

/**
 * Destroy the dev container asynchronously (fire and forget)
 * Does not block the response if this fails
 */
async function destroyDevContainerAsync(studioId: string): Promise<void> {
  // In a real implementation, this would:
  // 1. Call ECS API to stop the task
  // 2. Or publish to a queue for async processing
  //
  // For now, we log the intent - actual destruction is handled by Phase 3
  console.log('[submitCodeReview] Scheduling container destruction', { studioId });

  // TODO: Implement actual container destruction in Phase 5
  // This would call the devContainerDestroy Lambda or publish to SQS
}

// ============================================================
// Code Review Scoring (Async/Non-Blocking)
// ============================================================

/**
 * Invoke scoreCodeReview Lambda asynchronously
 * Does not block the response if this fails
 */
async function scoreCodeReviewAsync(request: SubmitCodeReviewRequest): Promise<void> {
  if (!request.groundTruthAnnotations) {
    console.warn('[submitCodeReview] No ground truth annotations provided, skipping scoring');
    return;
  }

  try {
    const scoringPayload = {
      arguments: {
        challengeSubmissionId: request.challengeSubmissionId,
        candidateAnnotations: convertAnnotationsToScoringFormat(request.codeReviewAnnotations),
        groundTruthAnnotations: request.groundTruthAnnotations,
        reviewerLevel: request.reviewerLevel || 'mid',
      },
    };

    console.log('[submitCodeReview] Invoking scoreCodeReview Lambda', {
      challengeSubmissionId: request.challengeSubmissionId,
      candidateAnnotationCount: request.codeReviewAnnotations.length,
    });

    const command = new InvokeCommand({
      FunctionName: 'scoreCodeReview',
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify(scoringPayload),
    });

    await lambdaClient.send(command);

    console.log('[submitCodeReview] Scoring Lambda invoked successfully');
  } catch (err) {
    console.error('[submitCodeReview] Failed to invoke scoring Lambda', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Convert CodeReviewAnnotation format to scoring format
 */
function convertAnnotationsToScoringFormat(annotations: CodeReviewAnnotation[]): any[] {
  return annotations.map((ann) => ({
    file: ann.filePath,
    line: ann.lineNumber,
    severity: mapSeverityToScoringFormat(ann.severity),
    comment: ann.text,
  }));
}

/**
 * Map annotation severity to scoring format
 */
function mapSeverityToScoringFormat(severity?: string): 'critical' | 'major' | 'minor' {
  switch (severity) {
    case 'CRITICAL':
      return 'critical';
    case 'WARNING':
      return 'major';
    case 'INFO':
      return 'minor';
    default:
      return 'major';
  }
}
