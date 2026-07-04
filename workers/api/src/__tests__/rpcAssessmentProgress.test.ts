/**
 * Candidate RPC repo-task assessment tests.
 *
 * These drive the real /rpc candidate app against a SQLite-backed D1 shim so
 * candidate-facing progress/submission routes stay wired to the durable
 * assessment evidence spine without leaking internal assessment ids.
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
  `);
}

function buildCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

async function authHeader(candidateId = 'cand_rpc_assessment'): Promise<string> {
  const token = await signJwt({ sub: candidateId, pid: null }, 'test-secret');
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

async function sourceRef(
  input: {
    sourceRefType: string;
    sourceRefId: string;
    evidenceRole?: string;
    locator?: Record<string, unknown>;
    exactText: string;
  },
): Promise<{
  sourceRefType: string;
  sourceRefId: string;
  evidenceRole?: string;
  locator?: Record<string, unknown>;
  exactText: string;
  contentHash: string;
}> {
  return {
    ...input,
    contentHash: await sha256ContentHash(input.exactText),
  };
}

describe('candidate assessment RPC progress and commit submission', () => {
  let sqlite: BetterSqliteDb;
  let env: Env;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    seedSchema(sqlite);
    env = {
      SESSION_TOKEN_SECRET: 'test-secret',
      DB: createMockD1(sqlite),
    } as unknown as Env;
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns null progress when the candidate has no repo-task assessment session', async () => {
    const response = await rpcAuth.request(
      '/assessment/progress',
      { method: 'GET', headers: { Authorization: await authHeader('cand_without_session') } },
      env,
      buildCtx(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ progress: null });
  });

  it('accepts source-backed candidate commits and hides internal assessment ids from responses', async () => {
    const candidateId = 'cand_rpc_assessment';
    const sessionId = 'assessment-session-rpc-candidate';
    const interviewId = 'scheduled-interview-rpc-candidate';
    const baseCommitSha = 'a'.repeat(40);
    const commitSha = 'b'.repeat(40);
    const now = '2026-06-30T12:00:00.000Z';
    const challengeExactText = [
      'Repo: https://github.com/pipe/source-backed-worker',
      `Base commit: ${baseCommitSha}`,
      'Task: Fix the durable retry path.',
      'Success criteria:',
      '- Retry behavior is deterministic and covered by a focused test.',
      'Expected evidence:',
      '- git commit SHA on a pipe-assessment branch',
      '- code diff for the retry path',
      '- test output or verification note',
    ].join('\n');

    sqlite.prepare(
      `INSERT INTO scheduled_interviews (id, candidate_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(interviewId, candidateId, now, now);
    sqlite.prepare(
      `INSERT INTO assessment_sessions (
         id, ingestion_key, interview_id, mode, state, candidate_id, workspace_id,
         created_by, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'OPEN_SOURCE_BUG_FIX', 'IN_PROGRESS', ?, ?, ?, '{}', ?, ?)`,
    ).run(
      sessionId,
      `assessment-session:rpc:${interviewId}`,
      interviewId,
      candidateId,
      'workspace-rpc',
      'owner-rpc',
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_evidence_events (
         id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
         narrative, payload_json, occurred_at, created_at
       ) VALUES (?, ?, ?, 1, 'dev_container_event', 'system', NULL, ?, ?, ?, ?)`,
    ).run(
      'assessment-event-rpc-challenge',
      `assessment-event:rpc-challenge:${interviewId}`,
      sessionId,
      'Assigned source-backed repo task.',
      JSON.stringify({ repositoryUrl: 'https://github.com/pipe/source-backed-worker', baseCommitSha }),
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_event_source_refs (
         id, event_id, source_ref_type, source_ref_id, evidence_role,
         locator_json, exact_text, content_hash, metadata_json, created_at
       ) VALUES (?, ?, 'open_source_challenge_packet', ?, 'assigned_challenge', ?, ?, ?, '{}', ?)`,
    ).run(
      'assessment-source-rpc-challenge',
      'assessment-event-rpc-challenge',
      `challenge:${interviewId}`,
      JSON.stringify({
        repositoryUrl: 'https://github.com/pipe/source-backed-worker',
        baseCommitSha,
        internalAssessmentSessionId: sessionId,
      }),
      challengeExactText,
      await sha256ContentHash(challengeExactText),
      now,
    );

    const commitExactText = `commit ${commitSha}\nAuthor: Candidate\n\nFix durable retry path`;
    const diffExactText = [
      'diff --git a/src/retry.ts b/src/retry.ts',
      'index 1111111..2222222 100644',
      '--- a/src/retry.ts',
      '+++ b/src/retry.ts',
      '@@ -1,3 +1,4 @@',
      '+export const retryBackoff = "source-backed";',
    ].join('\n');

    const response = await rpcAuth.request(
      '/assessment/commit-submission',
      {
        method: 'POST',
        headers: {
          Authorization: await authHeader(candidateId),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          narrative: 'Candidate submitted a source-backed durable retry fix.',
          repositoryUrl: 'https://github.com/pipe/source-backed-worker',
          forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
          branchName: 'pipe-assessment/durable-retry',
          baseCommitSha,
          commitSha,
          commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
          upstreamPrConsent: false,
          changedFiles: [{ path: 'src/retry.ts', status: 'modified', additions: 1, deletions: 0 }],
          occurredAt: now,
          sourceRefs: [
            await sourceRef({
              sourceRefType: 'git_commit',
              sourceRefId: commitSha,
              evidenceRole: 'submitted_commit',
              locator: {
                repositoryUrl: 'https://github.com/candidate/source-backed-worker',
                commitSha,
                internalAssessmentSessionId: sessionId,
              },
              exactText: commitExactText,
            }),
            await sourceRef({
              sourceRefType: 'code_diff',
              sourceRefId: `${baseCommitSha}..${commitSha}`,
              evidenceRole: 'submitted_diff',
              locator: {
                repositoryUrl: 'https://github.com/candidate/source-backed-worker',
                baseCommitSha,
                commitSha,
                internalAssessmentSessionId: sessionId,
              },
              exactText: diffExactText,
            }),
          ],
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
        challenge: {
          locator: Record<string, unknown>;
          summary: {
            repositoryUrl: string | null;
            baseCommitSha: string | null;
            task: string | null;
            successCriteria: string[];
            expectedEvidence: string[];
            verificationCommand: string | null;
          };
        } | null;
        latestEvent: { kind: string; sequence: number };
        commit: { eventId?: string; commitSha: string; branchName: string };
      };
    };
    expect(body.submission).toMatchObject({
      accepted: true,
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      branchName: 'pipe-assessment/durable-retry',
      commitSha,
    });
    expect(body.progress).toMatchObject({
      mode: 'OPEN_SOURCE_BUG_FIX',
      state: 'FINAL_SUBMITTED',
      stage: 'READY_FOR_EVALUATION',
      nextAction: 'START_EVALUATION',
      hasChallengePacket: true,
      hasCommitSubmission: true,
      latestEvent: { kind: 'commit_submission', sequence: 2 },
    });
    expect(body.progress.challenge?.locator).toEqual({
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      baseCommitSha,
    });
    expect(body.progress.challenge?.summary).toMatchObject({
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      baseCommitSha,
      task: 'Fix the durable retry path.',
      successCriteria: ['Retry behavior is deterministic and covered by a focused test.'],
      expectedEvidence: [
        'git commit SHA on a pipe-assessment branch',
        'code diff for the retry path',
        'test output or verification note',
      ],
      verificationCommand: null,
    });
    expect(body.progress.commit).toMatchObject({
      commitSha,
      branchName: 'pipe-assessment/durable-retry',
    });
    expect(body.progress.commit.eventId).toBeUndefined();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(sessionId);
    expect(serialized).not.toContain(`assessment-session:rpc:${interviewId}`);
    expect(serialized).not.toContain('assessment-event-rpc-challenge');

    const progressResponse = await rpcAuth.request(
      '/assessment/progress',
      { method: 'GET', headers: { Authorization: await authHeader(candidateId) } },
      env,
      buildCtx(),
    );
    expect(progressResponse.status).toBe(200);
    const progressBody = await progressResponse.json() as { progress: unknown };
    expect(JSON.stringify(progressBody)).not.toContain(sessionId);
    expect(progressBody.progress).toMatchObject({
      stage: 'READY_FOR_EVALUATION',
      hasCommitSubmission: true,
    });
  });
});
