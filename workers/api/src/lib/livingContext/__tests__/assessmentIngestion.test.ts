import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  ingestAssessmentToLivingContext,
  loadAssessmentSessionData,
  ingestAssessmentSessionRealTime,
} from '../assessmentIngestion';
import { recordAssessmentCandidateProfileEvidence } from '../../assessmentLayer/candidateProfileEvidence';
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
    expect(result!.claimAssertionCount).toBe(1);
    expect(result!.episodeCount).toBe(1);
    expect(result!.contextRecordCount).toBe(2);

    const assertions = sqlite.prepare(
      `SELECT * FROM semantic_assertions WHERE predicate LIKE 'evaluation:%' ORDER BY observed_at`,
    ).all() as Array<Record<string, unknown>>;
    expect(assertions.length).toBe(1);
    expect(assertions[0].predicate).toBe('evaluation:debugging_skill');
    expect(assertions[0].polarity).toBe(1);
    expect(assertions.some((assertion) => assertion.predicate === 'evaluation:test_coverage')).toBe(false);

    const contextRecords = sqlite.prepare(
      `SELECT * FROM context_records WHERE record_type LIKE 'evaluation:%' ORDER BY observed_at`,
    ).all() as Array<Record<string, unknown>>;
    expect(contextRecords.length).toBe(1);
    expect(contextRecords[0].predicate).toBe('positive');
    expect(contextRecords.some((record) => record.narrative === 'Did not add regression test for the fix')).toBe(false);

    const reportRecord = sqlite.prepare(
      `SELECT cr.record_type, cr.predicate, cr.narrative,
              sr.source_ref_type, sr.source_ref_id, sr.evidence_role, sr.exact_text
         FROM context_records cr
         JOIN context_record_source_refs sr ON sr.context_record_id = cr.id
        WHERE cr.ingestion_key = 'assessment_report_context:report-1'`,
    ).get() as Record<string, unknown>;
    expect(reportRecord).toEqual({
      record_type: 'assessment_evaluation_report',
      predicate: 'EVALUATED',
      narrative: 'Strong debugging and code comprehension skills demonstrated',
      source_ref_type: 'assessment_evaluation_report',
      source_ref_id: 'report-1',
      evidence_role: 'evaluation_report_summary',
      exact_text: 'Strong debugging and code comprehension skills demonstrated',
    });
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

describe('loadAssessmentSessionData', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  const assessmentMigration = readFileSync(
    new URL('../../../../migrations/0102_assessment_layer.sql', import.meta.url),
    'utf8',
  );

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
    sqlite.exec(rewriteNumberedParams(assessmentMigration));

    sqlite.exec(`
      INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
      VALUES ('cand-1', 'owner-1', 'pipe-1', 'Alice', 'alice@test.dev', 'active');
    `);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns null for a non-existent session', async () => {
    const data = await loadAssessmentSessionData(db, 'nonexistent');
    expect(data).toBeNull();
  });

  it('loads session with events and reports from the database', async () => {
    const now = '2026-06-01T10:00:00Z';
    sqlite.exec(`
      INSERT INTO assessment_sessions
        (id, ingestion_key, mode, state, candidate_id, workspace_id, metadata_json, created_at, updated_at)
      VALUES ('sess-load-1', 'key:sess-load-1', 'OPEN_SOURCE_BUG_FIX', 'EVALUATED', 'cand-1', 'owner-1', '{}', '${now}', '${now}');
    `);
    sqlite.exec(`
      INSERT INTO assessment_evidence_events
        (id, ingestion_key, session_id, sequence, kind, actor_type, actor_id, narrative, payload_json, occurred_at, created_at)
      VALUES ('ev-load-1', 'key:ev-load-1', 'sess-load-1', 1, 'file_open', 'candidate', 'cand-1', 'Opened file', '{}', '${now}', '${now}');
    `);
    sqlite.exec(`
      INSERT INTO assessment_evaluation_reports
        (id, ingestion_key, session_id, status, summary, output_json, created_at, updated_at)
      VALUES ('rep-load-1', 'key:rep-load-1', 'sess-load-1', 'EVALUATED', 'Good fix', '{}', '${now}', '${now}');
    `);
    sqlite.exec(`
      INSERT INTO assessment_evaluation_claims
        (id, report_id, polarity, dimension, narrative, confidence, created_at)
      VALUES ('claim-load-1', 'rep-load-1', 'positive', 'debugging', 'Strong debugging skills', 0.9, '${now}');
    `);

    const data = await loadAssessmentSessionData(db, 'sess-load-1');
    expect(data).not.toBeNull();
    expect(data!.session.id).toBe('sess-load-1');
    expect(data!.session.mode).toBe('OPEN_SOURCE_BUG_FIX');
    expect(data!.events).toHaveLength(1);
    expect(data!.events[0].kind).toBe('file_open');
    expect(data!.reports).toHaveLength(1);
    expect(data!.reports[0].status).toBe('EVALUATED');
    expect(data!.claims).toHaveLength(1);
    expect(data!.claims[0].dimension).toBe('debugging');
  });
});

