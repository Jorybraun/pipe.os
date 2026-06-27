import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { ingestCodeReviewAssessmentEvidence } from '../codeReviewEvidence';

const livingContextMigrationSql = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigrationSql = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const assessmentLayerMigrationSql = readFileSync(
  new URL('../../../../migrations/0102_assessment_layer.sql', import.meta.url),
  'utf8',
);
const repoTaskCompatMigrationSql = readFileSync(
  new URL('../../../../migrations/0103_assessment_layer_repo_task_compat.sql', import.meta.url),
  'utf8',
);

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('ingestCodeReviewAssessmentEvidence', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigrationSql);
    sqlite.exec(contextRecordsMigrationSql);
    sqlite.exec(assessmentLayerMigrationSql);
    sqlite.exec(repoTaskCompatMigrationSql);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('projects a completed scored CODE_REVIEW into exact-source assessment evidence', async () => {
    const transcript = {
      rounds: [{
        candidate_comments: [{
          id: 'comment-1',
          filePath: 'src/retry.ts',
          lineNumber: 18,
          body: 'This retry path needs a regression test.',
          severity: 'major',
        }],
        implementer_response: {
          summary: 'Why is that necessary?',
          threads: [],
        },
      }],
      verdict: {
        decision: 'request_changes',
        summary: 'Add the missing retry regression.',
        submittedAt: '2026-06-27T18:00:00.000Z',
      },
    };
    const scoreReport = {
      overall: {
        score: 82,
        band: 'strong',
        narrative: 'Candidate found the missing retry test and defended the review.',
      },
      dimensions: {
        issue_identification: 4,
      },
    };
    const transcriptJson = JSON.stringify(transcript);
    const scoreReportJson = JSON.stringify(scoreReport);

    await ingestCodeReviewAssessmentEvidence(db, {
      sessionId: 'review-session-1',
      candidateId: 'candidate-1',
      challengeId: 'challenge-1',
      assessmentId: 'assessment-1',
      transcript,
      scoreReportJson,
      observedAt: '2026-06-27T18:02:00.000Z',
      startedAt: '2026-06-27T17:55:00.000Z',
      producer: 'automated_scorer',
    });

    const session = sqlite.prepare(
      `SELECT mode, state, candidate_id, metadata_json
         FROM assessment_sessions
        WHERE ingestion_key = ?`,
    ).get('assessment-session:code-review:review-session-1') as {
      mode: string;
      state: string;
      candidate_id: string;
      metadata_json: string;
    };
    expect(session).toMatchObject({
      mode: 'CODE_REVIEW',
      state: 'EVALUATED',
      candidate_id: 'candidate-1',
    });
    expect(JSON.parse(session.metadata_json)).toMatchObject({
      reviewSessionId: 'review-session-1',
      challengeId: 'challenge-1',
      assessmentId: 'assessment-1',
    });

    const eventRefs = sqlite.prepare(
      `SELECT e.kind, r.source_ref_type, r.source_ref_id, r.exact_text, r.content_hash
         FROM assessment_evidence_events e
         JOIN assessment_event_source_refs r ON r.event_id = e.id
        ORDER BY e.sequence ASC`,
    ).all() as Array<{
      kind: string;
      source_ref_type: string;
      source_ref_id: string;
      exact_text: string;
      content_hash: string;
    }>;
    expect(eventRefs).toEqual([
      {
        kind: 'final_submission',
        source_ref_type: 'code_review_transcript',
        source_ref_id: 'review-session-1',
        exact_text: transcriptJson,
        content_hash: await sha256Hex(transcriptJson),
      },
      {
        kind: 'automated_score_report',
        source_ref_type: 'code_review_score_report',
        source_ref_id: 'review-session-1',
        exact_text: scoreReportJson,
        content_hash: await sha256Hex(scoreReportJson),
      },
    ]);

    const report = sqlite.prepare(
      `SELECT status, summary, output_json, context_record_id
         FROM assessment_evaluation_reports`,
    ).get() as {
      status: string;
      summary: string;
      output_json: string;
      context_record_id: string;
    };
    expect(report.status).toBe('EVALUATED');
    expect(report.summary).toBe('Candidate found the missing retry test and defended the review.');
    expect(JSON.parse(report.output_json)).toMatchObject({
      overall: {
        score: 82,
        band: 'strong',
      },
    });

    const claimRefs = sqlite.prepare(
      `SELECT c.polarity, c.dimension, r.source_ref_type, r.source_ref_id
         FROM assessment_evaluation_claims c
         JOIN assessment_claim_source_refs r ON r.claim_id = c.id
        ORDER BY r.source_ref_type`,
    ).all() as Array<{
      polarity: string;
      dimension: string;
      source_ref_type: string;
      source_ref_id: string;
    }>;
    expect(claimRefs).toEqual([
      {
        polarity: 'positive',
        dimension: 'code_review_overall',
        source_ref_type: 'code_review_score_report',
        source_ref_id: 'review-session-1',
      },
      {
        polarity: 'positive',
        dimension: 'code_review_overall',
        source_ref_type: 'code_review_transcript',
        source_ref_id: 'review-session-1',
      },
    ]);

    expect(sqlite.prepare(
      `SELECT predicate
         FROM context_records
        WHERE id = ?`,
    ).get(report.context_record_id)).toEqual({
      predicate: 'summarizes assessment evidence',
    });
  });
});
