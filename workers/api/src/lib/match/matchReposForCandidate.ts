/**
 * matchReposForCandidate — picks the best repo + PR + issue for a single
 * candidate using vector-native ANN as the primary retrieval mechanism,
 * with the SQL graph matcher as a structured guardrail fallback.
 *
 * Called from the resume-upload hook after the Candidate Discovery agent
 * produces a candidate_searchable_profile + key_concepts. Writes are the
 * caller's responsibility — this function is a pure resolver.
 *
 * Flow:
 *   1. Primary: Call matchReposVectorNative with the candidate profile
 *      (preprocessed & embedded internally) against REPO_INDEX. Metadata
 *      filters (disqualified, primaryLanguage, seniorityBand) narrow the
 *      ANN search.
 *   2. Guardrail: If ANN returns < 5 results, also run matchRepos SQL
 *      graph matcher from key_concepts.
 *   3. Blend: Union of ANN and SQL results. Intersection repos are blended
 *      with the tunable cosineWeight. ANN-only repos use the raw ANN score.
 *      SQL-only repos use the normalized graph score.
 *   4. Pick PR + issue from the winning repo via autoStageBuilder.
 *
 * v2: Flipped primary path to REPO_INDEX ANN (matchReposVectorNative).
 *     SQL graph matcher (matchRepos) is the fallback when ANN is sparse.
 */

import type { CandidateKeyConcepts } from '../candidateDiscovery/agent';
import { matchRepos, type MatchedRepo, type MatchRequest } from '../repoDiscovery/matchRepos';
import {
  matchReposVectorNative,
  queryVectorIndex,
  type HydratedRepoMatch,
} from './matchVectorNative';
import { pickReviewPr, pickImplementationIssue } from './autoStageBuilder';

export interface MatchReposForCandidateInput {
  db: D1Database;
  /** REPO_INDEX binding — optional; fallback to SQL if missing. */
  vectorize?: VectorizeIndex | undefined;
  /** AI binding for BGE embed — optional; fallback to SQL if missing. */
  ai?: Ai | undefined;
  candidateProfile: string;
  keyConcepts: CandidateKeyConcepts;
  /** How many repos the SQL graph matcher considers. */
  candidateLimit?: number;
  /** How many vector neighbours to pull from REPO_INDEX. */
  rerankTopK?: number;
  /** Weight of the ANN score in the blended ranking (0..1). Default 0.6. */
  cosineWeight?: number;
}

export interface MatchReposForCandidateResult {
  repoChoice: {
    repoId: number;
    fullName: string;
    githubUrl: string;
    /** Blended ANN + normalized graph score (or raw ANN / normalized graph if single source). */
    score: number;
    /** Raw cosine distance from REPO_INDEX when ANN ran, else null. */
    cosine: number | null;
    rationale: string;
  };
  review: { prNumber: number; prTitle: string } | null;
  implementation: { issueNumber: number; issueTitle: string } | null;
  /** Top N candidates (post-blend) for explainability + debugging. */
  shortlist: Array<{ repoId: number; fullName: string; score: number; cosine: number | null }>;
}

function buildMatchRequestFromCandidate(
  kc: CandidateKeyConcepts,
  limit: number,
): MatchRequest {
  return {
    mustHaveSkills: kc.mustHaveSkills,
    niceToHaveSkills: kc.niceToHaveSkills,
    seniority: kc.seniority,
    domain: kc.detected_domain,
    primaryLanguage: kc.primary_language || 'typescript',
    limit,
  };
}

