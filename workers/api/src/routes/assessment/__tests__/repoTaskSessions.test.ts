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
  metadata?: Record<string, unknown>,
): Promise<AssessmentEvidenceSourceRefInput> {
  return {
    sourceRefType,
    sourceRefId,
    exactText,
    contentHash: await sha256Hex(exactText),
    locator: { label: sourceRefId },
    ...(metadata ? { metadata } : {}),
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
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT 'owner-test',
        pipeline_id TEXT,
        name TEXT,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);
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

  it('flows assessment event and commit evidence into the living context before evaluation', async () => {
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-graph',
      'owner-graph',
      'pipeline-graph',
      'Graph Candidate',
      'graph-candidate@example.com',
      'active',
    );

    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:graph-realtime',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-graph',
    });

    const planText = 'I will reproduce the reconnect ordering bug before editing and keep the patch scoped to the stream buffer.';
    const eventResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:graph-plan',
        kind: 'candidate_plan',
        actorType: 'candidate',
        actorId: 'candidate-graph',
        narrative: 'Candidate wrote a source-backed implementation plan before editing code.',
        payload: { planText },
        sourceRefs: [await sourceRef('candidate_plan', 'plan-note-graph', planText)],
      }),
      env,
    );
    expect(eventResponse.status).toBe(201);

    const interaction = sqlite.prepare(
      `SELECT interaction_type, external_reference
         FROM interactions
        WHERE external_reference = ?`,
    ).get(session.id);
    expect(interaction).toEqual({
      interaction_type: 'assessment:OPEN_SOURCE_BUG_FIX',
      external_reference: session.id,
    });

    const planRecord = sqlite.prepare(
      `SELECT cr.scope_type, cr.record_type, cr.narrative,
              sr.source_ref_type, sr.source_ref_id, sr.exact_text
         FROM context_records cr
         JOIN context_record_source_refs sr ON sr.context_record_id = cr.id
        WHERE cr.record_type = 'assessment:candidate_plan'
          AND sr.source_ref_id = 'plan-note-graph'`,
    ).get();
    expect(planRecord).toEqual({
      scope_type: 'workspace_person',
      record_type: 'assessment:candidate_plan',
      narrative: 'Candidate wrote a source-backed implementation plan before editing code.',
      source_ref_type: 'candidate_plan',
      source_ref_id: 'plan-note-graph',
      exact_text: planText,
    });

    const baseCommitSha = '3333333333333333333333333333333333333333';
    const commitSha = '4444444444444444444444444444444444444444';
    const commitText = `commit ${commitSha}\n\nFix reconnect ordering.`;
    const diffText = 'diff --git a/src/stream.ts b/src/stream.ts\n+sortBufferedSegmentsByTimestamp();';
    const commitResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/commit-submissions`,
      jsonRequest({
        ingestionKey: 'assessment-event:graph-commit',
        actorType: 'candidate',
        actorId: 'candidate-graph',
        narrative: 'Candidate submitted a focused source-backed assessment commit.',
        repositoryUrl: 'https://github.com/open-source/streaming',
        forkRepositoryUrl: 'https://github.com/candidate/streaming',
        branchName: 'pipe-assessment/reconnect-ordering',
        baseCommitSha,
        commitSha,
        commitUrl: `https://github.com/candidate/streaming/commit/${commitSha}`,
        changedFiles: [{ path: 'src/stream.ts', status: 'modified', additions: 1, deletions: 0 }],
        sourceRefs: [
          await sourceRef('git_commit', commitSha, commitText),
          await sourceRef('code_diff', `${baseCommitSha}..${commitSha}`, diffText),
        ],
      }),
      env,
    );
    expect(commitResponse.status).toBe(201);

    const commitRecord = sqlite.prepare(
      `SELECT cr.record_type, cr.narrative,
              sr.source_ref_type, sr.source_ref_id, sr.exact_text
         FROM context_records cr
         JOIN context_record_source_refs sr ON sr.context_record_id = cr.id
        WHERE cr.record_type = 'assessment:commit_submission'
          AND sr.source_ref_type = 'git_commit'
          AND sr.source_ref_id = ?`,
    ).get(commitSha);
    expect(commitRecord).toEqual({
      record_type: 'assessment:commit_submission',
      narrative: 'Candidate submitted a focused source-backed assessment commit.',
      source_ref_type: 'git_commit',
      source_ref_id: commitSha,
      exact_text: commitText,
    });

    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evaluation_reports
        WHERE session_id = ?`,
    ).get(session.id)).toEqual({ count: 0 });
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

  it('allows a finalized source-backed assessment to be marked evaluated after its report is persisted', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:evaluation-finalize',
      mode: 'OPEN_SOURCE_BUG_FIX',
    });
    const codeDiffSourceRef = await sourceRef(
      'code_diff',
      'base-sha..candidate-sha',
      'diff --git a/src/popover.ts b/src/popover.ts\n+cleanupStaleHandler();',
    );

    const started = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/state`,
      jsonRequest({
        toState: 'IN_PROGRESS',
        reason: 'Candidate opened the workspace.',
      }),
      env,
    );
    expect(started.status).toBe(200);
    const evidenceEventResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:evaluation-finalize-diff',
        kind: 'commit_submission',
        actorType: 'candidate',
        actorId: 'candidate-1',
        narrative: 'Candidate submitted the source-backed assessment diff.',
        payload: { commitSha: 'candidate-sha' },
        sourceRefs: [codeDiffSourceRef],
      }),
      env,
    );
    expect(evidenceEventResponse.status).toBe(201);
    const submitted = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/state`,
      jsonRequest({
        toState: 'FINAL_SUBMITTED',
        reason: 'Candidate submitted the final evidence bundle.',
      }),
      env,
    );
    expect(submitted.status).toBe(200);

    const reportResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:evaluation-finalize',
        status: 'EVALUATED',
        summary: 'Candidate produced a focused source-backed commit.',
        claims: [{
          id: 'claim-focused-commit',
          polarity: 'positive',
          dimension: 'implementation_correctness',
          narrative: 'The submitted diff fixes the stale popover listener cleanup.',
          sourceRefs: [codeDiffSourceRef],
        }],
        diagnostics: [],
      }),
      env,
    );
    expect(reportResponse.status).toBe(201);

    const evaluatedResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/state`,
      jsonRequest({
        toState: 'EVALUATED',
        reason: 'Source-backed assessment report is persisted.',
      }),
      env,
    );

    expect(evaluatedResponse.status).toBe(200);
    expect(sqlite.prepare(
      'SELECT state FROM assessment_sessions WHERE id = ?',
    ).get(session.id)).toEqual({ state: 'EVALUATED' });
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
        ingestionKey: 'assessment-event:bundle-dev-container',
        kind: 'dev_container_event',
        actorType: 'dev_container',
        narrative: 'Dev container observed the candidate editing the focused source file.',
        payload: { filePath: 'src/popover.ts', action: 'save' },
        sourceRefs: [await sourceRef('code_server_file_observation', 'editor-save-1', 'Saved src/popover.ts after cleanup change.')],
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
      'dev_container_event',
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
      { kind: 'dev_container_event', count: 1 },
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
    ).get(session.id)).toEqual({ count: 11 });
    expect(sqlite.prepare(
      `SELECT source_ref_type, exact_text
         FROM assessment_event_source_refs
        WHERE event_id = ?`,
    ).get(body.bundle.event.id)).toEqual({
      source_ref_type: 'final_submission',
      exact_text: finalSummary,
    });

    const progressResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/progress`,
      { method: 'GET' },
      env,
    );
    expect(progressResponse.status).toBe(200);
    const progressBody = await progressResponse.json() as {
      progress: {
        hasWorkEvidence: boolean;
        hasMessageEvidence: boolean;
        hasDevContainerEvidence: boolean;
        hasToolUsageEvidence: boolean;
        hasAiInteraction: boolean;
        hasTranscriptEvidence: boolean;
        hasTestEvidence: boolean;
      };
    };
    expect(progressBody.progress).toMatchObject({
      hasWorkEvidence: true,
      hasMessageEvidence: true,
      hasDevContainerEvidence: true,
      hasToolUsageEvidence: true,
      hasAiInteraction: true,
      hasTranscriptEvidence: true,
      hasTestEvidence: true,
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
          await sourceRef('code_diff', `${baseCommitSha}..${commitSha}`, diffText),
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
        source_ref_id: `${baseCommitSha}..${commitSha}`,
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
          await sourceRef('code_diff', `2222222222222222222222222222222222222222..${commitSha}`, diffText),
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

  it('rejects commit submissions whose diff source ref is not tied to the submitted commit range', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:commit-submission-loose-diff',
      mode: 'OPEN_SOURCE_BUG_FIX',
    });
    const baseCommitSha = '2222222222222222222222222222222222222222';
    const commitSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const commitText = `commit ${commitSha}
