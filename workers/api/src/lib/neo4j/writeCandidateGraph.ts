/**
 * writeCandidateGraph.ts — ADR-044 Candidate Ingestion Neo4j Write
 *
 * MERGEs a Candidate and their active CandidateNode sub-elements into Neo4j.
 * CandidateNode is a structural label; open semantic classifications remain
 * in node_type and extracted_properties_json.
 *
 * Idempotent: running twice with the same data produces no duplicates.
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
  /** When true, supersede existing Neo4j nodes from the same source_type before writing. Default: true. */
  supersedeSameSourceOnly?: boolean;
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

interface NodeParam {
  id: string;
  narrative_text: string;
  embedding: number[] | null;
  confidence: number;
  node_type: string;
  source_type: string;
  source_reference: string | null;
  captured_at: number;
  superseded_at: number | null;
  extracted_properties_json: string | null;
  decomposition_version: string | null;
  supersedes: string | null;
}

function buildNodeParam(node: CandidateNode): NodeParam {
  const embedding = parseEmbedding(node.embedding_json);
  return {
    id: node.id,
    narrative_text: node.narrative_text,
    embedding,
    confidence: node.confidence ?? 0.7,
    node_type: node.node_type,
    source_type: node.source_type,
    source_reference: node.source_reference,
    captured_at: node.captured_at,
    superseded_at: node.superseded_at,
    extracted_properties_json: node.extracted_properties_json,
    decomposition_version: node.decomposition_version,
    supersedes: node.supersedes,
  };
}

/**
 * MERGE candidate + nodes into Neo4j.
 * Non-blocking helper: the caller decides sync vs fire-and-forget.
 */
export async function writeCandidateGraph(
  input: WriteCandidateGraphInput,
): Promise<WriteCandidateGraphResult> {
  const { candidateId, nodes, env, profileState = 'seed', supersedeSameSourceOnly = true } = input;

  const config = buildNeo4jConfig(env);
  if (!config) {
    console.warn('[writeCandidateGraph] skipped — missing Neo4j config (NEO4J_URI or NEO4J_PASSWORD)');
    throw new Error('[writeCandidateGraph] missing Neo4j config (NEO4J_URI or NEO4J_PASSWORD)');
  }

  const writeStart = Date.now();
  console.log(
    `[writeCandidateGraph] starting | candidate=${candidateId.slice(0, 8)}… | nodes=${nodes.length} | profileState=${profileState}`,
  );

  const driver = getNeo4jDriver(config);
  const now = nowEpoch();

  // Build node parameters — only nodes with embeddings are written
  const nodeParams = nodes.map(buildNodeParam).filter((n) => n.embedding !== null);

  // Merge candidate first — ensures candidate exists even if node list is empty
  await runWriteQuery(
    driver,
    `
    MERGE (c:Candidate {candidate_id: $candidate_id})
    SET c.profile_state = $profile_state,
        c.last_engaged_at = $last_engaged_at,
        c.updated_at = $updated_at
  `,
    {
      candidate_id: candidateId,
      profile_state: profileState,
      last_engaged_at: now,
      updated_at: now,
    },
  );

  // Supersede old nodes from same source types before writing new ones
  if (supersedeSameSourceOnly && nodeParams.length > 0) {
    const sourceTypes = [...new Set(nodeParams.map((n) => n.source_type))];
    for (const sourceType of sourceTypes) {
      await runWriteQuery(
        driver,
        `
          MATCH (c:Candidate {candidate_id: $candidate_id})
          OPTIONAL MATCH (c)-[:HAS]->(n:CandidateNode)
          WHERE n.superseded_at IS NULL
            AND n.source_type = $source_type
          SET n.superseded_at = $now
        `,
        {
          candidate_id: candidateId,
          source_type: sourceType,
          now,
        },
      );
    }
  }

  let totalResult: WriteCandidateGraphResult = { nodesCreated: 0, nodesSet: 0, relationshipsCreated: 0 };

  if (nodeParams.length > 0) {
    const result = await runWriteQuery(
      driver,
      `
        MATCH (c:Candidate {candidate_id: $candidate_id})
        WITH c
        UNWIND $nodes AS node
        MERGE (n:CandidateNode {id: node.id})
        SET n.narrative_text = node.narrative_text,
            n.embedding = node.embedding,
            n.confidence = node.confidence,
            n.node_type = node.node_type,
            n.source_type = node.source_type,
            n.source_reference = node.source_reference,
            n.captured_at = node.captured_at,
            n.superseded_at = node.superseded_at,
            n.extracted_properties_json = node.extracted_properties_json,
            n.decomposition_version = node.decomposition_version,
            n.supersedes = node.supersedes,
            n.created_at = node.created_at,
            n.updated_at = node.updated_at
        MERGE (c)-[:HAS]->(n)
      `,
      {
        candidate_id: candidateId,
        nodes: nodeParams.map((n) => ({ ...n, created_at: now, updated_at: now })),
      },
    );
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  const writeMs = Date.now() - writeStart;
  console.log(
    JSON.stringify({
      event: 'neo4j.candidateWrite',
      candidateId,
      nodesIn: nodeParams.length,
      nodesCreated: totalResult.nodesCreated,
      relationshipsCreated: totalResult.relationshipsCreated,
      durationMs: writeMs,
    }),
  );

  console.log(
    `[writeCandidateGraph] complete | candidate=${candidateId.slice(0, 8)}… | created=${totalResult.nodesCreated} nodes, ${totalResult.relationshipsCreated} rels | ${writeMs}ms`,
  );

  return totalResult;
}

/**
 * Fire-and-forget wrapper that logs but never throws.
 */
export function writeCandidateGraphFireAndForget(input: WriteCandidateGraphInput): void {
  writeCandidateGraph(input).catch((err) => {
    console.error('[writeCandidateGraph] neo4j candidate write failed:', {
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
