import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { loadPriorDecisionExclusions, buildDecisionExclusionDiagnostics } from '../decisionWeightedRematch';
import { recordMatchDecision } from '../matchDecisionAudit';
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

describe('decisionWeightedRematch', () => {
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

  describe('loadPriorDecisionExclusions', () => {
    it('returns empty result when no decisions exist', async () => {
      const db = createMockD1(sqlite) as unknown as D1Database;
      const result = await loadPriorDecisionExclusions(db, 'cand-999');
      expect(result.candidateId).toBe('cand-999');
      expect(result.excludedPacketIds).toHaveLength(0);
      expect(result.exclusions).toHaveLength(0);
      expect(result.deferredCount).toBe(0);
      expect(result.totalDecisions).toBe(0);
    });

    it('excludes rejected challenges', async () => {
      seedCandidate(sqlite, 'cand-001', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-001', 'wp-001');
      seedMatchRun(sqlite, 'run-1', 'cand-001');

      const db = createMockD1(sqlite) as unknown as D1Database;
      await recordMatchDecision(db, {
        candidateId: 'cand-001',
        matchRunId: 'run-1',
        challengeId: 'pkt-rejected-1',
        repoId: 'repo-1',
        prNumber: 42,
        verdict: 'rejected',
        reason: 'Not relevant to this candidate',
        recruiterId: 'user-1',
      });

      const result = await loadPriorDecisionExclusions(db, 'cand-001');
      expect(result.excludedPacketIds).toEqual(['pkt-rejected-1']);
      expect(result.exclusions).toHaveLength(1);
      expect(result.exclusions[0]!.verdict).toBe('rejected');
      expect(result.exclusions[0]!.challengeId).toBe('pkt-rejected-1');
      expect(result.exclusions[0]!.repoId).toBe('repo-1');
      expect(result.exclusions[0]!.prNumber).toBe(42);
      expect(result.deferredCount).toBe(0);
    });

    it('excludes accepted challenges', async () => {
      seedCandidate(sqlite, 'cand-001', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-001', 'wp-001');
      seedMatchRun(sqlite, 'run-1', 'cand-001');

      const db = createMockD1(sqlite) as unknown as D1Database;
      await recordMatchDecision(db, {
        candidateId: 'cand-001',
        matchRunId: 'run-1',
        challengeId: 'pkt-accepted-1',
        repoId: 'repo-2',
        prNumber: 7,
        verdict: 'accepted',
        recruiterId: 'user-1',
      });

      const result = await loadPriorDecisionExclusions(db, 'cand-001');
      expect(result.excludedPacketIds).toEqual(['pkt-accepted-1']);
      expect(result.exclusions[0]!.verdict).toBe('accepted');
    });

    it('does not exclude deferred challenges', async () => {
      seedCandidate(sqlite, 'cand-001', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-001', 'wp-001');
      seedMatchRun(sqlite, 'run-1', 'cand-001');

      const db = createMockD1(sqlite) as unknown as D1Database;
      await recordMatchDecision(db, {
        candidateId: 'cand-001',
        matchRunId: 'run-1',
        challengeId: 'pkt-deferred-1',
        repoId: 'repo-3',
        prNumber: 12,
        verdict: 'deferred',
        recruiterId: 'user-1',
      });

      const result = await loadPriorDecisionExclusions(db, 'cand-001');
      expect(result.excludedPacketIds).toHaveLength(0);
      expect(result.exclusions).toHaveLength(0);
      expect(result.deferredCount).toBe(1);
      expect(result.totalDecisions).toBe(1);
    });

    it('handles mixed decisions — later defer overrides earlier reject', async () => {
      seedCandidate(sqlite, 'cand-001', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-001', 'wp-001');
      seedMatchRun(sqlite, 'run-1', 'cand-001');
      seedMatchRun(sqlite, 'run-2', 'cand-001');

      const db = createMockD1(sqlite) as unknown as D1Database;

      // First reject
      await recordMatchDecision(db, {
        candidateId: 'cand-001',
        matchRunId: 'run-1',
        challengeId: 'pkt-flip-1',
        repoId: 'repo-4',
        prNumber: 3,
        verdict: 'rejected',
        recruiterId: 'user-1',
      });

      // Then defer the same challenge — should override
      await recordMatchDecision(db, {
        candidateId: 'cand-001',
        matchRunId: 'run-2',
        challengeId: 'pkt-flip-1',
        repoId: 'repo-4',
        prNumber: 3,
        verdict: 'deferred',
        recruiterId: 'user-1',
      });

      const result = await loadPriorDecisionExclusions(db, 'cand-001');
      expect(result.excludedPacketIds).toHaveLength(0);
      expect(result.deferredCount).toBe(1);
      expect(result.totalDecisions).toBe(2);
    });

    it('separates decisions per candidate', async () => {
      seedCandidate(sqlite, 'cand-001', 'user-1');
      seedCandidate(sqlite, 'cand-002', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-001', 'wp-001');
      seedWorkspacePerson(sqlite, 'cand-002', 'wp-002');
      seedMatchRun(sqlite, 'run-1', 'cand-001');
      seedMatchRun(sqlite, 'run-2', 'cand-002');

      const db = createMockD1(sqlite) as unknown as D1Database;

      await recordMatchDecision(db, {
        candidateId: 'cand-001',
        matchRunId: 'run-1',
        challengeId: 'pkt-shared-1',
        repoId: 'repo-5',
        prNumber: 10,
        verdict: 'rejected',
        recruiterId: 'user-1',
      });

      const resultA = await loadPriorDecisionExclusions(db, 'cand-001');
      expect(resultA.excludedPacketIds).toEqual(['pkt-shared-1']);

      const resultB = await loadPriorDecisionExclusions(db, 'cand-002');
      expect(resultB.excludedPacketIds).toHaveLength(0);
    });

    it('deduplicates packet IDs when multiple decisions reference the same challenge', async () => {
      seedCandidate(sqlite, 'cand-001', 'user-1');
      seedWorkspacePerson(sqlite, 'cand-001', 'wp-001');
      seedMatchRun(sqlite, 'run-1', 'cand-001');
      seedMatchRun(sqlite, 'run-2', 'cand-001');

      const db = createMockD1(sqlite) as unknown as D1Database;

      await recordMatchDecision(db, {
        candidateId: 'cand-001',
        matchRunId: 'run-1',
        challengeId: 'pkt-dup-1',
        repoId: 'repo-6',
        prNumber: 20,
        verdict: 'rejected',
        recruiterId: 'user-1',
      });

      // Second rejection of same challenge in a later run — only keeps latest
      await recordMatchDecision(db, {
        candidateId: 'cand-001',
        matchRunId: 'run-2',
        challengeId: 'pkt-dup-1',
        repoId: 'repo-6',
        prNumber: 20,
        verdict: 'rejected',
        reason: 'Still not relevant',
        recruiterId: 'user-1',
      });

      const result = await loadPriorDecisionExclusions(db, 'cand-001');
      expect(result.excludedPacketIds).toEqual(['pkt-dup-1']);
      expect(result.exclusions).toHaveLength(1);
    });
  });

  describe('buildDecisionExclusionDiagnostics', () => {
    it('maps rejected decisions to RECRUITER_REJECTED', () => {
      const diagnostics = buildDecisionExclusionDiagnostics([{
        challengeId: 'pkt-1',
        repoId: 'repo-1',
        prNumber: 42,
        verdict: 'rejected',
        matchRunId: 'run-1',
        decidedAt: '2026-07-01T00:00:00.000Z',
      }]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]!.reason).toBe('RECRUITER_REJECTED');
    });

    it('maps accepted decisions to RECRUITER_PREVIOUSLY_ACCEPTED', () => {
      const diagnostics = buildDecisionExclusionDiagnostics([{
        challengeId: 'pkt-2',
        repoId: 'repo-2',
        prNumber: 7,
        verdict: 'accepted',
        matchRunId: 'run-2',
        decidedAt: '2026-07-01T00:00:00.000Z',
      }]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]!.reason).toBe('RECRUITER_PREVIOUSLY_ACCEPTED');
    });
  });
});
