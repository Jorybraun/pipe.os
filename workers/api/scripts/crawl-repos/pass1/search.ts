/**
 * Pass 1: GitHub Search
 *
 * Queries the GitHub Search API for repos matching our search criteria.
 * Returns basic repo metadata without cloning.
 */

import type { GitHubClient } from '../shared/githubClient.js';
import type { GitHubRepoBasic } from '../shared/types.js';
import type { SearchQuery } from '../config.js';
import { logger } from '../shared/logger.js';

const MAX_RESULTS_PER_QUERY = 300; // 3 pages × 100

/**
 * Topic negations applied to every Pass 1 search.
 *
 * Strategy: keep library/utility/UI-kit repos out of the candidate pool BEFORE
 * Pass 2 even clones them. Saves ~30% of clone bandwidth on a typical run and
 * removes an entire class of contamination (Tailwind plugins, React hooks
 * libraries, starter kits) that the canonical-RUC `architecture_style='library'`
 * hard filter would otherwise have to reject post-Pass-3.
 *
 * Centralized here so the 26 SearchQuery rows in config.ts stay declarative.
 */
const EXCLUDED_TOPICS = [
  'plugin',
  'tailwind',
  'ui-kit',
  'starter-kit',
  'hook',
  'component',
  'utility',
] as const;

/**
 * Runs a single search query and returns all matching repos.
 * Handles pagination up to MAX_RESULTS_PER_QUERY.
 */
export async function searchReposForQuery(
  client: GitHubClient,
  query: SearchQuery,
  sixMonthCutoff: string,
): Promise<GitHubRepoBasic[]> {
  const topicClause = query.topics.map((t) => `topic:${t}`).join(' ');
  const excludedTopicsClause = EXCLUDED_TOPICS.map((t) => `-topic:${t}`).join(' ');
  const starsClause = query.maxStars
    ? `stars:${query.minStars}..${query.maxStars}`
    : `stars:>=${query.minStars}`;
  const q = [
    `language:${query.lang}`,
    topicClause,
    excludedTopicsClause,
    starsClause,
    `pushed:>=${sixMonthCutoff}`,
    'fork:false',
    'archived:false',
  ].join(' ');

  logger.info('[pass1/search] Querying GitHub', { query: q });

  const results: GitHubRepoBasic[] = [];
  let page = 1;

  while (results.length < MAX_RESULTS_PER_QUERY) {
    const resp = await client.searchRepos(q, page);
    const items = resp.items;

    if (items.length === 0) break;
    results.push(...items);

    logger.debug('[pass1/search] Page fetched', {
      page,
      count: items.length,
      total: resp.total_count,
      accumulated: results.length,
    });

    if (results.length >= resp.total_count) break;
    if (results.length >= MAX_RESULTS_PER_QUERY) break;
    page++;
  }

  logger.info('[pass1/search] Query complete', {
    lang: query.lang,
    topics: query.topics,
    found: results.length,
  });

  return results;
}
