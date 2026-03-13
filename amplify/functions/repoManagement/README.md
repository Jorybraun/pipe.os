# repoManagement Lambda Function

## Overview

The `repoManagement` Lambda function provides utilities for managing code review challenge repositories in AWS S3. It handles:

1. **Presigned URL Generation** — Generate time-limited download URLs for repository archives
2. **Metadata Loading** — Load and cache repository metadata from S3
3. **Version Management** — Query DynamoDB for repository template versions
4. **Error Handling** — Map S3 errors to user-friendly HTTP responses

This is part of **STREAM 2: Code Review Challenge Backend Infrastructure**, Phase 2.

---

## Architecture

```
Frontend/Lambda Request
         ↓
    Handler.ts
    (validates + routes)
         ↓
   repoManager.ts
   (core utilities)
         ↓
   AWS SDK (S3, DynamoDB)
```

### Component Structure

```
amplify/functions/repoManagement/
├── handler.ts                    # Lambda entry point
├── resource.ts                   # Amplify resource definition
├── types.ts                      # TypeScript interfaces
├── lib/
│   └── repoManager.ts           # Core utilities
└── __tests__/
    ├── repoManager.test.ts      # Unit tests
    └── repoManager.integration.test.ts  # Integration tests
```

---

## API Reference

### 1. Generate Presigned URL

**Action:** `generatePresignedUrl`

Generate a time-limited download URL for a repository archive.

#### Request

```typescript
interface GeneratePresignedUrlRequest {
  challengeId: string;     // Challenge ID for audit logging
  repoS3Key: string;       // Full S3 path to repo.tar.gz
  ttlSeconds?: number;     // TTL in seconds (default: 7200)
}
```

#### Response

```typescript
interface GeneratePresignedUrlResponse {
  url: string;             // Presigned URL
  expiresAt: Date;         // Expiration timestamp
  bucket: string;          // S3 bucket name
  key: string;             // S3 object key
}
```

#### Example

```typescript
const result = await generatePresignedUrl({
  challengeId: 'challenge-123',
  repoS3Key: 'challenge-repos/slopify/coupon/v1.0.0/repo.tar.gz',
  ttlSeconds: 7200  // 2 hours
});

// Returns:
{
  url: 'https://s3.amazonaws.com/bucket/key?X-Amz-Signature=...',
  expiresAt: 2026-03-13T22:45:00Z,
  bucket: 'pipe-challenges-prod',
  key: 'challenge-repos/slopify/coupon/v1.0.0/repo.tar.gz'
}
```

#### Security Features

- **Read-only access** — GetObject permission only, no PutObject
- **2-hour default TTL** — Prevents unlimited access
- **Immutable signature** — Cannot be modified after generation
- **Audit logging** — Challenge ID logged for tracking

---

### 2. Load Repository Metadata

**Action:** `loadMetadata`

Load repository metadata from S3 with automatic caching.

#### Request

```typescript
interface LoadMetadataRequest {
  metadataS3Key: string;   // S3 path to metadata.json
  cacheKey?: string;       // Optional custom cache key
}
```

#### Response

```typescript
interface RepoMetadata {
  repoId: string;          // Repository ID
  version: string;         // Version (semantic)
  branches: {              // Available branches
    [name: string]: {
      description: string;
      baseBranch?: string;
      commits?: number;
    };
  };
  bugs?: BugEntry[];       // Known bugs (for reviews)
  estimatedTime: number;   // Minutes to complete
  difficulty: string;      // BEGINNER|INTERMEDIATE|ADVANCED
  instructions: string;    // Challenge instructions
  buildStats?: {           // Repository statistics
    totalFiles: number;
    totalLines: number;
  };
}
```

#### Example

```typescript
const metadata = await loadRepoMetadata(
  'challenge-repos/slopify/coupon/v1.0.0/metadata.json'
);

// Returns:
{
  repoId: 'slopify-coupon',
  version: '1.0.0',
  branches: {
    main: { description: 'Main branch' },
    'feature/coupon': {
      description: 'Coupon support feature',
      baseBranch: 'main'
    }
  },
  difficulty: 'INTERMEDIATE',
  estimatedTime: 45,
  instructions: 'Review the feature/coupon branch for code quality...',
  buildStats: {
    totalFiles: 145,
    totalLines: 8234
  }
}
```

