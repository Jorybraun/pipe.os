/**
 * GitHub Enrichment v2 — converts a candidate's public GitHub activity into
 * rich candidate_nodes (Project, Experience, Skill, CulturalSignal) for the
 * living graph.
 *
 * Improvements over v1:
 * - Paginates through all owned repos (up to 300)
 * - Fetches merged PRs to external repos via search API
 * - Fetches organization memberships
 * - Aggregates primary language statistics across all repos
 * - Sorts repos by popularity (stars + forks)
 * - Builds human-like narratives with date ranges, impact descriptors, and context
 * - Creates Experience nodes for external open-source contributions
 * - Creates Skill nodes for dominant programming languages
 * - Creates a CulturalSignal node with an overall GitHub summary
 * - Supersedes prior GitHub enrichment nodes on re-run to prevent duplicates
 *
 * Node property schema is aligned with candidateSituationFit.ts prompt builders:
 *   - CulturalSignal: dimension, bars_score, reasoning
 *   - Experience: company, role, domain, company_stage, impact_summary
 *   - Project: name
 *   - Skill: name, proficiency, years_exposure, depth_pattern
 */

import { insertCandidateNode, embedCandidateNode } from '../candidateDiscovery/candidateNodes';
import { GitHubClient } from './githubClient';
import type { GitHubRepo, GitHubUserProfile, GitHubOrg } from './githubClient';

export interface EnrichResult {
  nodesCreated: number;
  reposFound: number;
  error?: string;
}

interface ContributionAggregate {
  repoFullName: string;
  repoUrl: string;
  mergedPrCount: number;
}

/**
 * Enrich a candidate from their GitHub handle.
 */
