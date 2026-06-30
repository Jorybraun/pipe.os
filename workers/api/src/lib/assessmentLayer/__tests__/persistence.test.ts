import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  AssessmentLayerStore,
  type AssessmentEvidenceSourceRefInput,
} from '../persistence';

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

const NOW = '2026-06-27T18:00:00.000Z';

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sourceRef(
  sourceRefType: string,
  sourceRefId: string,
  exactText: string,
): Promise<AssessmentEvidenceSourceRefInput> {
  return {
    sourceRefType,
    sourceRefId,
    exactText,
    contentHash: await sha256Hex(exactText),
    locator: { label: sourceRefId },
  };
}

describe('AssessmentLayerStore', () => {
  let sqlite: BetterSqliteDb;
  let store: AssessmentLayerStore;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigrationSql);
    sqlite.exec(contextRecordsMigrationSql);
    sqlite.exec(assessmentLayerMigrationSql);
    store = new AssessmentLayerStore(createMockD1(sqlite), () => NOW);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('creates an assessment session for any supported interview surface', async () => {
    const session = await store.createAssessmentSession({
      ingestionKey: 'assessment-session:interview-room',
      interviewId: 'interview-room',
      mode: 'DEV_CONTAINER_REPO_TASK',
      candidateId: 'candidate-1',
      workspaceId: 'workspace-1',
      createdBy: 'recruiter-1',
      metadata: { runtime: 'assessment-room' },
    });

    expect(session.state).toBe('INTAKE');
    expect(sqlite.prepare(
      `SELECT interview_id, mode, state, candidate_id, workspace_id, created_by, metadata_json
         FROM assessment_sessions WHERE id = ?`,
    ).get(session.id)).toEqual({
      interview_id: 'interview-room',
      mode: 'DEV_CONTAINER_REPO_TASK',
      state: 'INTAKE',
      candidate_id: 'candidate-1',
      workspace_id: 'workspace-1',
      created_by: 'recruiter-1',
      metadata_json: JSON.stringify({ runtime: 'assessment-room' }),
    });
  });

  it('persists candidate-authored plans as evidence events and feeds context records', async () => {
    const session = await store.createAssessmentSession({
      ingestionKey: 'assessment-session:plan',
      interviewId: 'interview-plan',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-plan',
    });
    const planText = 'I will reproduce the failing popover interaction, isolate the stale event handler, and add regression tests.';

    const event = await store.recordAssessmentEvent({
      sessionId: session.id,
      ingestionKey: 'assessment-event:plan:v1',
      kind: 'candidate_plan',
      actorType: 'candidate',
      actorId: 'candidate-plan',
      narrative: 'Candidate wrote an implementation and test plan before editing code.',
      payload: { planText },
      sourceRefs: [await sourceRef('candidate_plan', 'plan-note-1', planText)],
    });

    const eventRow = sqlite.prepare(
      `SELECT kind, actor_type, actor_id, narrative, context_record_id
         FROM assessment_evidence_events WHERE id = ?`,
    ).get(event.id) as {
      kind: string;
      actor_type: string;
      actor_id: string;
      narrative: string;
      context_record_id: string | null;
    };
    expect(eventRow).toMatchObject({
      kind: 'candidate_plan',
      actor_type: 'candidate',
      actor_id: 'candidate-plan',
      narrative: 'Candidate wrote an implementation and test plan before editing code.',
    });
    expect(eventRow.context_record_id).toBeTruthy();

    expect(sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, exact_text, content_hash
         FROM assessment_event_source_refs WHERE event_id = ?`,
    ).get(event.id)).toEqual({
      source_ref_type: 'candidate_plan',
      source_ref_id: 'plan-note-1',
      exact_text: planText,
      content_hash: await sha256Hex(planText),
    });

    expect(sqlite.prepare(
      `SELECT scope_type, scope_id, record_type, predicate
         FROM context_records WHERE id = ?`,
    ).get(eventRow.context_record_id)).toEqual({
      scope_type: 'assessment_session',
      scope_id: session.id,
      record_type: 'assessment_candidate_plan',
      predicate: 'records assessment evidence event',
    });
  });

  it('tracks state from intake through final submission without mutating event evidence', async () => {
    const session = await store.createAssessmentSession({
      ingestionKey: 'assessment-session:state',
      interviewId: 'interview-state',
      mode: 'DEV_CONTAINER_CHALLENGE',
    });

    await store.transitionAssessmentState({
      sessionId: session.id,
      toState: 'IN_PROGRESS',
      reason: 'Candidate opened the room.',
    });
    await store.recordAssessmentEvent({
      sessionId: session.id,
      ingestionKey: 'assessment-event:terminal-output',
      kind: 'terminal_output',
      actorType: 'dev_container',
      narrative: 'Candidate ran the test suite and captured the failing assertion.',
      payload: { command: 'npm test', exitCode: 1 },
      sourceRefs: [await sourceRef('terminal_output', 'terminal-1', 'FAIL src/popover.test.ts')],
    });
    await store.transitionAssessmentState({
      sessionId: session.id,
      toState: 'FINAL_SUBMITTED',
      reason: 'Candidate submitted the final evidence bundle.',
    });

    expect(sqlite.prepare('SELECT state FROM assessment_sessions WHERE id = ?').get(session.id)).toEqual({
      state: 'FINAL_SUBMITTED',
    });
    expect(sqlite.prepare(
      `SELECT from_state, to_state, reason FROM assessment_state_transitions
        WHERE session_id = ? ORDER BY created_at, id`,
    ).all(session.id)).toEqual([
      { from_state: 'INTAKE', to_state: 'IN_PROGRESS', reason: 'Candidate opened the room.' },
      { from_state: 'IN_PROGRESS', to_state: 'FINAL_SUBMITTED', reason: 'Candidate submitted the final evidence bundle.' },
    ]);

    expect(() => sqlite.prepare(
      `UPDATE assessment_evidence_events SET narrative = 'rewritten' WHERE session_id = ?`,
    ).run(session.id)).toThrow('assessment_evidence_events are immutable');
  });

  it('rejects positive evaluation claims that lack exact source evidence', async () => {
    const session = await store.createAssessmentSession({
      ingestionKey: 'assessment-session:evaluation-rejects',
      interviewId: 'interview-evaluation-rejects',
      mode: 'CODE_REVIEW',
    });

    await expect(store.createEvaluationReport({
      sessionId: session.id,
      ingestionKey: 'evaluation:unsupported-positive',
      status: 'EVALUATED',
      summary: 'Candidate demonstrated systematic debugging.',
      claims: [{
        id: 'claim-debugging',
        polarity: 'positive',
        dimension: 'debugging_reasoning',
        narrative: 'Candidate debugged systematically.',
        sourceRefs: [],
      }],
      diagnostics: [],
    })).rejects.toThrow('positive evaluation claim claim-debugging requires at least one exact source ref');

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_evaluation_reports').get()).toEqual({
      count: 0,
    });
  });

  it('rejects positive claims that cite source refs not captured in session evidence', async () => {
    const session = await store.createAssessmentSession({
      ingestionKey: 'assessment-session:evaluation-forged-ref',
      interviewId: 'interview-evaluation-forged-ref',
      mode: 'OPEN_SOURCE_BUG_FIX',
    });
    const claimedDiffText = 'diff --git a/src/popover.ts b/src/popover.ts\n+cleanupStaleHandler();';

    await expect(store.createEvaluationReport({
      sessionId: session.id,
      ingestionKey: 'evaluation:forged-source-ref',
      status: 'EVALUATED',
      summary: 'Candidate produced a source-backed fix.',
      claims: [{
        id: 'claim-forged-code-fix',
        polarity: 'positive',
        dimension: 'implementation_correctness',
        narrative: 'Candidate changed the listener cleanup path.',
        sourceRefs: [await sourceRef('code_diff', 'diff-forged', claimedDiffText)],
      }],
      diagnostics: [],
    })).rejects.toThrow(
      'positive evaluation claim claim-forged-code-fix source ref code_diff:diff-forged is not backed by assessment session evidence',
    );

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_evaluation_reports').get()).toEqual({
      count: 0,
    });
  });

  it('persists evaluation reports as source-backed hypergraph records with diagnostics', async () => {
    const session = await store.createAssessmentSession({
      ingestionKey: 'assessment-session:evaluation',
      interviewId: 'interview-evaluation',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-evaluation',
    });
    const diffText = 'diff --git a/src/popover.ts b/src/popover.ts\n+cleanupStaleHandler();';
    const transcriptText = 'I chose this fix because the stale listener survives unmount.';
    const diffSourceRef = await sourceRef('code_diff', 'diff-1', diffText);
    const transcriptSourceRef = await sourceRef('transcript_span', 'transcript-1', transcriptText);

    await store.recordAssessmentEvent({
      sessionId: session.id,
      ingestionKey: 'assessment-event:evaluation:diff',
      kind: 'code_diff',
      actorType: 'candidate',
      actorId: 'candidate-evaluation',
      narrative: 'Candidate changed the listener cleanup path.',
      payload: { filePath: 'src/popover.ts' },
      sourceRefs: [diffSourceRef],
    });
    await store.recordAssessmentEvent({
      sessionId: session.id,
      ingestionKey: 'assessment-event:evaluation:transcript',
      kind: 'transcript_span',
      actorType: 'candidate',
      actorId: 'candidate-evaluation',
      narrative: 'Candidate explained the implementation rationale.',
      payload: { transcriptOffsetMs: 12000 },
      sourceRefs: [transcriptSourceRef],
    });

    const report = await store.createEvaluationReport({
      sessionId: session.id,
      ingestionKey: 'evaluation:source-backed',
      status: 'EVALUATED',
      summary: 'Candidate produced a source-backed fix with a clear rationale.',
      claims: [
        {
          id: 'claim-code-fix',
          polarity: 'positive',
          dimension: 'implementation_correctness',
          narrative: 'Candidate changed the listener cleanup path.',
          sourceRefs: [diffSourceRef],
        },
        {
          id: 'claim-rationale',
          polarity: 'positive',
          dimension: 'communication',
          narrative: 'Candidate explained the implementation rationale.',
          sourceRefs: [transcriptSourceRef],
        },
      ],
      diagnostics: [{
        code: 'MISSING_TEST_RUN',
        severity: 'warning',
        message: 'No passing post-fix test run was captured.',
      }],
    });

    const reportRow = sqlite.prepare(
      `SELECT status, summary, context_record_id FROM assessment_evaluation_reports WHERE id = ?`,
    ).get(report.id) as { status: string; summary: string; context_record_id: string | null };
    expect(reportRow.status).toBe('EVALUATED');
    expect(reportRow.summary).toBe('Candidate produced a source-backed fix with a clear rationale.');
    expect(reportRow.context_record_id).toBeTruthy();

    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM assessment_evaluation_claims
        WHERE report_id = ? AND polarity = 'positive'`,
    ).get(report.id)).toEqual({ count: 2 });
    expect(sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, exact_text
         FROM assessment_claim_source_refs
        WHERE claim_id = ?
        ORDER BY source_ref_type`,
    ).all('claim-code-fix')).toEqual([{
      source_ref_type: 'code_diff',
      source_ref_id: 'diff-1',
      exact_text: diffText,
    }]);
    expect(sqlite.prepare(
      `SELECT code, severity, message FROM assessment_diagnostics WHERE report_id = ?`,
    ).all(report.id)).toEqual([{
      code: 'MISSING_TEST_RUN',
      severity: 'warning',
      message: 'No passing post-fix test run was captured.',
    }]);
    expect(sqlite.prepare(
      `SELECT record_type, predicate FROM context_records WHERE id = ?`,
    ).get(reportRow.context_record_id)).toEqual({
      record_type: 'assessment_evaluation_report',
      predicate: 'summarizes assessment evidence',
    });
  });
});
