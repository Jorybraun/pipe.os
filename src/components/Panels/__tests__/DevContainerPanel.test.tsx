import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevContainerPanel } from '../DevContainerPanel';
import type { UseDevContainerSessionReturn } from '../../../hooks/useDevContainerSession';
import type { CandidateAssessmentProgress } from '../../../lib/assessmentCommitSubmission';

const destroyMock = vi.fn(async () => {});
const launchMock = vi.fn(async () => {});
const resetMock = vi.fn();

vi.mock('../../../hooks/useDevContainerSession', () => ({
  useDevContainerSession: (): UseDevContainerSessionReturn => ({
    state: 'READY',
    containerUrl: 'https://container.example.test/',
    accessToken: null,
    taskArn: 'workspace-session-1',
    error: null,
    expiresAt: '2026-07-01T12:00:00.000Z',
    expiringSoon: false,
    launch: launchMock,
    destroy: destroyMock,
    reset: resetMock,
  }),
}));

vi.mock('../../../contexts/SessionTokenContext', () => ({
  useSessionToken: (): string => 'candidate-session-token',
}));

const baseCommitSha = '1111111111111111111111111111111111111111';
const commitSha = '2222222222222222222222222222222222222222';

function progressResponse(
  overrides: Partial<CandidateAssessmentProgress> = {},
): { progress: CandidateAssessmentProgress } {
  return {
    progress: {
      mode: 'OPEN_SOURCE_BUG_FIX',
      state: 'IN_PROGRESS',
      stage: 'WORKSPACE_ACTIVE',
      nextAction: 'SUBMIT_COMMIT',
      nextActionLabel: 'Submit assessment commit',
      assignmentTrust: null,
      readiness: {
        label: 'Commit evidence required',
        detail: 'Submit the assessment branch commit with exact source evidence.',
        isReadyForEvaluation: false,
        missingRequiredCount: 2,
        required: [],
      },
      challengePacketContract: {
        schemaVersion: 'challenge-packet-contract-v1',
        isComplete: true,
        missingFields: [],
        hasRepositoryUrl: true,
        hasBaseCommitSha: true,
        hasTask: true,
        hasSuccessCriteria: true,
        hasExpectedEvidence: true,
      },
      hasChallengePacket: true,
      hasWorkEvidence: true,
      hasMessageEvidence: false,
      hasDevContainerEvidence: true,
      hasToolUsageEvidence: false,
      hasCommitSubmission: false,
      hasFinalSubmission: false,
      hasAiInteraction: false,
      hasTranscriptEvidence: false,
      hasTestEvidence: false,
      hasVerificationGap: false,
      evidenceCounts: [],
      sourceRefCounts: [],
      evidenceSnippets: [],
      challenge: {
        sourceRefType: 'open_source_challenge_packet',
        evidenceRole: 'assigned_challenge',
        exactText: [
          'Repo: https://github.com/acme/repo',
          `Base commit: ${baseCommitSha}`,
          'Task: Fix retry handling in acme/repo.',
          'Success criteria:',
          '- Retry behavior is deterministic and covered by a focused test.',
          'Expected evidence:',
          '- git commit SHA on a pipe-assessment branch',
          '- code diff for the retry path',
          'Verification command: npm test -- retry',
        ].join('\n'),
        contentHash: 'sha256:challenge',
        locator: {
          repositoryUrl: 'https://github.com/acme/repo',
          baseCommitSha,
        },
        summary: {
          repositoryUrl: 'https://github.com/acme/repo',
          githubPrNumber: null,
          pullRequestUrl: null,
          baseCommitSha,
          task: 'Fix retry handling in acme/repo.',
          assessmentFit: [],
          matchProof: [],
          successCriteria: ['Retry behavior is deterministic and covered by a focused test.'],
          expectedEvidence: [
            'git commit SHA on a pipe-assessment branch',
            'code diff for the retry path',
          ],
          verificationCommand: 'npm test -- retry',
        },
      },
      latestEvent: null,
      commit: null,
      evaluation: null,
      ...overrides,
    },
  };
}

