/**
 * Issue Crawler Cron Handler — weekly batch fetch of GitHub issues (RD-P6).
 *
 * Trigger: Sunday 03:00 UTC (configured in wrangler.jsonc)
 * Rate: ~10 repos per invocation to stay within Worker CPU limits
 *
 * Flow:
 *   1. Query qualified_repos for next batch needing refresh (crawled_at > 7 days)
 *   2. For each repo: fetch open issues via GitHub API
 *   3. Filter out PRs (GitHub returns them in issues endpoint)
 *   4. Check for linked merged PRs (skip for CODE_IMPLEMENTATION)
 *   5. UPSERT into repo_issues
 *   6. Update crawler_state cursor for resumption
 */

import type { Env, RepoIssueRow } from '../../types';
import { fetchIssues, batchCheckLinkedMergedPRs } from '../../lib/github/issueClient';

// ─── Config ─────────────────────────────────────────────────────────────────

/** Number of repos to process per cron invocation. */
const BATCH_SIZE = 10;

/** Maximum issues to fetch per repo. */
const ISSUE_FETCH_LIMIT = 50;

/** Number of days before an issue crawl is considered stale. */
const STALE_DAYS = 7;

/** Body truncation limit for storage (8KB). */
const MAX_BODY_LENGTH = 8192;

// ─── Main Handler ───────────────────────────────────────────────────────────

export async function handleIssueCrawlerCron(env: Env): Promise<{ processed: number; errors: string[] }> {
  const db = env.DB;
  const token = env.GITHUB_TOKEN;

  // Get cursor from crawler_state
  const cursorRow = await db
    .prepare('SELECT value_json FROM crawler_state WHERE key = ?')
    .bind('issue_crawler_cursor')
    .first<{ value_json: string }>();

  const cursor = cursorRow
    ? (JSON.parse(cursorRow.value_json) as { last_repo_id: number })
    : { last_repo_id: 0 };

  // Find repos needing issue refresh
  const staleThreshold = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const repos = await db
    .prepare(`
      SELECT qr.id, qr.full_name, qr.github_url
      FROM qualified_repos qr
      LEFT JOIN (
        SELECT repo_id, MAX(crawled_at) as last_crawl
        FROM repo_issues
        GROUP BY repo_id
      ) ri ON qr.id = ri.repo_id
      WHERE qr.disqualified = 0
        AND qr.id > ?
        AND (ri.last_crawl IS NULL OR ri.last_crawl < ?)
      ORDER BY qr.id ASC
      LIMIT ?
    `)
    .bind(cursor.last_repo_id, staleThreshold, BATCH_SIZE)
    .all<{ id: number; full_name: string; github_url: string }>();

  if (!repos.results || repos.results.length === 0) {
    // No more repos to process — reset cursor for next cycle
    await db
      .prepare('UPDATE crawler_state SET value_json = ?, updated_at = datetime("now") WHERE key = ?')
      .bind(JSON.stringify({ last_repo_id: 0 }), 'issue_crawler_cursor')
      .run();

    return { processed: 0, errors: [] };
  }

  const errors: string[] = [];
  let lastProcessedId = cursor.last_repo_id;

  for (const repo of repos.results) {
    try {
      const [owner, repoName] = repo.full_name.split('/');
      if (!owner || !repoName) {
        errors.push(`Invalid full_name: ${repo.full_name}`);
        continue;
      }

      // Fetch issues from GitHub
      const issues = await fetchIssues(owner, repoName, {
        token,
        limit: ISSUE_FETCH_LIMIT,
        state: 'open',
        sort: 'updated',
      });

      if (issues.length === 0) {
        lastProcessedId = repo.id;
        continue;
      }

      // Batch check for linked merged PRs
      const issueNumbers = issues.map((i) => i.issue_number);
      const linkedPRs = await batchCheckLinkedMergedPRs(owner, repoName, issueNumbers, token);

      // UPSERT each issue
      for (const issue of issues) {
        const hasMergedPR = linkedPRs.get(issue.issue_number) ?? false;

        await upsertIssue(db, repo.id, issue, hasMergedPR);
      }

      lastProcessedId = repo.id;
      console.log(`[issueCrawler] Processed ${repo.full_name}: ${issues.length} issues`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${repo.full_name}: ${msg}`);
      console.error(`[issueCrawler] Error processing ${repo.full_name}:`, msg);
    }
  }

  // Update cursor
  await db
    .prepare('UPDATE crawler_state SET value_json = ?, updated_at = datetime("now") WHERE key = ?')
    .bind(JSON.stringify({ last_repo_id: lastProcessedId }), 'issue_crawler_cursor')
    .run();

  return { processed: repos.results.length, errors };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ParsedIssue {
  github_issue_id: number;
  issue_number: number;
  title: string;
  body: string | null;
  author_login: string;
  labels: string[];
  comment_count: number;
  reactions_total: number;
  github_created_at: string;
  github_updated_at: string;
  state: 'open' | 'closed';
}

async function upsertIssue(
  db: D1Database,
  repoId: number,
  issue: ParsedIssue,
  hasMergedPR: boolean,
): Promise<void> {
  // Truncate body to MAX_BODY_LENGTH for the primary storage column
  const body = issue.body
    ? issue.body.length > MAX_BODY_LENGTH
      ? issue.body.slice(0, MAX_BODY_LENGTH) + '\n\n[truncated]'
      : issue.body
    : null;

  const labelsJson = JSON.stringify(issue.labels);

  // Cache the full untruncated body for challenge UI surfacing
  const bodyCacheJson = JSON.stringify({
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    state: issue.state,
  });

  const bodyCachedAt = Math.floor(Date.now() / 1000);

  await db
    .prepare(`
      INSERT INTO repo_issues (
        repo_id, github_issue_id, issue_number, title, body, author_login,
        labels_json, comment_count, reactions_total,
        github_created_at, github_updated_at, crawled_at, state_at_crawl, has_merged_pr,
        body_cache_json, body_cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)
      ON CONFLICT(repo_id, issue_number) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        labels_json = excluded.labels_json,
        comment_count = excluded.comment_count,
        reactions_total = excluded.reactions_total,
        github_updated_at = excluded.github_updated_at,
        crawled_at = datetime('now'),
        state_at_crawl = excluded.state_at_crawl,
        has_merged_pr = excluded.has_merged_pr,
        body_cache_json = excluded.body_cache_json,
        body_cached_at = excluded.body_cached_at
    `)
    .bind(
      repoId,
      issue.github_issue_id,
      issue.issue_number,
      issue.title,
      body,
      issue.author_login,
      labelsJson,
      issue.comment_count,
      issue.reactions_total,
      issue.github_created_at,
      issue.github_updated_at,
      issue.state,
      hasMergedPR ? 1 : 0,
      bodyCacheJson,
      bodyCachedAt,
    )
    .run();
}
