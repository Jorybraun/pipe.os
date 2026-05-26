/**
 * Locked preprocessing pipeline for BGE-large-en-v1.5 embeddings.
 *
 * BGE uses asymmetric indexing:
 *   - Document side (what gets indexed): plain text, no prefix
 *   - Query side (what searches the index):
 *     "Represent this sentence for searching relevant passages: " + text
 *
 * All entity types (repo, candidate, role) are indexed as DOCUMENTS.
 * The query prefix is applied only at query time (matchReposForCandidate,
 * search routes, matchVectorNative).
 *
 * Guardrail: every embedding call MUST go through this function.
 * Never embed raw text directly. Never apply the query prefix at index time.
 */

export type EmbeddingSide = 'document' | 'query';

const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const MAX_CHARS = 8192; // BGE-large-en-v1.5 effective limit (way below token limit)

export const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';
export const EMBEDDING_MODEL_VERSION = 'bge-large-en-v1.5-2024';

/**
 * Preprocess text for BGE embedding.
 *
 * @param text      Raw input text (profile, narrative, description)
 * @param side      'document' for indexing, 'query' for searching
 * @returns         Normalized text ready for embedding
 */
export function preprocessForEmbedding(text: string, side: EmbeddingSide): string {
  if (!text || typeof text !== 'string') {
    throw new Error('[preprocessForEmbedding] text must be a non-empty string');
  }

  // Normalize whitespace: collapse multiple spaces/newlines to single space
  let normalized = text.replace(/\s+/g, ' ').trim();

  // Truncate to max chars (approximate token guardrail)
  if (normalized.length > MAX_CHARS) {
    normalized = normalized.slice(0, MAX_CHARS);
  }

  // Apply query prefix only for query-side embeddings
  if (side === 'query') {
    return BGE_QUERY_PREFIX + normalized;
  }

  return normalized;
}
