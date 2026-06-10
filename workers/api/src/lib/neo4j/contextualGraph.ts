/**
 * contextualGraph.ts — ADR-050 typed conversation-graph writes + grounded
 * edge materialization + structural (multi-region) repo matching.
 *
 * Three responsibilities:
 *   1. writeContextualTurnGraph — persist one answer's contextual statements
 *      as CandidateNode nodes connected by typed edges (DID/WITH/BECAUSE/…).
 *      Cypher cannot parametrize relationship types, so edges are written in
 *      per-edge-type UNWIND batches against the whitelist.
 *   2. materializeGroundedEdges — write (:CandidateNode)-[:SIMILAR_TO
 *      {grounding}]->(:RepoNode) edges only when cosine similarity ≥ 0.84 AND
 *      the two narratives share concrete grounding (lexical overlap check).
 *   3. matchReposByGroundedEdges — traversal over materialized edges,
 *      preferring repos whose grounded edges span multiple distinct regions
 *      (node types). No scores surfaced — results are explained by listing
 *      the actual edges.
 */

import type { Driver } from 'neo4j-driver';
import { runQuery, runReadQuery, runWriteQuery } from './query';
import {
  CONTEXTUAL_EDGE_TYPES,
  type ContextualEdgeType,
} from '../cultureContextualDecomposition';

export const GROUNDED_EDGE_MIN_SIMILARITY = 0.84;

export interface ContextualGraphNodeInput {
  /** D1 candidate_nodes id — used as the Neo4j node id. */
  id: string;
  nodeType: string;
  narrativeText: string;
  embedding: number[];
  sourceReference: string;
  capturedAt: number;
}

export interface ContextualGraphEdgeInput {
  fromId: string;
  toId: string;
  type: ContextualEdgeType;
}

export interface WriteContextualTurnGraphInput {
  candidateId: string;
  nodes: ContextualGraphNodeInput[];
  /** Edges between the nodes above; "candidate" as fromId targets the Candidate node. */
  edges: ContextualGraphEdgeInput[];
}

export async function writeContextualTurnGraph(
  driver: Driver,
  input: WriteContextualTurnGraphInput,
): Promise<{ nodesWritten: number; edgesWritten: number }> {
  if (input.nodes.length === 0) {
    return { nodesWritten: 0, edgesWritten: 0 };
  }

  await runWriteQuery(
    driver,
    `MERGE (c:Candidate {candidate_id: $candidate_id})
     WITH c
     UNWIND $nodes AS node
     MERGE (n:CandidateNode {id: node.id})
     SET n.node_type = node.node_type,
         n.narrative_text = node.narrative_text,
         n.embedding = node.embedding,
         n.source_type = 'culture_contextual',
         n.source_reference = node.source_reference,
         n.captured_at = node.captured_at,
         n.superseded_at = null
     MERGE (c)-[:HAS]->(n)`,
    {
      candidate_id: input.candidateId,
      nodes: input.nodes.map((n) => ({
        id: n.id,
        node_type: n.nodeType,
        narrative_text: n.narrativeText,
        embedding: n.embedding,
        source_reference: n.sourceReference,
        captured_at: n.capturedAt,
      })),
    },
  );

  let edgesWritten = 0;
  // Relationship types cannot be parametrized in Cypher — batch per type
  // against the whitelist.
  for (const edgeType of CONTEXTUAL_EDGE_TYPES) {
    const batch = input.edges.filter(
      (e) => e.type === edgeType && e.fromId !== 'candidate',
    );
    if (batch.length > 0) {
      const result = await runWriteQuery(
        driver,
        `UNWIND $edges AS edge
         MATCH (a:CandidateNode {id: edge.from_id})
         MATCH (b:CandidateNode {id: edge.to_id})
         MERGE (a)-[:${edgeType}]->(b)`,
        {
          edges: batch.map((e) => ({ from_id: e.fromId, to_id: e.toId })),
        },
      );
      edgesWritten += result.relationshipsCreated;
    }

    const candidateBatch = input.edges.filter(
      (e) => e.type === edgeType && e.fromId === 'candidate',
    );
    if (candidateBatch.length > 0) {
      const result = await runWriteQuery(
        driver,
        `MATCH (c:Candidate {candidate_id: $candidate_id})
         UNWIND $edges AS edge
         MATCH (b:CandidateNode {id: edge.to_id})
         MERGE (c)-[:${edgeType}]->(b)`,
        {
          candidate_id: input.candidateId,
          edges: candidateBatch.map((e) => ({ to_id: e.toId })),
        },
      );
      edgesWritten += result.relationshipsCreated;
    }
  }

  return { nodesWritten: input.nodes.length, edgesWritten };
}

