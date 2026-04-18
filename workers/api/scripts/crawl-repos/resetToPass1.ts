/**
 * Bulk reset — demote all pass=2 repos back to pass=1 so Pass 2 re-runs on them.
 *
 * Mirrors the per-repo `/requeue` endpoint in `adminRepos.ts` but for the whole
 * table. Pass 1 metadata (full_name, license, stars, manifest skills, etc.) is
 * preserved; everything derived from Pass 2 or later is wiped so the next
 * `--pass2` run starts clean.
 *
 * Usage:
 *   npx tsx scripts/crawl-repos/resetToPass1.ts [--dry-run]
 *
 * The destination is the remote D1 (configured via CLOUDFLARE_* env vars in
 * .dev.vars). There is no local fallback — run `bash scripts/sync-repos-local.sh`
 * after reset if you need the local DB in sync.
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1Client, loadD1Config } from './shared/d1Client.js';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const db = new D1Client(loadD1Config());

  const [{ count: pass2Count }] = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM qualified_repos WHERE pass = 2`,
  );
  const [{ count: signalsCount }] = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM repo_engineering_signals`,
  );
  const [{ count: prsCount }] = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM repo_sample_prs`,
  );
  const [{ count: constructsCount }] = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM repo_constructs`,
  );
  const [{ count: skillsCount }] = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM repo_skills`,
  );

  process.stderr.write(
    `[resetToPass1] Plan (${dryRun ? 'DRY RUN' : 'LIVE'}):\n` +
      `  qualified_repos pass=2 → pass=1:       ${pass2Count}\n` +
      `  repo_engineering_signals to delete:    ${signalsCount}\n` +
      `  repo_sample_prs to delete:             ${prsCount}\n` +
      `  repo_constructs to delete:             ${constructsCount}\n` +
      `  repo_skills to delete:                 ${skillsCount}\n`,
  );

  if (dryRun) {
    process.stderr.write('[resetToPass1] Dry run — no writes.\n');
    return;
  }

  await db.query(`DELETE FROM repo_engineering_signals`);
  await db.query(`DELETE FROM repo_sample_prs`);
  await db.query(`DELETE FROM repo_constructs`);
  await db.query(`DELETE FROM repo_skills`);

  await db.query(`
    UPDATE qualified_repos SET
      pass                     = 1,
      disqualified             = 0,
      disqualified_reason      = NULL,
      admin_status             = 'pending',
      admin_reason             = NULL,
      sloc                     = NULL,
      file_count               = NULL,
      mean_ccn                 = NULL,
      has_ci                   = 0,
      has_tests                = 0,
      test_framework           = NULL,
      detected_domain          = NULL,
      domain_confidence        = NULL,
      detected_stack_json      = NULL,
      seniority_band           = NULL,
      pr_quality_score         = 0,
      business_logic_ratio     = NULL,
      cross_module_change_rate = NULL,
      readme_excerpt           = NULL,
      root_tree_json           = NULL
    WHERE pass >= 2
  `);

  process.stderr.write('[resetToPass1] Done.\n');
}

main().catch((err: unknown) => {
  console.error('[resetToPass1] failed:', err);
  process.exit(1);
});
