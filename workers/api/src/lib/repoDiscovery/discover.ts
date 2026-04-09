/**
 * Repo Discovery Orchestrator
 *
 * Pipeline: Role persona → skill mapping → Libraries.io → GitHub quality filter → D1.
 * Runs Stages 1-2 in-Worker. Stages 3-4 (stack-analyser, scc) are offline.
 *
 * Called by POST /api/v1/repos/discover via ctx.waitUntil().
 */

import { mapSkillsToPackages } from './skillToPackage';
import { findIntersection, type LibrariesIoRepo } from './librariesIo';
import { checkRepoQuality } from './qualityFilter';
import type { CandidatePersona } from '../../types';

export interface DiscoverOptions {
  db: D1Database;
  pipelineId: string;
  roleContextId: string;
  ownerId: string;
  jobId: string;
  persona: CandidatePersona;
  librariesIoApiKey: string;
  githubToken?: string;
}

/**
 * Runs the full in-Worker discovery pipeline:
 *
 * 1. Map persona.mustHaveSkills to Libraries.io packages
 * 2. Query Libraries.io for dependent repos (intersection of all packages)
 * 3. Quality-filter each candidate via GitHub API
 * 4. Write passing repos to D1 as DISCOVERED
 * 5. Update the discovery job record
 */
export async function runDiscovery(opts: DiscoverOptions): Promise<void> {
  const { db, pipelineId, roleContextId, ownerId, jobId, persona, librariesIoApiKey, githubToken } = opts;

  const now = new Date().toISOString();

  try {
    // Mark job as running
    await db.prepare(
      `UPDATE discovery_jobs SET status = 'RUNNING', started_at = ?1 WHERE id = ?2`,
    ).bind(now, jobId).run();

    // Step 1: Map skills to packages
    const packages = mapSkillsToPackages(persona.mustHaveSkills);
    const queriedSkills = packages.map((p) => p.skill);

    await db.prepare(
      `UPDATE discovery_jobs SET skills_queried = ?1 WHERE id = ?2`,
    ).bind(JSON.stringify(queriedSkills), jobId).run();

    if (packages.length === 0) {
      await db.prepare(
        `UPDATE discovery_jobs SET status = 'COMPLETED', completed_at = ?1, error_message = 'No mappable skills found in persona' WHERE id = ?2`,
      ).bind(new Date().toISOString(), jobId).run();
      return;
    }

    // Step 2: Find repos that depend on ALL must-have packages
    // If > 3 packages, use the top 3 most specific (skip generic ones like "typescript")
    const queries = packages.slice(0, 3).map((p) => ({
      platform: p.platform,
      packageName: p.packageName,
    }));

    const candidates = await findIntersection(librariesIoApiKey, queries);

    await db.prepare(
      `UPDATE discovery_jobs SET total_candidates = ?1 WHERE id = ?2`,
    ).bind(candidates.length, jobId).run();

    // Step 3: Quality-filter each candidate (cap at 20 to stay within rate limits)
    const toCheck = candidates.slice(0, 20);
    let totalPassed = 0;
    let totalRejected = 0;

    for (const candidate of toCheck) {
      const [owner, repo] = parseFullName(candidate.full_name);
      if (!owner || !repo) {
        totalRejected++;
        continue;
      }

      // Check if already discovered for this pipeline
      const existing = await db.prepare(
        `SELECT id FROM discovered_repos WHERE pipeline_id = ?1 AND github_owner = ?2 AND github_repo = ?3`,
      ).bind(pipelineId, owner, repo).first<{ id: string }>();

      if (existing) continue;

      const quality = await checkRepoQuality(owner, repo, githubToken);

      if (quality.passed && quality.repo) {
        // Write to D1 as DISCOVERED
        await db.prepare(`
          INSERT INTO discovered_repos (
            pipeline_id, role_context_id, owner_id,
            github_owner, github_repo, github_url, default_branch,
            discovery_source, discovery_query,
            stars, last_pushed_at, license, is_archived, is_fork,
            has_ci, primary_language, topics,
            quality_score, quality_details,
            status, created_at, updated_at
          ) VALUES (
            ?1, ?2, ?3,
            ?4, ?5, ?6, ?7,
            'LIBRARIES_IO', ?8,
            ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16,
            ?17, ?18,
            'DISCOVERED', ?19, ?19
          )
        `).bind(
          pipelineId, roleContextId, ownerId,
          quality.repo.owner, quality.repo.repo, quality.repo.url, quality.repo.defaultBranch,
          JSON.stringify(queriedSkills),
          quality.repo.stars, quality.repo.pushedAt, quality.repo.license,
          quality.repo.isArchived ? 1 : 0, quality.repo.isFork ? 1 : 0,
          quality.repo.hasCi ? 1 : 0, quality.repo.language, JSON.stringify(quality.repo.topics),
          computeQualityScore(quality.repo.stars, quality.repo.hasCi),
          JSON.stringify({ failures: [], criteria: 'stars≥500, pushed<6mo, permissive license, not archived, not fork' }),
          now,
        ).run();

        totalPassed++;
      } else {
        totalRejected++;
      }
    }

    // Step 4: Update job as completed
    await db.prepare(`
      UPDATE discovery_jobs
      SET status = 'COMPLETED', completed_at = ?1,
          total_passed = ?2, total_rejected = ?3
      WHERE id = ?4
    `).bind(new Date().toISOString(), totalPassed, totalRejected, jobId).run();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[discover] Discovery failed for job ${jobId}:`, msg);
    await db.prepare(
      `UPDATE discovery_jobs SET status = 'FAILED', completed_at = ?1, error_message = ?2 WHERE id = ?3`,
    ).bind(new Date().toISOString(), msg.slice(0, 500), jobId).run();
  }
}

/** Parse "owner/repo" into [owner, repo]. */
function parseFullName(fullName: string): [string | undefined, string | undefined] {
  const parts = fullName.split('/');
  if (parts.length >= 2) return [parts[0], parts[1]];
  return [undefined, undefined];
}

/**
 * Simple quality score (0-1) based on available Stage 2 signals.
 * Will be enriched by offline Stage 3-4 assessment later.
 */
function computeQualityScore(stars: number, hasCi: boolean): number {
  let score = 0;

  // Stars component (0-0.5): log scale, 500 = 0.2, 5000 = 0.4, 50000 = 0.5
  const starsScore = Math.min(0.5, Math.log10(Math.max(stars, 1)) / 10);
  score += starsScore;

  // CI component (0-0.2)
  if (hasCi) score += 0.2;

  // Base pass score (0.3) — repo passed all quality checks
  score += 0.3;

  return Math.round(score * 100) / 100;
}
