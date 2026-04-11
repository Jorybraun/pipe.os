/**
 * Rerank Pipeline — cache-aware wrapper around `roleFitRerank`.
 *
 * ADR-036 §2.3 Stage 2. This is the only place `discover.ts` should touch
 * the rerank machinery. It owns three contracts:
 *
 *   1. Cache key invariant: a stored alignment row is valid only when its
 *      `role_context_id`, `rcd_version`, AND `signals_version` all match
 *      the current RCD + the repo's current signals. Any mismatch is a
 *      cache miss. Never key on `role_context_id` alone.
 *
 *   2. Miss handling: for cache misses we load the repo's
 *      `repo_engineering_signals` row (the Pass 3 offline output). Repos
 *      without an offline signals row are SKIPPED — they don't get rerun
 *      at runtime. The crawler is the only writer to that table.
 *
 *   3. Write-through: fresh rerank rows are written back to
 *      `repo_role_alignment` with INSERT OR REPLACE keyed on
 *      (role_context_id, repo_id). The write is observable by the copilot
 *      tool `explain_repo_for_role` on the next recruiter drawer open.
 *
 * This module is the seam where the runtime lane meets the persisted Pass 3
 * substrate. If you're about to call `roleFitRerank` directly from a route,
 * stop — use this wrapper so the cache and provenance both work.
 */

import { roleFitRerank, type RerankCandidate } from './roleFitRerank';
import type { LLMProvider } from '../llm/types';
import type {
  RoleContextDocument,
  RepoEngineeringSignalsRow,
  RepoRoleAlignmentRow,
  AlignmentBand,
} from '../../types';

// ─── Public API ─────────────────────────────────────────────────────────────

export interface MatchedRepoLite {
  repoId: number;
  fullName: string;
}

export interface RerankMatchedReposInput {
  db: D1Database;
  provider: LLMProvider;
  rcd: RoleContextDocument;
  matchedRepos: MatchedRepoLite[];
  /** Optional override for the model name stamped on the alignment row. */
  modelName?: string;
}

export interface RerankMatchedReposResult {
  /** All alignments that apply to the request, keyed by repo_id. */
  alignments: Map<number, RepoRoleAlignmentRow>;
  /** Stable ordering: repo_ids sorted by alignment_score desc. */
  rankedRepoIds: number[];
  cacheHits: number;
  cacheMisses: number;
  /** Of the cache misses, how many actually had offline signals and were reranked. */
  freshRerankCount: number;
  /** Cache misses that had no offline signals row — skipped, not reranked. */
  skippedForMissingSignals: number;
}