/** Graph scores from matchRepos typically range 0.4–0.8; min-max normalize to 0..1. */
function normalizeGraphScore(score: number): number {
  const minExpected = 0.3;
  const maxExpected = 0.9;
  return clamp01((score - minExpected) / (maxExpected - minExpected));
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export async function matchReposForCandidate(
  input: MatchReposForCandidateInput,
): Promise<MatchReposForCandidateResult> {
  const {
    db,
    vectorize,
    ai,
    candidateProfile,
    keyConcepts,
    candidateLimit = 10,
    rerankTopK = 50,
    cosineWeight = 0.6,
  } = input;

  if (keyConcepts.mustHaveSkills.length === 0) {
    throw new Error(
      'matchReposForCandidate: candidate has no must-have skills — Discovery agent output was degenerate',
    );
  }

  // ─── Stage 1: Vector-native ANN primary retrieval ───────────────────────────
  let annMatches: HydratedRepoMatch[] = [];
  let annScoreMap = new Map<number, number>(); // fallback raw scores if hydration fails

  if (ai && vectorize) {
    try {
      const metadataFilters: Record<string, string | number | boolean> = {
        disqualified: 0,
      };
      if (keyConcepts.primary_language) {
        metadataFilters.primaryLanguage = keyConcepts.primary_language;
      }
      if (keyConcepts.seniority) {
        metadataFilters.seniorityBand = keyConcepts.seniority;
      }

      annMatches = await matchReposVectorNative({
        db,
        targetIndex: vectorize,
        queryText: candidateProfile,
        topK: rerankTopK,
        ai,
        metadataFilters,
      });
    } catch (err) {
      console.error('[matchReposForCandidate] ANN primary retrieval failed:', err);
      annMatches = [];
    }

    // If hydration yielded nothing (e.g., test stubs with partial D1 stubs),
    // fall back to raw index scores so we can still blend with SQL graph results.
    if (annMatches.length === 0) {
      try {
        const rawMatches = await queryVectorIndex({
          targetIndex: vectorize,
          queryText: candidateProfile,
          topK: rerankTopK,
          ai,
          metadataFilters: { disqualified: 0 },
        });
        for (const m of rawMatches) {
          const id = Number(m.id);
          if (Number.isFinite(id)) annScoreMap.set(id, m.score);
        }
      } catch (err) {
        console.error('[matchReposForCandidate] raw vector index query failed:', err);
      }
    }
  }

  // ─── Stage 2: Structured SQL guardrail (always run for blending / fallback) ─
  const req = buildMatchRequestFromCandidate(keyConcepts, candidateLimit);
  const graphMatches = await matchRepos(db, req);

  if (annMatches.length === 0 && annScoreMap.size === 0 && graphMatches.length === 0) {
    throw new Error(
      `matchReposForCandidate: no candidate repos for seniority=${keyConcepts.seniority}, lang=${keyConcepts.primary_language}, must=${keyConcepts.mustHaveSkills.join(',')}`,
    );
  }

  // ─── Stage 3: Blend scores ──────────────────────────────────────────────────
  const annMap = new Map<number, HydratedRepoMatch>();
  for (const m of annMatches) {
    const id = Number(m.id);
    if (Number.isFinite(id)) annMap.set(id, m);
  }

  const sqlMap = new Map<number, MatchedRepo>();
  for (const m of graphMatches) {
    sqlMap.set(m.id, m);
  }

  const allRepoIds = new Set<number>([...annMap.keys(), ...annScoreMap.keys(), ...sqlMap.keys()]);

  const blended = Array.from(allRepoIds).map((repoId) => {
    const ann = annMap.get(repoId);
    const rawScore = annScoreMap.get(repoId);
    const sql = sqlMap.get(repoId);

    const annScore = ann ? ann.score : typeof rawScore === 'number' ? rawScore : null;
    const graphScore = sql ? sql.score : null;

    let score: number;
    if (annScore !== null && graphScore !== null) {
      score = annScore * cosineWeight + normalizeGraphScore(graphScore) * (1 - cosineWeight);
    } else if (annScore !== null) {
      score = annScore;
    } else if (graphScore !== null) {
      score = normalizeGraphScore(graphScore);
    } else {
      score = 0;
    }

    return {
      repoId,
      fullName: ann?.fullName ?? sql?.fullName ?? '',
      githubUrl: ann?.githubUrl ?? sql?.githubUrl ?? '',
      score,
      cosine: annScore,
      matchedMustSkills: sql?.matchedMustSkills ?? [],
    };
  });

  blended.sort((a, b) => b.score - a.score);

  const winner = blended[0]!;
  const topRepoId = winner.repoId;

  // ─── Stage 4: Pick PR + issue for winner ────────────────────────────────────
  const [pr, issue] = await Promise.all([
    pickReviewPr(db, topRepoId),
    pickImplementationIssue(db, topRepoId, keyConcepts.seniority),
  ]);

  // ─── Stage 5: Build rationale ───────────────────────────────────────────────
  const rationaleParts = [
    `matched ${winner.fullName} (score ${winner.score.toFixed(3)}`,
    winner.cosine !== null ? `, cosine ${winner.cosine.toFixed(3)}` : '',
    `)`,
  ];

  if (winner.matchedMustSkills.length > 0) {
    rationaleParts.push(
      ` covering ${winner.matchedMustSkills.length}/${keyConcepts.mustHaveSkills.length} must-have skill(s)`,
    );
  }

  if ((annMatches.length === 0 && annScoreMap.size === 0) && graphMatches.length > 0) {
    rationaleParts.push(' [SQL fallback]');
  }

  return {
    repoChoice: {
      repoId: topRepoId,
      fullName: winner.fullName,
      githubUrl: winner.githubUrl,
      score: winner.score,
      cosine: winner.cosine,
      rationale: rationaleParts.join(''),
    },
    review: pr,
    implementation: issue,
    shortlist: blended.slice(0, 5).map((b) => ({
      repoId: b.repoId,
      fullName: b.fullName,
      score: b.score,
      cosine: b.cosine,
    })),
  };
}
