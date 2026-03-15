/**
 * Type definitions for submitCodeReview Lambda
 */

/**
 * Represents a single annotation/comment on code
 */
export interface CodeReviewAnnotation {
  /** Unique identifier for this annotation */
  id: string;

  /** Path to the file being annotated (e.g., src/index.ts) */
  filePath: string;

  /** Line number where the annotation applies (1-indexed, matching unified diff output) */
  lineNumber: number;

  /** Type of annotation: general comment, suggestion, or question */
  type: 'COMMENT' | 'SUGGESTION' | 'QUESTION';

  /** Optional severity level for this annotation */
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';

  /** The text of the annotation/comment */
  text: string;

  /** The code snippet being commented on */
  codeSnippet: string;

  /** Optional suggested code replacement */
  suggestedCode?: string;

  /** ISO 8601 timestamp when annotation was created */
  timestamp: string;
}

/**
 * Request payload for submitCodeReview mutation
 */
export interface SubmitCodeReviewRequest {
  /** ID of the Assessment record to update */
  assessmentId: string;

  /** ID of the Challenge being assessed */
  challengeId: string;

  /** ID of the candidate submitting (for audit trail) */
  userId: string;

  /** ID of the dev container session to destroy after submission */
  studioId: string;

  /** Array of annotations made by the candidate */
  codeReviewAnnotations: CodeReviewAnnotation[];

  /** Optional overall summary of the code review */
  codeReviewSummary?: string;
}

/**
 * Successful response from submitCodeReview
 */
export interface SubmitCodeReviewResponse {
  /** Indicates success */
  success: true;

  /** ID of the updated Assessment */
  assessmentId: string;

  /** ISO 8601 timestamp of submission */
  submittedAt: string;

  /** Human-readable confirmation message */
  message: string;
}

/**
 * Error response from submitCodeReview
 */
export interface SubmitCodeReviewErrorResponse {
  /** Indicates failure */
  success: false;

  /** Error description */
  error: string;

  /** HTTP-like status code */
  statusCode: number;
}

/**
 * Union type for all possible responses
 */
export type SubmitCodeReviewHandlerResponse = SubmitCodeReviewResponse | SubmitCodeReviewErrorResponse;

/**
 * Validation error details
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Assessment record with code review fields
 */
export interface AssessmentRecord {
  id: string;
  candidateId: string;
  challengeId: string;
  codeReviewAnnotations?: CodeReviewAnnotation[];
  codeReviewSummary?: string;
  submittedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
