/**
 * Repo Discovery Orchestrator — CR-13
 *
 * Queries the pre-populated qualified_repos catalog via matchRepos.
 * No external API calls at runtime; everything is a D1 query.
 *
 * The `discovery_jobs` table is kept for backwards compatibility with the
 * polling frontend — but jobs complete immediately (synchronously in waitUntil).
 *
 * Migration from Libraries.io: discover.ts was rewritten 2026-04-10.
 * librariesIo.ts and qualityFilter.ts are no longer used at runtime;
 * their logic moved to the crawler (scripts/crawl-repos/).
 */

import { matchRepos, type MatchedRepo } from './matchRepos';
import { rerankMatchedRepos } from './rerankPipeline';
import type { CandidatePersona, RoleContextDocument, RepoRoleAlignmentRow } from '../../types';
import type { LLMProvider } from '../llm/types';

export interface DiscoverOptions {
  db: D1Database;
  pipelineId: string;
  roleContextId: string;
  ownerId: string;
  jobId: string;
  persona: CandidatePersona;
  /**
   * Optional RCD-aware provider. When present AND the role context has an
   * `rcd_json` column populated, matched repos are reranked through the
   * two-stage retrieval pipeline (ADR-036 §2.3) and the resulting alignment
   * scores annotate + reorder the `discovered_repos` insert. Missing →
   * legacy persona-only path (existing behavior).
   */
  provider?: LLMProvider;
  /** Unused — kept for interface compatibility during transition. Will be removed. */
  librariesIoApiKey?: string | undefined;
  githubToken?: string | undefined;
}

/**
 * Discovers repos for a pipeline by querying the pre-qualified catalog.
 *
 * 1. Resolves persona skills → matchRepos
 * 2. Writes matched repos to discovered_repos
 * 3. Marks job as COMPLETED
 */
