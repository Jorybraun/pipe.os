/**
 * Converts an accepted discovered repo into a CODE_REVIEW challenge template.
 *
 * Flow:
 * 1. Read the discovered_repos row
 * 2. Find the best recent merged PR (or use provided prNumber)
 * 3. Fetch the PR diff via existing fetchGitHubDiff utility
 * 4. Persist the exact source-backed review challenge packet
 * 5. Create a challenge_templates row only if the packet is production-ready
 * 6. Update discovered_repos status to CHALLENGE_READY
 */

import { fetchGitHubDiff } from '../fetchGitHubDiff';
import type { ChallengePacket } from '../repoSemanticGraph/model';
import type { DiscoveredRepoRow, SeniorityBand } from '../../types';

export interface ConvertResult {
  challengeTemplateId: string;
  prNumber: number;
  prTitle: string;
  filesChanged: number;
  packetId: string;
  packetEligible: boolean;
  packetQualityScore: number;
  packetGateFailures: string[];
}

interface GitHubPRListItem {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged_at: string | null;
  changed_files: number;
  additions: number;
  deletions: number;
}

/**
 * Converts an accepted repo into a CODE_REVIEW challenge template.
 */
export async function convertRepoToChallenge(
  db: D1Database,
  repo: DiscoveredRepoRow,
  options: { prNumber?: number; githubToken?: string },
): Promise<ConvertResult> {
  const { githubToken } = options;
  const now = new Date().toISOString();

  // Update status to CONVERTING
  await db.prepare(
    `UPDATE discovered_repos SET status = 'CONVERTING', updated_at = ?1 WHERE id = ?2`,
  ).bind(now, repo.id).run();

  try {
    // Step 1: Find the best PR
    let prNumber = options.prNumber;
    let prTitle = '';

    if (!prNumber) {
      const bestPR = await findBestPR(repo.github_owner, repo.github_repo, githubToken);
      if (!bestPR) {
        throw new Error(
          'No suitable merged PRs found in this repo for a review challenge packet. '
          + 'Automatic selection requires a merged PR with 3-50 changed files and 20-2000 changed lines.',
        );
      }
      prNumber = bestPR.number;
      prTitle = bestPR.title;
    }

    // Step 2: Fetch PR diff using existing utility
    const repoUrl = `https://github.com/${repo.github_owner}/${repo.github_repo}`;
    const diffResult = await fetchGitHubDiff(repoUrl, prNumber, githubToken ?? undefined);

    if (!diffResult) {
      throw new Error(`Failed to fetch PR #${prNumber} diff from ${repoUrl}`);
    }

    if (!prTitle) {
      prTitle = diffResult.metadata.title;
    }

    const qualifiedRepoId = await resolveQualifiedRepoId(db, repo);
    if (qualifiedRepoId === null) {
      throw new Error(`No qualified_repos row found for ${repo.github_owner}/${repo.github_repo}`);
    }

    const [
      { normalizeGitHubPullRequest },
      { buildChallengePacket },
      { deriveRepoSemantics },
      { persistReviewChallengeGraph },
    ] = await Promise.all([
      import('../repoSemanticGraph/githubNormalize'),
      import('../repoSemanticGraph/challengePacket'),
      import('../repoSemanticGraph/derive'),
      import('../repoSemanticGraph/persistence'),
    ]);

    const normalizedPullRequest = await normalizeGitHubPullRequest({
      repoUrl,
      prNumber,
      diffResult,
      primaryLanguage: repo.primary_language,
      defaultBranch: repo.default_branch,
      observedAt: now,
    });
    const packet = await buildChallengePacket(normalizedPullRequest);
    const derivedGraph = await deriveRepoSemantics({
      pullRequest: normalizedPullRequest,
      packet,
      structuralFacts: normalizedPullRequest.structuralFacts ?? [],
    });
    await persistReviewChallengeGraph(db, qualifiedRepoId, normalizedPullRequest, packet, {
      structuralFacts: normalizedPullRequest.structuralFacts ?? [],
      codeEpisodes: derivedGraph.episodes,
      facets: derivedGraph.facets,
      semanticAssertions: derivedGraph.assertions,
      repoSignals: derivedGraph.signals,
    });
    assertPacketProductionReady(packet);

    // Step 3: Create challenge template
    const config = JSON.stringify({
      repoUrl,
      prNumber,
      prTitle: diffResult.metadata.title,
      prDescription: diffResult.metadata.description,
      language: repo.primary_language ?? 'TypeScript',
      diff: diffResult.diff.files,
    });

    const serverConfig = JSON.stringify({
      groundTruth: [],
      repoOwner: repo.github_owner,
      repoName: repo.github_repo,
    });

    const difficulty = mapSeniorityToDifficulty(repo.seniority_band);

    const templateResult = await db.prepare(`
      INSERT INTO challenge_templates (
        type, title, instructions, difficulty, primary_skill,
        config, server_config, source, is_published,
        created_by, created_at, updated_at
      ) VALUES (
        'CODE_REVIEW', ?1, ?2, ?3, ?4,
        ?5, ?6, 'AI_GENERATED', 0,
        ?7, ?8, ?8
      )
      RETURNING id
    `).bind(
      `Review: ${prTitle}`.slice(0, 200),
      `Review this pull request from ${repo.github_owner}/${repo.github_repo}. Identify bugs, design issues, and suggest improvements.`,
      difficulty,
      repo.primary_language ?? 'TypeScript',
      config,
      serverConfig,
      repo.owner_id,
      now,
    ).first<{ id: string }>();

    if (!templateResult) {
      throw new Error('Failed to create challenge template');
    }

    // Step 4: Update discovered repo
    await db.prepare(`
      UPDATE discovered_repos
      SET status = 'CHALLENGE_READY', challenge_template_id = ?1, updated_at = ?2
      WHERE id = ?3
    `).bind(templateResult.id, now, repo.id).run();

    return {
      challengeTemplateId: templateResult.id,
      prNumber,
      prTitle,
      filesChanged: diffResult.diff.files.length,
      packetId: packet.id,
      packetEligible: packet.quality.eligible,
      packetQualityScore: packet.quality.score,
      packetGateFailures: packetGateFailures(packet),
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.prepare(
      `UPDATE discovered_repos SET status = 'FAILED', error_message = ?1, updated_at = ?2 WHERE id = ?3`,
    ).bind(msg.slice(0, 500), now, repo.id).run();
    throw err;
  }
}

export function packetGateFailures(packet: Pick<ChallengePacket, 'quality'>): string[] {
  return packet.quality.gates
    .filter((gate) => !gate.passed)
    .map((gate) => `${gate.gate}: ${gate.reason}`);
}

export function assertPacketProductionReady(packet: Pick<ChallengePacket, 'id' | 'quality'>): void {
  if (packet.quality.eligible) return;
  const failures = packetGateFailures(packet);
  throw new Error(
    [
      `Review challenge packet ${packet.id} is not production-ready.`,
      failures.length > 0 ? `Failed gates: ${failures.join('; ')}` : 'No gate diagnostics were recorded.',
    ].join(' '),
  );
}

/**
 * Finds the best recent merged PR for code review challenge creation.
 * Criteria: merged and reviewable size from GitHub list metadata. Full
 * provenance, tests, and packet quality are validated after fetching the PR.
 */
async function findBestPR(
  owner: string,
  repo: string,
  githubToken?: string,
): Promise<GitHubPRListItem | null> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
    { headers },
  );

  if (!response.ok) return null;

  const prs = (await response.json()) as GitHubPRListItem[];

  // Filter: merged, reasonable size
  const candidates = prs
    .filter((pr) => pr.merged_at !== null)
    .filter((pr) => pr.changed_files >= 3 && pr.changed_files <= 50)
    .filter((pr) => (pr.additions + pr.deletions) >= 20 && (pr.additions + pr.deletions) <= 2000);

  if (candidates.length === 0) return null;

  // Prefer PRs in the 5-20 file range (good complexity for review)
  const ideal = candidates.filter((pr) => pr.changed_files >= 5 && pr.changed_files <= 20);
  return ideal[0] ?? candidates[0] ?? null;
}

async function resolveQualifiedRepoId(
  db: D1Database,
  repo: DiscoveredRepoRow,
): Promise<number | null> {
  const fullName = `${repo.github_owner}/${repo.github_repo}`;
  const row = await db.prepare(
    `SELECT id
       FROM qualified_repos
      WHERE github_url = ?1 OR full_name = ?2
      ORDER BY id
      LIMIT 1`,
  ).bind(repo.github_url, fullName).first<{ id: number }>();
  return row?.id ?? null;
}

function mapSeniorityToDifficulty(band: SeniorityBand | null): string {
  switch (band) {
    case 'JUNIOR': return 'JUNIOR';
    case 'MID': return 'MID';
    case 'SENIOR':
    case 'STAFF': return 'SENIOR';
    default: return 'MID';
  }
}
