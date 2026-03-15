/**
 * Type definitions for scoreCodeReview Lambda
 */

export type SeverityType = 'critical' | 'major' | 'minor';

export type ReviewerLevel = 'junior' | 'mid' | 'senior';

/**
 * Annotation object used in both candidate and ground truth
 */
export interface Annotation {
  file: string; // File path (e.g., "src/utils/helpers.ts")
  line: number; // Line number (1-indexed, matching unified diff output)
  severity: SeverityType; // critical | major | minor
  comment: string; // Annotation text/comment
}

/**
 * Input to scoreCodeReview Lambda
 */
export interface ScoreCodeReviewInput {
  assessmentId: string; // ID of the assessment being scored
  candidateAnnotations: Annotation[]; // What the candidate found
  groundTruthAnnotations: Annotation[]; // What was expected
  reviewerLevel: ReviewerLevel; // junior | mid | senior
}

/**
 * Severity breakdown in the scoring result
 */
export interface SeverityBreakdownItem {
  expected: number; // How many issues of this severity were expected
  found: number; // How many the candidate found
}

export interface SeverityBreakdown {
  critical: SeverityBreakdownItem;
  major: SeverityBreakdownItem;
  minor: SeverityBreakdownItem;
}

/**
 * Scoring result data
 */
export interface ScoringData {
  assessmentId: string;
  score: number; // 0-100
  accuracy: number; // Percentage of correct annotations
  found: number; // Annotations candidate found
  missed: number; // Annotations candidate missed
  falsePositives: number; // Incorrect annotations added
  feedback: string; // Human-readable feedback
  breakdown: SeverityBreakdown; // Severity breakdown
}

/**
 * Success response from scoreCodeReview
 */
export interface ScoreCodeReviewSuccessResponse {
  success: true;
  data: ScoringData;
}

/**
 * Error response from scoreCodeReview
 */
export interface ScoreCodeReviewErrorResponse {
  success: false;
  error: string;
  statusCode: number;
}

/**
 * Combined response type
 */
export type ScoreCodeReviewResponse =
  | ScoreCodeReviewSuccessResponse
  | ScoreCodeReviewErrorResponse;

/**
 * Internal scoring result used by the algorithm
 */
export interface ScoringResult {
  score: number;
  accuracy: number;
  found: number;
  missed: number;
  falsePositives: number;
  feedback: string;
  breakdown: SeverityBreakdown;
}
