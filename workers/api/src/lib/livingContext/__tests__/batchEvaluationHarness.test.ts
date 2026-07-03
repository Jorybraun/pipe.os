import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  runBatchEvaluation,
  runMatchQualityEvaluation,
  type BatchEvaluationCandidate,
} from '../batchEvaluationHarness';
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
const RECENT = '2026-07-01T00:00:00.000Z';

function seedBaseSchema(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    CREATE TABLE candidates (id TEXT PRIMARY KEY, owner_id TEXT, pipeline_id TEXT, status TEXT DEFAULT 'ACTIVE');
    CREATE TABLE pipelines (id TEXT PRIMARY KEY, owner_id TEXT);
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      url TEXT,
      default_branch TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  sqlite.exec(livingContextMigration);
  sqlite.exec(repoGraphMigration);
  sqlite.exec(conceptRegistryMigration);
  sqlite.exec(contextRecordsMigration);
}

function seedCandidate(sqlite: BetterSqliteDb, candidateId: string, wpId: string): void {
  sqlite.exec(`
    INSERT INTO candidates (id, owner_id) VALUES ('${candidateId}', 'user-1');
    INSERT INTO people (id, ingestion_key, created_at, updated_at)
    VALUES ('person-${wpId}', 'ik-person-${wpId}', ${NOW}, ${NOW});
    INSERT INTO workspace_people (id, person_id, workspace_id, ingestion_key, context_json, created_at, updated_at)
    VALUES ('${wpId}', 'person-${wpId}', 'ws-1', 'ik-wp-${wpId}', '{}', ${NOW}, ${NOW});
    INSERT INTO applications (id, workspace_person_id, legacy_candidate_id, ingestion_key, created_at, updated_at)
    VALUES ('app-${wpId}', '${wpId}', '${candidateId}', 'ik-app-${wpId}', ${NOW}, ${NOW});
  `);
}

function ensureConcept(sqlite: BetterSqliteDb, conceptKey: string): void {
  sqlite.exec(`
    INSERT OR IGNORE INTO concepts (id, ingestion_key, canonical_key, namespace, label, created_at, updated_at)
    VALUES ('${conceptKey}', 'ik-${conceptKey}', '${conceptKey}', 'skill', '${conceptKey}', ${NOW}, ${NOW});
  `);
}

