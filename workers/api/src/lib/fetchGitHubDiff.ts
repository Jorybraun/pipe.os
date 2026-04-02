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
  lines: Array<{ type: 'context' | 'added' | 'removed'; content: string; lineNumber: number }>;
}

export interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
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
    description: string;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function extractRepoPath(url: string): string | null {
  try {
    const u = new URL(url);
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
      newLineNum = match ? parseInt(match[1], 10) : 1;
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

  const diffFiles: DiffFile[] = filesData.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    hunks: file.patch ? parsePatch(file.patch) : [],
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
      description: prData.body ?? '',
    },
  };
}
