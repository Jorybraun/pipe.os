/**
 * Pass 2: PR Sampling — §6 of the plan.
 *
 * Applies the SWE-bench eligibility criteria to identify PRs suitable for
 * AIG bug planting. Scans up to 200 merged PRs per repo, stops at 20 eligible.
 *
 * Stores only URLs — never diffs or code.
 */

import type { GitHubClient } from '../shared/githubClient.js';
import type { SamplePR } from '../shared/types.js';
import type { ExtractorContext } from '../shared/types.js';
import { constructsForFiles } from './constructs.js';
import { logger } from '../shared/logger.js';
import { PASS2_PR_SCAN_LIMIT, PASS2_PR_ELIGIBLE_LIMIT, PASS2_MIN_ELIGIBLE_PRS } from '../config.js';

const REVERT_PATTERN = /^(revert|hotfix|chore:\s*bump)/i;
const BUMP_PATTERN = /^bump\s/i;
const BOT_USERS = new Set(['dependabot[bot]', 'dependabot', 'renovate[bot]', 'renovate']);
const ISSUE_LINK_PATTERN = /(?:closes?|fixes?|resolves?)\s+#(\d+)/i;

const MAX_DIFF_SIZE = 1500; // additions + deletions

/**
 * Test file detection: returns true if the filename looks like a test.
 */
function isTestFile(filename: string): boolean {
  return /\.(test|spec)\.(ts|js|tsx|jsx|py|rb|go)$/.test(filename) ||
    /__tests__\//.test(filename) ||
    /\/test\//.test(filename) ||
    /\/tests\//.test(filename) ||
    /_test\.(go|py|rb)$/.test(filename);
}

export interface PrSampleResult {
  samplePrs: SamplePR[];
  prQualityScore: number;
  disqualified: boolean;
  disqualifiedReason: string | null;
}

/**
 * Samples eligible PRs from a repo.
 */
export async function samplePRs(
  client: GitHubClient,
  owner: string,
  repo: string,
  ctx: ExtractorContext,
): Promise<PrSampleResult> {
  const eligible: SamplePR[] = [];
  let totalScanned = 0;
  let page = 1;

  outer: while (totalScanned < PASS2_PR_SCAN_LIMIT && eligible.length < PASS2_PR_ELIGIBLE_LIMIT) {
    let prs;
    try {
      prs = await client.getMergedPRs(owner, repo, page);
    } catch (err) {
      logger.warn('[pass2/prSample] Failed to list PRs', {
        owner, repo,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }

    if (prs.length === 0) break;
    page++;

    for (const pr of prs) {
      if (totalScanned >= PASS2_PR_SCAN_LIMIT) break outer;
      if (eligible.length >= PASS2_PR_ELIGIBLE_LIMIT) break outer;

      // Skip non-merged
      if (!pr.merged_at) { totalScanned++; continue; }

      // Skip reverts / hotfixes / bumps
      if (REVERT_PATTERN.test(pr.title)) { totalScanned++; continue; }
      if (BUMP_PATTERN.test(pr.title)) { totalScanned++; continue; }

      // Skip dependency bots
      if (BOT_USERS.has(pr.user.login)) { totalScanned++; continue; }

      totalScanned++;

      // Fetch PR detail for file count
      let detail;
      try {
        detail = await client.getPRDetail(owner, repo, pr.number);
      } catch {
        continue;
      }

      const changedFiles = detail.changed_files;
      const additions = detail.additions;
      const deletions = detail.deletions;

      // Size gate: 3–50 changed files
      if (changedFiles < 3 || changedFiles > 50) continue;

      // Diff size gate (optional)
      if (additions + deletions > MAX_DIFF_SIZE) continue;

      // Check issue link in body
      const body = pr.body ?? '';
      const issueMatch = ISSUE_LINK_PATTERN.exec(body);
      const resolvesIssueNumber = issueMatch ? parseInt(issueMatch[1]!, 10) : null;

      // Fetch changed files to check for test modifications
      let files;
      try {
        files = await client.getPRFiles(owner, repo, pr.number);
      } catch {
        continue;
      }

      const modifiesTests = files.some((f) => isTestFile(f.filename)) ? 1 : 0 as 0 | 1;

      // SWE-bench eligible: must resolve an issue AND modify tests
      const sweBenchEligible = (resolvesIssueNumber !== null && modifiesTests === 1) ? 1 : 0 as 0 | 1;

      // Map changed file paths to constructs
      const changedFilePaths = files.map((f) => f.filename);
      const constructSlugs = constructsForFiles(changedFilePaths, ctx);

      eligible.push({
        pr_number: pr.number,
        pr_url: `https://github.com/${owner}/${repo}/pull/${pr.number}`,
        title: pr.title,
        merged_at: pr.merged_at,
        resolves_issue_number: resolvesIssueNumber,
        changed_file_count: changedFiles,
        modifies_tests: modifiesTests,
        additions,
        deletions,
        construct_slugs_json: JSON.stringify(constructSlugs),
        swe_bench_eligible: sweBenchEligible,
      });
    }
  }

  const swebenchEligibleCount = eligible.filter((p) => p.swe_bench_eligible === 1).length;
  const eligibilityRate = totalScanned > 0 ? eligible.length / totalScanned : 0;
  const allConstructSlugs = new Set(
    eligible.flatMap((p) => (JSON.parse(p.construct_slugs_json) as string[])),
  );
  const constructDiversity = allConstructSlugs.size;

  // pr_quality_score formula from §6.3
  const prQualityScore =
    Math.min(swebenchEligibleCount / 10, 1) * 0.5 +
    eligibilityRate * 0.3 +
    Math.min(constructDiversity / 5, 1) * 0.2;

  // Disqualify if fewer than 3 SWE-bench eligible PRs
  const disqualified = swebenchEligibleCount < PASS2_MIN_ELIGIBLE_PRS;

  logger.debug('[pass2/prSample] PR sampling complete', {
    owner, repo,
    totalScanned,
    eligible: eligible.length,
    sweBenchEligible: swebenchEligibleCount,
    prQualityScore: prQualityScore.toFixed(3),
    disqualified,
  });

  return {
    samplePrs: eligible,
    prQualityScore,
    disqualified,
    disqualifiedReason: disqualified ? 'insufficient_sample_prs' : null,
  };
}