export async function enrichCandidateFromGitHub(
  handle: string,
  candidateId: string,
  db: D1Database,
  env: { AI: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } },
  token?: string,
): Promise<EnrichResult> {
  const client = new GitHubClient({ token });

  // Fetch core data
  let profile: Awaited<ReturnType<GitHubClient['getUserProfile']>>;
  let repos: Awaited<ReturnType<GitHubClient['getOwnedReposAll']>>;

  try {
    [profile, repos] = await Promise.all([
      client.getUserProfile(handle),
      client.getOwnedReposAll(handle),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { nodesCreated: 0, reposFound: 0, error: msg };
  }

  // Fetch secondary data (best-effort)
  let prs: Awaited<ReturnType<GitHubClient['getMergedPullRequests']>> = [];
  let orgs: Awaited<ReturnType<GitHubClient['getUserOrgs']>> = [];

  try {
    [prs, orgs] = await Promise.all([
      client.getMergedPullRequests(handle),
      client.getUserOrgs(handle),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[githubEnrich] PR/org fetch failed for ${handle}:`, msg);
  }

  // ─── Idempotency: supersede all prior github_enrichment nodes ────────────────
  try {
    await db
      .prepare(
        `UPDATE candidate_nodes
         SET superseded_at = unixepoch()
         WHERE candidate_id = ?1 AND source_type = 'github_enrichment' AND superseded_at IS NULL`,
      )
      .bind(candidateId)
      .run();
  } catch (err) {
    console.warn(`[githubEnrich] failed to supersede old nodes for ${candidateId}:`, err);
  }

  // Build owned-repo set for filtering external contributions
  const ownedRepoNames = new Set(repos.map((r) => r.full_name.toLowerCase()));

  // Filter PRs to external repos only
  const externalPRs = prs.filter((pr) => {
    const repoFullName = pr.repository_url.replace('https://api.github.com/repos/', '').toLowerCase();
    return !ownedRepoNames.has(repoFullName);
  });

  const contributions = aggregateContributions(externalPRs);

  // Sort non-fork repos by popularity
  const nonForkRepos = repos.filter((r) => !r.fork);
  const sortedRepos = nonForkRepos
    .map((r) => ({ repo: r, popularity: r.stargazers_count + r.forks_count }))
    .sort((a, b) => b.popularity - a.popularity);

  // Aggregate primary languages across ALL non-fork repos
  const primaryLangCounts = new Map<string, number>();
  for (const { repo } of sortedRepos) {
    if (repo.language) {
      primaryLangCounts.set(repo.language, (primaryLangCounts.get(repo.language) ?? 0) + 1);
    }
  }

  // Fetch detailed languages for top repos
  const topRepoCount = 15;
  const topRepos = sortedRepos.slice(0, topRepoCount);
  const repoLanguages = new Map<number, Record<string, number>>();

  for (const { repo } of topRepos) {
    const [owner, repoName] = repo.full_name.split('/');
    if (!owner || !repoName) continue;
    try {
      const langs = await client.getRepoLanguages(owner, repoName);
      repoLanguages.set(repo.id, langs);
    } catch {
      // ignore
    }
  }

  let nodesCreated = 0;

  // ─── 1. CulturalSignal — overall GitHub summary ──────────────────────────────
  const summaryNarrative = buildSummaryNarrative(profile, sortedRepos, contributions, orgs, primaryLangCounts);
  const statusScore = computeStatusScore(profile, contributions);
  try {
    const node = await insertCandidateNode(db, {
      candidate_id: candidateId,
      node_type: 'CulturalSignal',
      narrative_text: summaryNarrative,
      extracted_properties_json: JSON.stringify({
        dimension: 'github_profile',
        bars_score: Math.min(5, Math.max(1, Math.round(statusScore / 30))),
        reasoning: `GitHub user since ${new Date(profile.created_at).getFullYear()}. ${nonForkRepos.length} public repos, ${profile.followers} followers, ${contributions.length} external contribution targets.`,
        github_handle: handle,
        followers: profile.followers,
        following: profile.following,
        public_repos: profile.public_repos,
        public_gists: profile.public_gists,
        orgs: orgs.map((o) => o.login),
        top_languages: Array.from(primaryLangCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([lang]) => lang),
        owned_repos: nonForkRepos.length,
        external_contributions: contributions.length,
      }),
      embedding_json: null,
      source_type: 'github_enrichment',
      source_reference: `https://github.com/${handle}`,
      captured_at: Date.now(),
      confidence: 0.85,
      supersedes: null,
      superseded_at: null,
      decomposition_version: 'github-enrich-v2',
    });
    await embedAndUpdateNode(node.id, summaryNarrative, db, env);
    nodesCreated++;
  } catch (err) {
    console.error(`[githubEnrich] summary node failed for ${handle}:`, err);
  }

  // ─── 2. Project nodes for top owned repos ────────────────────────────────────
  for (let i = 0; i < topRepos.length; i++) {
    const { repo } = topRepos[i]!;
    const languages = repoLanguages.get(repo.id) ?? {};
    const narrative = buildRepoNarrative(repo, languages, profile, i + 1);

    try {
      const node = await insertCandidateNode(db, {
        candidate_id: candidateId,
        node_type: 'Project',
        narrative_text: narrative,
        extracted_properties_json: JSON.stringify({
          name: repo.name,
          description: repo.description,
          stars: repo.stargazers_count,
          watchers: repo.watchers_count,
          forks: repo.forks_count,
          languages,
          primary_language: repo.language,
          created_at: repo.created_at,
          pushed_at: repo.pushed_at,
          repo_url: repo.html_url,
          owner_followers: profile.followers,
        }),
        embedding_json: null,
        source_type: 'github_enrichment',
        source_reference: repo.html_url,
        captured_at: Date.now(),
        confidence: Math.min(0.95, 0.5 + repo.stargazers_count * 0.02),
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'github-enrich-v2',
      });
      await embedAndUpdateNode(node.id, narrative, db, env);
      nodesCreated++;
    } catch (err) {
      console.error(`[githubEnrich] project node failed for ${repo.full_name}:`, err);
    }
  }

  // ─── 3. Experience nodes for external contributions ──────────────────────────
  const topContributions = contributions.slice(0, 10);
  for (let i = 0; i < topContributions.length; i++) {
    const contrib = topContributions[i]!;
    const narrative = buildContributionNarrative(contrib, i + 1);

    try {
      const node = await insertCandidateNode(db, {
        candidate_id: candidateId,
        node_type: 'Experience',
        narrative_text: narrative,
        extracted_properties_json: JSON.stringify({
          company: contrib.repoFullName,
          role: 'Open Source Contributor',
          domain: 'open_source',
          impact_summary: `${contrib.mergedPrCount} merged pull request${contrib.mergedPrCount > 1 ? 's' : ''}`,
          repo_full_name: contrib.repoFullName,
          repo_url: contrib.repoUrl,
          merged_pr_count: contrib.mergedPrCount,
          contribution_type: 'open_source_pr',
        }),
        embedding_json: null,
        source_type: 'github_enrichment',
        source_reference: contrib.repoUrl,
        captured_at: Date.now(),
        confidence: Math.min(0.9, 0.6 + contrib.mergedPrCount * 0.05),
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'github-enrich-v2',
      });
      await embedAndUpdateNode(node.id, narrative, db, env);
      nodesCreated++;
    } catch (err) {
      console.error(`[githubEnrich] experience node failed for ${contrib.repoFullName}:`, err);
    }
  }

  // ─── 4. Skill nodes for top languages ────────────────────────────────────────
  const topLanguages = Array.from(primaryLangCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  for (let i = 0; i < topLanguages.length; i++) {
    const [lang, count] = topLanguages[i]!;
    const narrative = buildLanguageNarrative(lang, count, nonForkRepos.length, profile);

    try {
      const node = await insertCandidateNode(db, {
        candidate_id: candidateId,
        node_type: 'Skill',
        narrative_text: narrative,
        extracted_properties_json: JSON.stringify({
          name: lang,
          proficiency: count >= 5 ? 'expert' : count >= 2 ? 'proficient' : 'familiar',
          years_exposure: Math.max(1, Math.round(count / 2)),
          depth_pattern: `primary language in ${count} public repositor${count > 1 ? 'ies' : 'y'}`,
          language: lang,
          repo_count: count,
          source: 'github_primary_language_aggregation',
        }),
        embedding_json: null,
        source_type: 'github_enrichment',
        source_reference: `https://github.com/${handle}?tab=repositories`,
        captured_at: Date.now(),
        confidence: 0.8,
        supersedes: null,
        superseded_at: null,
        decomposition_version: 'github-enrich-v2',
      });
      await embedAndUpdateNode(node.id, narrative, db, env);
      nodesCreated++;
    } catch (err) {
      console.error(`[githubEnrich] skill node failed for ${lang}:`, err);
    }
  }

  // Update candidate_ingestion enrichment timestamp
  await db
    .prepare(
      `UPDATE candidate_ingestion
       SET last_enriched_at = ?1, updated_at = ?2
       WHERE candidate_id = ?3`,
    )
    .bind(Math.floor(Date.now() / 1000), new Date().toISOString(), candidateId)
    .run();

  return { nodesCreated, reposFound: repos.length };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function embedAndUpdateNode(
  nodeId: string,
  narrative: string,
  db: D1Database,
  env: { AI: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } },
): Promise<void> {
  try {
    const vector = await embedCandidateNode(narrative, env);
    await db
      .prepare(`UPDATE candidate_nodes SET embedding_json = ?1 WHERE id = ?2`)
      .bind(JSON.stringify(vector), nodeId)
      .run();
  } catch (err) {
    console.error(`[githubEnrich] embedding failed for node ${nodeId}:`, err);
  }
}

function aggregateContributions(prs: Array<{ repository_url: string }>): ContributionAggregate[] {
  const byRepo = new Map<string, { count: number; url: string }>();

  for (const pr of prs) {
    const repoFullName = pr.repository_url.replace('https://api.github.com/repos/', '');
    const existing = byRepo.get(repoFullName);
    if (existing) {
      existing.count++;
    } else {
      byRepo.set(repoFullName, {
        count: 1,
        url: `https://github.com/${repoFullName}`,
      });
    }
  }

  return Array.from(byRepo.entries())
    .map(([repoFullName, { count, url }]) => ({
      repoFullName,
      repoUrl: url,
      mergedPrCount: count,
    }))
    .sort((a, b) => b.mergedPrCount - a.mergedPrCount);
}

function computeStatusScore(
  profile: GitHubUserProfile,
  contributions: ContributionAggregate[],
): number {
  const COEF_REPOS = 2;
  const COEF_GISTS = 0.25;
  const COEF_FOLLOWERS = 0.5;
  const COEF_FOLLOWING = 0.25;
  const COEF_CONTRIBUTIONS = 3;

  return (
    profile.public_repos * COEF_REPOS +
    profile.public_gists * COEF_GISTS +
    profile.followers * COEF_FOLLOWERS +
    profile.following * COEF_FOLLOWING +
    contributions.reduce((sum, c) => sum + c.mergedPrCount, 0) * COEF_CONTRIBUTIONS
  );
}

function buildRepoNarrative(
  repo: GitHubRepo,
  languages: Record<string, number>,
  profile: { followers: number; name: string | null; login: string },
  rank: number,
): string {
  const since = new Date(repo.created_at).getFullYear();
  const until = new Date(repo.pushed_at).getFullYear();
  const activeYears = since === until ? `${since}` : `${since}–${until}`;

  const langEntries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const primaryLang = langEntries[0]?.[0] ?? repo.language ?? 'unknown';

  const impact =
    repo.stargazers_count > 1000
      ? `widely-adopted open-source project with ${repo.stargazers_count.toLocaleString()} stars`
      : repo.stargazers_count > 100
        ? `growing project with ${repo.stargazers_count} stars`
        : repo.stargazers_count > 0
          ? `project with ${repo.stargazers_count} stars`
          : 'personal project';

  const parts = [
    `Project #${rank}: ${repo.name} (${activeYears}).`,
    repo.description ? `${repo.description}.` : '',
    `Primary language: ${primaryLang}${langEntries.length > 1 ? `, also uses ${langEntries.slice(1, 3).map(([l]) => l).join(', ')}` : ''}.`,
    `${impact}, ${repo.forks_count} forks.`,
    profile.followers > 500 ? `Created by a developer with ${profile.followers.toLocaleString()} followers.` : '',
  ];

  return parts.filter(Boolean).join(' ');
}

function buildContributionNarrative(contrib: ContributionAggregate, rank: number): string {
  return (
    `Open-source contribution #${rank}: ${contrib.mergedPrCount} merged pull request${contrib.mergedPrCount > 1 ? 's' : ''} to ${contrib.repoFullName}. ` +
    `Demonstrates ability to collaborate on production codebases outside their own repositories.`
  );
}

function buildLanguageNarrative(
  lang: string,
  repoCount: number,
  totalRepos: number,
  profile: { login: string; name: string | null },
): string {
  const displayName = profile.name ?? profile.login;
  const pct = totalRepos > 0 ? Math.round((repoCount / totalRepos) * 100) : 0;
  return `${displayName} uses ${lang} in ${repoCount} of ${totalRepos} public repositories (${pct}%). Primary programming language in their open-source work on GitHub.`;
}

function buildSummaryNarrative(
  profile: GitHubUserProfile,
  sortedRepos: Array<{ repo: GitHubRepo; popularity: number }>,
  contributions: ContributionAggregate[],
  orgs: GitHubOrg[],
  primaryLangCounts: Map<string, number>,
): string {
  const since = new Date(profile.created_at).getFullYear();
  const activeYears = new Date().getFullYear() - since;

  const nonForkRepos = sortedRepos.filter(({ repo }) => !repo.fork);
  const totalStars = nonForkRepos.reduce((sum, { repo }) => sum + repo.stargazers_count, 0);

  const topLangs = Array.from(primaryLangCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang]) => lang);

  const orgText =
    orgs.length > 0
      ? `Member of ${orgs.length} organization${orgs.length > 1 ? 's' : ''} including ${orgs.slice(0, 3).map((o) => o.login).join(', ')}. `
      : '';

  const contribText =
    contributions.length > 0
      ? `Active contributor to ${contributions.length} external repositor${contributions.length > 1 ? 'ies' : 'y'} with merged pull requests. `
      : '';

  const parts = [
    `GitHub profile for ${profile.name ?? profile.login}.`,
    `Active on GitHub since ${since} (${activeYears}+ years).`,
    `Maintains ${nonForkRepos.length} public repositor${nonForkRepos.length > 1 ? 'ies' : 'y'}, totaling ${totalStars.toLocaleString()} stars.`,
    `Primary technology stack: ${topLangs.join(', ') || 'unknown'}.`,
    `${orgText}${contribText}`,
    profile.bio ? `Bio: ${profile.bio}` : '',
  ];

  return parts.filter(Boolean).join(' ');
}
