/**
 * Comprehensive test suite for scoreCodeReview Lambda
 *
 * Test coverage:
 * - Perfect match scenarios (score 100)
 * - Partial matches (score 60-80)
 * - Poor matches (score 20-40)
 * - Over-annotation (false positives)
 * - Line tolerance matching (±1)
 * - Severity tolerance matching (±1)
 * - Different reviewer levels
 * - Edge cases (no annotations, empty ground truth)
 * - Error handling
 * - Feedback generation
 *
 * Vitest + mocks for DynamoDB (no real AWS calls)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handler } from '../handler';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import type {
  ScoreCodeReviewInput,
  ScoreCodeReviewResponse,
  Annotation,
} from '../types';

// Mock DynamoDB client
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  UpdateItemCommand: vi.fn((params) => params),
}));

// ============================================================
// Helper Functions
// ============================================================

/**
 * Create a mock event for the Lambda handler
 */
function createEvent(input: Partial<ScoreCodeReviewInput>) {
  return {
    arguments: {
      assessmentId: input.assessmentId || 'assessment-123',
      candidateAnnotations: input.candidateAnnotations || [],
      groundTruthAnnotations: input.groundTruthAnnotations || [],
      reviewerLevel: input.reviewerLevel || 'mid',
    },
  };
}

/**
 * Create an annotation object
 */
function createAnnotation(
  file: string,
  line: number,
  severity: 'critical' | 'major' | 'minor' = 'major',
  comment: string = 'Test comment'
): Annotation {
  return {
    file,
    line,
    severity,
    comment,
  };
}

// ============================================================
// Test Suite
// ============================================================

