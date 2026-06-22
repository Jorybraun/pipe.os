/**
 * Repo Discovery Orchestrator — ADR-032
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
import { slugifySkills } from '../skills/slugifySkills';

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
  /**
   * Reserved for future secondary ranking evidence. Repository discovery no
   * longer uses Vectorize to create candidate rows because that would make
   * embedding-only repo decisions possible.
   */
  vectorize?: VectorizeIndex;
  ai?: Ai;
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

    const primaryLanguage = await derivePrimaryLanguage(db, skills);
    const normalizedSeniority = persona.seniority?.trim().toLowerCase();
    const seniority = normalizedSeniority
      && ['junior', 'mid', 'senior', 'staff'].includes(normalizedSeniority)
      ? normalizedSeniority as 'junior' | 'mid' | 'senior' | 'staff'
      : undefined;

    // Load RCD once — shared by Vectorize recall and Gemma rerank.
    const rcd = await loadRcd(db, roleContextId);

    const sqlMatched = await matchRepos(db, {
      mustHaveSkills: skills,
      niceToHaveSkills: persona.niceToHaveSkills ?? [],
      seniority,
      domain: undefined,
      primaryLanguage,
      limit: 50,
    });

    // If no repos matched the source-backed terms, skip discovery. Embeddings
    // must not create repository decisions on their own.
    if (sqlMatched.length === 0) {
      await db.prepare(
        `UPDATE discovery_jobs SET status = 'COMPLETED', completed_at = ?1, error_message = 'No repos matched source-backed selected terms' WHERE id = ?2`,
      ).bind(new Date().toISOString(), jobId).run();
      return;
    }

    // SQL/source-backed recall is the only source allowed to create discovered
    // repo rows. Embeddings may be used later as secondary ranking evidence,
    // but never as the sole reason a repository enters the candidate pool.
    const matched = sqlMatched;

    await db.prepare(
      `UPDATE discovery_jobs SET total_candidates = ?1 WHERE id = ?2`,
    ).bind(matched.length, jobId).run();

    // ── RCD-aware rerank (ADR-036 §2.3) ───────────────────────────────────
    // Canonical SQL+Gemma rerank preserved: Gemma scores each candidate
    // against the RCD's technical_context + domain cells, reorders + annotates
    // the insert below. Failures fall back to recall ordering.
    const aligned = await rerankWithRcd({
      db, provider, rcd, matched,
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

// ─── RCD-aware rerank helper (ADR-036 §2.3) ───────────────────────────────

interface RerankStepInput {
  db: D1Database;
  provider: LLMProvider | undefined;
  rcd: RoleContextDocument | null;
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
  const { db, provider, rcd, matched } = input;
  const empty: RerankStepResult = {
    orderedMatched: matched,
    alignmentByRepoId: new Map(),
  };

  if (!provider || !rcd || matched.length === 0) return empty;

  try {
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

async function derivePrimaryLanguage(
  db: D1Database,
  skills: string[],
): Promise<string | undefined> {
  const slugs = await slugifySkills(db, skills);
  if (slugs.length === 0) return undefined;
  const placeholders = slugs.map(() => '?').join(', ');
  const row = await db.prepare(
    `SELECT qr.primary_language, COUNT(DISTINCT rs.repo_id) AS evidence_count
       FROM repo_skills rs
       JOIN qualified_repos qr ON qr.id = rs.repo_id
      WHERE rs.skill_slug IN (${placeholders})
        AND qr.disqualified = 0
      GROUP BY qr.primary_language
      ORDER BY evidence_count DESC, qr.primary_language
      LIMIT 1`,
  ).bind(...slugs).first<{ primary_language: string }>();
  return row?.primary_language || undefined;
}