function seedEvidence(
  sqlite: BetterSqliteDb,
  wpId: string,
  conceptKey: string,
  interactionType: string,
  strength: number,
): void {
  ensureConcept(sqlite, conceptKey);
  const safeId = `${wpId}-${conceptKey}-${interactionType}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  sqlite.exec(`
    INSERT OR IGNORE INTO interactions (id, ingestion_key, workspace_person_id, interaction_type, started_at, external_reference, created_at, updated_at)
    VALUES ('int-${safeId}', 'ik-int-${safeId}', '${wpId}', '${interactionType}', '${RECENT}', 'ref-${safeId}', ${NOW}, ${NOW});
    INSERT INTO semantic_assertions (id, ingestion_key, workspace_person_id, subject_type, predicate, narrative, observed_at, created_at, updated_at)
    VALUES ('assert-${safeId}', 'ik-assert-${safeId}', '${wpId}', 'person', 'demonstrates', 'Demonstrates ${conceptKey}', '${RECENT}', ${NOW}, ${NOW});
    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES ('assert-${safeId}', '${conceptKey}', 'subject', 1.0, ${NOW});
    INSERT INTO signal_evidence (id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id, signal_key, evidence_level, strength, created_at, updated_at)
    VALUES ('sig-${safeId}', 'ik-sig-${safeId}', '${wpId}', 'int-${safeId}', 'assert-${safeId}', '${conceptKey}', '${conceptKey}', 'demonstrated', ${strength}, ${NOW}, ${NOW});
  `);
}

function seedPacket(sqlite: BetterSqliteDb, packetId = 'packet-typescript'): void {
  sqlite.exec(`
    INSERT INTO qualified_repos (id, full_name, url, default_branch, created_at, updated_at)
    VALUES (1, 'acme/source-backed', 'https://github.com/acme/source-backed', 'main', ${NOW}, ${NOW});
    INSERT INTO repo_snapshots (id, repo_id, commit_sha, extractor_version)
    VALUES ('snap-1', 1, 'abc123', '1.0.0');
  `);
  const packet = JSON.stringify({
    id: packetId,
    pullRequest: { number: 77, title: 'Fix request parser retry behavior' },
    demands: [
      {
        id: 'demand-typescript',
        family: 'language',
        narrative: 'Review TypeScript control-flow changes',
        weight: 0.8,
        conceptKeys: ['typescript'],
        sourceSpanIds: ['repo-span-1'],
        changedSymbolIds: ['symbol-1'],
      },
      {
        id: 'demand-http-tests',
        family: 'testing',
        narrative: 'Assess HTTP parser tests and regression coverage',
        weight: 0.7,
        conceptKeys: ['http', 'testing'],
        sourceSpanIds: ['repo-span-2'],
        changedSymbolIds: ['symbol-2'],
      },
    ],
  });
  sqlite.exec(`
    INSERT INTO review_challenge_packets
      (id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash, language, production_ready, quality_score, demand_families_json, packet_json)
    VALUES
      ('${packetId}', 'snap-1', 1, 77, '1.0.0', 'sha256:packet', 'TypeScript', 1, 0.92, '["language","testing"]', '${packet.replace(/'/g, "''")}')
  `);
}

function seedCronSchedulePacket(sqlite: BetterSqliteDb, packetId = 'packet-cron-schedule'): void {
  const packet = JSON.stringify({
    id: packetId,
    pullRequest: { number: 88, title: 'Send workflow schedules as cron objects' },
    demands: [
      {
        id: 'demand-cron-schedules',
        family: 'workflow-schedules',
        narrative: 'Review wrangler workflow schedule deploy payloads with cron mapping',
        weight: 1,
        conceptKeys: [
          'workflow',
          'wrangler',
          'cron',
          'schedules',
          'array.isarray-workflow.schedules-workflow.schedules-workflow.schedules-.map',
        ],
        sourceSpanIds: ['repo-span-cron'],
        changedSymbolIds: ['symbol-cron'],
      },
    ],
  });
  sqlite.exec(`
    INSERT INTO review_challenge_packets
      (id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash, language, production_ready, quality_score, demand_families_json, packet_json)
    VALUES
      ('${packetId}', 'snap-1', 1, 88, '1.0.0', 'sha256:cron-packet', 'TypeScript', 1, 0.9, '["workflow-schedules"]', '${packet.replace(/'/g, "''")}')
  `);
}

function seedFixture(sqlite: BetterSqliteDb): void {
  seedBaseSchema(sqlite);
  seedPacket(sqlite);
  seedCandidate(sqlite, 'cand-fit', 'wp-fit');
  seedCandidate(sqlite, 'cand-negative', 'wp-negative');
  seedEvidence(sqlite, 'wp-fit', 'typescript', 'code_review', 0.95);
  seedEvidence(sqlite, 'wp-fit', 'http', 'interview', 0.9);
  seedEvidence(sqlite, 'wp-fit', 'testing', 'assessment', 0.85);
  seedEvidence(sqlite, 'wp-negative', 'python', 'interview', 0.9);
}

describe('batchEvaluationHarness', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    seedFixture(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('evaluates labelled source-backed candidate/challenge cases', async () => {
    const db = createMockD1(sqlite) as unknown as D1Database;
    const cases: BatchEvaluationCandidate[] = [
      {
        caseId: 'typescript-positive',
        candidateId: 'cand-fit',
        challengePacketId: 'packet-typescript',
        expectedVerdict: 'strong_match',
        expectedReasonCategory: 'aligned',
        negativeCandidateId: 'cand-negative',
        minimumScoreSeparation: 0.2,
      },
      {
        caseId: 'typescript-negative',
        candidateId: 'cand-negative',
        challengePacketId: 'packet-typescript',
        expectedVerdict: 'insufficient_evidence',
        expectedReasonCategory: 'insufficient_evidence',
        requireCandidateEvidence: false,
      },
    ];

    const result = await runMatchQualityEvaluation(db, {
      corpusId: 'unit-labelled-corpus',
      cases,
      thresholds: {
        minAccuracy: 1,
        minAverageScoreSeparation: 0.2,
        minUsableChallengeRate: 1,
      },
    });

    expect(result.passed).toBe(true);
    expect(result.metrics.verdictAccuracy).toBe(1);
    expect(result.metrics.falsePositiveCount).toBe(0);
    expect(result.metrics.falseNegativeCount).toBe(0);
    expect(result.metrics.negativeCaseCount).toBe(1);
    expect(result.metrics.insufficientEvidenceCaseCount).toBe(1);
    expect(result.metrics.contrastCaseCount).toBe(1);
    expect(result.metrics.reasonCategoryExpectationCount).toBe(2);
    expect(result.metrics.averageScoreSeparation).toBeGreaterThanOrEqual(0.2);
    expect(result.metrics.usableChallengeRate).toBe(1);
    expect(result.failedCases).toHaveLength(0);
    expect(result.pairResults[0].reasonCategory).toBe('aligned');
    expect(result.pairResults[0].unifiedReport?.gaps.loaded).toBe(true);
    expect(result.pairResults[0].unifiedReport?.gaps.errorMessage).toBeNull();
    expect(result.pairResults[0].compactReport?.candidateEvidence.length).toBeGreaterThan(0);
    expect(result.pairResults[0].compactReport?.repoEvidence.length).toBeGreaterThan(0);
  });

  it('caps adjacent repo-family evidence when a source-backed PR requires an unmatched critical signal', async () => {
    const db = createMockD1(sqlite) as unknown as D1Database;
    seedCronSchedulePacket(sqlite);
    seedCandidate(sqlite, 'cand-workflows-adjacent', 'wp-workflows-adjacent');
    seedEvidence(sqlite, 'wp-workflows-adjacent', 'workflow', 'code_review', 0.95);
    seedEvidence(sqlite, 'wp-workflows-adjacent', 'wrangler', 'assessment', 0.9);

    const result = await runBatchEvaluation(db, [{
      caseId: 'cron-schedule-needs-review',
      candidateId: 'cand-workflows-adjacent',
      challengePacketId: 'packet-cron-schedule',
      expectedVerdict: 'needs_review',
      expectedReasonCategory: 'needs_challenge_design',
    }]);

    expect(result.pairResults[0].computedVerdict).toBe('needs_review');
    expect(result.pairResults[0].failedReasons).toEqual([]);
    expect(result.pairResults[0].unifiedReport?.verdict.riskFactors)
      .toContain('Missing required cron/schedule evidence');
  });

  it('fails the gate when contrast separation is too flat', async () => {
    const db = createMockD1(sqlite) as unknown as D1Database;
    seedEvidence(sqlite, 'wp-negative', 'typescript', 'code_review', 0.95);
    seedEvidence(sqlite, 'wp-negative', 'http', 'interview', 0.9);
    seedEvidence(sqlite, 'wp-negative', 'testing', 'assessment', 0.85);

    const result = await runMatchQualityEvaluation(db, {
      corpusId: 'flat-contrast-corpus',
      cases: [{
        caseId: 'flat-separation',
        candidateId: 'cand-fit',
        challengePacketId: 'packet-typescript',
        expectedVerdict: 'strong_match',
        negativeCandidateId: 'cand-negative',
        minimumScoreSeparation: 0.2,
      }],
      thresholds: {
        minAccuracy: 1,
        minAverageScoreSeparation: 0.2,
        minUsableChallengeRate: 1,
        minNegativeCaseCount: 0,
        minInsufficientEvidenceCaseCount: 0,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failedCases[0].failedReasons).toContain('score_separation_too_flat');
    expect(result.gateFailures.some((failure) => failure.includes('score separation'))).toBe(true);
  });

  it('records insufficient-evidence outcomes without treating them as source-backed positive matches', async () => {
    const db = createMockD1(sqlite) as unknown as D1Database;
    const result = await runBatchEvaluation(db, [{
      caseId: 'negative-insufficient',
      candidateId: 'cand-negative',
      challengePacketId: 'packet-typescript',
      expectedVerdict: 'insufficient_evidence',
      expectedReasonCategory: 'insufficient_evidence',
      requireCandidateEvidence: false,
    }]);

    expect(result.metrics.totalPairs).toBe(1);
    expect(result.metrics.falsePositiveCount).toBe(0);
    expect(result.pairResults[0].computedVerdict).toBe('insufficient_evidence');
    expect(result.pairResults[0].reasonCategory).toBe('insufficient_evidence');
    expect(result.pairResults[0].failedReasons).toEqual([]);
  });

  it('fails the gate when a labelled case has the right verdict for the wrong reason', async () => {
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await runMatchQualityEvaluation(db, {
      corpusId: 'reason-category-corpus',
      cases: [{
        caseId: 'wrong-reason-category',
        candidateId: 'cand-negative',
        challengePacketId: 'packet-typescript',
        expectedVerdict: 'insufficient_evidence',
        expectedReasonCategory: 'aligned',
        requireCandidateEvidence: false,
      }],
      thresholds: {
        minAccuracy: 1,
        minAverageScoreSeparation: 0,
        minUsableChallengeRate: 1,
        minContrastCaseCount: 0,
      },
    });

    expect(result.pairResults[0].computedVerdict).toBe('insufficient_evidence');
    expect(result.pairResults[0].reasonCategory).toBe('insufficient_evidence');
    expect(result.pairResults[0].verdictMatch).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.failedCases[0].failedReasons).toContain('reason_category_mismatch');
    expect(result.gateFailures).toContain('1 labelled case failed reason-category expectations');
  });

  it('fails the gate when the corpus has no negative case', async () => {
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await runMatchQualityEvaluation(db, {
      corpusId: 'missing-negative-corpus',
      cases: [{
        caseId: 'positive-only',
        candidateId: 'cand-fit',
        challengePacketId: 'packet-typescript',
        expectedVerdict: 'strong_match',
        expectedReasonCategory: 'aligned',
        negativeCandidateId: 'cand-negative',
        minimumScoreSeparation: 0.2,
      }],
      thresholds: {
        minAccuracy: 1,
        minAverageScoreSeparation: 0.2,
        minUsableChallengeRate: 1,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.metrics.negativeCaseCount).toBe(0);
    expect(result.metrics.insufficientEvidenceCaseCount).toBe(0);
    expect(result.gateFailures).toContain('negative cases 0 below 1');
    expect(result.gateFailures).toContain('insufficient-evidence cases 0 below 1');
  });

  it('fails the gate when non-positive cases never prove insufficient evidence', async () => {
    const db = createMockD1(sqlite) as unknown as D1Database;
    seedCronSchedulePacket(sqlite);
    seedCandidate(sqlite, 'cand-workflows-adjacent', 'wp-workflows-adjacent');
    seedEvidence(sqlite, 'wp-workflows-adjacent', 'workflow', 'code_review', 0.95);
    seedEvidence(sqlite, 'wp-workflows-adjacent', 'wrangler', 'assessment', 0.9);

    const result = await runMatchQualityEvaluation(db, {
      corpusId: 'needs-review-only-negative-corpus',
      cases: [{
        caseId: 'needs-review-is-not-insufficient',
        candidateId: 'cand-workflows-adjacent',
        challengePacketId: 'packet-cron-schedule',
        expectedVerdict: 'needs_review',
        expectedReasonCategory: 'needs_challenge_design',
      }],
      thresholds: {
        minAccuracy: 1,
        minAverageScoreSeparation: 0,
        minUsableChallengeRate: 1,
        minContrastCaseCount: 0,
      },
    });

    expect(result.pairResults[0].computedVerdict).toBe('needs_review');
    expect(result.pairResults[0].failedReasons).toEqual([]);
    expect(result.metrics.negativeCaseCount).toBe(1);
    expect(result.metrics.insufficientEvidenceCaseCount).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.gateFailures).toContain('insufficient-evidence cases 0 below 1');
  });

  it('fails the gate when the corpus has no explicit contrast candidate', async () => {
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await runMatchQualityEvaluation(db, {
      corpusId: 'missing-contrast-corpus',
      cases: [
        {
          caseId: 'positive-no-contrast',
          candidateId: 'cand-fit',
          challengePacketId: 'packet-typescript',
          expectedVerdict: 'strong_match',
          expectedReasonCategory: 'aligned',
        },
        {
          caseId: 'negative-no-contrast',
          candidateId: 'cand-negative',
          challengePacketId: 'packet-typescript',
          expectedVerdict: 'insufficient_evidence',
          expectedReasonCategory: 'insufficient_evidence',
          requireCandidateEvidence: false,
        },
      ],
      thresholds: {
        minAccuracy: 1,
        minAverageScoreSeparation: 0,
        minUsableChallengeRate: 1,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.metrics.negativeCaseCount).toBe(1);
    expect(result.metrics.insufficientEvidenceCaseCount).toBe(1);
    expect(result.metrics.contrastCaseCount).toBe(0);
    expect(result.gateFailures).toContain('contrast cases 0 below 1');
  });
});
