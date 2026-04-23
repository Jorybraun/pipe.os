/**
 * Vector-Native Matching Edge-Case Tests
 *
 * Defensive coverage for boundary conditions, error paths, and degenerate
 * inputs across the embedding, ANN retrieval, blending, and scoring layers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { embedAndUpsertRole } from '../lib/roleDiscovery/embedRole';
import { embedAndUpsertCandidate } from '../lib/candidateDiscovery/embed';
import {
  queryVectorIndex,
  matchReposVectorNative,
  matchCandidatesVectorNative,
  matchRolesVectorNative,
} from '../lib/match/matchVectorNative';
import { matchReposForCandidate } from '../lib/match/matchReposForCandidate';
import { triangulateMatch, type MatchPhilosophy } from '../lib/match/triangulateMatch';
import { preprocessForEmbedding } from '../lib/embedding/preprocess';
import type { CandidateKeyConcepts } from '../lib/candidateDiscovery/agent';
import type { SituationFitRanking } from '../lib/candidateDiscovery/candidateSituationFit';

// Partially mock matchVectorNative so matchReposForCandidate tests can
// control the ANN path while other exports remain real.
vi.mock('../lib/match/matchVectorNative', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/match/matchVectorNative')>();
  return {
    ...actual,
    matchReposVectorNative: vi.fn(),
  };
});

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const VECTOR_1024 = new Array(1024).fill(0.01);
const VECTOR_512 = new Array(512).fill(0.01);

function makeAi(vector: number[] = VECTOR_1024): Ai {
  return { run: vi.fn(async () => ({ data: [vector] })) } as unknown as Ai;
}

function makeVectorize(
  matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> = [],
): VectorizeIndex {
  return {
    query: vi.fn(async () => ({ matches })),
    upsert: vi.fn(),
  } as unknown as VectorizeIndex;
}

function makeThrowingVectorize(): VectorizeIndex {
  return {
    query: vi.fn(async () => {
      throw new Error('vectorize exploded');
    }),
    upsert: vi.fn(),
  } as unknown as VectorizeIndex;
}

// ─── D1 stub for matchReposForCandidate tests ────────────────────────────────

interface RepoFixture {
  id: number;
  full_name: string;
  github_url: string;
  description: string | null;
  seniority_band: string;
  detected_domain: string;
  pr_quality_score: number;
  stars: number;
  primary_language: string;
  skills: string[];
}

function buildMatchReposDb(repos: RepoFixture[]): D1Database {
  const prepare = (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...args: unknown[]) {
        return {
          async first<T = unknown>(): Promise<T | null> {
            if (normalized.startsWith('SELECT pr_number, title FROM repo_sample_prs')) {
              const [repoId] = args as [number];
              const repo = repos.find((r) => r.id === repoId);
              return (repo ? { pr_number: 1, title: 'PR' } : null) as T | null;
            }
            if (normalized.startsWith('SELECT ri.issue_number, ri.title FROM repo_issues')) {
              const [repoId] = args as [number];
              const repo = repos.find((r) => r.id === repoId);
              return (repo ? { issue_number: 1, title: 'Issue' } : null) as T | null;
            }
            return null;
          },
          async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
            if (normalized.startsWith('SELECT alias, canonical_slug FROM skill_aliases')) {
              return { results: [] as T[], success: true, meta: {} };
            }
            if (normalized.startsWith('WITH scored AS')) {
              const rows = repos.map((r) => ({
                id: r.id,
                full_name: r.full_name,
                github_url: r.github_url,
                description: r.description,
                seniority_band: r.seniority_band,
                detected_domain: r.detected_domain,
                stars: r.stars,
                primary_language: r.primary_language,
                must_hits: r.skills.length,
                nice_hits: 0,
                construct_hits: 0,
                score: r.pr_quality_score,
              }));
              return { results: rows as T[], success: true, meta: {} };
            }
            if (normalized.startsWith('SELECT repo_id, skill_slug, source FROM repo_skills')) {
              return { results: [] as T[], success: true, meta: {} };
            }
            if (normalized.startsWith('SELECT repo_id, construct_slug FROM repo_constructs')) {
              return { results: [] as T[], success: true, meta: {} };
            }
            if (
              normalized.startsWith(
                'SELECT r.id, r.full_name, r.github_url, r.description, r.primary_language, r.seniority_band, r.detected_domain, r.stars, es.repo_searchable_profile FROM qualified_repos r LEFT JOIN repo_engineering_signals es ON es.repo_id = r.id WHERE r.id IN',
              )
            ) {
              const repoIds = (args as unknown[]).filter((a): a is number => typeof a === 'number');
              const rows = repos
                .filter((r) => repoIds.includes(r.id))
                .map((r) => ({
                  id: r.id,
                  full_name: r.full_name,
                  github_url: r.github_url,
                  description: r.description,
                  primary_language: r.primary_language,
                  seniority_band: r.seniority_band,
                  detected_domain: r.detected_domain,
                  stars: r.stars,
                  repo_searchable_profile: null,
                }));
              return { results: rows as T[], success: true, meta: {} };
            }
            if (
              normalized.startsWith(
                'SELECT repo_id, pr_number, pr_url, title, swe_bench_eligible, changed_file_count FROM repo_sample_prs',
              )
            ) {
              const repoIds = (args as unknown[]).filter((a): a is number => typeof a === 'number');
              const rows = repoIds.map((id) => ({
                repo_id: id,
                pr_number: 1,
                pr_url: `https://github.com/x/y/pull/1`,
                title: 'PR',
                swe_bench_eligible: 1,
                changed_file_count: 5,
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

const DEFAULT_REPOS: RepoFixture[] = [
  {
    id: 101,
    full_name: 'acme/alpha',
    github_url: 'https://github.com/acme/alpha',
    description: 'Alpha repo',
    seniority_band: 'mid',
    detected_domain: 'general',
    pr_quality_score: 0.95,
    stars: 5000,
    primary_language: 'typescript',
    skills: ['typescript', 'react'],
  },
  {
    id: 102,
    full_name: 'acme/beta',
    github_url: 'https://github.com/acme/beta',
    description: 'Beta repo',
    seniority_band: 'mid',
    detected_domain: 'general',
    pr_quality_score: 0.7,
    stars: 2500,
    primary_language: 'typescript',
    skills: ['typescript', 'react'],
  },
];

const DEFAULT_KC: CandidateKeyConcepts = {
  mustHaveSkills: ['typescript', 'react'],
  niceToHaveSkills: [],
  seniority: 'mid',
  primary_language: 'typescript',
  detected_domain: 'general',
};

// ─── D1 stub for generic hydration tests ─────────────────────────────────────

function buildHydrationDb(): D1Database {
  const prepare = (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...args: unknown[]) {
        return {
          async first<T = unknown>(): Promise<T | null> {
            return null;
          },
          async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
            if (normalized.includes('FROM role_contexts') && normalized.includes('rc.id IN')) {
              const ids = args.filter((a): a is string => typeof a === 'string');
              return {
                results: ids.map((id) => ({
                  id,
                  role_title: 'Title',
                  role_searchable_profile: 'Profile',
                  seniority_band: 'senior',
                  detected_domain: 'frontend',
                  pipeline_id: 'pipe-001',
                })) as T[],
                success: true,
                meta: {},
              };
            }
            if (normalized.includes('FROM candidates c') && normalized.includes('c.id IN')) {
              const ids = args.filter((a): a is string => typeof a === 'string');
              return {
                results: ids.map((id) => ({
                  id,
                  name: 'Alice',
                  email: 'a@example.com',
                  pipeline_id: 'pipe-001',
                  status: 'active',
                  candidate_searchable_profile: 'Profile',
                  triangulated_score: null,
                  pipeline_name: 'Default',
                })) as T[],
                success: true,
                meta: {},
              };
            }
            if (normalized.includes('FROM qualified_repos r') && normalized.includes('r.id IN')) {
              const repoIds = args.filter((a): a is number => typeof a === 'number');
              return {
                results: repoIds.map((id) => ({
                  id,
                  full_name: `repo/${id}`,
                  github_url: 'https://github.com/repo/x',
                  description: null,
                  primary_language: 'typescript',
                  seniority_band: 'mid',
                  detected_domain: 'general',
                  stars: 100,
                  repo_searchable_profile: null,
                })) as T[],
                success: true,
                meta: {},
              };
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

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Embedding edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('Embedding edge cases', () => {
  it('throws on empty profile for role embedding', async () => {
    const ai = makeAi();
    const vectorize = makeVectorize();
    await expect(
      embedAndUpsertRole({
        ai,
        vectorize,
        roleContextId: 'role-001',
        profile: '',
      }),
    ).rejects.toThrow(/empty profile/);
  });

  it('throws on whitespace-only profile for candidate embedding', async () => {
    const ai = makeAi();
    const vectorize = makeVectorize();
    await expect(
      embedAndUpsertCandidate({
        ai,
        vectorize,
        candidateId: 'cand-001',
        profile: '   \n\t  ',
      }),
    ).rejects.toThrow(/empty profile/);
  });

  it('truncates very long profile to 8192 chars before embedding', async () => {
    const ai = makeAi();
    const vectorize = makeVectorize();
    const longProfile = 'a'.repeat(10000);

    await embedAndUpsertCandidate({
      ai,
      vectorize,
      candidateId: 'cand-001',
      profile: longProfile,
    });

    const runCalls = vi.mocked(ai.run).mock.calls;
    expect(runCalls.length).toBe(1);
    const inputArg = runCalls[0]![1] as { text: string[] };
    expect(inputArg.text[0]!.length).toBeLessThanOrEqual(8192);
  });

  it('throws when embed returns non-finite values', async () => {
    const badVector = [...VECTOR_1024];
    badVector[0] = NaN;
    const ai = makeAi(badVector);
    const vectorize = makeVectorize();

    await expect(
      embedAndUpsertRole({
        ai,
        vectorize,
        roleContextId: 'role-001',
        profile: 'Valid profile text',
      }),
    ).rejects.toThrow(/non-finite values/);
  });

  it('throws when embed returns wrong vector dimension (512 instead of 1024)', async () => {
    const ai = makeAi(VECTOR_512);
    const vectorize = makeVectorize();

    await expect(
      embedAndUpsertCandidate({
        ai,
        vectorize,
        candidateId: 'cand-001',
        profile: 'Valid profile text',
      }),
    ).rejects.toThrow(/wrong dim/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. matchVectorNative edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('matchVectorNative edge cases', () => {
  const db = buildHydrationDb();

  it('throws when queryVector has wrong dimension', async () => {
    const vectorize = makeVectorize();
    await expect(
      queryVectorIndex({
        targetIndex: vectorize,
        queryVector: VECTOR_512,
        topK: 5,
      }),
    ).rejects.toThrow(/dim mismatch/);
  });

  it('throws when queryText is provided without ai binding', async () => {
    const vectorize = makeVectorize();
    await expect(
      queryVectorIndex({
        targetIndex: vectorize,
        queryText: 'frontend engineer',
        topK: 5,
      }),
    ).rejects.toThrow(/ai binding required/);
  });

  it('works with empty metadata filters object', async () => {
    const vectorize = makeVectorize([{ id: 'repo_101', score: 0.9, metadata: {} }]);
    const results = await queryVectorIndex({
      targetIndex: vectorize,
      queryVector: VECTOR_1024,
      metadataFilters: {},
      topK: 5,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('101');
  });

  it('returns empty array when index has no matches', async () => {
    const vectorize = makeVectorize([]);
    const results = await queryVectorIndex({
      targetIndex: vectorize,
      queryVector: VECTOR_1024,
      topK: 5,
    });
    expect(results).toEqual([]);
  });

  it('handles malformed IDs gracefully via stripPrefix fallback', async () => {
    const vectorize = makeVectorize([
      { id: 'malformed_101', score: 0.8, metadata: {} },
      { id: 'no-prefix', score: 0.7, metadata: {} },
    ]);
    const results = await queryVectorIndex({
      targetIndex: vectorize,
      queryVector: VECTOR_1024,
      topK: 5,
    });
    // stripPrefix falls back to returning the id as-is when no prefix matches
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe('malformed_101');
    expect(results[1]!.id).toBe('no-prefix');
  });

  it('prefers queryVector over queryText when both are provided', async () => {
    const ai = makeAi();
    const vectorize = makeVectorize([{ id: 'candidate_abc', score: 0.95, metadata: {} }]);
    const results = await queryVectorIndex({
      targetIndex: vectorize,
      queryVector: VECTOR_1024,
      queryText: 'this should be ignored',
      ai,
      topK: 5,
    });
    // If queryText were used, ai.run would have been called.
    expect(ai.run).not.toHaveBeenCalled();
    expect(results[0]!.id).toBe('abc');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. matchReposForCandidate edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('matchReposForCandidate edge cases', () => {
  beforeEach(() => {
    vi.mocked(matchReposVectorNative).mockReset().mockResolvedValue([]);
  });

  it('falls back to SQL when ai is provided but vectorize is missing', async () => {
    const db = buildMatchReposDb(DEFAULT_REPOS);
    const result = await matchReposForCandidate({
      db,
      ai: makeAi(),
      candidateProfile: 'TypeScript React engineer',
      keyConcepts: DEFAULT_KC,
    });
    expect(result.repoChoice.repoId).toBe(101);
    expect(result.repoChoice.rationale).toContain('[SQL fallback]');
  });

  it('falls back to SQL when vectorize is provided but ai is missing', async () => {
    const db = buildMatchReposDb(DEFAULT_REPOS);
    const result = await matchReposForCandidate({
      db,
      vectorize: makeVectorize(),
      candidateProfile: 'TypeScript React engineer',
      keyConcepts: DEFAULT_KC,
    });
    expect(result.repoChoice.repoId).toBe(101);
    expect(result.repoChoice.rationale).toContain('[SQL fallback]');
  });

  it('falls back to SQL when ANN throws', async () => {
    const db = buildMatchReposDb(DEFAULT_REPOS);
    const mocked = vi.mocked(matchReposVectorNative);
    mocked.mockRejectedValueOnce(new Error('ANN primary failed'));

    const result = await matchReposForCandidate({
      db,
      ai: makeAi(),
      vectorize: makeThrowingVectorize(),
      candidateProfile: 'TypeScript React engineer',
      keyConcepts: DEFAULT_KC,
    });

    expect(result.repoChoice.repoId).toBe(101);
    expect(result.repoChoice.rationale).toContain('[SQL fallback]');
  });

  it('blends with 0 cosineWeight → pure SQL score for overlapping repos', async () => {
    const mocked = vi.mocked(matchReposVectorNative);
    mocked.mockResolvedValueOnce([
      {
        id: '101',
        score: 0.99, // high ANN score — should be ignored for overlapping repo at weight 0
        metadata: {},
        fullName: 'acme/alpha',
        githubUrl: 'https://github.com/acme/alpha',
        description: null,
        primaryLanguage: 'typescript',
        seniorityBand: 'mid',
        detectedDomain: 'general',
        stars: 5000,
        repoSearchableProfile: null,
      },
    ]);

    const db = buildMatchReposDb(DEFAULT_REPOS);
    const result = await matchReposForCandidate({
      db,
      ai: makeAi(),
      vectorize: makeVectorize(),
      candidateProfile: 'p',
      keyConcepts: DEFAULT_KC,
      cosineWeight: 0,
    });

    // normalizeGraphScore(0.95) = (0.95 - 0.3) / 0.6 = 1.083 → clamped to 1
    expect(result.repoChoice.repoId).toBe(101);
    expect(result.repoChoice.score).toBe(1);
  });

  it('blends with 1.0 cosineWeight → pure ANN score for overlapping repos', async () => {
    const mocked = vi.mocked(matchReposVectorNative);
    // Give repo 101 a very high ANN score so it wins over SQL-only repo 102.
    mocked.mockResolvedValueOnce([
      {
        id: '101',
        score: 0.99,
        metadata: {},
        fullName: 'acme/alpha',
        githubUrl: 'https://github.com/acme/alpha',
        description: null,
        primaryLanguage: 'typescript',
        seniorityBand: 'mid',
        detectedDomain: 'general',
        stars: 5000,
        repoSearchableProfile: null,
      },
    ]);

    const db = buildMatchReposDb(DEFAULT_REPOS);
    const result = await matchReposForCandidate({
      db,
      ai: makeAi(),
      vectorize: makeVectorize(),
      candidateProfile: 'p',
      keyConcepts: DEFAULT_KC,
      cosineWeight: 1.0,
    });

    expect(result.repoChoice.repoId).toBe(101);
    // Overlapping repo score = annScore * 1.0 + normalizeGraphScore(graphScore) * 0 = 0.99
    expect(result.repoChoice.score).toBe(0.99);
  });

  it('falls back to SQL when all repos are disqualified (ANN returns empty)', async () => {
    const mocked = vi.mocked(matchReposVectorNative);
    mocked.mockResolvedValueOnce([]);

    const db = buildMatchReposDb(DEFAULT_REPOS);
    const result = await matchReposForCandidate({
      db,
      ai: makeAi(),
      vectorize: makeVectorize(),
      candidateProfile: 'p',
      keyConcepts: DEFAULT_KC,
    });

    expect(result.repoChoice.repoId).toBe(101);
    expect(result.repoChoice.rationale).toContain('[SQL fallback]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. triangulateMatch edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('triangulateMatch edge cases', () => {
  function makeGraphResult(
    overrides?: Partial<Parameters<typeof triangulateMatch>[0]['graphResult']>,
  ): Parameters<typeof triangulateMatch>[0]['graphResult'] {
    return {
      repoChoice: {
        repoId: 101,
        fullName: 'acme/widgets',
        githubUrl: 'https://github.com/acme/widgets',
        score: 0.7,
        cosine: 0.6,
        rationale: '',
      },
      review: null,
      implementation: null,
      shortlist: [{ repoId: 101, fullName: 'acme/widgets', score: 0.7, cosine: 0.6 }],
      ...overrides,
    } as Parameters<typeof triangulateMatch>[0]['graphResult'];
  }

  function makeSituationRanking(repoId: number, fitScore: number): SituationFitRanking {
    return {
      repo_id: repoId,
      fit_score: fitScore,
      fit_band: 'moderate',
      reasoning: { matches: [], mismatches: [], summary: '' },
      per_signal_scores: {},
    };
  }

  it('returns score 0 when all signals are null and graph score is 0', () => {
    const graphResult = makeGraphResult({
      repoChoice: { ...makeGraphResult().repoChoice, score: 0, cosine: null },
    });
    const result = triangulateMatch({
      philosophy: 'hybrid',
      graphResult,
      situationRankings: [],
      roleRepoAlignments: new Map(),
      roleCandidateCosine: null,
    });
    expect(result.triangulated_score).toBe(0);
    expect(result.dimensions.skill_coverage).toBe(0);
    expect(result.dimensions.semantic_similarity).toBe(0);
    expect(result.dimensions.situation_fit).toBe(0);
    expect(result.dimensions.role_alignment).toBe(0);
  });

  it('treats vector signal 0 as a valid signal (hasVectorSignals=true)', () => {
    // Zero vector signals still activate VECTOR_WEIGHTS because 0 !== null.
    // To isolate the effect, zero out the graph score as well.
    const graphResult = makeGraphResult({
      repoChoice: { ...makeGraphResult().repoChoice, score: 0, cosine: null },
    });
    const result = triangulateMatch({
      philosophy: 'hybrid',
      graphResult,
      situationRankings: [makeSituationRanking(101, 0)],
      roleRepoAlignments: new Map([[101, 0]]),
      roleCandidateCosine: 0,
      vectorRoleRepo: 0,
      vectorRoleCandidate: 0,
      vectorCandidateRepo: 0,
    });
    // Every weighted term is 0 → total 0
    expect(result.triangulated_score).toBe(0);
    expect(result.raw_signals.vector_role_repo).toBe(0);
    expect(result.raw_signals.vector_role_cand).toBe(0);
    expect(result.raw_signals.vector_cand_repo).toBe(0);
  });

  it('throws for unknown philosophy mode at runtime', () => {
    const graphResult = makeGraphResult();
    // Runtime callers might bypass TypeScript with a cast.
    expect(() =>
      triangulateMatch({
        philosophy: 'nonexistent' as MatchPhilosophy,
        graphResult,
        situationRankings: [makeSituationRanking(101, 0.5)],
        roleRepoAlignments: new Map([[101, 0.5]]),
        roleCandidateCosine: 0.5,
      }),
    ).toThrow();
  });

  it('clamps negative graph score to 0 in skill_coverage dimension', () => {
    const graphResult = makeGraphResult({
      repoChoice: { ...makeGraphResult().repoChoice, score: -0.5 },
    });
    const result = triangulateMatch({
      philosophy: 'hybrid',
      graphResult,
      situationRankings: [makeSituationRanking(101, 0.5)],
      roleRepoAlignments: new Map([[101, 0.5]]),
      roleCandidateCosine: 0.5,
    });
    expect(result.dimensions.skill_coverage).toBe(0);
  });

  it('clamps graph score > 0.9 to 1 in skill_coverage dimension', () => {
    const graphResult = makeGraphResult({
      repoChoice: { ...makeGraphResult().repoChoice, score: 1.5 },
    });
    const result = triangulateMatch({
      philosophy: 'hybrid',
      graphResult,
      situationRankings: [makeSituationRanking(101, 0.5)],
      roleRepoAlignments: new Map([[101, 0.5]]),
      roleCandidateCosine: 0.5,
    });
    expect(result.dimensions.skill_coverage).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. preprocessForEmbedding edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('preprocessForEmbedding edge cases', () => {
  it('throws on null text', () => {
    expect(() => preprocessForEmbedding(null as unknown as string, 'query')).toThrow(
      /text must be a non-empty string/,
    );
  });

  it('throws on undefined text', () => {
    expect(() => preprocessForEmbedding(undefined as unknown as string, 'document')).toThrow(
      /text must be a non-empty string/,
    );
  });

  it('throws on empty string', () => {
    expect(() => preprocessForEmbedding('', 'query')).toThrow(/text must be a non-empty string/);
  });

  it('throws on non-string input (number)', () => {
    expect(() => preprocessForEmbedding(123 as unknown as string, 'query')).toThrow(
      /text must be a non-empty string/,
    );
  });

  it('throws on non-string input (object)', () => {
    expect(() => preprocessForEmbedding({} as unknown as string, 'document')).toThrow(
      /text must be a non-empty string/,
    );
  });

  it('applies BGE query prefix on query side', () => {
    const result = preprocessForEmbedding('React engineer', 'query');
    expect(result.startsWith('Represent this sentence for searching relevant passages: ')).toBe(true);
    expect(result).toContain('React engineer');
  });

  it('does not apply prefix on document side', () => {
    const result = preprocessForEmbedding('React engineer', 'document');
    expect(result).toBe('React engineer');
  });

  it('collapses whitespace and trims before prefixing', () => {
    const result = preprocessForEmbedding('  React    engineer  \n  with TypeScript  ', 'query');
    expect(result).toBe(
      'Represent this sentence for searching relevant passages: React engineer with TypeScript',
    );
  });
});