describe('ingestAssessmentSessionRealTime', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  const assessmentMigration = readFileSync(
    new URL('../../../../migrations/0102_assessment_layer.sql', import.meta.url),
    'utf8',
  );

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
    sqlite.exec(rewriteNumberedParams(assessmentMigration));

    sqlite.exec(`
      INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
      VALUES ('cand-rt-1', 'owner-1', 'pipe-1', 'Bob', 'bob@test.dev', 'active');
    `);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns null for a non-existent session', async () => {
    const result = await ingestAssessmentSessionRealTime(db, 'nonexistent');
    expect(result).toBeNull();
  });

  it('loads data from DB and ingests into living context in one call', async () => {
    const now = '2026-06-02T12:00:00Z';
    sqlite.exec(`
      INSERT INTO assessment_sessions
        (id, ingestion_key, mode, state, candidate_id, workspace_id, metadata_json, started_at, created_at, updated_at)
      VALUES ('sess-rt-1', 'key:sess-rt-1', 'CODE_REVIEW', 'EVALUATED', 'cand-rt-1', 'owner-1', '{}', '${now}', '${now}', '${now}');
    `);
    sqlite.exec(`
      INSERT INTO assessment_evidence_events
        (id, ingestion_key, session_id, sequence, kind, actor_type, actor_id, narrative, payload_json, occurred_at, created_at)
      VALUES ('ev-rt-1', 'key:ev-rt-1', 'sess-rt-1', 1, 'code_edit', 'candidate', 'cand-rt-1', 'Fixed the race condition', '{}', '${now}', '${now}');
    `);

    const result = await ingestAssessmentSessionRealTime(db, 'sess-rt-1');
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('sess-rt-1');
    expect(result!.episodeCount).toBe(1);
    expect(result!.assertionCount).toBe(1);

    const interaction = sqlite.prepare(
      `SELECT * FROM interactions WHERE external_reference = 'sess-rt-1'`,
    ).get() as Record<string, unknown>;
    expect(interaction).toBeTruthy();
    expect(interaction.interaction_type).toBe('assessment:CODE_REVIEW');
  });

  it('projects candidate profile snapshots into person context with exact source refs idempotently', async () => {
    const now = '2026-06-02T12:30:00Z';
    sqlite.exec(`
      INSERT INTO assessment_sessions
        (id, ingestion_key, mode, state, candidate_id, workspace_id, metadata_json, started_at, created_at, updated_at)
      VALUES ('sess-rt-profile', 'key:sess-rt-profile', 'OPEN_SOURCE_BUG_FIX', 'IN_PROGRESS', 'cand-rt-1', 'owner-1', '{}', '${now}', '${now}', '${now}');
    `);

    const firstEvent = await recordAssessmentCandidateProfileEvidence(db, {
      sessionId: 'sess-rt-profile',
      occurredAt: now,
    });
    const secondEvent = await recordAssessmentCandidateProfileEvidence(db, {
      sessionId: 'sess-rt-profile',
      occurredAt: now,
    });
    expect(firstEvent).not.toBeNull();
    expect(secondEvent?.id).toBe(firstEvent?.id);

    const rawProfileRefs = sqlite.prepare(
      `SELECT sr.source_ref_type, sr.source_ref_id, sr.evidence_role, sr.exact_text, e.kind
         FROM assessment_event_source_refs sr
         JOIN assessment_evidence_events e ON e.id = sr.event_id
        WHERE e.session_id = 'sess-rt-profile'
          AND sr.source_ref_type = 'candidate_profile'`,
    ).all() as Array<{
      source_ref_type: string;
      source_ref_id: string;
      evidence_role: string;
      exact_text: string;
      kind: string;
    }>;
    expect(rawProfileRefs).toHaveLength(1);
    expect(rawProfileRefs[0]).toMatchObject({
      source_ref_type: 'candidate_profile',
      evidence_role: 'candidate_profile_snapshot',
      kind: 'candidate_profile',
    });
    expect(rawProfileRefs[0].exact_text).toContain('Name: Bob');
    expect(rawProfileRefs[0].exact_text).toContain('Email: bob@test.dev');

    await ingestAssessmentSessionRealTime(db, 'sess-rt-profile');
    await ingestAssessmentSessionRealTime(db, 'sess-rt-profile');

    const projectedProfileRefs = sqlite.prepare(
      `SELECT cr.record_type, cr.workspace_person_id,
              csr.source_ref_type, csr.source_ref_id, csr.evidence_role, csr.exact_text
         FROM context_records cr
         JOIN context_record_source_refs csr ON csr.context_record_id = cr.id
        WHERE cr.ingestion_key = ?
          AND csr.source_ref_type = 'candidate_profile'`,
    ).all(`assessment_event_context:${firstEvent?.id}`) as Array<{
      record_type: string;
      workspace_person_id: string | null;
      source_ref_type: string;
      source_ref_id: string;
      evidence_role: string;
      exact_text: string;
    }>;
    expect(projectedProfileRefs).toHaveLength(1);
    expect(projectedProfileRefs[0]).toMatchObject({
      record_type: 'assessment:candidate_profile',
      source_ref_type: 'candidate_profile',
      evidence_role: 'candidate_profile_snapshot',
    });
    expect(projectedProfileRefs[0].workspace_person_id).toBeTruthy();
    expect(projectedProfileRefs[0].source_ref_id).toBe(rawProfileRefs[0].source_ref_id);
    expect(projectedProfileRefs[0].exact_text).toBe(rawProfileRefs[0].exact_text);

    const duplicateGroups = sqlite.prepare(
      `SELECT cr.workspace_person_id, cr.record_type, sr.source_ref_type, sr.source_ref_id,
              sr.evidence_role, COUNT(*) AS count
         FROM context_records cr
         JOIN context_record_source_refs sr ON sr.context_record_id = cr.id
        WHERE cr.workspace_person_id IS NOT NULL
          AND cr.interaction_id IN (
            SELECT id FROM interactions WHERE external_reference = 'sess-rt-profile'
          )
          AND sr.source_ref_type = 'candidate_profile'
        GROUP BY cr.workspace_person_id, cr.record_type, sr.source_ref_type,
                 sr.source_ref_id, sr.evidence_role
       HAVING COUNT(*) > 1`,
    ).all();
    expect(duplicateGroups).toEqual([]);
  });

  it('preserves commit, diff, test, upstream PR, AI, report, and human decision source refs without replay duplicates', async () => {
    const now = '2026-06-02T13:00:00Z';
    sqlite.exec(`
      INSERT INTO assessment_sessions
        (id, ingestion_key, mode, state, candidate_id, workspace_id, metadata_json, started_at, created_at, updated_at)
      VALUES ('sess-rt-source-refs', 'key:sess-rt-source-refs', 'OPEN_SOURCE_BUG_FIX', 'EVALUATED', 'cand-rt-1', 'owner-1', '{}', '${now}', '${now}', '${now}');
    `);
    sqlite.exec(`
      INSERT INTO assessment_evidence_events
        (id, ingestion_key, session_id, sequence, kind, actor_type, actor_id, narrative, payload_json, occurred_at, created_at)
      VALUES (
        'ev-rt-commit-1',
        'key:ev-rt-commit-1',
        'sess-rt-source-refs',
        1,
        'commit_submission',
        'candidate',
        'cand-rt-1',
        'Candidate submitted commit abc123 with diff, verification output, and upstream PR consent',
        '{"commitSha":"abc123","upstreamPrConsent":true}',
        '${now}',
        '${now}'
      ),
      (
        'ev-rt-ai-1',
        'key:ev-rt-ai-1',
        'sess-rt-source-refs',
        2,
        'ai_interaction',
        'ai_developer',
        'devin',
        'Candidate asked Devin about the failing regression and received a source-backed bridge response',
        '{"provider":"devin"}',
        '${now}',
        '${now}'
      ),
      (
        'ev-rt-human-1',
        'key:ev-rt-human-1',
        'sess-rt-source-refs',
        3,
        'human_assessment_decision',
        'recruiter',
        'reviewer-1',
        'Human reviewer advances the candidate after checking source-backed report evidence',
        '{"decision":"advance"}',
        '${now}',
        '${now}'
      );
    `);
    sqlite.exec(`
      INSERT INTO assessment_event_source_refs
        (id, event_id, source_ref_type, source_ref_id, evidence_role, locator_json, exact_text, content_hash, metadata_json, created_at)
      VALUES
        ('sr-rt-git-commit', 'ev-rt-commit-1', 'git_commit', 'abc123', 'submitted_commit', '{"commitSha":"abc123"}', 'commit abc123', 'sha256:commit-abc123', '{}', '${now}'),
        ('sr-rt-code-diff', 'ev-rt-commit-1', 'code_diff', 'base..abc123', 'submitted_diff', '{"base":"base","head":"abc123"}', 'diff --git a/src/fix.ts b/src/fix.ts', 'sha256:diff-abc123', '{}', '${now}'),
        ('sr-rt-test-run', 'ev-rt-commit-1', 'test_run', 'abc123:test', 'verification_test_output', '{"command":"npm test"}', 'npm test\\nPASS src/fix.test.ts', 'sha256:test-abc123', '{}', '${now}'),
        ('sr-rt-upstream-pr', 'ev-rt-commit-1', 'upstream_pull_request', 'https://github.com/example/repo/pull/42', 'candidate_upstream_pr', '{"url":"https://github.com/example/repo/pull/42"}', 'Upstream PR #42', 'sha256:pr-42', '{}', '${now}'),
        ('sr-rt-ai-prompt', 'ev-rt-ai-1', 'ai_user_prompt', 'prompt-abc123', 'ai_user_prompt', '{"provider":"devin"}', 'Why does the regression fail after cleanup?', 'sha256:ai-prompt', '{}', '${now}'),
        ('sr-rt-ai-response', 'ev-rt-ai-1', 'ai_agent_response', 'response-abc123', 'ai_agent_response', '{"provider":"devin"}', 'The cleanup leaves a stale listener attached after unmount.', 'sha256:ai-response', '{}', '${now}'),
        ('sr-rt-human-report', 'ev-rt-human-1', 'assessment_evaluation_report', 'report-rt-1', 'reviewed_report', '{"reportId":"report-rt-1"}', 'Automated evaluator found a source-backed focused fix.', 'sha256:report-summary', '{}', '${now}');
    `);
    sqlite.exec(`
      INSERT INTO assessment_evaluation_reports
        (id, ingestion_key, session_id, status, summary, output_json, created_at, updated_at)
      VALUES (
        'report-rt-1',
        'key:report-rt-1',
        'sess-rt-source-refs',
        'EVALUATED',
        'Automated evaluator found a source-backed focused fix.',
        '{}',
        '${now}',
        '${now}'
      );
    `);

    const first = await ingestAssessmentSessionRealTime(db, 'sess-rt-source-refs');
    const second = await ingestAssessmentSessionRealTime(db, 'sess-rt-source-refs');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const contextRecord = sqlite.prepare(
      `SELECT id, workspace_person_id, record_type, narrative
         FROM context_records
        WHERE ingestion_key = 'assessment_event_context:ev-rt-commit-1'`,
    ).get() as {
      id: string;
      workspace_person_id: string | null;
      record_type: string;
      narrative: string;
    };
    expect(contextRecord).toMatchObject({
      record_type: 'assessment:commit_submission',
      narrative: 'Candidate submitted commit abc123 with diff, verification output, and upstream PR consent',
    });
    expect(contextRecord.workspace_person_id).toBeTruthy();

    const projectedRefs = sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, evidence_role, exact_text, content_hash
         FROM context_record_source_refs
        WHERE context_record_id = ?
        ORDER BY source_ref_type, evidence_role`,
    ).all(contextRecord.id) as Array<{
      source_ref_type: string;
      source_ref_id: string;
      evidence_role: string;
      exact_text: string | null;
      content_hash: string | null;
    }>;
    expect(projectedRefs).toHaveLength(5);
    expect(projectedRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_ref_type: 'code_diff',
        source_ref_id: 'base..abc123',
        evidence_role: 'submitted_diff',
        exact_text: 'diff --git a/src/fix.ts b/src/fix.ts',
        content_hash: 'sha256:diff-abc123',
      }),
      expect.objectContaining({
        source_ref_type: 'git_commit',
        source_ref_id: 'abc123',
        evidence_role: 'submitted_commit',
        exact_text: 'commit abc123',
        content_hash: 'sha256:commit-abc123',
      }),
      expect.objectContaining({
        source_ref_type: 'source_span',
        evidence_role: 'primary',
      }),
      expect.objectContaining({
        source_ref_type: 'test_run',
        source_ref_id: 'abc123:test',
        evidence_role: 'verification_test_output',
        exact_text: 'npm test\\nPASS src/fix.test.ts',
        content_hash: 'sha256:test-abc123',
      }),
      expect.objectContaining({
        source_ref_type: 'upstream_pull_request',
        source_ref_id: 'https://github.com/example/repo/pull/42',
        evidence_role: 'candidate_upstream_pr',
        exact_text: 'Upstream PR #42',
        content_hash: 'sha256:pr-42',
      }),
    ]));

    const aiRefs = sqlite.prepare(
      `SELECT csr.source_ref_type, csr.source_ref_id, csr.evidence_role, csr.exact_text
         FROM context_records cr
         JOIN context_record_source_refs csr ON csr.context_record_id = cr.id
        WHERE cr.ingestion_key = 'assessment_event_context:ev-rt-ai-1'
        ORDER BY csr.source_ref_type`,
    ).all() as Array<Record<string, unknown>>;
    expect(aiRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_ref_type: 'ai_agent_response',
        source_ref_id: 'response-abc123',
        evidence_role: 'ai_agent_response',
        exact_text: 'The cleanup leaves a stale listener attached after unmount.',
      }),
      expect.objectContaining({
        source_ref_type: 'ai_user_prompt',
        source_ref_id: 'prompt-abc123',
        evidence_role: 'ai_user_prompt',
        exact_text: 'Why does the regression fail after cleanup?',
      }),
    ]));

    const reportRef = sqlite.prepare(
      `SELECT csr.source_ref_type, csr.source_ref_id, csr.evidence_role, csr.exact_text
         FROM context_records cr
         JOIN context_record_source_refs csr ON csr.context_record_id = cr.id
        WHERE cr.ingestion_key = 'assessment_report_context:report-rt-1'`,
    ).get() as Record<string, unknown>;
    expect(reportRef).toEqual({
      source_ref_type: 'assessment_evaluation_report',
      source_ref_id: 'report-rt-1',
      evidence_role: 'evaluation_report_summary',
      exact_text: 'Automated evaluator found a source-backed focused fix.',
    });

    const humanDecisionRef = sqlite.prepare(
      `SELECT csr.source_ref_type, csr.source_ref_id, csr.evidence_role, csr.exact_text
         FROM context_records cr
         JOIN context_record_source_refs csr ON csr.context_record_id = cr.id
        WHERE cr.ingestion_key = 'assessment_event_context:ev-rt-human-1'
          AND csr.source_ref_type = 'assessment_evaluation_report'`,
    ).get() as Record<string, unknown>;
    expect(humanDecisionRef).toEqual({
      source_ref_type: 'assessment_evaluation_report',
      source_ref_id: 'report-rt-1',
      evidence_role: 'reviewed_report',
      exact_text: 'Automated evaluator found a source-backed focused fix.',
    });

    const duplicateGroups = sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, evidence_role, COUNT(*) AS count
         FROM context_record_source_refs
        WHERE context_record_id = ?
        GROUP BY source_ref_type, source_ref_id, evidence_role
       HAVING COUNT(*) > 1`,
    ).all(contextRecord.id);
    expect(duplicateGroups).toEqual([]);

    const projectedDuplicateGroups = sqlite.prepare(
      `SELECT cr.workspace_person_id, cr.record_type, cr.narrative,
              sr.source_ref_type, sr.source_ref_id, sr.evidence_role,
              COUNT(*) AS count
         FROM context_records cr
         JOIN context_record_source_refs sr ON sr.context_record_id = cr.id
        WHERE cr.workspace_person_id IS NOT NULL
          AND cr.interaction_id IN (
            SELECT id FROM interactions WHERE external_reference = 'sess-rt-source-refs'
          )
        GROUP BY cr.workspace_person_id, cr.record_type, cr.narrative,
                 sr.source_ref_type, sr.source_ref_id, sr.evidence_role
       HAVING COUNT(*) > 1`,
    ).all();
    expect(projectedDuplicateGroups).toEqual([]);
  });
});
