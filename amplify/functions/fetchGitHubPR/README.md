# fetchGitHubPR Lambda Function

**STREAM 2: GitHub PR Integration for Code Review Challenges**  
**Phase 1: GitHub API Integration**

## Overview

`fetchGitHubPR` is an AWS Lambda function that:

1. **Fetches PR metadata** from GitHub API (title, description, author, state, labels)
2. **Extracts diff** in structured format (files, hunks, lines with types)
3. **Validates** input and handles all error scenarios gracefully
4. **Returns** parsed data for admin UI to cache with Challenge model

## How It Works

### Input

```typescript
{
  repoUrl: string,  // "https://github.com/owner/repo"
  prNumber: number  // 42
}
```

### Processing

1. **Validate** GitHub URL format and PR number
2. **Retrieve** GitHub token from AWS Secrets Manager
3. **Call GitHub API** to fetch PR metadata (`/repos/{owner}/{repo}/pulls/{number}`)
4. **Paginate** through PR files (`/repos/{owner}/{repo}/pulls/{number}/files`)
5. **Parse** each file's diff patch into hunks and lines
6. **Check** total diff size (reject if > 10MB)
7. **Return** structured response with cached metadata

### Output (Success)

```typescript
{
  success: true,
  data: {
    prNumber: 42,
    title: "Add batch email sending",
    description: "Implements batch sending...",
    author: "octocat",
    state: "open",
    filesChanged: 3,
    additions: 89,
    deletions: 35,
    diff: {
      files: [
        {
          path: "src/services/email_sender.py",
          status: "modified",
          additions: 50,
          deletions: 10,
          hunks: [
            {
              header: "@@ -15,8 +15,42 @@ class EmailSender:",
              lines: [
                { type: "context", lineNumber: 15, content: "class EmailSender:" },
                { type: "deletion", lineNumber: 18, content: "self.config = config or {}" },
                { type: "addition", lineNumber: 18, content: "self.config = config or DEFAULT_CONFIG" },
                // ...
              ]
            }
          ]
        }
      ]
    },
    metadata: {
      author: "octocat",
      avatar: "https://...",
      createdAt: "2026-03-10T10:00:00Z",
      state: "open",
      labels: ["enhancement", "backend"],
      reviewers: ["reviewer1", "reviewer2"],
      htmlUrl: "https://github.com/octocat/Hello-World/pull/42",
      featureBranch: "feat/batch-email",
      baseBranch: "main"
    },
    fetchedAt: "2026-03-13T16:30:00Z"
  },
  error: null
}
```

### Output (Error)

```typescript
{
  success: false,
  data: null,
  error: {
    code: "PULL_REQUEST_NOT_FOUND",  // or RATE_LIMIT_EXCEEDED, INVALID_INPUT, etc.
    message: "PR #42 not found in octocat/Hello-World",
    retryable: false  // true for rate limit, network errors; false for not found
  }
}
```

## Error Handling

All error scenarios from tech spec (Section 4.3) are handled:

| Code | Message | Retryable | Cause |
|------|---------|-----------|-------|
| `INVALID_INPUT` | Missing/invalid repoUrl or prNumber | false | User error |
| `INVALID_REPOSITORY` | Invalid GitHub URL format | false | URL parsing |
| `PULL_REQUEST_NOT_FOUND` | PR #X not found in owner/repo | false | PR deleted or wrong number |
| `GITHUB_AUTH_ERROR` | Token invalid or expired | false | Token issue |
| `RATE_LIMIT_EXCEEDED` | GitHub API rate limit hit | true | Too many requests |
| `DIFF_TOO_LARGE` | Diff > 10MB | false | PR too complex |
| `NETWORK_ERROR` | Connection/timeout error | true | Network issue |
| `UNKNOWN_ERROR` | Unexpected error | true | Unknown failure |

## Security

- **GitHub token:** Stored in AWS Secrets Manager, never logged
- **Authorization:** Recruiter only (Cognito authenticated)
- **Public repos only:** Currently supports public GitHub repos
- **No credentials in frontend:** Admin UI never sees token

## Performance

- **Typical PR:** < 2 seconds response time
- **Large PR (1000+ LOC):** 2-5 seconds (GitHub API pagination)
- **Memory:** 512 MB Lambda (for Octokit + diff parsing)
- **Timeout:** 60 seconds

