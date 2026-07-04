import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { InterviewCard } from './InterviewCard';
import type { ScheduledInterview } from '../../lib/scheduling/types';

const mocks = vi.hoisted(() => ({
  api: {
    post: vi.fn(),
  },
}));

vi.mock('../../hooks/useApiClient', () => ({
  useApiClient: () => mocks.api,
}));

function renderCard(
  interview: ScheduledInterview,
  options: {
    startAssessmentEvaluation?: (id: string) => Promise<{ report?: unknown | null; diagnostic?: { code?: string } | null } | void>;
  } = {},
): void {
  const optionalProps = options.startAssessmentEvaluation
    ? { startAssessmentEvaluation: options.startAssessmentEvaluation }
    : {};

  render(
    <MemoryRouter>
      <InterviewCard
        interview={interview}
        candidateName="Ada Lovelace"
        candidateEmail="ada@example.com"
        pipelineTitle="Principal Systems Engineer"
        stageTitle="Open-source assessment"
        updateStatus={vi.fn()}
        sendInvite={vi.fn()}
        {...optionalProps}
      />
    </MemoryRouter>,
  );
}

function reviewArtifactInterview(options: {
  id: string;
  commitUrl: string | null;
  sourceRefCounts: Array<{ kind: string; count: number }>;
}): ScheduledInterview {
  const commitSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  return {
    id: options.id,
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:20:00.000Z',
    status: 'INVITED',
    interviewType: 'OPEN_SOURCE_BUG_FIX',
    meetingType: 'DIRECT_VIDEO_CALL',
    scheduledAt: null,
    assessmentProgress: {
      session: {
        id: `assessment-session-${options.id}`,
        ingestionKey: `assessment-session:${options.id}`,
        interviewId: options.id,
        candidateId: 'candidate-1',
        workspaceId: 'workspace-1',
        workspacePersonId: null,
        applicationId: null,
        mode: 'OPEN_SOURCE_BUG_FIX',
        state: 'FINAL_SUBMITTED',
        createdAt: '2026-06-23T00:00:00.000Z',
        updatedAt: '2026-06-23T00:20:00.000Z',
      },
      stage: 'READY_FOR_EVALUATION',
      nextAction: 'START_EVALUATION',
      nextActionLabel: 'Start source-backed AI or human evaluation.',
      hasChallengePacket: true,
      hasWorkEvidence: true,
      hasMessageEvidence: false,
      hasDevContainerEvidence: true,
      hasToolUsageEvidence: true,
      hasCommitSubmission: true,
      hasFinalSubmission: false,
      hasAiInteraction: false,
      hasTranscriptEvidence: false,
      hasTestEvidence: false,
      evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
      sourceRefCounts: options.sourceRefCounts,
      challenge: null,
      latestEvent: {
        id: `assessment-event-${options.id}`,
        kind: 'commit_submission',
        sequence: 2,
        occurredAt: '2026-06-23T00:18:00.000Z',
      },
      commit: {
        eventId: `assessment-event-${options.id}`,
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/widgets',
        baseCommitSha: '3333333333333333333333333333333333333333',
        commitSha,
        commitUrl: options.commitUrl,
        submissionSource: 'live_workspace',
        submissionSourceLabel: 'Live workspace finalizer',
        changedFiles: [{ path: 'src/widget.ts', status: 'modified' }],
        occurredAt: '2026-06-23T00:18:00.000Z',
      },
      evaluation: null,
    },
  };
}

