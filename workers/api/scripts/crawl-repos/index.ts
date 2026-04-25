#!/usr/bin/env node
/**
 * Pipe Repo Crawler — CLI entrypoint
 *
 * Usage:
 *   npx tsx scripts/crawl-repos/index.ts --pass1 [--dry-run] [--limit 50]
 *   npx tsx scripts/crawl-repos/index.ts --pass2 [--dry-run] [--limit 200]
 *   npx tsx scripts/crawl-repos/index.ts --pass3 [--dry-run] [--limit 200]
 *   npx tsx scripts/crawl-repos/index.ts --pass1 --pass2
 *
 * Required env vars:
 *   GITHUB_TOKEN               — GitHub personal access token (Pass 1/2)
 *   CLOUDFLARE_ACCOUNT_ID      — Cloudflare account ID
 *   CLOUDFLARE_API_TOKEN       — Cloudflare API token (D1 + AI write permissions)
 *   CLOUDFLARE_D1_DATABASE_ID  — D1 database ID
 *
 * Optional env vars:
 *   PASS2_BATCH_SIZE     — repos per pass-2 run (default 200)
 *   PASS2_CONCURRENCY    — parallel clones (default 4)
 *   LOG_LEVEL            — debug|info|warn|error (default info)
 */

import dotenv from 'dotenv';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '../..');

// Load .dev.vars from workers/api (wrangler convention)
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });
import { GitHubClient } from './shared/githubClient.js';
import { D1Client, loadD1Config } from './shared/d1Client.js';
import { logger } from './shared/logger.js';
import { SEARCH_QUERIES, PASS2_BATCH_SIZE, PASS2_CONCURRENCY, staleCutoff } from './config.js';
import { searchReposForQuery } from './pass1/search.js';
import { extractManifestSkills, extractTopicSkills } from './pass1/graphqlDeps.js';
import { coarseFilter, extractPass1Data } from './pass1/coarseFilter.js';
import { persistPass1Row } from './pass1/persist.js';
import { withClone } from './pass2/clone.js';
import { analyseStack } from './pass2/stackAnalyse.js';
import { measureComplexity } from './pass2/complexity.js';
import { detectConstructs } from './pass2/constructs.js';
import { inferDomain, isDomainDenylisted } from './pass2/domain.js';
import { samplePRs } from './pass2/prSample.js';
import { persistPass2 } from './pass2/persist.js';
import { extractReadme, extractRootTree } from './pass2/readmeAndTree.js';
import { resolveSkillSlug } from './shared/skillResolver.js';
import { computeSeniorityBand, DOMAIN_DENYLIST_KEYWORDS } from './config.js';
import type { Pass1Row, Pass2Data } from './shared/types.js';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    pass1:         { type: 'boolean', default: false },
    pass2:         { type: 'boolean', default: false },
    pass3:         { type: 'boolean', default: false },
    'dry-run':     { type: 'boolean', default: false },
    limit:         { type: 'string' },
    'repo-id':     { type: 'string' }, // pass2/pass3: run on a single repo by D1 ID
    concurrency:   { type: 'string' }, // pass3: parallel repo processing (default 5)
    queries:       { type: 'string' }, // limit number of search queries (for testing)
    lang:          { type: 'string' }, // pass1: only run queries matching this language (e.g. ruby)
    'no-ai':       { type: 'boolean', default: false }, // pass2: suppress auto-chained pass3 analyze
    help:          { type: 'boolean', default: false },
  },
});

if (args.help || (!args.pass1 && !args.pass2 && !args.pass3)) {
  console.log(`
Usage:
  npx tsx scripts/crawl-repos/index.ts --pass1 [--dry-run] [--limit N]
  npx tsx scripts/crawl-repos/index.ts --pass2 [--dry-run] [--limit N]
  npx tsx scripts/crawl-repos/index.ts --pass3 [--dry-run] [--limit N]
  npx tsx scripts/crawl-repos/index.ts --pass1 --pass2

Options:
  --pass1       Run Pass 1 (search + coarse filter, no clone)
  --pass2       Run Pass 2 (clone + deep analysis, auto-chains Pass 3 analyze on success unless --no-ai)
  --pass3       Run Pass 3 (offline AI signal extraction via Vertex AI Gemma)
  --dry-run     Print actions without writing to D1
  --limit N     Override batch size
  --repo-id N   Pass 2 or Pass 3: run on a single repo by D1 ID
  --lang L      Pass 1: only run queries for language L (e.g. ruby, java)
  --no-ai       Pass 2: skip auto-chained Pass 3 analyze (bulk runs where you want to review later)
  --help        Show this help
`);
  process.exit(0);
}

