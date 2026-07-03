import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import {
  evaluateRepoTaskAssessmentSession,
} from '../repoTaskAssessmentEvaluator';
import {
  RepoTaskInterviewSessionStore,
  type AssessmentEvidenceSourceRefInput,
} from '../repoTaskInterviewSession';

const livingContextMigrationSql = readFileSync(
  new URL('../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigrationSql = readFileSync(
  new URL('../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const assessmentLayerMigrationSql = readFileSync(
  new URL('../../../migrations/0102_assessment_layer.sql', import.meta.url),
  'utf8',
);
const assessmentCompatMigrationSql = readFileSync(
  new URL('../../../migrations/0103_assessment_layer_repo_task_compat.sql', import.meta.url),
  'utf8',
);

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sourceRef(input: {
  type: string;
  id: string;
  exactText: string;
  evidenceRole?: string;
  locator?: Record<string, unknown>;
}): Promise<AssessmentEvidenceSourceRefInput> {
  return {
    sourceRefType: input.type,
    sourceRefId: input.id,
    evidenceRole: input.evidenceRole ?? 'support',
    locator: input.locator ?? { label: input.id },
    exactText: input.exactText,
    contentHash: await sha256Hex(input.exactText),
  };
}

describe('repo task assessment evaluator integration', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;
  let store: RepoTaskInterviewSessionStore;

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
    sqlite.exec(assessmentLayerMigrationSql);
    sqlite.exec(assessmentCompatMigrationSql);
    db = createMockD1(sqlite);
    store = new RepoTaskInterviewSessionStore(db, () => '2026-07-03T00:00:00.000Z');
  });

  afterEach(() => {
    sqlite.close();
  });

  it('evaluates with conservative source-backed fallback when AI output is unparseable', async () => {
    const repositoryUrl = 'https://github.com/mui/base-ui';
    const baseCommitSha = '58dff8444fa56e4444a3a1dd991c76b49cf4ab7e';
    const commitSha = '81c11363a3b6e31b34b3777fd150de7fe462c64f';
    const session = await store.createSession({
      ingestionKey: 'assessment-session:parse-fallback',
      interviewId: 'scheduled-interview-parse-fallback',
      candidateId: 'candidate-parse-fallback',
      workspaceId: 'workspace-1',
      mode: 'OPEN_SOURCE_BUG_FIX',
      createdBy: 'test',
    });

    await store.recordEvent({
      sessionId: session.id,
      ingestionKey: 'assessment-event:challenge-packet',
      kind: 'recruiter_note',
      actorType: 'recruiter',
      actorId: 'recruiter-1',
      narrative: 'Recruiter assigned a complete source-backed open-source challenge packet.',
      payload: { repositoryUrl, baseCommitSha },
      sourceRefs: [await sourceRef({
        type: 'open_source_challenge_packet',
        id: 'challenge-packet-1',
        evidenceRole: 'assigned_challenge',
        locator: {
          repositoryUrl,
          baseCommitSha,
          challengeTitle: 'Fix Base UI popover impatient click handling',
        },
        exactText: [
          `Repo: ${repositoryUrl}`,
          `Base commit: ${baseCommitSha}`,
          'Task: Fix Base UI popover impatient click handling',
          'Success criteria:',
          '- Preserve existing popover behavior while preventing premature close.',
          '- Add a targeted regression test for impatient clicks.',
          'Expected evidence:',
          '- git_commit',
          '- code_diff',
          '- test_run',
        ].join('\n'),
      })],
    });

    await store.submitCommit({
      sessionId: session.id,
      ingestionKey: 'assessment-event:commit-submission',
      actorType: 'candidate',
      actorId: 'candidate-parse-fallback',
      narrative: 'Candidate submitted a focused popover fix commit.',
      repositoryUrl,
      branchName: 'pipe-assessment/popover-click-fix',
      baseCommitSha,
      commitSha,
      commitUrl: `${repositoryUrl}/commit/${commitSha}`,
      changedFiles: [
        {
          path: 'packages/react/src/popover/root/usePopoverRoot.ts',
          status: 'modified',
          additions: 4,
          deletions: 1,
        },
      ],
      sourceRefs: [
        await sourceRef({
          type: 'git_commit',
          id: commitSha,
          exactText: `commit ${commitSha}\nFix popover impatient click handling`,
        }),
        await sourceRef({
          type: 'code_diff',
          id: `${baseCommitSha}..${commitSha}`,
          locator: { baseCommitSha, commitSha },
          exactText: [
            'diff --git a/packages/react/src/popover/root/usePopoverRoot.ts b/packages/react/src/popover/root/usePopoverRoot.ts',
            '+const PATIENT_CLICK_THRESHOLD = 300;',
          ].join('\n'),
        }),
        await sourceRef({
          type: 'test_run',
          id: 'verification-1',
          evidenceRole: 'verification_test_output',
          exactText: '$ git diff --check HEAD~1 HEAD\nexitCode: 0',
        }),
      ],
    });

    const aiRun = vi.fn(async () => ({
      response: 'I reviewed the diff and it seems reasonable, but I cannot emit the requested JSON structure.',
    }));
    const requestText = 'Recruiter requested a source-backed assessment evaluation.';
    const requestSourceRef = await sourceRef({
      type: 'assessment_evaluation_request',
      id: 'assessment-event:evaluation-request',
      exactText: requestText,
    });
    const requestEvent = await store.recordEvent({
      sessionId: session.id,
      ingestionKey: 'assessment-event:evaluation-request',
      kind: 'system_diagnostic',
      actorType: 'system',
      actorId: 'repo-task-assessment-evaluator',
      narrative: requestText,
      payload: { action: 'evaluate_repo_task_assessment' },
      sourceRefs: [requestSourceRef],
    });

    const result = await evaluateRepoTaskAssessmentSession({
      db,
      store,
      env: {
        AI: { run: aiRun } as unknown as Ai,
        CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
      },
      sessionId: session.id,
      scheduledInterviewId: 'scheduled-interview-parse-fallback',
      requestedBy: 'recruiter-1',
      requestedAt: '2026-07-03T00:01:00.000Z',
      requestEventId: requestEvent.id,
      requestSourceRef,
    });

    expect(result.kind).toBe('evaluated');
    expect(aiRun).toHaveBeenCalledTimes(1);

    const sessionRow = sqlite.prepare(
      `SELECT state FROM assessment_sessions WHERE id = ?`,
    ).get(session.id) as { state: string };
    expect(sessionRow.state).toBe('EVALUATED');

    const report = sqlite.prepare(
      `SELECT id, status, output_json
         FROM assessment_evaluation_reports
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    ).get(session.id) as { id: string; status: string; output_json: string };
    expect(report.status).toBe('EVALUATED');
    expect(JSON.parse(report.output_json)).toMatchObject({
      fallback: 'deterministic_source_evidence',
      fallbackReasonCode: 'MODEL_RESPONSE_UNPARSEABLE',
      recommendation: 'mixed_evidence_human_review',
    });

    const claims = sqlite.prepare(
      `SELECT polarity, dimension
         FROM assessment_evaluation_claims
        WHERE report_id = ?
        ORDER BY dimension`,
    ).all(report.id) as Array<{ polarity: string; dimension: string }>;
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ polarity: 'positive', dimension: 'source_provenance' }),
      expect.objectContaining({ polarity: 'positive', dimension: 'implementation_evidence' }),
      expect.objectContaining({ polarity: 'positive', dimension: 'verification' }),
    ]));

    const diagnostics = sqlite.prepare(
      `SELECT code, severity
         FROM assessment_diagnostics
        WHERE report_id = ?
        ORDER BY code`,
    ).all(report.id) as Array<{ code: string; severity: string }>;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MODEL_RESPONSE_UNPARSEABLE', severity: 'warning' }),
      expect.objectContaining({ code: 'MODEL_CLAIMS_UNUSABLE', severity: 'warning' }),
      expect.objectContaining({ code: 'HUMAN_CORRECTNESS_REVIEW_REQUIRED', severity: 'warning' }),
    ]));
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'AI_DEVELOPER_UNAVAILABLE')).toBe(false);
  });
});