// ─── Grounded edge materialization ───────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'from', 'into', 'onto',
  'over', 'under', 'on', 'in', 'at', 'to', 'of', 'by', 'as', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these',
  'those', 'their', 'they', 'them', 'we', 'our', 'you', 'your', 'i', 'my',
  'using', 'used', 'use', 'uses', 'new', 'via', 'when', 'which', 'while',
  'where', 'who', 'what', 'how', 'than', 'then', 'so', 'not', 'no', 'can',
  'could', 'should', 'would', 'will', 'has', 'have', 'had', 'do', 'does',
  'did', 'also', 'more', 'most', 'some', 'all', 'each', 'other', 'such',
  'based', 'support', 'supports', 'system', 'systems', 'application',
  'applications', 'project', 'projects', 'code', 'software', 'team',
]);

function groundingTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9+#.@-]+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/**
 * Concrete-grounding check: the candidate phrase and repo narrative must
 * share at least one concrete token (named tech, domain term, architectural
 * move). Returns the shared tokens (the grounding) or null.
 */
export function sharedGrounding(
  candidatePhrase: string,
  repoNarrative: string,
): string[] | null {
  const candidateTokens = groundingTokens(candidatePhrase);
  const repoTokens = groundingTokens(repoNarrative);
  const shared: string[] = [];
  for (const t of candidateTokens) {
    if (repoTokens.has(t)) shared.push(t);
  }
  return shared.length > 0 ? shared : null;
}

export interface GroundedEdgeCandidate {
  candidateNodeId: string;
  candidatePhrase: string;
  repoNodeId: string;
  repoNarrative: string;
  similarity: number;
}

/**
 * For the given candidate nodes, find repo nodes above the tight similarity
 * bar, verify shared concrete grounding in TS, and write
 * (:CandidateNode)-[:SIMILAR_TO {similarity, grounding}]->(:RepoNode) edges.
 */
export async function materializeGroundedEdges(
  driver: Driver,
  candidateId: string,
  candidateNodeIds: string[],
  options: { minSimilarity?: number } = {},
): Promise<{ edgesWritten: number }> {
  if (candidateNodeIds.length === 0) {
    return { edgesWritten: 0 };
  }
  const minSimilarity = options.minSimilarity ?? GROUNDED_EDGE_MIN_SIMILARITY;

  const candidates = await runReadQuery<GroundedEdgeCandidate>(
    driver,
    `MATCH (c:Candidate {candidate_id: $candidate_id})-[:HAS]->(cn:CandidateNode)
     WHERE cn.id IN $node_ids AND cn.embedding IS NOT NULL
     MATCH (r:Repo)-[:HAS]->(rn:RepoNode)
     WHERE rn.node_type IN ['Feature', 'TechnicalStack', 'ArchitecturalPattern', 'PRSample']
       AND rn.embedding IS NOT NULL
     WITH cn, rn, vector.similarity.cosine(cn.embedding, rn.embedding) AS sim
     WHERE sim >= $min_similarity
     RETURN cn.id AS candidate_node_id,
            cn.narrative_text AS candidate_phrase,
            rn.id AS repo_node_id,
            rn.narrative_text AS repo_narrative,
            sim AS similarity`,
    { candidate_id: candidateId, node_ids: candidateNodeIds, min_similarity: minSimilarity },
    (record) => ({
      candidateNodeId: record.get('candidate_node_id') as string,
      candidatePhrase: (record.get('candidate_phrase') as string | null) ?? '',
      repoNodeId: record.get('repo_node_id') as string,
      repoNarrative: (record.get('repo_narrative') as string | null) ?? '',
      similarity: record.get('similarity') as number,
    }),
  );

  const grounded = candidates.flatMap((c) => {
    const grounding = sharedGrounding(c.candidatePhrase, c.repoNarrative);
    if (!grounding) return [];
    return [
      {
        candidate_node_id: c.candidateNodeId,
        repo_node_id: c.repoNodeId,
        similarity: c.similarity,
        grounding: grounding.slice(0, 8).join(', '),
      },
    ];
  });

  if (grounded.length === 0) {
    return { edgesWritten: 0 };
  }

  const result = await runWriteQuery(
    driver,
    `UNWIND $edges AS edge
     MATCH (cn:CandidateNode {id: edge.candidate_node_id})
     MATCH (rn:RepoNode {id: edge.repo_node_id})
     MERGE (cn)-[s:SIMILAR_TO]->(rn)
     SET s.similarity = edge.similarity,
         s.grounding = edge.grounding`,
    { edges: grounded },
  );

  return { edgesWritten: result.relationshipsCreated };
}

