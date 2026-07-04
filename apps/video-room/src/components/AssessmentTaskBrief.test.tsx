// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssessmentTaskBrief } from './AssessmentTaskBrief';
import type { RoomAssessmentProgressSnapshot, RoomWorkspace, RoomWorkspaceChallengePacket } from '../types';

const packet: RoomWorkspaceChallengePacket = {
  sourceRefType: 'open_source_challenge_packet',
  evidenceRole: 'assigned_challenge',
  exactText: [
    'Repo: https://github.com/pipe/source-backed-worker',
    'Base commit: dddddddddddddddddddddddddddddddddddddddd',
    'Task: Fix the source-backed worker retry path.',
    'Verification command: npm test -- retry-worker',
    'Match proof:',
    '- Review packet quality 92% from source-backed repo analysis.',
    '- 2 source-backed repo demands in the selected PR packet.',
    'Assessment fit:',
    '- focused review calibrated for senior candidates.',
    '- 30 minute target from deterministic engineering prior.',
    '- No issue context in the source-backed PR packet; assess from code demand evidence.',
    'Success criteria:',
    '- Retry order remains deterministic',
    '- Existing worker tests pass',
    'Expected evidence:',
    '- Commit SHA on assessment branch',
    '- Test command output',
  ].join('\n'),
  locator: {
    repositoryUrl: 'https://github.com/pipe/source-backed-worker',
    githubPrNumber: 144,
    baseCommitSha: 'dddddddddddddddddddddddddddddddddddddddd',
  },
  contentHash: 'sha256:packet-content-hash',
};

const workspace: RoomWorkspace = {
  enabled: true,
  canLaunch: false,
  repoUrl: 'https://github.com/pipe/source-backed-worker',
  githubPrNumber: 144,
  matchedRepoId: 12,
  challenge: {
    status: 'github_pr_assigned',
    kind: 'github_pr',
    source: 'scheduled_interview.github_pr_number',
    message: null,
    packet,
  },
  session: {
    sessionId: 'workspace-session-1',
    status: 'READY',
    ttlSeconds: 3600,
    ttlSource: 'container',
    expiresAt: '2026-06-30T00:00:00.000Z',
    warnedAt: null,
    expiringSoon: false,
    proxyPath: '/workspace',
    errorMessage: null,
  },
};

const progress: RoomAssessmentProgressSnapshot = {
  mode: 'OPEN_SOURCE_BUG_FIX',
  state: 'FINAL_SUBMITTED',
  stage: 'READY_FOR_EVALUATION',
  nextAction: 'START_EVALUATION',
  nextActionLabel: 'Start source-backed AI or human evaluation.',
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
  hasMessageEvidence: true,
  hasDevContainerEvidence: true,
  hasToolUsageEvidence: true,
  hasCommitSubmission: true,
  hasFinalSubmission: false,
  hasAiInteraction: true,
  hasTranscriptEvidence: false,
  hasTestEvidence: true,
  evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
  sourceRefCounts: [{ kind: 'test_run', count: 1 }],
  latestEvent: {
    kind: 'commit_submission',
    sequence: 4,
    occurredAt: '2026-06-29T22:00:00.000Z',
  },
  commit: {
    repositoryUrl: 'https://github.com/pipe/source-backed-worker',
    forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
    branchName: 'pipe-assessment/retry-path',
    baseCommitSha: 'd'.repeat(40),
    commitSha: 'c'.repeat(40),
    commitUrl: `https://github.com/candidate/source-backed-worker/commit/${'c'.repeat(40)}`,
    changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
    occurredAt: '2026-06-29T22:00:00.000Z',
  },
  evaluation: null,
  readiness: {
    status: 'READY_FOR_EVALUATION',
    label: 'Ready for evaluation',
    detail: 'Required challenge, work, commit, and source evidence are captured.',
    isReadyForEvaluation: true,
    isUsableHiringSignal: false,
    missingRequiredCount: 0,
    required: [
      {
        id: 'challenge_packet',
        label: 'Complete challenge packet',
        required: true,
        satisfied: true,
        sourceRefTypes: ['open_source_challenge_packet'],
        missingImpact: 'Assign a source-backed challenge packet.',
      },
      {
        id: 'commit_submission',
        label: 'Assessment branch commit',
        required: true,
        satisfied: true,
        sourceRefTypes: ['git_commit', 'code_diff'],
        missingImpact: 'Submit a real commit.',
      },
    ],
    confidence: [
      {
        id: 'test_or_verification',
        label: 'Tests or verification note',
        required: false,
        satisfied: true,
        sourceRefTypes: ['test_run'],
        missingImpact: 'Capture test output.',
      },
      {
        id: 'candidate_explanation',
        label: 'Candidate explanation',
        required: false,
        satisfied: true,
        sourceRefTypes: ['room_chat_message'],
        missingImpact: 'Capture transcript or chat evidence.',
      },
    ],
  },
};

