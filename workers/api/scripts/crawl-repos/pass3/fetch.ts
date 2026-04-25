/**
 * Pass 3 — fetch batch from D1.
 *
 * The deterministic read path. Pulls one batch of Pass3Input rows from
 * `qualified_repos` (+ `repo_constructs` + `repo_sample_prs` +
 * `repo_engineering_signals` for prior content hash) and emits them as
 * typed JSON. The skill calls this once per Pass 3 run and then walks the
 * array inline, one repo per Agent call.
 *
 * This replaces the old pattern where the skill hand-wrote wrangler d1
 * execute commands inline. Rationale: the SELECT shape is deterministic
 * plumbing with no LLM judgment involved; leaving it in prose SQL gave the
 * orchestrator room to drift (schema mismatches, hallucinated column
 * names). A typed function with a CLI wrapper has zero drift surface.
 *
 * Uses the existing `D1Client` REST helper, so no wrangler dependency, no
 * banner parsing, no permission prompts — just a typed HTTPS call to the
 * Cloudflare D1 REST API.
 */

import { D1Client, loadD1Config } from '../shared/d1Client.js';
import { REPO_FULL_NAME_DENYLIST } from '../config.js';
import type { FetchOptions, Pass3Input, SamplePRSummary } from './types.js';

interface QualifiedRepoRow {
  repo_id: number;
  full_name: string;
  primary_language: string;
  stars: number;
  sloc: number | null;
  file_count: number | null;
  mean_ccn: number | null;
  seniority_band: 'junior' | 'mid' | 'senior' | 'staff' | null;
  has_ci: 0 | 1;
  has_tests: 0 | 1;
  test_framework: string | null;
  detected_domain: string | null;
  detected_stack_json: string | null;
  pr_quality_score: number;
  open_pr_count: number | null;
  open_feature_issue_count: number | null;
  business_logic_ratio: number | null;
  cross_module_change_rate: number | null;
  readme_excerpt: string | null;
  root_tree_json: string | null;
  prior_content_hash: string | null;
  prior_signals_version: string | null;
}

interface ConstructRow {
  slug: string;
  evidence_count: number;
}

export async function fetchBatch(
  db: D1Client,
  opts: FetchOptions,
): Promise<Pass3Input[]> {
  const whereClauses: string[] = ['qr.pass = 2', 'qr.disqualified = 0'];
  const params: (string | number | null)[] = [];

  // Exclude repos on the permanent deny-list
  if (REPO_FULL_NAME_DENYLIST.size > 0) {
    const placeholders = Array.from({ length: REPO_FULL_NAME_DENYLIST.size }, () => '?').join(', ');
    whereClauses.push(`qr.full_name NOT IN (${placeholders})`);
    params.push(...Array.from(REPO_FULL_NAME_DENYLIST));
  }

  if (opts.repoId !== undefined) {
    whereClauses.push('qr.id = ?');
    params.push(opts.repoId);
  }

  if (opts.onlyMissing) {
    whereClauses.push('res.repo_id IS NULL');
  }

  const limitClause =
    opts.limit && opts.limit > 0 ? `LIMIT ${Math.floor(opts.limit)}` : '';

  const baseSql = `
    SELECT
      qr.id                       AS repo_id,
      qr.full_name                AS full_name,
      qr.primary_language         AS primary_language,
      qr.stars                    AS stars,
      qr.sloc                     AS sloc,
      qr.file_count               AS file_count,
      qr.mean_ccn                 AS mean_ccn,
      qr.seniority_band           AS seniority_band,
      qr.has_ci                   AS has_ci,
      qr.has_tests                AS has_tests,
      qr.test_framework           AS test_framework,
      qr.detected_domain          AS detected_domain,
      qr.detected_stack_json      AS detected_stack_json,
      qr.pr_quality_score         AS pr_quality_score,
      qr.open_pr_count            AS open_pr_count,
      qr.open_feature_issue_count AS open_feature_issue_count,
      qr.business_logic_ratio     AS business_logic_ratio,
      qr.cross_module_change_rate AS cross_module_change_rate,
      qr.readme_excerpt           AS readme_excerpt,
      qr.root_tree_json           AS root_tree_json,
      res.content_hash            AS prior_content_hash,
      res.signals_version         AS prior_signals_version
    FROM qualified_repos qr
    LEFT JOIN repo_engineering_signals res ON res.repo_id = qr.id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY qr.id
    ${limitClause}
  `;

  const baseRows = await db.query<QualifiedRepoRow>(baseSql, params);

  const result: Pass3Input[] = [];
  for (const row of baseRows) {
    const constructs = await db.query<ConstructRow>(
      `SELECT construct_slug AS slug, evidence_count
       FROM repo_constructs
       WHERE repo_id = ?
       ORDER BY evidence_count DESC, construct_slug`,
      [row.repo_id],
    );

    const samplePrs = await db.query<SamplePRSummary>(
      `SELECT pr_number, title, changed_file_count, modifies_tests,
              resolves_issue_number, additions, deletions,
              construct_slugs_json, swe_bench_eligible,
              changed_file_paths_json
       FROM repo_sample_prs
       WHERE repo_id = ?
       ORDER BY pr_number`,
      [row.repo_id],
    );

    result.push({
      repo_id: row.repo_id,
      full_name: row.full_name,
      primary_language: row.primary_language,
      stars: row.stars,
      sloc: row.sloc,
      file_count: row.file_count,
      mean_ccn: row.mean_ccn,
      seniority_band: row.seniority_band,
      has_ci: row.has_ci,
      has_tests: row.has_tests,
      test_framework: row.test_framework,
      detected_domain: row.detected_domain,
      detected_stack_json: row.detected_stack_json,
      pr_quality_score: row.pr_quality_score,
      open_pr_count: row.open_pr_count,
      open_feature_issue_count: row.open_feature_issue_count,
      business_logic_ratio: row.business_logic_ratio,
      cross_module_change_rate: row.cross_module_change_rate,
      readme_excerpt: row.readme_excerpt,
      root_tree_json: row.root_tree_json,
      constructs,
      sample_prs: samplePrs,
      prior_content_hash: row.prior_content_hash,
      prior_signals_version: row.prior_signals_version,
    });
  }

  return result;
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): FetchOptions {
  const opts: FetchOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--limit expects a positive integer, got "${argv[i]}"`);
      }
      opts.limit = n;
    } else if (a === '--repo-id') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--repo-id expects a positive integer, got "${argv[i]}"`);
      }
      opts.repoId = n;
    } else if (a === '--only-missing') {
      opts.onlyMissing = true;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: tsx scripts/crawl-repos/pass3/fetch.ts [--limit N] [--repo-id N] [--only-missing]\n',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const db = new D1Client(loadD1Config());
  const batch = await fetchBatch(db, opts);
  process.stdout.write(JSON.stringify(batch, null, 2) + '\n');
  process.stderr.write(`[pass3/fetch] ${batch.length} repos\n`);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error('[pass3/fetch] failed:', err);
    process.exit(1);
  });
}
