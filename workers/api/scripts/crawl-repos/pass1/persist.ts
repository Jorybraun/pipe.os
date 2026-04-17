/**
 * Pass 1: Persist
 *
 * Writes pass-1 rows to D1. Uses UPSERT so re-running pass-1 is safe.
 * Only updates the metadata columns — does not overwrite pass=2 rows.
 */

import type { D1Client } from '../shared/d1Client.js';
import type { Pass1Row } from '../shared/types.js';
import { logger } from '../shared/logger.js';
import { REPO_FULL_NAME_DENYLIST } from '../config.js';

export interface Pass1PersistResult {
  repoId: number;
  inserted: boolean;
}

/**
 * Upserts a single pass-1 row into qualified_repos.
 * Returns the assigned id.
 *
 * Strategy:
 * - INSERT OR IGNORE so existing pass-2 rows are not overwritten
 * - Then SELECT to get the id
 * - Then upsert skills
 */
export async function persistPass1Row(
  db: D1Client,
  row: Pass1Row,
  dryRun = false,
): Promise<Pass1PersistResult> {
  if (REPO_FULL_NAME_DENYLIST.has(row.full_name)) {
    logger.info('[pass1/persist] Skipping deny-listed repo', { full_name: row.full_name });
    return { repoId: -1, inserted: false };
  }

  if (dryRun) {
    logger.info('[pass1/persist] DRY RUN — would upsert', { full_name: row.full_name });
    return { repoId: -1, inserted: false };
  }

  const now = row.crawled_at;

  // Upsert the main row.
  // On conflict (github_url), only update metadata if the existing row is pass=1.
  // Never downgrade a pass=2 row.
  const upsertSql = `
    INSERT INTO qualified_repos (
      github_url, full_name, description, homepage,
      primary_language, license_spdx, stars, last_pushed_at,
      is_archived, is_fork, contamination_risk,
      open_pr_count, open_feature_issue_count,
      pass, disqualified, crawled_at, refreshed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    ON CONFLICT(github_url) DO UPDATE SET
      description              = excluded.description,
      homepage                 = excluded.homepage,
      stars                    = excluded.stars,
      last_pushed_at           = excluded.last_pushed_at,
      is_archived              = excluded.is_archived,
      is_fork                  = excluded.is_fork,
      contamination_risk       = excluded.contamination_risk,
      open_pr_count            = excluded.open_pr_count,
      open_feature_issue_count = excluded.open_feature_issue_count,
      refreshed_at             = excluded.refreshed_at
    WHERE qualified_repos.pass = 1
  `;

  await db.query(upsertSql, [
    row.github_url,
    row.full_name,
    row.description,
    row.homepage,
    row.primary_language,
    row.license_spdx,
    row.stars,
    row.last_pushed_at,
    row.is_archived,
    row.is_fork,
    row.contamination_risk,
    row.open_pr_count,
    row.open_feature_issue_count,
    now,
    now,
  ]);

  // Fetch the id
  const rows = await db.query<{ id: number }>(
    `SELECT id FROM qualified_repos WHERE github_url = ?`,
    [row.github_url],
  );

  const repoId = rows[0]?.id;
  if (!repoId) {
    throw new Error(`[pass1/persist] Could not fetch id for ${row.github_url}`);
  }

  // Upsert skills
  if (row.manifest_skills.length > 0) {
    const skillStatements = row.manifest_skills.map((s) => ({
      sql: `INSERT OR REPLACE INTO repo_skills (repo_id, skill_slug, source, confidence) VALUES (?, ?, ?, ?)`,
      params: [repoId, s.slug, s.source, s.confidence] as (string | number | null)[],
    }));
    await db.upsertChunked(skillStatements, 50);
  }

  logger.debug('[pass1/persist] Persisted', { full_name: row.full_name, repoId });
  return { repoId, inserted: true };
}

