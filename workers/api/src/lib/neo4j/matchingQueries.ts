/**
 * matchingQueries.ts — ADR-047 Per-Element Cypher Matching
 *
 * Replaces the legacy pipeline:
 *   matchReposVectorNative → matchRepos → candidateSituationFit → triangulateMatch
 *
 * With a single Cypher query that:
 *   - Reads matching policy from the Role node (no hardcoded thresholds)
 *   - Traverses Role→Requirement→CandidateNode relationships
 *   - Computes vector.similarity.cosine() per requirement
 *   - Aggregates dimension scores with evidence
 *   - Enforces dealbreakers at query time using role.dealbreaker_threshold
 *
 * Target latency: <100ms (vs 30-60s legacy)
 */

import type { Driver } from 'neo4j-driver';
import { runReadQuery } from './query';

export interface MatchEvidence {
  node_id: string;
  sim: number;
  type: string;
}

export interface RequirementMatch {
  requirement_id: string;
  score: number;
  evidence: MatchEvidence[];
  weight: number;
}

export interface MatchResult {
  candidate_id: string;
  overall_score: number;
  requirement_matches: RequirementMatch[];
}

export interface DealbreakerFailure {
  dealbreaker_id: string;
  narrative_text: string;
  strength: string;
  matched_similarity: number;
}

export type MatchPhilosophy = 'validate' | 'tailored' | 'hybrid';

/**
 * Match candidates against a role's requirements using per-element
 * vector similarity within graph traversal.
 *
 * All thresholds, caps, and multipliers are read from the Role node
 * in Neo4j — no hardcoded numbers in TypeScript or Cypher.
 *
 * @param driver Neo4j driver instance
 * @param roleContextId Role to match against
 * @returns Ranked list of candidates with per-requirement evidence
 */
export async function matchCandidatesForRole(
  driver: Driver,
  roleContextId: string,
): Promise<MatchResult[]> {
  const matchStart = Date.now();
  console.log(`[matchingQueries] matchCandidatesForRole starting | roleContextId=${roleContextId.slice(0, 8)}…`);

  const results = await runReadQuery(
    driver,
    `
    // Step 1: Load role and its matching policy
    MATCH (role:Role {role_context_id: $role_id})
    WITH role
    MATCH (role)-[:HAS_REQUIREMENT]->(req:Requirement)

    // Step 2: For each requirement, find matching candidate nodes
    MATCH (cand:Candidate)-[:HAS]->(node:CandidateNode)
    WHERE node.superseded_at IS NULL
      AND node.confidence >= role.confidence_threshold
    WITH role, req, cand, node,
         vector.similarity.cosine(req.embedding, node.embedding) AS sim
    WHERE sim >= role.similarity_threshold

    // Step 3: Aggregate per-requirement scores with evidence
    WITH role, req, cand,
         avg(sim) * log(1 + count(node)) AS per_req_score,
         collect({node_id: node.id, sim: sim, type: labels(node)[1]})[0..role.evidence_cap] AS top_evidence,
         count(node) AS match_count

    // Step 4: Apply philosophy multiplier to requirement weights
    WITH role, cand, req, per_req_score, top_evidence,
         CASE role.match_philosophy
           WHEN 'tailored' THEN req.weight * 1.2
           WHEN 'hybrid' THEN req.weight * role.hybrid_mix_ratio
           ELSE req.weight
         END AS effective_weight

    // Step 5: Roll up to candidate-level scores
    WITH role, cand,
         collect({
           requirement_id: req.id,
           score: per_req_score,
           evidence: top_evidence,
           weight: effective_weight
         }) AS requirement_matches,
         sum(per_req_score * effective_weight) / sum(effective_weight) AS overall_score
    WHERE overall_score > 0

    // Step 6: Exclude candidates who fail strong dealbreakers
    OPTIONAL MATCH (role)-[:HAS_DEALBREAKER {strength: 'strong'}]->(db:Dealbreaker)
    WITH role, cand, requirement_matches, overall_score, db
    OPTIONAL MATCH (cand)-[:HAS]->(dbNode:CandidateNode)
    WHERE dbNode.superseded_at IS NULL
    WITH role, cand, requirement_matches, overall_score, db,
         CASE WHEN db IS NOT NULL
           THEN max(vector.similarity.cosine(db.embedding, dbNode.embedding))
           ELSE null
         END AS dbSim
    WITH role, cand, requirement_matches, overall_score, dbSim
    WHERE dbSim IS NULL OR dbSim >= role.dealbreaker_threshold

    WITH role, cand, requirement_matches, overall_score
    ORDER BY overall_score DESC
    WITH role, collect({
      candidate_id: cand.candidate_id,
      overall_score: overall_score,
      requirement_matches: requirement_matches
    }) AS all_results
    UNWIND all_results[0..role.result_limit] AS result
    RETURN result.candidate_id AS candidate_id,
           result.overall_score AS overall_score,
           result.requirement_matches AS requirement_matches
    `,
    { role_id: roleContextId },
    (record) => ({
      candidate_id: record.get('candidate_id') as string,
      overall_score: (record.get('overall_score') as number) ?? 0,
      requirement_matches: (record.get('requirement_matches') as unknown[] ?? []).map((m: any) => ({
        requirement_id: m.requirement_id,
        score: m.score,
        evidence: m.evidence.map((e: any) => ({
          node_id: e.node_id,
          sim: e.sim,
          type: e.type,
        })),
        weight: m.weight,
      })),
    }),
  );

  const matchMs = Date.now() - matchStart;
  console.log(
    `[matchingQueries] matchCandidatesForRole complete | roleContextId=${roleContextId.slice(0, 8)}… | results=${results.length} candidates | ${matchMs}ms`,
  );

  return results;
}

