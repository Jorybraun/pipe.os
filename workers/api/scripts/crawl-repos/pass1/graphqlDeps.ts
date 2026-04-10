/**
 * Pass 1: Dependency extraction via GitHub GraphQL.
 *
 * Fetches declared package manifests (package.json, requirements.txt, go.mod, etc.)
 * and resolves them to skill slugs without cloning the repo.
 */

import type { GitHubClient, DependencyManifest } from '../shared/githubClient.js';
import { resolveSkillSlug } from '../shared/skillResolver.js';
import { logger } from '../shared/logger.js';

export interface ManifestSkill {
  slug: string;
  source: 'manifest';
  confidence: number;
}

/**
 * Fetches the dependency manifests for a repo and resolves all packages
 * to canonical skill slugs.
 *
 * Returns an empty array if the dependency graph is not enabled on the repo
 * (common for private-forked or older repos).
 */
export async function extractManifestSkills(
  client: GitHubClient,
  owner: string,
  repo: string,
): Promise<ManifestSkill[]> {
  let manifests: DependencyManifest[];

  try {
    manifests = await client.getDependencyManifests(owner, repo);
  } catch (err) {
    logger.debug('[pass1/graphqlDeps] Failed to fetch manifests (non-fatal)', {
      owner, repo,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  if (manifests.length === 0) return [];

  const seen = new Set<string>();
  const skills: ManifestSkill[] = [];

  for (const manifest of manifests) {
    for (const pkg of manifest.packages) {
      const slug = resolveSkillSlug(pkg.name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      // Confidence is slightly lower for dependency graph vs clone-based analysis
      // because the graph includes transitive deps on some manifest types.
      skills.push({ slug, source: 'manifest', confidence: 0.85 });
    }
  }

  logger.debug('[pass1/graphqlDeps] Resolved skills from manifests', {
    owner, repo,
    manifestCount: manifests.length,
    skillCount: skills.length,
  });

  return skills;
}

/**
 * Derives skill slugs from GitHub topic strings.
 * Topics are user-assigned labels like "react", "typescript", "graphql".
 */
export function extractTopicSkills(topics: string[]): Array<{ slug: string; source: 'topic'; confidence: number }> {
  const results: Array<{ slug: string; source: 'topic'; confidence: number }> = [];
  const seen = new Set<string>();

  for (const topic of topics) {
    const slug = resolveSkillSlug(topic);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    results.push({ slug, source: 'topic', confidence: 0.7 });
  }

  return results;
}
