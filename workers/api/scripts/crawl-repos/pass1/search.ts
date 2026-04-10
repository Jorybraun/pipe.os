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
 * Runs a single search query and returns all matching repos.
 * Handles pagination up to MAX_RESULTS_PER_QUERY.
 */
export async function searchReposForQuery(
  client: GitHubClient,
  query: SearchQuery,
  sixMonthCutoff: string,
): Promise<GitHubRepoBasic[]> {
  const topicClause = query.topics.map((t) => `topic:${t}`).join(' ');
  const q = [
    `language:${query.lang}`,
    topicClause,
    `stars:>=${query.minStars}`,
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