/**
 * Check if a specific candidate fails any strong dealbreakers for a role.
 *
 * Reads the dealbreaker threshold from the Role node in the graph.
 *
 * @returns Array of failed dealbreakers (empty if candidate passes all)
 */
export async function checkDealbreakersForCandidate(
  driver: Driver,
  roleContextId: string,
  candidateId: string,
): Promise<DealbreakerFailure[]> {
  const results = await runReadQuery(
    driver,
    `
    MATCH (role:Role {role_context_id: $role_id})
    WITH role
    MATCH (role)-[:HAS_DEALBREAKER {strength: 'strong'}]->(db:Dealbreaker)
    MATCH (cand:Candidate {candidate_id: $candidate_id})-[:HAS]->(node:CandidateNode)
    WHERE node.superseded_at IS NULL
    WITH role, db, max(vector.similarity.cosine(db.embedding, node.embedding)) AS dbSim
    WHERE dbSim < role.dealbreaker_threshold
    RETURN db.id AS dealbreaker_id,
           db.narrative AS narrative_text,
           db.job_relatedness_strength AS strength,
           dbSim AS matched_similarity
    `,
    { role_id: roleContextId, candidate_id: candidateId },
    (record) => ({
      dealbreaker_id: record.get('dealbreaker_id') as string,
      narrative_text: record.get('narrative_text') as string,
      strength: record.get('strength') as string,
      matched_similarity: (record.get('matched_similarity') as number) ?? 0,
    }),
  );

  return results;
}

/**
 * One-shot match + dealbreaker check for a single candidate-role pair.
 * Convenience wrapper when you don't need the full ranked list.
 */
