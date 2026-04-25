/**
 * Exact cosine similarity between two equal-length float vectors.
 *
 * Used for dual-layer embedding: D1 stores the ground-truth vectors,
 * Vectorize provides fast ANN. When we need an exact score for a specific
 * (role, candidate) or (role, repo) pair, we load both vectors from D1
 * and compute here rather than trusting ANN approximations.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Parse a JSON embedding string safely. Returns null on any failure
 * so callers can fall back to ANN or skip the signal.
 */
export function parseEmbeddingJson(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    if (parsed.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    return parsed as number[];
  } catch {
    return null;
  }
}
