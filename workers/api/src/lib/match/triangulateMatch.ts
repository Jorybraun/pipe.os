/**
 * Triangulated Match Scorer — coordinates meaning across Role → Candidate → Repo.
 *
 * Combines three pre-computed alignment signals into a single triangulated score:
 *   1. role_repo_alignment      — from repo_role_alignment cache (ADR-036 §2.3)
 *   2. candidate_repo_fit       — from candidateSituationFit
 *   3. role_candidate_cosine    — cosine(role_searchable_profile, candidate_searchable_profile)
 *
 * Plus a skill_coverage term from the graph matcher for grounding.
 *
 * The formula is philosophy-aware:
 *   - validate:  role_repo_alignment is high (baked at build time);
 *               candidate_repo_fit personalizes it.
 *   - tailored:  role_repo_alignment is ignored; candidate_repo_fit drives selection.
 *   - hybrid:    both contribute proportionally.
 *
 * See ADR-040 Meaning-Based Candidate-Repo-Role Triangulation.
 */

import type { MatchReposForCandidateResult } from './matchReposForCandidate';
import type { SituationFitRanking } from '../candidateDiscovery/candidateSituationFit';

// ─── Types ──────────────────────────────────────────────────────────────────

export type MatchPhilosophy = 'validate' | 'tailored' | 'hybrid';

export interface TriangulatedScore {
  repo_id: number;
  triangulated_score: number;
  dimensions: {
    skill_coverage: number;
    semantic_similarity: number;
    situation_fit: number;
    role_alignment: number;
  };
  raw_signals: {
    role_repo_alignment: number | null;
    candidate_repo_fit: number | null;
    role_candidate_cosine: number | null;
    graph_score: number | null;
  };
}

export interface TriangulateMatchInput {
  /** Pipeline match philosophy from pipeline_match_config. */
  philosophy: MatchPhilosophy;
  /** Graph match result (candidate→repo via structured filter). */
  graphResult: MatchReposForCandidateResult;
  /** Situation fit rankings from candidateSituationFit. */
  situationRankings: SituationFitRanking[];
  /** Pre-computed role→repo alignments from repo_role_alignment cache. */
  roleRepoAlignments: Map<number, number>;
  /** Pre-computed role→candidate cosine similarity. */
  roleCandidateCosine: number | null;
}

// ─── Weight presets by philosophy ───────────────────────────────────────────

interface WeightPreset {
  role_repo: number;
  candidate_fit: number;
  role_candidate: number;
  skill_coverage: number;
}

const WEIGHTS: Record<MatchPhilosophy, WeightPreset> = {
  validate: {
    role_repo: 0.35,
    candidate_fit: 0.30,
    role_candidate: 0.15,
    skill_coverage: 0.20,
  },
  tailored: {
    role_repo: 0.00,
    candidate_fit: 0.50,
    role_candidate: 0.20,
    skill_coverage: 0.30,
  },
  hybrid: {
    role_repo: 0.25,
    candidate_fit: 0.35,
    role_candidate: 0.20,
    skill_coverage: 0.20,
  },
};

// ─── Main function ──────────────────────────────────────────────────────────

export function triangulateMatch(input: TriangulateMatchInput): TriangulatedScore {
  const { philosophy, graphResult, situationRankings, roleRepoAlignments, roleCandidateCosine } = input;

  const winner = graphResult.repoChoice;
  const repoId = winner.repoId;

  // Lookup each signal
  const graphScore = winner.score;
  const situationRanking = situationRankings.find((r) => r.repo_id === repoId);
  const candidateRepoFit = situationRanking?.fit_score ?? null;
  const roleRepoAlignment = roleRepoAlignments.get(repoId) ?? null;

  // Build dimension scores (each 0..1)
  const dimensions = {
    skill_coverage: normalizeGraphScore(graphScore),
    semantic_similarity: winner.cosine ?? 0,
    situation_fit: candidateRepoFit ?? 0,
    role_alignment: roleRepoAlignment ?? 0,
  };

  // Compute triangulated score
  const w = WEIGHTS[philosophy];
  const triangulatedScore =
    w.role_repo * (roleRepoAlignment ?? 0) +
    w.candidate_fit * (candidateRepoFit ?? 0) +
    w.role_candidate * (roleCandidateCosine ?? 0) +
    w.skill_coverage * dimensions.skill_coverage;

  return {
    repo_id: repoId,
    triangulated_score: clamp01(triangulatedScore),
    dimensions,
    raw_signals: {
      role_repo_alignment: roleRepoAlignment,
      candidate_repo_fit: candidateRepoFit,
      role_candidate_cosine: roleCandidateCosine,
      graph_score: graphScore,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Graph scores from matchRepos typically range 0.4–0.8; min-max normalize to 0..1. */
function normalizeGraphScore(score: number): number {
  // Calibrated assumption: typical top repo scores land in [0.3, 0.9]
  const minExpected = 0.3;
  const maxExpected = 0.9;
  return clamp01((score - minExpected) / (maxExpected - minExpected));
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─── Batch scorer (for shortlist explainability) ────────────────────────────

export interface BatchTriangulatedScore {
  repo_id: number;
  triangulated_score: number;
  fit_band: 'strong' | 'moderate' | 'weak' | 'mismatch';
}

export function triangulateShortlist(
  input: TriangulateMatchInput,
): BatchTriangulatedScore[] {
  const { philosophy, graphResult, situationRankings, roleRepoAlignments, roleCandidateCosine } = input;

  const w = WEIGHTS[philosophy];
  const results: BatchTriangulatedScore[] = [];

  for (const item of graphResult.shortlist) {
    const repoId = item.repoId;
    const situationRanking = situationRankings.find((r) => r.repo_id === repoId);
    const candidateRepoFit = situationRanking?.fit_score ?? null;
    const roleRepoAlignment = roleRepoAlignments.get(repoId) ?? null;

    const score =
      w.role_repo * (roleRepoAlignment ?? 0) +
      w.candidate_fit * (candidateRepoFit ?? 0) +
      w.role_candidate * (roleCandidateCosine ?? 0) +
      w.skill_coverage * normalizeGraphScore(item.score);

    const clamped = clamp01(score);
    results.push({
      repo_id: repoId,
      triangulated_score: clamped,
      fit_band: deriveBand(clamped),
    });
  }

  results.sort((a, b) => b.triangulated_score - a.triangulated_score);
  return results;
}

function deriveBand(score: number): 'strong' | 'moderate' | 'weak' | 'mismatch' {
  if (score >= 0.75) return 'strong';
  if (score >= 0.5) return 'moderate';
  if (score >= 0.25) return 'weak';
  return 'mismatch';
}
