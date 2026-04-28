/**
 * Candidate node helper tests.
 *
 * Covers supersedeCandidateNode (including self-supersede guard) and
 * embedCandidateNodes (including batching, validation, and edge cases).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  supersedeCandidateNode,
  embedCandidateNodes,
} from '../candidateNodes';

// ─── D1 stubs ────────────────────────────────────────────────────────────────

function makeStubDb(): {
  db: D1Database;
  batchCalls: { sql: string; bindings: unknown[] }[][];
} {
  const batchCalls: { sql: string; bindings: unknown[] }[][] = [];

  function prepare(sql: string): D1PreparedStatement {
    const bindings: unknown[] = [];
    const stmt = {
      bind: (...args: unknown[]) => {
        bindings.push(...args);
        return stmt;
      },
      // Expose internals so batch can capture them
      _sql: sql,
      _bindings: bindings,
    } as unknown as D1PreparedStatement;
    return stmt;
  }

  const db = {
    prepare,
    batch: vi.fn(async (statements: D1PreparedStatement[]) => {
      const call = statements.map((stmt) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = stmt as any;
        return { sql: s._sql as string, bindings: s._bindings as unknown[] };
      });
      batchCalls.push(call);
    }),
  } as unknown as D1Database;

  return { db, batchCalls };
}

// ─── AI stubs ─────────────────────────────────────────────────────────────────

function makeStubAi(
  vectors: number[][] | null,
): {
  AI: {
    run: (
      model: string,
      input: { text: string[] },
    ) => Promise<{ data?: number[][] }>;
  };
  calls: { model: string; input: { text: string[] } }[];
} {
  const calls: { model: string; input: { text: string[] } }[] = [];
  let callIndex = 0;

  const ai = {
    run: vi.fn(async (_model: string, input: { text: string[] }) => {
      calls.push({ model: _model, input });
      if (vectors === null) {
        return {};
      }
      const start = callIndex;
      const end = callIndex + input.text.length;
      callIndex = end;
      return { data: vectors.slice(start, end) };
    }),
  };

  return { AI: ai, calls };
}

function makeValidVector(): number[] {
  return new Array(1024).fill(0).map((_, i) => i / 1024);
}

// ─── supersedeCandidateNode ───────────────────────────────────────────────────

describe('supersedeCandidateNode', () => {
  it('batches the two update statements', async () => {
    const { db, batchCalls } = makeStubDb();

    await supersedeCandidateNode(db, 'old-1', 'new-1');

    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toHaveLength(2);
    expect(batchCalls[0]![0]!.sql).toContain('UPDATE candidate_nodes');
    expect(batchCalls[0]![0]!.sql).toContain('superseded_at = unixepoch()');
    expect(batchCalls[0]![0]!.bindings).toEqual(['old-1']);
    expect(batchCalls[0]![1]!.sql).toContain('supersedes = ?1');
    expect(batchCalls[0]![1]!.bindings).toEqual(['old-1', 'new-1']);
  });

  it('throws when oldId equals newId', async () => {
    const { db } = makeStubDb();

    await expect(
      supersedeCandidateNode(db, 'same-id', 'same-id'),
    ).rejects.toThrow(/Cannot supersede a node with itself/);
  });
});

// ─── embedCandidateNodes ──────────────────────────────────────────────────────

describe('embedCandidateNodes', () => {
  it('returns embeddings for multiple texts', async () => {
    const vectors = [makeValidVector(), makeValidVector()];
    const { AI, calls } = makeStubAi(vectors);

    const result = await embedCandidateNodes(['text one', 'text two'], { AI });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(vectors[0]);
    expect(result[1]).toEqual(vectors[1]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input.text).toHaveLength(2);
  });

  it('chunks into batches of 10', async () => {
    const texts = Array.from({ length: 25 }, (_, i) => `text ${i}`);
    const vectors = texts.map(() => makeValidVector());
    const { AI, calls } = makeStubAi(vectors);

    const result = await embedCandidateNodes(texts, { AI });

    expect(result).toHaveLength(25);
    expect(calls).toHaveLength(3); // 10 + 10 + 5
    expect(calls[0]!.input.text).toHaveLength(10);
    expect(calls[1]!.input.text).toHaveLength(10);
    expect(calls[2]!.input.text).toHaveLength(5);
  });

  it('returns an empty array for empty input', async () => {
    const { AI, calls } = makeStubAi([]);

    const result = await embedCandidateNodes([], { AI });

    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('throws when embedder returns no vectors', async () => {
    const { AI } = makeStubAi(null);

    await expect(
      embedCandidateNodes(['hello'], { AI }),
    ).rejects.toThrow(/returned no vectors/);
  });

  it('throws on batch length mismatch', async () => {
    const { AI } = makeStubAi([makeValidVector()]);

    await expect(
      embedCandidateNodes(['a', 'b'], { AI }),
    ).rejects.toThrow(/length mismatch/);
  });

  it('throws on wrong vector dimension', async () => {
    const { AI } = makeStubAi([new Array(512).fill(0)]);

    await expect(
      embedCandidateNodes(['hello'], { AI }),
    ).rejects.toThrow(/wrong dim/);
  });

  it('throws on non-finite values', async () => {
    const bad = makeValidVector();
    bad[0] = Number.NaN;
    const { AI } = makeStubAi([bad]);

    await expect(
      embedCandidateNodes(['hello'], { AI }),
    ).rejects.toThrow(/non-finite/);
  });
});
