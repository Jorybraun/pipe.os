#!/usr/bin/env tsx
/**
 * Backfill script: run confidence scorer on existing pass=2/3 repos.
 *
 * Usage:
 *   npx tsx scripts/backfillRepoConfidence.ts [--dry-run] [--batch N] [--limit N] [--repo-id N]
 *
 * Env vars (from .dev.vars):
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_D1_DATABASE_ID
 *   CONFIDENCE_SCORER_MODEL (optional)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..');
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';
import { logger } from './crawl-repos/shared/logger.js';
import { scoreRepoConfidence, type ScorerApiConfig } from '../src/lib/repoApproval/confidenceScorer';
import type { Pass2SignalSummary } from '../src/lib/repoApproval/confidenceScorerPrompts';
import type { Pass3Data } from './crawl-repos/shared/types';
import { upsertToVectorize } from './crawl-repos/pass3/persist';

interface RepoRow {
  repo_id: number;
  full_name: string;
  primary_language: string;
  stars: number;
  sloc: number | null;
  file_count: number | null;
  mean_ccn: number | null;
  seniority_band: string | null;
  has_ci: 0 | 1;
  has_tests: 0 | 1;
  test_framework: string | null;
  detected_domain: string | null;
  pr_quality_score: number;
  open_pr_count: number | null;
  open_feature_issue_count: number | null;
  business_logic_ratio: number | null;
  cross_module_change_rate: number | null;
  detected_stack_json: string | null;
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  swe_bench_eligibility_rate: number | null;
  complexity_band: string | null;
  test_style: string | null;
  challenge_surfaces: string | null;
  repo_searchable_profile: string;
  engineering_narrative: string;
}

interface ConstructRow {
  slug: string;
  evidence_count: number;
}

interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  limit?: number;
  repoId?: number;
}

function parseArgs(argv: string[]): BackfillOptions {
  const opts: BackfillOptions = { dryRun: false, batchSize: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--batch') {
      opts.batchSize = Number(argv[++i]);
    } else if (a === '--limit') {
      opts.limit = Number(argv[++i]);
    } else if (a === '--repo-id') {
      opts.repoId = Number(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: npx tsx scripts/backfillRepoConfidence.ts [--dry-run] [--batch N] [--limit N] [--repo-id N]');
      process.exit(0);
    }
  }
  return opts;
}

async function fetchRepos(db: D1Client, opts: BackfillOptions): Promise<RepoRow[]> {
  let sql = `
    SELECT
      qr.id AS repo_id,
      qr.full_name,
      qr.primary_language,
      qr.stars,
      qr.sloc,
      qr.file_count,
      qr.mean_ccn,
      qr.seniority_band,
      qr.has_ci,
      qr.has_tests,
      qr.test_framework,
      qr.detected_domain,
      qr.pr_quality_score,
      qr.open_pr_count,
      qr.open_feature_issue_count,
      qr.business_logic_ratio,
      qr.cross_module_change_rate,
      qr.detected_stack_json,
      res.test_touch_rate,
      res.mean_changed_files,
      res.p90_changed_files,
      res.issue_link_rate,
      res.swe_bench_eligibility_rate,
      res.complexity_band,
      res.test_style,
      res.challenge_surfaces,
      res.repo_searchable_profile,
      res.engineering_narrative
    FROM qualified_repos qr
    INNER JOIN repo_engineering_signals res ON res.repo_id = qr.id
    WHERE qr.pass >= 2
      AND (res.confidence_verdict = 'not_scored' OR res.confidence_verdict IS NULL)
  `;
  const params: (string | number)[] = [];

  if (opts.repoId) {
    sql += ' AND qr.id = ?';
    params.push(opts.repoId);
  }

  sql += ' ORDER BY qr.id';

  if (opts.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }

  const rows = await db.query<RepoRow>(sql, params);
  return rows;
}

async function fetchConstructs(db: D1Client, repoId: number): Promise<ConstructRow[]> {
  return db.query<ConstructRow>(
    'SELECT slug, evidence_count FROM repo_constructs WHERE repo_id = ? ORDER BY evidence_count DESC',
    [repoId],
  );
}

async function updateRepoConfidence(
  db: D1Client,
  repoId: number,
  result: { aggregate: number; scores: Record<string, number>; verdict: string },
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    logger.info('[backfill] DRY RUN — would update confidence', { repo_id: repoId, verdict: result.verdict });
    return;
  }
  await db.query(
    `UPDATE repo_engineering_signals
     SET confidence_score = ?,
         confidence_scores_json = ?,
         confidence_verdict = ?,
         confidence_scored_at = ?
     WHERE repo_id = ?`,
    [
      result.aggregate,
      JSON.stringify(result.scores),
      result.verdict,
      Math.floor(Date.now() / 1000),
      repoId,
    ],
  );
}

async function updateAdminStatus(
  db: D1Client,
  repoId: number,
  verdict: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  const status = verdict === 'auto_approve' ? 'approved' : verdict === 'auto_reject' ? 'rejected' : 'pending';
  await db.query(
    'UPDATE qualified_repos SET admin_status = ? WHERE id = ?',
    [status, repoId],
  );
}

async function runBackfill(opts: BackfillOptions): Promise<void> {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'];
  if (!accountId || !apiToken) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required');
  }

  const scorerConfig: ScorerApiConfig = {
    accountId,
    apiToken,
    model: process.env['CONFIDENCE_SCORER_MODEL'] ?? undefined,
  };

  const db = new D1Client(loadD1Config());

  logger.info('[backfill] Fetching repos...');
  const repos = await fetchRepos(db, opts);
  logger.info(`[backfill] ${repos.length} repos to score`);

  if (repos.length === 0) {
    console.log('No repos need scoring.');
    return;
  }

  const stats = {
    total: repos.length,
    autoApproved: 0,
    manualReview: 0,
    autoRejected: 0,
    errors: 0,
  };

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i]!;
    const tag = `[${i + 1}/${repos.length}]`;
    logger.info(`[backfill] ${tag} repo_id=${repo.repo_id} ${repo.full_name}`);

    // Small delay between batches to avoid rate limits
    if (i > 0 && i % opts.batchSize === 0) {
      logger.info(`[backfill] Batch boundary — pausing 2s`);
      await new Promise((r) => setTimeout(r, 2000));
    }

    try {
      const constructs = await fetchConstructs(db, repo.repo_id);
      const pass2Signals: Pass2SignalSummary = {
        repo_id: repo.repo_id,
        full_name: repo.full_name,
        primary_language: repo.primary_language,
        stars: repo.stars,
        sloc: repo.sloc,
        file_count: repo.file_count,
        mean_ccn: repo.mean_ccn,
        seniority_band: repo.seniority_band,
        has_ci: repo.has_ci,
        has_tests: repo.has_tests,
        test_framework: repo.test_framework,
        detected_domain: repo.detected_domain,
        pr_quality_score: repo.pr_quality_score,
        open_pr_count: repo.open_pr_count,
        open_feature_issue_count: repo.open_feature_issue_count,
        business_logic_ratio: repo.business_logic_ratio,
        cross_module_change_rate: repo.cross_module_change_rate,
        test_touch_rate: repo.test_touch_rate,
        mean_changed_files: repo.mean_changed_files,
        p90_changed_files: repo.p90_changed_files,
        issue_link_rate: repo.issue_link_rate,
        swe_bench_eligibility_rate: repo.swe_bench_eligibility_rate,
        complexity_band: repo.complexity_band,
        test_style: repo.test_style,
        challenge_surfaces: repo.challenge_surfaces,
        detected_stack_json: repo.detected_stack_json,
        constructs,
      };

      const confidence = await scoreRepoConfidence(
        {
          engineeringNarrative: repo.engineering_narrative,
          repoSearchableProfile: repo.repo_searchable_profile,
          pass2Signals,
        },
        scorerConfig,
      );

      await updateRepoConfidence(db, repo.repo_id, confidence, opts.dryRun);
      await updateAdminStatus(db, repo.repo_id, confidence.verdict, opts.dryRun);

      if (confidence.verdict === 'auto_approve' && !opts.dryRun) {
        // Upsert to Vectorize using the existing persist helper
        const data: Pass3Data = {
          repo_id: repo.repo_id,
          signals_version: 'v2.0.0',
          content_hash: '',
          test_touch_rate: repo.test_touch_rate,
          mean_changed_files: repo.mean_changed_files,
          p90_changed_files: repo.p90_changed_files,
          issue_link_rate: repo.issue_link_rate,
          complexity_band: repo.complexity_band as Pass3Data['complexity_band'],
          swe_bench_eligibility_rate: repo.swe_bench_eligibility_rate,
          architecture_style: null,
          review_density: null,
          commit_cadence: null,
          satd_density: null,
          test_style: repo.test_style as Pass3Data['test_style'],
          challenge_surfaces: repo.challenge_surfaces,
          repo_searchable_profile: repo.repo_searchable_profile,
          engineering_narrative: repo.engineering_narrative,
          signal_json: '',
          model_used: '',
          model_version: '',
          challenge_suitability_verdict: null,
          challenge_suitability_reason: null,
          top_pr_picks: [],
          red_flags: [],
          seniority_justification: null,
          ideal_role_match: null,
          confidence_score: confidence.aggregate,
          confidence_scores_json: JSON.stringify(confidence.scores),
          confidence_verdict: confidence.verdict,
          confidence_scored_at: Math.floor(Date.now() / 1000),
        };
        await upsertToVectorize(data);
      }

      if (confidence.verdict === 'auto_approve') stats.autoApproved++;
      else if (confidence.verdict === 'manual_review') stats.manualReview++;
      else if (confidence.verdict === 'auto_reject') stats.autoRejected++;

      logger.info(`[backfill] ${tag} verdict=${confidence.verdict} aggregate=${confidence.aggregate}`);
    } catch (err) {
      stats.errors++;
      logger.error(`[backfill] ${tag} repo_id=${repo.repo_id} error=${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n═══ Backfill Summary ═══');
  console.log(`Total repos:      ${stats.total}`);
  console.log(`Auto-approved:    ${stats.autoApproved}`);
  console.log(`Manual review:    ${stats.manualReview}`);
  console.log(`Auto-rejected:    ${stats.autoRejected}`);
  console.log(`Errors:           ${stats.errors}`);
  console.log(`Dry run:          ${opts.dryRun}`);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  runBackfill(opts).catch((err) => {
    console.error('[backfill] Fatal:', err);
    process.exit(1);
  });
}
