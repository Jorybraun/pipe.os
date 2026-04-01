/**
 * Repo browser routes — candidate-facing file tree + file viewer.
 *
 * Mounts under /rpc/repo (candidate JWT auth via rpcAuth).
 *
 * Routes:
 *   GET /rpc/repo/:challengeId/tree         — repo file tree
 *   GET /rpc/repo/:challengeId/file         — single file contents
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import type { CandidateVariables } from '../middleware/candidateAuth';
import { extractRepoPath } from '../lib/fetchGitHubDiff';

export const repo = new Hono<{ Bindings: Env; Variables: CandidateVariables }>();

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChallengeRow {
  id: string;
  github_repo_url: string | null;
  cached_metadata: string | null;
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getGitHubHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'pipe-api/1.0',
  };
  const token = (env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function loadChallenge(db: D1Database, challengeId: string): Promise<ChallengeRow | null> {
  return db.prepare(
    `SELECT id, github_repo_url, cached_metadata FROM challenges WHERE id = ?1`,
  )
    .bind(challengeId)
    .first<ChallengeRow>();
}

// ─── GET /rpc/repo/:challengeId/tree ────────────────────────────────────────

repo.get('/:challengeId/tree', async (c) => {
  const challengeId = c.req.param('challengeId');

  const ch = await loadChallenge(c.env.DB, challengeId);
  if (!ch?.github_repo_url) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Challenge has no linked repository.' } }, 404);
  }

  const repoPath = extractRepoPath(ch.github_repo_url);
  if (!repoPath) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid repository URL.' } }, 400);
  }

  // Get the branch from cached metadata (PR head branch)
  let branch = 'main';
  if (ch.cached_metadata) {
    try {
      const meta = JSON.parse(ch.cached_metadata) as Record<string, unknown>;
      if (typeof meta.head === 'string') branch = meta.head;
    } catch { /* use default */ }
  }

  const headers = getGitHubHeaders(c.env);

  // Fetch tree recursively
  const treeRes = await fetch(
    `https://api.github.com/repos/${repoPath}/git/trees/${branch}?recursive=1`,
    { headers },
  );

  if (!treeRes.ok) {
    if (treeRes.status === 404) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Repository tree not found.' } }, 404);
    }
    return c.json({ error: { code: 'GITHUB_ERROR', message: `GitHub API error: ${treeRes.status}` } }, 502);
  }

  const data = (await treeRes.json()) as {
    tree: Array<{ path: string; type: string; size?: number }>;
    truncated: boolean;
  };

  // Filter to relevant files only — skip node_modules, dist, .git, etc.
  const skipPrefixes = ['node_modules/', 'dist/', '.git/', 'build/', '.next/', 'coverage/', '__pycache__/'];
  const skipExact = ['.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

  const tree: TreeEntry[] = data.tree
    .filter((entry) => {
      if (skipExact.includes(entry.path)) return false;
      for (const prefix of skipPrefixes) {
        if (entry.path.startsWith(prefix)) return false;
      }
      return true;
    })
    .map((entry) => ({
      path: entry.path,
      type: entry.type === 'tree' ? 'tree' as const : 'blob' as const,
      size: entry.size ?? 0,
    }));

  return c.json({ tree, truncated: data.truncated });
});

// ─── GET /rpc/repo/:challengeId/file ────────────────────────────────────────

repo.get('/:challengeId/file', async (c) => {
  const challengeId = c.req.param('challengeId');
  const filePath = c.req.query('path');

  if (!filePath || filePath.includes('..') || filePath.startsWith('/')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid file path.' } }, 400);
  }

  const ch = await loadChallenge(c.env.DB, challengeId);
  if (!ch?.github_repo_url) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Challenge has no linked repository.' } }, 404);
  }

  const repoPath = extractRepoPath(ch.github_repo_url);
  if (!repoPath) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid repository URL.' } }, 400);
  }

  // Get branch from cached metadata
  let branch = 'main';
  if (ch.cached_metadata) {
    try {
      const meta = JSON.parse(ch.cached_metadata) as Record<string, unknown>;
      if (typeof meta.head === 'string') branch = meta.head;
    } catch { /* use default */ }
  }

  const headers = getGitHubHeaders(c.env);

  // Fetch file contents (raw)
  const fileRes = await fetch(
    `https://api.github.com/repos/${repoPath}/contents/${encodeURIComponent(filePath)}?ref=${branch}`,
    { headers: { ...headers, Accept: 'application/vnd.github.v3.raw' } },
  );

  if (!fileRes.ok) {
    if (fileRes.status === 404) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'File not found.' } }, 404);
    }
    return c.json({ error: { code: 'GITHUB_ERROR', message: `GitHub API error: ${fileRes.status}` } }, 502);
  }

  // Check content-length before reading body
  const contentLength = fileRes.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > 100_000) {
    return c.json({ error: { code: 'TOO_LARGE', message: 'File exceeds 100KB limit.' } }, 413);
  }

  const content = await fileRes.text();

  if (content.length > 100_000) {
    return c.json({ error: { code: 'TOO_LARGE', message: 'File exceeds 100KB limit.' } }, 413);
  }

  return c.json({ path: filePath, content, size: content.length });
});
