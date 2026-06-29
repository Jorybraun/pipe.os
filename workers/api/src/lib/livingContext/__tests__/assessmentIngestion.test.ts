import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { ingestAssessmentToLivingContext } from '../assessmentIngestion';
import type {
  AssessmentSessionRow,
  AssessmentEvidenceEventRow,
  AssessmentEventSourceRefRow,
  AssessmentEvaluationReportRow,
  AssessmentEvaluationClaimRow,
  AssessmentClaimSourceRefRow,
} from '../assessmentIngestion';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

function rewriteNumberedParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?(\d+)/g, () => {
    index++;
    return '?';
  });
}

describe('ingestAssessmentToLivingContext', () => {
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
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        phone TEXT,
        company TEXT,
        role TEXT,
        type TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(rewriteNumberedParams(transcriptProjectionMigration));
    sqlite.exec(rewriteNumberedParams(contextRecordMigration));

    sqlite.exec(`
      INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
      VALUES ('cand-1', 'owner-1', 'pipe-1', 'Alice', 'alice@test.dev', 'active');
    `);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns null for session without candidate_id', async () => {
    const session: AssessmentSessionRow = {
      id: 'sess-no-cand',
      interview_id: null,
      mode: 'CODE_REVIEW',
      state: 'EVALUATED',
      candidate_id: null,
      workspace_id: null,
      workspace_person_id: null,
      application_id: null,
      metadata_json: '{}',
      started_at: null,
      submitted_at: null,
      completed_at: null,
      created_at: '2026-06-01T00:00:00Z',
    };
    const result = await ingestAssessmentToLivingContext(
      db, session, [], new Map(), [], [], new Map(),
    );
    expect(result).toBeNull();
  });

  it('ingests assessment events as episodes + assertions + context records', async () => {
    const session: AssessmentSessionRow = {
      id: 'sess-1',
      interview_id: 'int-1',
      mode: 'CODE_REVIEW',
      state: 'EVALUATED',
      candidate_id: 'cand-1',
      workspace_id: 'owner-1',
      workspace_person_id: null,
      application_id: null,
      metadata_json: '{"challenge":"bug-fix"}',
      started_at: '2026-06-01T10:00:00Z',
      submitted_at: '2026-06-01T10:30:00Z',
      completed_at: '2026-06-01T10:35:00Z',
      created_at: '2026-06-01T09:55:00Z',
    };

    const events: AssessmentEvidenceEventRow[] = [
      {
        id: 'ev-1',
        ingestion_key: 'ev-1',
        session_id: 'sess-1',
        sequence: 1,
        kind: 'file_open',
        actor_type: 'candidate',
        actor_id: 'cand-1',
        narrative: 'Candidate opened src/utils.ts and began reading the code',
        payload_json: '{"file":"src/utils.ts"}',
        context_record_id: null,
        occurred_at: '2026-06-01T10:01:00Z',
      },
      {
        id: 'ev-2',
        ingestion_key: 'ev-2',
        session_id: 'sess-1',
        sequence: 2,
        kind: 'code_edit',
        actor_type: 'candidate',
        actor_id: 'cand-1',
        narrative: 'Applied fix to null pointer dereference in parseInput function',
        payload_json: '{"file":"src/utils.ts","line":42}',
        context_record_id: null,
        occurred_at: '2026-06-01T10:05:00Z',
      },
    ];

    const result = await ingestAssessmentToLivingContext(
      db, session, events, new Map(), [], [], new Map(),
    );

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('sess-1');
    expect(result!.episodeCount).toBe(2);
    expect(result!.assertionCount).toBe(2);
    expect(result!.contextRecordCount).toBe(2);
    expect(result!.claimAssertionCount).toBe(0);

    const interaction = sqlite.prepare(
      `SELECT * FROM interactions WHERE external_reference = 'sess-1'`,
    ).get() as Record<string, unknown>;
    expect(interaction).toBeTruthy();
    expect(interaction.interaction_type).toBe('assessment:CODE_REVIEW');

    const episodes = sqlite.prepare(
      `SELECT * FROM episodes ORDER BY started_at`,
    ).all() as Array<Record<string, unknown>>;
    expect(episodes.length).toBe(2);

    const assertions = sqlite.prepare(
      `SELECT * FROM semantic_assertions ORDER BY observed_at`,
    ).all() as Array<Record<string, unknown>>;
    expect(assertions.length).toBe(2);
    expect(assertions[0].predicate).toBe('assessment:file_open');
    expect(assertions[1].predicate).toBe('assessment:code_edit');

    const contextRecords = sqlite.prepare(
      `SELECT * FROM context_records ORDER BY observed_at`,
    ).all() as Array<Record<string, unknown>>;
    expect(contextRecords.length).toBe(2);
  });

  it('ingests evaluation claims with source provenance', async () => {
    const session: AssessmentSessionRow = {
      id: 'sess-2',
      interview_id: null,
      mode: 'OPEN_SOURCE_BUG_FIX',
      state: 'EVALUATED',
      candidate_id: 'cand-1',
      workspace_id: 'owner-1',
      workspace_person_id: null,
      application_id: null,
      metadata_json: '{}',
      started_at: '2026-06-02T10:00:00Z',
      submitted_at: '2026-06-02T11:00:00Z',
      completed_at: '2026-06-02T11:05:00Z',
      created_at: '2026-06-02T09:55:00Z',
    };

    const reports: AssessmentEvaluationReportRow[] = [
      {
        id: 'report-1',
        session_id: 'sess-2',
        status: 'EVALUATED',
        summary: 'Strong debugging and code comprehension skills demonstrated',
        output_json: '{}',
        created_at: '2026-06-02T11:05:00Z',
      },
    ];

    const claims: AssessmentEvaluationClaimRow[] = [
      {
        id: 'claim-1',
        report_id: 'report-1',
        polarity: 'positive',
        dimension: 'debugging_skill',
        narrative: 'Quickly identified root cause of null pointer in parseInput',
        confidence: 0.92,
        created_at: '2026-06-02T11:05:00Z',
      },
      {
        id: 'claim-2',
        report_id: 'report-1',
        polarity: 'negative',
        dimension: 'test_coverage',
        narrative: 'Did not add regression test for the fix',
        confidence: 0.85,
        created_at: '2026-06-02T11:05:00Z',
      },
    ];

    const claimSourceRefs = new Map<string, AssessmentClaimSourceRefRow[]>();
    claimSourceRefs.set('claim-1', [
      {
        id: 'csr-1',
        claim_id: 'claim-1',
        source_ref_type: 'assessment_evidence_event',
        source_ref_id: 'ev-fix-1',
        source_span_id: null,
        evidence_role: 'support',
        locator_json: '{"file":"src/utils.ts","line":42}',
        exact_text: 'Fixed null check in parseInput',
        content_hash: 'abc123',
        metadata_json: '{}',
      },
    ]);

    const result = await ingestAssessmentToLivingContext(
      db, session, [], new Map(), reports, claims, claimSourceRefs,
    );

    expect(result).not.toBeNull();
    expect(result!.claimAssertionCount).toBe(2);
    expect(result!.episodeCount).toBe(2);
    expect(result!.contextRecordCount).toBe(2);

    const assertions = sqlite.prepare(
      `SELECT * FROM semantic_assertions WHERE predicate LIKE 'evaluation:%' ORDER BY observed_at`,
    ).all() as Array<Record<string, unknown>>;
    expect(assertions.length).toBe(2);
    expect(assertions[0].predicate).toBe('evaluation:debugging_skill');
    expect(assertions[1].predicate).toBe('evaluation:test_coverage');
    expect(assertions[0].polarity).toBe(1);
    expect(assertions[1].polarity).toBe(-1);

    const contextRecords = sqlite.prepare(
      `SELECT * FROM context_records WHERE record_type LIKE 'evaluation:%' ORDER BY observed_at`,
    ).all() as Array<Record<string, unknown>>;
    expect(contextRecords.length).toBe(2);
    expect(contextRecords[0].predicate).toBe('positive');
    expect(contextRecords[1].predicate).toBe('negative');
  });

  it('is idempotent — running twice produces the same entity count', async () => {
    const session: AssessmentSessionRow = {
      id: 'sess-idem',
      interview_id: null,
      mode: 'CODE_REVIEW',
      state: 'EVALUATED',
      candidate_id: 'cand-1',
      workspace_id: 'owner-1',
      workspace_person_id: null,
      application_id: null,
      metadata_json: '{}',
      started_at: '2026-06-03T10:00:00Z',
      submitted_at: null,
      completed_at: '2026-06-03T10:30:00Z',
      created_at: '2026-06-03T09:55:00Z',
    };

    const events: AssessmentEvidenceEventRow[] = [
      {
        id: 'idem-ev-1',
        ingestion_key: 'idem-ev-1',
        session_id: 'sess-idem',
        sequence: 1,
        kind: 'submission',
        actor_type: 'candidate',
        actor_id: 'cand-1',
        narrative: 'Candidate submitted final fix',
        payload_json: '{}',
        context_record_id: null,
        occurred_at: '2026-06-03T10:25:00Z',
      },
    ];

    const first = await ingestAssessmentToLivingContext(
      db, session, events, new Map(), [], [], new Map(),
    );
    const interactionsAfterFirst = sqlite.prepare(
      `SELECT COUNT(*) as cnt FROM interactions`,
    ).get() as Record<string, unknown>;

    const second = await ingestAssessmentToLivingContext(
      db, session, events, new Map(), [], [], new Map(),
    );
    const interactionsAfterSecond = sqlite.prepare(
      `SELECT COUNT(*) as cnt FROM interactions`,
    ).get() as Record<string, unknown>;

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(interactionsAfterFirst.cnt).toBe(interactionsAfterSecond.cnt);
  });
});
