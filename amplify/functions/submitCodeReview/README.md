# submitCodeReview Lambda

STREAM 2: Code Review Challenge Backend Infrastructure — Phase 4

## Overview

This Lambda function handles code review submissions from candidates:

1. **Receives submission payload** — assessmentId, annotations, summary
2. **Validates annotation structure** — comprehensive type and size checks
3. **Saves to Assessment model** — stores annotations, summary, and submission timestamp
4. **Triggers container destruction** — async, non-blocking cleanup of dev environment
5. **Returns confirmation** — with submittedAt timestamp and message

## Input

```typescript
{
  assessmentId: string;        // Required: ID of the Assessment to update
  challengeId: string;         // Required: ID of the Challenge being assessed
  userId: string;              // Required: ID of the candidate (for audit trail)
  studioId: string;            // Required: ID of the dev container to destroy
  codeReviewAnnotations: Array; // Required: [{ id, filePath, lineNumber, type, severity?, text, codeSnippet, suggestedCode?, timestamp }]
  codeReviewSummary?: string;  // Optional: Overall assessment summary (max 2000 chars)
}
```

## Output

### Success (statusCode 200)

```typescript
{
  success: true,
  assessmentId: "assessment-123",
  submittedAt: "2026-03-13T15:57:28.000Z",
  message: "Code review submitted successfully"
}
```

### Error (statusCode 400/500)

```typescript
{
  success: false,
  error: "Validation: assessmentId is required",
  statusCode: 400
}
```

## Annotation Structure

```typescript
interface CodeReviewAnnotation {
  id: string;                                        // Unique identifier
  filePath: string;                                  // File path (e.g., src/index.ts)
  lineNumber: number;                                // Line number (0 or 1-indexed)
  type: 'COMMENT' | 'SUGGESTION' | 'QUESTION';      // Type of annotation
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';       // Optional severity
  text: string;                                      // Comment text (max 5000 chars)
  codeSnippet: string;                               // Code being commented (max 5000 chars)
  suggestedCode?: string;                            // Suggested replacement (max 5000 chars)
  timestamp: string;                                 // ISO 8601 creation time
}
```

## Validation Rules

### Required Fields
- `assessmentId` — must not be empty
- `challengeId` — must not be empty
- `userId` — must not be empty
- `studioId` — must not be empty
- `codeReviewAnnotations` — must be an array (can be empty)

### Annotation Validation
- `id` — required, max 256 characters
- `filePath` — required, max 512 characters
- `lineNumber` — required, non-negative number, max 1,000,000
- `type` — required, must be one of: COMMENT, SUGGESTION, QUESTION
- `severity` — optional, must be one of: INFO, WARNING, CRITICAL
- `text` — required, max 5000 characters
- `codeSnippet` — required, max 5000 characters
- `suggestedCode` — optional, max 5000 characters
- `timestamp` — required, valid ISO 8601 format

### Size Limits
- Annotation `text` field: max 5000 characters
- Annotation `codeSnippet` field: max 5000 characters
- Annotation `suggestedCode` field: max 5000 characters
- `codeReviewSummary` field: max 2000 characters
- Total payload: max 350KB

## Usage Example

```typescript
// AppSync GraphQL Mutation
mutation SubmitCodeReview(
  $assessmentId: ID!
  $challengeId: ID!
  $userId: String!
  $studioId: String!
  $codeReviewAnnotations: AWSJSON!
  $codeReviewSummary: String
) {
  submitCodeReview(
    assessmentId: $assessmentId
    challengeId: $challengeId
    userId: $userId
    studioId: $studioId
    codeReviewAnnotations: $codeReviewAnnotations
    codeReviewSummary: $codeReviewSummary
  ) {
    success
    assessmentId
    submittedAt
    message
  }
}
```

## Authorization

- **Authorization model**: Public API key (for unauthenticated candidate submissions)
- **Identity**: Candidates submit via shareable assessment links (no sign-in required)

## Error Handling

The handler distinguishes between:

1. **Validation Errors (400)** — Invalid input, malformed annotations, size limit exceeded
2. **Database Errors (500)** — DynamoDB operations failed
3. **Internal Errors (500)** — Unexpected runtime errors

All errors are logged to CloudWatch with context for debugging.

## Logging

CloudWatch logs include:

```
📝 [submitCodeReview] Request received { assessmentId, annotationCount }
✅ [submitCodeReview] Inputs validated
💾 [submitCodeReview] Saving Assessment to DynamoDB...
✅ [submitCodeReview] Assessment saved { assessmentId, updatedAttributes }
🗑️  [submitCodeReview] Triggering container destruction...
```

## Performance

- **Timeout**: 30 seconds
- **Memory**: 256 MB
- **Cold start**: ~100ms (Node.js 22)
- **Typical execution**: 200-500ms
- **DynamoDB cost**: ~$0.001 per invocation

## Testing

Run tests:

```bash
npm test
```

Run with coverage:

```bash
npm run test:coverage
```

Watch mode:

```bash
npm run test:watch
```

## Test Coverage

- ✅ Happy path: successful submission with all fields
- ✅ Validation failures: missing required fields, invalid types
- ✅ Annotation validation: all error cases
- ✅ Size limits: payload size, text length, summary length
- ✅ Timestamp validation: invalid formats, future timestamps
- ✅ Type safety: all annotation types and severities
- ✅ Edge cases: whitespace handling, very large line numbers, missing fields

Target coverage: **80%+**

## Related Tasks

- STREAM2-016: Phase 4 Kickoff
- STREAM2-017: Handler Implementation
- STREAM2-018: Validation & Error Handling
- STREAM2-019: Container Destruction Integration
- STREAM2-020: Unit Tests & Documentation

## Architecture

```
Candidate Submission
        ↓
   AppSync Mutation
        ↓
submitCodeReview Lambda
        ├─→ Validate Request
        ├─→ Update Assessment (DynamoDB)
        ├─→ Trigger Container Destruction (async)
        └─→ Return Confirmation
```

## Notes

- Container destruction is **async and non-blocking** — submission succeeds even if container cleanup fails
- Empty annotations array is allowed (candidate may have reviewed without leaving comments)
- Timestamps are validated as ISO 8601 but future timestamps are warned, not rejected
- All monetary/sensitive data should be redacted from logs

## Future Enhancements

- Phase 5: Actual ECS container destruction integration
- Phase 6: Scoring agent integration for automatic scoring
- Phase 7: Notification of recruiter on submission completion
