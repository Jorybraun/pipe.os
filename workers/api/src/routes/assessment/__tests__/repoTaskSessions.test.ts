import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import type { Env } from '../../../types';
import { repoTaskSessions } from '../repoTaskSessions';
import type { AssessmentEvidenceSourceRefInput } from '../../../lib/repoTaskInterviewSession';

const livingContextMigrationSql = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigrationSql = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const repoTaskSessionsMigrationSql = readFileSync(
  new URL('../../../../migrations/0102_assessment_layer.sql', import.meta.url),
  'utf8',
);
const repoTaskSessionsCompatMigrationSql = readFileSync(
  new URL('../../../../migrations/0103_assessment_layer_repo_task_compat.sql', import.meta.url),
  'utf8',
);

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

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    DEV_AUTH_BYPASS: 'true',
    DEV_BYPASS_USER_ID: 'user_1',
  } as Env;
}

function mountApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/v1/assessment/repo-task', repoTaskSessions);
  return app;
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function createSession(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  input: {
    ingestionKey: string;
    mode?: string;
    candidateId?: string;
  },
): Promise<{ id: string; state: string; mode: string }> {
  const response = await app.request('/api/v1/assessment/repo-task/sessions', jsonRequest({
    ingestionKey: input.ingestionKey,
    interviewId: `${input.ingestionKey}:interview`,
    candidateId: input.candidateId ?? 'candidate-1',
    workspaceId: 'workspace-1',
    mode: input.mode ?? 'OPEN_SOURCE_BUG_FIX',
    metadata: { source: 'route-test' },
  }), env);
  expect(response.status).toBe(201);
  const body = await response.json() as {
    session: { id: string; state: string; mode: string };
  };
  return body.session;
}

