/**
 * STREAM 2: Code Review Challenge Backend Infrastructure
 * Phase 4: scoreCodeReview Lambda Handler
 *
 * Evaluates candidate code review annotations against ground truth.
 * Compares what the candidate found vs. what was expected.
 *
 * Input:
 *   - assessmentId: ID of the assessment being scored
 *   - candidateAnnotations: Array of annotations candidate added
 *   - groundTruthAnnotations: Expected annotations by reviewer level
 *   - reviewerLevel: Expected reviewer level (junior | mid | senior)
 *
 * Output:
 *   - success: boolean
 *   - data: Scoring results (if success)
 *     - assessmentId: string
 *     - score: number (0-100)
 *     - accuracy: number (percentage of correct annotations)
 *     - found: number (annotations candidate found)
 *     - missed: number (annotations candidate missed)
 *     - falsePositives: number (incorrect annotations)
 *     - feedback: string (human-readable feedback)
 *     - breakdown: Object with severity breakdown
 *   - error: string (if !success)
 *   - statusCode: number
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  ScoreCodeReviewInput,
  ScoreCodeReviewResponse,
  ScoringResult,
  Annotation,
  SeverityType,
} from './types';

// ============================================================
// Types
// ============================================================

interface MatchedAnnotation {
  candidateIndex: number;
  groundTruthIndex: number;
  distance: number; // Line number distance
  severity: SeverityType;
}

interface SeverityBreakdown {
  critical: { expected: number; found: number };
  major: { expected: number; found: number };
  minor: { expected: number; found: number };
}

// ============================================================
// Constants
// ============================================================

const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME || 'Assessment';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const dbClient = new DynamoDBClient({ region: AWS_REGION });

// Severity weights for scoring
const SEVERITY_WEIGHTS: Record<SeverityType, number> = {
  critical: 1.0,
  major: 0.8,
  minor: 0.6,
};

// Line number tolerance for matching (±1 line)
const LINE_TOLERANCE = 1;

// Severity tolerance for matching (±1 level)
const SEVERITY_TOLERANCE = 1;

const SEVERITY_ORDER: SeverityType[] = ['critical', 'major', 'minor'];

// ============================================================
// Main Handler
// ============================================================

export async function handler(event: any): Promise<ScoreCodeReviewResponse> {
  try {
    console.log('[scoreCodeReview] Request received', {
      assessmentId: event.arguments?.assessmentId,
      candidateAnnotationCount: event.arguments?.candidateAnnotations?.length,
      groundTruthAnnotationCount: event.arguments?.groundTruthAnnotations?.length,
    });

    // Extract arguments
    const request: ScoreCodeReviewInput = {
      assessmentId: event.arguments?.assessmentId,
      candidateAnnotations: event.arguments?.candidateAnnotations || [],
      groundTruthAnnotations: event.arguments?.groundTruthAnnotations || [],
      reviewerLevel: event.arguments?.reviewerLevel || 'mid',
    };

    // ============================================
    // 1. Validate inputs
    // ============================================
    validateInput(request);
    console.log('✅ Inputs validated');

    // ============================================
    // 2. Score the review
    // ============================================
    const result = scoreReview(request);
    console.log('📊 Scoring complete', {
      assessmentId: request.assessmentId,
      score: result.score,
      accuracy: result.accuracy,
      found: result.found,
      missed: result.missed,
      falsePositives: result.falsePositives,
    });

    // ============================================
    // 3. Save score to Assessment
    // ============================================
    console.log('💾 Updating Assessment with score...');

    const updateParams = {
      TableName: ASSESSMENT_TABLE,
      Key: marshall({ id: request.assessmentId }),
      UpdateExpression: 'SET score = :score, feedbackNotes = :feedback, scoredAt = :scoredAt',
      ExpressionAttributeValues: marshall({
        ':score': result.score,
        ':feedback': result.feedback,
        ':scoredAt': new Date().toISOString(),
      }),
      ReturnValues: 'ALL_NEW',
    };

    const updateResponse = await dbClient.send(new UpdateItemCommand(updateParams));

    console.log('✅ Assessment updated with score', {
      assessmentId: request.assessmentId,
    });

    // ============================================
    // 4. Return success
    // ============================================
    return {
      success: true,
      data: {
        assessmentId: request.assessmentId,
        score: result.score,
        accuracy: result.accuracy,
        found: result.found,
        missed: result.missed,
        falsePositives: result.falsePositives,
        feedback: result.feedback,
        breakdown: result.breakdown,
      },
    };
  } catch (error) {
    console.error('❌ scoreCodeReview failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('Validation')) {
      return {
        success: false,
        error: message,
        statusCode: 400,
      };
    }

    if (message.includes('NO_GROUND_TRUTH')) {
      return {
        success: false,
        error: 'No ground truth annotations available for this challenge',
        statusCode: 400,
      };
    }

    if (message.includes('DynamoDB')) {
      return {
        success: false,
        error: 'Database error while saving score',
        statusCode: 500,
      };
    }

    return {
      success: false,
      error: 'Failed to score code review',
      statusCode: 500,
    };
  }
}

// ============================================================
// Validation
// ============================================================

/**
 * Validate the scoring input
 */
