import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { recordMatchDecision, loadMatchDecisionHistory } from '../matchDecisionAudit';
import type { MatchDecisionInput } from '../matchDecisionAudit';
import type { D1Database } from '@cloudflare/workers-types';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const repoGraphMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
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

function seedMatchRun(
  sqlite: BetterSqliteDb,
  runId: string,
  candidateId: string,
): void {
  sqlite.exec(`
    INSERT INTO match_runs (id, candidate_id, status, candidate_snapshot_id, role_snapshot_id, policy_version, query_json, recalled_packets_json, ranked_results_json, excluded_packets_json, created_at)
    VALUES ('${runId}', '${candidateId}', 'MATCHED', 'snap-1', 'role-snap-1', 'v1.0', '{}', '[]', '[]', '[]', unixepoch());
  `);
}

describe('matchDecisionAudit', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY, owner_id TEXT, pipeline_id TEXT);
      CREATE TABLE pipelines (id TEXT PRIMARY KEY, owner_id TEXT);
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(repoGraphMigration);
    sqlite.exec(conceptRegistryMigration);
    sqlite.exec(contextRecordsMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('recordMatchDecision', () => {
    it('records an accepted decision with source provenance', async () => {
      seedCandidate(sqlite, 'cand-001', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-001', 'wp-1');
      seedMatchRun(sqlite, 'run-001', 'cand-001');

      const db = createMockD1(sqlite) as unknown as D1Database;
      const input: MatchDecisionInput = {
        candidateId: 'cand-001',
        matchRunId: 'run-001',
        challengeId: 'ch-001',
        repoId: 'org/repo',
        prNumber: 42,
        verdict: 'accepted',
        reason: 'Strong TypeScript experience aligns with code demands',
        recruiterId: 'recruiter-001',
      };

      const result = await recordMatchDecision(db, input);

      expect(result.success).toBe(true);
      expect(result.candidateId).toBe('cand-001');
      expect(result.matchRunId).toBe('run-001');
      expect(result.challengeId).toBe('ch-001');
      expect(result.verdict).toBe('accepted');
      expect(result.decisionId).toBeTruthy();
      expect(result.contextRecordId).toBeTruthy();
      expect(result.recordedAt).toBeTruthy();

      // Verify the context record was persisted
      const record = sqlite.prepare(
        `SELECT * FROM context_records WHERE scope_type = 'candidate' AND scope_id = 'cand-001' AND record_type = 'match_decision'`,
      ).get() as Record<string, unknown> | undefined;
      expect(record).toBeTruthy();
      expect(record!.predicate).toBe('recruiter_accepted_match');
    });

    it('records a rejected decision with cited alignments', async () => {
      seedCandidate(sqlite, 'cand-002', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-002', 'wp-2');
      seedMatchRun(sqlite, 'run-002', 'cand-002');

      const db = createMockD1(sqlite) as unknown as D1Database;
      const input: MatchDecisionInput = {
        candidateId: 'cand-002',
        matchRunId: 'run-002',
        challengeId: 'ch-002',
        repoId: 'org/other-repo',
        prNumber: 99,
        verdict: 'rejected',
        reason: 'Insufficient backend evidence',
        citedAlignmentIds: ['align-001', 'align-002'],
        notes: 'Candidate is frontend-focused.',
        recruiterId: 'recruiter-001',
      };

      const result = await recordMatchDecision(db, input);

      expect(result.success).toBe(true);
      expect(result.verdict).toBe('rejected');

      // Verify source refs include cited alignments
      const sources = sqlite.prepare(
        `SELECT * FROM context_record_source_refs WHERE context_record_id = ?`,
      ).all(result.contextRecordId) as Array<Record<string, unknown>>;
      // 1 match_run source + 2 alignment sources = 3
      expect(sources.length).toBe(3);
      const alignmentSources = sources.filter((s) => s.source_ref_type === 'match_alignment');
      expect(alignmentSources.length).toBe(2);
    });

    it('records a deferred decision', async () => {
      seedCandidate(sqlite, 'cand-003', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-003', 'wp-3');
      seedMatchRun(sqlite, 'run-003', 'cand-003');

      const db = createMockD1(sqlite) as unknown as D1Database;
      const input: MatchDecisionInput = {
        candidateId: 'cand-003',
        matchRunId: 'run-003',
        challengeId: 'ch-003',
        repoId: 'org/repo',
        prNumber: 7,
        verdict: 'deferred',
        reason: 'Waiting for interview evidence',
        recruiterId: 'recruiter-002',
      };

      const result = await recordMatchDecision(db, input);
      expect(result.success).toBe(true);
      expect(result.verdict).toBe('deferred');
    });

    it('is idempotent — same decision recorded twice yields same id', async () => {
      seedCandidate(sqlite, 'cand-004', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-004', 'wp-4');
      seedMatchRun(sqlite, 'run-004', 'cand-004');

      const db = createMockD1(sqlite) as unknown as D1Database;
      const input: MatchDecisionInput = {
        candidateId: 'cand-004',
        matchRunId: 'run-004',
        challengeId: 'ch-004',
        repoId: 'org/repo',
        prNumber: 5,
        verdict: 'accepted',
        recruiterId: 'recruiter-001',
      };

      const first = await recordMatchDecision(db, input);
      const second = await recordMatchDecision(db, input);

      expect(first.decisionId).toBe(second.decisionId);
      expect(first.contextRecordId).toBe(second.contextRecordId);
    });
  });

  describe('loadMatchDecisionHistory', () => {
    it('returns empty history when no decisions exist', async () => {
      seedCandidate(sqlite, 'cand-empty', 'user-1');
      const db = createMockD1(sqlite) as unknown as D1Database;

      const history = await loadMatchDecisionHistory(db, 'cand-empty');

      expect(history.candidateId).toBe('cand-empty');
      expect(history.decisions).toHaveLength(0);
      expect(history.totalDecisions).toBe(0);
      expect(history.acceptedCount).toBe(0);
      expect(history.rejectedCount).toBe(0);
      expect(history.deferredCount).toBe(0);
    });

    it('returns decisions with correct counts after recording', async () => {
      seedCandidate(sqlite, 'cand-multi', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-multi', 'wp-multi');
      seedMatchRun(sqlite, 'run-m1', 'cand-multi');
      seedMatchRun(sqlite, 'run-m2', 'cand-multi');
      seedMatchRun(sqlite, 'run-m3', 'cand-multi');

      const db = createMockD1(sqlite) as unknown as D1Database;

      await recordMatchDecision(db, {
        candidateId: 'cand-multi',
        matchRunId: 'run-m1',
        challengeId: 'ch-a',
        repoId: 'org/repo',
        prNumber: 10,
        verdict: 'accepted',
        recruiterId: 'rec-1',
      });

      await recordMatchDecision(db, {
        candidateId: 'cand-multi',
        matchRunId: 'run-m2',
        challengeId: 'ch-b',
        repoId: 'org/repo',
        prNumber: 11,
        verdict: 'rejected',
        reason: 'Not enough evidence',
        recruiterId: 'rec-1',
      });

      await recordMatchDecision(db, {
        candidateId: 'cand-multi',
        matchRunId: 'run-m3',
        challengeId: 'ch-c',
        repoId: 'org/other',
        prNumber: 3,
        verdict: 'deferred',
        recruiterId: 'rec-2',
      });

      const history = await loadMatchDecisionHistory(db, 'cand-multi');

      expect(history.candidateId).toBe('cand-multi');
      expect(history.totalDecisions).toBe(3);
      expect(history.acceptedCount).toBe(1);
      expect(history.rejectedCount).toBe(1);
      expect(history.deferredCount).toBe(1);
      expect(history.decisions[0]!.repoId).toBeTruthy();
      expect(history.decisions[0]!.prNumber).toBeGreaterThan(0);
    });
  });
});