// ─── Structural matching ─────────────────────────────────────────────────────

export interface GroundedEdgeEvidence {
  candidatePhrase: string;
  repoNarrative: string;
  nodeType: string;
  grounding: string;
}

export interface GroundedRepoMatch {
  repoId: number;
  fullName: string;
  /** Distinct repo node types (regions) the grounded edges span. */
  regions: number;
  edgeCount: number;
  edges: GroundedEdgeEvidence[];
}

/**
 * Traversal-based matching over materialized grounded edges. Repos whose
 * grounded edges span multiple distinct regions (stack + architectural
 * pattern + problem domain) rank above single-region fan-out. Explainable by
 * listing the actual edges — no scores surfaced.
 */
export async function matchReposByGroundedEdges(
  driver: Driver,
  candidateId: string,
  options: { topK?: number } = {},
): Promise<GroundedRepoMatch[]> {
  const topK = options.topK ?? 5;

  const result = await runQuery(
    driver,
    `MATCH (c:Candidate {candidate_id: $candidate_id})-[:HAS]->(cn:CandidateNode)
     WHERE cn.superseded_at IS NULL
     MATCH (cn)-[s:SIMILAR_TO]->(rn:RepoNode)<-[:HAS]-(r:Repo)
     WITH r,
          count(DISTINCT rn.node_type) AS regions,
          count(s) AS edge_count,
          collect({
            candidate_phrase: cn.narrative_text,
            repo_narrative: rn.narrative_text,
            node_type: rn.node_type,
            grounding: s.grounding
          })[0..8] AS edges
     ORDER BY regions DESC, edge_count DESC
     RETURN r.repo_id AS repo_id, r.full_name AS full_name,
            regions, edge_count, edges
     LIMIT toInteger($top_k)`,
    { candidate_id: candidateId, top_k: topK },
    { accessMode: 'READ' },
  );

  return result.records.map((record) => {
    const regionsRaw: unknown = record.get('regions');
    const edgeCountRaw: unknown = record.get('edge_count');
    const edgesRaw: unknown = record.get('edges');
    const edges: GroundedEdgeEvidence[] = Array.isArray(edgesRaw)
      ? (edgesRaw as unknown[]).map((raw) => {
          const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
          return {
            candidatePhrase: typeof e.candidate_phrase === 'string' ? e.candidate_phrase : '',
            repoNarrative: typeof e.repo_narrative === 'string' ? e.repo_narrative : '',
            nodeType: typeof e.node_type === 'string' ? e.node_type : '',
            grounding: typeof e.grounding === 'string' ? e.grounding : '',
          };
        })
      : [];
    return {
      repoId: toNumber(record.get('repo_id')),
      fullName: record.get('full_name') as string,
      regions: toNumber(regionsRaw),
      edgeCount: toNumber(edgeCountRaw),
      edges,
    };
  });
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (
    v &&
    typeof v === 'object' &&
    'toNumber' in v &&
    typeof (v as { toNumber: unknown }).toNumber === 'function'
  ) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return 0;
}