describe('AssessmentTaskBrief', () => {
  it('keeps the real task, success criteria, expected evidence, and submit path visible', () => {
    const onOpenWorkspace = vi.fn();
    const onOpenSubmission = vi.fn();

    render(
      <AssessmentTaskBrief
        packet={packet}
        workspace={workspace}
        progress={progress}
        workspaceReady
        onOpenWorkspace={onOpenWorkspace}
        onOpenSubmission={onOpenSubmission}
      />,
    );

    const brief = screen.getByTestId('assessment-task-brief');
    const briefText = brief.textContent ?? '';
    expect(briefText).toContain('Assessment task');
    expect(briefText).toContain('Open-source implementation');
    expect(briefText).toContain('pipe/source-backed-worker');
    expect(briefText).toContain('#144');
    expect(briefText).toContain('dddddddddd');
    expect(briefText).toContain('pipe-assessment/retry-path');
    expect(briefText).toContain('Required challenge, work, commit, and source evidence are captured.');
    expect(briefText).toContain('Fix the source-backed worker retry path.');
    expect(briefText).toContain('Verification command');
    expect(briefText).toContain('npm test -- retry-worker');
    expect(briefText).toContain('Match proof');
    expect(briefText).toContain('Review packet quality 92% from source-backed repo analysis.');
    expect(briefText).toContain('2 source-backed repo demands in the selected PR packet.');
    expect(briefText).toContain('Assessment fit');
    expect(briefText).toContain('focused review calibrated for senior candidates.');
    expect(briefText).toContain('30 minute target from deterministic engineering prior.');
    expect(briefText).toContain('No issue context in the source-backed PR packet; assess from code demand evidence.');
    expect(briefText).toContain('Retry order remains deterministic');
    expect(briefText).toContain('Existing worker tests pass');
    expect(briefText).toContain('Commit SHA on assessment branch');
    expect(briefText).toContain('Test command output');
    expect(screen.getByTestId('assessment-task-brief-readiness').textContent).toContain('Ready for evaluation');
    const submission = screen.getByTestId('assessment-task-brief-submission');
    expect(submission.textContent).toContain('Submission captured');
    expect(submission.textContent).toContain('Your assessment branch commit, diff, and required source refs are captured.');
    expect(submission.textContent).toContain('Commit');
    expect(submission.textContent).toContain('cccccccccc');
    expect(submission.textContent).toContain('Branch');
    expect(submission.textContent).toContain('pipe-assessment/retry-path');
    expect(submission.textContent).toContain('1 changed file');
    expect(submission.textContent).toContain('Test evidence captured');
    expect(briefText).toContain('Proof checklist');
    expect(briefText).toContain('Ready for source-backed review');
    expect(briefText).toContain('Complete challenge packet: Captured');
    expect(briefText).toContain('Assessment branch commit: Captured');
    expect(briefText).toContain('Tests or verification note: Captured');
    expect(briefText).toContain('Candidate explanation: Captured');
    expect(briefText).toContain('AI-use transparency: Captured');
    expect(briefText).toContain('AI prompts, responses, or bridge traces are part of the source-backed evidence trail.');
    expect(briefText).toContain('Commit cccccccccc');
    expect(screen.getByTestId('assessment-brief-open-submission').textContent).toContain('Review Submission');
    expect(screen.getByTestId('assessment-brief-open-submission').textContent).not.toContain('Submit work');
    expect(briefText).not.toContain('sha256:packet-content-hash');

    fireEvent.click(screen.getByTestId('assessment-brief-open-workspace'));
    fireEvent.click(screen.getByTestId('assessment-brief-open-submission'));
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
    expect(onOpenSubmission).toHaveBeenCalledTimes(1);
  });

  it('shows a diagnostic instead of inventing a task when the packet is missing', () => {
    render(
      <AssessmentTaskBrief
        packet={null}
        workspace={{ ...workspace, challenge: { ...workspace.challenge, packet: null } }}
        workspaceReady={false}
      />,
    );

    expect(screen.getByText('The host still needs to attach a source-backed task packet before this assessment can be trusted.')).not.toBeNull();
    expect(screen.getByText('Attach a complete source-backed task packet before candidate work starts.')).not.toBeNull();
    expect(screen.queryByTestId('assessment-brief-open-submission')).toBeNull();
    expect(screen.queryByTestId('assessment-task-brief-proof')).toBeNull();
  });

  it('shows missing required proof before the candidate submits a real commit', () => {
    render(
      <AssessmentTaskBrief
        packet={packet}
        workspace={workspace}
        progress={{
          ...progress,
          state: 'IN_PROGRESS',
          stage: 'WORK_IN_PROGRESS',
          nextAction: 'SUBMIT_COMMIT',
          nextActionLabel: 'Submit the assessment branch commit.',
          hasWorkEvidence: true,
          hasMessageEvidence: false,
          hasDevContainerEvidence: true,
          hasToolUsageEvidence: false,
          hasCommitSubmission: false,
          hasAiInteraction: false,
          hasTranscriptEvidence: false,
          hasTestEvidence: false,
          evidenceCounts: [],
          sourceRefCounts: [],
          latestEvent: null,
          commit: null,
          readiness: {
            status: 'WORK_IN_PROGRESS',
            label: 'Work evidence in progress',
            detail: 'Submit a real commit from a pipe-assessment branch or fork before evaluation.',
            isReadyForEvaluation: false,
            isUsableHiringSignal: false,
            missingRequiredCount: 2,
            required: [
              {
                id: 'challenge_packet',
                label: 'Complete challenge packet',
                required: true,
                satisfied: true,
                sourceRefTypes: ['open_source_challenge_packet'],
                missingImpact: 'Assign a source-backed challenge packet.',
              },
              {
                id: 'commit_submission',
                label: 'Assessment branch commit',
                required: true,
                satisfied: false,
                sourceRefTypes: ['git_commit', 'code_diff'],
                missingImpact: 'Submit a real commit from a pipe-assessment branch or fork before evaluation.',
              },
              {
                id: 'code_diff_source',
                label: 'Exact diff source',
                required: true,
                satisfied: false,
                sourceRefTypes: ['code_diff'],
                missingImpact: 'Capture the exact base..commit diff before scoring the solution.',
              },
            ],
            confidence: [
              {
                id: 'test_or_verification',
                label: 'Tests or verification note',
                required: false,
                satisfied: false,
                sourceRefTypes: ['test_run', 'verification_gap'],
                missingImpact: 'Capture test output or a source-backed missing-test note.',
              },
              {
                id: 'candidate_explanation',
                label: 'Candidate explanation',
                required: false,
                satisfied: false,
                sourceRefTypes: ['meeting_transcript_segment', 'room_chat_message'],
                missingImpact: 'Capture transcript or chat evidence.',
              },
            ],
          },
        }}
        workspaceReady
        onOpenSubmission={vi.fn()}
      />,
    );

    const proof = screen.getByTestId('assessment-task-brief-proof');
    const proofText = proof.textContent ?? '';
    expect(proofText).toContain('2 required items missing');
    expect(proofText).toContain('Assessment branch commit: Missing');
    expect(proofText).toContain('Exact diff source: Missing');
    expect(proofText).toContain('Tests or verification note: Not captured');
    expect(proofText).toContain('Candidate explanation: Not captured');
    expect(screen.queryByTestId('assessment-task-brief-submission')).toBeNull();
  });

  it('explains blocked AI prompts without counting them as agent help', () => {
    render(
      <AssessmentTaskBrief
        packet={packet}
        workspace={workspace}
        progress={{
          ...progress,
          hasAiInteraction: true,
          sourceRefCounts: [
            { kind: 'ai_user_prompt_blocked', count: 1 },
            { kind: 'test_run', count: 1 },
          ],
          readiness: undefined,
        }}
        workspaceReady
      />,
    );

    const proof = screen.getByTestId('assessment-task-brief-proof');
    expect(proof.textContent).toContain('AI-use transparency: Captured');
    expect(proof.textContent).toContain('A prompt was blocked or the bridge was unavailable; no agent response is counted as assistance.');
    expect(proof.textContent).not.toContain('Agent messages or responses are captured as assessment evidence.');
  });

  it('preserves precise AI transparency copy when server readiness is present', () => {
    render(
      <AssessmentTaskBrief
        packet={packet}
        workspace={workspace}
        progress={{
          ...progress,
          hasAiInteraction: true,
          sourceRefCounts: [
            { kind: 'ai_user_prompt_blocked', count: 1 },
            { kind: 'test_run', count: 1 },
          ],
          readiness: {
            ...progress.readiness!,
            confidence: [
              ...progress.readiness!.confidence,
              {
                id: 'ai_usage_transparency',
                label: 'AI-use transparency',
                required: false,
                satisfied: true,
                sourceRefTypes: ['ai_user_prompt_blocked'],
                missingImpact: 'If the candidate used AI, real prompts, blocked attempts, and agent responses should be captured honestly. Silence is not proof of no AI use.',
              },
            ],
          },
        }}
        workspaceReady
      />,
    );

    const proof = screen.getByTestId('assessment-task-brief-proof');
    expect(proof.textContent).toContain('AI-use transparency: Captured');
    expect(proof.textContent).toContain('1 blocked prompt captured.');
    expect(proof.textContent).toContain('no agent response is counted as assistance.');
    expect(proof.textContent).not.toContain('AI-use transparency: CapturedCaptured as source-backed assessment evidence.');
  });

  it('keeps evaluated workspace reports reachable even after the workspace stops', () => {
    render(
      <AssessmentTaskBrief
        packet={packet}
        workspace={workspace}
        progress={{
          ...progress,
          stage: 'EVALUATED',
          nextAction: 'REVIEW_EVALUATION',
          nextActionLabel: 'Review the source-backed assessment report.',
          hasTestEvidence: false,
          hasVerificationGap: true,
          evaluation: {
            status: 'EVALUATED',
            summary: 'Source-backed report is ready.',
            recommendation: 'strong_evidence_to_advance',
            createdAt: '2026-06-29T22:03:00.000Z',
          },
        }}
        workspaceReady={false}
        onOpenSubmission={vi.fn()}
      />,
    );

    const submission = screen.getByTestId('assessment-task-brief-submission');
    expect(submission.textContent).toContain('Assessment report ready');
    expect(submission.textContent).toContain('The recruiter can now review the source-backed report.');
    expect(submission.textContent).toContain('Commit');
    expect(submission.textContent).toContain('cccccccccc');
    expect(submission.textContent).toContain('Verification gap captured');
    expect(submission.textContent).not.toContain('strong_evidence_to_advance');
    expect(screen.getByTestId('assessment-brief-open-submission').textContent).toContain('Report Ready');
    expect(screen.getByTestId('assessment-brief-open-submission').textContent).not.toContain('Submit work');
  });

  it('shows evaluator diagnostics instead of hiding an unavailable AI evaluator state', () => {
    render(
      <AssessmentTaskBrief
        packet={packet}
        workspace={workspace}
        progress={{
          ...progress,
          stage: 'NEEDS_ATTENTION',
          nextAction: 'RESOLVE_DIAGNOSTIC',
          nextActionLabel: 'Resolve the blocking diagnostic before continuing.',
          evaluation: {
            status: 'AI_DEVELOPER_UNAVAILABLE',
            summary: 'Workers AI is not configured for source-backed repo-task evaluation.',
            recommendation: 'insufficient_evidence',
            createdAt: '2026-06-29T22:03:00.000Z',
            diagnostics: [
              {
                id: 'diagnostic-ai-unavailable',
                code: 'AI_DEVELOPER_UNAVAILABLE',
                severity: 'blocking',
                message: 'Workers AI is not configured for source-backed repo-task evaluation.',
                sourceRefCount: 1,
                sourceRefTypes: ['assessment_evaluation_request'],
              },
            ],
          },
        }}
        workspaceReady
      />,
    );

    const submission = screen.getByTestId('assessment-task-brief-submission');
    expect(submission.textContent).toContain('Evaluation needs attention');
    expect(submission.textContent).toContain('Workers AI is not configured for source-backed repo-task evaluation.');
    expect(submission.textContent).not.toContain('Assessment report ready');

    const diagnostics = screen.getByTestId('assessment-task-brief-diagnostics');
    expect(diagnostics.textContent).toContain('Evaluator cautions');
    expect(diagnostics.textContent).toContain('Blocking: AI Developer Unavailable');
    expect(diagnostics.textContent).toContain('Workers AI is not configured for source-backed repo-task evaluation.');
    expect(diagnostics.textContent).toContain('1 source ref: Assessment Evaluation Request');
    expect(diagnostics.textContent).not.toContain('diagnostic-ai-unavailable');
  });

  it('shows exactly which challenge packet fields are missing', () => {
    render(
      <AssessmentTaskBrief
        packet={{
          ...packet,
          exactText: [
            'Repo: https://github.com/pipe/source-backed-worker',
            'Base commit: dddddddddddddddddddddddddddddddddddddddd',
            'Task: Fix the source-backed worker retry path.',
            'Success: retry path is deterministic.',
          ].join('\n'),
        }}
        workspace={workspace}
        progress={{
          ...progress,
          stage: 'WAITING_FOR_CHALLENGE',
          nextAction: 'ASSIGN_CHALLENGE',
          nextActionLabel: 'Assign a complete open-source challenge packet.',
          challengePacketContract: {
            schemaVersion: 'challenge-packet-contract-v1',
            isComplete: false,
            missingFields: ['expected evidence'],
            hasRepositoryUrl: true,
            hasBaseCommitSha: true,
            hasTask: true,
            hasSuccessCriteria: true,
            hasExpectedEvidence: false,
          },
          readiness: {
            ...progress.readiness!,
            status: 'WAITING_FOR_CHALLENGE',
            label: 'Waiting for challenge',
            detail: 'Assign a concrete repo URL, base commit, task, success criteria, and expected evidence before candidate work starts.',
            isReadyForEvaluation: false,
            missingRequiredCount: 1,
            required: [
              {
                id: 'challenge_packet',
                label: 'Complete challenge packet',
                required: true,
                satisfied: false,
                sourceRefTypes: ['open_source_challenge_packet'],
                missingImpact: 'Challenge packet is missing expected evidence.',
              },
            ],
          },
        }}
        workspaceReady={false}
      />,
    );

    const warning = screen.getByTestId('assessment-task-brief-contract-warning');
    expect(warning.textContent).toContain('Task packet incomplete');
    expect(warning.textContent).toContain('Missing expected evidence');
    expect(screen.getByTestId('assessment-task-brief-proof').textContent).toContain('Complete challenge packet: Missing');
  });
});
