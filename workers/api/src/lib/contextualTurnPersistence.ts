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

/**
 * Retry a function with exponential backoff.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[retryWithBackoff] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

export async function persistContextualTurn(
  env: Env,
  db: D1Database,
  input: PersistContextualTurnInput,
): Promise<void> {
  const { candidateId, sessionId, decomposition } = input;
  if (decomposition.statements.length === 0) return;

  let d1Success = false;
  let neo4jSuccess = false;
  let d1NodeIds: string[] = [];

  try {
    // Step 1: Embed and write to D1
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
      d1NodeIds.push(row.id);
      graphNodes.push({
        id: row.id,
        nodeType: statement.type,
        narrativeText: statement.phrase,
        embedding,
        sourceReference: sessionId,
        capturedAt,
      });
    }

    d1Success = true;
    console.log('[persistContextualTurn] D1 write succeeded:', { nodeCount: d1NodeIds.length });

    const graphEdges: ContextualGraphEdgeInput[] = decomposition.edges.flatMap((e) => {
      const fromId = e.from === 'candidate' ? 'candidate' : idMap.get(e.from);
      const toId = idMap.get(e.to);
      if (!fromId || !toId) return [];
      return [{ fromId, toId, type: e.type }];
    });

    // Step 2: Write to Neo4j with retry
    const config = buildNeo4jConfig(env);
    if (!config) {
      console.warn('[persistContextualTurn] Neo4j config missing — D1 nodes written, graph skipped.');
      // Mark D1 nodes as pending graph for backfill
      await markNodesPendingGraph(db, d1NodeIds);
      return;
    }

    try {
      const driver = getNeo4jDriver(config);

      const written = await retryWithBackoff(async () => {
        return await writeContextualTurnGraph(driver, {
          candidateId,
          nodes: graphNodes,
          edges: graphEdges,
        });
      }, 3, 1000);

      const grounded = await retryWithBackoff(async () => {
        return await materializeGroundedEdges(
          driver,
          candidateId,
          graphNodes.map((n) => n.id),
        );
      }, 3, 1000);

      neo4jSuccess = true;

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
    } catch (neo4jErr) {
      console.error('[persistContextualTurn] Neo4j write failed after retries:', {
        sessionId,
        error: neo4jErr instanceof Error ? neo4jErr.message : String(neo4jErr),
      });
      // Mark D1 nodes as pending graph for backfill
      await markNodesPendingGraph(db, d1NodeIds);
    }
  } catch (err) {
    console.error('[persistContextualTurn] failed:', {
      sessionId,
      d1Success,
      neo4jSuccess,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Mark D1 nodes as pending graph backfill.
 * This allows a backfill job to retry Neo4j writes later.
 */
async function markNodesPendingGraph(db: D1Database, nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return;
  
  try {
    const placeholders = nodeIds.map(() => '?').join(',');
    await db.prepare(
      `UPDATE candidate_nodes SET pending_graph_backfill = 1 WHERE id IN (${placeholders})`,
    )
      .bind(...nodeIds)
      .run();
    console.log('[markNodesPendingGraph] Marked nodes for backfill:', { count: nodeIds.length });
  } catch (err) {
    console.error('[markNodesPendingGraph] Failed to mark nodes:', err);
  }
}
