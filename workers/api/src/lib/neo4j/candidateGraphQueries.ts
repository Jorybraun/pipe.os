/**
 * Neo4j candidate graph read queries — ADR-044 Phase 5
 *
 * Provides Neo4j equivalents for D1 candidate_nodes readers.
 * All functions fall back to D1 when Neo4j is unavailable.
 */

import type { Driver, Record as Neo4jRecord } from 'neo4j-driver';
import type { CandidateNode, CandidateNodeType, CoverageResult } from '../../types';
import { runReadQuery } from './query';
import { computeCandidateCoverage } from '../candidateDiscovery/candidateCoverage';

function neo4jNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return null;
}

function recordToCandidateNode(record: Neo4jRecord, candidateId: string): CandidateNode {
  const embedding = record.get('embedding');
  const capturedAt = neo4jNumber(record.get('captured_at'));
  const createdAt = neo4jNumber(record.get('created_at'));
  const updatedAt = neo4jNumber(record.get('updated_at'));
  const confidence = neo4jNumber(record.get('confidence'));
  const supersededAt = neo4jNumber(record.get('superseded_at'));

  return {
    id: (record.get('id') as string) ?? '',
    candidate_id: candidateId,
    node_type: String(record.get('node_type') ?? ''),
    narrative_text: (record.get('narrative_text') as string) ?? '',
    extracted_properties_json: (record.get('extracted_properties_json') as string | null) ?? null,
    embedding_json: Array.isArray(embedding) ? JSON.stringify(embedding) : null,
    source_type: (record.get('source_type') as string) ?? '',
    source_reference: (record.get('source_reference') as string | null) ?? null,
    captured_at: capturedAt ?? 0,
    confidence: confidence ?? null,
    supersedes: (record.get('supersedes') as string | null) ?? null,
    superseded_at: supersededAt ?? null,
    decomposition_version: (record.get('decomposition_version') as string | null) ?? null,
    created_at: createdAt ?? 0,
    updated_at: updatedAt ?? 0,
  };
}

export async function getActiveCandidateNodesFromNeo4j(
  driver: Driver,
  candidateId: string,
  nodeType?: CandidateNodeType,
): Promise<CandidateNode[]> {
  return runReadQuery(
    driver,
    `
    MATCH (c:Candidate {candidate_id: $candidate_id})-[:HAS]->(n:CandidateNode)
    WHERE n.superseded_at IS NULL
      AND ($node_type IS NULL OR n.node_type = $node_type)
    RETURN
      n.id AS id,
      n.node_type AS node_type,
      n.narrative_text AS narrative_text,
      n.extracted_properties_json AS extracted_properties_json,
      n.embedding AS embedding,
      n.source_type AS source_type,
      n.source_reference AS source_reference,
      n.captured_at AS captured_at,
      n.confidence AS confidence,
      n.supersedes AS supersedes,
      n.superseded_at AS superseded_at,
      n.decomposition_version AS decomposition_version,
      n.created_at AS created_at,
      n.updated_at AS updated_at
    ORDER BY n.captured_at DESC
    `,
    { candidate_id: candidateId, node_type: nodeType ?? null },
    (record) => recordToCandidateNode(record, candidateId),
  );
}

export async function computeCandidateCoverageWithFallback(
  db: D1Database,
  candidateId: string,
  _driver: Driver | null,
): Promise<CoverageResult> {
  // Coverage depends on living-context assertions, concepts, and evidence.
  // D1 is authoritative; Neo4j is only a rebuildable graph projection.
  return computeCandidateCoverage(db, candidateId);
}

export async function candidateHasNodesFromSourceType(
  driver: Driver,
  candidateId: string,
  sourceType: string,
): Promise<boolean> {
  const results = await runReadQuery(
    driver,
    `
    MATCH (c:Candidate {candidate_id: $candidate_id})-[:HAS]->(n:CandidateNode)
    WHERE n.superseded_at IS NULL AND n.source_type = $source_type
    RETURN count(n) AS cnt
    `,
    { candidate_id: candidateId, source_type: sourceType },
    (record) => {
      const cnt = record.get('cnt');
      return typeof cnt === 'number'
        ? cnt
        : typeof (cnt as { toNumber?: () => number }).toNumber === 'function'
          ? (cnt as { toNumber: () => number }).toNumber()
          : 0;
    },
  );
  return results[0]! > 0;
}

export async function sessionHasNodesFromSourceType(
  driver: Driver,
  sourceReference: string,
  sourceType: string,
): Promise<boolean> {
  const results = await runReadQuery(
    driver,
    `
    MATCH (c:Candidate)-[:HAS]->(n:CandidateNode)
    WHERE n.superseded_at IS NULL
      AND n.source_type = $source_type
      AND n.source_reference = $source_reference
    RETURN count(n) AS cnt
    `,
    { source_reference: sourceReference, source_type: sourceType },
    (record) => {
      const cnt = record.get('cnt');
      return typeof cnt === 'number'
        ? cnt
        : typeof (cnt as { toNumber?: () => number }).toNumber === 'function'
          ? (cnt as { toNumber: () => number }).toNumber()
          : 0;
    },
  );
  return results[0]! > 0;
}
