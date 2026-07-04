/**
 * Candidate dev-container workspace finalization tests.
 *
 * These run the real /rpc/dev-container route against a SQLite-backed D1 shim
 * and fake only the container bridge boundary. The Worker must own persistence:
 * the bridge returns source-backed git evidence, then the route writes it into
 * the assessment session store.
 */

import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from './helpers/mockD1';
import { signJwt } from '../lib/jwt';
import { rpcAuth } from '../routes/rpc';
import type { Env } from '../types';

const livingContextMigration = readMigration('0082_living_context_graph.sql');
const contextRecordsMigration = readMigration('0095_context_records.sql');
const assessmentLayerMigration = readMigration('0102_assessment_layer.sql');

function readMigration(name: string): string {
  return readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
}

function seedSchema(sqlite: BetterSqliteDb): void {
  sqlite.exec(livingContextMigration);
  sqlite.exec(contextRecordsMigration);
  sqlite.exec(assessmentLayerMigration);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dev_container_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      candidate_id TEXT,
      challenge_id TEXT,
      pipeline_id TEXT,
      meeting_id TEXT,
      meeting_room_id TEXT,
      owner_id TEXT,
      access_scope TEXT NOT NULL DEFAULT 'candidate',
      status TEXT NOT NULL,
      instance_type TEXT NOT NULL,
      ttl_seconds INTEGER NOT NULL,
      ttl_source TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      warned_at TEXT,
      url TEXT,
      repo_git_url TEXT,
      challenge_branch TEXT,
      base_commit_sha TEXT,
      started_at TEXT,
      stopped_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function buildCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

async function authHeader(candidateId: string): Promise<string> {
  const token = await signJwt({ sub: candidateId, pid: 'pipe_1' }, 'test-secret');
  return `Bearer ${token}`;
}

async function sha256ContentHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}

interface BridgeSourceRef {
  sourceRefType: string;
  sourceRefId: string;
  evidenceRole: string;
  locator: Record<string, unknown>;
  exactText: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}

async function sourceRef(input: {
  sourceRefType: string;
  sourceRefId: string;
  evidenceRole: string;
  locator: Record<string, unknown>;
  exactText: string;
}): Promise<BridgeSourceRef> {
  return {
    ...input,
    contentHash: await sha256ContentHash(input.exactText),
    metadata: { source: 'agent_bridge_workspace_finalize' },
  };
}

interface BridgeCall {
  sessionId: string;
  url: string;
  body: Record<string, unknown>;
}

interface FakeFinalizeNamespace extends DurableObjectNamespace {
  calls: BridgeCall[];
}

