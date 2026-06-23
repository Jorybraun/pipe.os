/**
 * fetchGitHubDiff — shared utility for fetching PR diff from GitHub API.
 *
 * Used by:
 *   - /api/v1/github/pr (recruiter-facing, Clerk auth)
 *   - /rpc/get-challenge (candidate-facing, self-healing fallback)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface GitHubPRResponse {
  title: string;
  body: string | null;
  state: string;
  user: { login: string };
  created_at: string;
  merged_at: string | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
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
  lines: Array<{ type: 'context' | 'added' | 'removed'; content: string; lineNumber: number }>;
}

export interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  headContent?: string;
  headContentUrl?: string;
}

export interface GitHubDiffResult {
  diff: { files: DiffFile[] };
  metadata: {
    title: string;
    author: string;
    created_at: string;
    state: string;
    base: string;
    head: string;
    base_sha: string;
    head_sha: string;
    merged_at: string | null;
    description: string;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function extractRepoPath(input: string): string | null {
  const normalized = input.trim().replace(/\.git$/, '');
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    return normalized;
  }

  const sshMatch = normalized.match(/^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }

  try {
    const u = new URL(normalized);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}

function parsePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let newLineNum = 0;

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = { header: line, lines: [] };
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      newLineNum = match ? parseInt(match[1] ?? '1', 10) : 1;
    } else if (currentHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({ type: 'added', content: line.slice(1), lineNumber: newLineNum });
        newLineNum++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({ type: 'removed', content: line.slice(1), lineNumber: newLineNum });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', content: line.slice(1), lineNumber: newLineNum });
        newLineNum++;
      }
    }
  }

  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

function encodeGitHubPath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function fetchHeadFileContent(input: {
  repoPath: string;
  filename: string;
  headSha: string;
  headers: Record<string, string>;
}): Promise<{ content: string; url: string } | null> {
  if (!input.filename.trim() || input.headSha.trim() === '') return null;
  const url = `https://api.github.com/repos/${input.repoPath}/contents/${encodeGitHubPath(input.filename)}?ref=${input.headSha}`;
  const response = await fetch(url, {
    headers: {
      ...input.headers,
      Accept: 'application/vnd.github.raw',
    },
  });
  if (!response.ok) return null;
  return {
    content: await response.text(),
    url,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Fetch a PR's diff + metadata from the GitHub API.
 * Returns null if the fetch fails (rate limit, not found, etc.).
 */
export async function fetchGitHubDiff(
  repoUrl: string,
  prNumber: number,
  token?: string,
): Promise<GitHubDiffResult | null> {
  const repoPath = extractRepoPath(repoUrl);
  if (!repoPath) return null;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'pipe-api/1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Fetch PR metadata
  const prRes = await fetch(
    `https://api.github.com/repos/${repoPath}/pulls/${prNumber}`,
    { headers },
  );
  if (!prRes.ok) return null;
  const prData = (await prRes.json()) as GitHubPRResponse;

  // Fetch changed files with patches
  const filesRes = await fetch(
    `https://api.github.com/repos/${repoPath}/pulls/${prNumber}/files?per_page=100`,
    { headers },
  );
  if (!filesRes.ok) return null;
  const filesData = (await filesRes.json()) as GitHubFilesResponse[];

  const diffFiles: DiffFile[] = await Promise.all(filesData.map(async (file) => {
    const headFile = file.status === 'removed'
      ? null
      : await fetchHeadFileContent({
        repoPath,
        filename: file.filename,
        headSha: prData.head.sha,
        headers,
      });
    return {
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      hunks: file.patch ? parsePatch(file.patch) : [],
      ...(headFile
        ? {
            headContent: headFile.content,
            headContentUrl: headFile.url,
          }
        : {}),
    };
  }));

  return {
    diff: { files: diffFiles },
    metadata: {
      title: prData.title,
      author: prData.user.login,
      created_at: prData.created_at,
      state: prData.state,
      base: prData.base.ref,
      head: prData.head.ref,
      base_sha: prData.base.sha,
      head_sha: prData.head.sha,
      merged_at: prData.merged_at,
      description: prData.body ?? '',
    },
  };
}
