/**
 * Libraries.io API client for dependency-based repo discovery.
 *
 * Primary discovery signal per repo-discovery-pipeline.md:
 * "Libraries.io dependent_repositories finds repos that actually use
 * React/Django/Spring from their package.json."
 *
 * Rate limit: 60 req/min on free tier.
 * Docs: https://libraries.io/api
 */

const BASE_URL = 'https://libraries.io/api';

export interface LibrariesIoRepo {
  name: string;
  full_name: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  fork: boolean;
  stars_count: number;
  forks_count: number;
  host_type: string;
  github_id: string | null;
  repository_url: string | null;
}

export interface DependentReposResult {
  platform: string;
  packageName: string;
  repos: LibrariesIoRepo[];
  totalFetched: number;
}

/**
 * Fetches repos that depend on a given package.
 *
 * GET /api/:platform/:name/dependent_repositories
 *
 * Returns up to `perPage * pages` repos, sorted by stars descending.
 * Libraries.io paginates at 30/page; we fetch up to 3 pages (90 repos) per package.
 */
export async function fetchDependentRepos(
  apiKey: string,
  platform: string,
  packageName: string,
  options?: { perPage?: number; maxPages?: number },
): Promise<DependentReposResult> {
  const perPage = options?.perPage ?? 30;
  const maxPages = options?.maxPages ?? 3;
  const allRepos: LibrariesIoRepo[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE_URL}/${encodeURIComponent(platform)}/${encodeURIComponent(packageName)}/dependent_repositories?api_key=${apiKey}&per_page=${perPage}&page=${page}&sort=stars`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn(`[librariesIo] Rate limited on ${platform}/${packageName} page ${page}`);
        break;
      }
      const errorText = await response.text();
      console.error(`[librariesIo] API error ${response.status} for ${platform}/${packageName}:`, errorText.slice(0, 200));
      break;
    }

    const repos = (await response.json()) as LibrariesIoRepo[];
    allRepos.push(...repos);

    if (repos.length < perPage) break;
  }

  return {
    platform,
    packageName,
    repos: allRepos,
    totalFetched: allRepos.length,
  };
}

/**
 * Given multiple package queries, fetches dependent repos for each and
 * returns the intersection — repos that depend on ALL queried packages.
 *
 * This is the core "dependency-first" discovery step: a React+TypeScript+Node
 * role should find repos using all three, not repos using any one.
 */
export async function findIntersection(
  apiKey: string,
  queries: Array<{ platform: string; packageName: string }>,
): Promise<LibrariesIoRepo[]> {
  if (queries.length === 0) return [];

  // Fetch dependent repos for each package in parallel
  const results = await Promise.all(
    queries.map((q) => fetchDependentRepos(apiKey, q.platform, q.packageName)),
  );

  // Index by full_name for fast lookup
  const repoSets = results.map((r) => {
    const set = new Map<string, LibrariesIoRepo>();
    for (const repo of r.repos) {
      if (repo.full_name) set.set(repo.full_name.toLowerCase(), repo);
    }
    return set;
  });

  if (repoSets.length === 0) return [];

  // Start with the smallest set for efficiency
  repoSets.sort((a, b) => a.size - b.size);
  const [smallest, ...rest] = repoSets;

  if (!smallest) return [];

  // Intersect: keep only repos present in ALL sets
  const intersection: LibrariesIoRepo[] = [];
  for (const [name, repo] of smallest) {
    if (rest.every((set) => set.has(name))) {
      intersection.push(repo);
    }
  }

  // Sort by stars descending
  intersection.sort((a, b) => (b.stars_count ?? 0) - (a.stars_count ?? 0));

  return intersection;
}
