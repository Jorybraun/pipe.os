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

/**
 * Mean-pool a list of equal-length vectors.
 * Returns the element-wise average, L2-normalized.
 * Used to aggregate sub-element embeddings into a candidate-level vector.
 */
export function meanPoolVectors(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0]!.length;
  if (vectors.some((v) => v.length !== dim)) {
    throw new Error(`meanPoolVectors: dimension mismatch`);
  }

  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i]! += v[i]!;
    }
  }

  const mean = sum.map((s) => s / vectors.length);

  // L2-normalize
  let norm = 0;
  for (const x of mean) norm += x * x;
  const scale = norm === 0 ? 0 : 1 / Math.sqrt(norm);
  return mean.map((x) => x * scale);
}