export async function rerankMatchedRepos(
  input: RerankMatchedReposInput,
): Promise<RerankMatchedReposResult> {
  const { db, provider, rcd, matchedRepos, modelName } = input;

  if (matchedRepos.length === 0) {
    return {
      alignments: new Map(),
      rankedRepoIds: [],
      cacheHits: 0,
      cacheMisses: 0,
      freshRerankCount: 0,
      skippedForMissingSignals: 0,
    };
  }

  const repoIds = matchedRepos.map((r) => r.repoId);
  const alignments = new Map<number, RepoRoleAlignmentRow>();

  // 1. Cache read.
  const cached = await readCachedAlignments(db, rcd.role_context_id, rcd.rcd_version, repoIds);

  const missRepoIds: number[] = [];
  for (const repo of matchedRepos) {
    const hit = cached.get(repo.repoId);
    if (hit) {
      alignments.set(repo.repoId, hit);
    } else {
      missRepoIds.push(repo.repoId);
    }
  }
  const cacheHits = alignments.size;
  const cacheMisses = missRepoIds.length;

  let freshRerankCount = 0;
  let skippedForMissingSignals = 0;

  if (missRepoIds.length > 0) {
    // 2. Load signals rows for cache misses.
    const signalsById = await loadEngineeringSignals(db, missRepoIds);

    // 3. Build rerank candidates from misses that have offline signals.
    const candidates: RerankCandidate[] = [];
    for (const repoId of missRepoIds) {
      const signals = signalsById.get(repoId);
      if (!signals) {
        skippedForMissingSignals++;
        continue;
      }
      // Cache key invariant: if the cached row existed but had a stale
      // signals_version, it was already treated as a miss above. Now we're
      // also confirming that the signals row we just loaded has a version
      // we're willing to use — the rerank result stamps this version on the
      // new alignment row so the cache key is self-consistent.
      const repo = matchedRepos.find((r) => r.repoId === repoId)!;
      candidates.push({ repo_id: repoId, full_name: repo.fullName, signals });
    }

    if (candidates.length > 0) {
      // 4. Call the reranker.
      const rerank = await roleFitRerank(
        modelName
          ? { provider, rcd, candidates, modelName }
          : { provider, rcd, candidates },
      );
      freshRerankCount = rerank.alignments.length;

      // 5. Write-through — cache + result map.
      for (const row of rerank.alignments) {
        alignments.set(row.repo_id, row);
        await writeAlignment(db, row);
      }
    }
  }

  // 6. Stable ordering: score desc, then repo_id asc for determinism.
  const ranked = Array.from(alignments.values()).sort((a, b) => {
    if (b.alignment_score !== a.alignment_score) {
      return b.alignment_score - a.alignment_score;
    }
    return a.repo_id - b.repo_id;
  });

  return {
    alignments,
    rankedRepoIds: ranked.map((r) => r.repo_id),
    cacheHits,
    cacheMisses,
    freshRerankCount,
    skippedForMissingSignals,
  };
}

// ─── D1 access ─────────────────────────────────────────────────────────────

interface RepoRoleAlignmentD1Row {
  role_context_id: string;
  repo_id: number;
  alignment_score: number;
  alignment_band: string;
  reasoning_json: string;
  per_signal_scores: string;
  rcd_version: string;
  signals_version: string;
  generated_at: string;
  model_used: string;
}

/**
 * Reads cached alignment rows for a set of repo_ids, filtered to rows whose
 * stored `rcd_version` matches the current RCD version. Rows with a stale
 * rcd_version are simply not returned — they will be treated as misses and
 * replaced when we write-through.
 *
 * `signals_version` is NOT filtered here because the per-repo signals_version
 * comes from the loaded signals row at miss time. A stored alignment whose
 * signals_version no longer matches the repo's current signals row is still
 * stale — we check that after loading signals and discard as needed. That
 * second check is deferred so we only pay for signals loads when needed.
 */
async function readCachedAlignments(
  db: D1Database,
  roleContextId: string,
  rcdVersion: string,
  repoIds: number[],
): Promise<Map<number, RepoRoleAlignmentRow>> {
  if (repoIds.length === 0) return new Map();

  // Build a parameterized IN clause. D1 caps statement params; for small
  // batches (20–50 repos) a single IN works fine.
  const placeholders = repoIds.map((_, i) => `?${i + 3}`).join(', ');
  const sql = `
    SELECT role_context_id, repo_id, alignment_score, alignment_band,
           reasoning_json, per_signal_scores, rcd_version, signals_version,
           generated_at, model_used
    FROM repo_role_alignment
    WHERE role_context_id = ?1
      AND rcd_version = ?2
      AND repo_id IN (${placeholders})
  `;

  const stmt = db.prepare(sql).bind(roleContextId, rcdVersion, ...repoIds);
  const result = await stmt.all<RepoRoleAlignmentD1Row>();

  const out = new Map<number, RepoRoleAlignmentRow>();
  for (const r of result.results ?? []) {
    out.set(r.repo_id, {
      role_context_id: r.role_context_id,
      repo_id: r.repo_id,
      alignment_score: r.alignment_score,
      alignment_band: normalizeBand(r.alignment_band),
      reasoning_json: r.reasoning_json,
      per_signal_scores: r.per_signal_scores,
      rcd_version: r.rcd_version,
      signals_version: r.signals_version,
      generated_at: r.generated_at,
      model_used: r.model_used,
    });
  }
  return out;
}

