import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';

const repoSemanticMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const rolloutGatesMigration = readFileSync(
  new URL('../../../../migrations/0105_rollout_gates.sql', import.meta.url),
  'utf8',
);

const NOW = "datetime('now')";

function seedCandidate(sqlite: BetterSqliteDb, candidateId: string, userId: string): void {
  sqlite.exec(`INSERT INTO candidates (id, owner_id) VALUES ('${candidateId}', '${userId}');`);
}

function seedMatchRun(
  sqlite: BetterSqliteDb,
  opts: {
    id: string;
    candidateId: string;
    status: string;
    selectedPacketId?: string | null;
    rankedResultsJson?: string;
    excludedPacketsJson?: string;
    policyVersion?: string | null;
    createdAtOffset?: number;
  },
): void {
  const createdAt = Math.floor(Date.now() / 1000) - (opts.createdAtOffset ?? 0);
  const policyVersion = opts.policyVersion ?? 'v1';
  sqlite.exec(`
    INSERT INTO match_runs (
      id, candidate_id, application_id, role_context_id,
      candidate_snapshot_id, role_snapshot_id, policy_version, model_version,
      status, query_json, recalled_packets_json, excluded_packets_json,
      ranked_results_json, selected_packet_id, created_at
    ) VALUES (
      '${opts.id}', '${opts.candidateId}', NULL, NULL,
      'snap-1', 'role-snap-1', '${policyVersion}', NULL,
      '${opts.status}', '{}', '[]', '${opts.excludedPacketsJson ?? '[]'}',
      '${opts.rankedResultsJson ?? '[]'}', ${opts.selectedPacketId ? `'${opts.selectedPacketId}'` : 'NULL'},
      ${createdAt}
    );
  `);
}