function validateInput(request: ScoreCodeReviewInput): void {
  if (!request.assessmentId?.trim()) {
    throw new Error('Validation: assessmentId is required');
  }

  if (!Array.isArray(request.candidateAnnotations)) {
    throw new Error('Validation: candidateAnnotations must be an array');
  }

  if (!Array.isArray(request.groundTruthAnnotations)) {
    throw new Error('Validation: groundTruthAnnotations must be an array');
  }

  if (!['junior', 'mid', 'senior'].includes(request.reviewerLevel)) {
    throw new Error('Validation: reviewerLevel must be junior, mid, or senior');
  }

  // Validate each candidate annotation
  for (let i = 0; i < request.candidateAnnotations.length; i++) {
    validateAnnotation(request.candidateAnnotations[i], i, 'candidate');
  }

  // Validate each ground truth annotation
  for (let i = 0; i < request.groundTruthAnnotations.length; i++) {
    validateAnnotation(request.groundTruthAnnotations[i], i, 'groundTruth');
  }
}

/**
 * Validate a single annotation object
 */
function validateAnnotation(ann: any, index: number, type: string): void {
  const prefix = `Validation: ${type}Annotation[${index}]`;

  if (!ann || typeof ann !== 'object') {
    throw new Error(`${prefix}: must be an object`);
  }

  if (!ann.file?.trim()) {
    throw new Error(`${prefix}: file is required`);
  }

  if (typeof ann.line !== 'number' || ann.line < 0) {
    throw new Error(`${prefix}: line must be a non-negative number`);
  }

  const validSeverities = ['critical', 'major', 'minor'];
  if (!validSeverities.includes(ann.severity?.toLowerCase())) {
    throw new Error(`${prefix}: severity must be critical, major, or minor`);
  }

  if (!ann.comment?.trim()) {
    throw new Error(`${prefix}: comment is required`);
  }
}

// ============================================================
// Scoring Algorithm
// ============================================================

/**
 * Score the candidate's review against ground truth
 *
 * Algorithm:
 * 1. For each ground truth annotation, find if candidate found it
 * 2. Match by file + line (±tolerance) + severity (±tolerance)
 * 3. Track: found, missed, false positives
 * 4. Calculate weighted score
 * 5. Generate feedback
 */
function scoreReview(request: ScoreCodeReviewInput): ScoringResult {
  const { candidateAnnotations, groundTruthAnnotations, reviewerLevel } = request;

  // Handle edge cases
  if (groundTruthAnnotations.length === 0) {
    // Empty ground truth = vacuous truth (no issues expected, perfect score if no false positives)
    const falsePositives = candidateAnnotations.length;
    return {
      score: falsePositives === 0 ? 100 : Math.max(0, 100 - falsePositives * 5),
      accuracy: 100,
      found: 0,
      missed: 0,
      falsePositives,
      feedback: `No issues were expected. ${falsePositives === 0 ? 'Correct!' : `You identified ${falsePositives} issues that we didn't expect.`}`,
      breakdown: { critical: { expected: 0, found: 0 }, major: { expected: 0, found: 0 }, minor: { expected: 0, found: 0 } },
    };
  }

  if (candidateAnnotations.length === 0) {
    // No annotations submitted
    return {
      score: 0,
      accuracy: 0,
      found: 0,
      missed: groundTruthAnnotations.length,
      falsePositives: 0,
      feedback: `You submitted no annotations. There were ${groundTruthAnnotations.length} issues to find. Review carefully and try again.`,
      breakdown: buildBreakdown(groundTruthAnnotations, []),
    };
  }

  // ============================================
  // Matching Algorithm
  // ============================================

  const matchedCandidateIndices = new Set<number>();
  const matches: MatchedAnnotation[] = [];

  // For each ground truth, find best candidate match
  for (let gtIndex = 0; gtIndex < groundTruthAnnotations.length; gtIndex++) {
    const gt = groundTruthAnnotations[gtIndex];
    let bestMatch: MatchedAnnotation | null = null;

    for (let candIndex = 0; candIndex < candidateAnnotations.length; candIndex++) {
      if (matchedCandidateIndices.has(candIndex)) {
        continue; // Already matched
      }

      const cand = candidateAnnotations[candIndex];

      // Check if annotations match
      const isMatch = annotationsMatch(cand, gt);

      if (isMatch) {
        const distance = Math.abs(cand.line - gt.line);

        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = {
            candidateIndex: candIndex,
            groundTruthIndex: gtIndex,
            distance,
            severity: normalizeSeverity(gt.severity),
          };
        }
      }
    }

    // If we found a match, record it
    if (bestMatch) {
      matches.push(bestMatch);
      matchedCandidateIndices.add(bestMatch.candidateIndex);
    }
  }

  // ============================================
  // Calculate Metrics
  // ============================================

  const found = matches.length;
  const missed = groundTruthAnnotations.length - found;
  const falsePositives = candidateAnnotations.length - found;

  // Calculate weighted score
  let weightedPoints = 0;
  for (const match of matches) {
    const severity = match.severity;
    const weight = SEVERITY_WEIGHTS[severity];
    weightedPoints += weight;
  }

  // Penalty for false positives (each false positive costs 0.5 points)
  const penalty = falsePositives * 0.5;
  const totalWeightedPoints = Math.max(0, weightedPoints - penalty);

  // Calculate max possible points
  let maxPoints = 0;
  for (const gt of groundTruthAnnotations) {
    const weight = SEVERITY_WEIGHTS[normalizeSeverity(gt.severity)];
    maxPoints += weight;
  }

  // Final score (0-100)
  const score = maxPoints > 0 ? Math.round((totalWeightedPoints / maxPoints) * 100) : 100;

  // Accuracy (percentage of expected annotations found)
  const accuracy =
    groundTruthAnnotations.length > 0
      ? Math.round((found / groundTruthAnnotations.length) * 100)
      : 100;

  // ============================================
  // Generate Feedback
  // ============================================

  const feedback = generateFeedback(found, groundTruthAnnotations.length, missed, score);

  // ============================================
  // Build Breakdown
  // ============================================

  const breakdown = buildBreakdown(groundTruthAnnotations, matches);

  return {
    score: Math.min(100, Math.max(0, score)),
    accuracy,
    found,
    missed,
    falsePositives,
    feedback,
    breakdown,
  };
}

