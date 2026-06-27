import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../src/__tests__/helpers/mockD1';
import type { CodeReviewTranscript } from '../src/lib/livingContext';
import {
  backfillCodeReviewSessions,
  emptyEntityStats,
  type D1Like,
  type Options,
} from './backfillLivingContext';

const livingContextMigration = readFileSync(
  new URL('../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const repoGraphMigration = readFileSync(
  new URL('../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const candidateNodesMigration = readFileSync(
  new URL('../migrations/0052_candidate_nodes.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);

function transcript(): CodeReviewTranscript {
  return {
    rounds: [
      {
        round: 1,
        reviewer_comments: [
          {
            id: 1,
            file: 'packages/react/src/popover/root/usePopoverRoot.ts',
            line: 66,
            category: null,
            severity: 'major',
            what: 'The impatient click threshold needs direct regression coverage.',
            why: 'A real user can click during the hover-open transition.',
            suggestion: 'Add a focused impatient-click test.',
            positive: false,
          },
        ],
        reviewer_summary: 'The behavior is reviewable but needs a targeted test.',
        implementer_responses: [
          {
            to_comment_id: 1,
            move: 'pushback',
            content: 'Can you point to a visible failure?',
          },
        ],
      },
    ],
    verdict: {
      decision: 'request_changes',
      summary: 'Please add the impatient-click regression before merging.',
      submittedAt: '2026-06-13T22:15:00.000Z',
    },
  };
}

function options(): Options {
  return {
    target: 'local',
    batchSize: 100,
    dryRun: false,
    extractCultureSemantics: false,
  };
}

describe('backfillLivingContext', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Like;

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

      CREATE TABLE review_sessions (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        challenge_id TEXT NOT NULL,
        assessment_id TEXT NOT NULL,
        implementer_persona TEXT NOT NULL,
        status TEXT NOT NULL,
        transcript TEXT,
        score_report TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    sqlite.exec(candidateNodesMigration);
    sqlite.exec(livingContextMigration);
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
    sqlite.prepare(
      `INSERT INTO review_sessions (
         id, candidate_id, challenge_id, assessment_id,
         implementer_persona, status, transcript, score_report,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'review-session-1',
      'candidate-1',
      'challenge-1',
      'assessment-1',
      'junior',
      'verdict_submitted',
      JSON.stringify(transcript()),
      null,
      '2026-06-13T22:00:00.000Z',
      '2026-06-13T22:15:00.000Z',
    );
    db = createMockD1(sqlite) as unknown as D1Like;
  });

  afterEach(() => {
    sqlite.close();
  });

  it('rebuilds completed CODE_REVIEW sessions with selected challenge and verdict provenance', async () => {
    const stats = emptyEntityStats();

    await backfillCodeReviewSessions(db, options(), stats);

    expect(stats).toMatchObject({
      discovered: 1,
      processed: 1,
      failed: 0,
    });

    const record = sqlite.prepare(
      `SELECT id, qualifiers_json
         FROM context_records
        WHERE record_type = 'code_review_transcript'
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
        WHERE context_record_id = ?`,
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
        WHERE context_record_id = ?`,
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
});
