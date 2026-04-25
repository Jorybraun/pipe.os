/**
 * Vector-Native Matching E2E Test
 *
 * Exercises the full pipeline end-to-end with mocked AI + Vectorize bindings
 * and an in-memory D1 stub that simulates real role/candidate/repo data.
 *
 * Flow tested:
 *   1. Embed a role → ROLE_INDEX
 *   2. Embed a candidate → CANDIDATE_INDEX
 *   3. Search roles by candidate vector (/search/roles)
 *   4. Search candidates by role vector (/search/candidates)
 *   5. Search repos by role vector (/search/repos)
 *   6. matchReposForCandidate with ANN primary + SQL fallback
 *   7. triangulateMatch with vector signals
 */

import { describe, it, expect, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { embedAndUpsertRole } from '../lib/roleDiscovery/embedRole';
import { embedAndUpsertCandidate } from '../lib/candidateDiscovery/embed';
import {
  matchReposVectorNative,
  matchCandidatesVectorNative,
  matchRolesVectorNative,
  queryVectorIndex,
} from '../lib/match/matchVectorNative';
import { matchReposForCandidate } from '../lib/match/matchReposForCandidate';
import { triangulateMatch, triangulateShortlist } from '../lib/match/triangulateMatch';
import type { CandidateKeyConcepts } from '../lib/candidateDiscovery/agent';
import type { SituationFitRanking } from '../lib/candidateDiscovery/candidateSituationFit';

// ─── Shared fixture vector (1024-dim, deterministic for tests) ────────────────

function makeFixtureVector(seed: number): number[] {
  const vec = new Array(1024).fill(0);
  // Embed domain identity in first 3 dimensions for deterministic "ANN" scoring
  vec[seed % 1024] = 0.9;
  vec[(seed + 1) % 1024] = 0.7;
  vec[(seed + 2) % 1024] = 0.5;
  return vec;
}

const ROLE_VECTOR = makeFixtureVector(0);
const CANDIDATE_VECTOR = makeFixtureVector(0); // same domain as role
const REPO_VECTOR = makeFixtureVector(0); // same domain
const CROSS_VECTOR = makeFixtureVector(100); // different domain

// ─── Mock AI ──────────────────────────────────────────────────────────────────

function makeAi(vectors: Record<string, number[]>): Ai {
  return {
    run: vi.fn(async (_model: string, input: { text?: string[] }) => {
      const text = input.text?.[0] ?? '';
      // Return vector based on text content heuristic
      if (text.includes('fintech') || text.includes('React')) return { data: [ROLE_VECTOR] };
      if (text.includes('blockchain') || text.includes('Rust')) return { data: [CROSS_VECTOR] };
      return { data: [CANDIDATE_VECTOR] };
    }),
  } as unknown as Ai;
}

// ─── Mock Vectorize ───────────────────────────────────────────────────────────

interface StoredVector {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
}

function makeVectorize(initial: StoredVector[] = []): VectorizeIndex {
  const store = new Map<string, StoredVector>();
  for (const v of initial) store.set(v.id, v);

  return {
    upsert: vi.fn(async (vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>) => {
      for (const v of vectors) store.set(v.id, v);
    }),
    query: vi.fn(async (vector: number[], opts?: { topK?: number; filter?: Record<string, unknown> }) => {
      const topK = opts?.topK ?? 10;
      const filter = opts?.filter ?? {};

      const scored: Array<{ id: string; score: number; metadata: Record<string, unknown> }> = [];
      for (const [id, stored] of store) {
        // Apply metadata filter
        let passes = true;
        for (const [key, val] of Object.entries(filter)) {
          if (stored.metadata[key] !== val) {
            passes = false;
            break;
          }
        }
        if (!passes) continue;

        // Cosine similarity (simplified dot product since vectors aren't normalized)
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

// ─── D1 Stub ───────────────────────────────────────────────────────────────────

interface DbFixture {
  roleContexts: Array<{
    id: string;
    role_title: string | null;
    role_searchable_profile: string | null;
    seniority_band: string | null;
    detected_domain: string | null;
    pipeline_id: string;
    embedding_json: string | null;
    updated_at: string;
  }>;
  candidates: Array<{
    id: string;
    name: string;
    email: string;
    pipeline_id: string;
  }>;
  candidateIngestion: Array<{
    candidate_id: string;
    status: string;
    candidate_searchable_profile: string | null;
    triangulated_score: number | null;
    embedding_json: string | null;
  }>;
  repos: Array<{
    id: number;
    full_name: string;
    github_url: string;
    description: string | null;
    primary_language: string;
    seniority_band: string | null;
    detected_domain: string | null;
    stars: number;
    disqualified: number;
  }>;
  repoEngineeringSignals: Array<{
    repo_id: number;
    repo_searchable_profile: string | null;
  }>;
  pipelines: Array<{
    id: string;
    owner_id: string;
    name: string;
  }>;
}

function buildStubDb(fixture: DbFixture): D1Database {
  const prepare = (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...args: unknown[]) {
        return {
          async first<T = unknown>(): Promise<T | null> {
            return null;
          },
          async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
            // role_contexts hydration for matchRolesVectorNative
            if (normalized.includes('FROM role_contexts') && normalized.includes('rc.id IN')) {
              const ids = args.filter((a): a is string => typeof a === 'string');
              const rows = fixture.roleContexts
                .filter((r) => ids.includes(r.id))
                .map((r) => ({
                  id: r.id,
                  role_title: r.role_title,
                  role_searchable_profile: r.role_searchable_profile,
                  seniority_band: r.seniority_band,
                  detected_domain: r.detected_domain,
                  pipeline_id: r.pipeline_id,
                }));
              return { results: rows as T[], success: true, meta: {} };
            }

            // candidates hydration for matchCandidatesVectorNative
            if (normalized.includes('FROM candidates c') && normalized.includes('c.id IN')) {
              const ids = args.filter((a): a is string => typeof a === 'string');
              const rows = fixture.candidates
                .filter((c) => ids.includes(c.id))
                .map((c) => {
                  const ci = fixture.candidateIngestion.find((i) => i.candidate_id === c.id);
                  const p = fixture.pipelines.find((pl) => pl.id === c.pipeline_id);
                  return {
                    id: c.id,
                    name: c.name,
                    email: c.email,
                    pipeline_id: c.pipeline_id,
                    status: ci?.status ?? 'pending',
                    candidate_searchable_profile: ci?.candidate_searchable_profile ?? null,
                    triangulated_score: ci?.triangulated_score ?? null,
                    pipeline_name: p?.name ?? 'Default',
                  };
                });
              return { results: rows as T[], success: true, meta: {} };
            }

            // repos hydration for matchReposVectorNative
            if (normalized.includes('FROM qualified_repos r') && normalized.includes('r.id IN')) {
              const repoIds = args.filter((a): a is number => typeof a === 'number');
              const rows = fixture.repos
                .filter((r) => repoIds.includes(r.id) && r.disqualified === 0)
                .map((r) => {
                  const es = fixture.repoEngineeringSignals.find((e) => e.repo_id === r.id);
                  return {
                    id: r.id,
                    full_name: r.full_name,
                    github_url: r.github_url,
                    description: r.description,
                    primary_language: r.primary_language,
                    seniority_band: r.seniority_band,
                    detected_domain: r.detected_domain,
                    stars: r.stars,
                    repo_searchable_profile: es?.repo_searchable_profile ?? null,
                  };
                });
              return { results: rows as T[], success: true, meta: {} };
            }

            // matchRepos SQL graph matcher stub
            if (normalized.startsWith('WITH scored AS')) {
              // Return all repos that match the must-have skills (simplified)
              const rows = fixture.repos
                .filter((r) => r.disqualified === 0)
                .map((r) => ({
                  id: r.id,
                  full_name: r.full_name,
                  github_url: r.github_url,
                  description: r.description,
                  seniority_band: r.seniority_band,
                  detected_domain: r.detected_domain,
                  stars: r.stars,
                  primary_language: r.primary_language,
                  must_hits: 1,
                  nice_hits: 0,
                  construct_hits: 0,
                  score: 0.7,
                }));
              return { results: rows as T[], success: true, meta: {} };
            }

            return { results: [] as T[], success: true, meta: {} };
          },
          async run() {
            return { success: true, meta: {} };
          },
        };
      },
    };
  };
  return { prepare } as unknown as D1Database;
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function buildFixtures(): DbFixture {
  return {
    roleContexts: [
      {
        id: 'role-fintech-001',
        role_title: 'Senior React Engineer',
        role_searchable_profile: 'Senior React frontend engineer for fintech. TypeScript, Next.js, trading dashboards.',
        seniority_band: 'senior',
        detected_domain: 'fintech',
        pipeline_id: 'pipe-001',
        embedding_json: null,
        updated_at: '2026-04-22T00:00:00Z',
      },
    ],
    candidates: [
      {
        id: 'cand-fintech-001',
        name: 'Alice Chen',
        email: 'alice@example.com',
        pipeline_id: 'pipe-001',
      },
    ],
    candidateIngestion: [
      {
        candidate_id: 'cand-fintech-001',
        status: 'ingested',
        candidate_searchable_profile: 'React frontend engineer with fintech experience. TypeScript, Next.js.',
        triangulated_score: null,
        embedding_json: null,
      },
    ],
    repos: [
      {
        id: 101,
        full_name: 'acme/trading-ui',
        github_url: 'https://github.com/acme/trading-ui',
        description: 'Trading dashboard UI in React',
        primary_language: 'typescript',
        seniority_band: 'senior',
        detected_domain: 'fintech',
        stars: 5000,
        disqualified: 0,
      },
      {
        id: 102,
        full_name: 'acme/rust-node',
        github_url: 'https://github.com/acme/rust-node',
        description: 'Blockchain node in Rust',
        primary_language: 'rust',
        seniority_band: 'senior',
        detected_domain: 'blockchain',
        stars: 3000,
        disqualified: 0,
      },
    ],
    repoEngineeringSignals: [
      { repo_id: 101, repo_searchable_profile: 'React TypeScript trading dashboard frontend' },
      { repo_id: 102, repo_searchable_profile: 'Rust blockchain consensus node' },
    ],
    pipelines: [
      { id: 'pipe-001', owner_id: 'user-001', name: 'Fintech Pipeline' },
    ],
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Vector-Native Matching E2E', () => {
  const fixtures = buildFixtures();
  const db = buildStubDb(fixtures);
  const ai = makeAi({});
  const roleIndex = makeVectorize();
  const candidateIndex = makeVectorize();
  const repoIndex = makeVectorize();

  it('embeds a role and upserts to ROLE_INDEX', async () => {
    const role = fixtures.roleContexts[0]!;
    const result = await embedAndUpsertRole({
      ai,
      vectorize: roleIndex,
      roleContextId: role.id,
      profile: role.role_searchable_profile!,
      metadata: { pipeline_id: role.pipeline_id, seniority_band: role.seniority_band! },
    });

    expect(result.vectorDim).toBe(1024);
    expect(result.vector).toBeDefined();
    expect(Array.isArray(result.vector)).toBe(true);

    // Verify it landed in the index
    const queryResult = await roleIndex.query(result.vector, { topK: 1 });
    expect(queryResult.matches.length).toBeGreaterThan(0);
    expect(queryResult.matches[0]!.id).toBe(`role_${role.id}`);
  });

  it('embeds a candidate and upserts to CANDIDATE_INDEX', async () => {
    const candidate = fixtures.candidateIngestion[0]!;
    const result = await embedAndUpsertCandidate({
      ai,
      vectorize: candidateIndex,
      candidateId: candidate.candidate_id,
      profile: candidate.candidate_searchable_profile!,
    });

    expect(result.vectorDim).toBe(1024);
    expect(result.vector).toBeDefined();

    const queryResult = await candidateIndex.query(result.vector, { topK: 1 });
    expect(queryResult.matches[0]!.id).toBe(`candidate_${candidate.candidate_id}`);
  });

  it('searches roles by candidate vector', async () => {
    // Seed the index
    await embedAndUpsertRole({
      ai,
      vectorize: roleIndex,
      roleContextId: fixtures.roleContexts[0]!.id,
      profile: fixtures.roleContexts[0]!.role_searchable_profile!,
    });

    const matches = await matchRolesVectorNative({
      db,
      targetIndex: roleIndex,
      queryVector: CANDIDATE_VECTOR,
      topK: 5,
    });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.id).toBe(fixtures.roleContexts[0]!.id);
  });

  it('searches candidates by role vector', async () => {
    await embedAndUpsertCandidate({
      ai,
      vectorize: candidateIndex,
      candidateId: fixtures.candidateIngestion[0]!.candidate_id,
      profile: fixtures.candidateIngestion[0]!.candidate_searchable_profile!,
    });

    const matches = await matchCandidatesVectorNative({
      db,
      targetIndex: candidateIndex,
      queryVector: ROLE_VECTOR,
      topK: 5,
      ownerId: 'user-001',
    });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.id).toBe(fixtures.candidateIngestion[0]!.candidate_id);
  });

  it('searches repos by role vector with metadata filter', async () => {
    await repoIndex.upsert([
      { id: 'repo_101', values: REPO_VECTOR, metadata: { disqualified: 0, primaryLanguage: 'typescript' } },
      { id: 'repo_102', values: CROSS_VECTOR, metadata: { disqualified: 0, primaryLanguage: 'rust' } },
    ]);

    const matches = await matchReposVectorNative({
      db,
      targetIndex: repoIndex,
      queryVector: ROLE_VECTOR,
      topK: 5,
      metadataFilters: { disqualified: 0 },
    });

    expect(matches.length).toBe(2);
    // Same-domain repo should score higher
    expect(matches[0]!.id).toBe('101');
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score);
  });

  it('matchReposForCandidate uses ANN-primary path', async () => {
    await repoIndex.upsert([
      { id: 'repo_101', values: REPO_VECTOR, metadata: { disqualified: 0, primaryLanguage: 'typescript' } },
      { id: 'repo_102', values: CROSS_VECTOR, metadata: { disqualified: 0, primaryLanguage: 'rust' } },
    ]);

    const kc: CandidateKeyConcepts = {
      mustHaveSkills: ['typescript', 'react'],
      niceToHaveSkills: [],
      seniority: 'senior',
      primary_language: 'typescript',
      detected_domain: 'fintech',
    };

    const result = await matchReposForCandidate({
      db,
      ai,
      vectorize: repoIndex,
      candidateProfile: 'React TypeScript frontend engineer with fintech experience',
      keyConcepts: kc,
      cosineWeight: 0.6,
    });

    expect(result.repoChoice.repoId).toBe(101);
    expect(result.repoChoice.cosine).not.toBeNull();
    expect(result.shortlist.length).toBeGreaterThan(0);
  });

  it('matchReposForCandidate falls back to SQL when ANN returns empty', async () => {
    const emptyIndex = makeVectorize(); // no vectors

    const kc: CandidateKeyConcepts = {
      mustHaveSkills: ['typescript', 'react'],
      niceToHaveSkills: [],
      seniority: 'senior',
      primary_language: 'typescript',
      detected_domain: 'fintech',
    };

    const result = await matchReposForCandidate({
      db,
      ai,
      vectorize: emptyIndex,
      candidateProfile: 'React TypeScript frontend engineer',
      keyConcepts: kc,
    });

    expect(result.repoChoice.repoId).toBe(101);
    expect(result.repoChoice.rationale).toContain('[SQL fallback]');
  });

  it('triangulateMatch uses legacy weights when no vector signals', () => {
    const graphResult = {
      repoChoice: { repoId: 101, fullName: 'acme/trading-ui', githubUrl: '', score: 0.7, cosine: 0.85, rationale: '' },
      review: null,
      implementation: null,
      shortlist: [{ repoId: 101, fullName: 'acme/trading-ui', score: 0.7, cosine: 0.85 }],
    };

    const situationRankings: SituationFitRanking[] = [
      { repo_id: 101, fit_score: 0.8, fit_band: 'strong', reasoning: { matches: [], mismatches: [], summary: '' }, per_signal_scores: {} },
    ];

    const result = triangulateMatch({
      philosophy: 'validate',
      graphResult,
      situationRankings,
      roleRepoAlignments: new Map([[101, 0.9]]),
      roleCandidateCosine: 0.88,
    });

    expect(result.triangulated_score).toBeGreaterThan(0);
    expect(result.raw_signals.vector_role_repo).toBeNull();
    expect(result.raw_signals.vector_role_cand).toBeNull();
    expect(result.raw_signals.vector_cand_repo).toBeNull();
  });

  it('triangulateMatch uses vector weights when vector signals provided', () => {
    const graphResult = {
      repoChoice: { repoId: 101, fullName: 'acme/trading-ui', githubUrl: '', score: 0.7, cosine: 0.85, rationale: '' },
      review: null,
      implementation: null,
      shortlist: [{ repoId: 101, fullName: 'acme/trading-ui', score: 0.7, cosine: 0.85 }],
    };

    const situationRankings: SituationFitRanking[] = [
      { repo_id: 101, fit_score: 0.8, fit_band: 'strong', reasoning: { matches: [], mismatches: [], summary: '' }, per_signal_scores: {} },
    ];

    const legacyResult = triangulateMatch({
      philosophy: 'validate',
      graphResult,
      situationRankings,
      roleRepoAlignments: new Map([[101, 0.9]]),
      roleCandidateCosine: 0.88,
    });

    const vectorResult = triangulateMatch({
      philosophy: 'validate',
      graphResult,
      situationRankings,
      roleRepoAlignments: new Map([[101, 0.9]]),
      roleCandidateCosine: 0.88,
      vectorRoleRepo: 0.92,
      vectorRoleCandidate: 0.85,
      vectorCandidateRepo: 0.90,
    });

    // Vector signals should produce a different (likely higher) score
    expect(vectorResult.triangulated_score).not.toBe(legacyResult.triangulated_score);
    expect(vectorResult.raw_signals.vector_role_repo).toBe(0.92);
    expect(vectorResult.raw_signals.vector_role_cand).toBe(0.85);
    expect(vectorResult.raw_signals.vector_cand_repo).toBe(0.90);
  });

  it('triangulateShortlist works with vector signals', () => {
    const graphResult = {
      repoChoice: { repoId: 101, fullName: 'acme/trading-ui', githubUrl: '', score: 0.7, cosine: 0.85, rationale: '' },
      review: null,
      implementation: null,
      shortlist: [
        { repoId: 101, fullName: 'acme/trading-ui', score: 0.7, cosine: 0.85 },
        { repoId: 102, fullName: 'acme/rust-node', score: 0.5, cosine: 0.3 },
      ],
    };

    const situationRankings: SituationFitRanking[] = [
      { repo_id: 101, fit_score: 0.8, fit_band: 'strong', reasoning: { matches: [], mismatches: [], summary: '' }, per_signal_scores: {} },
      { repo_id: 102, fit_score: 0.4, fit_band: 'weak', reasoning: { matches: [], mismatches: [], summary: '' }, per_signal_scores: {} },
    ];

    const results = triangulateShortlist({
      philosophy: 'hybrid',
      graphResult,
      situationRankings,
      roleRepoAlignments: new Map([[101, 0.9]]),
      roleCandidateCosine: 0.88,
      vectorRoleRepo: 0.92,
      vectorRoleCandidate: 0.85,
      vectorCandidateRepo: 0.90,
    });

    expect(results.length).toBe(2);
    expect(results[0]!.repo_id).toBe(101);
    expect(results[0]!.triangulated_score).toBeGreaterThan(results[1]!.triangulated_score);
  });
});
