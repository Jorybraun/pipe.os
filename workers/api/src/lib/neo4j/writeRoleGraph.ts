/**
 * writeRoleGraph.ts — ADR-046 Role Discovery Neo4j Write
 *
 * MERGEs a Role and its RoleNode sub-elements into Neo4j. RoleNode and HAS are
 * structural; open semantic classifications remain properties.
 *
 * Idempotent: running twice with the same data produces no duplicates.
 */

import type { RoleNodeRow } from '../roleAgent/decomposeRcd';
import { buildNeo4jConfig, getNeo4jDriver } from './driver';
import { runWriteQuery } from './query';

export interface MatchingPolicy {
  similarity_threshold: number;
  confidence_threshold: number;
  dealbreaker_threshold: number;
  evidence_cap: number;
  result_limit: number;
  match_philosophy: 'validate' | 'tailored' | 'hybrid';
  hybrid_mix_ratio: number;
}

export function resolvePolicyFromConfig(config: {
  tolerance?: string | null;
  match_philosophy?: string | null;
  hybrid_mix_ratio?: number | null;
}): MatchingPolicy {
  const toleranceMap: Record<string, { sim: number; conf: number; db: number }> = {
    strict:   { sim: 0.70, conf: 0.70, db: 0.80 },
    moderate: { sim: 0.60, conf: 0.60, db: 0.75 },
    lenient:  { sim: 0.50, conf: 0.50, db: 0.65 },
  };
  const t = toleranceMap[config.tolerance ?? 'moderate'] ?? toleranceMap['moderate']!;
  return {
    similarity_threshold: t.sim,
    confidence_threshold: t.conf,
    dealbreaker_threshold: t.db,
    evidence_cap: 3,
    result_limit: 50,
    match_philosophy: (config.match_philosophy ?? 'validate') as MatchingPolicy['match_philosophy'],
    hybrid_mix_ratio: config.hybrid_mix_ratio ?? 0.6,
  };
}

export interface WriteRoleGraphInput {
  roleContextId: string;
  pipelineId: string;
  rcdVersion: string;
  nodes: Array<RoleNodeRow & { embedding_json?: string | null }>;
  policy?: MatchingPolicy;
  env: {
    NEO4J_URI?: string;
    NEO4J_USER?: string;
    NEO4J_PASSWORD?: string;
  };
}

export interface WriteRoleGraphResult {
  nodesCreated: number;
  nodesSet: number;
  relationshipsCreated: number;
}

function parseEmbedding(embeddingJson: string | null | undefined): number[] | null {
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
 * MERGE role + sub-elements into Neo4j.
 */
export async function writeRoleGraph(
  input: WriteRoleGraphInput,
): Promise<WriteRoleGraphResult> {
  const { roleContextId, pipelineId, rcdVersion, nodes, env } = input;

  const config = buildNeo4jConfig(env);
  if (!config) {
    console.warn('[writeRoleGraph] skipped — missing Neo4j config (NEO4J_URI or NEO4J_PASSWORD)');
    throw new Error('[writeRoleGraph] missing Neo4j config (NEO4J_URI or NEO4J_PASSWORD)');
  }

  const writeStart = Date.now();
  console.log(
    `[writeRoleGraph] starting | roleContextId=${roleContextId.slice(0, 8)}… | nodes=${nodes.length}`,
  );

  const driver = getNeo4jDriver(config);
  const now = nowEpoch();

  const nodeParams = nodes
      .map((n) => {
        const embedding = parseEmbedding(n.embedding_json);
        return {
          id: n.id,
          narrative_text: n.narrative_text,
          embedding,
          node_type: n.node_type,
          source_section: n.source_section,
          source_stakeholder: n.source_stakeholder,
          weight: n.weight,
          extracted_properties_json: n.extracted_properties_json,
          created_at: now,
        };
      })
      .filter((n) => n.embedding !== null);

  const policy = input.policy ?? resolvePolicyFromConfig({});

  // Merge the Role root node with matching policy
  await runWriteQuery(driver, `
    MERGE (r:Role {role_context_id: $role_context_id})
    SET r.pipeline_id = $pipeline_id,
        r.rcd_version = $rcd_version,
        r.similarity_threshold = $similarity_threshold,
        r.confidence_threshold = $confidence_threshold,
        r.dealbreaker_threshold = $dealbreaker_threshold,
        r.evidence_cap = $evidence_cap,
        r.result_limit = $result_limit,
        r.match_philosophy = $match_philosophy,
        r.hybrid_mix_ratio = $hybrid_mix_ratio,
        r.updated_at = $updated_at
  `, {
    role_context_id: roleContextId,
    pipeline_id: pipelineId,
    rcd_version: rcdVersion,
    similarity_threshold: policy.similarity_threshold,
    confidence_threshold: policy.confidence_threshold,
    dealbreaker_threshold: policy.dealbreaker_threshold,
    evidence_cap: policy.evidence_cap,
    result_limit: policy.result_limit,
    match_philosophy: policy.match_philosophy,
    hybrid_mix_ratio: policy.hybrid_mix_ratio,
    updated_at: now,
  });

  let totalResult: WriteRoleGraphResult = { nodesCreated: 0, nodesSet: 0, relationshipsCreated: 0 };

  if (nodeParams.length > 0) {
    const result = await runWriteQuery(driver, `
      MATCH (r:Role {role_context_id: $role_context_id})
      WITH r
      UNWIND $nodes AS node
      MERGE (n:RoleNode {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.node_type = node.node_type,
          n.weight = node.weight,
          n.source_section = node.source_section,
          n.source_stakeholder = node.source_stakeholder,
          n.extracted_properties_json = node.extracted_properties_json,
          n.created_at = node.created_at
      MERGE (r)-[e:HAS]->(n)
      SET e.weight = node.weight
    `, {
      role_context_id: roleContextId,
      nodes: nodeParams,
    });
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  const writeMs = Date.now() - writeStart;
  console.log(
    JSON.stringify({
      event: 'neo4j.roleWrite',
      roleContextId,
      nodesIn: nodeParams.length,
      nodesCreated: totalResult.nodesCreated,
      relationshipsCreated: totalResult.relationshipsCreated,
      durationMs: writeMs,
    }),
  );

  console.log(
    `[writeRoleGraph] complete | roleContextId=${roleContextId.slice(0, 8)}… | created=${totalResult.nodesCreated} nodes, ${totalResult.relationshipsCreated} rels | ${writeMs}ms`,
  );

  return totalResult;
}

/**
 * Fire-and-forget wrapper that logs but never throws.
 */
export function writeRoleGraphFireAndForget(
  input: WriteRoleGraphInput,
): void {
  writeRoleGraph(input).catch((err) => {
    console.error('[dual-write] neo4j role write failed:', {
      role_context_id_hash: hashRoleId(input.roleContextId),
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

function hashRoleId(roleId: string): string {
  let hash = 0;
  for (let i = 0; i < roleId.length; i++) {
    const char = roleId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}