export async function runDiscovery(opts: DiscoverOptions): Promise<void> {
  const { db, pipelineId, roleContextId, ownerId, jobId, persona, provider } = opts;
  const now = new Date().toISOString();

  try {
    await db.prepare(
      `UPDATE discovery_jobs SET status = 'RUNNING', started_at = ?1 WHERE id = ?2`,
    ).bind(now, jobId).run();

    const skills = persona.mustHaveSkills ?? [];

    if (skills.length === 0) {
      await db.prepare(
        `UPDATE discovery_jobs SET status = 'COMPLETED', completed_at = ?1, error_message = 'No mustHaveSkills on persona' WHERE id = ?2`,
      ).bind(new Date().toISOString(), jobId).run();
      return;
    }

    await db.prepare(
      `UPDATE discovery_jobs SET skills_queried = ?1 WHERE id = ?2`,
    ).bind(JSON.stringify(skills), jobId).run();

    // Derive primary language from the first recognizable skill
    const primaryLanguage = derivePrimaryLanguage(skills);
    const domain = deriveDomain(persona);
    const seniority = (persona.seniority ?? 'mid').toLowerCase() as 'junior' | 'mid' | 'senior' | 'staff';

    const matched = await matchRepos(db, {
      mustHaveSkills: skills,
      niceToHaveSkills: persona.niceToHaveSkills ?? [],
      seniority,
      domain,
      primaryLanguage,
      limit: 20,
    });

    await db.prepare(
      `UPDATE discovery_jobs SET total_candidates = ?1 WHERE id = ?2`,
    ).bind(matched.length, jobId).run();

    // ── RCD-aware rerank (ADR-036 §2.3) ───────────────────────────────────
    // When the role context has an RCD and a provider is wired in, score
    // each matched repo against the RCD's technical_context + domain cells.
    // The alignment scores reorder + annotate the insert below; failures
    // fall back to matchRepos ordering so discovery never blocks on rerank.
    const aligned = await rerankWithRcd({
      db, provider, roleContextId, matched,
    });
    const orderedMatched = aligned.orderedMatched;
    const alignmentByRepoId = aligned.alignmentByRepoId;

    let totalPassed = 0;

    for (const repo of orderedMatched) {
      // Check if already discovered for this pipeline
      const existing = await db.prepare(
        `SELECT id FROM discovered_repos WHERE pipeline_id = ?1 AND github_url = ?2`,
      ).bind(pipelineId, repo.githubUrl).first<{ id: string }>();

      if (existing) continue;

      const [owner, repoName] = repo.fullName.split('/') as [string, string];

      const alignment = alignmentByRepoId.get(repo.id);
      const qualityDetails: Record<string, unknown> = {
        score: repo.score,
        matchedMustSkills: repo.matchedMustSkills,
        matchedNiceSkills: repo.matchedNiceSkills,
        matchedConstructs: repo.matchedConstructs,
      };
      if (alignment) {
        qualityDetails.rcd_alignment = {
          score: alignment.alignment_score,
          band: alignment.alignment_band,
          rcd_version: alignment.rcd_version,
          signals_version: alignment.signals_version,
          model_used: alignment.model_used,
        };
      }

      await db.prepare(`
        INSERT INTO discovered_repos (
          pipeline_id, role_context_id, owner_id,
          github_owner, github_repo, github_url, default_branch,
          discovery_source, discovery_query,
          stars, last_pushed_at, license, is_archived, is_fork,
          has_ci, primary_language,
          quality_score, quality_details,
          seniority_band,
          status, created_at, updated_at
        ) VALUES (
          ?1, ?2, ?3,
          ?4, ?5, ?6, 'main',
          'GRAPH_INDEX', ?7,
          ?8, ?9, 'MIT', 0, 0,
          0, ?10,
          ?11, ?12,
          ?13,
          'DISCOVERED', ?14, ?14
        )
      `).bind(
        pipelineId, roleContextId, ownerId,
        owner, repoName, repo.githubUrl,
        JSON.stringify(skills),
        repo.stars, new Date().toISOString(), repo.primaryLanguage,
        repo.prQualityScore,
        JSON.stringify(qualityDetails),
        repo.seniorityBand,
        now,
      ).run();

      totalPassed++;
    }

    await db.prepare(`
      UPDATE discovery_jobs
      SET status = 'COMPLETED', completed_at = ?1,
          total_passed = ?2, total_rejected = ?3
      WHERE id = ?4
    `).bind(new Date().toISOString(), totalPassed, matched.length - totalPassed, jobId).run();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[discover] Discovery failed for job ${jobId}:`, msg);
    await db.prepare(
      `UPDATE discovery_jobs SET status = 'FAILED', completed_at = ?1, error_message = ?2 WHERE id = ?3`,
    ).bind(new Date().toISOString(), msg.slice(0, 500), jobId).run();
  }
}

// ─── Skills-only discovery ────────────────────────────────────────────────────

export interface DiscoverBySkillsOptions {
  db: D1Database;
  ownerId: string;
  jobId: string;
  skills: string[];
  virtualPipelineId: string;
  /** Unused — kept for interface compatibility. */
  librariesIoApiKey?: string | undefined;
  githubToken?: string | undefined;
}

export async function runDiscoveryBySkills(opts: DiscoverBySkillsOptions): Promise<void> {
  const { db, ownerId, jobId, skills, virtualPipelineId } = opts;
  const now = new Date().toISOString();

  try {
    await db.prepare(
      `UPDATE discovery_jobs SET status = 'RUNNING', started_at = ?1 WHERE id = ?2`,
    ).bind(now, jobId).run();

    await db.prepare(
      `UPDATE discovery_jobs SET skills_queried = ?1 WHERE id = ?2`,
    ).bind(JSON.stringify(skills), jobId).run();

    if (skills.length === 0) {
      await db.prepare(
        `UPDATE discovery_jobs SET status = 'COMPLETED', completed_at = ?1, error_message = 'No skills provided' WHERE id = ?2`,
      ).bind(new Date().toISOString(), jobId).run();
      return;
    }

    const primaryLanguage = derivePrimaryLanguage(skills);

    const matched = await matchRepos(db, {
      mustHaveSkills: skills,
      niceToHaveSkills: [],
      seniority: 'mid',
      domain: 'web-backend',
      primaryLanguage,
      limit: 20,
    });

    await db.prepare(
      `UPDATE discovery_jobs SET total_candidates = ?1 WHERE id = ?2`,
    ).bind(matched.length, jobId).run();

    let totalPassed = 0;

    for (const repo of matched) {
      const existing = await db.prepare(
        `SELECT id FROM discovered_repos WHERE pipeline_id = ?1 AND github_url = ?2`,
      ).bind(virtualPipelineId, repo.githubUrl).first<{ id: string }>();

      if (existing) continue;

      const [owner, repoName] = repo.fullName.split('/') as [string, string];

      await db.prepare(`
        INSERT INTO discovered_repos (
          pipeline_id, owner_id,
          github_owner, github_repo, github_url, default_branch,
          discovery_source, discovery_query,
          stars, last_pushed_at, license, is_archived, is_fork,
          has_ci, primary_language,
          quality_score, quality_details,
          seniority_band,
          status, created_at, updated_at
        ) VALUES (
          ?1, ?2,
          ?3, ?4, ?5, 'main',
          'GRAPH_INDEX', ?6,
          ?7, ?8, 'MIT', 0, 0,
          0, ?9,
          ?10, ?11,
          ?12,
          'DISCOVERED', ?13, ?13
        )
      `).bind(
        virtualPipelineId, ownerId,
        owner, repoName, repo.githubUrl,
        JSON.stringify(skills),
        repo.stars, new Date().toISOString(), repo.primaryLanguage,
        repo.prQualityScore,
        JSON.stringify({
          score: repo.score,
          matchedMustSkills: repo.matchedMustSkills,
          matchedNiceSkills: repo.matchedNiceSkills,
        }),
        repo.seniorityBand,
        now,
      ).run();

      totalPassed++;
    }

    await db.prepare(`
      UPDATE discovery_jobs
      SET status = 'COMPLETED', completed_at = ?1,
          total_passed = ?2, total_rejected = ?3
      WHERE id = ?4
    `).bind(new Date().toISOString(), totalPassed, matched.length - totalPassed, jobId).run();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[discover] Skills discovery failed for job ${jobId}:`, msg);
    await db.prepare(
      `UPDATE discovery_jobs SET status = 'FAILED', completed_at = ?1, error_message = ?2 WHERE id = ?3`,
    ).bind(new Date().toISOString(), msg.slice(0, 500), jobId).run();
  }
}

