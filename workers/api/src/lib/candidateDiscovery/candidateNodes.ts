import type { CandidateNode, CandidateNodeType } from '../../types';
import { preprocessForEmbedding } from '../embedding/preprocess';
import type { Driver } from 'neo4j-driver';
import { getActiveCandidateNodesFromNeo4j } from '../neo4j/candidateGraphQueries';
import {
  deterministicEntityId,
  mirrorCandidateNodeToLivingContext,
} from '../livingContext';

type CandidateNodeInput = Omit<CandidateNode, 'id' | 'created_at' | 'updated_at'>;

interface CandidateNodeSourceProperties {
  source_quote?: unknown;
  source_quote_validated?: unknown;
  source_quote_char_start?: unknown;
  source_quote_char_end?: unknown;
  source_span_id?: unknown;
}

interface ProfileSourceSpanRow {
  id: string;
  storage_key: string | null;
}

interface CandidateNodeSourceRepairRow {
  id: string;
  source_reference: string | null;
  extracted_properties_json: string | null;
}

export interface CandidateNodeSourceRepairResult {
  scanned: number;
  repaired: number;
}

export async function insertCandidateNode(
  db: D1Database,
  node: CandidateNodeInput,
  options: { mirrorLivingContext?: boolean; ingestionKeyOverride?: string } = {},
): Promise<CandidateNode> {
  const ingestionKey = options.ingestionKeyOverride ?? [
    node.candidate_id,
    node.source_type,
    node.source_reference ?? '',
    node.node_type,
    node.narrative_text,
    node.decomposition_version ?? '',
  ].join('\u0000');
  const id = await deterministicEntityId('candidate_node', ingestionKey);
  const nodeToPersist = await resolveCurrentProfileSourceSpan(db, node);

  const row = await db
    .prepare(
      `INSERT INTO candidate_nodes (
         id, candidate_id, node_type, narrative_text,
         extracted_properties_json, embedding_json, source_type,
         source_reference, captured_at, confidence,
         supersedes, superseded_at, decomposition_version, ingestion_key,
         created_at, updated_at
       ) VALUES (
         ?1, ?2, ?3, ?4,
         ?5, ?6, ?7,
         ?8, ?9, ?10,
         ?11, ?12, ?13, ?14,
         unixepoch(), unixepoch()
       )
       ON CONFLICT(id) DO UPDATE SET
         extracted_properties_json = excluded.extracted_properties_json,
         embedding_json = excluded.embedding_json,
         source_reference = excluded.source_reference,
         captured_at = excluded.captured_at,
         confidence = excluded.confidence,
         supersedes = excluded.supersedes,
         superseded_at = excluded.superseded_at,
         updated_at = unixepoch()
       RETURNING *`,
    )
    .bind(
      id,
      nodeToPersist.candidate_id,
      nodeToPersist.node_type,
      nodeToPersist.narrative_text,
      nodeToPersist.extracted_properties_json,
      nodeToPersist.embedding_json,
      nodeToPersist.source_type,
      nodeToPersist.source_reference,
      nodeToPersist.captured_at,
      nodeToPersist.confidence,
      nodeToPersist.supersedes,
      nodeToPersist.superseded_at,
      nodeToPersist.decomposition_version,
      ingestionKey,
    )
    .first<CandidateNode>();

  if (!row) {
    throw new Error(
      `[insertCandidateNode] failed to insert node for candidate ${node.candidate_id}`,
    );
  }

  if (options.mirrorLivingContext !== false) {
    try {
      await mirrorCandidateNodeToLivingContext(db, row);
    } catch (error) {
      console.error('[insertCandidateNode] living-context mirror failed:', {
        candidateId: node.candidate_id,
        nodeId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return row;
}

function parseSourceProperties(json: string | null): CandidateNodeSourceProperties | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as CandidateNodeSourceProperties;
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasExistingSourceSpanReference(
  node: CandidateNodeInput,
  properties: CandidateNodeSourceProperties,
): boolean {
  return (typeof properties.source_span_id === 'string' && properties.source_span_id.trim().length > 0)
    || (node.source_reference?.startsWith('source_span:') === true);
}

async function candidateSourceTablesReady(db: D1Database): Promise<boolean> {
  try {
    const rows = await Promise.all(['talent_pool_intakes', 'artifact_versions', 'source_spans'].map((tableName) =>
      db.prepare(
        `SELECT name
           FROM sqlite_master
          WHERE type = 'table'
            AND name = ?1`,
      ).bind(tableName).first<{ name: string }>(),
    ));
    return rows.every((row) => typeof row?.name === 'string');
  } catch {
    return false;
  }
}

async function findCurrentProfileSourceSpan(input: {
  db: D1Database;
  candidateId: string;
  charStart: number;
  charEnd: number;
  sourceQuote: string;
}): Promise<ProfileSourceSpanRow | null> {
  if (!await candidateSourceTablesReady(input.db)) return null;

  return await input.db.prepare(
    `WITH quote_bounds(candidate_id, char_start, char_end, source_quote) AS (
       SELECT ?1, ?2, ?3, ?4
     )
     SELECT ss.id, av.storage_key
       FROM quote_bounds qb
       JOIN talent_pool_intakes t ON t.candidate_id = qb.candidate_id
       JOIN artifact_versions av ON av.storage_key = t.profile_r2_key
       JOIN source_spans ss ON ss.artifact_version_id = av.id
      WHERE t.submitted_at IS NOT NULL
        AND t.profile_r2_key IS NOT NULL
        AND TRIM(t.profile_r2_key) <> ''
        AND ss.char_start <= qb.char_start
        AND ss.char_end >= qb.char_end
      ORDER BY
        CASE WHEN ss.char_start = qb.char_start AND ss.char_end = qb.char_end THEN 0 ELSE 1 END,
        CASE WHEN ss.exact_text = qb.source_quote THEN 0 ELSE 1 END,
        (ss.char_end - ss.char_start) ASC
      LIMIT 1`,
  ).bind(
    input.candidateId,
    input.charStart,
    input.charEnd,
    input.sourceQuote,
  ).first<ProfileSourceSpanRow>();
}

async function resolveCurrentProfileSourceSpan(
  db: D1Database,
  node: CandidateNodeInput,
): Promise<CandidateNodeInput> {
  if (node.source_type !== 'resume') return node;
  const properties = parseSourceProperties(node.extracted_properties_json);
  if (!properties) return node;
  if (properties.source_quote_validated !== true) return node;
  if (hasExistingSourceSpanReference(node, properties)) return node;

  const charStart = finiteNumber(properties.source_quote_char_start);
  const charEnd = finiteNumber(properties.source_quote_char_end);
  const sourceQuote = typeof properties.source_quote === 'string' ? properties.source_quote : '';
  if (charStart === null || charEnd === null || charEnd <= charStart) return node;
  const row = await findCurrentProfileSourceSpan({
    db,
    candidateId: node.candidate_id,
    charStart,
    charEnd,
    sourceQuote,
  });

  if (!row?.id) return node;

  const enrichedProperties: CandidateNodeSourceProperties = {
    ...properties,
    source_span_id: row.id,
  };
  return {
    ...node,
    source_reference: `source_span:${row.id}`,
    extracted_properties_json: JSON.stringify(enrichedProperties),
  };
}

export async function repairCandidateResumeNodeSourceRefs(
  db: D1Database,
  candidateId: string,
): Promise<CandidateNodeSourceRepairResult> {
  if (!await candidateSourceTablesReady(db)) return { scanned: 0, repaired: 0 };

  const rows = await db.prepare(
    `SELECT id, source_reference, extracted_properties_json
       FROM candidate_nodes
      WHERE candidate_id = ?1
        AND source_type = 'resume'
        AND superseded_at IS NULL
        AND json_extract(extracted_properties_json, '$.source_quote_validated') = 1
        AND COALESCE(json_extract(extracted_properties_json, '$.source_span_id'), '') = ''
        AND (
          source_reference IS NULL
          OR source_reference NOT LIKE 'source_span:%'
        )
      ORDER BY captured_at ASC, id ASC`,
  ).bind(candidateId).all<CandidateNodeSourceRepairRow>();

  let repaired = 0;
  for (const row of rows.results ?? []) {
    const properties = parseSourceProperties(row.extracted_properties_json);
    if (!properties) continue;
    if (hasExistingSourceSpanReference(
      {
        candidate_id: candidateId,
        node_type: 'Experience',
        narrative_text: '',
        extracted_properties_json: row.extracted_properties_json,
        embedding_json: null,
        source_type: 'resume',
        source_reference: row.source_reference,
        captured_at: 0,
        confidence: null,
        supersedes: null,
        superseded_at: null,
        decomposition_version: null,
      },
      properties,
    )) continue;

    const charStart = finiteNumber(properties.source_quote_char_start);
    const charEnd = finiteNumber(properties.source_quote_char_end);
    const sourceQuote = typeof properties.source_quote === 'string' ? properties.source_quote : '';
    if (charStart === null || charEnd === null || charEnd <= charStart) continue;

    const span = await findCurrentProfileSourceSpan({
      db,
      candidateId,
      charStart,
      charEnd,
      sourceQuote,
    });
    if (!span?.id) continue;

    await db.prepare(
      `UPDATE candidate_nodes
          SET source_reference = ?1,
              extracted_properties_json = ?2,
              updated_at = unixepoch()
        WHERE id = ?3
          AND candidate_id = ?4
          AND superseded_at IS NULL
          AND COALESCE(json_extract(extracted_properties_json, '$.source_span_id'), '') = ''`,
    ).bind(
      `source_span:${span.id}`,
      JSON.stringify({
        ...properties,
        source_span_id: span.id,
      }),
      row.id,
      candidateId,
    ).run();
    repaired++;
  }

  return { scanned: rows.results?.length ?? 0, repaired };
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

export async function getActiveCandidateNodesWithFallback(
  db: D1Database,
  candidateId: string,
  driver: Driver | null,
  nodeType?: CandidateNodeType,
): Promise<CandidateNode[]> {
  if (driver) {
    try {
      return await getActiveCandidateNodesFromNeo4j(driver, candidateId, nodeType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[candidateNodes] Neo4j read failed for ${candidateId}, falling back to D1:`,
        msg,
      );
    }
  }
  return getActiveCandidateNodes(db, candidateId, nodeType);
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