#### Caching Behavior

- **1-hour TTL** — Metadata cached in Lambda memory
- **Cache key** — Derived from S3 key or custom value
- **Hit logging** — CloudWatch logs show cache hits vs. fetches
- **Automatic expiry** — Stale entries removed after 1 hour

#### Graceful Degradation

If metadata.json is missing or malformed:
- Returns default metadata with warning in logs
- Does not fail the request
- Allows challenge to continue with limited metadata

---

### 3. Get Repository Version

**Action:** `getVersion`

Query DynamoDB for a specific repository version.

#### Request

```typescript
interface GetVersionRequest {
  repoId: string;    // Repository ID (e.g., "slopify-coupon")
  version: string;   // Version string (e.g., "1.0.0")
}
```

#### Response

```
string | null        // S3 key for the version, or null if not found
```

#### Example

```typescript
const s3Key = await getRepoVersion('slopify-coupon', '1.0.0');

// Returns:
'challenge-repos/storefront/slopify-coupon/v1.0.0/repo.tar.gz'

// Or null if not found
```

---

### 4. Health Check

**Action:** `healthCheck`

Verify that the service and S3 connectivity are working.

#### Request

```typescript
// No parameters
```

#### Response

```typescript
{
  healthy: boolean;
  message: string;
}
```

#### Example

```typescript
const health = await healthCheck();

// Returns:
{
  healthy: true,
  message: 'S3 bucket is accessible'
}
```

---

## Usage from Lambda Handler

```typescript
import handler from './handler';

// Invoke as Lambda event
const event = {
  action: 'generatePresignedUrl',
  challengeId: 'challenge-123',
  repoS3Key: 'challenge-repos/...',
  ttlSeconds: 7200
};

const response = await handler(event);

if (response.success) {
  console.log('URL:', response.data.url);
} else {
  console.error('Error:', response.error.userMessage);
}
```

---

## Error Handling

All errors are mapped to HTTP status codes and user-friendly messages:

| AWS Error | Status | Message |
|-----------|--------|---------|
| NoSuchKey | 404 | "Repository archive not found" |
| AccessDenied | 403 | "You do not have permission" |
| SignatureDoesNotMatch | 403 | "Authentication failed" |
| ThrottlingException | 429 | "Service is busy, please retry" |
| ServiceUnavailable | 503 | "Service temporarily unavailable" |
| RequestTimeout | 504 | "Request timed out" |
| Unknown | 500 | "An error occurred" |

### Error Response Format

```typescript
{
  success: false,
  error: {
    statusCode: 403,
    message: 'AccessDenied',
    userMessage: 'You do not have permission to access this repository.'
  }
}
```

---

## S3 Directory Structure

```
s3://pipe-challenges-prod/
├── challenge-repos/
│   ├── storefront/
│   │   ├── slopify-coupon/
│   │   │   ├── v1.0.0/
│   │   │   │   ├── repo.tar.gz          ← Repository archive
│   │   │   │   └── metadata.json        ← Metadata file
│   │   │   └── v1.1.0/
│   │   │       ├── repo.tar.gz
│   │   │       └── metadata.json
│   └── devhub/
│       └── ...
```

---

## Configuration

Set these environment variables to customize behavior:

```bash
# S3 bucket for repositories (default: pipe-challenges-prod)
REPO_BUCKET_NAME=pipe-challenges-prod

# DynamoDB table for templates (default: RepoTemplate)
REPO_TEMPLATE_TABLE=RepoTemplate

# AWS region (default: us-east-1)
AWS_REGION=us-east-1

# Metadata cache TTL in seconds (default: 3600)
METADATA_CACHE_TTL=3600
```

---

## CloudWatch Logging

All operations are logged with structured JSON format:

```json
{
  "timestamp": "2026-03-13T22:32:00Z",
  "level": "INFO",
  "lambda": "repoManagement",
  "action": "generatePresignedUrl",
  "challengeId": "challenge-123",
  "statusCode": 200,
  "duration": 125
}
```

### Log Patterns

**Presigned URL Generation:**
```
✅ URL generated successfully
Duration: 125ms
TTL: 7200 seconds
```