describe('repo task assessment session routes', () => {
  let sqlite: BetterSqliteDb;
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec(livingContextMigrationSql);
    sqlite.exec(contextRecordsMigrationSql);
    sqlite.exec(repoTaskSessionsMigrationSql);
    sqlite.exec(repoTaskSessionsCompatMigrationSql);
    env = buildEnv(createMockD1(sqlite));
    app = mountApp();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('creates an assessment session and persists source-backed candidate events into context records', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:open-source-bug',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-plan',
    });
    expect(session.state).toBe('INTAKE');

    const planText = 'I will reproduce the failing popover interaction, isolate the stale event handler, and add regression tests.';
    const eventResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:plan:v1',
        kind: 'candidate_plan',
        actorType: 'candidate',
        actorId: 'candidate-plan',
        narrative: 'Candidate wrote an implementation and test plan before editing code.',
        payload: { planText },
        sourceRefs: [await sourceRef('candidate_plan', 'plan-note-1', planText)],
      }),
      env,
    );

    expect(eventResponse.status).toBe(201);
    const eventBody = await eventResponse.json() as {
      event: { id: string; sequence: number; contextRecordId: string };
    };
    expect(eventBody.event.sequence).toBe(1);
    expect(eventBody.event.contextRecordId).toBeTruthy();

    expect(sqlite.prepare(
      `SELECT interview_id, mode, state, candidate_id, workspace_id, metadata_json
         FROM assessment_sessions WHERE id = ?`,
    ).get(session.id)).toEqual({
      interview_id: 'assessment-session:open-source-bug:interview',
      mode: 'OPEN_SOURCE_BUG_FIX',
      state: 'INTAKE',
      candidate_id: 'candidate-plan',
      workspace_id: 'workspace-1',
      metadata_json: JSON.stringify({ source: 'route-test' }),
    });

    expect(sqlite.prepare(
      `SELECT kind, actor_type, actor_id, narrative, context_record_id
         FROM assessment_evidence_events WHERE id = ?`,
    ).get(eventBody.event.id)).toMatchObject({
      kind: 'candidate_plan',
      actor_type: 'candidate',
      actor_id: 'candidate-plan',
      narrative: 'Candidate wrote an implementation and test plan before editing code.',
      context_record_id: eventBody.event.contextRecordId,
    });

    expect(sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, exact_text, content_hash
         FROM assessment_event_source_refs WHERE event_id = ?`,
    ).get(eventBody.event.id)).toEqual({
      source_ref_type: 'candidate_plan',
      source_ref_id: 'plan-note-1',
      exact_text: planText,
      content_hash: await sha256Hex(planText),
    });

    expect(sqlite.prepare(
      `SELECT scope_type, scope_id, record_type, predicate
         FROM context_records WHERE id = ?`,
    ).get(eventBody.event.contextRecordId)).toEqual({
      scope_type: 'assessment_session',
      scope_id: session.id,
      record_type: 'assessment_candidate_plan',
      predicate: 'records assessment evidence event',
    });
  });

  it('tracks assessment state from intake through final submission and keeps event evidence immutable', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:state',
      mode: 'DEV_CONTAINER_REPO_TASK',
    });

    const started = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/state`,
      jsonRequest({
        toState: 'IN_PROGRESS',
        reason: 'Candidate opened the dev container.',
      }),
      env,
    );
    expect(started.status).toBe(200);

    const terminalText = 'FAIL src/popover.test.ts stale listener remains attached';
    const eventResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:terminal-output',
        kind: 'terminal_output',
        actorType: 'dev_container',
        narrative: 'Candidate ran the test suite and captured the failing assertion.',
        payload: { command: 'npm test', exitCode: 1 },
        sourceRefs: [await sourceRef('terminal_output', 'terminal-1', terminalText)],
      }),
      env,
    );
    expect(eventResponse.status).toBe(201);
    const eventBody = await eventResponse.json() as { event: { id: string } };

    const submitted = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/state`,
      jsonRequest({
        toState: 'FINAL_SUBMITTED',
        reason: 'Candidate submitted the final evidence bundle.',
        eventId: eventBody.event.id,
      }),
      env,
    );
    expect(submitted.status).toBe(200);

    expect(sqlite.prepare(
      'SELECT state FROM assessment_sessions WHERE id = ?',
    ).get(session.id)).toEqual({ state: 'FINAL_SUBMITTED' });
    expect(sqlite.prepare(
      `SELECT from_state, to_state, reason FROM assessment_state_transitions
        WHERE session_id = ? ORDER BY created_at, id`,
    ).all(session.id)).toEqual([
      { from_state: 'INTAKE', to_state: 'IN_PROGRESS', reason: 'Candidate opened the dev container.' },
      { from_state: 'IN_PROGRESS', to_state: 'FINAL_SUBMITTED', reason: 'Candidate submitted the final evidence bundle.' },
    ]);

    expect(() => sqlite.prepare(
      `UPDATE assessment_evidence_events SET narrative = 'rewritten' WHERE id = ?`,
    ).run(eventBody.event.id)).toThrow('assessment_evidence_events are immutable');
  });

  it('rejects unsupported positive claims and records unavailable AI providers as diagnostics', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:unsupported-positive',
      mode: 'CODE_REVIEW',
    });

    const unsupportedReport = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:unsupported-positive',
        status: 'EVALUATED',
        summary: 'Candidate demonstrated systematic debugging.',
        output: { schemaVersion: 'repo-task-assessment-output-v1' },
        claims: [{
          id: 'claim-debugging',
          polarity: 'positive',
          dimension: 'debugging_reasoning',
          narrative: 'Candidate debugged systematically.',
          sourceRefs: [],
        }],
        diagnostics: [],
      }),
      env,
    );

    expect(unsupportedReport.status).toBe(400);
    const unsupportedBody = await unsupportedReport.json() as { error: { message: string } };
    expect(unsupportedBody.error.message).toContain(
      'positive evaluation claim claim-debugging requires at least one exact source ref',
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_evaluation_reports').get()).toEqual({
      count: 0,
    });

    const diagnosticResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/diagnostics/ai-provider-unavailable`,
      jsonRequest({
        provider: 'openai',
        reason: 'AI developer provider was not configured for this environment.',
        retryable: true,
        details: { surface: 'code_review' },
      }),
      env,
    );
    expect(diagnosticResponse.status).toBe(201);

    expect(sqlite.prepare(
      `SELECT code, severity, provider, retryable, message
         FROM assessment_diagnostics WHERE session_id = ?`,
    ).get(session.id)).toEqual({
      code: 'AI_DEVELOPER_UNAVAILABLE',
      severity: 'blocking',
      provider: 'openai',
      retryable: 1,
      message: 'AI developer provider was not configured for this environment.',
    });
    expect(sqlite.prepare(
      'SELECT state FROM assessment_sessions WHERE id = ?',
    ).get(session.id)).toEqual({ state: 'DIAGNOSTIC' });
  });

  it('persists evaluation reports only when positive claims cite exact source evidence', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:evaluation',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-evaluation',
    });
    const diffText = 'diff --git a/src/popover.ts b/src/popover.ts\n+cleanupStaleHandler();';
    const transcriptText = 'I chose this fix because the stale listener survives unmount.';

    const reportResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:source-backed',
        status: 'EVALUATED',
        summary: 'Candidate produced a source-backed fix with a clear rationale.',
        output: {
          schemaVersion: 'repo-task-assessment-output-v1',
          status: 'EVALUATED',
        },
        claims: [
          {
            id: 'claim-code-fix',
            polarity: 'positive',
            dimension: 'implementation_correctness',
            narrative: 'Candidate changed the listener cleanup path.',
            confidence: 0.87,
            sourceRefs: [await sourceRef('code_diff', 'diff-1', diffText)],
          },
          {
            id: 'claim-rationale',
            polarity: 'positive',
            dimension: 'communication',
            narrative: 'Candidate explained the implementation rationale.',
            confidence: 0.82,
            sourceRefs: [await sourceRef('transcript_span', 'transcript-1', transcriptText)],
          },
        ],
        diagnostics: [{
          code: 'MISSING_TEST_RUN',
          severity: 'warning',
          message: 'No passing post-fix test run was captured.',
        }],
      }),
      env,
    );

    expect(reportResponse.status).toBe(201);
    const reportBody = await reportResponse.json() as {
      report: { id: string; contextRecordId: string; status: string };
    };
    expect(reportBody.report.status).toBe('EVALUATED');
    expect(reportBody.report.contextRecordId).toBeTruthy();

    expect(sqlite.prepare(
      `SELECT status, summary, context_record_id
         FROM assessment_evaluation_reports WHERE id = ?`,
    ).get(reportBody.report.id)).toEqual({
      status: 'EVALUATED',
      summary: 'Candidate produced a source-backed fix with a clear rationale.',
      context_record_id: reportBody.report.contextRecordId,
    });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM assessment_evaluation_claims
        WHERE report_id = ? AND polarity = 'positive'`,
    ).get(reportBody.report.id)).toEqual({ count: 2 });
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
    ).all(reportBody.report.id)).toEqual([{
      code: 'MISSING_TEST_RUN',
      severity: 'warning',
      message: 'No passing post-fix test run was captured.',
    }]);
    expect(sqlite.prepare(
      `SELECT record_type, predicate FROM context_records WHERE id = ?`,
    ).get(reportBody.report.contextRecordId)).toEqual({
      record_type: 'assessment_evaluation_report',
      predicate: 'summarizes assessment evidence',
    });
    expect(sqlite.prepare(
      `SELECT source_ref_type, source_ref_id
         FROM context_record_source_refs
        WHERE context_record_id = ?
        ORDER BY source_ref_type, source_ref_id`,
    ).all(reportBody.report.contextRecordId)).toEqual([
      {
        source_ref_type: 'assessment_evaluation_report',
        source_ref_id: reportBody.report.id,
      },
      {
        source_ref_type: 'code_diff',
        source_ref_id: 'diff-1',
      },
      {
        source_ref_type: 'transcript_span',
        source_ref_id: 'transcript-1',
      },
    ]);
  });
});
