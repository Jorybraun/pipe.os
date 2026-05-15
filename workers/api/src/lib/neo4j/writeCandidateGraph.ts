/**
 * writeCandidateGraph.ts — ADR-044 Candidate Ingestion Neo4j Dual-Write
 *
 * MERGEs a Candidate and their active CandidateNode sub-elements into Neo4j.
 * Idempotent: running twice with the same data produces no duplicates.
 *
 * Uses plain Cypher (no APOC) so it works with stock Neo4j Community Edition.
 * Node type is stored as a property (`node_type`) rather than a dynamic label.
 *
 * Usage:
 *   if (env.DUAL_WRITE_NEO4J === 'true') {
 *     writeCandidateGraph({ candidateId, nodes, env }).catch(err =>
 *       console.error('[dual-write] neo4j candidate write failed:', err)
 *     );
 *   }
 */

import type { CandidateNode } from '../../types';
import { buildNeo4jConfig, getNeo4jDriver } from './driver';
import { runWriteQuery } from './query';

export interface WriteCandidateGraphInput {
  candidateId: string;
  /** Active (non-superseded) candidate nodes from D1. */
  nodes: CandidateNode[];
  env: {
    NEO4J_URI?: string;
    NEO4J_USER?: string;
    NEO4J_PASSWORD?: string;
  };
  /** Optional profile state override. Default: 'seed'. */
  profileState?: string;
}

export interface WriteCandidateGraphResult {
  nodesCreated: number;
  nodesSet: number;
  relationshipsCreated: number;
}

function parseEmbedding(embeddingJson: string | null): number[] | null {
  if (!embeddingJson) return null;
  try {
    const parsed = JSON.parse(embeddingJson) as unknown;
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
      return parsed as number[];
    }
    return null;
  } catch {
    return null;
  }
}

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * MERGE candidate + nodes into Neo4j.
 * Non-blocking helper: the caller decides sync vs fire-and-forget.
 */
export async function writeCandidateGraph(
  input: WriteCandidateGraphInput,
): Promise<WriteCandidateGraphResult> {
  const { candidateId, nodes, env, profileState = 'seed' } = input;

  const config = buildNeo4jConfig(env);
  if (!config) {
    throw new Error('[writeCandidateGraph] missing Neo4j config (NEO4J_URI or NEO4J_PASSWORD)');
  }

  const driver = getNeo4jDriver(config);
  const now = nowEpoch();

  // Build node parameters from D1 rows — only nodes with embeddings are written
  const nodeParams = nodes
    .map((n) => {
      const embedding = parseEmbedding(n.embedding_json);
      return {
        id: n.id,
        narrative_text: n.narrative_text,
        embedding,
        confidence: n.confidence ?? 0.7,
        node_type: n.node_type,
        created_at: n.captured_at ?? now,
        superseded_at: n.superseded_at,
      };
    })
    .filter((n) => n.embedding !== null);

  // Merge candidate first — ensures candidate exists even if node list is empty
  await runWriteQuery(driver, `
    MERGE (c:Candidate {candidate_id: $candidate_id})
    SET c.profile_state = $profile_state,
        c.last_engaged_at = $last_engaged_at,
        c.updated_at = $updated_at
  `, {
    candidate_id: candidateId,
    profile_state: profileState,
    last_engaged_at: now,
    updated_at: now,
  });

  // Merge nodes + relationships
  let nodeResult = { nodesCreated: 0, nodesSet: 0, relationshipsCreated: 0 };
  if (nodeParams.length > 0) {
    nodeResult = await runWriteQuery(driver, `
      MATCH (c:Candidate {candidate_id: $candidate_id})
      WITH c
      UNWIND $nodes AS node
      MERGE (n:CandidateNode {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.confidence = node.confidence,
          n.node_type = node.node_type,
          n.created_at = node.created_at,
          n.superseded_at = node.superseded_at
      MERGE (c)-[:HAS]->(n)
    `, {
      candidate_id: candidateId,
      nodes: nodeParams,
    });
  }

  console.log(
    JSON.stringify({
      event: 'neo4j.candidateWrite',
      candidateId,
      nodesIn: nodeParams.length,
      nodesCreated: nodeResult.nodesCreated,
      relationshipsCreated: nodeResult.relationshipsCreated,
    }),
  );

  return nodeResult;
}

/**
 * Fire-and-forget wrapper that logs but never throws.
 */
export function writeCandidateGraphFireAndForget(
  input: WriteCandidateGraphInput,
): void {
  writeCandidateGraph(input).catch((err) => {
    console.error('[dual-write] neo4j candidate write failed:', {
      candidate_id_hash: hashCandidateId(input.candidateId),
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

function hashCandidateId(candidateId: string): string {
  // Simple non-cryptographic hash for logging privacy
  let hash = 0;
  for (let i = 0; i < candidateId.length; i++) {
    const char = candidateId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}