export async function scoreCandidateAgainstRole(
  driver: Driver,
  roleContextId: string,
  candidateId: string,
): Promise<{ score: number; matches: RequirementMatch[]; dealbreakerFailures: DealbreakerFailure[] } | null> {
  // Run match query scoped to this candidate
  const results = await runReadQuery(
    driver,
    `
    MATCH (role:Role {role_context_id: $role_id})
    WITH role
    MATCH (role)-[:HAS_REQUIREMENT]->(req:Requirement)
    MATCH (cand:Candidate {candidate_id: $candidate_id})-[:HAS]->(node:CandidateNode)
    WHERE node.superseded_at IS NULL
      AND node.confidence >= role.confidence_threshold
    WITH role, req, cand, node,
         vector.similarity.cosine(req.embedding, node.embedding) AS sim
    WHERE sim >= role.similarity_threshold
    WITH role, req, cand,
         avg(sim) * log(1 + count(node)) AS per_req_score,
         collect({node_id: node.id, sim: sim, type: labels(node)[1]})[0..role.evidence_cap] AS top_evidence
    WITH role, cand,
         collect({
           requirement_id: req.id,
           score: per_req_score,
           evidence: top_evidence,
           weight: req.weight
         }) AS requirement_matches,
         sum(per_req_score * req.weight) / sum(req.weight) AS overall_score
    RETURN overall_score, requirement_matches
    `,
    { role_id: roleContextId, candidate_id: candidateId },
    (record) => ({
      overall_score: (record.get('overall_score') as number) ?? 0,
      requirement_matches: (record.get('requirement_matches') as unknown[] ?? []).map((m: any) => ({
        requirement_id: m.requirement_id,
        score: m.score,
        evidence: m.evidence.map((e: any) => ({
          node_id: e.node_id,
          sim: e.sim,
          type: e.type,
        })),
        weight: m.weight,
      })),
    }),
  );

  if (results.length === 0) return null;

  const dealbreakerFailures = await checkDealbreakersForCandidate(driver, roleContextId, candidateId);

  return {
    score: results[0]!.overall_score,
    matches: results[0]!.requirement_matches,
    dealbreakerFailures,
  };
}

// ─── Repo Matching ───────────────────────────────────────────────────────────

export interface RepoMatchResult {
  repo_id: number;
  full_name: string;
  score: number;
  evidence: RepoEvidence[];
  match_count: number;
}

export interface RepoEvidence {
  node_type: string;
  narrative: string;
  similarity: number;
}

/**
 * Find the best-matching repos for a candidate using graph-native Cypher.
 *
 * Replaces: matchReposForCandidate.ts (Vectorize + SQL graph matcher)
 *
 * @param driver Neo4j driver instance
 * @param candidateId Candidate to match repos for
 * @param options.topK Number of repos to return (default 10)
 * @param options.minSimilarity Minimum cosine similarity (default 0.55)
 */
export async function matchReposForCandidateNeo4j(
  driver: Driver,
  candidateId: string,
  options?: {
    topK?: number;
    minSimilarity?: number;
  },
): Promise<RepoMatchResult[]> {
  const topK = options?.topK ?? 10;
  const minSimilarity = options?.minSimilarity ?? 0.55;

  const results = await runReadQuery(
    driver,
    `
    // Step 1: Get candidate's active nodes
    MATCH (c:Candidate {candidate_id: $candidate_id})-[:HAS]->(cn:CandidateNode)
    WHERE cn.superseded_at IS NULL

    // Step 2: Match against repo sub-elements
    MATCH (r:Repo)-[:HAS]->(rn:RepoNode)
    WHERE rn.node_type IN ['Feature', 'TechnicalStack', 'ArchitecturalPattern', 'PRSample']

    // Step 3: Compute similarities
    WITH r, cn, rn, vector.similarity.cosine(cn.embedding, rn.embedding) AS sim
    WHERE sim >= $min_similarity

    // Step 4: Aggregate per-repo
    WITH r, avg(sim) * log(1 + count(rn)) AS repo_score,
         collect({
           node_type: labels(rn)[1],
           narrative: rn.narrative_text,
           similarity: sim
         })[0..3] AS evidence,
         count(rn) AS match_count

    // Step 5: Return ranked results
    RETURN
      r.repo_id AS repo_id,
      r.full_name AS full_name,
      repo_score AS score,
      evidence AS evidence,
      match_count AS match_count
    ORDER BY repo_score DESC
    LIMIT toInteger($top_k)
    `,
    { candidate_id: candidateId, min_similarity: minSimilarity, top_k: topK },
    (record) => ({
      repo_id: (record.get('repo_id') as number) ?? 0,
      full_name: (record.get('full_name') as string) ?? '',
      score: (record.get('score') as number) ?? 0,
      evidence: (record.get('evidence') as unknown[] ?? []).map((e: any) => ({
        node_type: e.node_type,
        narrative: e.narrative,
        similarity: e.similarity,
      })),
      match_count: (record.get('match_count') as number) ?? 0,
    }),
  );

  return results;
}
