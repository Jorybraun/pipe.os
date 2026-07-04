import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../__tests__/helpers/mockD1';
import {
  evaluateRepoTaskAssessmentSession,
  processStaleRepoTaskAssessmentEvaluations,
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

async function createReadyAssessmentFixture(
  store: RepoTaskInterviewSessionStore,
  suffix: string,
  options: { includeTestEvidence?: boolean } = {},
): Promise<{
  sessionId: string;
  scheduledInterviewId: string;
  requestEventId: string;
  requestSourceRef: AssessmentEvidenceSourceRefInput;
}> {
  const includeTestEvidence = options.includeTestEvidence ?? true;
  const repositoryUrl = 'https://github.com/mui/base-ui';
  const baseCommitSha = '58dff8444fa56e4444a3a1dd991c76b49cf4ab7e';
  const commitSha = (await sha256Hex(`commit-${suffix}`)).slice(0, 40);
  const scheduledInterviewId = `scheduled-interview-${suffix}`;
  const session = await store.createSession({
    ingestionKey: `assessment-session:${suffix}`,
    interviewId: scheduledInterviewId,
    candidateId: `candidate-${suffix}`,
    workspaceId: 'workspace-1',
    mode: 'OPEN_SOURCE_BUG_FIX',
    createdBy: 'test',
  });

  await store.recordEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:${suffix}:challenge-packet`,
    kind: 'recruiter_note',
    actorType: 'recruiter',
    actorId: 'recruiter-1',
    narrative: 'Recruiter assigned a complete source-backed open-source challenge packet.',
    payload: { repositoryUrl, baseCommitSha },
    sourceRefs: [await sourceRef({
      type: 'open_source_challenge_packet',
      id: `challenge-packet-${suffix}`,
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
    ingestionKey: `assessment-event:${suffix}:commit-submission`,
    actorType: 'candidate',
    actorId: `candidate-${suffix}`,
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
      ...(includeTestEvidence
        ? [await sourceRef({
            type: 'test_run',
            id: `${commitSha}:test-run`,
            evidenceRole: 'verification_test_output',
            locator: { repositoryUrl, baseCommitSha, commitSha, command: 'git diff --check HEAD~1 HEAD' },
            exactText: '$ git diff --check HEAD~1 HEAD\nexitCode: 0',
          })]
        : [await sourceRef({
            type: 'verification_gap',
            id: `${commitSha}:test-evidence-missing`,
            evidenceRole: 'missing_test_evidence_note',
            locator: { repositoryUrl, baseCommitSha, commitSha, expectedSourceRefType: 'test_run' },
            exactText: 'No test output was captured for this evaluator fixture.',
            metadata: { missingEvidence: 'test_run' },
          })]),
    ],
  });

  const requestSourceRef = await sourceRef({
    type: 'assessment_evaluation_request',
    id: `assessment-event:${suffix}:evaluation-request`,
    exactText: 'Recruiter requested a source-backed assessment evaluation.',
  });
  const requestEvent = await store.recordEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:${suffix}:evaluation-request`,
    kind: 'recruiter_note',
    actorType: 'recruiter',
    actorId: 'recruiter-1',
    narrative: 'Recruiter requested source-backed assessment evaluation.',
    payload: { action: 'evaluate_repo_task_assessment' },
    sourceRefs: [requestSourceRef],
  });

  return {
    sessionId: session.id,
    scheduledInterviewId,
    requestEventId: requestEvent.id,
    requestSourceRef,
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
          id: `${commitSha}:test-run`,
          evidenceRole: 'verification_test_output',
          locator: { repositoryUrl, baseCommitSha, commitSha, command: 'git diff --check HEAD~1 HEAD' },
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

  it('evaluates with conservative source-backed fallback when the AI call exceeds the Worker time budget', async () => {
    const fixture = await createReadyAssessmentFixture(store, 'timeout');
    const aiRun = vi.fn(() => new Promise(() => {}));

    const result = await evaluateRepoTaskAssessmentSession({
      db,
      store,
      env: {
        AI: { run: aiRun } as unknown as Ai,
        CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
        REPO_TASK_EVALUATOR_AI_TIMEOUT_MS: '1',
      },
      sessionId: fixture.sessionId,
      scheduledInterviewId: fixture.scheduledInterviewId,
      requestedBy: 'recruiter-1',
      requestedAt: '2026-07-03T00:02:00.000Z',
      requestEventId: fixture.requestEventId,
      requestSourceRef: fixture.requestSourceRef,
    });

    expect(result.kind).toBe('evaluated');
    expect(aiRun).toHaveBeenCalledTimes(1);

    const sessionRow = sqlite.prepare(
      `SELECT state FROM assessment_sessions WHERE id = ?`,
    ).get(fixture.sessionId) as { state: string };
    expect(sessionRow.state).toBe('EVALUATED');

    const report = sqlite.prepare(
      `SELECT id, status, output_json
         FROM assessment_evaluation_reports
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    ).get(fixture.sessionId) as { id: string; status: string; output_json: string };
    expect(report.status).toBe('EVALUATED');
    expect(JSON.parse(report.output_json)).toMatchObject({
      fallback: 'deterministic_source_evidence',
      fallbackReasonCode: 'MODEL_RESPONSE_TIMEOUT',
      recommendation: 'mixed_evidence_human_review',
    });

    const diagnostics = sqlite.prepare(
      `SELECT code, severity
         FROM assessment_diagnostics
        WHERE report_id = ?
        ORDER BY code`,
    ).all(report.id) as Array<{ code: string; severity: string }>;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MODEL_RESPONSE_TIMEOUT', severity: 'warning' }),
      expect.objectContaining({ code: 'HUMAN_CORRECTNESS_REVIEW_REQUIRED', severity: 'warning' }),
    ]));
  });

  it('drops unsupported positive test claims when no test_run evidence exists', async () => {
    const fixture = await createReadyAssessmentFixture(store, 'missing-tests', {
      includeTestEvidence: false,
    });
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        summary: 'The candidate changed the popover root hook, but verification evidence is incomplete.',
        recommendation: 'mixed_evidence_human_review',
        claims: [
          {
            id: 'implementation-backed-by-diff',
            polarity: 'positive',
            dimension: 'implementation_correctness',
            narrative: 'The candidate changed the popover root hook in the submitted diff.',
            confidence: 0.72,
            sourceRefKeys: ['code_diff'],
          },
          {
            id: 'tests-look-good',
            polarity: 'positive',
            dimension: 'test_strategy',
            narrative: 'The candidate verified the implementation with tests.',
            confidence: 0.82,
            sourceRefKeys: ['code_diff'],
          },
        ],
        diagnostics: [],
      }),
    }));

    const result = await evaluateRepoTaskAssessmentSession({
      db,
      store,
      env: {
        AI: { run: aiRun } as unknown as Ai,
        CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
      },
      sessionId: fixture.sessionId,
      scheduledInterviewId: fixture.scheduledInterviewId,
      requestedBy: 'recruiter-1',
      requestedAt: '2026-07-03T00:03:00.000Z',
      requestEventId: fixture.requestEventId,
      requestSourceRef: fixture.requestSourceRef,
    });

    expect(result.kind).toBe('evaluated');
    expect(aiRun).toHaveBeenCalledTimes(1);
    const aiInput = aiRun.mock.calls[0]?.[1] as {
      messages?: Array<{ role?: string; content?: string | null }>;
    } | undefined;
    const userPrompt = aiInput?.messages?.find((message) => message.role === 'user')?.content ?? null;
    expect(typeof userPrompt).toBe('string');
    const userPromptPayload = JSON.parse(userPrompt ?? '{}') as {
      evidenceCoverage?: {
        sourceRefTypeCounts?: Record<string, number>;
        expectedForHighConfidence?: Array<{
          label?: string;
          sourceRefTypes?: string[];
          satisfied?: boolean;
          sourceRefKeys?: string[];
          missingImpact?: string;
        }>;
      };
    };
    expect(userPromptPayload.evidenceCoverage?.sourceRefTypeCounts).toMatchObject({
      verification_gap: 1,
    });
    expect(userPromptPayload.evidenceCoverage?.expectedForHighConfidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'test_run',
        sourceRefTypes: ['test_run'],
        satisfied: false,
        sourceRefKeys: [],
        missingImpact: 'Do not make positive test_strategy, verification, or correctness claims without test_run evidence bound to the submitted commit.',
      }),
      expect.objectContaining({
        label: 'verification_gap',
        sourceRefTypes: ['verification_gap'],
        satisfied: true,
        missingImpact: 'Use declared verification gaps to explain missing or partial verification; never treat them as positive test_run evidence.',
      }),
    ]));
    const verificationGapCoverage = userPromptPayload.evidenceCoverage?.expectedForHighConfidence
      ?.find((item) => item.label === 'verification_gap');
    expect(verificationGapCoverage?.sourceRefKeys?.[0]).toContain('verification_gap:');

    const report = sqlite.prepare(
      `SELECT id, status, output_json
         FROM assessment_evaluation_reports
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    ).get(fixture.sessionId) as { id: string; status: string; output_json: string };
    expect(report.status).toBe('EVALUATED');
    const output = JSON.parse(report.output_json) as {
      evidenceCoverage: {
        expectedForHighConfidence: Array<{ label: string; satisfied: boolean }>;
      };
    };
    expect(output.evidenceCoverage.expectedForHighConfidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'test_run', satisfied: false }),
    ]));

    const claims = sqlite.prepare(
      `SELECT polarity, dimension, narrative
         FROM assessment_evaluation_claims
        WHERE report_id = ?
        ORDER BY dimension`,
    ).all(report.id) as Array<{ polarity: string; dimension: string; narrative: string }>;
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ polarity: 'positive', dimension: 'implementation_evidence' }),
    ]));
    expect(claims).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ dimension: 'implementation_correctness' }),
    ]));
    expect(claims).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ dimension: 'test_strategy' }),
    ]));

    const diagnostics = sqlite.prepare(
      `SELECT code, severity, message
         FROM assessment_diagnostics
        WHERE report_id = ?
        ORDER BY code`,
    ).all(report.id) as Array<{ code: string; severity: string; message: string }>;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE', severity: 'warning' }),
      expect.objectContaining({ code: 'VERIFICATION_GAP_DECLARED', severity: 'warning' }),
    ]));
    expect(diagnostics).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ code: 'MISSING_TEST_EVIDENCE' }),
    ]));
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'VERIFICATION_GAP_DECLARED')?.message)
      .toContain('verification_gap source ref was captured instead of test_run output');
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE')?.message)
      .toContain('Positive implementation correctness, quality, security, reliability, or performance claims require a successful test_run source ref');

    const diagnosticSourceRefs = sqlite.prepare(
      `SELECT sr.source_ref_type
         FROM assessment_diagnostic_source_refs sr
         JOIN assessment_diagnostics d ON d.id = sr.diagnostic_id
        WHERE d.report_id = ?
          AND d.code = ?
        ORDER BY sr.source_ref_type`,
    ).all(report.id, 'VERIFICATION_GAP_DECLARED') as Array<{ source_ref_type: string }>;
    expect(diagnosticSourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_ref_type: 'verification_gap' }),
    ]));
  });

  it('drops unsupported positive implementation correctness claims when the claim cites only final diff evidence', async () => {
    const fixture = await createReadyAssessmentFixture(store, 'unsupported-correctness-claim');
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        summary: 'The candidate changed the popover root hook, but correctness requires cited verification.',
        recommendation: 'mixed_evidence_human_review',
        claims: [
          {
            id: 'implementation-evidence-backed-by-diff',
            polarity: 'positive',
            dimension: 'implementation_evidence',
            narrative: 'The submitted diff changes the popover root hook.',
            confidence: 0.72,
            sourceRefKeys: ['code_diff'],
          },
          {
            id: 'implementation-correctness-from-diff',
            polarity: 'positive',
            dimension: 'implementation_correctness',
            narrative: 'The implementation is correct based on the submitted diff.',
            confidence: 0.82,
            sourceRefKeys: ['code_diff'],
          },
        ],
        diagnostics: [],
      }),
    }));

    const result = await evaluateRepoTaskAssessmentSession({
      db,
      store,
      env: {
        AI: { run: aiRun } as unknown as Ai,
        CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
      },
      sessionId: fixture.sessionId,
      scheduledInterviewId: fixture.scheduledInterviewId,
      requestedBy: 'recruiter-1',
      requestedAt: '2026-07-03T00:03:30.000Z',
      requestEventId: fixture.requestEventId,
      requestSourceRef: fixture.requestSourceRef,
    });

    expect(result.kind).toBe('evaluated');
    const report = sqlite.prepare(
      `SELECT id, status
         FROM assessment_evaluation_reports
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    ).get(fixture.sessionId) as { id: string; status: string };
    expect(report.status).toBe('EVALUATED');

    const claims = sqlite.prepare(
      `SELECT polarity, dimension, narrative
         FROM assessment_evaluation_claims
        WHERE report_id = ?
        ORDER BY dimension`,
    ).all(report.id) as Array<{ polarity: string; dimension: string; narrative: string }>;
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ polarity: 'positive', dimension: 'implementation_evidence' }),
    ]));
    expect(claims).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ dimension: 'implementation_correctness' }),
    ]));

    const diagnostics = sqlite.prepare(
      `SELECT code, severity, message
         FROM assessment_diagnostics
        WHERE report_id = ?
        ORDER BY code`,
    ).all(report.id) as Array<{ code: string; severity: string; message: string }>;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE', severity: 'warning' }),
    ]));
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE')?.message)
      .toContain('Positive implementation correctness, quality, security, reliability, or performance claims require a successful test_run source ref');
  });

  it('drops unsupported positive correctness claims when test evidence is not bound to the submitted commit', async () => {
    const fixture = await createReadyAssessmentFixture(store, 'loose-test-run-correctness');
    await store.recordEvent({
      sessionId: fixture.sessionId,
      ingestionKey: 'assessment-event:loose-test-run-correctness:loose-test-run',
      kind: 'test_run',
      actorType: 'system',
      actorId: 'test-harness',
      narrative: 'A loose test run exists but is not tied to the submitted commit.',
      payload: {
        command: 'npm test',
        exitCode: 0,
      },
      sourceRefs: [await sourceRef({
        type: 'test_run',
        id: 'loose-successful-test-run',
        evidenceRole: 'verification_test_output',
        exactText: '$ npm test\npassed\nexitCode: 0',
      })],
    });
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        summary: 'The candidate changed the popover root hook, but loose test output cannot prove the submitted commit.',
        recommendation: 'mixed_evidence_human_review',
        claims: [
          {
            id: 'implementation-evidence-backed-by-diff',
            polarity: 'positive',
            dimension: 'implementation_evidence',
            narrative: 'The submitted diff changes the popover root hook.',
            confidence: 0.72,
            sourceRefKeys: ['code_diff'],
          },
          {
            id: 'correctness-backed-by-loose-test',
            polarity: 'positive',
            dimension: 'implementation_correctness',
            narrative: 'The submitted implementation is correct because tests passed.',
            confidence: 0.82,
            sourceRefKeys: ['loose-successful-test-run'],
          },
        ],
        diagnostics: [],
      }),
    }));

    const result = await evaluateRepoTaskAssessmentSession({
      db,
      store,
      env: {
        AI: { run: aiRun } as unknown as Ai,
        CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
      },
      sessionId: fixture.sessionId,
      scheduledInterviewId: fixture.scheduledInterviewId,
      requestedBy: 'recruiter-1',
      requestedAt: '2026-07-03T00:03:45.000Z',
      requestEventId: fixture.requestEventId,
      requestSourceRef: fixture.requestSourceRef,
    });

    expect(result.kind).toBe('evaluated');
    const report = sqlite.prepare(
      `SELECT id, status
         FROM assessment_evaluation_reports
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    ).get(fixture.sessionId) as { id: string; status: string };
    expect(report.status).toBe('EVALUATED');

    const claims = sqlite.prepare(
      `SELECT polarity, dimension, narrative
         FROM assessment_evaluation_claims
        WHERE report_id = ?
        ORDER BY dimension`,
    ).all(report.id) as Array<{ polarity: string; dimension: string; narrative: string }>;
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ polarity: 'positive', dimension: 'implementation_evidence' }),
    ]));
    expect(claims).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ dimension: 'implementation_correctness' }),
    ]));

    const diagnostics = sqlite.prepare(
      `SELECT code, severity, message
         FROM assessment_diagnostics
        WHERE report_id = ?
        ORDER BY code`,
    ).all(report.id) as Array<{ code: string; severity: string; message: string }>;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE', severity: 'warning' }),
    ]));
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE')?.message)
      .toContain('bound to the submitted commit');
  });

  it('keeps positive correctness claims when successful test evidence is bound to the submitted commit', async () => {
    const fixture = await createReadyAssessmentFixture(store, 'bound-test-run-correctness');
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        summary: 'The candidate changed the popover root hook and cited commit-bound test evidence.',
        recommendation: 'mixed_evidence_human_review',
        claims: [
          {
            id: 'correctness-backed-by-bound-test',
            polarity: 'positive',
            dimension: 'implementation_correctness',
            narrative: 'The submitted implementation has successful verification evidence tied to the submitted commit.',
            confidence: 0.78,
            sourceRefKeys: ['test_run'],
          },
        ],
        diagnostics: [],
      }),
    }));

    const result = await evaluateRepoTaskAssessmentSession({
      db,
      store,
      env: {
        AI: { run: aiRun } as unknown as Ai,
        CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
      },
      sessionId: fixture.sessionId,
      scheduledInterviewId: fixture.scheduledInterviewId,
      requestedBy: 'recruiter-1',
      requestedAt: '2026-07-03T00:03:55.000Z',
      requestEventId: fixture.requestEventId,
      requestSourceRef: fixture.requestSourceRef,
    });

    expect(result.kind).toBe('evaluated');
    const report = sqlite.prepare(
      `SELECT id, status
         FROM assessment_evaluation_reports
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    ).get(fixture.sessionId) as { id: string; status: string };
    expect(report.status).toBe('EVALUATED');

    const claims = sqlite.prepare(
      `SELECT polarity, dimension, narrative
         FROM assessment_evaluation_claims
        WHERE report_id = ?
        ORDER BY dimension`,
    ).all(report.id) as Array<{ polarity: string; dimension: string; narrative: string }>;
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ polarity: 'positive', dimension: 'implementation_correctness' }),
    ]));

    const diagnostics = sqlite.prepare(
      `SELECT code, severity
         FROM assessment_diagnostics
        WHERE report_id = ?
        ORDER BY code`,
    ).all(report.id) as Array<{ code: string; severity: string }>;
    expect(diagnostics).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ code: 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE' }),
    ]));
  });

  it('drops unsupported positive process claims when only final diff evidence is cited', async () => {
    const fixture = await createReadyAssessmentFixture(store, 'unsupported-process-claim');
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        summary: 'The candidate changed the popover root hook, but process evidence is not available.',
        recommendation: 'mixed_evidence_human_review',
        claims: [
          {
            id: 'implementation-backed-by-diff',
            polarity: 'positive',
            dimension: 'implementation_evidence',
            narrative: 'The submitted diff changes the popover root hook.',
            confidence: 0.72,
            sourceRefKeys: ['code_diff'],
          },
          {
            id: 'debugging-process-from-diff',
            polarity: 'positive',
            dimension: 'debugging_reasoning',
            narrative: 'The candidate followed a disciplined debugging workflow before changing the hook.',
            confidence: 0.82,
            sourceRefKeys: ['code_diff'],
          },
        ],
        diagnostics: [],
      }),
    }));

    const result = await evaluateRepoTaskAssessmentSession({
      db,
      store,
      env: {
        AI: { run: aiRun } as unknown as Ai,
        CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
      },
      sessionId: fixture.sessionId,
      scheduledInterviewId: fixture.scheduledInterviewId,
      requestedBy: 'recruiter-1',
      requestedAt: '2026-07-03T00:04:00.000Z',
      requestEventId: fixture.requestEventId,
      requestSourceRef: fixture.requestSourceRef,
    });

    expect(result.kind).toBe('evaluated');
    const report = sqlite.prepare(
      `SELECT id, status
         FROM assessment_evaluation_reports
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    ).get(fixture.sessionId) as { id: string; status: string };
    expect(report.status).toBe('EVALUATED');

    const claims = sqlite.prepare(
      `SELECT polarity, dimension, narrative
         FROM assessment_evaluation_claims
        WHERE report_id = ?
        ORDER BY dimension`,
    ).all(report.id) as Array<{ polarity: string; dimension: string; narrative: string }>;
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ polarity: 'positive', dimension: 'implementation_evidence' }),
    ]));
    expect(claims).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ dimension: 'debugging_reasoning' }),
    ]));

    const diagnostics = sqlite.prepare(
      `SELECT code, severity, message
         FROM assessment_diagnostics
        WHERE report_id = ?
        ORDER BY code`,
    ).all(report.id) as Array<{ code: string; severity: string; message: string }>;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE', severity: 'warning' }),
    ]));
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE')?.message)
      .toContain('Positive process or debugging claims require terminal, code-editor, workspace, transcript, chat, or candidate AI-prompt source refs');
  });

  it('drops unsupported positive communication claims when only final diff evidence is cited', async () => {
    const fixture = await createReadyAssessmentFixture(store, 'unsupported-communication-claim');
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        summary: 'The candidate changed the popover root hook, but communication evidence is not available.',
        recommendation: 'mixed_evidence_human_review',
        claims: [
          {
            id: 'implementation-backed-by-diff',
            polarity: 'positive',
            dimension: 'implementation_evidence',
            narrative: 'The submitted diff changes the popover root hook.',
            confidence: 0.72,
            sourceRefKeys: ['code_diff'],
          },
          {
            id: 'tradeoff-reasoning-from-diff',
            polarity: 'positive',
            dimension: 'tradeoff_reasoning',
            narrative: 'The candidate clearly explained the tradeoff behind the hook change.',
            confidence: 0.81,
            sourceRefKeys: ['code_diff'],
          },
        ],
        diagnostics: [],
      }),
    }));

    const result = await evaluateRepoTaskAssessmentSession({
      db,
      store,
      env: {
        AI: { run: aiRun } as unknown as Ai,
        CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
      },
      sessionId: fixture.sessionId,
      scheduledInterviewId: fixture.scheduledInterviewId,
      requestedBy: 'recruiter-1',
      requestedAt: '2026-07-03T00:04:30.000Z',
      requestEventId: fixture.requestEventId,
      requestSourceRef: fixture.requestSourceRef,
    });

    expect(result.kind).toBe('evaluated');
    const report = sqlite.prepare(
      `SELECT id, status
         FROM assessment_evaluation_reports
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    ).get(fixture.sessionId) as { id: string; status: string };
    expect(report.status).toBe('EVALUATED');

    const claims = sqlite.prepare(
      `SELECT polarity, dimension, narrative
         FROM assessment_evaluation_claims
        WHERE report_id = ?
        ORDER BY dimension`,
    ).all(report.id) as Array<{ polarity: string; dimension: string; narrative: string }>;
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ polarity: 'positive', dimension: 'implementation_evidence' }),
    ]));
    expect(claims).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ dimension: 'tradeoff_reasoning' }),
    ]));

    const diagnostics = sqlite.prepare(
      `SELECT code, severity, message
         FROM assessment_diagnostics
        WHERE report_id = ?
        ORDER BY code`,
    ).all(report.id) as Array<{ code: string; severity: string; message: string }>;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE', severity: 'warning' }),
    ]));
    expect(diagnostics.find((diagnostic) => diagnostic.code === 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE')?.message)
      .toContain('Positive communication, reasoning, or tradeoff claims require transcript, chat, candidate plan, or candidate-authored AI prompt source refs');
  });

  it('keeps positive communication claims when candidate chat evidence is cited', async () => {
    const fixture = await createReadyAssessmentFixture(store, 'supported-communication-claim');
    await store.recordEvent({
      sessionId: fixture.sessionId,
      ingestionKey: 'assessment-event:supported-communication-claim:chat-message',
      kind: 'message',
      actorType: 'candidate',
      actorId: 'candidate-supported-communication-claim',
      narrative: 'Candidate explained the tradeoff behind the implementation change.',
      payload: {
        channel: 'room_chat',
      },
      sourceRefs: [await sourceRef({
        type: 'room_chat_message',
        id: 'supported-communication-claim:room-chat-message',
        exactText: 'Candidate: I kept the change scoped to the hook because it avoids changing public popover behavior while fixing the impatient-click edge case.',
      })],
    });
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        summary: 'The candidate changed the popover root hook and explained the tradeoff in chat.',
        recommendation: 'mixed_evidence_human_review',
        claims: [
          {
            id: 'tradeoff-reasoning-backed-by-chat',
            polarity: 'positive',
            dimension: 'tradeoff_reasoning',
            narrative: 'The candidate explained why the hook-level change avoided altering public popover behavior.',
            confidence: 0.77,
            sourceRefKeys: ['room_chat_message'],
          },
        ],
        diagnostics: [],
      }),
    }));

    const result = await evaluateRepoTaskAssessmentSession({
      db,
      store,
      env: {
        AI: { run: aiRun } as unknown as Ai,
        CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
      },
      sessionId: fixture.sessionId,
      scheduledInterviewId: fixture.scheduledInterviewId,
      requestedBy: 'recruiter-1',
      requestedAt: '2026-07-03T00:04:45.000Z',
      requestEventId: fixture.requestEventId,
      requestSourceRef: fixture.requestSourceRef,
    });

    expect(result.kind).toBe('evaluated');
    const report = sqlite.prepare(
      `SELECT id, status
         FROM assessment_evaluation_reports
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
    ).get(fixture.sessionId) as { id: string; status: string };
    expect(report.status).toBe('EVALUATED');

    const claims = sqlite.prepare(
      `SELECT polarity, dimension, narrative
         FROM assessment_evaluation_claims
        WHERE report_id = ?
        ORDER BY dimension`,
    ).all(report.id) as Array<{ polarity: string; dimension: string; narrative: string }>;
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ polarity: 'positive', dimension: 'tradeoff_reasoning' }),
    ]));

    const diagnostics = sqlite.prepare(
      `SELECT code, severity, message
         FROM assessment_diagnostics
        WHERE report_id = ?
        ORDER BY code`,
    ).all(report.id) as Array<{ code: string; severity: string; message: string }>;
    expect(diagnostics).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ code: 'MODEL_POSITIVE_CLAIM_UNSUPPORTED_BY_EVIDENCE' }),
    ]));
  });

  it('recovers stale running evaluation sessions from the scheduled worker path', async () => {
    const fixture = await createReadyAssessmentFixture(store, 'scheduled-recovery');
    await store.transitionState({
      sessionId: fixture.sessionId,
      toState: 'EVALUATING',
      reason: 'Simulate a request-started evaluation that outlived the request path.',
      eventId: fixture.requestEventId,
      createdBy: 'test',
    });
    sqlite.prepare(
      `UPDATE assessment_sessions
          SET updated_at = ?
        WHERE id = ?`,
    ).run('2026-07-03T00:00:00.000Z', fixture.sessionId);

    const aiRun = vi.fn(async () => ({
      response: 'This response is intentionally not JSON, forcing the same source-backed fallback used by live recovery.',
    }));
    const result = await processStaleRepoTaskAssessmentEvaluations({
      DB: db,
      AI: { run: aiRun } as unknown as Ai,
      CLOUDFLARE_AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
    }, {
      staleMs: 0,
      limit: 5,
      now: '2026-07-03T00:05:00.000Z',
    });

    expect(result).toEqual({
      scanned: 1,
      evaluated: 1,
      diagnostics: 0,
      failed: 0,
    });
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare(
      `SELECT state FROM assessment_sessions WHERE id = ?`,
    ).get(fixture.sessionId)).toEqual({ state: 'EVALUATED' });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS count
         FROM assessment_evaluation_reports
        WHERE session_id = ?
          AND status = 'EVALUATED'`,
    ).get(fixture.sessionId)).toEqual({ count: 1 });
  });
});
