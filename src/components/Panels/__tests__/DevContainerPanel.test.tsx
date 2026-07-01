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
        exactText: 'Fix retry handling in acme/repo.',
        contentHash: 'sha256:challenge',
        locator: {
          repositoryUrl: 'https://github.com/acme/repo',
          baseCommitSha,
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

  it('lets candidates submit source-backed commit evidence from a ready dev container', async () => {
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

    await screen.findByText('SUBMIT COMMIT');
    fireEvent.click(screen.getByTestId('assessment-submit-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('assessment-commit-repository-url')).toHaveValue('https://github.com/acme/repo');
      expect(screen.getByTestId('assessment-commit-base-sha')).toHaveValue(baseCommitSha);
    });

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
      branchName: string;
      commitSha: string;
    };
    expect(payload.branchName).toBe('pipe-assessment');
    expect(payload.commitSha).toBe(commitSha);
    expect(payload.sourceRefs.map((ref) => ref.sourceRefType)).toEqual([
      'git_commit',
      'code_diff',
      'test_run',
    ]);
    expect(payload.sourceRefs.every((ref) => ref.metadata?.source === 'assessment_commit_submission_panel')).toBe(true);
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

    await screen.findByText('SUBMIT COMMIT');
    fireEvent.click(screen.getByTestId('assessment-submit-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('assessment-workspace-finalize-submit')).not.toBeDisabled();
    });

    fireEvent.change(screen.getByTestId('assessment-workspace-finalize-narrative'), {
      target: { value: 'Fixed retry handling and committed the focused patch.' },
    });
    expect(screen.queryByTestId('assessment-workspace-finalize-test-command')).toBeNull();
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
    });
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

    await screen.findByText('SUBMIT COMMIT');
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
