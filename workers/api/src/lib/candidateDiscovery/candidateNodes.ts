import type { CandidateNode, CandidateNodeType } from '../../types';
import { preprocessForEmbedding } from '../embedding/preprocess';

export async function insertCandidateNode(
  db: D1Database,
  node: Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'>,
): Promise<CandidateNode> {
  const id = crypto.randomUUID();

  const row = await db
    .prepare(
      `INSERT INTO candidate_nodes (
         id, candidate_id, node_type, narrative_text,
         extracted_properties_json, embedding_json, source_type,
         source_reference, captured_at, confidence,
         supersedes, superseded_at, decomposition_version,
         created_at, updated_at
       ) VALUES (
         ?1, ?2, ?3, ?4,
         ?5, ?6, ?7,
         ?8, ?9, ?10,
         ?11, ?12, ?13,
         unixepoch(), unixepoch()
       ) RETURNING *`,
    )
    .bind(
      id,
      node.candidate_id,
      node.node_type,
      node.narrative_text,
      node.extracted_properties_json,
      node.embedding_json,
      node.source_type,
      node.source_reference,
      node.captured_at,
      node.confidence,
      node.supersedes,
      node.superseded_at,
      node.decomposition_version,
    )
    .first<CandidateNode>();

  if (!row) {
    throw new Error(
      `[insertCandidateNode] failed to insert node for candidate ${node.candidate_id}`,
    );
  }

  return row;
}

export async function getActiveCandidateNodes(
  db: D1Database,
  candidateId: string,
  nodeType?: CandidateNodeType,
): Promise<CandidateNode[]> {
  const result = nodeType
    ? await db
        .prepare(
          `SELECT * FROM candidate_nodes
           WHERE candidate_id = ?1 AND superseded_at IS NULL AND node_type = ?2
           ORDER BY captured_at DESC`,
        )
        .bind(candidateId, nodeType)
        .all<CandidateNode>()
    : await db
        .prepare(
          `SELECT * FROM candidate_nodes
           WHERE candidate_id = ?1 AND superseded_at IS NULL
           ORDER BY captured_at DESC`,
        )
        .bind(candidateId)
        .all<CandidateNode>();

  return result.results ?? [];
}

export async function getActiveCandidateNodeSummaries(
  db: D1Database,
  candidateId: string,
  limit = 10,
): Promise<
  Array<{
    id: string;
    node_type: CandidateNodeType;
    narrative_text: string;
    captured_at: number;
  }>
> {
  const result = await db
    .prepare(
      `SELECT id, node_type, narrative_text, captured_at
       FROM candidate_nodes
       WHERE candidate_id = ?1 AND superseded_at IS NULL
       ORDER BY captured_at DESC
       LIMIT ?2`,
    )
    .bind(candidateId, limit)
    .all<{
      id: string;
      node_type: CandidateNodeType;
      narrative_text: string;
      captured_at: number;
    }>();

  return result.results ?? [];
}

export async function supersedeCandidateNode(
  db: D1Database,
  oldId: string,
  newId: string,
): Promise<void> {
  if (oldId === newId) {
    throw new Error('Cannot supersede a node with itself');
  }

  await db.batch([
    db
      .prepare(
        `UPDATE candidate_nodes SET superseded_at = unixepoch() WHERE id = ?1`,
      )
      .bind(oldId),
    db
      .prepare(
        `UPDATE candidate_nodes SET supersedes = ?1 WHERE id = ?2`,
      )
      .bind(oldId, newId),
  ]);
}

export async function embedCandidateNode(
  text: string,
  env: {
    AI: {
      run: (
        model: string,
        input: { text: string[] },
      ) => Promise<{ data?: number[][] }>;
    };
  },
): Promise<number[]> {
  const vectors = await embedCandidateNodes([text], env);
  return vectors[0]!;
}

const BATCH_SIZE = 10;
const EXPECTED_DIM = 1024;

/**
 * Batch-embed multiple candidate node texts.
 *
 * Chunks inputs into batches of 10 to minimise round-trips to the BGE model.
 * Each text is preprocessed before embedding. Throws if any batch returns
 * malformed vectors (wrong dimension, missing, or non-finite values).
 */
export async function embedCandidateNodes(
  texts: string[],
  env: {
    AI: {
      run: (
        model: string,
        input: { text: string[] },
      ) => Promise<{ data?: number[][] }>;
    };
  },
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const preprocessed = texts.map((t) => preprocessForEmbedding(t, 'document'));
  const vectors: number[][] = [];

  for (let i = 0; i < preprocessed.length; i += BATCH_SIZE) {
    const batch = preprocessed.slice(i, i + BATCH_SIZE);
    const embedResult = await env.AI.run('@cf/baai/bge-large-en-v1.5', {
      text: batch,
    });

    const batchVectors = embedResult?.data;
    if (!batchVectors || !Array.isArray(batchVectors)) {
      throw new Error(
        `[embedCandidateNodes] batch ${i / BATCH_SIZE} returned no vectors; shape=${JSON.stringify(embedResult).slice(0, 300)}`,
      );
    }

    if (batchVectors.length !== batch.length) {
      throw new Error(
        `[embedCandidateNodes] batch ${i / BATCH_SIZE} length mismatch: expected ${batch.length}, got ${batchVectors.length}`,
      );
    }

    for (const vector of batchVectors) {
      if (!vector || !Array.isArray(vector)) {
        throw new Error(
          `[embedCandidateNodes] batch ${i / BATCH_SIZE} contained a missing vector`,
        );
      }

      if (vector.length !== EXPECTED_DIM) {
        throw new Error(
          `[embedCandidateNodes] wrong dim: got ${vector.length}, expected ${EXPECTED_DIM}`,
        );
      }

      if (vector.some((n) => !Number.isFinite(n))) {
        throw new Error(`[embedCandidateNodes] non-finite values in vector`);
      }
    }

    vectors.push(...batchVectors);
  }

  return vectors;
}
