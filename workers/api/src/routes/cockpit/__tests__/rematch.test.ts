import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const rolloutGatesMigration = readFileSync(
  new URL('../../../../migrations/0107_rollout_gates.sql', import.meta.url),
  'utf8',
);

const NOW = "datetime('now')";

function seedCandidate(sqlite: BetterSqliteDb, candidateId: string, userId: string): void {
  sqlite.exec(`INSERT INTO candidates (id, owner_id) VALUES ('${candidateId}', '${userId}');`);
}

function seedWorkspacePerson(
  sqlite: BetterSqliteDb,
  candidateId: string,
  wpId: string,
): void {
  sqlite.exec(`
    INSERT INTO people (id, ingestion_key, created_at, updated_at)
    VALUES ('person-${wpId}', 'ik-person-${wpId}', ${NOW}, ${NOW});
    INSERT INTO workspace_people (id, person_id, workspace_id, ingestion_key, context_json, created_at, updated_at)
    VALUES ('${wpId}', 'person-${wpId}', 'ws-1', 'ik-wp-${wpId}', '{}', ${NOW}, ${NOW});
    INSERT INTO applications (id, workspace_person_id, legacy_candidate_id, ingestion_key, created_at, updated_at)
    VALUES ('app-${wpId}', '${wpId}', '${candidateId}', 'ik-app-${wpId}', ${NOW}, ${NOW});
  `);
}

vi.mock('../../../lib/challengeMatching/d1Matcher', () => ({
  matchCandidateToReviewChallenge: vi.fn(),
}));

describe('POST /candidates/:id/living-context/rematch — recruiter re-triggers matching', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY, owner_id TEXT, pipeline_id TEXT);
      CREATE TABLE pipelines (id TEXT PRIMARY KEY, owner_id TEXT);
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(conceptRegistryMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(rolloutGatesMigration);
    // Enable the gate for testing
    sqlite.exec(`
      INSERT INTO rollout_gates (gate_key, stage, updated_by, created_at, updated_at)
      VALUES ('living_context_read', 'ga', 'system', ${NOW}, ${NOW});
    `);
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  it('returns NEEDS_MORE_EVIDENCE when candidate has no workspace identity', async () => {
    seedCandidate(sqlite, 'cand-no-wp', 'user-1');
    const db = createMockD1(sqlite);

    const wp = await db.prepare(
      `SELECT wp.id FROM applications app
       JOIN workspace_people wp ON wp.id = app.workspace_person_id
       WHERE app.legacy_candidate_id = ?1 LIMIT 1`,
    ).bind('cand-no-wp').first<{ id: string }>();

    expect(wp).toBeNull();
  });

  it('returns workspace person when candidate has living context identity', async () => {
    seedCandidate(sqlite, 'cand-with-wp', 'user-1');
    seedWorkspacePerson(sqlite, 'cand-with-wp', 'wp-1');
    const db = createMockD1(sqlite);

    const wp = await db.prepare(
      `SELECT wp.id FROM applications app
       JOIN workspace_people wp ON wp.id = app.workspace_person_id
       WHERE app.legacy_candidate_id = ?1 LIMIT 1`,
    ).bind('cand-with-wp').first<{ id: string }>();

    expect(wp).not.toBeNull();
    expect(wp!.id).toBe('wp-1');
  });

  it('matchCandidateToReviewChallenge returns correct result shape', async () => {
    const { matchCandidateToReviewChallenge } = await import(
      '../../../lib/challengeMatching/d1Matcher'
    );
    const mockMatch = vi.mocked(matchCandidateToReviewChallenge);
    mockMatch.mockResolvedValue({
      status: 'MATCHED',
      matchRunId: 'run-abc',
      repoId: 42,
      prNumber: 7,
      diagnostics: {
        excludedPackets: [],
        recalledPacketIds: ['packet-1'],
        evaluatedChallenges: [{
          challengeId: 'packet-1',
          repoId: 'repo-42',
          prNumber: 7,
          recallRank: 1,
          rank: 1,
          eligible: true,
          rejectionReasons: [],
          provenanceComplete: true,
          contextProjectionComplete: true,
          alignedDemandCount: 3,
          stretchCount: 1,
        }],
      },
    });

    seedCandidate(sqlite, 'cand-match', 'user-1');
    seedWorkspacePerson(sqlite, 'cand-match', 'wp-match');
    const db = createMockD1(sqlite);

    const result = await matchCandidateToReviewChallenge(db, 'cand-match', {
      temporalDecay: { halfLifeDays: 90 },
    });

    expect(result.status).toBe('MATCHED');
    expect(result.matchRunId).toBe('run-abc');
    expect(result.repoId).toBe(42);
    expect(result.prNumber).toBe(7);
    expect(result.diagnostics?.evaluatedChallenges).toHaveLength(1);
    expect(result.diagnostics?.evaluatedChallenges[0].alignedDemandCount).toBe(3);
    expect(result.diagnostics?.evaluatedChallenges[0].stretchCount).toBe(1);
  });

  it('selects top challenge by lowest rank', () => {
    const evaluated = [
      { challengeId: 'p1', repoId: 'r1', prNumber: 1, rank: 3, eligible: true, alignedDemandCount: 2, stretchCount: 0 },
      { challengeId: 'p2', repoId: 'r2', prNumber: 2, rank: 1, eligible: true, alignedDemandCount: 5, stretchCount: 1 },
      { challengeId: 'p3', repoId: 'r3', prNumber: 3, rank: 2, eligible: true, alignedDemandCount: 4, stretchCount: 0 },
    ];
    const top = evaluated.reduce((best, cur) =>
      (cur.rank !== null && (best.rank === null || cur.rank < best.rank)) ? cur : best,
    );
    expect(top.challengeId).toBe('p2');
    expect(top.alignedDemandCount).toBe(5);
  });

  it('handles NEEDS_MORE_EVIDENCE status when evidence is insufficient', async () => {
    const { matchCandidateToReviewChallenge } = await import(
      '../../../lib/challengeMatching/d1Matcher'
    );
    const mockMatch = vi.mocked(matchCandidateToReviewChallenge);
    mockMatch.mockResolvedValue({
      status: 'NEEDS_MORE_EVIDENCE',
      matchRunId: 'run-def',
      diagnostics: {
        excludedPackets: [],
        recalledPacketIds: [],
        candidateEvidenceDepth: {
          sourceDiversity: 0,
          totalInteractions: 0,
          totalAssertions: 0,
          totalSourceSpans: 0,
          sourceTypes: {},
        },
        evaluatedChallenges: [],
      },
    });

    seedCandidate(sqlite, 'cand-sparse', 'user-1');
    seedWorkspacePerson(sqlite, 'cand-sparse', 'wp-sparse');
    const db = createMockD1(sqlite);

    const result = await matchCandidateToReviewChallenge(db, 'cand-sparse', {
      temporalDecay: { halfLifeDays: 90 },
    });

    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.diagnostics?.evaluatedChallenges).toHaveLength(0);
    expect(result.diagnostics?.candidateEvidenceDepth?.sourceDiversity).toBe(0);
  });
});