// ============================================================
// Matching & Comparison
// ============================================================

/**
 * Check if candidate annotation matches ground truth annotation
 *
 * Matching criteria:
 * - Same file
 * - Line number within ±1 line
 * - Severity within ±1 level
 */
function annotationsMatch(candidate: Annotation, groundTruth: Annotation): boolean {
  // File must match exactly
  if (candidate.file.toLowerCase() !== groundTruth.file.toLowerCase()) {
    return false;
  }

  // Line number within ±1
  const lineDist = Math.abs(candidate.line - groundTruth.line);
  if (lineDist > LINE_TOLERANCE) {
    return false;
  }

  // Severity within ±1
  const candSevIdx = SEVERITY_ORDER.indexOf(normalizeSeverity(candidate.severity));
  const gtSevIdx = SEVERITY_ORDER.indexOf(normalizeSeverity(groundTruth.severity));
  const sevDist = Math.abs(candSevIdx - gtSevIdx);

  if (sevDist > SEVERITY_TOLERANCE) {
    return false;
  }

  return true;
}

/**
 * Normalize severity to lowercase
 */
function normalizeSeverity(severity: SeverityType | string): SeverityType {
  const normalized = (severity || 'minor').toLowerCase() as SeverityType;
  if (!['critical', 'major', 'minor'].includes(normalized)) {
    return 'minor';
  }
  return normalized;
}

// ============================================================
// Feedback Generation
// ============================================================

/**
 * Generate human-readable feedback based on performance
 */
function generateFeedback(found: number, total: number, missed: number, score: number): string {
  const percentage = (found / total) * 100;

  if (percentage >= 80) {
    return `Excellent review! You caught ${found}/${total} critical issues. This demonstrates strong code review skills.`;
  }

  if (percentage >= 60) {
    let feedback = `Good review! You found ${found}/${total} issues. `;
    if (missed > 0) {
      feedback += `You missed ${missed} issues. Check for: logic errors, edge cases, security concerns, and performance issues.`;
    }
    return feedback;
  }

  if (percentage >= 40) {
    return `Review needs improvement. You found ${found}/${total} issues. Focus on: critical bugs first, then code quality concerns. Missed ${missed} important issues.`;
  }

  return `Review needs significant improvement. You found only ${found}/${total} issues. Be more thorough: check every file, look for hidden bugs, test edge cases.`;
}

// ============================================================
// Breakdown Calculation
// ============================================================

/**
 * Build severity breakdown showing expected vs. found for each severity
 */
function buildBreakdown(
  groundTruthAnnotations: Annotation[],
  matches: MatchedAnnotation[]
): SeverityBreakdown {
  const breakdown: SeverityBreakdown = {
    critical: { expected: 0, found: 0 },
    major: { expected: 0, found: 0 },
    minor: { expected: 0, found: 0 },
  };

  // Count expected annotations by severity
  for (const gt of groundTruthAnnotations) {
    const severity = normalizeSeverity(gt.severity);
    breakdown[severity].expected += 1;
  }

  // Count found annotations by severity
  for (const match of matches) {
    const severity = match.severity;
    breakdown[severity].found += 1;
  }

  return breakdown;
}