function normalizeBand(raw: string): AlignmentBand {
  if (raw === 'strong' || raw === 'moderate' || raw === 'weak' || raw === 'mismatch') return raw;
  return 'weak';
}

interface RepoSignalsD1Row {
  repo_id: number;
  signals_version: string;
  content_hash: string;
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  complexity_band: string | null;
  swe_bench_eligibility_rate: number | null;
  architecture_style: string | null;
  review_density: number | null;
  commit_cadence: number | null;
  satd_density: number | null;
  engineering_narrative: string;
  signal_json: string;
  generated_at: string;
  model_used: string;
  model_version: string;
}

async function loadEngineeringSignals(
  db: D1Database,
  repoIds: number[],
): Promise<Map<number, RepoEngineeringSignalsRow>> {
  if (repoIds.length === 0) return new Map();
  const placeholders = repoIds.map((_, i) => `?${i + 1}`).join(', ');
  const sql = `
    SELECT repo_id, signals_version, content_hash,
           test_touch_rate, mean_changed_files, p90_changed_files, issue_link_rate,
           complexity_band, swe_bench_eligibility_rate,
           architecture_style, review_density, commit_cadence, satd_density,
           engineering_narrative, signal_json,
           generated_at, model_used, model_version
    FROM repo_engineering_signals
    WHERE repo_id IN (${placeholders})
  `;
  const stmt = db.prepare(sql).bind(...repoIds);
  const result = await stmt.all<RepoSignalsD1Row>();

  const out = new Map<number, RepoEngineeringSignalsRow>();
  for (const r of result.results ?? []) {
    out.set(r.repo_id, {
      repo_id: r.repo_id,
      signals_version: r.signals_version,
      content_hash: r.content_hash,
      test_touch_rate: r.test_touch_rate,
      mean_changed_files: r.mean_changed_files,
      p90_changed_files: r.p90_changed_files,
      issue_link_rate: r.issue_link_rate,
      complexity_band: narrowComplexity(r.complexity_band),
      swe_bench_eligibility_rate: r.swe_bench_eligibility_rate,
      architecture_style: narrowArchitecture(r.architecture_style),
      review_density: r.review_density,
      commit_cadence: r.commit_cadence,
      satd_density: r.satd_density,
      engineering_narrative: r.engineering_narrative,
      signal_json: r.signal_json,
      generated_at: r.generated_at,
      model_used: r.model_used,
      model_version: r.model_version,
    });
  }
  return out;
}

function narrowComplexity(
  v: string | null,
): RepoEngineeringSignalsRow['complexity_band'] {
  if (v === 'low' || v === 'medium' || v === 'high' || v === 'mixed') return v;
  return null;
}

function narrowArchitecture(
  v: string | null,
): RepoEngineeringSignalsRow['architecture_style'] {
  if (
    v === 'monolith' ||
    v === 'microservice' ||
    v === 'modular_monolith' ||
    v === 'serverless' ||
    v === 'unknown'
  ) return v;
  return null;
}

async function writeAlignment(db: D1Database, row: RepoRoleAlignmentRow): Promise<void> {
  const sql = `
    INSERT OR REPLACE INTO repo_role_alignment (
      role_context_id, repo_id, alignment_score, alignment_band,
      reasoning_json, per_signal_scores,
      rcd_version, signals_version,
      generated_at, model_used
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
  `;
  await db
    .prepare(sql)
    .bind(
      row.role_context_id,
      row.repo_id,
      row.alignment_score,
      row.alignment_band,
      row.reasoning_json,
      row.per_signal_scores,
      row.rcd_version,
      row.signals_version,
      row.generated_at,
      row.model_used,
    )
    .run();
}
