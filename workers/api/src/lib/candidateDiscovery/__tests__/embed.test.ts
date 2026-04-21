/**
 * Candidate embed helper tests.
 *
 * Stubs Ai.run and VectorizeIndex.upsert — no network calls. Exercises the
 * happy path, wrong-dim rejection, non-finite rejection, and missing-vector
 * rejection.
 */

import { describe, it, expect, vi } from 'vitest';
import { embedAndUpsertCandidate } from '../embed';

function makeStubAi(vector: number[] | null): Ai {
  return {
    run: vi.fn(async () => ({ data: vector === null ? [] : [vector] })),
  } as unknown as Ai;
}

function makeStubVectorize(): { index: VectorizeIndex; upsert: ReturnType<typeof vi.fn> } {
  const upsert = vi.fn(async () => ({ mutationId: 'm1' }));
  const index = { upsert } as unknown as VectorizeIndex;
  return { index, upsert };
}

describe('embedAndUpsertCandidate', () => {
  it('embeds and upserts with the correct id prefix', async () => {
    const vector = new Array(1024).fill(0).map((_, i) => i / 1024);
    const ai = makeStubAi(vector);
    const { index, upsert } = makeStubVectorize();

    const result = await embedAndUpsertCandidate({
      ai,
      vectorize: index,
      candidateId: 'cand-123',
      profile: 'Jane is a senior engineer…',
    });

    expect(result.vectorDim).toBe(1024);
    expect(typeof result.embeddedAt).toBe('string');
    expect(upsert).toHaveBeenCalledTimes(1);
    const firstCall = upsert.mock.calls[0]!;
    const args = firstCall[0] as Array<{ id: string; values: number[] }>;
    expect(args[0]!.id).toBe('candidate_cand-123');
    expect(args[0]!.values).toHaveLength(1024);
  });

  it('attaches metadata when provided', async () => {
    const vector = new Array(1024).fill(0);
    const ai = makeStubAi(vector);
    const { index, upsert } = makeStubVectorize();

    await embedAndUpsertCandidate({
      ai,
      vectorize: index,
      candidateId: 'c1',
      profile: 'p',
      metadata: { seniority: 'mid', primary_language: 'typescript' },
    });

    const firstCall = upsert.mock.calls[0]!;
    const args = firstCall[0] as Array<{ metadata: Record<string, string> }>;
    expect(args[0]!.metadata).toEqual({ seniority: 'mid', primary_language: 'typescript' });
  });

  it('throws when profile is empty', async () => {
    const ai = makeStubAi([1, 2, 3]);
    const { index } = makeStubVectorize();

    await expect(
      embedAndUpsertCandidate({ ai, vectorize: index, candidateId: 'c1', profile: '' }),
    ).rejects.toThrow(/empty profile/);
  });

  it('throws when embedder returns no vector', async () => {
    const ai = makeStubAi(null);
    const { index } = makeStubVectorize();

    await expect(
      embedAndUpsertCandidate({ ai, vectorize: index, candidateId: 'c1', profile: 'p' }),
    ).rejects.toThrow(/no vector/);
  });

  it('throws on wrong vector dimension', async () => {
    const ai = makeStubAi(new Array(512).fill(0));
    const { index } = makeStubVectorize();

    await expect(
      embedAndUpsertCandidate({ ai, vectorize: index, candidateId: 'c1', profile: 'p' }),
    ).rejects.toThrow(/wrong dim/);
  });

  it('throws on non-finite values', async () => {
    const bad = new Array(1024).fill(0);
    bad[0] = Number.NaN;
    const ai = makeStubAi(bad);
    const { index } = makeStubVectorize();

    await expect(
      embedAndUpsertCandidate({ ai, vectorize: index, candidateId: 'c1', profile: 'p' }),
    ).rejects.toThrow(/non-finite/);
  });
});
