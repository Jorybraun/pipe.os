import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  ingestCodeReviewScoreReportToLivingContext,
  ingestCodeReviewTranscriptToLivingContext,
  type CodeReviewTranscript,
} from '../codeReview';



const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const repoGraphMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);



function count(sqlite: BetterSqliteDb, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  }).count;
}

function transcript(withVerdict: boolean): CodeReviewTranscript {
  return {
    rounds: [
      {
        round: 1,
        reviewer_comments: [
          {
            id: 1,
            file: 'src/orders.ts',
            line: 42,
            category: null,
            severity: 'blocking',
            what: 'This retry loop can publish the same order twice.\nThe offset is committed too early.',
            why: 'A crash between publish and acknowledgement replays the message.',
            suggestion: 'Commit only after the publish is acknowledged.',
            positive: false,
          },
        ],
        reviewer_summary: 'The ordering bug is release-blocking.',
        implementer_responses: [
          {
            to_comment_id: 1,
            move: 'change',
            content: 'I moved the commit after the publish acknowledgement.',
            updated_code: 'await publish(order);\nawait commit(offset);',
          },
        ],
      },
    ],
    explainer_exchanges: [
      {
        round: 1,
        question: {
          text: 'Where is the consumer retry policy configured?',
          file: 'src/orders.ts',
          line: 18,
        },
        answer: {
          content: 'The retry policy is supplied when the consumer is constructed.',
          context_provided: ['surrounding_code'],
          depth_level: 'moderate',
        },
      },
    ],
    ...(withVerdict
      ? {
          verdict: {
            decision: 'request_changes',
            summary: 'The revised order is safer, but the failure path still needs a test.',
            submittedAt: '2026-06-13T22:15:00.000Z',
          },
        }
      : {}),
  };
}