const DRY_RUN = args['dry-run'] ?? false;
const LIMIT = args.limit ? parseInt(args.limit, 10) : undefined;
const REPO_ID = args['repo-id'] ? parseInt(args['repo-id'], 10) : undefined;
const CONCURRENCY = args.concurrency ? parseInt(args.concurrency, 10) : undefined;
const MAX_QUERIES = args.queries ? parseInt(args.queries, 10) : undefined;
const LANG_FILTER = args.lang?.toLowerCase();
const NO_AI = args['no-ai'] ?? false;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('[crawler] Starting', {
    pass1: args.pass1,
    pass2: args.pass2,
    pass3: args.pass3,
    dryRun: DRY_RUN,
    limit: LIMIT,
  });

  // Pass 3 is a TypeScript module that calls Vertex AI Gemma for summarization.
  // It uses D1Client directly (same as Pass 1/2).
  if (args.pass3) {
    await runPass3();
    if (!args.pass1 && !args.pass2) {
      logger.info('[crawler] Done');
      return;
    }
  }

  const githubToken = process.env['GITHUB_TOKEN'];
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN env var is required');
  }

  const github = new GitHubClient(githubToken);
  const d1 = DRY_RUN
    ? null
    : new D1Client(loadD1Config());

  if (args.pass1) {
    await runPass1(github, d1);
  }

  if (args.pass2) {
    await runPass2(github, d1);
  }

  logger.info('[crawler] Done');
}

// ─── Pass 3 ───────────────────────────────────────────────────────────────────
//
// Pass 3 calls Vertex AI Gemma 4 26B for offline AI signal extraction.
// TypeScript orchestrator in ./pass3/run.ts.

async function runPass3(): Promise<void> {
  const { run } = await import('./pass3/run.js');
  await run({
    limit: LIMIT,
    repoId: REPO_ID,
    dryRun: DRY_RUN,
    concurrency: CONCURRENCY,
  });
}

// ─── Pass 1 ───────────────────────────────────────────────────────────────────