**Metadata Cache Hit:**
```
✅ Cache hit (metadata:challenge-repos/...)
Duration: 2ms
repoId: slopify-coupon
```

**Metadata S3 Fetch:**
```
Cache miss, fetching from S3
✅ Metadata fetched and cached
Duration: 342ms
TTL: 3600 seconds
```

**Error:**
```
❌ Error: NoSuchKey
S3 path: challenge-repos/missing.tar.gz
Mapping to: 404 "Repository not found"
```

---

## Performance Characteristics

| Operation | Target | Typical | Notes |
|-----------|--------|---------|-------|
| Presigned URL | < 500ms | 100-200ms | Local crypto operations |
| Metadata (cache hit) | < 50ms | 2-5ms | In-memory lookup |
| Metadata (S3 fetch) | < 2s | 500-1000ms | Depends on file size |
| Version lookup | < 1s | 200-500ms | DynamoDB query |

---

## Testing

### Unit Tests

Run unit tests with mocked AWS services:

```bash
npm test -- repoManager.test.ts
```

Coverage targets: **80%+**

Test categories:
- **generatePresignedUrl** (4 tests)
- **loadRepoMetadata** (6 tests)
- **getRepoVersion** (3 tests)
- **handleS3Error** (5 tests)

### Integration Tests

Run integration tests against real S3 (optional):

```bash
ENABLE_INTEGRATION_TESTS=true npm test -- repoManager.integration.test.ts
```

Prerequisites:
- AWS credentials configured
- Test repository uploaded to S3
- S3 bucket accessible

Integration test categories:
- Presigned URL verification (works when used)
- Concurrent operations (5+ parallel requests)
- Cache validation (cache hits verified)
- Performance benchmarks (< 500ms for URL gen)

---

## Best Practices

### 1. Always Check Success

```typescript
const response = await handler(event);

if (response.success) {
  const url = response.data.url;
  // Use presigned URL
} else {
  const error = response.error.userMessage;
  // Show to user
}
```

### 2. Set Appropriate TTL

```typescript
// 2 hours for typical code review
const result = await generatePresignedUrl({
  challengeId,
  repoS3Key,
  ttlSeconds: 7200  // Standard
});

// Longer for background jobs
// ttlSeconds: 86400  // 1 day (max)
```

### 3. Use Caching Effectively

```typescript
// Same S3 key = leverages 1-hour cache
const metadata1 = await loadRepoMetadata('path/to/metadata.json');
const metadata2 = await loadRepoMetadata('path/to/metadata.json');
// Second call is instant (cached)
```

### 4. Monitor CloudWatch Logs

```bash
# View real-time logs
aws logs tail /aws/lambda/repoManagement --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/repoManagement \
  --filter-pattern "❌"
```

---

## Troubleshooting

### Presigned URL Expired

**Problem:** URL returns 403 Forbidden when used  
**Solution:** Generate new URL with higher TTL or retry generation

### Metadata Not Found

**Problem:** Metadata returns fallback/defaults  
**Cause:** metadata.json not uploaded to S3 path  
**Solution:** Upload metadata.json to correct S3 location

### Slow Performance

**Problem:** generatePresignedUrl takes > 500ms  
**Cause:** Possible network latency or Lambda cold start  
**Solution:** Monitor CloudWatch metrics, check AWS region

### Cache Not Working

**Problem:** Same metadata loaded from S3 multiple times  
**Cause:** Different cache keys used  
**Solution:** Use consistent metadataS3Key parameter

---

## Related Documentation

- **Tech Spec:** `/Users/hans/Code/CEO/docs/specs/2026-03-13-stream2-tech-spec.md` (Section 4)
- **Architecture:** `/Users/hans/Code/CEO/docs/STREAM2_ARCHITECTURE.md` (Section 3)
- **Decision:** `/Users/hans/Code/CEO/docs/decisions/2026-03-13-stream2-implementation-plan.md`

---

## Support

For issues or questions:

1. Check CloudWatch logs for detailed error messages
2. Review error response `userMessage` for user-safe explanations
3. Verify S3 bucket permissions in IAM role
4. Ensure repository archives are correctly formatted (tar.gz)
5. Verify metadata.json follows expected schema

---

**Last Updated:** 2026-03-13  
**Version:** 1.0.0 (STREAM 2 Phase 2)
