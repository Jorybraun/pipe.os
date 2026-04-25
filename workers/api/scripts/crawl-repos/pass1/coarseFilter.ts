/**
 * Pass 1: Coarse filter
 *
 * Applied before any clone. Rejects repos that obviously cannot qualify.
 * Everything in this module is based solely on GitHub API metadata.
 */

import type { GitHubRepoBasic } from '../shared/types.js';
import { ALLOWED_LICENSES, DOMAIN_DENYLIST_KEYWORDS, computeContaminationRisk } from '../config.js';

export interface FilterResult {
  passed: boolean;
  reason?: string;
}

/**
 * Applies the Pass-1 coarse filter to a GitHub repo.
 *
 * Hard rejects:
 * - archived
 * - fork
 * - no permissive license
 * - no declared language
 * - domain denylist keyword in topics
 *
 * Soft signals (stored but not disqualifying):
 * - contamination risk (computed from stars)
 */
export function coarseFilter(repo: GitHubRepoBasic): FilterResult {
  if (repo.archived) {
    return { passed: false, reason: 'archived' };
  }

  if (repo.fork) {
    return { passed: false, reason: 'fork' };
  }

  if (!repo.language) {
    return { passed: false, reason: 'no_language' };
  }

  // License check
  const spdx = repo.license?.spdx_id;
  if (!spdx || spdx === 'NOASSERTION' || !ALLOWED_LICENSES.has(spdx)) {
    return { passed: false, reason: 'license_not_permissive' };
  }

  // Domain denylist — check topics
  const topics = repo.topics ?? [];
  const topicStr = topics.join(' ').toLowerCase();
  for (const keyword of DOMAIN_DENYLIST_KEYWORDS) {
    if (topicStr.includes(keyword)) {
      return { passed: false, reason: 'domain_specificity' };
    }
  }

  return { passed: true };
}

/**
 * Extracts canonical data from a GitHub repo response for Pass-1 persistence.
 */
export function extractPass1Data(repo: GitHubRepoBasic): {
  github_url: string;
  full_name: string;
  description: string | null;
  homepage: string | null;
  primary_language: string;
  license_spdx: string;
  stars: number;
  last_pushed_at: string;
  is_archived: 0 | 1;
  is_fork: 0 | 1;
  contamination_risk: number;
} {
  return {
    github_url: repo.html_url,
    full_name: repo.full_name,
    description: repo.description,
    homepage: repo.homepage ?? null,
    primary_language: (repo.language ?? 'unknown').toLowerCase(),
    license_spdx: repo.license?.spdx_id ?? 'UNKNOWN',
    stars: repo.stargazers_count,
    last_pushed_at: repo.pushed_at,
    is_archived: repo.archived ? 1 : 0,
    is_fork: repo.fork ? 1 : 0,
    contamination_risk: computeContaminationRisk(repo.stargazers_count),
  };
}