describe('scoreCodeReview Lambda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // Test 1: Perfect Match (score 100)
  // ============================================

  it('should score 100 when candidate finds all issues with no false positives', async () => {
    const groundTruth = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer'),
      createAnnotation('src/api.ts', 25, 'major', 'Missing error handling'),
    ];

    const candidate = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer'),
      createAnnotation('src/api.ts', 25, 'major', 'Missing error handling'),
    ];

    const event = createEvent({
      assessmentId: 'test-123',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.score).toBe(100);
      expect(response.data.accuracy).toBe(100);
      expect(response.data.found).toBe(2);
      expect(response.data.missed).toBe(0);
      expect(response.data.falsePositives).toBe(0);
    }
  });

  // ============================================
  // Test 2: Partial Match (score 60-80)
  // ============================================

  it('should score 70 when candidate finds most issues', async () => {
    const groundTruth = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer'),
      createAnnotation('src/api.ts', 25, 'major', 'Missing error handling'),
      createAnnotation('src/db.ts', 40, 'minor', 'Missing index'),
    ];

    const candidate = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer'),
      createAnnotation('src/api.ts', 25, 'major', 'Missing error handling'),
      // Missed: src/db.ts line 40 minor
    ];

    const event = createEvent({
      assessmentId: 'test-456',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.score).toBeGreaterThanOrEqual(70);
      expect(response.data.found).toBe(2);
      expect(response.data.missed).toBe(1);
      expect(response.data.falsePositives).toBe(0);
    }
  });

  // ============================================
  // Test 3: Poor Match (score 20-40)
  // ============================================

  it('should score low when candidate finds few issues', async () => {
    const groundTruth = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer'),
      createAnnotation('src/api.ts', 25, 'major', 'Missing error handling'),
      createAnnotation('src/db.ts', 40, 'minor', 'Missing index'),
      createAnnotation('src/cache.ts', 55, 'critical', 'Race condition'),
    ];

    const candidate = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer'),
      // Only found 1 out of 4
    ];

    const event = createEvent({
      assessmentId: 'test-789',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.score).toBeLessThan(50);
      expect(response.data.found).toBe(1);
      expect(response.data.missed).toBe(3);
    }
  });

  // ============================================
  // Test 4: Over-annotation (False Positives)
  // ============================================

  it('should penalize false positives', async () => {
    const groundTruth = [createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer')];

    const candidate = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer'), // Correct
      createAnnotation('src/api.ts', 25, 'major', 'Non-existent issue 1'), // False positive
      createAnnotation('src/db.ts', 40, 'minor', 'Non-existent issue 2'), // False positive
    ];

    const event = createEvent({
      assessmentId: 'test-fp1',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.score).toBeLessThan(100);
      expect(response.data.falsePositives).toBe(2);
      expect(response.data.found).toBe(1);
      // Score should be penalized: 1.0 (critical) - 2*0.5 (penalties) = 0, so 0%
      expect(response.data.score).toBeLessThanOrEqual(50);
    }
  });

  // ============================================
  // Test 5: Line Tolerance (±1 line)
  // ============================================

  it('should match annotations within line ±1 tolerance', async () => {
    const groundTruth = [createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer')];

    // Candidate found it on line 11 (±1 tolerance should match)
    const candidate = [createAnnotation('src/utils.ts', 11, 'critical', 'Null pointer')];

    const event = createEvent({
      assessmentId: 'test-line',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.found).toBe(1);
      expect(response.data.score).toBe(100);
    }
  });

  // ============================================
  // Test 6: Line Mismatch (>1 line)
  // ============================================

  it('should not match annotations beyond line tolerance', async () => {
    const groundTruth = [createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer')];

    // Candidate found it on line 13 (beyond ±1 tolerance)
    const candidate = [createAnnotation('src/utils.ts', 13, 'critical', 'Null pointer')];

    const event = createEvent({
      assessmentId: 'test-line-mismatch',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.found).toBe(0);
      expect(response.data.falsePositives).toBe(1);
      expect(response.data.score).toBe(0);
    }
  });

  // ============================================
  // Test 7: Severity Tolerance (±1 level)
  // ============================================

  it('should match annotations within severity ±1 tolerance', async () => {
    const groundTruth = [createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer')];

    // Candidate found it as 'major' (±1 from critical)
    const candidate = [createAnnotation('src/utils.ts', 10, 'major', 'Null pointer')];

    const event = createEvent({
      assessmentId: 'test-sev',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.found).toBe(1);
      expect(response.data.score).toBe(100);
    }
  });

  // ============================================
  // Test 8: Severity Mismatch (>1 level)
  // ============================================

  it('should not match annotations beyond severity tolerance', async () => {
    const groundTruth = [createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer')];

    // Candidate found it as 'minor' (2 levels away from critical)
    const candidate = [createAnnotation('src/utils.ts', 10, 'minor', 'Null pointer')];

    const event = createEvent({
      assessmentId: 'test-sev-mismatch',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.found).toBe(0);
      expect(response.data.falsePositives).toBe(1);
      expect(response.data.score).toBe(0);
    }
  });

  // ============================================
  // Test 9: No Annotations Submitted
  // ============================================

  it('should score 0 when candidate submits no annotations', async () => {
    const groundTruth = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer'),
      createAnnotation('src/api.ts', 25, 'major', 'Missing error handling'),
    ];

    const event = createEvent({
      assessmentId: 'test-empty',
      candidateAnnotations: [],
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.score).toBe(0);
      expect(response.data.accuracy).toBe(0);
      expect(response.data.found).toBe(0);
      expect(response.data.missed).toBe(2);
    }
  });

  // ============================================
  // Test 10: Empty Ground Truth
  // ============================================

  it('should score 100 when ground truth is empty and candidate adds no annotations', async () => {
    const event = createEvent({
      assessmentId: 'test-empty-gt',
      candidateAnnotations: [],
      groundTruthAnnotations: [],
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.score).toBe(100);
      expect(response.data.accuracy).toBe(100);
    }
  });

  // ============================================
  // Test 11: Different Reviewer Levels
  // ============================================

  it('should handle different reviewer levels (junior, mid, senior)', async () => {
    const groundTruth = [createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer')];
    const candidate = [createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer')];

    for (const level of ['junior', 'mid', 'senior'] as const) {
      const event = createEvent({
        assessmentId: `test-level-${level}`,
        candidateAnnotations: candidate,
        groundTruthAnnotations: groundTruth,
        reviewerLevel: level,
      });

      const response = (await handler(event)) as ScoreCodeReviewResponse;

      expect(response.success).toBe(true);
      if (response.success) {
        expect(response.data.score).toBe(100);
      }
    }
  });

  // ============================================
  // Test 12: Severity Breakdown
  // ============================================

  it('should correctly calculate severity breakdown', async () => {
    const groundTruth = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer'),
      createAnnotation('src/api.ts', 25, 'major', 'Error handling'),
      createAnnotation('src/db.ts', 40, 'minor', 'Index'),
      createAnnotation('src/cache.ts', 55, 'critical', 'Race condition'),
    ];

    const candidate = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer'), // Found critical
      createAnnotation('src/api.ts', 25, 'major', 'Error handling'), // Found major
      // Missed: src/db.ts minor
      // Missed: src/cache.ts critical
    ];

    const event = createEvent({
      assessmentId: 'test-breakdown',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      const { breakdown } = response.data;
      expect(breakdown.critical.expected).toBe(2);
      expect(breakdown.critical.found).toBe(1);
      expect(breakdown.major.expected).toBe(1);
      expect(breakdown.major.found).toBe(1);
      expect(breakdown.minor.expected).toBe(1);
      expect(breakdown.minor.found).toBe(0);
    }
  });

  // ============================================
  // Test 13: Feedback Generation
  // ============================================

  it('should generate appropriate feedback based on performance', async () => {
    // Test: Excellent (80%+)
    const groundTruth1 = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Issue 1'),
      createAnnotation('src/api.ts', 25, 'major', 'Issue 2'),
    ];
    const candidate1 = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Issue 1'),
      createAnnotation('src/api.ts', 25, 'major', 'Issue 2'),
    ];

    const event1 = createEvent({
      assessmentId: 'test-feedback-excellent',
      candidateAnnotations: candidate1,
      groundTruthAnnotations: groundTruth1,
      reviewerLevel: 'mid',
    });

    const response1 = (await handler(event1)) as ScoreCodeReviewResponse;
    expect(response1.success).toBe(true);
    if (response1.success) {
      expect(response1.data.feedback).toContain('Excellent');
    }

    // Test: Poor (<40%)
    const groundTruth2 = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Issue 1'),
      createAnnotation('src/api.ts', 25, 'major', 'Issue 2'),
      createAnnotation('src/db.ts', 40, 'minor', 'Issue 3'),
      createAnnotation('src/cache.ts', 55, 'critical', 'Issue 4'),
    ];
    const candidate2 = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Issue 1'),
    ];

    const event2 = createEvent({
      assessmentId: 'test-feedback-poor',
      candidateAnnotations: candidate2,
      groundTruthAnnotations: groundTruth2,
      reviewerLevel: 'mid',
    });

    const response2 = (await handler(event2)) as ScoreCodeReviewResponse;
    expect(response2.success).toBe(true);
    if (response2.success) {
      expect(response2.data.feedback).toContain('significant');
    }
  });

  // ============================================
  // Test 14: Validation - Missing assessmentId
  // ============================================

  it('should fail with validation error if assessmentId is missing', async () => {
    const event = {
      arguments: {
        candidateAnnotations: [],
        groundTruthAnnotations: [],
      },
    };

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.statusCode).toBe(400);
      expect(response.error).toContain('assessmentId');
    }
  });

  // ============================================
  // Test 15: Validation - Invalid reviewerLevel
  // ============================================

  it('should fail with validation error if reviewerLevel is invalid', async () => {
    const event = createEvent({
      assessmentId: 'test-123',
      candidateAnnotations: [],
      groundTruthAnnotations: [],
      reviewerLevel: 'invalid' as any,
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.statusCode).toBe(400);
    }
  });

  // ============================================
  // Test 16: File Path Case Insensitivity
  // ============================================

  it('should match file paths case-insensitively', async () => {
    const groundTruth = [createAnnotation('src/Utils.ts', 10, 'critical', 'Null pointer')];

    const candidate = [createAnnotation('src/utils.ts', 10, 'critical', 'Null pointer')];

    const event = createEvent({
      assessmentId: 'test-case',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.found).toBe(1);
      expect(response.data.score).toBe(100);
    }
  });

  // ============================================
  // Test 17: Weighted Scoring (Critical > Major > Minor)
  // ============================================

  it('should weight scores by severity', async () => {
    const groundTruth = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Critical issue'), // weight: 1.0
      createAnnotation('src/api.ts', 25, 'major', 'Major issue'), // weight: 0.8
      createAnnotation('src/db.ts', 40, 'minor', 'Minor issue'), // weight: 0.6
    ];

    const candidate = [
      createAnnotation('src/utils.ts', 10, 'critical', 'Critical issue'), // Found (1.0)
      // Missed major (0.8)
      // Missed minor (0.6)
    ];

    const event = createEvent({
      assessmentId: 'test-weight',
      candidateAnnotations: candidate,
      groundTruthAnnotations: groundTruth,
      reviewerLevel: 'mid',
    });

    const response = (await handler(event)) as ScoreCodeReviewResponse;

    expect(response.success).toBe(true);
    if (response.success) {
      // Score should reflect that finding the critical issue (1.0 out of 2.4 total weight)
      // = 1.0 / 2.4 * 100 = 41.67%
      expect(response.data.score).toBeGreaterThan(35);
      expect(response.data.score).toBeLessThan(50);
    }
  });
});