describe('code-review living-context ingestion', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pipeline_id TEXT,
        name TEXT,
        email TEXT,
        status TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(`
      CREATE TABLE qualified_repos (
        id INTEGER PRIMARY KEY,
        github_url TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL
      );

      CREATE TABLE candidate_challenge_assignment (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        challenge_id TEXT NOT NULL,
        repo_id INTEGER,
        github_repo_url TEXT,
        github_pr_number INTEGER,
        issue_number INTEGER,
        assigned_at TEXT NOT NULL
      );
    `);
    sqlite.exec(repoGraphMigration);
    sqlite.exec(contextRecordMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-1',
      'workspace-1',
      'pipeline-1',
      'Ada Example',
      'ada@example.com',
      'active',
    );
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('versions exact review text and attributes only candidate-authored spans', async () => {
    const base = {
      sessionId: 'review-1',
      candidateId: 'candidate-1',
      challengeId: 'challenge-1',
      assessmentId: 'assessment-1',
      implementerPersona: 'junior',
      startedAt: '2026-06-13T22:00:00.000Z',
    };
    await ingestCodeReviewTranscriptToLivingContext(db, {
      ...base,
      transcript: transcript(false),
      status: 'in_progress',
      observedAt: '2026-06-13T22:10:00.000Z',
    });
    await ingestCodeReviewTranscriptToLivingContext(db, {
      ...base,
      transcript: transcript(true),
      status: 'verdict_submitted',
      endedAt: '2026-06-13T22:15:00.000Z',
      observedAt: '2026-06-13T22:15:00.000Z',
    });
    await ingestCodeReviewTranscriptToLivingContext(db, {
      ...base,
      transcript: transcript(true),
      status: 'verdict_submitted',
      endedAt: '2026-06-13T22:15:00.000Z',
      observedAt: '2026-06-13T22:15:00.000Z',
    });

    expect(count(sqlite, 'interactions')).toBe(1);
    expect(count(sqlite, 'artifacts')).toBe(1);
    expect(count(sqlite, 'artifact_versions')).toBe(2);
    expect(count(sqlite, 'context_records')).toBe(2);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
    expect(count(sqlite, 'signal_evidence')).toBe(0);
    expect(count(sqlite, 'projection_outbox')).toBe(2);

    const latest = sqlite.prepare(
      `SELECT av.id, av.content_text
         FROM artifact_versions av
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE a.artifact_type = 'code_review_transcript'
        ORDER BY av.version_number DESC
        LIMIT 1`,
    ).get() as { id: string; content_text: string };
    const spans = sqlite.prepare(
      `SELECT exact_text, char_start, char_end, metadata_json
         FROM source_spans
        WHERE artifact_version_id = ?
        ORDER BY char_start`,
    ).all(latest.id) as Array<{
      exact_text: string;
      char_start: number;
      char_end: number;
      metadata_json: string;
    }>;
    expect(spans.length).toBe(10);
    for (const span of spans) {
      expect(latest.content_text.slice(span.char_start, span.char_end)).toBe(span.exact_text);
    }
    expect(sqlite.prepare(
      `SELECT cr.record_type, cr.predicate, COUNT(crss.source_span_id) AS source_count
         FROM context_records cr
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
        WHERE cr.record_type = 'code_review_transcript'
        GROUP BY cr.id
        ORDER BY cr.observed_at DESC
        LIMIT 1`,
    ).get()).toEqual({
      record_type: 'code_review_transcript',
      predicate: 'preserves code review transcript',
      source_count: 10,
    });
    expect(spans.map((span) => span.exact_text)).toContain(
      'This retry loop can publish the same order twice.\nThe offset is committed too early.',
    );
    expect(spans.map((span) => span.exact_text)).toContain(
      'The revised order is safer, but the failure path still needs a test.',
    );

    const attributed = sqlite.prepare(
      `SELECT ss.exact_text
         FROM source_span_attributions ssa
         JOIN source_spans ss ON ss.id = ssa.source_span_id
        WHERE ss.artifact_version_id = ?
        ORDER BY ss.char_start`,
    ).all(latest.id) as Array<{ exact_text: string }>;
    expect(attributed.map((row) => row.exact_text)).toContain(
      'Where is the consumer retry policy configured?',
    );
    expect(attributed.map((row) => row.exact_text)).not.toContain(
      'I moved the commit after the publish acknowledgement.',
    );

    const interaction = sqlite.prepare(
      'SELECT started_at, ended_at FROM interactions',
    ).get();
    expect(interaction).toEqual({
      started_at: base.startedAt,
      ended_at: '2026-06-13T22:15:00.000Z',
    });
  });

  it('preserves scorer and recruiter reports without candidate attribution or signals', async () => {
    const common = {
      sessionId: 'review-2',
      candidateId: 'candidate-1',
      challengeId: 'challenge-2',
      assessmentId: 'assessment-2',
      startedAt: '2026-06-13T23:00:00.000Z',
    };
    await ingestCodeReviewScoreReportToLivingContext(db, {
      ...common,
      scoreReportJson: '{"overall":{"score":72},"evidence":"generated"}',
      observedAt: '2026-06-13T23:20:00.000Z',
      producer: 'automated_scorer',
    });
    await ingestCodeReviewScoreReportToLivingContext(db, {
      ...common,
      scoreReportJson: '{"overall":{"score":76},"evidence":"reviewed"}',
      observedAt: '2026-06-13T23:30:00.000Z',
      producer: 'recruiter_override',
      producerId: 'recruiter-1',
    });

    expect(count(sqlite, 'interactions')).toBe(1);
    expect(count(sqlite, 'artifacts')).toBe(2);
    expect(count(sqlite, 'artifact_versions')).toBe(2);
    expect(count(sqlite, 'source_spans')).toBe(2);
    expect(count(sqlite, 'context_records')).toBe(2);
    expect(count(sqlite, 'context_record_source_spans')).toBe(2);
    expect(count(sqlite, 'source_span_attributions')).toBe(0);
    expect(count(sqlite, 'semantic_assertions')).toBe(0);
    expect(count(sqlite, 'signal_evidence')).toBe(0);
    expect(count(sqlite, 'projection_outbox')).toBe(2);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_records
        WHERE record_type = 'code_review_score_report'
          AND predicate = 'preserves code review score report'`,
    ).get()).toEqual({ count: 2 });
  });

  it('links completed review transcript evidence to the selected packet and match decision', async () => {
    sqlite.prepare(
      `INSERT INTO qualified_repos (id, github_url, full_name)
       VALUES (?, ?, ?)`,
    ).run(44, 'https://github.com/mui/base-ui', 'mui/base-ui');
    sqlite.prepare(
      `INSERT INTO candidate_challenge_assignment (
         id, candidate_id, stage_id, challenge_id, repo_id,
         github_repo_url, github_pr_number, issue_number, assigned_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'assignment-1',
      'candidate-1',
      'stage-1',
      'challenge-1',
      44,
      'https://github.com/mui/base-ui',
      973,
      null,
      '2026-06-13T22:01:00.000Z',
    );
    sqlite.prepare(
      `INSERT INTO repo_snapshots (id, repo_id, commit_sha, extractor_version)
       VALUES (?, ?, ?, ?)`,
    ).run('snapshot-1', 44, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'test-extractor-v1');
    sqlite.prepare(
      `INSERT INTO review_challenge_packets (
         id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash,
         language, production_ready, quality_score, demand_families_json,
         packet_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'packet-1',
      'snapshot-1',
      44,
      973,
      'packet-v1',
      'packet-hash-1',
      'TypeScript',
      1,
      0.94,
      '["ui-event-semantics"]',
      '{"pullRequest":{"title":"Better handle impatient clicks"}}',
      1,
      1,
    );
    sqlite.prepare(
      `INSERT INTO match_runs (
         id, candidate_id, application_id, role_context_id,
         candidate_snapshot_id, role_snapshot_id, policy_version, model_version,
         status, query_json, recalled_packets_json, excluded_packets_json,
         ranked_results_json, selected_packet_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'match-run-1',
      'candidate-1',
      null,
      'role-context-1',
      'candidate-snapshot-1',
      'role-snapshot-1',
      'candidate-safe-matcher-v1',
      null,
      'MATCHED',
      '{}',
      '[]',
      '[]',
      '[]',
      'packet-1',
      10,
    );

    await ingestCodeReviewTranscriptToLivingContext(db, {
      sessionId: 'review-1',
      candidateId: 'candidate-1',
      challengeId: 'challenge-1',
      assessmentId: 'assessment-1',
      implementerPersona: 'junior',
      startedAt: '2026-06-13T22:00:00.000Z',
      endedAt: '2026-06-13T22:15:00.000Z',
      transcript: transcript(true),
      status: 'verdict_submitted',
      observedAt: '2026-06-13T22:15:00.000Z',
    });

    const record = sqlite.prepare(
      `SELECT id, qualifiers_json
         FROM context_records
        WHERE record_type = 'code_review_transcript'
        ORDER BY observed_at DESC
        LIMIT 1`,
    ).get() as { id: string; qualifiers_json: string };
    const qualifiers = JSON.parse(record.qualifiers_json) as {
      finalVerdictDecision: string;
      selectedReviewChallenge: {
        assignmentId: string;
        packetId: string;
        matchRunId: string;
        repoUrl: string;
        prNumber: number;
      };
    };
    expect(qualifiers.finalVerdictDecision).toBe('request_changes');
    expect(qualifiers.selectedReviewChallenge).toMatchObject({
      assignmentId: 'assignment-1',
      packetId: 'packet-1',
      matchRunId: 'match-run-1',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 973,
    });

    const sourceRefs = sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, evidence_role, content_hash
         FROM context_record_source_refs
        WHERE context_record_id = ?
        ORDER BY source_ref_type, evidence_role`,
    ).all(record.id);
    expect(sourceRefs).toEqual(expect.arrayContaining([
      {
        source_ref_type: 'review_challenge_packet',
        source_ref_id: 'packet-1',
        evidence_role: 'selected_review_challenge',
        content_hash: 'packet-hash-1',
      },
      {
        source_ref_type: 'match_run',
        source_ref_id: 'match-run-1',
        evidence_role: 'repo_match_decision',
        content_hash: null,
      },
      {
        source_ref_type: 'candidate_challenge_assignment',
        source_ref_id: 'assignment-1',
        evidence_role: 'challenge_selection',
        content_hash: null,
      },
    ]));

    const entities = sqlite.prepare(
      `SELECT entity_type, entity_id, relationship
         FROM context_record_entities
        WHERE context_record_id = ?
        ORDER BY entity_type, relationship`,
    ).all(record.id);
    expect(entities).toEqual(expect.arrayContaining([
      {
        entity_type: 'review_challenge_packet',
        entity_id: 'packet-1',
        relationship: 'selected_challenge_packet',
      },
      {
        entity_type: 'match_run',
        entity_id: 'match-run-1',
        relationship: 'selection_decision',
      },
      {
        entity_type: 'code_review_verdict',
        entity_id: null,
        relationship: 'candidate_verdict',
      },
    ]));
  });

  it('uses the highest-quality production-ready packet when older match provenance points elsewhere', async () => {
    sqlite.prepare(
      `INSERT INTO qualified_repos (id, github_url, full_name)
       VALUES (?, ?, ?)`,
    ).run(45, 'https://github.com/mui/base-ui', 'mui/base-ui');
    sqlite.prepare(
      `INSERT INTO candidate_challenge_assignment (
         id, candidate_id, stage_id, challenge_id, repo_id,
         github_repo_url, github_pr_number, issue_number, assigned_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'assignment-high-quality',
      'candidate-1',
      'stage-1',
      'challenge-1',
      45,
      'https://github.com/mui/base-ui',
      5110,
      null,
      '2026-06-13T22:01:00.000Z',
    );
    sqlite.prepare(
      `INSERT INTO repo_snapshots (id, repo_id, commit_sha, extractor_version)
       VALUES (?, ?, ?, ?)`,
    ).run('snapshot-low', 45, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'test-extractor-v1');
    sqlite.prepare(
      `INSERT INTO repo_snapshots (id, repo_id, commit_sha, extractor_version)
       VALUES (?, ?, ?, ?)`,
    ).run('snapshot-high', 45, 'cccccccccccccccccccccccccccccccccccccccc', 'test-extractor-v1');
    sqlite.prepare(
      `INSERT INTO review_challenge_packets (
         id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash,
         language, production_ready, quality_score, demand_families_json,
         packet_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'packet-low',
      'snapshot-low',
      45,
      5110,
      'packet-v1',
      'packet-low-hash',
      'TypeScript',
      1,
      0.70,
      '["ui-event-semantics"]',
      '{"pullRequest":{"title":"Older packet"}}',
      1,
      1,
    );
    sqlite.prepare(
      `INSERT INTO review_challenge_packets (
         id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash,
         language, production_ready, quality_score, demand_families_json,
         packet_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'packet-high',
      'snapshot-high',
      45,
      5110,
      'packet-v2',
      'packet-high-hash',
      'TypeScript',
      1,
      0.96,
      '["ui-event-semantics"]',
      '{"pullRequest":{"title":"Highest quality packet"}}',
      2,
      2,
    );
    sqlite.prepare(
      `INSERT INTO match_runs (
         id, candidate_id, application_id, role_context_id,
         candidate_snapshot_id, role_snapshot_id, policy_version, model_version,
         status, query_json, recalled_packets_json, excluded_packets_json,
         ranked_results_json, selected_packet_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'match-run-low',
      'candidate-1',
      null,
      'role-context-1',
      'candidate-snapshot-1',
      'role-snapshot-1',
      'candidate-safe-matcher-v1',
      null,
      'MATCHED',
      '{}',
      '[]',
      '[]',
      '[]',
      'packet-low',
      10,
    );

    await ingestCodeReviewTranscriptToLivingContext(db, {
      sessionId: 'review-high-quality',
      candidateId: 'candidate-1',
      challengeId: 'challenge-1',
      assessmentId: 'assessment-1',
      implementerPersona: 'junior',
      startedAt: '2026-06-13T22:00:00.000Z',
      endedAt: '2026-06-13T22:15:00.000Z',
      transcript: transcript(true),
      status: 'verdict_submitted',
      observedAt: '2026-06-13T22:15:00.000Z',
    });

    const record = sqlite.prepare(
      `SELECT id, qualifiers_json
         FROM context_records
        WHERE ingestion_key LIKE 'code-review:review-high-quality:%:context'
        LIMIT 1`,
    ).get() as { id: string; qualifiers_json: string };
    const qualifiers = JSON.parse(record.qualifiers_json) as {
      selectedReviewChallenge: {
        packetId: string;
        matchRunId: string | null;
      };
    };
    expect(qualifiers.selectedReviewChallenge).toMatchObject({
      packetId: 'packet-high',
      matchRunId: null,
    });

    const sourceRefs = sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, evidence_role, content_hash
         FROM context_record_source_refs
        WHERE context_record_id = ?`,
    ).all(record.id);
    expect(sourceRefs).toEqual(expect.arrayContaining([
      {
        source_ref_type: 'review_challenge_packet',
        source_ref_id: 'packet-high',
        evidence_role: 'selected_review_challenge',
        content_hash: 'packet-high-hash',
      },
    ]));
    expect(sourceRefs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_ref_type: 'review_challenge_packet',
        source_ref_id: 'packet-low',
      }),
      expect.objectContaining({
        source_ref_type: 'match_run',
        source_ref_id: 'match-run-low',
      }),
    ]));
  });
});
