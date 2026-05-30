/**
 * writeRepoGraph.ts — ADR-045 Repo Ingestion Neo4j Write
 *
 * MERGEs a Repo and their RepoNode sub-elements into Neo4j with typed labels.
 * Sub-element types: :RepoNode:Feature, :RepoNode:TechnicalStack,
 * :RepoNode:ArchitecturalPattern, :RepoNode:PRSample
 *
 * Idempotent: running twice with the same data produces no duplicates.
 */

import type { RepoSubElement } from '../../../scripts/crawl-repos/shared/types';
import { buildNeo4jConfig, getNeo4jDriver } from './driver';
import { runWriteQuery } from './query';

export interface WriteRepoGraphInput {
  repoId: number;
  fullName?: string;
  adminStatus?: string;
  signalsVersion: string;
  subElements: Array<RepoSubElement & { embedding?: number[] | null }>;
  env: {
    NEO4J_URI?: string;
    NEO4J_USER?: string;
    NEO4J_PASSWORD?: string;
  };
}

export interface WriteRepoGraphResult {
  nodesCreated: number;
  nodesSet: number;
  relationshipsCreated: number;
}

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * MERGE repo + sub-elements into Neo4j.
 */
export async function writeRepoGraph(
  input: WriteRepoGraphInput,
): Promise<WriteRepoGraphResult> {
  const { repoId, fullName = String(repoId), adminStatus = 'unknown', signalsVersion, subElements, env } = input;

  const config = buildNeo4jConfig(env);
  if (!config) {
    console.warn('[writeRepoGraph] skipped — missing Neo4j config (NEO4J_URI or NEO4J_PASSWORD)');
    throw new Error('[writeRepoGraph] missing Neo4j config (NEO4J_URI or NEO4J_PASSWORD)');
  }

  const writeStart = Date.now();
  console.log(
    `[writeRepoGraph] starting | repoId=${repoId} | fullName=${fullName} | subElements=${subElements.length}`,
  );

  const driver = getNeo4jDriver(config);
  const now = nowEpoch();

  // Build node parameters — only nodes with embeddings are written
  const nodeParams = subElements
    .map((el) => ({
      id: `${repoId}_${el.node_type}_${el.slug}`,
      narrative_text: el.narrative_text,
      embedding: el.embedding,
      node_type: el.node_type,
      source_reference: el.source_reference ?? null,
      created_at: now,
    }))
    .filter((n) => n.embedding !== null && n.embedding !== undefined);

  // Merge the Repo root node
  await runWriteQuery(driver, `
    MERGE (r:Repo {repo_id: $repo_id})
    SET r.full_name = $full_name,
        r.admin_status = $admin_status,
        r.signals_version = $signals_version,
        r.updated_at = $updated_at
  `, {
    repo_id: repoId,
    full_name: fullName,
    admin_status: adminStatus,
    signals_version: signalsVersion,
    updated_at: now,
  });

  let totalResult: WriteRepoGraphResult = { nodesCreated: 0, nodesSet: 0, relationshipsCreated: 0 };

  // Partition by type for typed-label writes
  const features = nodeParams.filter((n) => n.node_type === 'Feature');
  const technicalStacks = nodeParams.filter((n) => n.node_type === 'TechnicalStack');
  const architecturalPatterns = nodeParams.filter((n) => n.node_type === 'ArchitecturalPattern');
  const prSamples = nodeParams.filter((n) => n.node_type === 'PRSample');
  const others = nodeParams.filter(
    (n) =>
      n.node_type !== 'Feature' &&
      n.node_type !== 'TechnicalStack' &&
      n.node_type !== 'ArchitecturalPattern' &&
      n.node_type !== 'PRSample',
  );

  // Feature nodes with :RepoNode:Feature
  if (features.length > 0) {
    const result = await runWriteQuery(driver, `
      MATCH (r:Repo {repo_id: $repo_id})
      WITH r
      UNWIND $nodes AS node
      MERGE (n:RepoNode:Feature {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.node_type = node.node_type,
          n.source_reference = node.source_reference,
          n.created_at = node.created_at
      MERGE (r)-[:HAS]->(n)
    `, {
      repo_id: repoId,
      nodes: features,
    });
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  // TechnicalStack nodes with :RepoNode:TechnicalStack
  if (technicalStacks.length > 0) {
    const result = await runWriteQuery(driver, `
      MATCH (r:Repo {repo_id: $repo_id})
      WITH r
      UNWIND $nodes AS node
      MERGE (n:RepoNode:TechnicalStack {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.node_type = node.node_type,
          n.source_reference = node.source_reference,
          n.created_at = node.created_at
      MERGE (r)-[:HAS]->(n)
    `, {
      repo_id: repoId,
      nodes: technicalStacks,
    });
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  // ArchitecturalPattern nodes with :RepoNode:ArchitecturalPattern
  if (architecturalPatterns.length > 0) {
    const result = await runWriteQuery(driver, `
      MATCH (r:Repo {repo_id: $repo_id})
      WITH r
      UNWIND $nodes AS node
      MERGE (n:RepoNode:ArchitecturalPattern {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.node_type = node.node_type,
          n.source_reference = node.source_reference,
          n.created_at = node.created_at
      MERGE (r)-[:HAS]->(n)
    `, {
      repo_id: repoId,
      nodes: architecturalPatterns,
    });
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  // PRSample nodes with :RepoNode:PRSample
  if (prSamples.length > 0) {
    const result = await runWriteQuery(driver, `
      MATCH (r:Repo {repo_id: $repo_id})
      WITH r
      UNWIND $nodes AS node
      MERGE (n:RepoNode:PRSample {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.node_type = node.node_type,
          n.source_reference = node.source_reference,
          n.created_at = node.created_at
      MERGE (r)-[:HAS]->(n)
    `, {
      repo_id: repoId,
      nodes: prSamples,
    });
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  // All other node types with plain :RepoNode
  if (others.length > 0) {
    const result = await runWriteQuery(driver, `
      MATCH (r:Repo {repo_id: $repo_id})
      WITH r
      UNWIND $nodes AS node
      MERGE (n:RepoNode {id: node.id})
      SET n.narrative_text = node.narrative_text,
          n.embedding = node.embedding,
          n.node_type = node.node_type,
          n.source_reference = node.source_reference,
          n.created_at = node.created_at
      MERGE (r)-[:HAS]->(n)
    `, {
      repo_id: repoId,
      nodes: others,
    });
    totalResult.nodesCreated += result.nodesCreated;
    totalResult.nodesSet += result.nodesSet;
    totalResult.relationshipsCreated += result.relationshipsCreated;
  }

  const writeMs = Date.now() - writeStart;
  console.log(
    JSON.stringify({
      event: 'neo4j.repoWrite',
      repoId,
      features: features.length,
      technicalStacks: technicalStacks.length,
      architecturalPatterns: architecturalPatterns.length,
      prSamples: prSamples.length,
      others: others.length,
      nodesCreated: totalResult.nodesCreated,
      relationshipsCreated: totalResult.relationshipsCreated,
      durationMs: writeMs,
    }),
  );

  console.log(
    `[writeRepoGraph] complete | repoId=${repoId} | created=${totalResult.nodesCreated} nodes, ${totalResult.relationshipsCreated} rels | ${writeMs}ms`,
  );

  return totalResult;
}

/**
 * Fire-and-forget wrapper that logs but never throws.
 */
export function writeRepoGraphFireAndForget(
  input: WriteRepoGraphInput,
): void {
  writeRepoGraph(input).catch((err) => {
    console.error('[neo4j] repo write failed:', {
      repo_id: input.repoId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
