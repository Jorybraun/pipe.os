/**
 * GitHub PR proxy routes — Phase 2
 *
 * GET  /api/v1/github/pulls?repoUrl=...   List open PRs for a repo
 * POST /api/v1/github/pr                  Fetch a single PR diff + metadata
 *
 * All calls are proxied server-side using GITHUB_TOKEN — the token is never
 * exposed to the frontend client.
 *
 * All routes require a valid Clerk JWT via authMiddleware.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import type { Env, Variables } from '../types';

// ─── Validation ────────────────────────────────────────────────────────────────

const fetchPrSchema = z.object({
  repoUrl: z
    .string({ required_error: 'repoUrl is required' })
    .url('repoUrl must be a valid URL'),
  prNumber: z
    .number({ required_error: 'prNumber is required' })
    .int()
    .positive('prNumber must be a positive integer'),
});

// ─── Types ─────────────────────────────────────────────────────────────────────

interface GitHubPRResponse {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string };
  created_at: string;
  base: { ref: string };
  head: { ref: string };
}

interface GitHubFilesResponse {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface DiffHunk {
  header: string;
  lines: Array<{ type: 'context' | 'added' | 'removed'; content: string }>;
}

interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

// ─── Router ────────────────────────────────────────────────────────────────────

const github = new Hono<{ Bindings: Env; Variables: Variables }>();

github.use('*', authMiddleware);

/**
 * GET /api/v1/github/pulls?repoUrl=<url>&state=open
 *
 * Lists pull requests for a GitHub repository, proxied through GITHUB_TOKEN.
 *
 * Returns:
 *   200 { success: true, data: { prs: PRSummary[] } }
 *   400 missing/invalid repoUrl
 *   502 GitHub API error
 */
github.get('/pulls', async (c) => {
  const repoUrl = c.req.query('repoUrl');
  const state = c.req.query('state') ?? 'open';

  if (!repoUrl) {
    return apiError(c, 'VALIDATION_ERROR', 'repoUrl query parameter is required.');
  }

  const repoPath = extractRepoPath(repoUrl);
  if (!repoPath) {
    return apiError(c, 'VALIDATION_ERROR', 'Invalid GitHub repository URL.');
  }

  const token = (c.env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'pipe-api/1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(
    `https://api.github.com/repos/${repoPath}/pulls?state=${state}&per_page=50`,
    { headers },
  );

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') ?? '60';
    return c.json(
      { success: false, error: `GitHub rate limit exceeded. Try again in ${retryAfter} seconds.` },
      429,
    );
  }

  if (res.status === 404) {
    return c.json({ success: false, error: 'Repository not found or not accessible.' }, 404);
  }

  if (!res.ok) {
    return c.json(
      { success: false, error: `GitHub API error: ${res.status} ${res.statusText}` },
      502,
    );
  }

  interface GitHubPRItem {
    number: number;
    title: string;
    body: string | null;
    user: { login: string; avatar_url: string };
    state: string;
    draft: boolean;
    created_at: string;
    updated_at: string;
    html_url: string;
    labels: Array<{ name: string }>;
    base: { ref: string };
    head: { ref: string };
  }

  const prs = (await res.json()) as GitHubPRItem[];

  return c.json({
    success: true,
    data: {
      prs: prs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        description: pr.body ?? '',
        author: pr.user.login,
        avatar: pr.user.avatar_url,
        state: pr.state,
        draft: pr.draft,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        htmlUrl: pr.html_url,
        labels: pr.labels.map((l) => l.name),
        baseBranch: pr.base.ref,
        featureBranch: pr.head.ref,
      })),
    },
  });
});

/**
 * POST /api/v1/github/pr
 *
 * Body: { repoUrl: string; prNumber: number }
 *
 * Returns:
 *   200 { success: true, data: { diff, metadata } }
 *   400 invalid URL or body
 *   429 GitHub rate limit
 *   502 GitHub API error
 */
github.post('/pr', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = fetchPrSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { repoUrl, prNumber } = parsed.data;

  // Extract owner/repo from the URL.
  const repoPath = extractRepoPath(repoUrl);
  if (!repoPath) {
    return c.json(
      {
        success: false,
        error: 'Invalid GitHub repository URL',
      },
      400,
    );
  }

  const token = (c.env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'pipe-api/1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Fetch PR metadata.
  const prRes = await fetch(
    `https://api.github.com/repos/${repoPath}/pulls/${prNumber}`,
    { headers },
  );

  if (prRes.status === 429) {
    const retryAfter = prRes.headers.get('Retry-After') ?? '60';
    return c.json(
      {
        success: false,
        error: `GitHub rate limit exceeded. Try again in ${retryAfter} seconds.`,
      },
      429,
    );
  }

  if (prRes.status === 404) {
    return c.json({ success: false, error: 'Pull request not found.' }, 404);
  }

  if (!prRes.ok) {
    return c.json(
      { success: false, error: `GitHub API error: ${prRes.status} ${prRes.statusText}` },
      502,
    );
  }

  const prData = (await prRes.json()) as GitHubPRResponse;

  // Fetch changed files with patches.
  const filesRes = await fetch(
    `https://api.github.com/repos/${repoPath}/pulls/${prNumber}/files?per_page=100`,
    { headers },
  );

  if (filesRes.status === 429) {
    const retryAfter = filesRes.headers.get('Retry-After') ?? '60';
    return c.json(
      {
        success: false,
        error: `GitHub rate limit exceeded. Try again in ${retryAfter} seconds.`,
      },
      429,
    );
  }

  if (!filesRes.ok) {
    return c.json(
      { success: false, error: `GitHub API error fetching files: ${filesRes.status}` },
      502,
    );
  }

  const filesData = (await filesRes.json()) as GitHubFilesResponse[];

  // Parse each file's patch into structured hunks.
  const diffFiles: DiffFile[] = filesData.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    hunks: file.patch ? parsePatch(file.patch) : [],
  }));

  const metadata = {
    title: prData.title,
    author: prData.user.login,
    created_at: prData.created_at,
    state: prData.state,
    base: prData.base.ref,
    head: prData.head.ref,
    description: prData.body ?? '',
  };

  return c.json({
    success: true,
    data: {
      diff: { files: diffFiles },
      metadata,
    },
  });
});

// ─── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Extract "owner/repo" from a full GitHub URL.
 * Accepts: https://github.com/owner/repo or https://github.com/owner/repo.git
 */
function extractRepoPath(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    // pathname: /owner/repo or /owner/repo.git
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}

/**
 * Parse a unified diff patch string into structured hunks.
 */
function parsePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = { header: line, lines: [] };
    } else if (currentHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({ type: 'added', content: line.slice(1) });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({ type: 'removed', content: line.slice(1) });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', content: line.slice(1) });
      }
    }
  }

  if (currentHunk) hunks.push(currentHunk);

  return hunks;
}

export { github };
