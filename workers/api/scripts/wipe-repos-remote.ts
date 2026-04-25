#!/usr/bin/env tsx
/**
 * Manage remote D1 repo table state.
 *
 * Usage:
 *   npx tsx scripts/wipe-repos-remote.ts             # wipe everything (all passes)
 *   npx tsx scripts/wipe-repos-remote.ts --reset-pass2  # demote pass=2 back to pass=1
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.dev.vars') });

import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';

const { values: args } = parseArgs({
  options: { 'reset-pass2': { type: 'boolean', default: false } },
});

async function main(): Promise<void> {
  const d1 = new D1Client(loadD1Config());

  if (args['reset-pass2']) {
    // Demote pass=2 repos back to pass=1 so they get re-processed.
    // Clears all pass-2 derived data: PRs, constructs, signals, and analysis columns.
    console.log('Resetting pass=2 repos back to pass=1...');

    await d1.query('DELETE FROM repo_engineering_signals', []);
    console.log('✓ repo_engineering_signals cleared');

    await d1.query('DELETE FROM repo_sample_prs', []);
    console.log('✓ repo_sample_prs cleared');

    await d1.query('DELETE FROM repo_constructs', []);
    console.log('✓ repo_constructs cleared');

    await d1.query(
      `UPDATE qualified_repos SET
         pass = 1,
         disqualified = 0,
         disqualified_reason = NULL,
         sloc = NULL,
         file_count = NULL,
         mean_ccn = NULL,
         has_ci = 0,
         has_tests = 0,
         test_framework = NULL,
         detected_domain = NULL,
         detected_stack_json = NULL,
         seniority_band = NULL,
         pr_quality_score = 0,
         business_logic_ratio = NULL,
         cross_module_change_rate = NULL,
         admin_status = 'pending'
       WHERE pass >= 2`,
      [],
    );
    console.log('✓ qualified_repos reset to pass=1');
    console.log('Done. Run pass 2 to re-process.');
  } else {
    // Full wipe — removes everything.
    console.log('Wiping all remote repo tables...');

    await d1.query('DELETE FROM repo_engineering_signals', []);
    console.log('✓ repo_engineering_signals cleared');

    await d1.query('DELETE FROM repo_sample_prs', []);
    console.log('✓ repo_sample_prs cleared');

    await d1.query('DELETE FROM repo_constructs', []);
    console.log('✓ repo_constructs cleared');

    await d1.query('DELETE FROM qualified_repos', []);
    console.log('✓ qualified_repos cleared');

    console.log('Done. Run pass 1 to repopulate.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