describe('GET /candidates/:id/living-context/match-history', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY, owner_id TEXT, pipeline_id TEXT);
      CREATE TABLE pipelines (id TEXT PRIMARY KEY, owner_id TEXT);
    `);
    sqlite.exec(repoSemanticMigration);
    sqlite.exec(rolloutGatesMigration);
    sqlite.exec(`
      INSERT INTO rollout_gates (gate_key, stage, updated_by, created_at, updated_at)
      VALUES ('living_context_read', 'ga', 'system', ${NOW}, ${NOW});
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns empty list when candidate has no match runs', async () => {
    seedCandidate(sqlite, 'cand-1', 'user-1');
    const db = createMockD1(sqlite);

    const rows = await db.prepare(
      `SELECT id, status, selected_packet_id, ranked_results_json, excluded_packets_json, created_at
         FROM match_runs WHERE candidate_id = ?1
         ORDER BY created_at DESC LIMIT 20`,
    ).bind('cand-1').all<{
      id: string;
      status: string;
      selected_packet_id: string | null;
      ranked_results_json: string;
      excluded_packets_json: string;
      created_at: number;
    }>();

    expect(rows.results).toHaveLength(0);
  });

  it('returns match runs ordered by creation date descending', async () => {
    seedCandidate(sqlite, 'cand-2', 'user-1');
    seedMatchRun(sqlite, {
      id: 'run-old',
      candidateId: 'cand-2',
      status: 'NEEDS_MORE_EVIDENCE',
      createdAtOffset: 3600,
    });
    seedMatchRun(sqlite, {
      id: 'run-new',
      candidateId: 'cand-2',
      status: 'MATCHED',
      rankedResultsJson: JSON.stringify([{
        challengeId: 'ch-1', repoId: 'repo-1', prNumber: 42,
        rank: 1, score: 0.87, alignedDemandCount: 5, stretchCount: 1,
      }]),
      createdAtOffset: 0,
    });

    const db = createMockD1(sqlite);
    const rows = await db.prepare(
      `SELECT id, status, selected_packet_id, ranked_results_json, excluded_packets_json, created_at
         FROM match_runs WHERE candidate_id = ?1
         ORDER BY created_at DESC LIMIT 20`,
    ).bind('cand-2').all<{
      id: string;
      status: string;
      selected_packet_id: string | null;
      ranked_results_json: string;
      excluded_packets_json: string;
      created_at: number;
    }>();

    const results = rows.results ?? [];
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe('run-new');
    expect(results[1]!.id).toBe('run-old');
  });

  it('parses ranked results JSON correctly', async () => {
    seedCandidate(sqlite, 'cand-3', 'user-1');
    const ranked = [
      { challengeId: 'ch-1', repoId: 'repo-1', prNumber: 42, rank: 1, score: 0.87, alignedDemandCount: 5, stretchCount: 1 },
      { challengeId: 'ch-2', repoId: 'repo-2', prNumber: 99, rank: 2, score: 0.65, alignedDemandCount: 3, stretchCount: 2 },
    ];
    seedMatchRun(sqlite, {
      id: 'run-ranked',
      candidateId: 'cand-3',
      status: 'MATCHED',
      rankedResultsJson: JSON.stringify(ranked),
    });

    const db = createMockD1(sqlite);
    const row = await db.prepare(
      `SELECT ranked_results_json FROM match_runs WHERE id = ?1`,
    ).bind('run-ranked').first<{ ranked_results_json: string }>();

    const parsed = JSON.parse(row!.ranked_results_json) as typeof ranked;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.challengeId).toBe('ch-1');
    expect(parsed[0]!.score).toBe(0.87);
    expect(parsed[1]!.prNumber).toBe(99);
  });

  it('computes deltas between consecutive runs', () => {
    interface MatchHistoryEntry {
      matchRunId: string;
      status: string;
      selectedPacketId: string | null;
      evaluatedCount: number;
      topChallenge: { challengeId: string; score: number } | null;
    }

    const runs: MatchHistoryEntry[] = [
      {
        matchRunId: 'run-3',
        status: 'MATCHED',
        selectedPacketId: 'packet-b',
        evaluatedCount: 8,
        topChallenge: { challengeId: 'ch-b', score: 0.92 },
      },
      {
        matchRunId: 'run-2',
        status: 'MATCHED',
        selectedPacketId: 'packet-a',
        evaluatedCount: 6,
        topChallenge: { challengeId: 'ch-a', score: 0.78 },
      },
      {
        matchRunId: 'run-1',
        status: 'NEEDS_MORE_EVIDENCE',
        selectedPacketId: null,
        evaluatedCount: 3,
        topChallenge: null,
      },
    ];

    interface MatchHistoryDelta {
      fromRunId: string;
      toRunId: string;
      statusChanged: boolean;
      selectedPacketChanged: boolean;
      evaluatedCountDelta: number;
      topScoreDelta: number | null;
      newTopChallenge: boolean;
    }

    const deltas: MatchHistoryDelta[] = [];
    for (let i = 0; i < runs.length - 1; i++) {
      const newer = runs[i]!;
      const older = runs[i + 1]!;
      const newerScore = newer.topChallenge?.score ?? null;
      const olderScore = older.topChallenge?.score ?? null;
      deltas.push({
        fromRunId: older.matchRunId,
        toRunId: newer.matchRunId,
        statusChanged: newer.status !== older.status,
        selectedPacketChanged: newer.selectedPacketId !== older.selectedPacketId,
        evaluatedCountDelta: newer.evaluatedCount - older.evaluatedCount,
        topScoreDelta: newerScore !== null && olderScore !== null ? newerScore - olderScore : null,
        newTopChallenge: newer.topChallenge?.challengeId !== older.topChallenge?.challengeId,
      });
    }

    expect(deltas).toHaveLength(2);

    // run-3 vs run-2: same status, different packet, score improved
    expect(deltas[0]!.statusChanged).toBe(false);
    expect(deltas[0]!.selectedPacketChanged).toBe(true);
    expect(deltas[0]!.evaluatedCountDelta).toBe(2);
    expect(deltas[0]!.topScoreDelta).toBeCloseTo(0.14);
    expect(deltas[0]!.newTopChallenge).toBe(true);

    // run-2 vs run-1: status changed from NEEDS_MORE_EVIDENCE to MATCHED
    expect(deltas[1]!.statusChanged).toBe(true);
    expect(deltas[1]!.selectedPacketChanged).toBe(true);
    expect(deltas[1]!.evaluatedCountDelta).toBe(3);
    expect(deltas[1]!.topScoreDelta).toBeNull();
    expect(deltas[1]!.newTopChallenge).toBe(true);
  });

  it('respects limit parameter', async () => {
    seedCandidate(sqlite, 'cand-limit', 'user-1');
    for (let i = 0; i < 5; i++) {
      seedMatchRun(sqlite, {
        id: `run-${i}`,
        candidateId: 'cand-limit',
        status: 'MATCHED',
        createdAtOffset: i * 60,
      });
    }

    const db = createMockD1(sqlite);
    const rows = await db.prepare(
      `SELECT id FROM match_runs WHERE candidate_id = ?1 ORDER BY created_at DESC LIMIT ?2`,
    ).bind('cand-limit', 3).all<{ id: string }>();

    expect(rows.results).toHaveLength(3);
  });
});