async function runPass1(github: GitHubClient, d1: D1Client | null): Promise<void> {
  const cutoff = staleCutoff().split('T')[0]!; // YYYY-MM-DD for GitHub query
  const seen = new Set<string>(); // deduplicate across queries

  let queries = SEARCH_QUERIES;
  if (LANG_FILTER) {
    queries = queries.filter((q) => q.lang.toLowerCase() === LANG_FILTER);
    if (queries.length === 0) {
      logger.error('[pass1] --lang matched no queries', { lang: LANG_FILTER });
      return;
    }
  }
  if (MAX_QUERIES) queries = queries.slice(0, MAX_QUERIES);

  logger.info('[pass1] Starting', {
    queryCount: queries.length,
    totalQueries: SEARCH_QUERIES.length,
    langFilter: LANG_FILTER,
  });

  let totalPersisted = 0;
  let totalFailed = 0;

  for (const query of queries) {
    let repos;
    try {
      repos = await searchReposForQuery(github, query, cutoff);
    } catch (err) {
      logger.error('[pass1] Search query failed', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // In test mode (--limit), cap repos per query to avoid long GraphQL chains
    const reposToProcess = LIMIT ? repos.slice(0, LIMIT) : repos;
    for (const repo of reposToProcess) {
      if (seen.has(repo.full_name)) continue;
      seen.add(repo.full_name);

      const filter = coarseFilter(repo);
      if (!filter.passed) {
        logger.debug('[pass1] Filtered', { full_name: repo.full_name, reason: filter.reason });
        continue;
      }

      const base = extractPass1Data(repo);

      // Manifest skills via GraphQL
      const [owner, repoName] = repo.full_name.split('/') as [string, string];
      const manifestSkills = await extractManifestSkills(github, owner, repoName);
      const topicSkills = extractTopicSkills(repo.topics ?? []);

      // Open-work counts drive the "challenge-ready" hard filter in matchRepos.
      // ~2 extra API calls per repo; best-effort — fall back to null on failure.
      let openCounts: { open_pr_count: number | null; open_feature_issue_count: number | null } = {
        open_pr_count: null,
        open_feature_issue_count: null,
      };
      try {
        openCounts = await github.getOpenWorkCounts(owner, repoName);
      } catch (err) {
        logger.warn('[pass1] Open-work counts failed', {
          full_name: repo.full_name,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const now = new Date().toISOString();
      const row: Pass1Row = {
        ...base,
        ...openCounts,
        manifest_skills: [...manifestSkills, ...topicSkills],
        pass: 1,
        crawled_at: now,
      };

      // Write immediately — don't accumulate. Keeps partial progress across OAuth/network blips
      // and makes the D1 write load steady instead of a thundering herd at the end.
      if (d1) {
        try {
          await persistPass1Row(d1, row, DRY_RUN);
          totalPersisted++;
        } catch (err) {
          totalFailed++;
          logger.error('[pass1/persist] Row failed', {
            full_name: row.full_name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        logger.info('[pass1] → repo (dry-run)', {
          full_name: row.full_name,
          lang: row.primary_language,
          stars: row.stars,
          license: row.license_spdx,
          contamination_risk: row.contamination_risk,
          skills: row.manifest_skills.map((s) => `${s.slug}(${s.source})`),
        });
      }
    }

    logger.info('[pass1] Query processed', {
      query: { lang: query.lang, topics: query.topics },
      persisted: totalPersisted,
      failed: totalFailed,
    });
  }

  logger.info('[pass1] Done', { persisted: totalPersisted, failed: totalFailed });
}

// ─── Pass 2 ───────────────────────────────────────────────────────────────────

async function runPass2(github: GitHubClient, d1: D1Client | null): Promise<void> {
  if (!d1) {
    logger.info('[pass2] DRY RUN — skipping D1 queries');
    return;
  }

  const batchSize = LIMIT ?? PASS2_BATCH_SIZE;

  // Fetch repos that need pass-2 processing.
  // If --repo-id is set, target a single repo regardless of pass/disqualified state
  // (useful for retrying a known row from the admin UI).
  const rows = REPO_ID !== undefined
    ? await d1.query<{
        id: number;
        full_name: string;
        description: string | null;
        primary_language: string;
      }>(
        `SELECT id, full_name, description, primary_language
         FROM qualified_repos
         WHERE id = ?`,
        [REPO_ID],
      )
    : await d1.query<{
        id: number;
        full_name: string;
        description: string | null;
        primary_language: string;
      }>(
        `SELECT id, full_name, description, primary_language
         FROM qualified_repos
         WHERE pass = 1 AND disqualified = 0
         ORDER BY RANDOM()
         LIMIT ?`,
        [batchSize],
      );

  if (REPO_ID !== undefined && rows.length === 0) {
    logger.error('[pass2] repo-id not found', { repoId: REPO_ID });
    return;
  }

  logger.info('[pass2] Processing batch', {
    count: rows.length,
    batchSize: REPO_ID !== undefined ? 1 : batchSize,
    repoId: REPO_ID,
  });

  // Process in parallel with bounded concurrency
  await processWithConcurrency(rows, PASS2_CONCURRENCY, async (row) => {
    const [owner, repoName] = row.full_name.split('/') as [string, string];
    logger.info('[pass2] Processing repo', { full_name: row.full_name, id: row.id });

    let qualified = false;
    try {
      const result = await processPass2Repo(
        github,
        d1,
        row.id,
        row.full_name,
        row.description,
        row.primary_language,
      );
      qualified = result.disqualified === 0;
    } catch (err) {
      logger.error('[pass2] Repo failed', {
        full_name: row.full_name,
        error: err instanceof Error ? err.message : String(err),
      });
      // Mark as disqualified with error
      await d1.query(
        `UPDATE qualified_repos SET disqualified = 1, disqualified_reason = 'crawl_error', refreshed_at = ? WHERE id = ?`,
        [new Date().toISOString(), row.id],
      );
    }

    // Auto-chain Pass 3 analyze (skip vectorize — the human ingest gate at
    // /pass3/ingest stays in charge). Failure here is logged but never blocks
    // the Pass 2 success that was just committed.
    if (qualified && !DRY_RUN && !NO_AI) {
      try {
        logger.info('[pass2→pass3] Auto-chaining Pass 3 analyze', { id: row.id, full_name: row.full_name });
        const { run } = await import('./pass3/run.js');
        await run({ repoId: row.id, dryRun: false, concurrency: 1, skipVectorize: true });
      } catch (err) {
        logger.error('[pass2→pass3] Pass 3 chain failed (non-fatal)', {
          id: row.id,
          full_name: row.full_name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  // Mark stale repos
  const stale = staleCutoff();
  const staleResult = await d1.query<{ changes: number }>(
    `UPDATE qualified_repos SET disqualified = 1, disqualified_reason = 'stale', refreshed_at = ? WHERE last_pushed_at < ? AND disqualified = 0`,
    [new Date().toISOString(), stale],
  );
  logger.info('[pass2] Stale repos marked', { cutoff: stale });
}

async function processPass2Repo(
  github: GitHubClient,
  d1: D1Client,
  repoId: number,
  fullName: string,
  description: string | null,
  primaryLanguage: string,
): Promise<{ disqualified: 0 | 1 }> {
  let disqualifiedResult: 0 | 1 = 1;
  await withClone(fullName, repoId, async (cloneDir, filePaths) => {
    const [owner, repoName] = fullName.split('/') as [string, string];

    // ── Stack analysis ─────────────────────────────────────────────────────
    const { rawDeps, detectedStackJson } = analyseStack(cloneDir, filePaths);

    // Resolve skills from deps + file imports
    const resolvedSkills = new Map<string, { source: 'manifest' | 'import'; confidence: number }>();
    for (const dep of rawDeps) {
      const slug = resolveSkillSlug(dep);
      if (slug && !resolvedSkills.has(slug)) {
        resolvedSkills.set(slug, { source: 'manifest', confidence: 0.95 });
      }
    }
    const skillSlugs = [...resolvedSkills.keys()];

    // ── Complexity ────────────────────────────────────────────────────────
    const { sloc, fileCount, meanCcn } = measureComplexity(cloneDir, filePaths);
    const seniorityBand = computeSeniorityBand(sloc, fileCount, meanCcn);

    // ── Tests + CI ────────────────────────────────────────────────────────
    const hasTests = filePaths.some((f) =>
      /\.(test|spec)\.(ts|js|tsx|jsx|py|rb|go)$/.test(f) ||
      /\/__tests__\//.test(f) ||
      /\/test\//.test(f) ||
      /\/tests\//.test(f) ||
      /_test\.(go|py|rb)$/.test(f),
    ) ? 1 : 0 as 0 | 1;

    const hasCi = filePaths.some((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f)) ? 1 : 0 as 0 | 1;

    // Detect test framework from deps
    const testFramework = detectTestFramework(rawDeps);

    // ── Constructs ────────────────────────────────────────────────────────
    const extractorCtx = { filePaths, repoDir: cloneDir, skills: skillSlugs, rawDeps };
    const constructs = detectConstructs(extractorCtx);

    // ── Domain ────────────────────────────────────────────────────────────
    const { domain, confidence: domainConfidence } = inferDomain(filePaths, skillSlugs, rawDeps, []);

    // ── Hard disqualifiers ────────────────────────────────────────────────
    // `no_tests` was previously a hard reject. It's now a soft signal: Gemma
    // sees `has_tests: 0` in the FACTS block and can return `hold`/`reject`
    // with a reason, which is richer feedback than a binary gate.
    let disqualified: 0 | 1 = 0;
    let disqualifiedReason: string | null = null;

    if (isDomainDenylisted([], description)) {
      disqualified = 1;
      disqualifiedReason = 'domain_specificity';
    } else if (isComplexBuild(filePaths, rawDeps)) {
      disqualified = 1;
      disqualifiedReason = 'complex_build';
    }

    // ── PR sampling ───────────────────────────────────────────────────────
    let samplePrs: import('./shared/types.js').SamplePR[] = [];
    let prQualityScore = 0;
    let businessLogicRatio: number | null = null;
    let crossModuleChangeRate: number | null = null;

    if (!disqualified) {
      const prResult = await samplePRs(github, owner, repoName, extractorCtx, primaryLanguage);
      samplePrs = prResult.samplePrs;
      prQualityScore = prResult.prQualityScore;
      businessLogicRatio = prResult.businessLogicRatio;
      crossModuleChangeRate = prResult.crossModuleChangeRate;
      if (prResult.disqualified) {
        disqualified = 1;
        disqualifiedReason = prResult.disqualifiedReason;
      }
    }

    // ── Persist ───────────────────────────────────────────────────────────
    const pass2Data: Pass2Data = {
      repo_id: repoId,
      sloc,
      file_count: fileCount,
      mean_ccn: meanCcn,
      has_ci: hasCi,
      has_tests: hasTests,
      test_framework: testFramework,
      seniority_band: seniorityBand,
      detected_domain: domain,
      domain_confidence: domainConfidence,
      pr_quality_score: prQualityScore,
      detected_stack_json: detectedStackJson,
      disqualified,
      disqualified_reason: disqualifiedReason,
      business_logic_ratio: businessLogicRatio,
      cross_module_change_rate: crossModuleChangeRate,
      skills: [...resolvedSkills.entries()].map(([slug, meta]) => ({
        slug,
        source: meta.source,
        confidence: meta.confidence,
      })),
      constructs: constructs.map((c) => ({ slug: c.slug, evidence_count: c.evidence_count })),
      sample_prs: samplePrs,
      readme_excerpt: extractReadme(cloneDir),
      root_tree_json: extractRootTree(cloneDir),
    };

    await persistPass2(d1, pass2Data);
    disqualifiedResult = pass2Data.disqualified;

    logger.info('[pass2] Done', {
      full_name: fullName,
      id: repoId,
      disqualified: pass2Data.disqualified,
      reason: pass2Data.disqualified_reason,
      sloc: pass2Data.sloc,
      file_count: pass2Data.file_count,
      mean_ccn: pass2Data.mean_ccn,
      seniority_band: pass2Data.seniority_band,
      has_tests: pass2Data.has_tests,
      constructs: pass2Data.constructs.length,
      sample_prs: pass2Data.sample_prs.length,
      pr_quality: pass2Data.pr_quality_score,
    });
  });
  return { disqualified: disqualifiedResult };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectTestFramework(rawDeps: string[]): string | null {
  const depSet = new Set(rawDeps.map((d) => d.toLowerCase()));
  if (depSet.has('vitest')) return 'vitest';
  if (depSet.has('jest')) return 'jest';
  if (depSet.has('mocha')) return 'mocha';
  if (depSet.has('jasmine')) return 'jasmine';
  if (depSet.has('pytest')) return 'pytest';
  if (depSet.has('unittest')) return 'unittest';
  if (depSet.has('rspec')) return 'rspec';
  return null;
}

function isComplexBuild(filePaths: string[], rawDeps: string[]): boolean {
  const hasMakefile = filePaths.some((f) => /^Makefile$/.test(f));
  const hasNoManifest = rawDeps.length === 0;
  const hasCOrCpp = filePaths.some((f) => /\.(c|cpp|cc|h|hpp)$/.test(f));
  return hasMakefile && hasNoManifest && hasCOrCpp;
}

/** Process an array with a bounded concurrency limit. */
async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) {
        await fn(item);
      }
    }
  });
  await Promise.all(workers);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  logger.error('[crawler] Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
