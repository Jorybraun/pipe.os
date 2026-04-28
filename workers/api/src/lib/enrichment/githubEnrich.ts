/**
 * GitHub Enrichment — converts a candidate's public GitHub activity into
 * candidate_nodes (Project, Experience, Skill) for the living graph.
 *
 * Current implementation uses metadata-driven narratives without LLM calls.
 * Future upgrade: replace narratives with a lightweight Gemma decomposition prompt.
 */

import type { CandidateNode } from '../../types';
import { insertCandidateNode } from '../candidateDiscovery/candidateNodes';
import { embedCandidateNode } from '../candidateDiscovery/candidateNodes';
import { GitHubClient } from './githubClient';

export interface EnrichResult {
  nodesCreated: number;
  reposFound: number;
  error?: string;
}

/**
 * Enrich a candidate from their GitHub handle.
 *
 * @param handle      GitHub username
 * @param candidateId Internal candidate UUID
 * @param db          D1 database
 * @param env         Env with AI binding
 * @param token       Optional GitHub PAT
 */
export async function enrichCandidateFromGitHub(
  handle: string,
  candidateId: string,
  db: D1Database,
  env: { AI: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } },
  token?: string,
): Promise<EnrichResult> {
  const client = new GitHubClient({ token });

  // Fetch profile + repos
  let profile: Awaited<ReturnType<GitHubClient['getUserProfile']>>;
  let repos: Awaited<ReturnType<GitHubClient['getOwnedRepos']>>;
  try {
    [profile, repos] = await Promise.all([
      client.getUserProfile(handle),
      client.getOwnedRepos(handle),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { nodesCreated: 0, reposFound: 0, error: msg };
  }

  let nodesCreated = 0;

  // Process owned repos → Project nodes
  for (const repo of repos) {
    const [owner, repoName] = repo.full_name.split('/');
    if (!owner || !repoName) continue;

    // Skip forks with zero stars and no recent activity
    const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
    const lastPushed = new Date(repo.pushed_at).getTime();
    if (repo.stargazers_count === 0 && lastPushed < sixMonthsAgo) {
      continue;
    }

    // Fetch languages
    let languages: Record<string, number> = {};
    try {
      languages = await client.getRepoLanguages(owner, repoName);
    } catch {
      // ignore language fetch failures
    }

    const langList = Object.keys(languages).join(', ') || repo.language || 'unknown';

    const narrative = buildProjectNarrative(repo, langList, profile.followers);

    const node = await insertCandidateNode(db, {
      candidate_id: candidateId,
      node_type: 'Project',
      narrative_text: narrative,
      extracted_properties_json: JSON.stringify({
        stars: repo.stargazers_count,
        watchers: repo.watchers_count,
        forks: repo.forks_count,
        owner_followers: profile.followers,
        languages,
        repo_url: repo.html_url,
      }),
      embedding_json: null, // filled below after embedding
      source_type: 'github_enrichment',
      source_reference: repo.html_url,
      captured_at: Date.now(),
      confidence: Math.min(0.95, 0.5 + repo.stargazers_count * 0.02),
      supersedes: null,
      superseded_at: null,
      decomposition_version: 'github-enrich-v1',
    });

    // Embed the node
    try {
      const vector = await embedCandidateNode(narrative, env);
      await db
        .prepare(`UPDATE candidate_nodes SET embedding_json = ?1 WHERE id = ?2`)
        .bind(JSON.stringify(vector), node.id)
        .run();
    } catch (embedErr) {
      console.error(`[githubEnrich] embedding failed for repo ${repo.full_name}:`, embedErr);
    }

    nodesCreated++;
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

function buildProjectNarrative(
  repo: {
    name: string;
    description: string | null;
    stargazers_count: number;
    forks_count: number;
    html_url: string;
    pushed_at: string;
  },
  languages: string,
  ownerFollowers: number,
): string {
  const parts = [
    `Project: ${repo.name}.`,
    repo.description ? `${repo.description}.` : '',
    `Built with ${languages}.`,
    `${repo.stargazers_count} stars, ${repo.forks_count} forks.`,
    `Last pushed ${new Date(repo.pushed_at).toISOString().split('T')[0]}.`,
    `Owner has ${ownerFollowers} followers.`,
  ];
  return parts.filter(Boolean).join(' ');
}
