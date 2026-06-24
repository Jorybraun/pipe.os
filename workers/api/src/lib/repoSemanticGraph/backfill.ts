import { fetchGitHubDiff, type GitHubDiffResult } from '../fetchGitHubDiff';
import { normalizeGitHubPullRequest } from './githubNormalize';
import { buildChallengePacket } from './challengePacket';
import { deriveRepoSemantics } from './derive';
import { persistReviewChallengeGraph } from './persistence';
import { getLanguageSupport } from './languagePolicy';

/**
 * Backfill real source-backed repository challenge packets from crawler D1.
 *
 * Selects eligible merged PRs from `repo_sample_prs` (the crawler catalog),
 * fetches PR refs, diff, and changed-file source from GitHub, normalizes them
 * into a deterministic `NormalizedPullRequestInput`, builds a challenge packet
 * through the repoSemanticGraph pipeline, and persists it through
 * `persistReviewChallengeGraph`.
 *
 * The backfill is idempotent: PRs that already have a persisted packet are
 * skipped unless `force` is set. Re-persisting the same PR produces
 * byte-identical rows because packet identity and content hashes are
 * deterministic.
 */

// Eligibility thresholds mirror the challenge packet quality gates in
// challengePacket.ts so the crawler pre-filter only selects PRs that can
// produce overlay-ready packets.
const MIN_CHANGED_FILES = 3;
const MAX_CHANGED_FILES = 50;
const MIN_CHANGED_LINES = 20;
const MAX_CHANGED_LINES = 1_500;
export const PACKET_POLICY_VERSION = 'repo-challenge-v1' as const;

/** A merged PR row from `repo_sample_prs` joined with `qualified_repos`. */
export interface CrawlerPullRequestRow {
  repo_id: number;
  pr_number: number;
  pr_url: string;
  title: string | null;
  merged_at: string;
  resolves_issue_number: number | null;
  changed_file_count: number;
  modifies_tests: number;
  additions: number | null;
  deletions: number | null;
  github_url: string;
  full_name: string;
  primary_language: string;
}

/** Injectable GitHub diff fetcher (defaults to the real `fetchGitHubDiff`). */
export type GitHubDiffFetcher = (
  repoUrl: string,
  prNumber: number,
  token?: string,
) => Promise<GitHubDiffResult | null>;

export interface BackfillEnv {
  DB: D1Database;
  githubToken?: string;
  /** Override the GitHub diff fetcher (used in tests). */
  fetchDiff?: GitHubDiffFetcher;
}

export interface BackfillOptions {
  /** Maximum number of PRs to process in a single backfill run. */
  limit?: number;
  /** Re-fetch and re-persist PRs that already have a packet row. */
  force?: boolean;
  /** Observed-at timestamp for the repo snapshot (defaults to now). */
  observedAt?: string;
}

export interface BackfillPrResult {
  repoId: number;
  prNumber: number;
  repoFullName: string;
  packetId: string | null;
  productionReady: boolean;
  qualityScore: number;
  demandFamilies: string[];
  skipped: boolean;
  failed: boolean;
  reason?: string;
}

export interface BackfillReadinessReport {
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  /** Number of overlay-ready (production_ready=1) packets in D1 after the run. */
  overlayReadyPackets: number;
  results: BackfillPrResult[];
}

/**
 * Select eligible merged PRs from the crawler catalog (`repo_sample_prs` joined
 * with `qualified_repos`). Structural eligibility (file count, change size,
 * modifies tests, not archived/disqualified) is enforced in SQL; language
 * eligibility is enforced post-fetch because `primary_language` may use aliases
 * (e.g. "TSX", "golang") that `getLanguageSupport` normalizes.
 */
export async function selectEligibleCrawlerPullRequests(
  db: D1Database,
  limit: number,
): Promise<CrawlerPullRequestRow[]> {
  const rows = await db.prepare(
    `SELECT pr.repo_id          AS repo_id,
            pr.pr_number        AS pr_number,
            pr.pr_url           AS pr_url,
            pr.title            AS title,
            pr.merged_at        AS merged_at,
            pr.resolves_issue_number AS resolves_issue_number,
            pr.changed_file_count    AS changed_file_count,
            pr.modifies_tests        AS modifies_tests,
            pr.additions        AS additions,
            pr.deletions        AS deletions,
            repo.github_url     AS github_url,
            repo.full_name      AS full_name,
            repo.primary_language AS primary_language
       FROM repo_sample_prs pr
       JOIN qualified_repos repo ON repo.id = pr.repo_id
      WHERE pr.merged_at IS NOT NULL
        AND pr.modifies_tests = 1
        AND repo.disqualified = 0
        AND repo.is_archived = 0
        AND pr.changed_file_count BETWEEN ?1 AND ?2
        AND COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0) BETWEEN ?3 AND ?4
      ORDER BY pr.swe_bench_eligible DESC, repo.pr_quality_score DESC, pr.merged_at DESC
      LIMIT ?5`,
  )
    .bind(MIN_CHANGED_FILES, MAX_CHANGED_FILES, MIN_CHANGED_LINES, MAX_CHANGED_LINES, limit)
    .all<CrawlerPullRequestRow>();
  return (rows.results ?? []).filter(
    (row) => getLanguageSupport(row.primary_language).challengePacketsAllowed,
  );
}

