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

  it('redacts hidden review packet provenance from candidate progress', async () => {
    const candidateId = 'cand_review_packet_progress';
    const sessionId = 'assessment-session-hidden-review-packet';
    const interviewId = 'scheduled-interview-hidden-review-packet';
    const eventId = 'assessment-event-hidden-review-packet';
    const sourceRefId = 'review-packet-secret-973';
    const reportId = 'assessment-report-hidden-review-packet';
    const claimId = 'assessment-claim-hidden-review-packet';
    const diagnosticId = 'assessment-diagnostic-hidden-review-packet';
    const baseCommitSha = 'a'.repeat(40);
    const headCommitSha = 'b'.repeat(40);
    const now = '2026-07-07T12:00:00.000Z';
    const pullRequestUrl = 'https://github.com/mui/base-ui/pull/973';
    const challengeExactText = [
      'Repo: https://github.com/mui/base-ui',
      `Base commit: ${baseCommitSha}`,
      'Task: Fix the popup trigger regression.',
      'Success criteria:',
      '- Candidate explains event timing risk.',
      'Expected evidence:',
      '- inline review comment',
      `Pull request: ${pullRequestUrl}`,
      `Head commit SHA: ${headCommitSha}`,
      'Source-backed demands:',
      '- Hidden solution evidence says exact bug is pointerdown ordering.',
      'Solution evidence:',
      '- Apply patch in popup-trigger.tsx before focus restoration.',
      `Internal source ref: ${sourceRefId}`,
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
      `assessment-session:hidden-review:${interviewId}`,
      interviewId,
      candidateId,
      'workspace-hidden-review',
      'owner-hidden-review',
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_evidence_events (
         id, ingestion_key, session_id, sequence, kind, actor_type, actor_id,
         narrative, payload_json, occurred_at, created_at
       ) VALUES (?, ?, ?, 1, 'match_decision', 'system', NULL, ?, ?, ?, ?)`,
    ).run(
      eventId,
      `assessment-event:hidden-review:${interviewId}`,
      sessionId,
      'Assigned replayed source-backed review packet.',
      JSON.stringify({ repositoryUrl: 'https://github.com/mui/base-ui', baseCommitSha }),
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_event_source_refs (
         id, event_id, source_ref_type, source_ref_id, evidence_role,
         locator_json, exact_text, content_hash, metadata_json, created_at
       ) VALUES (?, ?, 'review_challenge_packet', ?, 'assigned_challenge', ?, ?, ?, '{}', ?)`,
    ).run(
      'assessment-source-hidden-review-packet',
      eventId,
      sourceRefId,
      JSON.stringify({
        repositoryUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        pullRequestUrl,
        baseCommitSha,
        headCommitSha,
        sourceRefId,
        assessmentSessionId: sessionId,
      }),
      challengeExactText,
      await sha256ContentHash(challengeExactText),
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_evaluation_reports (
         id, ingestion_key, session_id, status, summary, output_json,
         diagnostics_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'EVALUATED', ?, ?, '[]', ?, ?)`,
    ).run(
      reportId,
      `assessment-report:hidden-review:${interviewId}`,
      sessionId,
      'Human review recommended after source-backed replay packet.',
      JSON.stringify({
        recommendation: 'mixed_evidence_human_review',
        reviewPacket: {
          schemaVersion: 'repo-task-review-packet-v1',
          challenge: {
            focus: 'Fix popup trigger regression',
            repositoryUrl: 'https://github.com/mui/base-ui',
            baseCommitSha,
            pullRequestUrl,
            assignmentTrust: {
              state: 'source_backed_challenge',
              label: 'Source-backed challenge',
              detail: 'Derived from a historical review packet.',
              tone: 'neutral',
            },
            contract: {
              schemaVersion: 'challenge-packet-contract-v1',
              isComplete: true,
              missingFields: [],
            },
          },
          submission: null,
          evidence: {
            sourceRefCount: 1,
            sourceRefTypeCounts: { review_challenge_packet: 1 },
            readiness: {
              status: 'READY_FOR_EVALUATION',
              label: 'Ready',
              detail: 'Source-backed packet is ready for candidate work.',
              isReadyForEvaluation: true,
              isUsableHiringSignal: true,
              missingRequiredCount: 0,
            },
          },
          evaluation: {
            recommendation: 'mixed_evidence_human_review',
            claimIds: [claimId],
            diagnosticCodes: ['hidden_review_packet_warning'],
          },
        },
      }),
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_evaluation_claims (
         id, report_id, polarity, dimension, narrative, confidence, created_at
       ) VALUES (?, ?, 'positive', 'review_reasoning', ?, 0.72, ?)`,
    ).run(
      claimId,
      reportId,
      'Candidate identified a plausible event timing risk.',
      now,
    );
    sqlite.prepare(
      `INSERT INTO assessment_diagnostics (
         id, session_id, report_id, event_id, code, severity, message, provider,
         retryable, details_json, metadata_json, created_at
       ) VALUES (?, ?, ?, NULL, 'hidden_review_packet_warning', 'warning', ?, NULL, 0, '{}', '{}', ?)`,
    ).run(
      diagnosticId,
      sessionId,
      reportId,
      'Review packet requires human validation before a decision.',
      now,
    );

    const response = await rpcAuth.request(
      '/assessment/progress',
      { method: 'GET', headers: { Authorization: await authHeader(candidateId) } },
      env,
      buildCtx(),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      progress: {
        evidenceSnippets: Array<{ exactText: string; sourceRefType: string }>;
        challenge: {
          exactText: string;
          locator: Record<string, unknown>;
          summary: {
            repositoryUrl: string | null;
            githubPrNumber: number | null;
            pullRequestUrl: string | null;
            baseCommitSha: string | null;
            task: string | null;
            successCriteria: string[];
            expectedEvidence: string[];
          };
        } | null;
        evaluation: {
          reviewPacket: {
            challenge: { pullRequestUrl: string | null };
          } | null;
        } | null;
      } | null;
    };

    expect(body.progress?.challenge?.locator).toEqual({
      repositoryUrl: 'https://github.com/mui/base-ui',
      baseCommitSha,
    });
    expect(body.progress?.challenge?.summary).toMatchObject({
      repositoryUrl: 'https://github.com/mui/base-ui',
      githubPrNumber: null,
      pullRequestUrl: null,
      baseCommitSha,
      task: 'Fix the popup trigger regression.',
      successCriteria: ['Candidate explains event timing risk.'],
      expectedEvidence: ['inline review comment'],
    });
    expect(body.progress?.challenge?.exactText).toContain('Repo: https://github.com/mui/base-ui');
    expect(body.progress?.challenge?.exactText).toContain(`Base commit: ${baseCommitSha}`);
    expect(body.progress?.challenge?.exactText).toContain('Task: Fix the popup trigger regression.');
    expect(body.progress?.evaluation?.reviewPacket?.challenge.pullRequestUrl).toBeNull();
    expect(body.progress?.evidenceSnippets).toEqual([
      expect.objectContaining({
        sourceRefType: 'review_challenge_packet',
        exactText: expect.stringContaining('Task: Fix the popup trigger regression.'),
      }),
    ]);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(pullRequestUrl);
    expect(serialized).not.toContain('pull/973');
    expect(serialized).not.toContain(headCommitSha);
    expect(serialized).not.toContain(sourceRefId);
    expect(serialized).not.toContain(sessionId);
    expect(serialized).not.toContain(reportId);
    expect(serialized).not.toContain(claimId);
    expect(serialized).not.toContain(diagnosticId);
    expect(serialized).not.toContain(eventId);
    expect(serialized).not.toContain('Hidden solution evidence');
    expect(serialized).not.toContain('pointerdown ordering');
    expect(serialized).not.toContain('Apply patch');
    expect(serialized).not.toContain('popup-trigger.tsx');
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
    const testRunExactText = 'npm test -- retry\nPASS src/retry.test.ts';

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
            await sourceRef({
              sourceRefType: 'test_run',
              sourceRefId: `${commitSha}:test-run`,
              evidenceRole: 'verification_test_output',
              locator: {
                repositoryUrl: 'https://github.com/candidate/source-backed-worker',
                baseCommitSha,
                commitSha,
                command: 'npm test -- retry',
                internalAssessmentSessionId: sessionId,
              },
              exactText: testRunExactText,
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