// ─── RCD-aware rerank helper (ADR-036 §2.3) ───────────────────────────────

interface RerankStepInput {
  db: D1Database;
  provider: LLMProvider | undefined;
  roleContextId: string;
  matched: MatchedRepo[];
}

interface RerankStepResult {
  orderedMatched: MatchedRepo[];
  alignmentByRepoId: Map<number, RepoRoleAlignmentRow>;
}

/**
 * Optional rerank step. Wraps the whole thing in a try/catch because
 * discovery must never block on rerank failure — if Gemma is unavailable,
 * if the RCD is malformed, if the signals table is empty, we fall back to
 * matchRepos ordering with an empty alignment map.
 */
async function rerankWithRcd(input: RerankStepInput): Promise<RerankStepResult> {
  const { db, provider, roleContextId, matched } = input;
  const empty: RerankStepResult = {
    orderedMatched: matched,
    alignmentByRepoId: new Map(),
  };

  if (!provider || matched.length === 0) return empty;

  try {
    const rcd = await loadRcd(db, roleContextId);
    if (!rcd) return empty;

    const matchedRepos = matched.map((m) => ({ repoId: m.id, fullName: m.fullName }));
    const rerank = await rerankMatchedRepos({
      db, provider, rcd, matchedRepos,
    });

    if (rerank.alignments.size === 0) return empty;

    // Reorder: ranked alignments first (by alignment_score desc), then any
    // unranked repos (no signals, etc.) at the end in original order.
    const byId = new Map(matched.map((m) => [m.id, m]));
    const ordered: MatchedRepo[] = [];
    const seen = new Set<number>();

    for (const repoId of rerank.rankedRepoIds) {
      const repo = byId.get(repoId);
      if (repo) {
        ordered.push(repo);
        seen.add(repoId);
      }
    }
    for (const repo of matched) {
      if (!seen.has(repo.id)) ordered.push(repo);
    }

    return { orderedMatched: ordered, alignmentByRepoId: rerank.alignments };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[discover] rerank step failed, falling back to matchRepos order:', msg);
    return empty;
  }
}

async function loadRcd(db: D1Database, roleContextId: string): Promise<RoleContextDocument | null> {
  const row = await db
    .prepare('SELECT rcd_json FROM role_contexts WHERE id = ?1')
    .bind(roleContextId)
    .first<{ rcd_json: string | null }>();
  if (!row?.rcd_json) return null;
  try {
    return JSON.parse(row.rcd_json) as RoleContextDocument;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[discover] failed to parse rcd_json for role_context ${roleContextId}:`, msg);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PYTHON_SKILLS = new Set(['python', 'django', 'flask', 'fastapi', 'pytorch', 'tensorflow']);
const GO_SKILLS = new Set(['go', 'golang', 'gin', 'fiber', 'echo']);
const RUST_SKILLS = new Set(['rust', 'tokio', 'actix', 'axum']);
const JAVA_SKILLS = new Set(['java', 'spring', 'spring-boot', 'kotlin', 'quarkus']);
const RUBY_SKILLS = new Set(['ruby', 'rails', 'sinatra']);

function derivePrimaryLanguage(skills: string[]): string {
  const lower = skills.map((s) => s.toLowerCase());
  if (lower.some((s) => PYTHON_SKILLS.has(s))) return 'python';
  if (lower.some((s) => GO_SKILLS.has(s))) return 'go';
  if (lower.some((s) => RUST_SKILLS.has(s))) return 'rust';
  if (lower.some((s) => JAVA_SKILLS.has(s))) return 'java';
  if (lower.some((s) => RUBY_SKILLS.has(s))) return 'ruby';
  return 'typescript'; // default — covers React, Next.js, Node, etc.
}

function deriveDomain(persona: CandidatePersona): string {
  const all = [...(persona.mustHaveSkills ?? []), ...(persona.niceToHaveSkills ?? [])].map(
    (s) => s.toLowerCase(),
  );
  if (all.some((s) => ['react', 'vue', 'svelte', 'angular', 'nextjs'].includes(s))) return 'web-frontend';
  if (all.some((s) => ['express', 'fastify', 'nestjs', 'hono', 'django', 'fastapi', 'flask'].includes(s))) return 'web-backend';
  if (all.some((s) => ['graphql'].includes(s))) return 'web-backend';
  return 'web-backend';
}