describe('InterviewCard assessment progress', () => {
  it('shows source-backed stage, next action, and evidence readiness without raw ids', () => {
    renderCard({
      id: 'interview-1',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'INVITED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      roomStatus: 'ACTIVE',
      guestWaiting: true,
      assessmentSetup: {
        status: 'reviewable_task_assigned',
        kind: 'github_pr',
        source: 'matched_repo_id',
        blocksPositiveAssessment: false,
        message: 'PIPE matched a reviewable open-source task.',
      },
      workspaceSession: {
        status: 'READY',
        errorMessage: null,
        expiresAt: '2026-06-23T01:00:00.000Z',
        updatedAt: '2026-06-23T00:10:00.000Z',
        repoGitUrl: 'https://github.com/open-source/widgets',
        baseCommitSha: '1111111111111111111111111111111111111111',
      },
      assessmentProgress: {
        session: {
          id: 'assessment-session-card',
          ingestionKey: 'assessment-session:card',
          interviewId: 'interview-1',
          candidateId: 'candidate-1',
          workspaceId: 'workspace-1',
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'FINAL_SUBMITTED',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:20:00.000Z',
        },
        stage: 'READY_FOR_EVALUATION',
        nextAction: 'START_EVALUATION',
        nextActionLabel: 'Start source-backed AI or human evaluation.',
        readiness: {
          status: 'READY_FOR_EVALUATION',
          label: 'Ready for evaluation',
          detail: 'Challenge, work evidence, and required source refs are captured; start source-backed AI or human evaluation.',
          isReadyForEvaluation: true,
          isUsableHiringSignal: false,
          missingRequiredCount: 0,
          required: [
            {
              id: 'challenge_packet',
              label: 'Complete challenge packet',
              required: true,
              satisfied: true,
              sourceRefTypes: ['review_challenge_packet'],
              missingImpact: 'Without a task packet, PIPE cannot prove what work was assigned.',
            },
            {
              id: 'assessment_commit',
              label: 'Assessment branch commit',
              required: true,
              satisfied: true,
              sourceRefTypes: ['git_commit'],
              missingImpact: 'A real commit hash is required before evaluation.',
            },
          ],
          confidence: [
            {
              id: 'workspace_captured_commit',
              label: 'Workspace-captured commit',
              required: false,
              satisfied: true,
              sourceRefTypes: ['git_commit', 'dev_container_workspace_state'],
              missingImpact: 'Manual commit evidence lowers trust.',
            },
          ],
        },
        hasChallengePacket: true,
        hasWorkEvidence: true,
        hasMessageEvidence: true,
        hasDevContainerEvidence: true,
        hasToolUsageEvidence: true,
        hasCommitSubmission: true,
        hasFinalSubmission: false,
        hasAiInteraction: true,
        hasTranscriptEvidence: true,
        hasTestEvidence: true,
        evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
        sourceRefCounts: [
          { kind: 'test_run', count: 1 },
          { kind: 'dev_container_workspace_launch', count: 1 },
          { kind: 'terminal_command', count: 1 },
          { kind: 'code_server_file_observation', count: 6 },
          { kind: 'room_chat_message', count: 1 },
          { kind: 'meeting_session_event', count: 2 },
        ],
        challenge: {
          sourceRefType: 'review_challenge_packet',
          sourceRefId: 'challenge-packet-card',
          evidenceRole: 'assigned_challenge',
          exactText: [
            'Repo: https://github.com/open-source/widgets',
            'Base commit: 1111111111111111111111111111111111111111',
            'Task: Fix the assessment card progress regression.',
            'Verification command: npm test -- card-progress',
            'Success criteria:',
            '- Card shows stage and next action',
            'Expected evidence:',
            '- Commit SHA on assessment branch',
          ].join('\n'),
          locator: {
            repositoryUrl: 'https://github.com/open-source/widgets',
            githubPrNumber: 72,
            baseCommitSha: '1111111111111111111111111111111111111111',
          },
        },
        latestEvent: {
          id: 'assessment-event-card',
          kind: 'commit_submission',
          sequence: 2,
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        commit: {
          eventId: 'assessment-event-card',
          repositoryUrl: 'https://github.com/open-source/widgets',
          forkRepositoryUrl: 'https://github.com/candidate/widgets',
          branchName: 'pipe-assessment/card-progress',
          baseCommitSha: '1111111111111111111111111111111111111111',
          commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
          commitUrl: 'https://github.com/candidate/widgets/commit/abcdef1234567890abcdef1234567890abcdef12',
          upstreamPullRequestUrl: 'https://github.com/open-source/widgets/pull/72',
          upstreamPrConsent: true,
          submissionSource: 'live_workspace',
          submissionSourceLabel: 'Live workspace finalizer',
          integrity: {
            status: 'workspace_captured',
            label: 'Workspace-captured commit',
            detail: 'Captured by the live dev-container finalizer from the workspace HEAD and exact source refs.',
            tone: 'verified',
          },
          challengeBinding: {
            status: 'bound_to_assigned_challenge',
            label: 'Bound to assigned challenge',
            detail: 'Commit repository and base commit match the assigned open-source challenge packet.',
            tone: 'verified',
          },
          changedFiles: [{ path: 'src/card.ts', status: 'modified' }],
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        evaluation: null,
      },
    });

    const card = screen.getByTestId('interview-card');
    expect(card).toHaveAttribute('data-interview-id', 'interview-1');
    expect(card).toHaveAttribute('data-interview-type', 'OPEN_SOURCE_BUG_FIX');
    expect(card).toHaveAttribute('data-candidate-email', 'ada@example.com');

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('ASSESSMENT');
    expect(progress).toHaveTextContent('Ready for evaluation');
    expect(progress).toHaveTextContent('ASSIGNMENT');
    expect(progress).toHaveTextContent('PIPE-matched challenge');
    expect(progress).toHaveTextContent('PIPE matched a reviewable open-source task.');
    expect(progress).toHaveTextContent('DECISION');
    expect(progress).toHaveTextContent('Challenge, work evidence, and required source refs are captured; start source-backed AI or human evaluation.');
    expect(progress).toHaveTextContent('challenge, chat, workspace telemetry, tool activity, commit, AI use, transcript, tests');
    expect(progress).toHaveTextContent('AI USE');
    expect(progress).toHaveTextContent('AI bridge trace captured');
    expect(progress).toHaveTextContent('source-backed evidence trail');
    expect(progress).toHaveTextContent('PROOF');
    expect(progress).toHaveTextContent('Required: Captured: Complete challenge packet · Captured: Assessment branch commit');
    expect(progress).toHaveTextContent('Confidence: Captured: Workspace-captured commit');
    expect(progress).toHaveTextContent('WORKSPACE');
    expect(progress).toHaveTextContent('Ready · open-source/widgets · base 111111111111');
    expect(progress).toHaveTextContent('ROOM');
    expect(progress).toHaveTextContent('Active · guest waiting');
    expect(progress).toHaveTextContent('CHAT');
    expect(progress).toHaveTextContent('Room chat captured');
    expect(progress).toHaveTextContent('1 room chat message and 2 room session events tied to the assessment evidence trail.');
    expect(progress).toHaveTextContent('PROCESS');
    expect(progress).toHaveTextContent('Workspace telemetry captured');
    expect(progress).toHaveTextContent('1 workspace launch, 1 terminal command, and 6 file observations tied to the assessment evidence trail.');
    expect(progress).toHaveTextContent('open-source/widgets');
    expect(progress).toHaveTextContent('PR #72');
    expect(progress).toHaveTextContent('BASE');
    expect(progress).toHaveTextContent('111111111111');
    expect(progress).toHaveTextContent('TASK');
    expect(progress).toHaveTextContent('Fix the assessment card progress regression.');
    expect(progress).toHaveTextContent('CRITERIA');
    expect(progress).toHaveTextContent('Card shows stage and next action');
    expect(progress).toHaveTextContent('VERIFY');
    expect(progress).toHaveTextContent('npm test -- card-progress');
    expect(progress).toHaveTextContent('EXPECTED');
    expect(progress).toHaveTextContent('Commit SHA on assessment branch');
    expect(progress).toHaveTextContent('abcdef123456');
    expect(progress).toHaveTextContent('UPSTREAM PR');
    expect(progress).toHaveTextContent('open-source/widgets/pull/72 · candidate-approved tracking');
    expect(progress).toHaveTextContent('REVIEW ARTIFACT');
    expect(progress).toHaveTextContent('GitHub commit available');
    expect(progress).toHaveTextContent('External commit URL is captured; open detail to compare base to submitted work.');
    expect(progress).toHaveTextContent('Workspace-captured commit');
    expect(progress).toHaveTextContent('COMMIT TRUST');
    expect(progress).toHaveTextContent('Workspace-captured commit · Bound to assigned challenge');
    expect(progress).toHaveTextContent('Captured by the live dev-container finalizer from the workspace HEAD and exact source refs.');
    expect(progress).toHaveTextContent('Commit repository and base commit match the assigned open-source challenge packet.');
    expect(progress).not.toHaveTextContent('assessment-session-card');
    expect(progress).not.toHaveTextContent('challenge-packet-card');
    expect(progress).not.toHaveTextContent('abcdef1234567890abcdef1234567890abcdef12');
  });

  it('keeps auto-match quality gate proof visible on recruiter list cards', () => {
    renderCard({
      id: 'interview-auto-match-proof',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'INVITED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      githubRepoUrl: 'https://github.com/mui/base-ui',
      githubPrNumber: 973,
      assessmentSetup: {
        status: 'reviewable_task_assigned',
        kind: 'github_pr',
        source: 'matched_repo_id',
        blocksPositiveAssessment: false,
        message: 'PIPE found a source-backed candidate challenge at https://github.com/mui/base-ui #973. It passed the auto-assignment quality gate. Assessment quality: USABLE 9/12. It leads the next comparable challenge by 2%.',
        nextAction: 'OPEN_ROOM_OR_WORKSPACE',
        nextActionLabel: 'Review the latest match run and open the assessment room.',
      },
      assessmentProgress: null,
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('PIPE-matched challenge');
    expect(progress).toHaveTextContent('https://github.com/mui/base-ui #973');
    expect(progress).toHaveTextContent('auto-assignment quality gate');
    expect(progress).toHaveTextContent('Assessment quality: USABLE 9/12');
    expect(progress).toHaveTextContent('leads the next comparable challenge by 2%');
    expect(progress).toHaveTextContent('Review the latest match run and open the assessment room.');
    expect(progress).not.toHaveTextContent('assessment-session');
    expect(progress).not.toHaveTextContent('match_run_');
  });

  it('shows workspace-only captured diffs as recruiter-reviewable artifacts', () => {
    renderCard(reviewArtifactInterview({
      id: 'interview-captured-diff-artifact',
      commitUrl: null,
      sourceRefCounts: [
        { kind: 'git_commit', count: 1 },
        { kind: 'code_diff', count: 1 },
      ],
    }));

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('REVIEW ARTIFACT');
    expect(progress).toHaveTextContent('Captured diff available');
    expect(progress).toHaveTextContent('Workspace-only commit has exact code_diff source evidence ready for review.');
    expect(progress).not.toHaveTextContent('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('warns when a submitted commit has no recruiter-reviewable artifact proof', () => {
    renderCard(reviewArtifactInterview({
      id: 'interview-missing-review-artifact',
      commitUrl: null,
      sourceRefCounts: [{ kind: 'git_commit', count: 1 }],
    }));

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('REVIEW ARTIFACT');
    expect(progress).toHaveTextContent('Review artifact missing');
    expect(progress).toHaveTextContent('Commit exists, but PIPE has no remote commit URL or captured code_diff source evidence.');
    expect(progress).not.toHaveTextContent('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('shows the assigned open-source task before candidate work starts', () => {
    renderCard({
      id: 'interview-setup-task',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      title: 'Fix reconnect ordering in the event stream',
      description: 'Candidate must isolate the reconnect ordering bug, commit a focused fix, and submit source-backed evidence.',
      status: 'INVITED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      githubRepoUrl: 'https://github.com/open-source/streaming',
      assessmentSetup: {
        status: 'reviewable_task_assigned',
        kind: 'manual_open_source_task',
        source: 'recruiter_manual_override',
        blocksPositiveAssessment: false,
        message: 'A concrete open-source task packet was assigned by the recruiter.',
      },
      assessmentProgress: {
        session: {
          id: 'assessment-session-setup',
          ingestionKey: 'assessment-session:setup',
          interviewId: 'interview-setup-task',
          candidateId: null,
          workspaceId: null,
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'CHALLENGE_ASSIGNED',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:20:00.000Z',
        },
        stage: 'CHALLENGE_READY',
        nextAction: 'OPEN_ROOM_OR_WORKSPACE',
        nextActionLabel: 'Open the room and launch the controlled workspace.',
        hasChallengePacket: true,
        hasWorkEvidence: false,
        hasMessageEvidence: false,
        hasDevContainerEvidence: false,
        hasToolUsageEvidence: false,
        hasCommitSubmission: false,
        hasFinalSubmission: false,
        hasAiInteraction: false,
        hasTranscriptEvidence: false,
        hasTestEvidence: false,
        evidenceCounts: [{ kind: 'recruiter_note', count: 1 }],
        sourceRefCounts: [{ kind: 'open_source_challenge_packet', count: 1 }],
        challenge: {
          sourceRefType: 'open_source_challenge_packet',
          sourceRefId: 'challenge-packet-setup',
          evidenceRole: 'assigned_challenge',
          exactText: [
            'Repo: https://github.com/open-source/streaming',
            'Base commit: 2222222222222222222222222222222222222222',
            'Task: Fix reconnect ordering in the event stream.',
            'Success criteria:',
            '- Reconnect keeps event order deterministic',
            'Expected evidence:',
            '- Commit SHA on assessment branch',
          ].join('\n'),
          locator: {
            repositoryUrl: 'https://github.com/open-source/streaming',
            baseCommitSha: '2222222222222222222222222222222222222222',
          },
        },
        latestEvent: {
          id: 'assessment-event-setup',
          kind: 'recruiter_note',
          sequence: 1,
          occurredAt: '2026-06-23T00:20:00.000Z',
        },
        commit: null,
        evaluation: null,
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(screen.getByText('Fix reconnect ordering in the event stream')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText(/Candidate must isolate the reconnect ordering bug/)).toBeInTheDocument();
    expect(progress).toHaveTextContent('Challenge ready');
    expect(progress).toHaveTextContent('ASSIGNMENT');
    expect(progress).toHaveTextContent('Manual task assignment');
    expect(progress).toHaveTextContent('A concrete open-source task packet was assigned by the recruiter.');
    expect(progress).toHaveTextContent('Task assigned');
    expect(progress).toHaveTextContent('Waiting for candidate workspace evidence and assessment-branch commit.');
    expect(progress).toHaveTextContent('Open the room and launch the controlled workspace.');
    expect(progress).toHaveTextContent('challenge');
    expect(progress).toHaveTextContent('REPO');
    expect(progress).toHaveTextContent('open-source/streaming');
    expect(progress).toHaveTextContent('BASE');
    expect(progress).toHaveTextContent('222222222222');
    expect(progress).toHaveTextContent('TASK');
    expect(progress).toHaveTextContent('Fix reconnect ordering in the event stream.');
    expect(progress).toHaveTextContent('CRITERIA');
    expect(progress).toHaveTextContent('Reconnect keeps event order deterministic');
    expect(progress).toHaveTextContent('EXPECTED');
    expect(progress).toHaveTextContent('Commit SHA on assessment branch');
    expect(progress).not.toHaveTextContent('challenge-packet-setup');
    expect(progress).not.toHaveTextContent('assessment-session-setup');
  });

  it('shows fallback evaluation as human-review-required instead of a pass signal', () => {
    renderCard({
      id: 'interview-fallback-evaluation',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:22:00.000Z',
      status: 'COMPLETED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      assessmentProgress: {
        session: {
          id: 'assessment-session-fallback-card',
          ingestionKey: 'assessment-session:fallback-card',
          interviewId: 'interview-fallback-evaluation',
          candidateId: 'candidate-1',
          workspaceId: 'workspace-1',
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'EVALUATED',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:22:00.000Z',
        },
        stage: 'EVALUATED',
        nextAction: 'REVIEW_EVALUATION',
        nextActionLabel: 'Review the assessment report and evidence.',
        hasChallengePacket: true,
        hasWorkEvidence: true,
        hasMessageEvidence: false,
        hasDevContainerEvidence: true,
        hasToolUsageEvidence: true,
        hasCommitSubmission: true,
        hasFinalSubmission: true,
        hasAiInteraction: true,
        hasTranscriptEvidence: false,
        hasTestEvidence: true,
        evidenceCounts: [
          { kind: 'ai_interaction', count: 1 },
          { kind: 'commit_submission', count: 1 },
        ],
        sourceRefCounts: [
          { kind: 'open_source_challenge_packet', count: 1 },
          { kind: 'git_commit', count: 1 },
          { kind: 'code_diff', count: 1 },
        ],
        challenge: {
          sourceRefType: 'open_source_challenge_packet',
          sourceRefId: 'challenge-packet-fallback-card',
          evidenceRole: 'assigned_challenge',
          exactText: 'Task: Fix Base UI popover impatient click handling.',
          locator: { repositoryUrl: 'https://github.com/mui/base-ui' },
        },
        latestEvent: {
          id: 'assessment-event-fallback-card',
          kind: 'commit_submission',
          sequence: 2,
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        commit: {
          eventId: 'assessment-event-fallback-card',
          repositoryUrl: 'https://github.com/mui/base-ui',
          forkRepositoryUrl: 'https://github.com/candidate/base-ui',
          branchName: 'pipe-assessment',
          baseCommitSha: '1111111111111111111111111111111111111111',
          commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
          commitUrl: 'https://github.com/candidate/base-ui/commit/abcdef1234567890abcdef1234567890abcdef12',
          changedFiles: [{ path: 'packages/react/src/popover/root/usePopoverRoot.ts', status: 'modified' }],
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        evaluation: {
          id: 'assessment-report-fallback-card',
          status: 'EVALUATED',
          summary: 'PIPE produced a conservative source-backed assessment report from captured evidence.',
          recommendation: 'mixed_evidence_human_review',
          createdAt: '2026-06-23T00:22:00.000Z',
          evidenceCoverage: null,
          claims: [{
            id: 'claim-source-contract',
            polarity: 'positive',
            dimension: 'source_provenance',
            narrative: 'The assessment has a complete source-backed challenge packet, submitted commit, and exact code diff for review.',
            confidence: 0.82,
            sourceRefCount: 3,
            sourceRefTypes: ['open_source_challenge_packet', 'git_commit', 'code_diff'],
          }],
          diagnostics: [
            {
              id: 'diagnostic-model-unusable',
              code: 'MODEL_CLAIMS_UNUSABLE',
              severity: 'warning',
              message: 'The AI evaluator did not return usable non-diagnostic claims, so PIPE generated conservative claims only from captured source evidence.',
              sourceRefCount: 1,
              sourceRefTypes: ['assessment_evaluation_request'],
            },
            {
              id: 'diagnostic-human-review',
              code: 'HUMAN_CORRECTNESS_REVIEW_REQUIRED',
              severity: 'warning',
              message: 'A human reviewer should inspect the diff before treating the commit as proven upstream-correct.',
              sourceRefCount: 1,
              sourceRefTypes: ['code_diff'],
            },
          ],
        },
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('Human review required');
    expect(progress).toHaveTextContent('Inspect the diff before deciding.');
    expect(progress).toHaveTextContent('CAUTION');
    expect(progress).toHaveTextContent('2 evaluator cautions');
    expect(progress).toHaveTextContent('Model claims unusable');
    expect(progress).toHaveTextContent('Human correctness review required');
    expect(progress).not.toHaveTextContent('Strong evidence to advance');
  });

  it('warns recruiters when an assigned challenge packet is incomplete', () => {
    renderCard({
      id: 'interview-incomplete-packet',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'INVITED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      githubRepoUrl: 'https://github.com/open-source/streaming',
      assessmentSetup: {
        status: 'reviewable_task_assigned',
        kind: 'manual_open_source_task',
        source: 'recruiter_manual_override',
        blocksPositiveAssessment: false,
        message: 'A concrete open-source task packet was started by the recruiter.',
      },
      assessmentProgress: {
        session: {
          id: 'assessment-session-incomplete-packet',
          ingestionKey: 'assessment-session:incomplete-packet',
          interviewId: 'interview-incomplete-packet',
          candidateId: null,
          workspaceId: null,
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'CHALLENGE_ASSIGNED',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:20:00.000Z',
        },
        stage: 'WAITING_FOR_CHALLENGE',
        nextAction: 'ASSIGN_CHALLENGE',
        nextActionLabel: 'Add success criteria and expected evidence before the candidate starts.',
        readiness: {
          status: 'WAITING_FOR_CHALLENGE',
          label: 'Waiting for complete challenge packet',
          detail: 'The assigned open-source task is missing required packet fields.',
          isReadyForEvaluation: false,
          isUsableHiringSignal: false,
          missingRequiredCount: 1,
          required: [
            {
              id: 'challenge_packet',
              label: 'Complete challenge packet',
              required: true,
              satisfied: false,
              sourceRefTypes: ['open_source_challenge_packet'],
              missingImpact: 'Challenge packet is missing success criteria and expected evidence.',
            },
          ],
          confidence: [],
        },
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
        hasChallengePacket: true,
        hasWorkEvidence: false,
        hasMessageEvidence: false,
        hasDevContainerEvidence: false,
        hasToolUsageEvidence: false,
        hasCommitSubmission: false,
        hasFinalSubmission: false,
        hasAiInteraction: false,
        hasTranscriptEvidence: false,
        hasTestEvidence: false,
        evidenceCounts: [{ kind: 'recruiter_note', count: 1 }],
        sourceRefCounts: [{ kind: 'open_source_challenge_packet', count: 1 }],
        challenge: {
          sourceRefType: 'open_source_challenge_packet',
          sourceRefId: 'challenge-packet-incomplete',
          evidenceRole: 'assigned_challenge',
          exactText: [
            'Repo: https://github.com/open-source/streaming',
            'Base commit: 2222222222222222222222222222222222222222',
            'Task: Fix reconnect ordering in the event stream.',
          ].join('\n'),
          locator: {
            repositoryUrl: 'https://github.com/open-source/streaming',
            baseCommitSha: '2222222222222222222222222222222222222222',
          },
        },
        latestEvent: {
          id: 'assessment-event-incomplete-packet',
          kind: 'recruiter_note',
          sequence: 1,
          occurredAt: '2026-06-23T00:20:00.000Z',
        },
        commit: null,
        evaluation: null,
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('Waiting for complete challenge packet');
    expect(progress).toHaveTextContent('PROOF');
    expect(progress).toHaveTextContent('Required: Missing: Complete challenge packet');
    expect(progress).toHaveTextContent('PACKET');
    expect(progress).toHaveTextContent('Incomplete challenge packet');
    expect(progress).toHaveTextContent('Missing Success criteria, Expected evidence.');
    expect(progress).toHaveTextContent('Complete the packet before candidate work starts.');
    expect(progress).toHaveTextContent('Add success criteria and expected evidence before the candidate starts.');
    expect(progress).not.toHaveTextContent('challenge-packet-incomplete');
    expect(progress).not.toHaveTextContent('assessment-session-incomplete-packet');
  });

  it('falls back to durable progress trust when setup projection is missing', () => {
    renderCard({
      id: 'interview-progress-trust',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'INVITED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      assessmentSetup: null,
      assessmentProgress: {
        session: {
          id: 'assessment-session-progress-trust',
          ingestionKey: 'assessment-session:progress-trust',
          interviewId: 'interview-progress-trust',
          candidateId: null,
          workspaceId: null,
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'IN_PROGRESS',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:20:00.000Z',
        },
        stage: 'CHALLENGE_READY',
        nextAction: 'OPEN_ROOM_OR_WORKSPACE',
        nextActionLabel: 'Open the assessment room and start the workspace.',
        assignmentTrust: {
          state: 'matched_challenge',
          label: 'PIPE-matched challenge',
          detail: 'PIPE selected this task from source-backed candidate evidence, role context, and repository demand.',
          tone: 'matched',
        },
        hasChallengePacket: true,
        hasWorkEvidence: false,
        hasMessageEvidence: false,
        hasDevContainerEvidence: false,
        hasToolUsageEvidence: false,
        hasCommitSubmission: false,
        hasFinalSubmission: false,
        hasAiInteraction: false,
        hasTranscriptEvidence: false,
        hasTestEvidence: false,
        evidenceCounts: [{ kind: 'match_decision', count: 1 }],
        sourceRefCounts: [{ kind: 'review_challenge_packet', count: 1 }],
        challenge: {
          sourceRefType: 'review_challenge_packet',
          sourceRefId: 'challenge-packet-progress-trust',
          evidenceRole: 'assigned_challenge',
          exactText: null,
          locator: {
            repositoryUrl: 'https://github.com/open-source/widgets',
            githubPrNumber: 321,
            matchedRepoId: 42,
            baseCommitSha: '4444444444444444444444444444444444444444',
          },
          summary: {
            repositoryUrl: 'https://github.com/open-source/widgets',
            githubPrNumber: 321,
            baseCommitSha: '4444444444444444444444444444444444444444',
            task: 'Fix the matched assignment fallback.',
            assessmentFit: [
              'focused review calibrated for senior candidates.',
              '45 minute target from deterministic engineering prior.',
            ],
            matchProof: [
              'Review packet quality 91% from source-backed repo analysis.',
              '2 source-backed repo demands in the selected PR packet.',
            ],
            successCriteria: [],
            expectedEvidence: [],
          },
        },
        latestEvent: {
          id: 'assessment-event-progress-trust',
          kind: 'match_decision',
          sequence: 1,
          occurredAt: '2026-06-23T00:20:00.000Z',
        },
        commit: null,
        evaluation: null,
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('ASSIGNMENT');
    expect(progress).toHaveTextContent('PIPE-matched challenge');
    expect(progress).toHaveTextContent(
      'PIPE selected this task from source-backed candidate evidence, role context, and repository demand.',
    );
    expect(progress).toHaveTextContent('MATCH PROOF');
    expect(progress).toHaveTextContent('Review packet quality 91% from source-backed repo analysis.');
    expect(progress).toHaveTextContent('2 source-backed repo demands in the selected PR packet.');
    expect(progress).toHaveTextContent('FIT');
    expect(progress).toHaveTextContent('focused review calibrated for senior candidates.');
    expect(progress).toHaveTextContent('45 minute target from deterministic engineering prior.');
    expect(progress).toHaveTextContent('PR #321');
    expect(progress).not.toHaveTextContent('challenge-packet-progress-trust');
    expect(progress).not.toHaveTextContent('assessment-session-progress-trust');
  });

  it('shows setup gaps for assessment interviews before a session exists', () => {
    renderCard({
      id: 'interview-2',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'INVITED',
      interviewType: 'DEV_CONTAINER_CHALLENGE',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      assessmentSetup: {
        status: 'waiting_for_candidate_evidence',
        kind: 'auto_match',
        source: 'contact_first_invite',
        blocksPositiveAssessment: true,
        message: 'PIPE must ingest source-backed evidence before selecting a PR task.',
        nextAction: 'COLLECT_CANDIDATE_EVIDENCE',
        nextActionLabel: 'Send the intake link or schedule a context call.',
      },
      assessmentProgress: null,
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('Setup gap');
    expect(progress).toHaveTextContent('Waiting for PIPE match');
    expect(progress).toHaveTextContent('PIPE must ingest source-backed evidence before selecting a PR task.');
    expect(progress).toHaveTextContent('Send the intake link or schedule a context call.');
    expect(progress).toHaveTextContent('no assessment session yet');
  });

  it('starts source-backed evaluation from a ready assessment card', async () => {
    const startAssessmentEvaluation = vi.fn().mockResolvedValue({
      diagnostic: {
        code: 'WORKERS_AI_UNAVAILABLE',
      },
    });

    renderCard({
      id: 'interview-ready-evaluate',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'INVITED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      assessmentSetup: {
        status: 'reviewable_task_assigned',
        kind: 'manual_open_source_task',
        source: 'recruiter_manual_override',
        blocksPositiveAssessment: false,
        message: 'A concrete open-source task packet was assigned by the recruiter.',
      },
      assessmentProgress: {
        session: {
          id: 'assessment-session-ready',
          ingestionKey: 'assessment-session:ready',
          interviewId: 'interview-ready-evaluate',
          candidateId: 'candidate-1',
          workspaceId: 'workspace-1',
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'FINAL_SUBMITTED',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:20:00.000Z',
        },
        stage: 'READY_FOR_EVALUATION',
        nextAction: 'START_EVALUATION',
        nextActionLabel: 'Start source-backed AI or human evaluation.',
        hasChallengePacket: true,
        hasWorkEvidence: true,
        hasMessageEvidence: true,
        hasDevContainerEvidence: true,
        hasToolUsageEvidence: true,
        hasCommitSubmission: true,
        hasFinalSubmission: true,
        hasAiInteraction: true,
        hasTranscriptEvidence: false,
        hasTestEvidence: true,
        evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
        sourceRefCounts: [{ kind: 'test_run', count: 1 }],
        challenge: null,
        latestEvent: {
          id: 'assessment-event-ready',
          kind: 'final_submission',
          sequence: 4,
          occurredAt: '2026-06-23T00:20:00.000Z',
        },
        commit: {
          eventId: 'assessment-event-ready',
          repositoryUrl: 'https://github.com/open-source/widgets',
          forkRepositoryUrl: 'https://github.com/candidate/widgets',
          branchName: 'pipe-assessment/widgets',
          baseCommitSha: '3333333333333333333333333333333333333333',
          commitSha: '123456abcdef123456abcdef123456abcdef1234',
          commitUrl: 'https://github.com/candidate/widgets/commit/123456abcdef123456abcdef123456abcdef1234',
          upstreamPullRequestUrl: 'https://github.com/open-source/widgets/pull/42',
          upstreamPrConsent: true,
          changedFiles: [{ path: 'src/widget.ts', status: 'modified' }],
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        evaluation: null,
      },
    }, { startAssessmentEvaluation });

    fireEvent.click(screen.getByRole('button', { name: /evaluate/i }));

    await waitFor(() => {
      expect(startAssessmentEvaluation).toHaveBeenCalledWith('interview-ready-evaluate');
    });
    expect(screen.getByTestId('interview-card-assessment-progress')).toHaveTextContent(
      'Evaluation needs attention: Workers AI unavailable.',
    );
  });

  it('surfaces verification gaps in the recruiter evidence summary', () => {
    renderCard({
      id: 'interview-verification-gap',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'INVITED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      assessmentSetup: {
        status: 'reviewable_task_assigned',
        kind: 'manual_open_source_task',
        source: 'recruiter_manual_override',
        blocksPositiveAssessment: false,
        message: 'A concrete open-source task packet was assigned by the recruiter.',
      },
      assessmentProgress: {
        session: {
          id: 'assessment-session-verification-gap',
          ingestionKey: 'assessment-session:verification-gap',
          interviewId: 'interview-verification-gap',
          candidateId: 'candidate-1',
          workspaceId: 'workspace-1',
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'FINAL_SUBMITTED',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:20:00.000Z',
        },
        stage: 'READY_FOR_EVALUATION',
        nextAction: 'START_EVALUATION',
        nextActionLabel: 'Start source-backed AI or human evaluation.',
        readiness: {
          status: 'READY_FOR_EVALUATION',
          label: 'Ready for evaluation',
          detail: 'Required evidence is captured, but commit provenance needs repository or workspace verification before final reliance.',
          isReadyForEvaluation: true,
          isUsableHiringSignal: false,
          missingRequiredCount: 0,
          required: [],
          confidence: [
            {
              id: 'test_run',
              label: 'Test or verification evidence',
              required: false,
              satisfied: true,
              sourceRefTypes: ['test_run', 'verification_gap'],
              missingImpact: 'Missing test evidence lowers confidence; an explicit verification gap is better than silence.',
            },
          ],
        },
        hasChallengePacket: true,
        hasWorkEvidence: true,
        hasMessageEvidence: false,
        hasDevContainerEvidence: true,
        hasToolUsageEvidence: true,
        hasCommitSubmission: true,
        hasFinalSubmission: false,
        hasAiInteraction: false,
        hasTranscriptEvidence: false,
        hasTestEvidence: false,
        hasVerificationGap: true,
        evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
        sourceRefCounts: [
          { kind: 'git_commit', count: 1 },
          { kind: 'code_diff', count: 1 },
          { kind: 'verification_gap', count: 1 },
        ],
        challenge: null,
        latestEvent: {
          id: 'assessment-event-verification-gap',
          kind: 'commit_submission',
          sequence: 2,
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        commit: {
          eventId: 'assessment-event-verification-gap',
          repositoryUrl: 'https://github.com/open-source/widgets',
          forkRepositoryUrl: 'https://github.com/candidate/widgets',
          branchName: 'pipe-assessment/widgets',
          baseCommitSha: '3333333333333333333333333333333333333333',
          commitSha: '123456abcdef123456abcdef123456abcdef1234',
          commitUrl: 'https://github.com/candidate/widgets/commit/123456abcdef123456abcdef123456abcdef1234',
          upstreamPullRequestUrl: 'https://github.com/open-source/widgets/pull/42',
          upstreamPrConsent: true,
          changedFiles: [{ path: 'src/widget.ts', status: 'modified' }],
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        evaluation: null,
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('workspace telemetry, tool activity, commit, verification gap');
    expect(progress).not.toHaveTextContent('tests');
    expect(progress).not.toHaveTextContent('assessment-session-verification-gap');
    expect(progress).not.toHaveTextContent('assessment-event-verification-gap');
  });

  it('distinguishes blocked AI prompts from real agent assistance on recruiter cards', () => {
    renderCard({
      id: 'interview-blocked-ai-prompt',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'INVITED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      assessmentProgress: {
        session: {
          id: 'assessment-session-blocked-ai',
          ingestionKey: 'assessment-session:blocked-ai',
          interviewId: 'interview-blocked-ai-prompt',
          candidateId: 'candidate-1',
          workspaceId: 'workspace-1',
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'IN_PROGRESS',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:20:00.000Z',
        },
        stage: 'WORK_IN_PROGRESS',
        nextAction: 'SUBMIT_COMMIT',
        nextActionLabel: 'Submit a real assessment branch commit.',
        hasChallengePacket: true,
        hasWorkEvidence: true,
        hasMessageEvidence: true,
        hasDevContainerEvidence: true,
        hasToolUsageEvidence: true,
        hasCommitSubmission: false,
        hasFinalSubmission: false,
        hasAiInteraction: true,
        hasTranscriptEvidence: false,
        hasTestEvidence: false,
        evidenceCounts: [{ kind: 'ai_prompt_blocked', count: 1 }],
        sourceRefCounts: [
          { kind: 'open_source_challenge_packet', count: 1 },
          { kind: 'ai_user_prompt_blocked', count: 1 },
        ],
        challenge: null,
        latestEvent: {
          id: 'assessment-event-blocked-ai',
          kind: 'ai_prompt_blocked',
          sequence: 3,
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        commit: null,
        evaluation: null,
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('AI USE');
    expect(progress).toHaveTextContent('AI prompt blocked');
    expect(progress).toHaveTextContent('no agent response is counted as assistance');
    expect(progress).not.toHaveTextContent('AI response captured');
    expect(progress).not.toHaveTextContent('assessment-session-blocked-ai');
    expect(progress).not.toHaveTextContent('assessment-event-blocked-ai');
  });

  it('shows real AI agent responses separately from generic traces on recruiter cards', () => {
    renderCard({
      id: 'interview-ai-response',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'INVITED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      assessmentProgress: {
        session: {
          id: 'assessment-session-ai-response',
          ingestionKey: 'assessment-session:ai-response',
          interviewId: 'interview-ai-response',
          candidateId: 'candidate-1',
          workspaceId: 'workspace-1',
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'IN_PROGRESS',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:20:00.000Z',
        },
        stage: 'WORK_IN_PROGRESS',
        nextAction: 'SUBMIT_COMMIT',
        nextActionLabel: 'Submit a real assessment branch commit.',
        hasChallengePacket: true,
        hasWorkEvidence: true,
        hasMessageEvidence: true,
        hasDevContainerEvidence: true,
        hasToolUsageEvidence: true,
        hasCommitSubmission: false,
        hasFinalSubmission: false,
        hasAiInteraction: true,
        hasTranscriptEvidence: false,
        hasTestEvidence: false,
        evidenceCounts: [
          { kind: 'ai_user_prompt', count: 2 },
          { kind: 'ai_agent_response', count: 1 },
        ],
        sourceRefCounts: [
          { kind: 'open_source_challenge_packet', count: 1 },
          { kind: 'ai_user_prompt', count: 2 },
          { kind: 'ai_agent_response', count: 1 },
        ],
        challenge: null,
        latestEvent: {
          id: 'assessment-event-ai-response',
          kind: 'ai_agent_response',
          sequence: 4,
          occurredAt: '2026-06-23T00:19:00.000Z',
        },
        commit: null,
        evaluation: null,
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('AI USE');
    expect(progress).toHaveTextContent('AI response captured');
    expect(progress).toHaveTextContent('2 prompts and 1 agent response captured from the real agent bridge.');
    expect(progress).not.toHaveTextContent('AI bridge trace captured');
    expect(progress).not.toHaveTextContent('assessment-session-ai-response');
    expect(progress).not.toHaveTextContent('assessment-event-ai-response');
  });

  it('shows sourced evaluator claims, coverage gaps, and diagnostics without source-less praise or ids', () => {
    renderCard({
      id: 'interview-evaluation-proof',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'COMPLETED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      assessmentSetup: {
        status: 'reviewable_task_assigned',
        kind: 'manual_open_source_task',
        source: 'recruiter_manual_override',
        blocksPositiveAssessment: false,
        message: 'A concrete open-source task packet was assigned by the recruiter.',
      },
      assessmentProgress: {
        session: {
          id: 'assessment-session-proof-secret',
          ingestionKey: 'assessment-session:proof',
          interviewId: 'interview-evaluation-proof',
          candidateId: 'candidate-1',
          workspaceId: 'workspace-1',
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'EVALUATED',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:20:00.000Z',
        },
        stage: 'EVALUATED',
        nextAction: 'REVIEW_EVALUATION',
        nextActionLabel: 'Review the source-backed evaluator report.',
        hasChallengePacket: true,
        hasWorkEvidence: true,
        hasMessageEvidence: true,
        hasDevContainerEvidence: true,
        hasToolUsageEvidence: true,
        hasCommitSubmission: true,
        hasFinalSubmission: true,
        hasAiInteraction: true,
        hasTranscriptEvidence: true,
        hasTestEvidence: false,
        hasVerificationGap: true,
        evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
        sourceRefCounts: [{ kind: 'git_commit', count: 1 }],
        challenge: null,
        latestEvent: {
          id: 'assessment-event-proof-secret',
          kind: 'final_submission',
          sequence: 4,
          occurredAt: '2026-06-23T00:20:00.000Z',
        },
        commit: {
          eventId: 'assessment-event-proof-secret',
          repositoryUrl: 'https://github.com/open-source/widgets',
          forkRepositoryUrl: 'https://github.com/candidate/widgets',
          branchName: 'pipe-assessment/widgets',
          baseCommitSha: '3333333333333333333333333333333333333333',
          commitSha: '123456abcdef123456abcdef123456abcdef1234',
          commitUrl: 'https://github.com/candidate/widgets/commit/123456abcdef123456abcdef123456abcdef1234',
          upstreamPullRequestUrl: 'https://github.com/open-source/widgets/pull/42',
          upstreamPrConsent: true,
          changedFiles: [{ path: 'src/widget.ts', status: 'modified' }],
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        evaluation: {
          id: 'assessment-evaluation-proof-secret',
          status: 'EVALUATED',
          summary: 'Candidate produced a focused source-backed fix with commit evidence.',
          recommendation: 'mixed_evidence_human_review',
          createdAt: '2026-06-23T00:22:00.000Z',
          evidenceCoverage: {
            schemaVersion: 'assessment-evidence-coverage-v1',
            sourceRefCount: 2,
            sourceRefTypeCounts: {
              git_commit: 1,
              code_diff: 1,
            },
            requiredForEvaluation: [
              {
                label: 'Assessment branch commit',
                required: true,
                sourceRefTypes: ['git_commit'],
                satisfied: true,
                sourceRefKeys: ['commit_submission:git_commit:commit-proof-secret'],
                missingImpact: 'A real commit hash is required before evaluation.',
              },
              {
                label: 'Test or verification evidence',
                required: true,
                sourceRefTypes: ['test_run'],
                satisfied: false,
                sourceRefKeys: [],
                missingImpact: 'Without test output, the evaluator can discuss the diff but cannot prove it works.',
              },
            ],
            expectedForHighConfidence: [
              {
                label: 'Transcript explanation',
                required: false,
                sourceRefTypes: ['transcript_span'],
                satisfied: false,
                sourceRefKeys: [],
                missingImpact: 'Missing explanation evidence lowers confidence in the candidate reasoning assessment.',
              },
            ],
          },
          claims: [
            {
              id: 'assessment-claim-cited-secret',
              polarity: 'positive',
              dimension: 'repo_understanding',
              narrative: 'The candidate isolated the regression to the widget loader and changed only the relevant file.',
              confidence: 0.82,
              sourceRefCount: 4,
              sourceRefTypes: ['ai_user_prompt_blocked', 'ai_agent_response', 'ai_agent_diagnostic', 'agent_status'],
            },
            {
              id: 'assessment-claim-uncited-secret',
              polarity: 'positive',
              dimension: 'seniority',
              narrative: 'This source-less praise must not appear in the recruiter card.',
              confidence: 0.9,
              sourceRefCount: 0,
              sourceRefTypes: [],
            },
          ],
          diagnostics: [{
            id: 'assessment-diagnostic-proof-secret',
            code: 'TEST_OUTPUT_MISSING',
            severity: 'warning',
            message: 'The final submission did not include captured test output.',
            sourceRefCount: 1,
            sourceRefTypes: ['verification_gap'],
          }],
        },
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('Human review required');
    expect(progress).toHaveTextContent('Inspect the diff before deciding.');
    expect(progress).not.toHaveTextContent('mixed_evidence_human_review');
    expect(progress).toHaveTextContent('CLAIMS');
    expect(progress).toHaveTextContent('Repo understanding · Positive · 82%');
    expect(progress).toHaveTextContent('The candidate isolated the regression to the widget loader');
    expect(progress).toHaveTextContent('4 source refs: Blocked AI prompt, Agent response, Agent diagnostic +');
    expect(progress).toHaveTextContent('UPSTREAM PR');
    expect(progress).toHaveTextContent('open-source/widgets/pull/42 · candidate-approved tracking');
    expect(progress).toHaveTextContent('GAPS');
    expect(progress).toHaveTextContent('Missing: Test or verification evidence');
    expect(progress).toHaveTextContent('Missing: Transcript explanation');
    expect(progress).toHaveTextContent('DIAGNOSTICS');
    expect(progress).toHaveTextContent('Test output missing · Warning');
    expect(progress).toHaveTextContent('1 source ref: Verification gap');
    expect(progress).not.toHaveTextContent('source-less praise');
    expect(progress).not.toHaveTextContent('assessment-evaluation-proof-secret');
    expect(progress).not.toHaveTextContent('assessment-claim-cited-secret');
    expect(progress).not.toHaveTextContent('assessment-diagnostic-proof-secret');
  });

  it('summarizes missing high-confidence signals on evaluated open-source assessment cards', () => {
    renderCard({
      id: 'interview-evaluation-limitations',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:22:00.000Z',
      status: 'COMPLETED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      assessmentProgress: {
        session: {
          id: 'assessment-session-limitations-secret',
          ingestionKey: 'assessment-session:limitations',
          interviewId: 'interview-evaluation-limitations',
          candidateId: 'candidate-1',
          workspaceId: 'workspace-1',
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'EVALUATED',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:22:00.000Z',
        },
        stage: 'EVALUATED',
        nextAction: 'REVIEW_EVALUATION',
        nextActionLabel: 'Review the source-backed evaluator report.',
        hasChallengePacket: true,
        hasWorkEvidence: true,
        hasMessageEvidence: true,
        hasDevContainerEvidence: true,
        hasToolUsageEvidence: true,
        hasCommitSubmission: true,
        hasFinalSubmission: true,
        hasAiInteraction: false,
        hasTranscriptEvidence: false,
        hasTestEvidence: true,
        evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
        sourceRefCounts: [
          { kind: 'review_challenge_packet', count: 1 },
          { kind: 'git_commit', count: 1 },
          { kind: 'code_diff', count: 1 },
          { kind: 'test_run', count: 1 },
        ],
        challenge: null,
        latestEvent: {
          id: 'assessment-event-limitations-secret',
          kind: 'final_submission',
          sequence: 4,
          occurredAt: '2026-06-23T00:20:00.000Z',
        },
        commit: {
          eventId: 'assessment-event-limitations-secret',
          repositoryUrl: 'https://github.com/mui/base-ui',
          forkRepositoryUrl: null,
          branchName: 'pipe-assessment',
          baseCommitSha: '3333333333333333333333333333333333333333',
          commitSha: '123456abcdef123456abcdef123456abcdef1234',
          commitUrl: null,
          submissionSource: 'live_workspace',
          submissionSourceLabel: 'Live workspace finalizer',
          changedFiles: [{ path: 'packages/react/src/popover/root/usePopoverRoot.ts', status: 'modified' }],
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        evaluation: {
          id: 'assessment-report-limitations-secret',
          status: 'EVALUATED',
          summary: 'PIPE produced a conservative source-backed assessment report from captured challenge, commit, diff, verification, and workspace evidence.',
          recommendation: 'mixed_evidence_human_review',
          createdAt: '2026-06-23T00:22:00.000Z',
          evidenceCoverage: {
            schemaVersion: 'assessment-evidence-coverage-v1',
            sourceRefCount: 4,
            sourceRefTypeCounts: {
              review_challenge_packet: 1,
              git_commit: 1,
              code_diff: 1,
              test_run: 1,
            },
            requiredForEvaluation: [],
            expectedForHighConfidence: [],
          },
          claims: [],
          diagnostics: [{
            id: 'assessment-diagnostic-limitations-secret',
            code: 'HUMAN_CORRECTNESS_REVIEW_REQUIRED',
            severity: 'warning',
            message: 'A human reviewer should inspect the diff before treating the commit as proven upstream-correct.',
            sourceRefCount: 1,
            sourceRefTypes: ['code_diff'],
          }],
        },
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('LIMITATIONS');
    expect(progress).toHaveTextContent('AI USE');
    expect(progress).toHaveTextContent('No AI use captured');
    expect(progress).toHaveTextContent('treat AI use as unobserved, not absent');
    expect(progress).toHaveTextContent('Human correctness review required');
    expect(progress).toHaveTextContent('Inspect the submitted diff and verification evidence before deciding.');
    expect(progress).toHaveTextContent('AI-use trail missing');
    expect(progress).toHaveTextContent('Do not judge AI collaboration from this session.');
    expect(progress).toHaveTextContent('Transcript missing');
    expect(progress).toHaveTextContent('Reasoning and communication signals come from chat/code evidence only.');
    expect(progress).not.toHaveTextContent('assessment-report-limitations-secret');
    expect(progress).not.toHaveTextContent('assessment-diagnostic-limitations-secret');
  });

  it('shows human assessment decision before evaluator recommendation without exposing ids', () => {
    renderCard({
      id: 'interview-evaluated',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:20:00.000Z',
      status: 'COMPLETED',
      interviewType: 'OPEN_SOURCE_BUG_FIX',
      meetingType: 'DIRECT_VIDEO_CALL',
      scheduledAt: null,
      assessmentSetup: {
        status: 'reviewable_task_assigned',
        kind: 'manual_open_source_task',
        source: 'recruiter_manual_override',
        blocksPositiveAssessment: false,
        message: 'A concrete open-source task packet was assigned by the recruiter.',
      },
      assessmentProgress: {
        session: {
          id: 'assessment-session-evaluated',
          ingestionKey: 'assessment-session:evaluated',
          interviewId: 'interview-evaluated',
          candidateId: 'candidate-1',
          workspaceId: null,
          workspacePersonId: null,
          applicationId: null,
          mode: 'OPEN_SOURCE_BUG_FIX',
          state: 'EVALUATED',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:20:00.000Z',
        },
        stage: 'EVALUATED',
        nextAction: 'REVIEW_EVALUATION',
        nextActionLabel: 'Review the source-backed evaluator report.',
        hasChallengePacket: true,
        hasWorkEvidence: true,
        hasMessageEvidence: true,
        hasDevContainerEvidence: true,
        hasToolUsageEvidence: true,
        hasCommitSubmission: true,
        hasFinalSubmission: true,
        hasAiInteraction: true,
        hasTranscriptEvidence: true,
        hasTestEvidence: true,
        evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
        sourceRefCounts: [{ kind: 'test_run', count: 1 }],
        challenge: null,
        latestEvent: {
          id: 'assessment-event-evaluated',
          kind: 'final_submission',
          sequence: 4,
          occurredAt: '2026-06-23T00:20:00.000Z',
        },
        commit: {
          eventId: 'assessment-event-evaluated',
          repositoryUrl: 'https://github.com/open-source/widgets',
          forkRepositoryUrl: 'https://github.com/candidate/widgets',
          branchName: 'pipe-assessment/widgets',
          baseCommitSha: '3333333333333333333333333333333333333333',
          commitSha: '123456abcdef123456abcdef123456abcdef1234',
          commitUrl: 'https://github.com/candidate/widgets/commit/123456abcdef123456abcdef123456abcdef1234',
          changedFiles: [{ path: 'src/widget.ts', status: 'modified' }],
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        evaluation: {
          id: 'assessment-evaluation-secret',
          status: 'EVALUATED',
          summary: 'Candidate produced a focused source-backed fix with commit and test evidence.',
          recommendation: 'Strong evidence to advance',
          createdAt: '2026-06-23T00:22:00.000Z',
          evidenceCoverage: null,
          claims: [],
          diagnostics: [{
            id: 'diagnostic-card-secret',
            code: 'VERIFICATION_UNOBSERVED',
            severity: 'info',
            message: 'Test runner output was not captured.',
            sourceRefCount: 1,
            sourceRefTypes: ['test_run'],
          }],
        },
        humanDecision: {
          eventId: 'assessment-human-decision-secret',
          decision: 'advance',
          reviewerId: 'recruiter-secret',
          summary: 'Human reviewer advances after checking the source-backed report.',
          notes: 'Diff and tests support the final decision.',
          occurredAt: '2026-06-23T00:25:00.000Z',
          sourceRefCount: 1,
          sourceRefTypes: ['assessment_evaluation_report'],
        },
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('Evaluated');
    expect(progress).toHaveTextContent('DECISION');
    expect(progress).toHaveTextContent('Human: advance');
    expect(progress).toHaveTextContent('Human reviewer advances after checking the source-backed report.');
    expect(progress).not.toHaveTextContent('Strong evidence to advance');
    expect(progress).toHaveTextContent('EVAL');
    expect(progress).toHaveTextContent('CAUTION');
    expect(progress).toHaveTextContent('1 evaluator caution');
    expect(progress).not.toHaveTextContent('assessment-evaluation-secret');
    expect(progress).not.toHaveTextContent('assessment-human-decision-secret');
    expect(progress).not.toHaveTextContent('recruiter-secret');
    expect(progress).not.toHaveTextContent('assessment-session-evaluated');
    expect(progress).not.toHaveTextContent('diagnostic-card-secret');
  });
});
