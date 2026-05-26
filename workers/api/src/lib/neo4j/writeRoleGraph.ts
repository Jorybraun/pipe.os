/**
 * writeRoleGraph.ts — ADR-046 Role Discovery Neo4j Write
 *
 * MERGEs a Role and their RoleNode sub-elements into Neo4j with typed,
 * weighted edges per the ADR-046 graph model.
 *
 * Edge semantics:
 *   - Requirement  → [:HAS_REQUIREMENT {weight}]
 *   - Dealbreaker  → [:HAS_DEALBREAKER {strength}]
 *   - Conflict     → [:HAS_CONFLICT] (plus [:BETWEEN] to affected nodes)
 *   - All others   → [:HAS]
 *
 * Idempotent: running twice with the same data produces no duplicates.
 */

import type { RoleNodeRow, RoleNodeType } from '../roleAgent/decomposeRcd';
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
 * Derive dealbreaker strength from the row.
 * Priority:
 *   1. extracted_properties_json.job_relatedness_strength
 *   2. weight === 1.0 → 'strong', weight === 0.5 → 'moderate'
 *   3. fallback → 'weak'
 */
function getDealbreakerStrength(node: RoleNodeRow): string {
  try {
    const props = JSON.parse(node.extracted_properties_json) as Record<string, unknown>;
    const strength = props['job_relatedness_strength'];
    if (strength === 'strong' || strength === 'moderate' || strength === 'weak') {
      return strength;
    }
  } catch {
    // ignore parse errors
  }
  if (node.weight === 1.0) return 'strong';
  if (node.weight === 0.5) return 'moderate';
  return 'weak';
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
    throw new Error('[writeRoleGraph] missing Neo4j config (NEO4J_URI or NEO4J_PASSWORD)');
  }

  const driver = getNeo4jDriver(config);
  const now = nowEpoch();

  // Partition nodes by type for edge-typed writes
  const requirements = nodes.filter((n) => n.node_type === 'Requirement');
  const dealbreakers = nodes.filter((n) => n.node_type === 'Dealbreaker');
  const conflicts = nodes.filter((n) => n.node_type === 'Conflict');
  const others = nodes.filter(
    (n) => n.node_type !== 'Requirement' && n.node_type !== 'Dealbreaker' && n.node_type !== 'Conflict',
  );

  // Build parameter arrays with embeddings
  const buildParams = (nodeList: typeof nodes) =>
    nodeList
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

  const reqParams = buildParams(requirements);
  const dbParams = buildParams(dealbreakers);
  const conflictParams = buildParams(conflicts);
  const otherParams = buildParams(others);

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

  // Requirements with [:HAS_REQUIREMENT {weight}]
  if (reqParams.length > 0) {
    const result = await runWriteQuery(driver, `
      MATCH (r:Role {role_context_id: $role_context_id})
      WITH r
      UNWIND $nodes AS node
      MERGE (n:RoleNode:Requirement {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.weight = node.weight,
          n.source_section = node.source_section,
          n.source_stakeholder = node.source_stakeholder,
          n.created_at = node.created_at
      MERGE (r)-[e:HAS_REQUIREMENT]->(n)
      SET e.weight = node.weight
    `, {
      role_context_id: roleContextId,
      nodes: reqParams,
    });
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  // Dealbreakers with [:HAS_DEALBREAKER {strength}]
  if (dbParams.length > 0) {
    // Add strength derived from extracted properties
    const dbParamsWithStrength = dbParams.map((n) => ({
      ...n,
      strength: getDealbreakerStrength(
        dealbreakers.find((d) => d.id === n.id)!,
      ),
    }));

    const result = await runWriteQuery(driver, `
      MATCH (r:Role {role_context_id: $role_context_id})
      WITH r
      UNWIND $nodes AS node
      MERGE (n:RoleNode:Dealbreaker {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.job_relatedness_strength = node.strength,
          n.source_section = node.source_section,
          n.source_stakeholder = node.source_stakeholder,
          n.created_at = node.created_at
      MERGE (r)-[e:HAS_DEALBREAKER]->(n)
      SET e.strength = node.strength
    `, {
      role_context_id: roleContextId,
      nodes: dbParamsWithStrength,
    });
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  // Conflicts with [:HAS_CONFLICT]
  if (conflictParams.length > 0) {
    const result = await runWriteQuery(driver, `
      MATCH (r:Role {role_context_id: $role_context_id})
      WITH r
      UNWIND $nodes AS node
      MERGE (n:RoleNode:Conflict {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.source_section = node.source_section,
          n.created_at = node.created_at
      MERGE (r)-[:HAS_CONFLICT]->(n)
    `, {
      role_context_id: roleContextId,
      nodes: conflictParams,
    });
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  // All other node types with plain [:HAS]
  if (otherParams.length > 0) {
    const result = await runWriteQuery(driver, `
      MATCH (r:Role {role_context_id: $role_context_id})
      WITH r
      UNWIND $nodes AS node
      MERGE (n:RoleNode {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.node_type = node.node_type,
          n.source_section = node.source_section,
          n.source_stakeholder = node.source_stakeholder,
          n.weight = node.weight,
          n.created_at = node.created_at
      MERGE (r)-[:HAS]->(n)
    `, {
      role_context_id: roleContextId,
      nodes: otherParams,
    });
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  console.log(
    JSON.stringify({
      event: 'neo4j.roleWrite',
      roleContextId,
      requirements: reqParams.length,
      dealbreakers: dbParams.length,
      conflicts: conflictParams.length,
      others: otherParams.length,
      nodesCreated: totalResult.nodesCreated,
      relationshipsCreated: totalResult.relationshipsCreated,
    }),
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
