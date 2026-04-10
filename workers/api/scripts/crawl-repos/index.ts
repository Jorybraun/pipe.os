#!/usr/bin/env node
/**
 * Pipe Repo Crawler — CLI entrypoint
 *
 * Usage:
 *   npx tsx scripts/crawl-repos/index.ts --pass1 [--dry-run] [--limit 50]
 *   npx tsx scripts/crawl-repos/index.ts --pass2 [--dry-run] [--limit 200]
 *   npx tsx scripts/crawl-repos/index.ts --pass1 --pass2
 *
 * Required env vars:
 *   GITHUB_TOKEN               — GitHub personal access token
 *   CLOUDFLARE_ACCOUNT_ID      — Cloudflare account ID
 *   CLOUDFLARE_API_TOKEN       — Cloudflare API token (D1 write permissions)
 *   CLOUDFLARE_D1_DATABASE_ID  — D1 database ID
 *
 * Optional env vars:
 *   PASS2_BATCH_SIZE     — repos per pass-2 run (default 200)
 *   PASS2_CONCURRENCY    — parallel clones (default 4)
 *   LOG_LEVEL            — debug|info|warn|error (default info)
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import { GitHubClient } from './shared/githubClient.js';
import { D1Client, loadD1Config } from './shared/d1Client.js';
import { logger } from './shared/logger.js';
import { SEARCH_QUERIES, PASS2_BATCH_SIZE, PASS2_CONCURRENCY, staleCutoff } from './config.js';
import { searchReposForQuery } from './pass1/search.js';
import { extractManifestSkills, extractTopicSkills } from './pass1/graphqlDeps.js';
import { coarseFilter, extractPass1Data } from './pass1/coarseFilter.js';
import { persistPass1Batch } from './pass1/persist.js';
import { withClone } from './pass2/clone.js';
import { analyseStack } from './pass2/stackAnalyse.js';
import { measureComplexity } from './pass2/complexity.js';
import { detectConstructs } from './pass2/constructs.js';
import { inferDomain, isDomainDenylisted } from './pass2/domain.js';
import { samplePRs } from './pass2/prSample.js';
import { persistPass2 } from './pass2/persist.js';
import { resolveSkillSlug } from './shared/skillResolver.js';
import { computeSeniorityBand, DOMAIN_DENYLIST_KEYWORDS } from './config.js';
import type { Pass1Row, Pass2Data } from './shared/types.js';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    pass1:     { type: 'boolean', default: false },
    pass2:     { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    limit:     { type: 'string' },
    queries:   { type: 'string' }, // limit number of search queries (for testing)
    help:      { type: 'boolean', default: false },
  },
});

if (args.help || (!args.pass1 && !args.pass2)) {
  console.log(`
Usage:
  npx tsx scripts/crawl-repos/index.ts --pass1 [--dry-run] [--limit N]
  npx tsx scripts/crawl-repos/index.ts --pass2 [--dry-run] [--limit N]
  npx tsx scripts/crawl-repos/index.ts --pass1 --pass2

Options:
  --pass1     Run Pass 1 (search + coarse filter, no clone)
  --pass2     Run Pass 2 (clone + deep analysis)
  --dry-run   Print actions without writing to D1
  --limit N   Override batch size
  --help      Show this help
`);
  process.exit(0);
}

const DRY_RUN = args['dry-run'] ?? false;
const LIMIT = args.limit ? parseInt(args.limit, 10) : undefined;
const MAX_QUERIES = args.queries ? parseInt(args.queries, 10) : undefined;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('[crawler] Starting', { pass1: args.pass1, pass2: args.pass2, dryRun: DRY_RUN, limit: LIMIT });

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

// ─── Pass 1 ───────────────────────────────────────────────────────────────────

async function runPass1(github: GitHubClient, d1: D1Client | null): Promise<void> {
  logger.info('[pass1] Starting', { queryCount: SEARCH_QUERIES.length });

  const cutoff = staleCutoff().split('T')[0]!; // YYYY-MM-DD for GitHub query
  const allRows: Pass1Row[] = [];
  const seen = new Set<string>(); // deduplicate across queries
  const queries = MAX_QUERIES ? SEARCH_QUERIES.slice(0, MAX_QUERIES) : SEARCH_QUERIES;

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

      const now = new Date().toISOString();
      allRows.push({
        ...base,
        manifest_skills: [...manifestSkills, ...topicSkills],
        pass: 1,
        crawled_at: now,
      });
    }

    logger.info('[pass1] Query processed', {
      query: { lang: query.lang, topics: query.topics },
      accumulated: allRows.length,
    });
  }

  logger.info('[pass1] All queries done', { total: allRows.length });

  if (d1) {
    await persistPass1Batch(d1, allRows, DRY_RUN);
  } else {
    logger.info('[pass1] DRY RUN — would persist', { count: allRows.length });
    // Print a preview of what would be written
    for (const row of allRows) {
      logger.info('[pass1] → repo', {
        full_name: row.full_name,
        lang: row.primary_language,
        stars: row.stars,
        license: row.license_spdx,
        contamination_risk: row.contamination_risk,
        skills: row.manifest_skills.map((s) => `${s.slug}(${s.source})`),
      });
    }
  }
}

// ─── Pass 2 ───────────────────────────────────────────────────────────────────

async function runPass2(github: GitHubClient, d1: D1Client | null): Promise<void> {
  if (!d1) {
    logger.info('[pass2] DRY RUN — skipping D1 queries');
    return;
  }

  const batchSize = LIMIT ?? PASS2_BATCH_SIZE;

  // Fetch repos that need pass-2 processing
  const rows = await d1.query<{
    id: number;
    full_name: string;
    description: string | null;
    primary_language: string;
    topics_json: string | null;
  }>(`
    SELECT id, full_name, description, primary_language
    FROM qualified_repos
    WHERE pass = 1 AND disqualified = 0
    ORDER BY stars DESC
    LIMIT ?
  `, [batchSize]);

  logger.info('[pass2] Processing batch', { count: rows.length, batchSize });

  // Process in parallel with bounded concurrency
  await processWithConcurrency(rows, PASS2_CONCURRENCY, async (row) => {
    const [owner, repoName] = row.full_name.split('/') as [string, string];
    logger.info('[pass2] Processing repo', { full_name: row.full_name, id: row.id });

    try {
      await processPass2Repo(github, d1, row.id, row.full_name, row.description, row.primary_language);
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
): Promise<void> {
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
    let disqualified: 0 | 1 = 0;
    let disqualifiedReason: string | null = null;

    if (!hasTests) {
      disqualified = 1;
      disqualifiedReason = 'no_tests';
    } else if (isDomainDenylisted([], description)) {
      disqualified = 1;
      disqualifiedReason = 'domain_specificity';
    } else if (isComplexBuild(filePaths, rawDeps)) {
      disqualified = 1;
      disqualifiedReason = 'complex_build';
    }

    // ── PR sampling ───────────────────────────────────────────────────────
    let samplePrs: import('./shared/types.js').SamplePR[] = [];
    let prQualityScore = 0;

    if (!disqualified) {
      const prResult = await samplePRs(github, owner, repoName, extractorCtx);
      samplePrs = prResult.samplePrs;
      prQualityScore = prResult.prQualityScore;
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
      skills: [...resolvedSkills.entries()].map(([slug, meta]) => ({
        slug,
        source: meta.source,
        confidence: meta.confidence,
      })),
      constructs: constructs.map((c) => ({ slug: c.slug, evidence_count: c.evidence_count })),
      sample_prs: samplePrs,
    };

    await persistPass2(d1, pass2Data);
  });
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
