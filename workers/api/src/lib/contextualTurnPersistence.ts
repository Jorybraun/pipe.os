/**
 * contextualTurnPersistence.ts — ADR-050 per-turn persistence pipeline.
 *
 * After each culture-interview answer decomposes into a contextual graph,
 * this module embeds the statement phrases, stores them as candidate_nodes
 * in D1, mirrors the typed conversation graph into Neo4j, and materializes
 * grounded SIMILAR_TO edges against the repo graph.
 *
 * Designed to run inside `executionCtx.waitUntil` — it logs failures and
 * never throws, so a persistence problem can't break the interview turn.
 */

import type { Env } from '../types';
import type { ContextualDecomposition } from './cultureContextualDecomposition';
import { contextualDecompositionVersion } from './cultureContextualDecomposition';
import { embedCandidateNodes, insertCandidateNode } from './candidateDiscovery/candidateNodes';
import { buildNeo4jConfig, getNeo4jDriver } from './neo4j/driver';
import {
  writeContextualTurnGraph,
  materializeGroundedEdges,
  type ContextualGraphNodeInput,
  type ContextualGraphEdgeInput,
} from './neo4j/contextualGraph';

export interface PersistContextualTurnInput {
  candidateId: string;
  /** Culture interview session id — stored as source_reference. */
  sessionId: string;
  decomposition: ContextualDecomposition;
}

export async function persistContextualTurn(
  env: Env,
  db: D1Database,
  input: PersistContextualTurnInput,
): Promise<void> {
  const { candidateId, sessionId, decomposition } = input;
  if (decomposition.statements.length === 0) return;

  try {
    const phrases = decomposition.statements.map((s) => s.phrase);
    const vectors = await embedCandidateNodes(
      phrases,
      env as { AI: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } },
    );

    const capturedAt = Math.floor(Date.now() / 1000);
    // Map decomposition-local ids (n1, n2, …) to the generated D1 uuids.
    const idMap = new Map<string, string>();
    const graphNodes: ContextualGraphNodeInput[] = [];

    for (let i = 0; i < decomposition.statements.length; i++) {
      const statement = decomposition.statements[i]!;
      const embedding = vectors[i]!;
      const row = await insertCandidateNode(db, {
        candidate_id: candidateId,
        node_type: statement.type,
        narrative_text: statement.phrase,
        extracted_properties_json: statement.surface
          ? JSON.stringify({ surface: statement.surface })
          : null,
        embedding_json: JSON.stringify(embedding),
        source_type: 'culture_contextual',
        source_reference: sessionId,
        captured_at: capturedAt,
        confidence: null,
        supersedes: null,
        superseded_at: null,
        decomposition_version: contextualDecompositionVersion(),
      });
      idMap.set(statement.id, row.id);
      graphNodes.push({
        id: row.id,
        nodeType: statement.type,
        narrativeText: statement.phrase,
        embedding,
        sourceReference: sessionId,
        capturedAt,
      });
    }

    const graphEdges: ContextualGraphEdgeInput[] = decomposition.edges.flatMap((e) => {
      const fromId = e.from === 'candidate' ? 'candidate' : idMap.get(e.from);
      const toId = idMap.get(e.to);
      if (!fromId || !toId) return [];
      return [{ fromId, toId, type: e.type }];
    });

    const config = buildNeo4jConfig(env);
    if (!config) {
      console.warn('[persistContextualTurn] Neo4j config missing — D1 nodes written, graph skipped.');
      return;
    }
    const driver = getNeo4jDriver(config);

    const written = await writeContextualTurnGraph(driver, {
      candidateId,
      nodes: graphNodes,
      edges: graphEdges,
    });
    const grounded = await materializeGroundedEdges(
      driver,
      candidateId,
      graphNodes.map((n) => n.id),
    );

    console.log(
      JSON.stringify({
        event: 'culture.contextualTurnPersisted',
        candidateId,
        sessionId,
        nodesWritten: written.nodesWritten,
        contextualEdgesWritten: written.edgesWritten,
        groundedEdgesWritten: grounded.edgesWritten,
      }),
    );
  } catch (err) {
    console.error('[persistContextualTurn] failed:', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