/**
 * Count overlay-ready (production_ready=1) challenge packets persisted in D1.
 * This is the readiness gate: the backfill succeeds when at least one real
 * overlay-ready packet exists after the run.
 */
export async function countOverlayReadyPackets(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM review_challenge_packets WHERE production_ready = 1')
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Backfill real source-backed repository challenge packets from crawler D1.
 *
 * For each eligible PR: fetch the GitHub diff (refs, hunks, changed-file source),
 * normalize it into a `NormalizedPullRequestInput`, build a deterministic
 * challenge packet, derive repo semantics, and persist the full graph through
 * `persistReviewChallengeGraph`. The persisted packet carries exact source
 * spans, structural facts, symbols, repo source refs, a context record, and
 * concept links.
 */
export async function backfillReviewChallengePackets(
  env: BackfillEnv,
  options: BackfillOptions = {},
): Promise<BackfillReadinessReport> {
  const { DB, githubToken } = env;
  const fetchDiff = env.fetchDiff ?? fetchGitHubDiff;
  const limit = options.limit ?? 25;
  const observedAt = options.observedAt ?? new Date().toISOString();

  const candidates = await selectEligibleCrawlerPullRequests(DB, limit);
  const results: BackfillPrResult[] = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const baseResult: BackfillPrResult = {
      repoId: candidate.repo_id,
      prNumber: candidate.pr_number,
      repoFullName: candidate.full_name,
      packetId: null,
      productionReady: false,
      qualityScore: 0,
      demandFamilies: [],
      skipped: false,
      failed: false,
    };

    // Idempotency: skip PRs that already have a persisted packet unless forced.
    if (!options.force) {
      const existing = await DB.prepare(
        `SELECT id FROM review_challenge_packets
          WHERE repo_id = ?1 AND pr_number = ?2 AND packet_version = ?3`,
      )
        .bind(candidate.repo_id, candidate.pr_number, PACKET_POLICY_VERSION)
        .first<{ id: string }>();
      if (existing) {
        skipped++;
        results.push({ ...baseResult, skipped: true, reason: 'packet already persisted' });
        continue;
      }
    }

    try {
      const diffResult = await fetchDiff(candidate.github_url, candidate.pr_number, githubToken);
      if (!diffResult) {
        failed++;
        results.push({ ...baseResult, failed: true, reason: 'GitHub diff fetch returned no data' });
        continue;
      }

      const normalized = await normalizeGitHubPullRequest({
        repoUrl: candidate.github_url,
        prNumber: candidate.pr_number,
        diffResult,
        primaryLanguage: candidate.primary_language,
        observedAt,
      });

      const packet = await buildChallengePacket(normalized);
      const graph = await deriveRepoSemantics({
        pullRequest: normalized,
        packet,
        structuralFacts: normalized.structuralFacts ?? [],
      });

      await persistReviewChallengeGraph(DB, candidate.repo_id, normalized, packet, {
        structuralFacts: normalized.structuralFacts ?? [],
        codeEpisodes: graph.episodes,
        facets: graph.facets,
        semanticAssertions: graph.assertions,
        repoSignals: graph.signals,
      });

      succeeded++;
      results.push({
        ...baseResult,
        packetId: packet.id,
        productionReady: packet.quality.eligible,
        qualityScore: packet.quality.score,
        demandFamilies: packet.demandFamilies,
      });
    } catch (error) {
      failed++;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[backfill] failed PR #${candidate.pr_number} for repo ${candidate.full_name}: ${reason}`,
      );
      results.push({ ...baseResult, failed: true, reason });
    }
  }

  const overlayReadyPackets = await countOverlayReadyPackets(DB);
  return {
    processed: candidates.length,
    succeeded,
    skipped,
    failed,
    overlayReadyPackets,
    results,
  };
}
