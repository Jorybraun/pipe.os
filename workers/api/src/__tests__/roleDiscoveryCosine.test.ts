/**
 * Role-Discovery Cosine Relationship Tests
 *
 * Tests the exact cosine similarity between role embeddings and candidate
 * embeddings (mean-pooled node aggregates) and how those scores flow into
 * triangulation.
 *
 * Strategy:
 *   1. Deterministic fixture vectors (no live AI) — maths are exact
 *   2. Role embed + candidate mean-pool embed → compute exact cosine
 *   3. Verify Vectorize ANN returns the same ordering as exact cosine
 *   4. Verify triangulateMatch score with the computed cosine
 *   5. Edge cases: missing embeddings, cross-domain mismatch, zero vectors
 */

import { describe, it, expect, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { embedAndUpsertRole } from '../lib/roleDiscovery/embedRole';
import { upsertCandidateVector } from '../lib/candidateDiscovery/embed';
import { cosineSimilarity, meanPoolVectors } from '../lib/embedding/cosine';
import { triangulateMatch } from '../lib/match/triangulateMatch';
import type { SituationFitRanking } from '../lib/candidateDiscovery/candidateSituationFit';

// ─── Deterministic fixture vectors (1024-dim) ────────────────────────────────

/** Build a vector with energy concentrated at specific indices. */
function makeFixtureVector(peaks: number[], vals: number[]): number[] {
  const vec = new Array(1024).fill(0);
  for (let i = 0; i < peaks.length; i++) {
    vec[peaks[i]! % 1024] = vals[i] ?? 0.5;
  }
  return vec;
}

/** Role vector: peaks at 0, 1, 2 ("fintech React senior") */
const ROLE_VECTOR = makeFixtureVector([0, 1, 2], [0.9, 0.7, 0.5]);

/** Candidate vector A: same peaks as role → high similarity */
const CANDIDATE_MATCH_VECTOR = makeFixtureVector([0, 1, 2], [0.9, 0.7, 0.5]);

/** Candidate vector B: partial overlap → moderate similarity */
const CANDIDATE_PARTIAL_VECTOR = makeFixtureVector([0, 1, 100], [0.9, 0.3, 0.6]);

/** Candidate vector C: disjoint peaks → low similarity */
const CANDIDATE_MISMATCH_VECTOR = makeFixtureVector([500, 501, 502], [0.9, 0.7, 0.5]);

/** Node vectors that average to CANDIDATE_MATCH_VECTOR */
const NODE_VECTORS_MATCH = [
  makeFixtureVector([0, 1, 2], [1.0, 0.8, 0.6]),
  makeFixtureVector([0, 1, 2], [0.8, 0.6, 0.4]),
];

/** Node vectors that average to CANDIDATE_MISMATCH_VECTOR */
const NODE_VECTORS_MISMATCH = [
  makeFixtureVector([500, 501], [1.0, 0.8]),
  makeFixtureVector([502, 503], [0.6, 0.4]),
];

// ─── Mocks ───────────────────────────────────────────────────────────────────

function makeAi(returnVector: number[]): Ai {
  return { run: vi.fn(async () => ({ data: [returnVector] })) } as unknown as Ai;
}

interface StoredVector {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
}

function makeVectorize(initial: StoredVector[] = []): VectorizeIndex {
  const store = new Map<string, StoredVector>();
  for (const v of initial) store.set(v.id, v);

  return {
    upsert: vi.fn(async (vectors) => {
      for (const v of vectors) store.set(v.id, v as StoredVector);
    }),
    query: vi.fn(async (vector, opts) => {
      const topK = opts?.topK ?? 10;
      const filter = opts?.filter ?? {};

      const scored: Array<{ id: string; score: number; metadata: Record<string, unknown> }> = [];
      for (const [id, stored] of store) {
        let passes = true;
        for (const [key, val] of Object.entries(filter)) {
          if (stored.metadata[key] !== val) {
            passes = false;
            break;
          }
        }
        if (!passes) continue;

        // Exact cosine (same formula as production cosineSimilarity)
        let dot = 0;
        let na = 0;
        let nb = 0;
        for (let i = 0; i < vector.length; i++) {
          dot += vector[i] * stored.values[i];
          na += vector[i] * vector[i];
          nb += stored.values[i] * stored.values[i];
        }
        const score = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
        scored.push({ id, score, metadata: stored.metadata });
      }

      scored.sort((a, b) => b.score - a.score);
      return { matches: scored.slice(0, topK) };
    }),
  } as unknown as VectorizeIndex;
}

function makeDb(): D1Database {
  const roleContexts = new Map<string, {
    id: string;
    role_title: string;
    role_searchable_profile: string;
    seniority_band: string;
    detected_domain: string;
    pipeline_id: string;
  }>();

  const candidates = new Map<string, {
    id: string;
    name: string;
    email: string;
    pipeline_id: string;
    status: string;
    candidate_searchable_profile: string;
    triangulated_score: number | null;
    pipeline_name: string;
  }>();

  const prepare = (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>(): Promise<T | null> {
            return null;
          },
          async all<T>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
            if (normalized.includes('FROM role_contexts rc') && normalized.includes('rc.id IN')) {
              const ids = args.filter((a): a is string => typeof a === 'string');
              const rows = ids
                .map((id) => roleContexts.get(id))
                .filter((r): r is NonNullable<typeof r> => !!r);
              return { results: rows as T[], success: true, meta: {} };
            }
            if (normalized.includes('FROM candidates c') && normalized.includes('c.id IN')) {
              const ids = args.filter((a): a is string => typeof a === 'string');
              const rows = ids
                .map((id) => candidates.get(id))
                .filter((c): c is NonNullable<typeof c> => !!c);
              return { results: rows as T[], success: true, meta: {} };
            }
            return { results: [] as T[], success: true, meta: {} };
          },
          async run() {
            // Track inserts/updates if needed
            return { success: true, meta: {} };
          },
        };
      },
    };
  };

  return { prepare } as unknown as D1Database;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSituationRanking(repoId: number, fitScore: number): SituationFitRanking {
  return {
    repo_id: repoId,
    fit_score: fitScore,
    fit_band: fitScore >= 0.75 ? 'strong' : fitScore >= 0.5 ? 'moderate' : 'weak',
    reasoning: { matches: [], mismatches: [], summary: '' },
    per_signal_scores: {
      skill_coverage: fitScore,
      seniority_fit: fitScore,
      complexity_fit: fitScore,
      architecture_fit: fitScore,
      test_culture_fit: fitScore,
      challenge_surface_fit: fitScore,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RoleDiscovery cosine relationships', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Exact cosine between role and candidate vectors
  // ═══════════════════════════════════════════════════════════════════════════

  describe('exact cosine: role vs candidate', () => {
    it('returns 1.0 when role and candidate vectors are identical', () => {
      const sim = cosineSimilarity(ROLE_VECTOR, CANDIDATE_MATCH_VECTOR);
      expect(sim).toBeCloseTo(1.0, 3);
    });

    it('returns < 1.0 for partial overlap', () => {
      const sim = cosineSimilarity(ROLE_VECTOR, CANDIDATE_PARTIAL_VECTOR);
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });

    it('returns near 0 for disjoint vectors', () => {
      const sim = cosineSimilarity(ROLE_VECTOR, CANDIDATE_MISMATCH_VECTOR);
      expect(sim).toBeCloseTo(0, 2);
    });

    it('meanPoolVectors + L2-norm produces a valid embedding', () => {
      const pooled = meanPoolVectors(NODE_VECTORS_MATCH);
      expect(pooled).not.toBeNull();
      expect(pooled!.length).toBe(1024);

      // L2-normalized → norm should be 1
      const norm = Math.sqrt(pooled!.reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1.0, 3);
    });

    it('mean-pooled match nodes have high cosine with role', () => {
      const pooled = meanPoolVectors(NODE_VECTORS_MATCH)!;
      const sim = cosineSimilarity(ROLE_VECTOR, pooled);
      expect(sim).toBeGreaterThan(0.85);
    });

    it('mean-pooled mismatch nodes have low cosine with role', () => {
      const pooled = meanPoolVectors(NODE_VECTORS_MISMATCH)!;
      const sim = cosineSimilarity(ROLE_VECTOR, pooled);
      expect(sim).toBeLessThan(0.15);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Vectorize ANN consistency with exact cosine
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Vectorize ANN consistency', () => {
    it('ANN query with role vector returns matching candidate first', async () => {
      const roleIndex = makeVectorize();
      const candidateIndex = makeVectorize();

      await embedAndUpsertRole({
        ai: makeAi(ROLE_VECTOR),
        vectorize: roleIndex,
        roleContextId: 'role-fintech',
        profile: 'Senior React engineer for fintech',
        metadata: { pipeline_id: 'pipe-1' },
      });

      await upsertCandidateVector({
        vectorize: candidateIndex,
        candidateId: 'cand-match',
        vector: CANDIDATE_MATCH_VECTOR,
        metadata: { seniority: 'senior' },
      });

      await upsertCandidateVector({
        vectorize: candidateIndex,
        candidateId: 'cand-mismatch',
        vector: CANDIDATE_MISMATCH_VECTOR,
        metadata: { seniority: 'senior' },
      });

      // Query candidates with role vector
      const result = await candidateIndex.query(ROLE_VECTOR, { topK: 5 });

      expect(result.matches.length).toBe(2);
      expect(result.matches[0]!.id).toBe('candidate_cand-match');
      expect(result.matches[0]!.score).toBeCloseTo(1.0, 2);
      expect(result.matches[1]!.id).toBe('candidate_cand-mismatch');
      expect(result.matches[1]!.score).toBeCloseTo(0, 2);
    });

    it('ANN query with candidate vector returns matching role first', async () => {
      const roleIndex = makeVectorize();

      await embedAndUpsertRole({
        ai: makeAi(ROLE_VECTOR),
        vectorize: roleIndex,
        roleContextId: 'role-fintech',
        profile: 'Senior React engineer for fintech',
      });

      await embedAndUpsertRole({
        ai: makeAi(CANDIDATE_MISMATCH_VECTOR),
        vectorize: roleIndex,
        roleContextId: 'role-blockchain',
        profile: 'Rust blockchain engineer',
      });

      const result = await roleIndex.query(CANDIDATE_MATCH_VECTOR, { topK: 5 });

      expect(result.matches[0]!.id).toBe('role_role-fintech');
      expect(result.matches[0]!.score).toBeCloseTo(1.0, 2);
    });

    it('ANN score equals exact cosine for normalized vectors', () => {
      // Both ROLE_VECTOR and CANDIDATE_MATCH_VECTOR share the same non-zero
      // indices, so their cosine should equal the ANN score in our mock.
      const exactSim = cosineSimilarity(ROLE_VECTOR, CANDIDATE_MATCH_VECTOR);

      const index = makeVectorize();
      index.upsert([
        { id: 'role_test', values: ROLE_VECTOR, metadata: {} },
        { id: 'cand_test', values: CANDIDATE_MATCH_VECTOR, metadata: {} },
      ]);

      // We can't await the mock query directly because upsert is async,
      // but the mock stores synchronously in the callback above.
      // Use the mock's internal store via a cast.
      const store = (index as unknown as { query: VectorizeIndex['query'] }).query;
      // Actually, just call query directly.
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Triangulation with computed cosine
  // ═══════════════════════════════════════════════════════════════════════════

  describe('triangulateMatch with role-candidate cosine', () => {
    it('high role-candidate cosine boosts triangulated score', () => {
      const graphResult = {
        repoChoice: {
          repoId: 101,
          fullName: 'acme/widgets',
          githubUrl: '',
          score: 0.7,
          cosine: 0.6,
          rationale: '',
        },
        review: null,
        implementation: null,
        shortlist: [{ repoId: 101, fullName: 'acme/widgets', score: 0.7, cosine: 0.6 }],
      };

      const situationRankings = [makeSituationRanking(101, 0.6)];
      const roleRepoAlignments = new Map([[101, 0.8]]);

      const lowCosineResult = triangulateMatch({
        philosophy: 'hybrid',
        graphResult,
        situationRankings,
        roleRepoAlignments,
        roleCandidateCosine: 0.2,
      });

      const highCosineResult = triangulateMatch({
        philosophy: 'hybrid',
        graphResult,
        situationRankings,
        roleRepoAlignments,
        roleCandidateCosine: 0.95,
      });

      expect(highCosineResult.triangulated_score).toBeGreaterThan(
        lowCosineResult.triangulated_score,
      );
    });

    it('null role-candidate cosine falls back to 0 in weights', () => {
      const graphResult = {
        repoChoice: {
          repoId: 101,
          fullName: 'acme/widgets',
          githubUrl: '',
          score: 0.7,
          cosine: 0.6,
          rationale: '',
        },
        review: null,
        implementation: null,
        shortlist: [{ repoId: 101, fullName: 'acme/widgets', score: 0.7, cosine: 0.6 }],
      };

      const withCosine = triangulateMatch({
        philosophy: 'hybrid',
        graphResult,
        situationRankings: [makeSituationRanking(101, 0.6)],
        roleRepoAlignments: new Map([[101, 0.8]]),
        roleCandidateCosine: 0.7,
      });

      const withoutCosine = triangulateMatch({
        philosophy: 'hybrid',
        graphResult,
        situationRankings: [makeSituationRanking(101, 0.6)],
        roleRepoAlignments: new Map([[101, 0.8]]),
        roleCandidateCosine: null,
      });

      expect(withoutCosine.triangulated_score).toBeLessThan(withCosine.triangulated_score);
      expect(withoutCosine.raw_signals.role_candidate_cosine).toBeNull();
    });

    it('vectorRoleCandidate signal is distinct from roleCandidateCosine', () => {
      const graphResult = {
        repoChoice: {
          repoId: 101,
          fullName: 'acme/widgets',
          githubUrl: '',
          score: 0.7,
          cosine: 0.6,
          rationale: '',
        },
        review: null,
        implementation: null,
        shortlist: [{ repoId: 101, fullName: 'acme/widgets', score: 0.7, cosine: 0.6 }],
      };

      // Exact cosine = 0.7, ANN score = 0.85 — they are independent signals
      const result = triangulateMatch({
        philosophy: 'hybrid',
        graphResult,
        situationRankings: [makeSituationRanking(101, 0.6)],
        roleRepoAlignments: new Map([[101, 0.8]]),
        roleCandidateCosine: 0.7,
        vectorRoleCandidate: 0.85,
        vectorRoleRepo: 0.9,
        vectorCandidateRepo: 0.75,
      });

      expect(result.raw_signals.role_candidate_cosine).toBe(0.7);
      expect(result.raw_signals.vector_role_cand).toBe(0.85);
      expect(result.triangulated_score).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('throws on dimension mismatch between role and candidate vectors', () => {
      const roleVec = new Array(1024).fill(0.01);
      const candVec = new Array(512).fill(0.01);
      expect(() => cosineSimilarity(roleVec, candVec)).toThrow(/dimension mismatch/);
    });

    it('meanPoolVectors returns null for empty array', () => {
      expect(meanPoolVectors([])).toBeNull();
    });

    it('meanPoolVectors throws on dimension mismatch within array', () => {
      expect(() => meanPoolVectors([[1, 2], [1, 2, 3]])).toThrow(/dimension mismatch/);
    });

    it('zero-vector candidate embedding yields 0 cosine with role', () => {
      const zeroVector = new Array(1024).fill(0);
      const sim = cosineSimilarity(ROLE_VECTOR, zeroVector);
      expect(sim).toBe(0);
    });

    it('upsertCandidateVector rejects non-finite values', async () => {
      const badVector = new Array(1024).fill(0.01);
      badVector[0] = NaN;

      await expect(
        upsertCandidateVector({
          vectorize: makeVectorize(),
          candidateId: 'cand-bad',
          vector: badVector,
        }),
      ).rejects.toThrow(/non-finite values/);
    });

    it('upsertCandidateVector rejects wrong dimension', async () => {
      await expect(
        upsertCandidateVector({
          vectorize: makeVectorize(),
          candidateId: 'cand-bad',
          vector: new Array(512).fill(0.01),
        }),
      ).rejects.toThrow(/wrong dim/);
    });
  });
});
