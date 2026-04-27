/**
 * Pass 2: Persist
 *
 * Upgrades a pass-1 row to pass=2 with full complexity + construct data.
 * Upserts repo_skills, repo_constructs, and repo_sample_prs.
 */

import type { D1Client } from '../shared/d1Client.js';
import type { Pass2Data } from '../shared/types.js';
import { logger } from '../shared/logger.js';

export async function persistPass2(
  db: D1Client,
  data: Pass2Data,
  dryRun = false,
): Promise<void> {
  if (dryRun) {
    logger.info('[pass2/persist] DRY RUN — would update pass=2', { repo_id: data.repo_id });
    return;
  }

  const now = new Date().toISOString();

  // 1. Update the main qualified_repos row
  await db.query(`
    UPDATE qualified_repos SET
      sloc                     = ?,
      file_count               = ?,
      mean_ccn                 = ?,
      has_ci                   = ?,
      has_tests                = ?,
      test_framework           = ?,
      seniority_band           = ?,
      detected_domain          = ?,
      domain_confidence        = ?,
      pr_quality_score         = ?,
      detected_stack_json      = ?,
      business_logic_ratio     = ?,
      cross_module_change_rate = ?,
      readme_excerpt           = ?,
      root_tree_json           = ?,
      pass                     = 2,
      disqualified             = ?,
      disqualified_reason      = ?,
      refreshed_at             = ?
    WHERE id = ?
  `, [
    data.sloc,
    data.file_count,
    data.mean_ccn,
    data.has_ci,
    data.has_tests,
    data.test_framework,
    data.seniority_band,
    data.detected_domain,
    data.domain_confidence,
    data.pr_quality_score,
    data.detected_stack_json,
    data.business_logic_ratio,
    data.cross_module_change_rate,
    data.readme_excerpt,
    data.root_tree_json,
    data.disqualified,
    data.disqualified_reason,
    now,
    data.repo_id,
  ]);

  // 2. Replace skills (delete + insert to handle changed extractor runs)
  await db.query(
    `DELETE FROM repo_skills WHERE repo_id = ?`,
    [data.repo_id],
  );

  if (data.skills.length > 0) {
    const skillStmts = data.skills.map((s) => ({
      sql: `INSERT OR REPLACE INTO repo_skills (repo_id, skill_slug, source, confidence) VALUES (?, ?, ?, ?)`,
      params: [data.repo_id, s.slug, s.source, s.confidence] as (string | number | null)[],
    }));
    await db.upsertChunked(skillStmts, 50);
  }

  // 3. Replace constructs
  await db.query(
    `DELETE FROM repo_constructs WHERE repo_id = ?`,
    [data.repo_id],
  );

  if (data.constructs.length > 0) {
    const constructStmts = data.constructs.map((c) => ({
      sql: `INSERT OR REPLACE INTO repo_constructs (repo_id, construct_slug, evidence_count) VALUES (?, ?, ?)`,
      params: [data.repo_id, c.slug, c.evidence_count] as (string | number | null)[],
    }));
    await db.upsertChunked(constructStmts, 50);
  }

  // 4. Replace sample PRs
  await db.query(
    `DELETE FROM repo_sample_prs WHERE repo_id = ?`,
    [data.repo_id],
  );

  if (data.sample_prs.length > 0) {
    const prStmts = data.sample_prs.map((pr) => ({
      sql: `
        INSERT OR REPLACE INTO repo_sample_prs (
          repo_id, pr_number, pr_url, title, merged_at,
          resolves_issue_number, changed_file_count, modifies_tests,
          additions, deletions, construct_slugs_json, swe_bench_eligible,
          changed_file_paths_json, pr_narrative, pr_narrative_embedding_json,
          pr_narrative_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        data.repo_id,
        pr.pr_number,
        pr.pr_url,
        pr.title,
        pr.merged_at,
        pr.resolves_issue_number,
        pr.changed_file_count,
        pr.modifies_tests,
        pr.additions,
        pr.deletions,
        pr.construct_slugs_json,
        pr.swe_bench_eligible,
        pr.changed_file_paths_json,
        pr.pr_narrative ?? null,
        pr.pr_narrative_embedding_json ?? null,
        pr.pr_narrative_version ?? null,
      ] as (string | number | null)[],
    }));
    await db.upsertChunked(prStmts, 30);
  }

  logger.debug('[pass2/persist] Pass-2 persisted', {
    repo_id: data.repo_id,
    skills: data.skills.length,
    constructs: data.constructs.length,
    sample_prs: data.sample_prs.length,
    disqualified: data.disqualified,
  });
}
