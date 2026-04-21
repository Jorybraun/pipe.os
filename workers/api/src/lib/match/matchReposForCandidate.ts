/**
 * matchReposForCandidate — picks the best repo + PR + issue for a single
 * candidate using the candidate's key_concepts (structured filter + graph
 * score) and an optional vector rerank against REPO_INDEX.
 *
 * Called from the resume-upload hook after the Candidate Discovery agent
 * produces a candidate_searchable_profile + key_concepts. Writes are the
 * caller's responsibility — this function is a pure resolver.
 *
 * Flow:
 *   1. Build a MatchRequest from key_concepts (seniority, primary_language,
 *      mustHaveSkills, niceToHaveSkills, detected_domain).
 *   2. Call matchRepos(db, req) — returns top N by graph score.
 *   3. Optional vector rerank: embed the candidate profile with the BGE query
 *      prefix, query REPO_INDEX for topK, build a lookup of cosine scores,
 *      blend with the graph score. If no ai/vectorize is provided, skip the
 *      rerank and return the raw matchRepos ordering.
 *   4. Reuse autoStageBuilder's pickReviewPr + pickImplementationIssue to
 *      resolve a PR (CODE_REVIEW) and issue (CODE_IMPLEMENTATION) from the
 *      chosen repo.
 *
 * The per-candidate row writes to `candidate_challenge_assignment` happen
 * in the orchestration layer (hooks/resumeUpload) — this module returns a
 * plain resolver result.
 *
 * v1 scope: candidate-side query only. Role-side blending for `hybrid`
 * match_philosophy is deferred — no ROLE_INDEX exists yet and role-side
 * Gemma-narrated text isn't stored at request time. Callers that want
 * `hybrid` get the same path as `tailored` until role-side search ships.
 * See STRATEGY.md Decision Log 2026-04-21.
 */

import type { CandidateKeyConcepts } from '../candidateDiscovery/agent';
import { matchRepos, type MatchedRepo, type MatchRequest } from '../repoDiscovery/matchRepos';
import { pickReviewPr, pickImplementationIssue } from './autoStageBuilder';

export interface MatchReposForCandidateInput {
  db: D1Database;
  /** REPO_INDEX binding — optional; rerank is skipped if missing. */
  vectorize?: VectorizeIndex | undefined;
  /** AI binding for BGE embed — optional; rerank is skipped if missing. */
  ai?: Ai | undefined;
  candidateProfile: string;
  keyConcepts: CandidateKeyConcepts;
  /** How many repos matchRepos considers before rerank. */
  candidateLimit?: number;
  /** How many vector neighbours to pull from REPO_INDEX for rerank. */
  rerankTopK?: number;
  /** Weight of cosine score in the blended ranking (0..1). Default 0.5. */
  cosineWeight?: number;
}

export interface MatchReposForCandidateResult {
  repoChoice: {
    repoId: number;
    fullName: string;
    githubUrl: string;
    /** Combined graph score + cosine similarity (or raw graph score if no rerank). */
    score: number;
    /** Raw cosine distance from REPO_INDEX when rerank ran, else null. */
    cosine: number | null;
    rationale: string;
  };
  review: { prNumber: number; prTitle: string } | null;
  implementation: { issueNumber: number; issueTitle: string } | null;
  /** Top N candidates (post-rerank) for explainability + debugging. */
  shortlist: Array<{ repoId: number; fullName: string; score: number; cosine: number | null }>;
}

const BGE_MODEL = '@cf/baai/bge-large-en-v1.5';
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

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

async function embedQuery(ai: Ai, text: string): Promise<number[] | null> {
  const queryText = BGE_QUERY_PREFIX + text;
  try {
    const embedResult = (await ai.run(BGE_MODEL, { text: [queryText] })) as {
      data?: number[][];
    };
    const vector = embedResult?.data?.[0];
    if (!vector || !Array.isArray(vector) || vector.length !== 1024) return null;
    return vector;
  } catch (err) {
    console.error('[matchReposForCandidate] query embed failed:', err);
    return null;
  }
}

async function fetchCosineScores(
  vectorize: VectorizeIndex,
  queryVector: number[],
  topK: number,
): Promise<Map<number, number>> {
  const scores = new Map<number, number>();
  try {
    const result = await vectorize.query(queryVector, {
      topK,
      filter: { disqualified: 0 },
    });
    for (const m of result?.matches ?? []) {
      const idMatch = m.id.match(/^repo_(\d+)$/);
      if (idMatch?.[1]) scores.set(Number(idMatch[1]), m.score);
    }
  } catch (err) {
    console.error('[matchReposForCandidate] vectorize.query failed:', err);
  }
  return scores;
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
    cosineWeight = 0.5,
  } = input;

  if (keyConcepts.mustHaveSkills.length === 0) {
    throw new Error(
      'matchReposForCandidate: candidate has no must-have skills — Discovery agent output was degenerate',
    );
  }

  const req = buildMatchRequestFromCandidate(keyConcepts, candidateLimit);
  const graphMatches = await matchRepos(db, req);
  if (graphMatches.length === 0) {
    throw new Error(
      `matchReposForCandidate: no candidate repos for seniority=${keyConcepts.seniority}, lang=${keyConcepts.primary_language}, must=${keyConcepts.mustHaveSkills.join(',')}`,
    );
  }

  // Optional rerank by cosine.
  let cosineScores: Map<number, number> = new Map();
  if (ai && vectorize) {
    const queryVector = await embedQuery(ai, candidateProfile);
    if (queryVector) {
      cosineScores = await fetchCosineScores(vectorize, queryVector, rerankTopK);
    }
  }

  const blended = graphMatches.map((m) => {
    const cos = cosineScores.get(m.id);
    const hasCos = typeof cos === 'number' && Number.isFinite(cos);
    const blendedScore = hasCos
      ? m.score * (1 - cosineWeight) + (cos as number) * cosineWeight
      : m.score;
    return {
      match: m,
      cosine: hasCos ? (cos as number) : null,
      blendedScore,
    };
  });
  blended.sort((a, b) => b.blendedScore - a.blendedScore);

  const winner = blended[0]!;
  const top: MatchedRepo = winner.match;

  // Best-effort PR + issue — failure to find either is a partial result, not
  // a hard error. The caller decides whether to mark the ingestion failed
  // or let the recruiter-override path fill the gap.
  const [pr, issue] = await Promise.all([
    pickReviewPr(db, top.id),
    pickImplementationIssue(db, top.id, keyConcepts.seniority),
  ]);

  const rationaleParts = [
    `matched ${top.fullName} (graph ${top.score.toFixed(3)}`,
    winner.cosine !== null ? `, cosine ${winner.cosine.toFixed(3)}` : '',
    `)`,
    ` covering ${top.matchedMustSkills.length}/${keyConcepts.mustHaveSkills.length} must-have skill(s)`,
  ];

  return {
    repoChoice: {
      repoId: top.id,
      fullName: top.fullName,
      githubUrl: top.githubUrl,
      score: winner.blendedScore,
      cosine: winner.cosine,
      rationale: rationaleParts.join(''),
    },
    review: pr,
    implementation: issue,
    shortlist: blended.slice(0, 5).map((b) => ({
      repoId: b.match.id,
      fullName: b.match.fullName,
      score: b.blendedScore,
      cosine: b.cosine,
    })),
  };
}