Author: Candidate <candidate@example.com>

Fix stale popover listener cleanup.`;
    const diffText = `diff --git a/src/popover.ts b/src/popover.ts
--- a/src/popover.ts
+++ b/src/popover.ts
@@ -1,2 +1,3 @@
+cleanupStaleHandler();`;

    const response = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/commit-submissions`,
      jsonRequest({
        ingestionKey: 'assessment-event:commit-submission-loose-diff',
        actorType: 'candidate',
        narrative: 'Candidate submitted a diff source ref that was not tied to the commit range.',
        repositoryUrl: 'https://github.com/open-source/widgets',
        branchName: 'pipe-assessment/popover-cleanup',
        baseCommitSha,
        commitSha,
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
        sourceRefs: [
          await sourceRef('git_commit', commitSha, commitText),
          await sourceRef('code_diff', `${commitSha}:diff`, diffText),
        ],
      }),
      env,
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain(
      'commit submission requires a code_diff source ref for the submitted baseCommitSha..commitSha changes',
    );
    expect(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM assessment_evidence_events WHERE session_id = ?',
    ).get(session.id)).toEqual({ count: 0 });
  });

  it('rejects commit submissions whose commit URL belongs to an unrelated GitHub repository', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:commit-submission-unrelated-url',
      mode: 'OPEN_SOURCE_BUG_FIX',
    });
    const baseCommitSha = '2222222222222222222222222222222222222222';
    const commitSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const commitText = `commit ${commitSha}
Author: Candidate <candidate@example.com>

Fix stale popover listener cleanup.`;
    const diffText = `diff --git a/src/popover.ts b/src/popover.ts
--- a/src/popover.ts
+++ b/src/popover.ts
@@ -1,2 +1,3 @@
+cleanupStaleHandler();`;

    const response = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/commit-submissions`,
      jsonRequest({
        ingestionKey: 'assessment-event:commit-submission-unrelated-url',
        actorType: 'candidate',
        narrative: 'Candidate submitted a commit URL from an unrelated repository.',
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/popover-cleanup',
        baseCommitSha,
        commitSha,
        commitUrl: `https://github.com/unrelated/widgets/commit/${commitSha}`,
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
        sourceRefs: [
          await sourceRef('git_commit', commitSha, commitText),
          await sourceRef('code_diff', `${baseCommitSha}..${commitSha}`, diffText),
        ],
      }),
      env,
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain('commitUrl must belong to repositoryUrl or forkRepositoryUrl');
    expect(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM assessment_evidence_events WHERE session_id = ?',
    ).get(session.id)).toEqual({ count: 0 });
  });

  it('rejects commit submissions that do not match the assigned challenge repo and base commit', async () => {
    async function createAssignedChallengeSession(idSuffix: string): Promise<{
      sessionId: string;
      assignedBaseCommitSha: string;
      commitSha: string;
      commitText: string;
      diffText: string;
    }> {
      const session = await createSession(app, env, {
        ingestionKey: `assessment-session:assigned-challenge-${idSuffix}`,
        mode: 'OPEN_SOURCE_BUG_FIX',
      });
      const assignedBaseCommitSha = '1111111111111111111111111111111111111111';
      const challengeText = [
        'Repo: https://github.com/open-source/widgets',
        `Base commit: ${assignedBaseCommitSha}`,
        'Task: Fix stale popover listener cleanup.',
      ].join('\n');
      const challengeRef = await sourceRef(
        'open_source_challenge_packet',
        `challenge-packet-${idSuffix}`,
        challengeText,
      );
      const challengeResponse = await app.request(
        `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
        jsonRequest({
          ingestionKey: `assessment-event:assigned-challenge-${idSuffix}`,
          kind: 'recruiter_note',
          actorType: 'recruiter',
          narrative: 'Recruiter assigned a concrete source-backed open-source challenge packet.',
          payload: {
            repositoryUrl: 'https://github.com/open-source/widgets',
            baseCommitSha: assignedBaseCommitSha,
          },
          sourceRefs: [{
            ...challengeRef,
            evidenceRole: 'assigned_challenge',
            locator: {
              repositoryUrl: 'https://github.com/open-source/widgets',
              baseCommitSha: assignedBaseCommitSha,
            },
          }],
        }),
        env,
      );
      expect(challengeResponse.status).toBe(201);

      const commitSha = idSuffix === 'repo'
        ? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        : 'cccccccccccccccccccccccccccccccccccccccc';
      const commitText = `commit ${commitSha}
Author: Candidate <candidate@example.com>

Fix stale popover listener cleanup.`;
      const diffText = `diff --git a/src/popover.ts b/src/popover.ts
--- a/src/popover.ts
+++ b/src/popover.ts
@@ -1,2 +1,3 @@
+cleanupStaleHandler();`;
      return { sessionId: session.id, assignedBaseCommitSha, commitSha, commitText, diffText };
    }

    const repoCase = await createAssignedChallengeSession('repo');
    const repoMismatchResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${repoCase.sessionId}/commit-submissions`,
      jsonRequest({
        ingestionKey: 'assessment-event:repo-mismatch',
        actorType: 'candidate',
        narrative: 'Candidate submitted work from the wrong repository.',
        repositoryUrl: 'https://github.com/other/widgets',
        branchName: 'pipe-assessment/popover-cleanup',
        baseCommitSha: repoCase.assignedBaseCommitSha,
        commitSha: repoCase.commitSha,
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
        sourceRefs: [
          await sourceRef('git_commit', repoCase.commitSha, repoCase.commitText),
          await sourceRef(
            'code_diff',
            `${repoCase.assignedBaseCommitSha}..${repoCase.commitSha}`,
            repoCase.diffText,
          ),
        ],
      }),
      env,
    );
    expect(repoMismatchResponse.status).toBe(400);
    const repoBody = await repoMismatchResponse.json() as { error: { message: string } };
    expect(repoBody.error.message).toContain('repositoryUrl must be the assigned challenge repositoryUrl');
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE session_id = ?
          AND kind = 'commit_submission'`,
    ).get(repoCase.sessionId)).toEqual({ count: 0 });

    const baseCase = await createAssignedChallengeSession('base');
    const wrongBaseCommitSha = '2222222222222222222222222222222222222222';
    const baseMismatchResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${baseCase.sessionId}/commit-submissions`,
      jsonRequest({
        ingestionKey: 'assessment-event:base-mismatch',
        actorType: 'candidate',
        narrative: 'Candidate submitted work from the wrong base commit.',
        repositoryUrl: 'https://github.com/open-source/widgets',
        branchName: 'pipe-assessment/popover-cleanup',
        baseCommitSha: wrongBaseCommitSha,
        commitSha: baseCase.commitSha,
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
        sourceRefs: [
          await sourceRef('git_commit', baseCase.commitSha, baseCase.commitText),
          await sourceRef('code_diff', `${wrongBaseCommitSha}..${baseCase.commitSha}`, baseCase.diffText),
        ],
      }),
      env,
    );
    expect(baseMismatchResponse.status).toBe(400);
    const baseBody = await baseMismatchResponse.json() as { error: { message: string } };
    expect(baseBody.error.message).toContain('baseCommitSha must be the assigned challenge baseCommitSha');
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE session_id = ?
          AND kind = 'commit_submission'`,
    ).get(baseCase.sessionId)).toEqual({ count: 0 });
  });

  it('rejects direct commit submissions from non-assessment branches', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:commit-submission-default-branch',
      mode: 'OPEN_SOURCE_BUG_FIX',
    });
    const baseCommitSha = '1111111111111111111111111111111111111111';
    const commitSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const commitText = `commit ${commitSha}
Author: Candidate <candidate@example.com>

Fix stale popover listener cleanup.`;
    const diffText = `diff --git a/src/popover.ts b/src/popover.ts
--- a/src/popover.ts
+++ b/src/popover.ts
@@ -1,2 +1,3 @@
+cleanupStaleHandler();`;

    const response = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/commit-submissions`,
      jsonRequest({
        ingestionKey: 'assessment-event:commit-submission-main-branch',
        actorType: 'candidate',
        narrative: 'Candidate tried to submit from the repository default branch.',
        repositoryUrl: 'https://github.com/open-source/widgets',
        branchName: 'main',
        baseCommitSha,
        commitSha,
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
        sourceRefs: [
          await sourceRef('git_commit', commitSha, commitText),
          await sourceRef('code_diff', `${baseCommitSha}..${commitSha}`, diffText),
        ],
      }),
      env,
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain(
      'branchName must be pipe-assessment or a pipe-assessment/* branch',
    );
    expect(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM assessment_evidence_events WHERE session_id = ?',
    ).get(session.id)).toEqual({ count: 0 });
  });

  it('treats dev-container challenges as commit-required assessment sessions', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:dev-container-commit-required',
      mode: 'DEV_CONTAINER_CHALLENGE',
      candidateId: 'candidate-dev-container',
    });

    const challengeText = [
      'Repo: https://github.com/open-source/widgets',
      'Base commit: 3333333333333333333333333333333333333333',
      'Task: fix stale popover listener cleanup and add a regression test.',
    ].join('\n');
    const challengeResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:dev-container-challenge-packet',
        kind: 'recruiter_note',
        actorType: 'recruiter',
        actorId: 'recruiter-1',
        narrative: 'Recruiter assigned the concrete source-backed dev-container challenge.',
        sourceRefs: [{
          ...await sourceRef('review_challenge_packet', 'challenge-packet-dev-container', challengeText),
          evidenceRole: 'assigned_challenge',
        }],
      }),
      env,
    );
    expect(challengeResponse.status).toBe(201);

    const terminalText = 'npm test -- popover\nFAIL stale handler remains attached';
    const workResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:dev-container-terminal-before-commit',
        kind: 'terminal_output',
        actorType: 'dev_container',
        narrative: 'Candidate reproduced the failure in the dev container before committing.',
        payload: { command: 'npm test -- popover', exitCode: 1 },
        sourceRefs: [await sourceRef('terminal_output', 'terminal-before-commit', terminalText)],
      }),
      env,
    );
    expect(workResponse.status).toBe(201);

    const progressResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/progress`,
      { method: 'GET' },
      env,
    );
    expect(progressResponse.status).toBe(200);
    const progressBody = await progressResponse.json() as {
      progress: {
        session: {
          mode: string;
        };
        stage: string;
        nextAction: string;
        hasChallengePacket: boolean;
        hasWorkEvidence: boolean;
        hasCommitSubmission: boolean;
        evidenceSnippets: Array<{
          sourceRefType: string;
          evidenceRole: string;
          exactText: string;
        }>;
      };
    };
    expect(progressBody.progress).toMatchObject({
      session: {
        mode: 'DEV_CONTAINER_CHALLENGE',
      },
      stage: 'WORK_IN_PROGRESS',
      nextAction: 'SUBMIT_COMMIT',
      hasChallengePacket: true,
      hasWorkEvidence: true,
      hasCommitSubmission: false,
    });
    expect(progressBody.progress.evidenceSnippets).toEqual([
      expect.objectContaining({
        sourceRefType: 'review_challenge_packet',
        evidenceRole: 'assigned_challenge',
        exactText: expect.stringContaining('Task: fix stale popover listener cleanup and add a regression test.'),
      }),
      expect.objectContaining({
        sourceRefType: 'terminal_output',
        evidenceRole: 'support',
        exactText: expect.stringContaining('FAIL stale handler remains attached'),
      }),
    ]);
  });

  it('summarizes source-backed repo-task progress from challenge assignment through evaluation', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:progress-snapshot',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-progress',
    });

    const initialProgressResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/progress`,
      { method: 'GET' },
      env,
    );
    expect(initialProgressResponse.status).toBe(200);
    const initialProgressBody = await initialProgressResponse.json() as {
      progress: {
        stage: string;
        nextAction: string;
        assignmentTrust: {
          state: string;
          label: string;
          tone: string;
        };
        hasChallengePacket: boolean;
        hasCommitSubmission: boolean;
      };
    };
    expect(initialProgressBody.progress).toMatchObject({
      stage: 'WAITING_FOR_CHALLENGE',
      nextAction: 'ASSIGN_CHALLENGE',
      assignmentTrust: {
        state: 'waiting_for_challenge',
        label: 'No challenge packet',
        tone: 'blocked',
      },
      hasChallengePacket: false,
      hasCommitSubmission: false,
    });

    const challengeText = [
      'Repo: https://github.com/open-source/widgets',
      'Base commit: 3333333333333333333333333333333333333333',
      'Task: fix stale popover listener cleanup and add a regression test.',
      'Success: commit a focused patch with passing popover tests.',
    ].join('\n');
    const challengeSourceRef = {
      ...await sourceRef('review_challenge_packet', 'challenge-packet-popover-cleanup', challengeText),
      evidenceRole: 'assigned_challenge',
      locator: {
        repositoryUrl: 'https://github.com/open-source/widgets',
        baseCommitSha: '3333333333333333333333333333333333333333',
      },
    };
    const challengeEventResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/events`,
      jsonRequest({
        ingestionKey: 'assessment-event:progress-challenge',
        kind: 'recruiter_note',
        actorType: 'recruiter',
        actorId: 'recruiter-1',
        narrative: 'Recruiter assigned a concrete source-backed open-source challenge packet.',
        payload: { repositoryUrl: 'https://github.com/open-source/widgets' },
        sourceRefs: [challengeSourceRef],
      }),
      env,
    );
    expect(challengeEventResponse.status).toBe(201);

    const challengeProgressResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/progress`,
      { method: 'GET' },
      env,
    );
    expect(challengeProgressResponse.status).toBe(200);
    const challengeProgressBody = await challengeProgressResponse.json() as {
      progress: {
        stage: string;
        nextAction: string;
        assignmentTrust: {
          state: string;
          label: string;
          detail: string;
          tone: string;
        };
        hasChallengePacket: boolean;
        challenge: { sourceRefType: string; sourceRefId: string; exactText: string };
      };
    };
    expect(challengeProgressBody.progress).toMatchObject({
      stage: 'CHALLENGE_READY',
      nextAction: 'OPEN_ROOM_OR_WORKSPACE',
      assignmentTrust: {
        state: 'source_backed_challenge',
        label: 'Source-backed challenge',
        detail: 'A reviewable challenge packet is captured as source evidence; confirm match proof before treating assignment fit as automatic.',
        tone: 'neutral',
      },
      hasChallengePacket: true,
      challenge: {
        sourceRefType: 'review_challenge_packet',
        sourceRefId: 'challenge-packet-popover-cleanup',
        exactText: challengeText,
      },
    });

    const baseCommitSha = '3333333333333333333333333333333333333333';
    const commitSha = 'dddddddddddddddddddddddddddddddddddddddd';
    const commitText = `commit ${commitSha}
Author: Candidate <candidate@example.com>

Fix stale popover listener cleanup.`;
    const diffText = `diff --git a/src/popover.ts b/src/popover.ts
--- a/src/popover.ts
+++ b/src/popover.ts
@@ -42,6 +42,7 @@ export function closePopover() {
+  cleanupStaleHandler();
}`;
    const commitSourceRef = await sourceRef('git_commit', commitSha, commitText);
    const codeDiffSourceRef = await sourceRef('code_diff', `${baseCommitSha}..${commitSha}`, diffText);
    const testRunSourceRef = await sourceRef(
      'test_run',
      `${commitSha}:test-run`,
      'npm test -- popover\nPASS popover cleanup regression',
    );
    const commitResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/commit-submissions`,
      jsonRequest({
        ingestionKey: 'assessment-event:progress-commit',
        actorType: 'candidate',
        actorId: 'candidate-progress',
        narrative: 'Candidate submitted the source-backed assessment commit.',
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/progress-popover',
        baseCommitSha,
        commitSha,
        commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}`,
        changedFiles: [{ path: 'src/popover.ts', status: 'modified', additions: 1, deletions: 0 }],
        sourceRefs: [commitSourceRef, codeDiffSourceRef, testRunSourceRef],
      }),
      env,
    );
    expect(commitResponse.status).toBe(201);

    const commitProgressResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/progress`,
      { method: 'GET' },
      env,
    );
    expect(commitProgressResponse.status).toBe(200);
    const commitProgressBody = await commitProgressResponse.json() as {
      progress: {
        stage: string;
        nextAction: string;
        hasCommitSubmission: boolean;
        hasWorkEvidence: boolean;
        hasTestEvidence: boolean;
        hasVerificationGap: boolean;
        latestEvent: { kind: string };
        commit: {
          repositoryUrl: string;
          forkRepositoryUrl: string;
          branchName: string;
          commitSha: string;
          changedFiles: Array<{ path: string; status: string }>;
        };
        evidenceCounts: Array<{ kind: string; count: number }>;
        sourceRefCounts: Array<{ kind: string; count: number }>;
      };
    };
    expect(commitProgressBody.progress).toMatchObject({
      stage: 'READY_FOR_EVALUATION',
      nextAction: 'START_EVALUATION',
      hasCommitSubmission: true,
      hasWorkEvidence: true,
      hasTestEvidence: true,
      hasVerificationGap: false,
      latestEvent: { kind: 'commit_submission' },
      commit: {
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/progress-popover',
        commitSha,
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
      },
    });
    expect(commitProgressBody.progress.evidenceCounts).toEqual(expect.arrayContaining([
      { kind: 'commit_submission', count: 1 },
      { kind: 'recruiter_note', count: 1 },
    ]));
    expect(commitProgressBody.progress.sourceRefCounts).toEqual(expect.arrayContaining([
      { kind: 'code_diff', count: 1 },
      { kind: 'git_commit', count: 1 },
      { kind: 'review_challenge_packet', count: 1 },
      { kind: 'test_run', count: 1 },
    ]));

    const evaluationResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/evaluation-reports`,
      jsonRequest({
        ingestionKey: 'evaluation:progress-commit-quality',
        status: 'EVALUATED',
        summary: 'Candidate produced a focused source-backed commit.',
        claims: [{
          id: 'claim-focused-commit',
          polarity: 'positive',
          dimension: 'commit_quality',
          narrative: 'The patch is focused on the stale popover listener cleanup.',
          sourceRefs: [codeDiffSourceRef],
        }],
        diagnostics: [],
      }),
      env,
    );
    expect(evaluationResponse.status).toBe(201);
    const evaluationBody = await evaluationResponse.json() as {
      report: { id: string; status: string };
    };

    const evaluatedProgressResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/progress`,
      { method: 'GET' },
      env,
    );
    expect(evaluatedProgressResponse.status).toBe(200);
    const evaluatedProgressBody = await evaluatedProgressResponse.json() as {
      progress: {
        stage: string;
        nextAction: string;
        evaluation: {
          status: string;
          summary: string;
          claims: Array<{
            polarity: string;
            dimension: string;
            narrative: string;
            sourceRefCount: number;
            sourceRefTypes: string[];
          }>;
        };
      };
    };
    expect(evaluatedProgressBody.progress).toMatchObject({
      stage: 'EVALUATED',
      nextAction: 'REVIEW_EVALUATION',
      evaluation: {
        status: 'EVALUATED',
        summary: 'Candidate produced a focused source-backed commit.',
        claims: [{
          polarity: 'positive',
          dimension: 'commit_quality',
          narrative: 'The patch is focused on the stale popover listener cleanup.',
          sourceRefCount: 1,
          sourceRefTypes: ['code_diff'],
        }],
      },
    });

    const humanDecisionSourceRef = await sourceRef(
      'assessment_evaluation_report',
      evaluationBody.report.id,
      'Candidate produced a focused source-backed commit.',
    );
    const forgedDecisionResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/human-decisions`,
      jsonRequest({
        ingestionKey: 'human-decision:forged-report',
        decision: 'advance',
        reviewerId: 'recruiter-progress',
        summary: 'Human reviewer advances the candidate.',
        sourceRefs: [{
          ...humanDecisionSourceRef,
          sourceRefId: 'assessment-report-forged',
        }],
      }),
      env,
    );
    expect(forgedDecisionResponse.status).toBe(400);
    expect(await forgedDecisionResponse.json()).toMatchObject({
      error: {
        message: 'human assessment decision source ref assessment_evaluation_report:assessment-report-forged is not backed by assessment session evidence or evaluation output',
      },
    });

    const humanDecisionResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/human-decisions`,
      jsonRequest({
        ingestionKey: 'human-decision:advance-focused-commit',
        decision: 'advance',
        reviewerId: 'recruiter-progress',
        summary: 'Human reviewer advances the candidate after checking the source-backed report.',
        notes: 'Diff and tests support the decision.',
        sourceRefs: [humanDecisionSourceRef],
      }),
      env,
    );
    expect(humanDecisionResponse.status).toBe(201);
    const humanDecisionBody = await humanDecisionResponse.json() as {
      decision: {
        decision: string;
        summary: string;
        notes: string | null;
        sourceRefCount: number;
        sourceRefTypes: string[];
      };
      progress: {
        stage: string;
        nextAction: string;
        latestEvent: { kind: string };
        humanDecision: {
          decision: string;
          summary: string;
          notes: string | null;
          sourceRefCount: number;
          sourceRefTypes: string[];
        };
        evidenceCounts: Array<{ kind: string; count: number }>;
      };
    };
    expect(humanDecisionBody.decision).toMatchObject({
      decision: 'advance',
      summary: 'Human reviewer advances the candidate after checking the source-backed report.',
      notes: 'Diff and tests support the decision.',
      sourceRefCount: 1,
      sourceRefTypes: ['assessment_evaluation_report'],
    });
    expect(humanDecisionBody.progress).toMatchObject({
      stage: 'EVALUATED',
      nextAction: 'NONE',
      latestEvent: { kind: 'human_assessment_decision' },
      humanDecision: {
        decision: 'advance',
        summary: 'Human reviewer advances the candidate after checking the source-backed report.',
        sourceRefCount: 1,
        sourceRefTypes: ['assessment_evaluation_report'],
      },
    });
    expect(humanDecisionBody.progress.evidenceCounts).toEqual(expect.arrayContaining([
      { kind: 'human_assessment_decision', count: 1 },
    ]));
  });

  it('surfaces source-backed verification gaps separately from real test evidence', async () => {
    const session = await createSession(app, env, {
      ingestionKey: 'assessment-session:verification-gap',
      mode: 'OPEN_SOURCE_BUG_FIX',
      candidateId: 'candidate-gap',
    });
    const baseCommitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const commitSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const commitText = `commit ${commitSha}