describe('DevContainerPanel assessment submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the source-backed task, assignment locator, evidence state, and submit action visible above the workspace', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/rpc/assessment/progress')) {
        return new Response(JSON.stringify(progressResponse({
          hasToolUsageEvidence: true,
          hasAiInteraction: true,
          hasTestEvidence: false,
          hasVerificationGap: true,
        })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DevContainerPanel challengeId="challenge-1" />);

    const statusStrip = await screen.findByTestId('assessment-workspace-status-strip');
    expect(statusStrip).toHaveTextContent('SOURCE-BACKED TASK');
    const brief = screen.getByTestId('assessment-workspace-task-brief');
    expect(brief).toHaveTextContent('TASK');
    expect(brief).toHaveTextContent('Fix retry handling in acme/repo.');
    expect(brief).toHaveTextContent('SUCCESS');
    expect(brief).toHaveTextContent('Retry behavior is deterministic and covered by a focused test.');
    expect(brief).toHaveTextContent('EVIDENCE');
    expect(brief).toHaveTextContent('git commit SHA on a pipe-assessment branch');
    expect(brief).toHaveTextContent('code diff for the retry path');
    expect(brief).toHaveTextContent('VERIFY');
    expect(brief).toHaveTextContent('npm test -- retry');

    const locator = screen.getByTestId('assessment-workspace-assignment-locator');
    expect(locator).toHaveTextContent('https://github.com/acme/repo');
    expect(locator).toHaveTextContent(baseCommitSha.slice(0, 12));
    expect(locator).toHaveTextContent('pipe-assessment');

    const proofPills = screen.getByTestId('assessment-workspace-proof-pills');
    expect(proofPills).toHaveTextContent('Task packet complete');
    expect(proofPills).toHaveTextContent('Workspace evidence');
    expect(proofPills).toHaveTextContent('Tool activity');
    expect(proofPills).toHaveTextContent('AI use captured');
    expect(proofPills).toHaveTextContent('Test gap declared');
    expect(proofPills).toHaveTextContent('Commit required');
    expect(screen.queryByTestId('assessment-commit-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('assessment-workspace-submit-work'));
    expect(screen.getByTestId('assessment-commit-panel')).toBeInTheDocument();
  });

  it('keeps partial verification gaps visible when test evidence is also captured', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/rpc/assessment/progress')) {
        return new Response(JSON.stringify(progressResponse({
          hasTestEvidence: true,
          hasVerificationGap: true,
        })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DevContainerPanel challengeId="challenge-1" />);

    const proofPills = await screen.findByTestId('assessment-workspace-proof-pills');
    expect(proofPills).toHaveTextContent('Tests captured + gap declared');
  });

  it('lets candidates submit source-backed commit evidence from a ready dev container', async () => {
    const forkRepositoryUrl = 'https://github.com/candidate/repo';
    const commitUrl = `${forkRepositoryUrl}/commit/${commitSha}`;
    const upstreamPullRequestUrl = 'https://github.com/acme/repo/pull/42';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/rpc/assessment/progress')) {
        return new Response(JSON.stringify(progressResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/rpc/assessment/commit-submission')) {
        return new Response(JSON.stringify({
          submission: {
            accepted: true,
            repositoryUrl: 'https://github.com/acme/repo',
            branchName: 'pipe-assessment',
            commitSha,
            commitUrl,
            upstreamPullRequestUrl,
            upstreamPrConsent: true,
          },
          progress: {
            ...progressResponse().progress,
            hasCommitSubmission: true,
            hasTestEvidence: true,
            nextActionLabel: 'Ready for evaluation',
            commit: {
              repositoryUrl: 'https://github.com/acme/repo',
              forkRepositoryUrl,
              branchName: 'pipe-assessment',
              baseCommitSha,
              commitSha,
              commitUrl,
              upstreamPullRequestUrl,
              upstreamPrConsent: true,
              submissionSource: 'manual_fallback',
              submissionSourceLabel: 'Manual commit evidence',
              integrity: null,
              changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
              occurredAt: '2026-07-01T12:01:00.000Z',
            },
          },
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DevContainerPanel challengeId="challenge-1" />);

    await screen.findByTestId('assessment-submit-toggle');
    fireEvent.click(screen.getByTestId('assessment-submit-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('assessment-commit-repository-url')).toHaveValue('https://github.com/acme/repo');
      expect(screen.getByTestId('assessment-commit-base-sha')).toHaveValue(baseCommitSha);
    });

    fireEvent.change(screen.getByTestId('assessment-commit-fork-url'), {
      target: { value: forkRepositoryUrl },
    });
    fireEvent.change(screen.getByTestId('assessment-commit-commit-url'), {
      target: { value: commitUrl },
    });
    fireEvent.change(screen.getByTestId('assessment-commit-upstream-pr-url'), {
      target: { value: upstreamPullRequestUrl },
    });
    fireEvent.click(screen.getByTestId('assessment-commit-upstream-pr-consent'));
    fireEvent.change(screen.getByTestId('assessment-commit-narrative'), {
      target: { value: 'Fixed retry handling and verified the focused test.' },
    });
    fireEvent.change(screen.getByTestId('assessment-commit-commit-sha'), {
      target: { value: commitSha },
    });
    fireEvent.change(screen.getByTestId('assessment-commit-changed-files'), {
      target: { value: 'modified src/retry.ts' },
    });
    fireEvent.change(screen.getByTestId('assessment-commit-commit-evidence'), {
      target: { value: `commit ${commitSha}\nAuthor: Candidate\n\nFix retry handling` },
    });
    fireEvent.change(screen.getByTestId('assessment-commit-diff'), {
      target: { value: `diff --git a/src/retry.ts b/src/retry.ts\n+export const retry = true;` },
    });
    fireEvent.change(screen.getByTestId('assessment-commit-test-evidence'), {
      target: { value: 'npm test -- retry\nPASS src/retry.test.ts' },
    });
    fireEvent.click(screen.getByTestId('assessment-commit-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('assessment-commit-result')).toHaveTextContent('Ready for evaluation');
    });

    const submitCall = fetchMock.mock.calls.find(([input]) =>
      input.toString().endsWith('/rpc/assessment/commit-submission'),
    );
    expect(submitCall).toBeTruthy();
    expect(submitCall?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer candidate-session-token',
    });
    const payload = JSON.parse(String(submitCall?.[1]?.body)) as {
      sourceRefs: Array<{ sourceRefType: string; metadata?: { source?: string } }>;
      forkRepositoryUrl: string | null;
      branchName: string;
      commitSha: string;
      commitUrl: string | null;
      upstreamPullRequestUrl: string | null;
      upstreamPrConsent: boolean;
    };
    expect(payload.forkRepositoryUrl).toBe(forkRepositoryUrl);
    expect(payload.branchName).toBe('pipe-assessment');
    expect(payload.commitSha).toBe(commitSha);
    expect(payload.commitUrl).toBe(commitUrl);
    expect(payload.upstreamPullRequestUrl).toBe(upstreamPullRequestUrl);
    expect(payload.upstreamPrConsent).toBe(true);
    expect(payload.sourceRefs.map((ref) => ref.sourceRefType)).toEqual([
      'git_commit',
      'code_diff',
      'test_run',
      'upstream_pull_request',
    ]);
    expect(payload.sourceRefs.every((ref) => ref.metadata?.source === 'assessment_commit_submission_panel')).toBe(true);
  });

  it('prefills the workspace finalizer with the assigned verification command', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/rpc/assessment/progress')) {
        return new Response(JSON.stringify(progressResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DevContainerPanel challengeId="challenge-1" />);

    await screen.findByTestId('assessment-submit-toggle');
    fireEvent.click(screen.getByTestId('assessment-submit-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('assessment-workspace-finalize-test-command')).toHaveValue('npm test -- retry');
    });
  });

  it('finalizes the committed workspace HEAD through the live dev-container bridge', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/rpc/assessment/progress')) {
        return new Response(JSON.stringify(progressResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/rpc/dev-container/workspace-session-1/assessment/finalize')) {
        return new Response(JSON.stringify({
          submission: {
            accepted: true,
            repositoryUrl: 'https://github.com/acme/repo',
            branchName: 'pipe-assessment',
            commitSha,
            commitUrl: null,
          },
          progress: {
            ...progressResponse().progress,
            hasCommitSubmission: true,
            hasTestEvidence: true,
            nextActionLabel: 'Ready for evaluation',
            commit: {
              repositoryUrl: 'https://github.com/acme/repo',
              forkRepositoryUrl: null,
              branchName: 'pipe-assessment',
              baseCommitSha,
              commitSha,
              commitUrl: null,
              submissionSource: 'workspace_finalizer',
              submissionSourceLabel: 'Live workspace finalizer',
              integrity: {
                label: 'Live workspace commit',
                detail: 'Captured by the live dev-container finalizer from the workspace HEAD.',
              },
              changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
              occurredAt: '2026-07-01T12:01:00.000Z',
            },
          },
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DevContainerPanel challengeId="challenge-1" />);

    await screen.findByTestId('assessment-submit-toggle');
    fireEvent.click(screen.getByTestId('assessment-submit-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('assessment-workspace-finalize-submit')).not.toBeDisabled();
    });
    const trustContract = screen.getByTestId('assessment-workspace-finalize-trust-contract');
    expect(trustContract).toHaveTextContent('TRUSTED FINALIZER PATH');
    expect(trustContract).toHaveTextContent('Reads the current git HEAD inside the controlled workspace.');
    expect(trustContract).toHaveTextContent('Verifies repository and base commit against the assigned challenge packet.');
    expect(trustContract).toHaveTextContent('Stores source refs for the commit, diff, tests, and workspace state before evaluation.');

    fireEvent.change(screen.getByTestId('assessment-workspace-finalize-narrative'), {
      target: { value: 'Fixed retry handling and committed the focused patch.' },
    });
    fireEvent.change(screen.getByTestId('assessment-workspace-finalize-test-command'), {
      target: { value: 'npm test -- retry' },
    });
    fireEvent.change(screen.getByTestId('assessment-workspace-finalize-verification-notes'), {
      target: { value: 'Targeted retry test passed in the workspace.' },
    });
    fireEvent.click(screen.getByTestId('assessment-workspace-finalize-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('assessment-commit-result')).toHaveTextContent('Workspace commit 222222222222 captured. Ready for evaluation');
    });

    const finalizeCall = fetchMock.mock.calls.find(([input]) =>
      input.toString().endsWith('/rpc/dev-container/workspace-session-1/assessment/finalize'),
    );
    expect(finalizeCall).toBeTruthy();
    expect(finalizeCall?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer candidate-session-token',
    });
    expect(JSON.parse(String(finalizeCall?.[1]?.body))).toEqual({
      narrative: 'Fixed retry handling and committed the focused patch.',
      testCommand: 'npm test -- retry',
      verificationNotes: 'Targeted retry test passed in the workspace.',
    });
  });

  it('shows recovery commands when workspace finalization finds uncommitted changes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/rpc/assessment/progress')) {
        return new Response(JSON.stringify(progressResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/rpc/dev-container/workspace-session-1/assessment/finalize')) {
        return new Response(JSON.stringify({
          error: {
            code: 'DIRTY_WORKSPACE',
            message: 'Cannot finalize assessment: commit or discard uncommitted workspace changes before submitting HEAD.',
          },
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DevContainerPanel challengeId="challenge-1" />);

    await screen.findByTestId('assessment-submit-toggle');
    fireEvent.click(screen.getByTestId('assessment-submit-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('assessment-workspace-finalize-submit')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('assessment-workspace-finalize-submit'));

    const result = await screen.findByTestId('assessment-commit-result');
    expect(result).toHaveTextContent('commit or discard uncommitted workspace changes');

    const recovery = screen.getByTestId('assessment-workspace-finalize-recovery');
    expect(recovery).toHaveTextContent('COMMIT WORKSPACE CHANGES FIRST');
    expect(recovery).toHaveTextContent('git status --short');
    expect(recovery).toHaveTextContent('git add <files>');
    expect(recovery).toHaveTextContent('git commit -m "pipe assessment submission"');
  });

  it('blocks commit submission and workspace finalization until the challenge packet is complete', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/rpc/assessment/progress')) {
        return new Response(JSON.stringify(progressResponse({
          nextActionLabel: 'Add success criteria and expected evidence before candidate work is accepted.',
          challengePacketContract: {
            schemaVersion: 'challenge-packet-contract-v1',
            isComplete: false,
            missingFields: ['success criteria', 'expected evidence'],
            hasRepositoryUrl: true,
            hasBaseCommitSha: true,
            hasTask: true,
            hasSuccessCriteria: false,
            hasExpectedEvidence: false,
          },
        })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DevContainerPanel challengeId="challenge-1" />);

    await screen.findByTestId('assessment-submit-toggle');
    fireEvent.click(screen.getByTestId('assessment-submit-toggle'));

    const blocker = await screen.findByTestId('assessment-commit-packet-blocker');
    expect(blocker).toHaveTextContent(
      'Complete the source-backed challenge packet before submitting work. Missing success criteria, expected evidence.',
    );
    expect(screen.getByTestId('assessment-workspace-finalize-submit')).toBeDisabled();
    expect(screen.getByTestId('assessment-commit-submit')).toBeDisabled();

    const networkTargets = fetchMock.mock.calls.map(([input]) => input.toString());
    expect(networkTargets).toEqual([
      expect.stringContaining('/rpc/assessment/progress'),
    ]);
  });
});
