import { describe, it, expect } from 'vitest';
import { cosineSimilarity, parseEmbeddingJson } from '../cosine';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const a = [1, 2, 3];
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/dimension mismatch/);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('parseEmbeddingJson', () => {
  it('parses valid JSON array', () => {
    expect(parseEmbeddingJson('[0.1, 0.2, 0.3]')).toEqual([0.1, 0.2, 0.3]);
  });

  it('returns null for null input', () => {
    expect(parseEmbeddingJson(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseEmbeddingJson(undefined)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseEmbeddingJson('not json')).toBeNull();
  });

  it('returns null for non-array JSON', () => {
    expect(parseEmbeddingJson('{"a": 1}')).toBeNull();
  });

  it('returns null for array with non-finite values', () => {
    expect(parseEmbeddingJson('[1, NaN, 3]')).toBeNull();
  });
});