Author: Candidate <candidate@example.com>

Fix retry cleanup without captured tests.`;
    const diffText = `diff --git a/src/retry.ts b/src/retry.ts
--- a/src/retry.ts
+++ b/src/retry.ts
@@ -1,3 +1,4 @@
+cleanupRetryState();`;
    const verificationGapText = 'I could not run tests because dependency installation failed before the suite could start.';

    const commitResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/commit-submissions`,
      jsonRequest({
        ingestionKey: 'assessment-event:verification-gap-commit',
        actorType: 'candidate',
        actorId: 'candidate-gap',
        narrative: 'Candidate submitted a commit and recorded why test output is missing.',
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/retry-cleanup',
        baseCommitSha,
        commitSha,
        commitUrl: `https://github.com/candidate/widgets/commit/${commitSha}`,
        changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
        sourceRefs: [
          await sourceRef('git_commit', commitSha, commitText),
          await sourceRef('code_diff', `${baseCommitSha}..${commitSha}`, diffText),
          await sourceRef('verification_gap', `${commitSha}:test-evidence-missing`, verificationGapText),
        ],
      }),
      env,
    );
    expect(commitResponse.status).toBe(201);

    const progressResponse = await app.request(
      `/api/v1/assessment/repo-task/sessions/${session.id}/progress`,
      { method: 'GET' },
      env,
    );
    expect(progressResponse.status).toBe(200);
    const progressBody = await progressResponse.json() as {
      progress: {
        hasCommitSubmission: boolean;
        hasWorkEvidence: boolean;
        hasTestEvidence: boolean;
        hasVerificationGap: boolean;
        sourceRefCounts: Array<{ kind: string; count: number }>;
      };
    };
    expect(progressBody.progress).toMatchObject({
      hasCommitSubmission: true,
      hasWorkEvidence: true,
      hasTestEvidence: false,
      hasVerificationGap: true,
    });
    expect(progressBody.progress.sourceRefCounts).toEqual(expect.arrayContaining([
      { kind: 'code_diff', count: 1 },
      { kind: 'git_commit', count: 1 },
      { kind: 'verification_gap', count: 1 },
    ]));
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
