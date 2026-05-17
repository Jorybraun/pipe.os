/**
 * Tests for matchRouter.ts
 *
 * Uses mocked Neo4j driver and D1 to verify:
 *   - routeMatchRead routes to D1 by default
 *   - routeMatchRead routes to Neo4j when PRIMARY_MATCH_STORE=neo4j
 *   - Neo4j fallback to D1 on error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Driver } from 'neo4j-driver';
import { routeMatchRead, matchViaD1, matchViaNeo4j } from '../matchRouter';


// ─── Mock Neo4j modules ───────────────────────────────────────────────────────

vi.mock('../../neo4j/driver', () => ({
  buildNeo4jConfig: vi.fn((env: Record<string, string>) => {
    if (env.NEO4J_URI && env.NEO4J_PASSWORD) {
      return { uri: env.NEO4J_URI, user: env.NEO4J_USER ?? 'neo4j', password: env.NEO4J_PASSWORD };
    }
    return null;
  }),
  getNeo4jDriver: vi.fn(() => mockDriver),
  createNeo4jDriver: vi.fn(() => mockDriver),
}));

vi.mock('../../neo4j/matchingQueries', () => ({
  matchCandidatesForRole: vi.fn(),
  checkDealbreakersForCandidate: vi.fn(),
}));

import {
  matchCandidatesForRole,
  checkDealbreakersForCandidate,
} from '../../neo4j/matchingQueries';

// ─── Mock Vectorize matching ──────────────────────────────────────────────────

vi.mock('../matchVectorNative', () => ({
  matchCandidatesVectorNative: vi.fn(),
}));

import { matchCandidatesVectorNative } from '../matchVectorNative';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockDriver = { close: vi.fn(async () => {}) } as unknown as Driver;

function makeD1Mock() {
  const storedRows: Record<string, unknown[]> = {};
  return {
    prepare: vi.fn((sql: string) => {
      const stmt = {
        bind: vi.fn((...params: unknown[]) => {
          return {
            first: vi.fn(async <T>() => {
              // Simple pattern matching for our test queries
              if (sql.includes('role_contexts WHERE id =')) {
                return {
                  embedding_json: JSON.stringify(Array(1024).fill(0.01)),
                } as T;
              }
              if (sql.includes('candidates c') && sql.includes('IN (')) {
                const ids = params as string[];
                return ids.map((id) => ({
                  id,
                  name: `Candidate ${id.slice(0, 4)}`,
                  email: `${id}@example.com`,
                  pipeline_id: 'pipe_1',
                  pipeline_name: 'Test Pipeline',
                  status: 'embedded',
                })) as T;
              }
              return null as T;
            }),
            all: vi.fn(async <T>() => {
              if (sql.includes('role_contexts WHERE id =')) {
                return {
                  results: [
                    { embedding_json: JSON.stringify(Array(1024).fill(0.01)) },
                  ],
                } as { results: T };
              }
              if (sql.includes('candidates c') && sql.includes('IN (')) {
                const ids = params as string[];
                return {
                  results: ids.map((id) => ({
                    id,
                    name: `Candidate ${id.slice(0, 4)}`,
                    email: `${id}@example.com`,
                    pipeline_id: 'pipe_1',
                    pipeline_name: 'Test Pipeline',
                    status: 'embedded',
                  })),
                } as { results: T };
              }
              return { results: [] } as { results: T };
            }),
          };
        }),
      };
      return stmt;
    }),
  };
}

function makeEnv(overrides: Record<string, string> = {}): Record<string, unknown> {
  return {
    NEO4J_URI: 'bolt://localhost:7687',
    NEO4J_USER: 'neo4j',
    NEO4J_PASSWORD: 'password',
    CANDIDATE_INDEX: { query: vi.fn() } as unknown as VectorizeIndex,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('routeMatchRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(matchCandidatesVectorNative).mockReset();
    vi.mocked(matchCandidatesForRole).mockReset();
    vi.mocked(checkDealbreakersForCandidate).mockReset();
  });

  it('routes to D1 when PRIMARY_MATCH_STORE is unset', async () => {
    const db = makeD1Mock() as unknown as D1Database;
    const env = makeEnv({ PRIMARY_MATCH_STORE: undefined });

    vi.mocked(matchCandidatesVectorNative).mockResolvedValue([
      {
        id: 'cand_1',
        score: 0.85,
        name: 'Alice',
        email: 'alice@example.com',
        pipelineId: 'pipe_1',
        pipelineName: 'Engineering',
        status: 'active',
        triangulatedScore: 0.78,
        searchableProfile: 'Senior full-stack dev',
        metadata: {},
      },
    ]);

    const results = await routeMatchRead({
      roleContextId: 'role_1',
      philosophy: 'validate',
      db,
      env: env as Record<string, unknown>,
    });

    expect(matchCandidatesVectorNative).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]!.candidateId).toBe('cand_1');
    expect(results[0]!.score).toBe(0.85);
  });

  it('routes to Neo4j when PRIMARY_MATCH_STORE=neo4j', async () => {
    const db = makeD1Mock() as unknown as D1Database;
    const env = makeEnv({ PRIMARY_MATCH_STORE: 'neo4j' });

    vi.mocked(matchCandidatesForRole).mockResolvedValue([
      {
        candidate_id: 'cand_1',
        overall_score: 0.92,
        requirement_matches: [
          { requirement_id: 'req_1', score: 0.9, evidence: [], weight: 1.0 },
        ],
      },
    ]);
    vi.mocked(checkDealbreakersForCandidate).mockResolvedValue([]);

    const results = await routeMatchRead({
      roleContextId: 'role_1',
      db,
      env: env as Record<string, unknown>,
    });

    expect(matchCandidatesForRole).toHaveBeenCalledWith(
      expect.anything(),
      'role_1',
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.candidateId).toBe('cand_1');
    expect(results[0]!.score).toBe(Math.tanh(0.92));
    expect(results[0]!.requirementMatches).toHaveLength(1);
  });

  it('falls back to D1 when Neo4j errors', async () => {
    const db = makeD1Mock() as unknown as D1Database;
    const env = makeEnv({ PRIMARY_MATCH_STORE: 'neo4j' });

    vi.mocked(matchCandidatesForRole).mockRejectedValue(
      new Error('Neo4j connection refused'),
    );
    vi.mocked(matchCandidatesVectorNative).mockResolvedValue([
      {
        id: 'cand_1',
        score: 0.75,
        name: 'Bob',
        email: 'bob@example.com',
        pipelineId: 'pipe_1',
        pipelineName: 'Engineering',
        status: 'active',
        triangulatedScore: 0.7,
        searchableProfile: null,
        metadata: {},
      },
    ]);

    const results = await routeMatchRead({
      roleContextId: 'role_1',
      db,
      env: env as Record<string, unknown>,
    });

    expect(matchCandidatesForRole).toHaveBeenCalled();
    expect(matchCandidatesVectorNative).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]!.candidateId).toBe('cand_1');
  });

  it('returns candidates from Neo4j path (dealbreakers filtered in Cypher)', async () => {
    const db = makeD1Mock() as unknown as D1Database;
    const env = makeEnv({ PRIMARY_MATCH_STORE: 'neo4j' });

    // Dealbreaker filtering now happens inside the Cypher query.
    // The mock simulates what the query would return after filtering.
    vi.mocked(matchCandidatesForRole).mockResolvedValue([
      {
        candidate_id: 'cand_pass',
        overall_score: 0.9,
        requirement_matches: [],
      },
    ]);

    const results = await routeMatchRead({
      roleContextId: 'role_1',
      db,
      env: env as Record<string, unknown>,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.candidateId).toBe('cand_pass');
  });
});