## Diff Parsing Algorithm

```
Raw patch format (GitHub):
@@ -15,8 +15,42 @@ class EmailSender:
 context line
-deleted line
+added line
 context line

Parsed to:
{
  header: "@@ -15,8 +15,42 @@ class EmailSender:",
  lines: [
    { type: "context", lineNumber: 15, content: "context line" },
    { type: "deletion", lineNumber: 16, content: "deleted line" },
    { type: "addition", lineNumber: 16, content: "added line" },
    { type: "context", lineNumber: 17, content: "context line" }
  ]
}
```

Key points:
- Line numbers refer to position in **new** version of file (post-change)
- Deletions don't increment line number
- Context lines increment line number
- Content has leading +/- stripped

## Testing

Run tests:

```bash
npm test
```

Coverage: 80%+ (16 test cases covering all error paths)

Test scenarios:
- ✅ Happy path (valid PR, multiple files)
- ❌ PR not found (404)
- ❌ Invalid URL format
- ❌ Rate limit exceeded (403 with header)
- ❌ Auth error (401)
- ❌ Diff too large (> 10MB)
- ❌ Network error (ECONNREFUSED)
- ✅ PR with no files
- ✅ PR with deleted files
- ✅ PR merged or closed state
- ✅ PR with large diff (but < 10MB)

Mock GitHub API for all tests (no real API calls).

## Deployment

1. **Set environment variable** in CDK/SAM:
   ```
   GITHUB_TOKEN_SECRET_ARN=arn:aws:secretsmanager:us-east-1:123456789:secret:pipe-github-pr
   ```

2. **Create secret in AWS Secrets Manager:**
   ```bash
   aws secretsmanager create-secret \
     --name pipe-github-pr-integration \
     --secret-string '{"token":"ghp_xxxxxxxxxxxx"}'
   ```

3. **IAM permissions** (handled by resource.ts):
   - `secretsmanager:GetSecretValue` on token secret
   - `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`

4. **Deploy via Amplify:**
   ```bash
   npm run build
   amplify push
   ```

## GitHub Token Rotation

1. Create new token in GitHub (Settings → Personal access tokens → Generate new)
2. Update secret in Secrets Manager:
   ```bash
   aws secretsmanager update-secret \
     --secret-id pipe-github-pr-integration \
     --secret-string '{"token":"ghp_new_token"}'
   ```
3. No Lambda redeploy needed (reads fresh each invocation)

## Cache Strategy (Post-MVP)

Current: No caching in Lambda (returns fresh data each time)

Future: Challenge model caches diff + metadata:
- `Challenge.cachedDiffJson` — Full diff (updated when challenge created)
- `Challenge.cachedMetadata` — PR snapshot (author, state, labels, etc.)
- `Challenge.diffCachedAt` — Timestamp for cache expiry
- TTL: 7 days (can be updated later)

On candidate view, use cached version. If stale, refresh on demand.

## Integration with Admin UI

GitHubPRFetcher component (React):

```typescript
const [prData, setPrData] = useState(null);

async function fetchPR() {
  const result = await client.graphql({
    query: gql`mutation FetchGitHubPR($input: FetchGitHubPRInput!) { ... }`,
    variables: {
      input: {
        repoUrl: "https://github.com/octocat/Hello-World",
        prNumber: 42
      }
    }
  });

  if (result.data.fetchGitHubPR.success) {
    // Show PR preview
    setPrData(result.data.fetchGitHubPR.data);
    // Admin customizes ground truth annotations
  } else {
    // Show error card with retry button
    console.error(result.data.fetchGitHubPR.error);
  }
}
```

## Links & References

- **Tech Spec:** `/Users/hans/Code/CEO/docs/specs/2026-03-13-github-pr-integration-tech-spec.md`
- **Design Spec:** `/Users/hans/Code/CEO/docs/design/specs/2026-03-13-github-pr-integration-components.md`
- **Decision:** `/Users/hans/Code/CEO/docs/decisions/2026-03-13-github-pr-integration.md`
- **GitHub API:** https://docs.github.com/en/rest/pulls/pulls
- **Octokit.js:** https://github.com/octokit/rest.js
