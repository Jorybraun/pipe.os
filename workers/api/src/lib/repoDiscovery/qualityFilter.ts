/**
 * GitHub API quality filter for discovered repos.
 *
 * Stage 2 of the discovery pipeline (repo-discovery-pipeline.md):
 * Stars ≥ 500, pushed < 6mo, permissive license, not archived, not fork.
 *
 * Uses GitHub REST API. Rate limit: 5000 req/hr (authenticated), 60/hr (unauth).
 */

/** Freshness gate — repos must have been pushed after this date. Advanced quarterly. */
const FRESHNESS_GATE = '2024-07-01';

const PERMISSIVE_LICENSES = new Set([
  'mit', 'apache-2.0', 'bsd-2-clause', 'bsd-3-clause',
  'isc', 'mpl-2.0', 'unlicense', '0bsd',
]);

const MIN_STARS = 500;

export interface QualityCheckResult {
  passed: boolean;
  repo: GitHubRepoInfo | null;
  failures: string[];
}

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  stars: number;
  pushedAt: string;
  license: string | null;
  language: string | null;
  topics: string[];
  isArchived: boolean;
  isFork: boolean;
  hasCi: boolean;
}

interface GitHubRepoResponse {
  full_name: string;
  html_url: string;
  default_branch: string;
  stargazers_count: number;
  pushed_at: string;
  license: { spdx_id: string } | null;
  language: string | null;
  topics: string[];
  archived: boolean;
  fork: boolean;
  owner: { login: string };
  name: string;
}

/**
 * Fetches repo metadata from GitHub and checks quality criteria.
 * Returns pass/fail with a list of failure reasons.
 */
export async function checkRepoQuality(
  owner: string,
  repo: string,
  githubToken?: string,
): Promise<QualityCheckResult> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
  });

  if (!response.ok) {
    return {
      passed: false,
      repo: null,
      failures: [`GitHub API ${response.status}: could not fetch repo`],
    };
  }

  const data = (await response.json()) as GitHubRepoResponse;
  const failures: string[] = [];

  // Check stars
  if (data.stargazers_count < MIN_STARS) {
    failures.push(`stars ${data.stargazers_count} < ${MIN_STARS}`);
  }

  // Check freshness
  if (data.pushed_at < FRESHNESS_GATE) {
    failures.push(`last pushed ${data.pushed_at} before freshness gate ${FRESHNESS_GATE}`);
  }

  // Check pushed within 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  if (new Date(data.pushed_at) < sixMonthsAgo) {
    failures.push(`last pushed ${data.pushed_at} is older than 6 months`);
  }

  // Check license
  const license = data.license?.spdx_id?.toLowerCase() ?? null;
  if (!license || !PERMISSIVE_LICENSES.has(license)) {
    failures.push(`license '${license ?? 'none'}' is not permissive`);
  }

  // Check archived
  if (data.archived) {
    failures.push('repo is archived');
  }

  // Check fork
  if (data.fork) {
    failures.push('repo is a fork');
  }

  // Check for CI (heuristic: look for common CI config files via the API)
  const hasCi = await detectCI(owner, repo, data.default_branch, headers);

  const info: GitHubRepoInfo = {
    owner: data.owner.login,
    repo: data.name,
    fullName: data.full_name,
    url: data.html_url,
    defaultBranch: data.default_branch,
    stars: data.stargazers_count,
    pushedAt: data.pushed_at,
    license,
    language: data.language,
    topics: data.topics ?? [],
    isArchived: data.archived,
    isFork: data.fork,
    hasCi,
  };

  return {
    passed: failures.length === 0,
    repo: info,
    failures,
  };
}

/**
 * Checks for CI configuration by looking for common CI config paths.
 * Uses GitHub Contents API to check for .github/workflows directory.
 */
async function detectCI(
  owner: string,
  repo: string,
  branch: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const ciPaths = [
    `.github/workflows`,
    `.circleci/config.yml`,
  ];

  for (const path of ciPaths) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
        { headers },
      );
      if (response.ok) return true;
    } catch {
      // Ignore fetch errors — CI detection is best-effort
    }
  }

  return false;
}
