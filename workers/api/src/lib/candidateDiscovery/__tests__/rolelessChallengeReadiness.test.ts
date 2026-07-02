import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { matchCandidateToReviewChallenge } from '../../challengeMatching/d1Matcher';
import { tryPromoteRolelessChallengeReadiness } from '../orchestrate';

vi.mock('../../challengeMatching/d1Matcher', () => ({
  matchCandidateToReviewChallenge: vi.fn(),
}));

function createSqlite(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE challenge_design_queue (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      status TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      ready_packet_id TEXT,
      missing_signal TEXT NOT NULL,
      inventory_failure_reason TEXT NOT NULL,
      desired_assessment_signal TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return sqlite;
}

function seedQueue(sqlite: BetterSqliteDb): void {
  sqlite.prepare(
    `INSERT INTO challenge_design_queue (
       id, candidate_id, status, validation_status, ready_packet_id,
       missing_signal, inventory_failure_reason, desired_assessment_signal, updated_at
     )
     VALUES (
       'queue-1', 'candidate-1', 'queued', 'needs_design', NULL,
       'Needs a validated source-backed challenge assignment.',
       'No ready challenge assignment was available at intake completion.',
       'Assess code review judgment once inventory is ready.',
       '2026-07-02T00:00:00.000Z'
     )`,
  ).run();
}

describe('tryPromoteRolelessChallengeReadiness', () => {
  let sqlite: BetterSqliteDb | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('promotes an active design queue item when deterministic matching selects a source-backed packet', async () => {
    sqlite = createSqlite();
    seedQueue(sqlite);
    vi.mocked(matchCandidateToReviewChallenge).mockResolvedValue({
      status: 'MATCHED',
      matchRunId: 'match-run-1',
      repoId: 973,
      prNumber: 42,
      explanation: {
        status: 'MATCHED',
        challengeId: 'packet-1',
        repoId: '973',
        prNumber: 42,
        score: 0.91,
        summary: 'Candidate evidence aligns with the selected review packet.',
        evidence: [],
        candidateSpans: [],
        repoSpans: [],
        roleSources: [],
        rejectedPackets: [],
        missingEvidence: [],
        stretchAreas: [],
        unmatchedDemandIds: [],
        rejectionReasons: [],
      },
    });

    const result = await tryPromoteRolelessChallengeReadiness(
      createMockD1(sqlite),
      'candidate-1',
    );

    expect(result).toEqual({
      status: 'ready_to_assign',
      packetId: 'packet-1',
      matchRunId: 'match-run-1',
    });
    expect(sqlite.prepare(
      `SELECT status, validation_status, ready_packet_id, missing_signal,
              inventory_failure_reason, desired_assessment_signal
         FROM challenge_design_queue
        WHERE id = 'queue-1'`,
    ).get()).toEqual({
      status: 'ready_to_assign',
      validation_status: 'ready_to_assign',
      ready_packet_id: 'packet-1',
      missing_signal: 'Source-backed challenge packet is ready for assessment assignment.',
      inventory_failure_reason: 'Source-backed challenge packet selected by deterministic candidate-to-PR matcher.',
      desired_assessment_signal: 'Assign this candidate to the ready code-review challenge packet.',
    });
  });

  it('leaves the design queue untouched when matching cannot select a safe packet', async () => {
    sqlite = createSqlite();
    seedQueue(sqlite);
    vi.mocked(matchCandidateToReviewChallenge).mockResolvedValue({
      status: 'NEEDS_MORE_EVIDENCE',
      matchRunId: 'match-run-2',
    });

    const result = await tryPromoteRolelessChallengeReadiness(
      createMockD1(sqlite),
      'candidate-1',
    );

    expect(result).toEqual({
      status: 'not_ready',
      reason: 'matcher_returned_needs_more_evidence',
      matchRunId: 'match-run-2',
    });
    expect(sqlite.prepare(
      `SELECT status, validation_status, ready_packet_id
         FROM challenge_design_queue
        WHERE id = 'queue-1'`,
    ).get()).toEqual({
      status: 'queued',
      validation_status: 'needs_design',
      ready_packet_id: null,
    });
  });
});