function fakeFinalizeNamespace(responseBody: unknown, status = 200): FakeFinalizeNamespace {
  const calls: BridgeCall[] = [];

  return {
    idFromName: (name: string) => ({
      toString: () => name,
      name,
      equals: () => false,
    }) as unknown as DurableObjectId,
    idFromString: (value: string) => ({
      toString: () => value,
      name: value,
      equals: () => false,
    }) as unknown as DurableObjectId,
    newUniqueId: () => ({
      toString: () => 'unique',
      name: 'unique',
      equals: () => false,
    }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => {
      const sessionId = id.toString();
      return {
        id,
        name: sessionId,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const body = await request.json().catch(() => ({})) as Record<string, unknown>;
          calls.push({ sessionId, url: request.url, body });
          return new Response(JSON.stringify(responseBody), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      } as unknown as DurableObjectStub;
    },
    jurisdiction: () => ({} as unknown as DurableObjectNamespace),
    calls,
  } as unknown as FakeFinalizeNamespace;
}

describe('POST /rpc/dev-container/:sessionId/assessment/finalize', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    seedSchema(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  async function seedFinalizeScenario(options: {
    includeVerificationEvidence?: boolean;
    includeTerminalEvidence?: boolean;
  } = {}): Promise<{
    candidateId: string;
    devContainerSessionId: string;
    assessmentSessionId: string;
    baseCommitSha: string;
    commitSha: string;
    repositoryUrl: string;
    devContainerNamespace: FakeFinalizeNamespace;
    env: Env;
  }> {
    const candidateId = 'cand_finalize_workspace_minimal';
    const devContainerSessionId = 'dev-session-finalize-minimal';
    const assessmentSessionId = 'assessment-session-finalize-minimal';
    const interviewId = 'interview-finalize-minimal';
    const baseCommitSha = 'c'.repeat(40);
    const commitSha = 'd'.repeat(40);
    const now = '2026-06-30T18:00:00.000Z';
    const repositoryUrl = 'https://github.com/pipe/source-backed-worker';
    const challengeExactText = [
      `Repo: ${repositoryUrl}`,
      `Base commit: ${baseCommitSha}`,
      'Task: Fix the source-backed workspace finalizer verification path.',
      'Success criteria:',
      '- Persist commit evidence through the assessment evidence spine.',
      '- Capture verification output or an explicit missing-test gap.',
      'Expected evidence:',
      '- git commit SHA on a pipe-assessment branch',
      '- code diff for the finalizer path',
      '- test output or verification note',
      'Verification command: npm test -- finalize',
    ].join('\n');
    const commitExactText = `commit ${commitSha}\nAuthor: Candidate\n\nFix workspace finalizer verification`;
    const diffExactText = [
      'diff --git a/src/finalize.ts b/src/finalize.ts',
      `index ${baseCommitSha.slice(0, 7)}..${commitSha.slice(0, 7)} 100644`,
      '--- a/src/finalize.ts',
      '+++ b/src/finalize.ts',
      '@@ -1,3 +1,4 @@',
      '+export const verification = "source-backed";',
    ].join('\n');
    const testRunExactText = 'npm test -- finalize\nPASS src/finalize.test.ts';
    const terminalExactText = [
      '$ git status --short',
      ' M src/finalize.ts',
      '$ npm test -- finalize',
      'PASS src/finalize.test.ts',
    ].join('\n');

    sqlite.prepare(
      `INSERT INTO scheduled_interviews (id, candidate_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(interviewId, candidateId, now, now);
    sqlite.prepare(
      `INSERT INTO assessment_sessions (
         id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
         created_by, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'DEV_CONTAINER_REPO_TASK', 'IN_PROGRESS', ?, ?, ?, '{}', ?, ?)`,
    ).run(
      assessmentSessionId,
      `assessment-session:finalize-minimal:${interviewId}`,
      interviewId,
      candidateId,
      devContainerSessionId,
      'workspace-router',
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_evidence_events (
         id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
         narrative, payload_json, occurred_at, created_at
       ) VALUES (?, ?, ?, 1, 'dev_container_event', 'system', NULL, ?, ?, ?, ?)`,
    ).run(
      'assessment-event-finalize-minimal-challenge',
      `assessment-event:finalize-minimal-challenge:${interviewId}`,
      assessmentSessionId,
      'Assigned source-backed workspace task.',
      JSON.stringify({ repositoryUrl, baseCommitSha }),
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_event_source_refs (
         id, event_id, source_ref_type, source_ref_id, evidence_role,
         locator_json, exact_text, content_hash, metadata_json, created_at
       ) VALUES (?, ?, 'open_source_challenge_packet', ?, 'assigned_challenge', ?, ?, ?, '{}', ?)`,
    ).run(
      'assessment-source-finalize-minimal-challenge',
      'assessment-event-finalize-minimal-challenge',
      `challenge:${interviewId}`,
      JSON.stringify({ repositoryUrl, baseCommitSha }),
      challengeExactText,
      await sha256ContentHash(challengeExactText),
      now,
    );
    sqlite.prepare(
      `INSERT INTO dev_container_sessions (
         id, session_id, candidate_id, challenge_id, pipeline_id, access_scope,
         status, instance_type, ttl_seconds, ttl_source, expires_at, warned_at,
         url, repo_git_url, challenge_branch, base_commit_sha, started_at, stopped_at,
         error_message, created_at, updated_at
       ) VALUES (?, ?, ?, NULL, 'pipe_1', 'candidate', 'READY', 'standard-1',
         3600, 'GLOBAL', ?, NULL, ?, ?, 'pipe-assessment/finalizer', ?, ?, NULL, NULL, ?, ?)`,
    ).run(
      'dev-container-row-finalize-minimal',
      devContainerSessionId,
      candidateId,
      '2026-06-30T19:00:00.000Z',
      `https://app-dev.hire-pipe.com/rpc/dev-container/${devContainerSessionId}/proxy/`,
      repositoryUrl,
      baseCommitSha,
      now,
      now,
      now,
    );

    const sourceRefs: BridgeSourceRef[] = [
      await sourceRef({
        sourceRefType: 'git_commit',
        sourceRefId: commitSha,
        evidenceRole: 'submitted_commit',
        locator: { repositoryUrl, commitSha },
        exactText: commitExactText,
      }),
      await sourceRef({
        sourceRefType: 'code_diff',
        sourceRefId: `${baseCommitSha}..${commitSha}`,
        evidenceRole: 'submitted_diff',
        locator: { repositoryUrl, baseCommitSha, commitSha },
        exactText: diffExactText,
      }),
    ];
    if (options.includeVerificationEvidence !== false) {
      sourceRefs.push(
        await sourceRef({
          sourceRefType: 'test_run',
          sourceRefId: `${commitSha}:test-run`,
          evidenceRole: 'verification_test_output',
          locator: { repositoryUrl, baseCommitSha, commitSha, command: 'npm test -- finalize' },
          exactText: testRunExactText,
        }),
      );
    }
    if (options.includeTerminalEvidence !== false) {
      sourceRefs.push(
        await sourceRef({
          sourceRefType: 'terminal_command',
          sourceRefId: `${commitSha}:terminal-finalize`,
          evidenceRole: 'workspace_terminal_command',
          locator: { repositoryUrl, baseCommitSha, commitSha, command: 'npm test -- finalize' },
          exactText: terminalExactText,
        }),
      );
    }

    const bridgeBody = {
      ok: true,
      submitted: false,
      submissionPayload: {
        narrative: 'Candidate finalized the source-backed workspace fix.',
        repositoryUrl,
        forkRepositoryUrl: null,
        branchName: 'pipe-assessment/finalizer',
        baseCommitSha,
        commitSha,
        commitUrl: `${repositoryUrl}/commit/${commitSha}`,
        upstreamPullRequestUrl: null,
        upstreamPrConsent: false,
        changedFiles: [{ path: 'src/finalize.ts', status: 'modified', additions: 1, deletions: 0 }],
        occurredAt: now,
        sourceRefs,
      },
    };
    const devContainerNamespace = fakeFinalizeNamespace(bridgeBody);
    const env = {
      SESSION_TOKEN_SECRET: 'test-secret',
      DB: createMockD1(sqlite),
      DEV_CONTAINER: devContainerNamespace,
    } as unknown as Env;

    return {
      candidateId,
      devContainerSessionId,
      assessmentSessionId,
      baseCommitSha,
      commitSha,
      repositoryUrl,
      devContainerNamespace,
      env,
    };
  }

  it('rejects bridge-captured commits that omit verification output or an explicit gap', async () => {
    const scenario = await seedFinalizeScenario({ includeVerificationEvidence: false });

    const response = await rpcAuth.request(
      `/dev-container/${scenario.devContainerSessionId}/assessment/finalize`,
      {
        method: 'POST',
        headers: {
          Authorization: await authHeader(scenario.candidateId),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          narrative: 'Finish my workspace assessment.',
          testCommand: 'npm test -- finalize',
          verificationNotes: 'Focused finalizer test passed in the workspace.',
        }),
      },
      scenario.env,
      buildCtx(),
    );

    expect(response.status).toBe(502);
    const body = await response.json() as { error?: { message?: string } };
    expect(body.error?.message).toContain('test_run or verification_gap');

    const commitRows = sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE session_id = ?
          AND kind = 'commit_submission'`,
    ).get(scenario.assessmentSessionId) as { count: number };
    expect(commitRows.count).toBe(0);
  });

  it('rejects bridge-captured commits that omit terminal process telemetry', async () => {
    const scenario = await seedFinalizeScenario({ includeTerminalEvidence: false });

    const response = await rpcAuth.request(
      `/dev-container/${scenario.devContainerSessionId}/assessment/finalize`,
      {
        method: 'POST',
        headers: {
          Authorization: await authHeader(scenario.candidateId),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          narrative: 'Finish my workspace assessment.',
          testCommand: 'npm test -- finalize',
          verificationNotes: 'Focused finalizer test passed in the workspace.',
        }),
      },
      scenario.env,
      buildCtx(),
    );

    expect(response.status).toBe(502);
    const body = await response.json() as { error?: { message?: string } };
    expect(body.error?.message).toContain('terminal_command');

    const commitRows = sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE session_id = ?
          AND kind = 'commit_submission'`,
    ).get(scenario.assessmentSessionId) as { count: number };
    expect(commitRows.count).toBe(0);
  });

  it('persists bridge-captured commit evidence without leaking internal assessment ids', async () => {
    const candidateId = 'cand_finalize_workspace';
    const devContainerSessionId = 'dev-session-finalize';
    const assessmentSessionId = 'assessment-session-finalize';
    const interviewId = 'interview-finalize';
    const baseCommitSha = 'a'.repeat(40);
    const commitSha = 'b'.repeat(40);
    const now = '2026-06-30T16:00:00.000Z';
    const repositoryUrl = 'https://github.com/pipe/source-backed-worker';
    const challengeExactText = [
      `Repo: ${repositoryUrl}`,
      `Base commit: ${baseCommitSha}`,
      'Task: Fix the source-backed workspace finalizer.',
      'Success criteria:',
      '- Persist commit evidence through the assessment evidence spine.',
      '- Keep internal assessment ids out of candidate responses.',
      'Expected evidence:',
      '- git commit SHA on a pipe-assessment branch',
      '- code diff for the finalizer path',
      '- test output or verification note',
    ].join('\n');
    const commitExactText = `commit ${commitSha}\nAuthor: Candidate\n\nFix workspace finalizer`;
    const diffExactText = [
      `diff --git a/src/finalize.ts b/src/finalize.ts`,
      `index ${baseCommitSha.slice(0, 7)}..${commitSha.slice(0, 7)} 100644`,
      '--- a/src/finalize.ts',
      '+++ b/src/finalize.ts',
      '@@ -1,3 +1,4 @@',
      '+export const finalizer = "source-backed";',
    ].join('\n');
    const fileObservationExactText = JSON.stringify({
      sourceKind: 'code_server_workspace.file_observation',
      observedBy: 'agent_bridge_workspace_finalize',
      editorSurface: 'code-server',
      repositoryUrl,
      path: 'src/finalize.ts',
      action: 'modified',
      baseCommitSha,
      commitSha,
      blobSha: 'f'.repeat(40),
      fileContentHash: await sha256ContentHash('export const finalizer = "source-backed";'),
      observedAt: now,
    }, null, 2);
    const testRunExactText = 'npm test -- finalize\nPASS src/finalize.test.ts';
    const terminalExactText = [
      '$ git status --short',
      ' M src/finalize.ts',
      '$ npm test -- finalize',
      'PASS src/finalize.test.ts',
      '$ git commit -am "Fix workspace finalizer"',
      `[pipe-assessment/finalizer ${commitSha.slice(0, 7)}] Fix workspace finalizer`,
    ].join('\n');

    sqlite.prepare(
      `INSERT INTO scheduled_interviews (id, candidate_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(interviewId, candidateId, now, now);
    sqlite.prepare(
      `INSERT INTO assessment_sessions (
         id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
         created_by, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'DEV_CONTAINER_REPO_TASK', 'IN_PROGRESS', ?, ?, ?, '{}', ?, ?)`,
    ).run(
      assessmentSessionId,
      `assessment-session:finalize:${interviewId}`,
      interviewId,
      candidateId,
      devContainerSessionId,
      'workspace-router',
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_sessions (
         id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
         created_by, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'DEV_CONTAINER_REPO_TASK', 'IN_PROGRESS', ?, ?, ?, '{}', ?, ?)`,
    ).run(
      'assessment-session-newer-unrelated',
      `assessment-session:finalize:newer-unrelated:${interviewId}`,
      'interview-newer-unrelated',
      candidateId,
      'other-dev-container-session',
      'workspace-router',
      '2026-06-30T16:30:00.000Z',
      '2026-06-30T16:30:00.000Z',
    );
    sqlite.prepare(
      `INSERT INTO assessment_evidence_events (
         id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
         narrative, payload_json, occurred_at, created_at
       ) VALUES (?, ?, ?, 1, 'dev_container_event', 'system', NULL, ?, ?, ?, ?)`,
    ).run(
      'assessment-event-finalize-challenge',
      `assessment-event:finalize-challenge:${interviewId}`,
      assessmentSessionId,
      'Assigned source-backed workspace task.',
      JSON.stringify({ repositoryUrl, baseCommitSha }),
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_event_source_refs (
         id, event_id, source_ref_type, source_ref_id, evidence_role,
         locator_json, exact_text, content_hash, metadata_json, created_at
       ) VALUES (?, ?, 'open_source_challenge_packet', ?, 'assigned_challenge', ?, ?, ?, '{}', ?)`,
    ).run(
      'assessment-source-finalize-challenge',
      'assessment-event-finalize-challenge',
      `challenge:${interviewId}`,
      JSON.stringify({ repositoryUrl, baseCommitSha, internalAssessmentSessionId: assessmentSessionId }),
      challengeExactText,
      await sha256ContentHash(challengeExactText),
      now,
    );
    sqlite.prepare(
      `INSERT INTO dev_container_sessions (
         id, session_id, candidate_id, challenge_id, pipeline_id, access_scope,
         status, instance_type, ttl_seconds, ttl_source, expires_at, warned_at,
         url, repo_git_url, challenge_branch, base_commit_sha, started_at, stopped_at,
         error_message, created_at, updated_at
       ) VALUES (?, ?, ?, NULL, 'pipe_1', 'candidate', 'READY', 'standard-1',
         3600, 'GLOBAL', ?, NULL, ?, ?, 'pipe-assessment/finalizer', ?, ?, NULL, NULL, ?, ?)`,
    ).run(
      'dev-container-row-finalize',
      devContainerSessionId,
      candidateId,
      '2026-06-30T17:00:00.000Z',
      `https://app-dev.hire-pipe.com/rpc/dev-container/${devContainerSessionId}/proxy/`,
      repositoryUrl,
      baseCommitSha,
      now,
      now,
      now,
    );

    const bridgeBody = {
      ok: true,
      submitted: false,
      submissionPayload: {
        narrative: 'Candidate finalized the source-backed workspace fix.',
        repositoryUrl,
        forkRepositoryUrl: null,
        branchName: 'pipe-assessment/finalizer',
        baseCommitSha,
        commitSha,
        commitUrl: `${repositoryUrl}/commit/${commitSha}`,
        upstreamPullRequestUrl: null,
        upstreamPrConsent: false,
        changedFiles: [{ path: 'src/finalize.ts', status: 'modified', additions: 1, deletions: 0 }],
        occurredAt: now,
        sourceRefs: [
          await sourceRef({
            sourceRefType: 'git_commit',
            sourceRefId: commitSha,
            evidenceRole: 'submitted_commit',
            locator: { repositoryUrl, commitSha, internalAssessmentSessionId: assessmentSessionId },
            exactText: commitExactText,
          }),
          await sourceRef({
            sourceRefType: 'code_diff',
            sourceRefId: `${baseCommitSha}..${commitSha}`,
            evidenceRole: 'submitted_diff',
            locator: { repositoryUrl, baseCommitSha, commitSha, internalAssessmentSessionId: assessmentSessionId },
            exactText: diffExactText,
          }),
          await sourceRef({
            sourceRefType: 'test_run',
            sourceRefId: `${commitSha}:test-run`,
            evidenceRole: 'verification_test_output',
            locator: {
              repositoryUrl,
              baseCommitSha,
              commitSha,
              command: 'npm test -- finalize',
              internalAssessmentSessionId: assessmentSessionId,
            },
            exactText: testRunExactText,
          }),
          await sourceRef({
            sourceRefType: 'terminal_command',
            sourceRefId: `${commitSha}:terminal-finalize`,
            evidenceRole: 'workspace_terminal_command',
            locator: {
              repositoryUrl,
              baseCommitSha,
              commitSha,
              command: 'npm test -- finalize && git commit -am "Fix workspace finalizer"',
              internalAssessmentSessionId: assessmentSessionId,
            },
            exactText: terminalExactText,
          }),
          await sourceRef({
            sourceRefType: 'code_server_file_observation',
            sourceRefId: `${commitSha}:file-observation:src_finalize.ts`,
            evidenceRole: 'workspace_file_observation',
            locator: { repositoryUrl, baseCommitSha, commitSha, path: 'src/finalize.ts' },
            exactText: fileObservationExactText,
          }),
        ],
      },
    };
    const devContainerNamespace = fakeFinalizeNamespace(bridgeBody);
    const env = {
      SESSION_TOKEN_SECRET: 'test-secret',
      DB: createMockD1(sqlite),
      DEV_CONTAINER: devContainerNamespace,
    } as unknown as Env;

    const response = await rpcAuth.request(
      `/dev-container/${devContainerSessionId}/assessment/finalize`,
      {
        method: 'POST',
        headers: {
          Authorization: await authHeader(candidateId),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          narrative: 'Finish my workspace assessment.',
          testCommand: 'npm test -- finalize',
          verificationNotes: 'Focused finalizer test passed in the workspace.',
        }),
      },
      env,
      buildCtx(),
    );

    expect(response.status).toBe(201);
    const body = await response.json() as {
      submission: { accepted: boolean; repositoryUrl: string; branchName: string; commitSha: string };
      progress: {
        mode: string;
        state: string;
        stage: string;
        nextAction: string;
        hasChallengePacket: boolean;
        hasCommitSubmission: boolean;
        challenge: { locator: Record<string, unknown> } | null;
        commit: { commitSha: string; branchName: string; eventId?: string };
      };
    };
    expect(body.submission).toMatchObject({
      accepted: true,
      repositoryUrl,
      branchName: 'pipe-assessment/finalizer',
      commitSha,
    });
    expect(body.progress).toMatchObject({
      mode: 'DEV_CONTAINER_REPO_TASK',
      state: 'FINAL_SUBMITTED',
      stage: 'READY_FOR_EVALUATION',
      nextAction: 'START_EVALUATION',
      hasChallengePacket: true,
      hasCommitSubmission: true,
    });
    expect(body.progress.challenge?.locator).toEqual({ repositoryUrl, baseCommitSha });
    expect(body.progress.commit).toMatchObject({
      commitSha,
      branchName: 'pipe-assessment/finalizer',
    });
    expect(body.progress.commit.eventId).toBeUndefined();

    expect(devContainerNamespace.calls).toHaveLength(1);
    expect(devContainerNamespace.calls[0]?.url).toContain('/assessment/finalize');
    expect(devContainerNamespace.calls[0]?.body).toMatchObject({
      submitToPipe: false,
      repositoryUrl,
      baseCommitSha,
      narrative: 'Finish my workspace assessment.',
      testCommand: 'npm test -- finalize',
      verificationNotes: 'Focused finalizer test passed in the workspace.',
    });

    const commitRow = sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evidence_events
        WHERE session_id = ?
          AND kind = 'commit_submission'`,
    ).get(assessmentSessionId) as { count: number };
    expect(commitRow.count).toBe(1);
    const fileObservationRow = sqlite.prepare(
      `SELECT exact_text
         FROM assessment_event_source_refs
        WHERE source_ref_type = 'code_server_file_observation'
        LIMIT 1`,
    ).get() as { exact_text: string } | undefined;
    expect(fileObservationRow?.exact_text).toContain('code_server_workspace.file_observation');
    expect(fileObservationRow?.exact_text).toContain('src/finalize.ts');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(assessmentSessionId);
    expect(serialized).not.toContain(`assessment-session:finalize:${interviewId}`);
    expect(serialized).not.toContain('assessment-event-finalize-challenge');
    expect(serialized).not.toContain('internalAssessmentSessionId');
  });
});
