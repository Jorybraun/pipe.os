/**
 * Tests for fetchGitHubPR Lambda Handler
 *
 * STREAM 2: GitHub PR Integration for Code Review Challenges
 * Phase 1: GitHub API Integration
 *
 * Comprehensive test suite covering:
 * - Happy path (valid PR, successful fetch)
 * - All error scenarios (not found, auth, rate limit, etc.)
 * - Diff parsing (multiple files, hunks, line types)
 * - Edge cases (large diffs, deleted files, etc.)
 *
 * Target: 80%+ coverage
 * All tests use mocked GitHub API responses (no real API calls)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handler } from '../handler';
import type {
  FetchGitHubPRInput,
  FetchGitHubPRSuccess,
  FetchGitHubPRError,
  DiffLine,
} from '../types';

// ============================================================
// Mock Setup
// ============================================================

// Mock AWS Secrets Manager
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  GetSecretValueCommand: vi.fn((config) => config),
}));

// Mock Octokit
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      pulls: {
        get: vi.fn(),
      },
    },
    paginate: vi.fn(),
  })),
}));

// Import mocked modules
import { Octokit } from '@octokit/rest';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

// ============================================================
// Test Fixtures
// ============================================================

const MOCK_PR_DATA = {
  number: 42,
  title: 'Add batch email sending',
  body: 'Implements batch sending support for marketing automation',
  state: 'open',
  user: {
    login: 'octocat',
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
  },
  created_at: '2026-03-10T10:00:00Z',
  updated_at: '2026-03-13T15:30:00Z',
  html_url: 'https://github.com/octocat/Hello-World/pull/42',
  head: {
    ref: 'feat/batch-email',
  },
  base: {
    ref: 'main',
  },
  labels: [
    { name: 'enhancement' },
    { name: 'backend' },
  ],
  requested_reviewers: [
    { login: 'reviewer1' },
    { login: 'reviewer2' },
  ],
};

const MOCK_FILES_RESPONSE = [
  {
    filename: 'src/services/email_sender.py',
    status: 'modified',
    additions: 50,
    deletions: 10,
    patch: `@@ -15,8 +15,42 @@ class EmailSender:
 class EmailSender:
   def __init__(self, client, config=None):
     self.client = client
-    self.config = config or {}
+    self.config = config or DEFAULT_CONFIG
+    self.rate_limiter = RateLimiter(
+        max_requests=self.config.get("rate_limit", 100),
+        window_seconds=60
+    )
   
   def send(self, message):
     """Send a single email."""
     return self.client.send(message)
+  
+  def send_batch(self, messages):
+    """Send multiple emails with rate limiting."""
+    results = []
+    for msg in messages:
+      if self.rate_limiter.allow_request():
+        result = self.send(msg)
+        results.append(result)
+      else:
+        results.append({"error": "rate_limited"})
+    return results`,
  },
  {
    filename: 'src/rate_limiter.py',
    status: 'added',
    additions: 39,
    deletions: 0,
    patch: `@@ -0,0 +1,39 @@
+import time
+from threading import Lock
+
+class RateLimiter:
+    """Simple token bucket rate limiter."""
+    
+    def __init__(self, max_requests, window_seconds):
+        self.max_requests = max_requests
+        self.window_seconds = window_seconds
+        self.requests = []
+        self.lock = Lock()
+    
+    def allow_request(self):
+        """Check if request is allowed."""
+        with self.lock:
+            now = time.time()
+            cutoff = now - self.window_seconds
+            
+            # Remove old requests
+            self.requests = [
+                req_time for req_time in self.requests
+                if req_time > cutoff
+            ]
+            
+            if len(self.requests) < self.max_requests:
+                self.requests.append(now)
+                return True
+            return False`,
  },
  {
    filename: 'src/old_email_sender.py',
    status: 'deleted',
    additions: 0,
    deletions: 25,
    patch: `@@ -1,25 +0,0 @@
-# DEPRECATED: Use email_sender.py instead
-class OldEmailSender:
-    def __init__(self, client):
-        self.client = client
-    
-    def send(self, message):
-        return self.client.send(message)`,
  },
];

// ============================================================
// Helper Functions
// ============================================================

function createMockOctokit(options: any = {}) {
  const mockOctokit = new Octokit();

  // Mock pulls.get()
  mockOctokit.rest.pulls.get = vi.fn(async () => {
    if (options.pullGetError) {
      throw options.pullGetError;
    }
    return { data: options.prData || MOCK_PR_DATA };
  });

  // Mock paginate()
  mockOctokit.paginate = vi.fn(async () => {
    if (options.paginateError) {
      throw options.paginateError;
    }
    return options.filesResponse || MOCK_FILES_RESPONSE;
  });

  return mockOctokit;
}

function mockSecretsManager(tokenValue: string) {
  const mockSecrets = SecretsManagerClient as any;
  const instance = new mockSecrets();
  instance.send = vi.fn(async () => ({
    SecretString: JSON.stringify({ token: tokenValue }),
  }));
  return instance;
}

// ============================================================
// Test Cases
// ============================================================

describe('fetchGitHubPR Lambda Handler', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    // Set environment variable
    process.env.GITHUB_TOKEN_SECRET_ARN = 'pipe-github-pr-integration';
  });

  // ====== SUCCESS CASES ======

  it('should fetch valid PR successfully (happy path)', async () => {
    // Setup mocks
    const mockOctokit = createMockOctokit();
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const input: FetchGitHubPRInput = {
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    };

    const result = (await handler(input)) as FetchGitHubPRSuccess;

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.error).toBeNull();
    expect(result.data!.prNumber).toBe(42);
    expect(result.data!.title).toBe('Add batch email sending');
    expect(result.data!.author).toBe('octocat');
    expect(result.data!.state).toBe('open');
    expect(result.data!.filesChanged).toBe(3);
    expect(result.data!.additions).toBe(89);
    expect(result.data!.deletions).toBe(35);
    expect(result.data!.fetchedAt).toBeDefined();
  });

  it('should parse multiple files with correct stats', async () => {
    const mockOctokit = createMockOctokit();
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRSuccess;

    expect(result.data!.diff.files).toHaveLength(3);
    expect(result.data!.diff.files[0].path).toBe('src/services/email_sender.py');
    expect(result.data!.diff.files[0].status).toBe('modified');
    expect(result.data!.diff.files[1].path).toBe('src/rate_limiter.py');
    expect(result.data!.diff.files[1].status).toBe('added');
    expect(result.data!.diff.files[2].path).toBe('src/old_email_sender.py');
    expect(result.data!.diff.files[2].status).toBe('deleted');
  });

  it('should parse diff hunks with all line types (addition, deletion, context)', async () => {
    const mockOctokit = createMockOctokit();
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRSuccess;

    const firstFile = result.data!.diff.files[0];
    expect(firstFile.hunks.length).toBeGreaterThan(0);

    const hunk = firstFile.hunks[0];
    expect(hunk.header).toMatch(/@@ -\d+/);
    expect(hunk.lines.length).toBeGreaterThan(0);

    // Check line types
    const lineTypes = new Set(hunk.lines.map((l) => l.type));
    expect(['addition', 'deletion', 'context'].some((t) => lineTypes.has(t))).toBe(true);

    // Verify line structure
    hunk.lines.forEach((line) => {
      expect(['addition', 'deletion', 'context']).toContain(line.type);
      expect(line.lineNumber).toBeGreaterThan(0);
      expect(line.content).toBeDefined();
    });
  });

  it('should include metadata with author, avatar, and labels', async () => {
    const mockOctokit = createMockOctokit();
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRSuccess;

    const metadata = result.data!.metadata;
    expect(metadata.author).toBe('octocat');
    expect(metadata.avatar).toBe('https://avatars.githubusercontent.com/u/1?v=4');
    expect(metadata.labels).toContain('enhancement');
    expect(metadata.labels).toContain('backend');
    expect(metadata.reviewers).toContain('reviewer1');
    expect(metadata.htmlUrl).toBe('https://github.com/octocat/Hello-World/pull/42');
    expect(metadata.featureBranch).toBe('feat/batch-email');
    expect(metadata.baseBranch).toBe('main');
  });

  // ====== ERROR CASES ======

  it('should return INVALID_INPUT when repoUrl is missing', async () => {
    const result = (await handler({
      prNumber: 42,
    })) as FetchGitHubPRError;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.message).toContain('repoUrl');
    expect(result.error.retryable).toBe(false);
  });

  it('should return INVALID_INPUT when prNumber is not a positive integer', async () => {
    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: -1,
    })) as FetchGitHubPRError;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.retryable).toBe(false);
  });

  it('should return INVALID_REPOSITORY for malformed GitHub URL', async () => {
    const result = (await handler({
      repoUrl: 'https://github.com/invalid-url',
      prNumber: 42,
    })) as FetchGitHubPRError;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('INVALID_REPOSITORY');
    expect(result.error.message).toContain('Invalid GitHub URL');
    expect(result.error.retryable).toBe(false);
  });

  it('should return PULL_REQUEST_NOT_FOUND when PR does not exist', async () => {
    const error = new Error('Not Found');
    (error as any).status = 404;

    const mockOctokit = createMockOctokit({
      pullGetError: error,
    });
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 999999,
    })) as FetchGitHubPRError;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('PULL_REQUEST_NOT_FOUND');
    expect(result.error.retryable).toBe(false);
  });

  it('should return RATE_LIMIT_EXCEEDED when GitHub API rate limit hit', async () => {
    const error = new Error('Forbidden');
    (error as any).status = 403;
    (error as any).response = {
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': Math.floor(Date.now() / 1000) + 3600,
      },
    };

    const mockOctokit = createMockOctokit({
      pullGetError: error,
    });
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRError;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(result.error.retryable).toBe(true);
  });

  it('should return GITHUB_AUTH_ERROR when token is invalid', async () => {
    const error = new Error('Unauthorized');
    (error as any).status = 401;

    const mockOctokit = createMockOctokit({
      pullGetError: error,
    });
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRError;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('GITHUB_AUTH_ERROR');
    expect(result.error.retryable).toBe(false);
  });

  it('should return DIFF_TOO_LARGE when diff exceeds 10MB', async () => {
    // Create a very large patch
    const largeContent = 'x'.repeat(11_000_000); // 11 MB
    const largeFile = {
      ...MOCK_FILES_RESPONSE[0],
      patch: largeContent,
    };

    const mockOctokit = createMockOctokit({
      filesResponse: [largeFile],
    });
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRError;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('DIFF_TOO_LARGE');
    expect(result.error.retryable).toBe(false);
  });

  it('should return NETWORK_ERROR for connection failures', async () => {
    const error = new Error('Connection refused');
    (error as any).code = 'ECONNREFUSED';

    const mockOctokit = createMockOctokit({
      pullGetError: error,
    });
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRError;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('NETWORK_ERROR');
    expect(result.error.retryable).toBe(true);
  });

  it('should handle UNKNOWN_ERROR gracefully', async () => {
    const error = new Error('Some unexpected error');
    (error as any).status = 500; // Unhandled status

    const mockOctokit = createMockOctokit({
      pullGetError: error,
    });
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRError;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('UNKNOWN_ERROR');
    expect(result.error.retryable).toBe(true);
  });

  // ====== EDGE CASES ======

  it('should handle PR with no files changed', async () => {
    const mockOctokit = createMockOctokit({
      filesResponse: [],
    });
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRSuccess;

    expect(result.success).toBe(true);
    expect(result.data!.filesChanged).toBe(0);
    expect(result.data!.diff.files).toHaveLength(0);
  });

  it('should handle PR with empty description', async () => {
    const prDataWithoutBody = { ...MOCK_PR_DATA, body: null };
    const mockOctokit = createMockOctokit({
      prData: prDataWithoutBody,
    });
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRSuccess;

    expect(result.success).toBe(true);
    expect(result.data!.description).toBe('');
  });

  it('should handle PR with merged state', async () => {
    const mergedPR = { ...MOCK_PR_DATA, state: 'merged' };
    const mockOctokit = createMockOctokit({
      prData: mergedPR,
    });
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World',
      prNumber: 42,
    })) as FetchGitHubPRSuccess;

    expect(result.success).toBe(true);
    expect(result.data!.state).toBe('merged');
  });

  it('should normalize GitHub URL with trailing slash', async () => {
    const mockOctokit = createMockOctokit();
    (Octokit as any).mockReturnValueOnce(mockOctokit);
    mockSecretsManager('fake-github-token');

    const result = (await handler({
      repoUrl: 'https://github.com/octocat/Hello-World/',
      prNumber: 42,
    })) as FetchGitHubPRSuccess;

    expect(result.success).toBe(true);
  });
});
