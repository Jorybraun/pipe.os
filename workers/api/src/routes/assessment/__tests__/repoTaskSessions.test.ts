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

  it('submits a final assessment bundle that stores every required artifact kind as source-backed evidence', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:final-bundle',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-bundle',
    });

    const artifacts = [
      {
        ingestionKey: 'assessment-event:bundle-plan',
        kind: 'candidate_plan',
        actorType: 'candidate',
        actorId: 'candidate-bundle',
        narrative: 'Candidate described suspected root cause and implementation plan.',
        payload: { phase: 'plan' },
        sourceRefs: [await sourceRef('candidate_plan', 'plan-1', 'Root cause is likely stale listener cleanup.')],
      },
      {
        ingestionKey: 'assessment-event:bundle-diagram',
        kind: 'diagram',
        actorType: 'candidate',
        actorId: 'candidate-bundle',
        narrative: 'Candidate drew the event listener lifecycle.',
        payload: { diagramType: 'mermaid' },
        sourceRefs: [await sourceRef('diagram', 'diagram-1', 'flowchart LR; Mount-->Listener; Unmount-->Cleanup;')],
      },
      {
        ingestionKey: 'assessment-event:bundle-message',
        kind: 'message',
        actorType: 'candidate',
        actorId: 'candidate-bundle',
        narrative: 'Candidate asked a clarifying question about expected behavior.',
        payload: { channel: 'room_chat' },
        sourceRefs: [await sourceRef('message', 'message-1', 'Should keyboard dismissal remove the listener too?')],
      },
      {
        ingestionKey: 'assessment-event:bundle-terminal',
        kind: 'terminal_output',
        actorType: 'dev_container',
        narrative: 'Candidate captured failing terminal output before the fix.',
        payload: { command: 'npm test -- popover' },
        sourceRefs: [await sourceRef('terminal_output', 'terminal-2', 'FAIL popover stale listener remains attached')],
      },
      {
        ingestionKey: 'assessment-event:bundle-test-run',
        kind: 'test_run',
        actorType: 'dev_container',
        narrative: 'Candidate captured passing tests after the fix.',
        payload: { command: 'npm test -- popover', exitCode: 0 },
        sourceRefs: [await sourceRef('test_run', 'test-run-1', 'PASS popover cleanup regression')],
      },
      {
        ingestionKey: 'assessment-event:bundle-code-diff',
        kind: 'code_diff',
        actorType: 'candidate',
        actorId: 'candidate-bundle',
        narrative: 'Candidate changed cleanup behavior in the popover listener.',
        payload: { filePath: 'src/popover.ts' },
        sourceRefs: [await sourceRef('code_diff', 'diff-2', '+ cleanupStaleHandler();')],
      },
      {
        ingestionKey: 'assessment-event:bundle-ai-interaction',
        kind: 'ai_interaction',
        actorType: 'ai_developer',
        actorId: 'openai:repo-task-interviewer',
        narrative: 'AI interviewer challenged the edge-case behavior.',
        payload: { provider: 'openai', model: 'configured-real-provider' },
        sourceRefs: [await sourceRef('ai_usage_event', 'ai-turn-1', 'What happens if the component unmounts during pointer capture?')],
      },
      {
        ingestionKey: 'assessment-event:bundle-tool-usage',
        kind: 'tool_usage',
        actorType: 'candidate',
        actorId: 'candidate-bundle',
        narrative: 'Candidate used git diff to inspect the patch before submission.',
        payload: { tool: 'git', command: 'git diff' },
        sourceRefs: [await sourceRef('tool_usage', 'tool-1', 'git diff -- src/popover.ts')],
      },
      {
        ingestionKey: 'assessment-event:bundle-transcript',
        kind: 'transcript_span',
        actorType: 'candidate',
        actorId: 'candidate-bundle',
        narrative: 'Candidate explained why the patch fixes the bug.',
        payload: { transcriptOffsetMs: 42000 },
        sourceRefs: [await sourceRef('transcript_span', 'transcript-2', 'The cleanup now runs on unmount and removes the stale listener.')],
      },
    ];
    const finalSummary = 'I fixed stale listener cleanup and validated it with the regression test.';

    const response = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/final-submission-bundles`,
      jsonRequest({
        ingestionKey: 'assessment-event:bundle-final-submission',
        actorType: 'candidate',
        actorId: 'candidate-bundle',
        narrative: 'Candidate submitted the final repo-task evidence bundle.',
        payload: { finalSummary },
        sourceRefs: [await sourceRef('final_submission', 'submission-1', finalSummary)],
        artifacts,
      }),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as {
      bundle: {
        event: { id: string; kind: string };
        artifactEvents: Array<{ id: string; kind: string }>;
        transition: { toState: string } | null;
      };
    };
    expect(body.bundle.event.kind).toBe('final_submission');
    expect(body.bundle.artifactEvents.map((event) => event.kind).sort()).toEqual([
      'ai_interaction',
      'candidate_plan',
      'code_diff',
      'diagram',
      'message',
      'terminal_output',
      'test_run',
      'tool_usage',
      'transcript_span',
    ]);
    expect(body.bundle.transition?.toState).toBe('FINAL_SUBMITTED');

    expect(sqlite.prepare(
      'SELECT state FROM assessment_sessions WHERE id = ?',
    ).get(session.id)).toEqual({ state: 'FINAL_SUBMITTED' });
    expect(sqlite.prepare(
      `SELECT kind, COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE session_id = ?
        GROUP BY kind
        ORDER BY kind`,
    ).all(session.id)).toEqual([
      { kind: 'ai_interaction', count: 1 },
      { kind: 'candidate_plan', count: 1 },
      { kind: 'code_diff', count: 1 },
      { kind: 'diagram', count: 1 },
      { kind: 'final_submission', count: 1 },
      { kind: 'message', count: 1 },
      { kind: 'terminal_output', count: 1 },
      { kind: 'test_run', count: 1 },
      { kind: 'tool_usage', count: 1 },
      { kind: 'transcript_span', count: 1 },
    ]);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM context_records
        WHERE scope_type = 'assessment_session'
          AND scope_id = ?`,
    ).get(session.id)).toEqual({ count: 10 });
    expect(sqlite.prepare(
      `SELECT source_ref_type, exact_text
         FROM assessment_event_source_refs
        WHERE event_id = ?`,
    ).get(body.bundle.event.id)).toEqual({
      source_ref_type: 'final_submission',
      exact_text: finalSummary,
    });
  });

  it('submits a real commit as source-backed assessment evidence and marks the session final', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:commit-submission',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-commit',
    });
    const baseCommitSha = '1111111111111111111111111111111111111111';
    const commitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const commitText = `commit ${commitSha}
Author: Candidate <candidate@example.com>

Fix stale popover listener cleanup.`;
    const diffText = `diff --git a/src/popover.ts b/src/popover.ts
index 5c7b20a..7f9a12e 100644
--- a/src/popover.ts
+++ b/src/popover.ts
@@ -42,6 +42,7 @@ export function closePopover() {
+  cleanupStaleHandler();
 }`;

    const response = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/commit-submissions`,
      jsonRequest({
        ingestionKey: 'assessment-event:commit-submission',
        actorType: 'candidate',
        actorId: 'candidate-commit',
        narrative: 'Candidate submitted a real assessment commit for review.',
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/popover-cleanup',
        baseCommitSha,
        commitSha,
        commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}`,
        changedFiles: [{
          path: 'src/popover.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
        }],
        sourceRefs: [
          await sourceRef('git_commit', commitSha, commitText),
          await sourceRef('code_diff', `${commitSha}:diff`, diffText),
        ],
      }),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as {
      submission: {
        event: { id: string; kind: string; contextRecordId: string };
        transition: { toState: string } | null;
      };
    };
    expect(body.submission.event.kind).toBe('commit_submission');
    expect(body.submission.event.contextRecordId).toBeTruthy();
    expect(body.submission.transition?.toState).toBe('FINAL_SUBMITTED');

    expect(sqlite.prepare(
      'SELECT state FROM assessment_sessions WHERE id = ?',
    ).get(session.id)).toEqual({ state: 'FINAL_SUBMITTED' });

    const persistedEvent = sqlite.prepare(
      `SELECT kind, actor_type, actor_id, payload_json
         FROM assessment_evidence_events
        WHERE id = ?`,
    ).get(body.submission.event.id) as {
      kind: string;
      actor_type: string;
      actor_id: string;
      payload_json: string;
    };
    expect(persistedEvent.kind).toBe('commit_submission');
    expect(persistedEvent.actor_type).toBe('candidate');
    expect(persistedEvent.actor_id).toBe('candidate-commit');
    expect(JSON.parse(persistedEvent.payload_json)).toEqual({
      repositoryUrl: 'https://github.com/open-source/widgets',
      forkRepositoryUrl: 'https://github.com/candidate/widgets',
      branchName: 'pipe-assessment/popover-cleanup',
      baseCommitSha,
      commitSha,
      commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}`,
      changedFiles: [{
        path: 'src/popover.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
      }],
      upstreamPrConsent: false,
    });
    expect(sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, exact_text
         FROM assessment_event_source_refs
        WHERE event_id = ?
        ORDER BY source_ref_type`,
    ).all(body.submission.event.id)).toEqual([
      {
        source_ref_type: 'code_diff',
        source_ref_id: `${commitSha}:diff`,
        exact_text: diffText,
      },
      {
        source_ref_type: 'git_commit',
        source_ref_id: commitSha,
        exact_text: commitText,
      },
    ]);
  });

  it('rejects commit submissions that are not backed by exact commit and diff source refs', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:commit-submission-rejection',
      mode: 'OPEN_SOURCE_BUG_FIX',
    });
    const commitSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const diffText = 'diff --git a/src/popover.ts b/src/popover.ts';
    const response = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/commit-submissions`,
      jsonRequest({
        ingestionKey: 'assessment-event:commit-submission-forged',
        actorType: 'candidate',
        narrative: 'Candidate tried to submit a commit without exact commit evidence.',
        repositoryUrl: 'https://github.com/open-source/widgets',
        branchName: 'pipe-assessment/popover-cleanup',
        baseCommitSha: '2222222222222222222222222222222222222222',
        commitSha,
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
        sourceRefs: [
          await sourceRef('code_diff', `${commitSha}:diff`, diffText),
          await sourceRef('transcript_span', 'transcript-commit-claim', `I committed ${commitSha}`),
        ],
      }),
      env,
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain(
      'commit submission requires a git_commit source ref whose exact text contains commitSha',
    );
    expect(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM assessment_evidence_events WHERE session_id = ?',
    ).get(session.id)).toEqual({ count: 0 });
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

    const forgedText = 'diff --git a/src/popover.ts b/src/popover.ts\n+cleanupStaleHandler();';
    const forgedReport = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:forged-positive-source',
        status: 'EVALUATED',
        summary: 'Candidate demonstrated implementation correctness.',
        output: { schemaVersion: 'repo-task-assessment-output-v1' },
        claims: [{
          id: 'claim-forged-source',
          polarity: 'positive',
          dimension: 'implementation_correctness',
          narrative: 'Candidate fixed the listener cleanup.',
          sourceRefs: [await sourceRef('code_diff', 'diff-forged', forgedText)],
        }],
        diagnostics: [],
      }),
      env,
    );
    expect(forgedReport.status).toBe(400);
    const forgedBody = await forgedReport.json() as { error: { message: string } };
    expect(forgedBody.error.message).toContain(
      'positive evaluation claim claim-forged-source source ref code_diff:diff-forged is not backed by assessment session evidence',
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
    const diagnosticBody = await diagnosticResponse.json() as {
      diagnostic: { id: string; reportId: string | null; code: string; severity: string };
    };

    const persistedDiagnostic = sqlite.prepare(
      `SELECT id, report_id, code, severity, provider, retryable, message
         FROM assessment_diagnostics WHERE session_id = ?`,
    ).get(session.id);
    expect(persistedDiagnostic).toEqual({
      id: diagnosticBody.diagnostic.id,
      report_id: diagnosticBody.diagnostic.reportId,
      code: 'AI_DEVELOPER_UNAVAILABLE',
      severity: 'blocking',
      provider: 'openai',
      retryable: 1,
      message: 'AI developer provider was not configured for this environment.',
    });
    expect(diagnosticBody.diagnostic).toMatchObject({
      code: 'AI_DEVELOPER_UNAVAILABLE',
      severity: 'blocking',
    });
    expect(diagnosticBody.diagnostic.reportId).toBeTruthy();
    expect(sqlite.prepare(
      `SELECT status FROM assessment_evaluation_reports WHERE id = ?`,
    ).get(diagnosticBody.diagnostic.reportId)).toEqual({ status: 'AI_DEVELOPER_UNAVAILABLE' });
    expect(sqlite.prepare(
      'SELECT state FROM assessment_sessions WHERE id = ?',
    ).get(session.id)).toEqual({ state: 'DIAGNOSTIC' });
  });

  it('requires negative evaluation claims to cite captured session evidence', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:negative-claim-provenance',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-negative-claim',
    });
    const failedTestText = 'npm test\nFAIL src/popover.test.ts\nExpected cleanupStaleHandler to be called.';

    const unsupportedNegativeReport = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:unsupported-negative',
        status: 'EVALUATED',
        summary: 'Candidate submitted a fix but tests still failed.',
        output: { schemaVersion: 'repo-task-assessment-output-v1' },
        claims: [{
          id: 'claim-tests-failed-without-source',
          polarity: 'negative',
          dimension: 'verification',
          narrative: 'The submitted fix did not pass the relevant test suite.',
          sourceRefs: [],
        }],
        diagnostics: [],
      }),
      env,
    );

    expect(unsupportedNegativeReport.status).toBe(400);
    const unsupportedNegativeBody = await unsupportedNegativeReport.json() as {
      error: { message: string };
    };
    expect(unsupportedNegativeBody.error.message).toContain(
      'negative evaluation claim claim-tests-failed-without-source requires at least one exact source ref',
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_evaluation_reports').get()).toEqual({
      count: 0,
    });

    const forgedNegativeReport = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:forged-negative',
        status: 'EVALUATED',
        summary: 'Candidate submitted a fix but tests still failed.',
        output: { schemaVersion: 'repo-task-assessment-output-v1' },
        claims: [{
          id: 'claim-tests-failed-forged',
          polarity: 'negative',
          dimension: 'verification',
          narrative: 'The submitted fix did not pass the relevant test suite.',
          sourceRefs: [await sourceRef('test_run', 'test-forged', failedTestText)],
        }],
        diagnostics: [],
      }),
      env,
    );

    expect(forgedNegativeReport.status).toBe(400);
    const forgedNegativeBody = await forgedNegativeReport.json() as {
      error: { message: string };
    };
    expect(forgedNegativeBody.error.message).toContain(
      'negative evaluation claim claim-tests-failed-forged source ref test_run:test-forged is not backed by assessment session evidence',
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_evaluation_reports').get()).toEqual({
      count: 0,
    });

    const testRunSourceRef = await sourceRef('test_run', 'test-failure-1', failedTestText);
    expect((await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:failed-test-run',
        kind: 'test_run',
        actorType: 'dev_container',
        actorId: 'workspace-negative-claim',
        narrative: 'Candidate ran the verification suite and it failed.',
        payload: { command: 'npm test', exitCode: 1 },
        sourceRefs: [testRunSourceRef],
      }),
      env,
    )).status).toBe(201);

    const reportResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:source-backed-negative',
        status: 'EVALUATED',
        summary: 'Candidate submitted a fix but the captured test run still failed.',
        output: { schemaVersion: 'repo-task-assessment-output-v1' },
        claims: [{
          id: 'claim-tests-failed',
          polarity: 'negative',
          dimension: 'verification',
          narrative: 'The submitted fix did not pass the relevant test suite.',
          sourceRefs: [testRunSourceRef],
        }],
        diagnostics: [],
      }),
      env,
    );

    expect(reportResponse.status).toBe(201);
    const reportBody = await reportResponse.json() as {
      report: { id: string; status: string };
    };
    expect(reportBody.report.status).toBe('EVALUATED');
    expect(sqlite.prepare(
      `SELECT polarity, dimension, narrative
         FROM assessment_evaluation_claims
        WHERE report_id = ?`,
    ).get(reportBody.report.id)).toEqual({
      polarity: 'negative',
      dimension: 'verification',
      narrative: 'The submitted fix did not pass the relevant test suite.',
    });
    expect(sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, exact_text
         FROM assessment_claim_source_refs
        WHERE claim_id = ?`,
    ).get('claim-tests-failed')).toEqual({
      source_ref_type: 'test_run',
      source_ref_id: 'test-failure-1',
      exact_text: failedTestText,
    });
  });

  it('rejects diagnostic-only reports marked as evaluated', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:diagnostic-only-evaluated',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-diagnostic-only',
    });

    const evaluatedDiagnosticResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:diagnostic-only-evaluated',
        status: 'EVALUATED',
        summary: 'Unable to evaluate because no source-backed solution evidence was captured.',
        output: {
          schemaVersion: 'repo-task-assessment-output-v1',
          status: 'PROVENANCE_INCOMPLETE',
        },
        claims: [{
          id: 'claim-provenance-gap',
          polarity: 'diagnostic',
          dimension: 'source_provenance',
          narrative: 'No source-backed code diff or final submission was captured.',
          sourceRefs: [],
        }],
        diagnostics: [{
          code: 'MISSING_REPO_SOURCE_EVIDENCE',
          severity: 'blocking',
          message: 'No source-backed repo task packet was captured.',
        }],
      }),
      env,
    );

    expect(evaluatedDiagnosticResponse.status).toBe(400);
    const evaluatedDiagnosticBody = await evaluatedDiagnosticResponse.json() as {
      error: { message: string };
    };
    expect(evaluatedDiagnosticBody.error.message).toContain(
      'EVALUATED assessment report requires at least one non-diagnostic evaluation claim',
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_evaluation_reports').get()).toEqual({
      count: 0,
    });

    const diagnosticResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:diagnostic-only-provenance-incomplete',
        status: 'PROVENANCE_INCOMPLETE',
        summary: 'Unable to evaluate because no source-backed solution evidence was captured.',
        output: {
          schemaVersion: 'repo-task-assessment-output-v1',
          status: 'PROVENANCE_INCOMPLETE',
        },
        claims: [{
          id: 'claim-provenance-gap',
          polarity: 'diagnostic',
          dimension: 'source_provenance',
          narrative: 'No source-backed code diff or final submission was captured.',
          sourceRefs: [],
        }],
        diagnostics: [{
          code: 'MISSING_REPO_SOURCE_EVIDENCE',
          severity: 'blocking',
          message: 'No source-backed repo task packet was captured.',
        }],
      }),
      env,
    );

    expect(diagnosticResponse.status).toBe(201);
    const diagnosticBody = await diagnosticResponse.json() as {
      report: { id: string; status: string };
    };
    expect(diagnosticBody.report.status).toBe('PROVENANCE_INCOMPLETE');
    expect(sqlite.prepare(
      `SELECT status, summary
         FROM assessment_evaluation_reports
        WHERE id = ?`,
    ).get(diagnosticBody.report.id)).toEqual({
      status: 'PROVENANCE_INCOMPLETE',
      summary: 'Unable to evaluate because no source-backed solution evidence was captured.',
    });
  });

  it('persists diagnostic source refs through repo-task evaluation reports', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:diagnostic-source-ref',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-diagnostic-source-ref',
    });
    const diagnosticText = 'No reviewable repository task packet was assigned to this assessment.';
    const diagnosticSourceRef = await sourceRef('system_diagnostic', 'missing-task-packet-1', diagnosticText);

    const forgedDiagnosticResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:forged-diagnostic-source-ref',
        status: 'PROVENANCE_INCOMPLETE',
        summary: 'Unable to evaluate because no reviewable repository task packet was assigned.',
        output: {
          schemaVersion: 'repo-task-assessment-output-v1',
          status: 'PROVENANCE_INCOMPLETE',
        },
        claims: [],
        diagnostics: [{
          code: 'MISSING_REPO_TASK_PACKET',
          severity: 'blocking',
          message: 'No reviewable repository task packet was assigned.',
          sourceRefs: [await sourceRef('system_diagnostic', 'missing-task-packet-forged', diagnosticText)],
        }],
      }),
      env,
    );

    expect(forgedDiagnosticResponse.status).toBe(400);
    const forgedDiagnosticBody = await forgedDiagnosticResponse.json() as {
      error: { message: string };
    };
    expect(forgedDiagnosticBody.error.message).toContain(
      'source ref system_diagnostic:missing-task-packet-forged is not backed by assessment session evidence',
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_evaluation_reports').get()).toEqual({
      count: 0,
    });

    expect((await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:missing-task-packet',
        kind: 'system_diagnostic',
        actorType: 'system',
        actorId: 'assessment-router',
        narrative: 'The assessment could not find a source-backed repository task packet.',
        payload: { diagnosticCode: 'MISSING_REPO_TASK_PACKET' },
        sourceRefs: [diagnosticSourceRef],
      }),
      env,
    )).status).toBe(201);

    const reportResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:diagnostic-source-ref',
        status: 'PROVENANCE_INCOMPLETE',
        summary: 'Unable to evaluate because no reviewable repository task packet was assigned.',
        output: {
          schemaVersion: 'repo-task-assessment-output-v1',
          status: 'PROVENANCE_INCOMPLETE',
        },
        claims: [],
        diagnostics: [{
          id: 'diagnostic:missing-task-packet',
          code: 'MISSING_REPO_TASK_PACKET',
          severity: 'blocking',
          message: 'No reviewable repository task packet was assigned.',
          sourceRefs: [diagnosticSourceRef],
        }],
      }),
      env,
    );

    expect(reportResponse.status).toBe(201);
    const reportBody = await reportResponse.json() as {
      report: { id: string; contextRecordId: string; status: string };
    };
    expect(reportBody.report.status).toBe('PROVENANCE_INCOMPLETE');
    const storedReport = sqlite.prepare(
      `SELECT diagnostics_json
         FROM assessment_evaluation_reports
        WHERE id = ?`,
    ).get(reportBody.report.id) as { diagnostics_json: string };
    expect(JSON.parse(storedReport.diagnostics_json)).toEqual([expect.objectContaining({
      id: 'diagnostic:missing-task-packet',
      code: 'MISSING_REPO_TASK_PACKET',
      severity: 'blocking',
      message: 'No reviewable repository task packet was assigned.',
    })]);
    expect(sqlite.prepare(
      `SELECT dsr.source_ref_type, dsr.source_ref_id, dsr.exact_text
         FROM assessment_diagnostic_source_refs dsr
         JOIN assessment_diagnostics d ON d.id = dsr.diagnostic_id
        WHERE d.report_id = ?`,
    ).get(reportBody.report.id)).toEqual({
      source_ref_type: 'system_diagnostic',
      source_ref_id: 'missing-task-packet-1',
      exact_text: diagnosticText,
    });
    expect(sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, exact_text
         FROM context_record_source_refs
        WHERE context_record_id = ?
          AND source_ref_type = 'system_diagnostic'`,
    ).get(reportBody.report.contextRecordId)).toEqual({
      source_ref_type: 'system_diagnostic',
      source_ref_id: 'missing-task-packet-1',
      exact_text: diagnosticText,
    });
  });

  it('rejects repo-task outputs whose status contradicts the evaluation report', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:contradictory-output-status',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-contradictory-status',
    });
    const diffText = 'diff --git a/src/task.ts b/src/task.ts\n+export const fixed = true;';
    const diffSourceRef = await sourceRef('code_diff', 'diff-status-1', diffText);

    expect((await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:contradictory-status-diff',
        kind: 'code_diff',
        actorType: 'candidate',
        actorId: 'candidate-contradictory-status',
        narrative: 'Candidate submitted a source-backed implementation change.',
        payload: { filePath: 'src/task.ts' },
        sourceRefs: [diffSourceRef],
      }),
      env,
    )).status).toBe(201);

    const response = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:contradictory-output-status',
        status: 'EVALUATED',
        summary: 'Candidate submitted source-backed work, but the output status contradicts the report.',
        output: {
          schemaVersion: 'repo-task-assessment-output-v1',
          status: 'PROVENANCE_INCOMPLETE',
        },
        claims: [{
          id: 'claim-contradictory-status-work',
          polarity: 'positive',
          dimension: 'implementation_correctness',
          narrative: 'Candidate submitted a source-backed implementation change.',
          sourceRefs: [diffSourceRef],
        }],
        diagnostics: [],
      }),
      env,
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain(
      'repo-task assessment output status PROVENANCE_INCOMPLETE must match evaluation report status EVALUATED',
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM assessment_evaluation_reports').get()).toEqual({
      count: 0,
    });
  });

  it('persists evaluation reports only when positive claims cite exact source evidence', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:evaluation',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-evaluation',
    });
    const diffText = 'diff --git a/src/popover.ts b/src/popover.ts\n+cleanupStaleHandler();';
    const transcriptText = 'I chose this fix because the stale listener survives unmount.';
    const diffSourceRef = await sourceRef('code_diff', 'diff-1', diffText);
    const transcriptSourceRef = await sourceRef('transcript_span', 'transcript-1', transcriptText);

    expect((await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:evaluation-code-diff',
        kind: 'code_diff',
        actorType: 'candidate',
        actorId: 'candidate-evaluation',
        narrative: 'Candidate changed the listener cleanup path.',
        payload: { filePath: 'src/popover.ts' },
        sourceRefs: [diffSourceRef],
      }),
      env,
    )).status).toBe(201);
    expect((await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:evaluation-transcript',
        kind: 'transcript_span',
        actorType: 'candidate',
        actorId: 'candidate-evaluation',
        narrative: 'Candidate explained the implementation rationale.',
        payload: { transcriptOffsetMs: 12000 },
        sourceRefs: [transcriptSourceRef],
      }),
      env,
    )).status).toBe(201);

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
            sourceRefs: [diffSourceRef],
          },
          {
            id: 'claim-rationale',
            polarity: 'positive',
            dimension: 'communication',
            narrative: 'Candidate explained the implementation rationale.',
            confidence: 0.82,
            sourceRefs: [transcriptSourceRef],
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
      `SELECT id, confidence FROM assessment_evaluation_claims
        WHERE report_id = ?
        ORDER BY id`,
    ).all(reportBody.report.id)).toEqual([
      {
        id: 'claim-code-fix',
        confidence: 0.87,
      },
      {
        id: 'claim-rationale',
        confidence: 0.82,
      },
    ]);
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
