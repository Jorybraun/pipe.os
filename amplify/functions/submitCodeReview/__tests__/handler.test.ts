/**
 * Unit tests for submitCodeReview Lambda handler
 *
 * Test coverage:
 * - Happy path: successful submission with all fields
 * - Validation failures: missing required fields, invalid types
 * - Annotation validation: all error cases
 * - Size limits: payload size, text length, summary length
 * - Timestamp validation: invalid formats, future timestamps
 * - Type safety: all annotation types and severities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handler } from '../handler';

// Mock the DynamoDB client
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({
    send: vi.fn().mockResolvedValue({
      Attributes: {
        id: 'assessment-123',
        codeReviewAnnotations: [],
      },
    }),
  })),
  UpdateItemCommand: vi.fn(),
}));

describe('submitCodeReview Handler', () => {
  let mockEvent: any;

  beforeEach(() => {
    mockEvent = {
      arguments: {
        assessmentId: 'assessment-123',
        challengeId: 'challenge-456',
        userId: 'user-789',
        studioId: 'studio-abc',
        codeReviewAnnotations: [
          {
            id: 'anno-1',
            filePath: 'src/index.ts',
            lineNumber: 42,
            type: 'SUGGESTION',
            severity: 'CRITICAL',
            text: 'This should use async/await instead of callbacks',
            codeSnippet: 'callback(err, result)',
            suggestedCode: 'await doSomething()',
            timestamp: new Date().toISOString(),
          },
        ],
        codeReviewSummary: 'Good code, one issue with error handling',
      },
    };
  });

  // ========== HAPPY PATH TESTS ==========

  it('should successfully submit with all fields', async () => {
    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('assessmentId');
    expect(result).toHaveProperty('submittedAt');
    expect(result).toHaveProperty('message');
    expect((result as any).assessmentId).toBe('assessment-123');
  });

  it('should accept empty annotations array', async () => {
    mockEvent.arguments.codeReviewAnnotations = [];

    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
    expect((result as any).message).toContain('successfully');
  });

  it('should handle missing optional summary', async () => {
    mockEvent.arguments.codeReviewSummary = undefined;

    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
  });

  it('should generate valid ISO 8601 timestamp', async () => {
    const result = await handler(mockEvent);

    if (result.success) {
      const timestamp = (result as any).submittedAt;
      expect(() => new Date(timestamp)).not.toThrow();
      // Should be parseable as ISO 8601
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });

  // ========== REQUIRED FIELD VALIDATION ==========

  it('should reject empty assessmentId', async () => {
    mockEvent.arguments.assessmentId = '';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).statusCode).toBe(400);
    expect((result as any).error).toContain('assessmentId');
  });

  it('should reject null assessmentId', async () => {
    mockEvent.arguments.assessmentId = null;

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
  });

  it('should reject undefined assessmentId', async () => {
    mockEvent.arguments.assessmentId = undefined;

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
  });

  it('should reject empty challengeId', async () => {
    mockEvent.arguments.challengeId = '';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('challengeId');
  });

  it('should reject missing userId', async () => {
    mockEvent.arguments.userId = '';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('userId');
  });

  it('should reject missing studioId', async () => {
    mockEvent.arguments.studioId = '';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('studioId');
  });

  // ========== ANNOTATIONS ARRAY VALIDATION ==========

  it('should reject non-array codeReviewAnnotations', async () => {
    mockEvent.arguments.codeReviewAnnotations = 'not an array';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('array');
  });

  it('should reject null codeReviewAnnotations', async () => {
    mockEvent.arguments.codeReviewAnnotations = null;

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
  });

  // ========== ANNOTATION FIELD VALIDATION ==========

  it('should reject annotation with missing id', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].id = '';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('Annotation');
    expect((result as any).error).toContain('id');
  });

  it('should reject annotation with missing filePath', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].filePath = '';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('filePath');
  });

  it('should reject annotation with negative lineNumber', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].lineNumber = -1;

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('lineNumber');
  });

  it('should reject annotation with non-numeric lineNumber', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].lineNumber = 'not a number' as any;

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
  });

  it('should reject annotation with invalid type', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].type = 'INVALID_TYPE';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('type');
  });

  it('should reject annotation with invalid severity', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].severity = 'INVALID_SEVERITY';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('severity');
  });

  it('should reject annotation with missing text', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].text = '';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('text');
  });

  it('should reject annotation with missing codeSnippet', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].codeSnippet = '';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('codeSnippet');
  });

  it('should reject annotation with missing timestamp', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].timestamp = '';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('timestamp');
  });

  it('should reject annotation with invalid ISO 8601 timestamp', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].timestamp = 'invalid-date';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('ISO 8601');
  });

  // ========== SIZE LIMIT VALIDATION ==========

  it('should reject text exceeding 5000 characters', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].text = 'x'.repeat(5001);

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('5000');
  });

  it('should reject codeSnippet exceeding 5000 characters', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].codeSnippet = 'x'.repeat(5001);

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('5000');
  });

  it('should reject suggestedCode exceeding 5000 characters', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].suggestedCode = 'x'.repeat(5001);

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('5000');
  });

  it('should reject summary exceeding 2000 characters', async () => {
    mockEvent.arguments.codeReviewSummary = 'x'.repeat(2001);

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('2000');
  });

  it('should reject summary if not a string', async () => {
    mockEvent.arguments.codeReviewSummary = 12345;

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('string');
  });

  it('should accept text at exactly 5000 characters', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].text = 'x'.repeat(5000);

    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
  });

  it('should accept summary at exactly 2000 characters', async () => {
    mockEvent.arguments.codeReviewSummary = 'x'.repeat(2000);

    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
  });

  // ========== TYPE ACCEPTANCE TESTS ==========

  it('should accept all 3 annotation types', async () => {
    for (const type of ['COMMENT', 'SUGGESTION', 'QUESTION']) {
      mockEvent.arguments.codeReviewAnnotations[0].type = type;

      const result = await handler(mockEvent);

      expect(result.success).toBe(true);
    }
  });

  it('should accept all 3 severity levels', async () => {
    for (const severity of ['INFO', 'WARNING', 'CRITICAL']) {
      mockEvent.arguments.codeReviewAnnotations[0].severity = severity;

      const result = await handler(mockEvent);

      expect(result.success).toBe(true);
    }
  });

  it('should accept annotation without severity (optional)', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].severity = undefined;

    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
  });

  it('should accept annotation without suggestedCode (optional)', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].suggestedCode = undefined;

    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
  });

  // ========== MULTIPLE ANNOTATIONS ==========

  it('should accept 5 annotations', async () => {
    const baseAnnotation = mockEvent.arguments.codeReviewAnnotations[0];

    mockEvent.arguments.codeReviewAnnotations = Array.from({ length: 5 }, (_, i) => ({
      ...baseAnnotation,
      id: `anno-${i}`,
      lineNumber: i * 10,
    }));

    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
  });

  it('should accept 50 annotations', async () => {
    const baseAnnotation = mockEvent.arguments.codeReviewAnnotations[0];

    mockEvent.arguments.codeReviewAnnotations = Array.from({ length: 50 }, (_, i) => ({
      ...baseAnnotation,
      id: `anno-${i}`,
      lineNumber: i * 10,
    }));

    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
  });

  it('should validate all annotations in array', async () => {
    const baseAnnotation = mockEvent.arguments.codeReviewAnnotations[0];

    mockEvent.arguments.codeReviewAnnotations = [
      baseAnnotation,
      { ...baseAnnotation, id: 'anno-2', type: 'COMMENT' },
      { ...baseAnnotation, id: 'anno-3', type: 'INVALID' }, // This one should fail
    ];

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain('Annotation');
  });

  // ========== EDGE CASES ==========

  it('should handle whitespace-only fields as empty', async () => {
    mockEvent.arguments.assessmentId = '   ';

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
  });

  it('should handle very large lineNumber', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].lineNumber = 999999;

    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
  });

  it('should handle 0 lineNumber', async () => {
    mockEvent.arguments.codeReviewAnnotations[0].lineNumber = 0;

    const result = await handler(mockEvent);

    expect(result.success).toBe(true);
  });

  it('should handle missing arguments entirely', async () => {
    mockEvent.arguments = undefined;

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
  });

  it('should handle event with no arguments', async () => {
    mockEvent = {};

    const result = await handler(mockEvent);

    expect(result.success).toBe(false);
  });

  // ========== RESPONSE STRUCTURE ==========

  it('should return consistent response structure on success', async () => {
    const result = await handler(mockEvent);

    if (result.success) {
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('assessmentId');
      expect(result).toHaveProperty('submittedAt');
      expect(result).toHaveProperty('message');
      expect(Object.keys(result).sort()).toEqual(
        ['assessmentId', 'message', 'submittedAt', 'success'].sort()
      );
    }
  });

  it('should return consistent response structure on error', async () => {
    mockEvent.arguments.assessmentId = '';

    const result = await handler(mockEvent);

    if (!result.success) {
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('statusCode');
    }
  });
});
