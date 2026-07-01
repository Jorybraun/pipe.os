import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import InterviewDetailPage from './InterviewDetailPage';
import type { ScheduledInterviewDetail } from '../lib/scheduling/types';

const mocks = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const SOURCE_BACKED_WORK_EVIDENCE_QUESTION =
  'Describe one real PR, bug, or code review you personally handled that best represents the work PIPE should assess. Include the codebase context, your role, trade-offs, verification/tests, and outcome.';
const SOURCE_BACKED_WORK_EVIDENCE_FOLLOW_UP =
  'What did you inspect, which constraints mattered, and what source evidence would help PIPE map that work to a fair repo challenge?';

vi.mock('../hooks/useApiClient', () => ({
  useApiClient: () => mocks.api,
}));

function makeInterview(
  overrides: Partial<ScheduledInterviewDetail> = {},
): ScheduledInterviewDetail {
  return {
    id: 'interview-1',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    candidateId: null,
    contactId: 'person-1',
    pipelineId: null,
    stageId: null,
    interviewType: 'VIDEO',
    meetingType: 'DIRECT_VIDEO_CALL',
    status: 'INVITED',
    scheduledAt: null,
    meetingUrl: null,
    schedulingProvider: 'MANUAL',
    schedulingUrl: null,
    externalEventId: null,
    recruiterNotes: null,
    syncSource: 'MANUAL',
    lastSyncedAt: null,
    inviteLinkSentAt: '2026-06-23T00:00:00.000Z',
    emailSentAt: '2026-06-23T00:00:00.000Z',
    owner: 'user-1',
    recipientName: 'Ada Candidate',
    recipientEmail: 'ada@example.com',
    candidateName: null,
    candidateEmail: null,
    pipelineTitle: null,
    stageTitle: null,
    matchedRepoId: null,
    githubRepoUrl: null,
    githubPrNumber: null,
    submissionJson: null,
    completedAt: null,
    transcriptArtifact: null,
    linkedMeeting: null,
    livingContext: null,
    ...overrides,
  };
}

function PersonRouteEcho(): JSX.Element {
  const { personId } = useParams<{ personId: string }>();
  const location = useLocation();
  return (
    <div>
      <div data-testid="person-route-echo">{personId}</div>
      <pre data-testid="person-route-state">{JSON.stringify(location.state)}</pre>
    </div>
  );
}

function renderDetail(): void {
  render(
    <MemoryRouter initialEntries={['/interviews/interview-1']}>
      <Routes>
        <Route path="/interviews/:interviewId" element={<InterviewDetailPage />} />
        <Route path="/people/:personId" element={<PersonRouteEcho />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function flushAsyncUpdates(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function evidenceFollowUpNotes(): string {
  return [
    'PIPE context call for blocked code-review matching.',
    'Original CODE_REVIEW interview: interview-code-review-blocked',
    'Match status: NEEDS_MORE_EVIDENCE',
    'Match summary: PIPE needs source-backed candidate work evidence before selecting a fair PR.',
    'Evidence gap 1: NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
    'Suggested questions:',
    `1. ${SOURCE_BACKED_WORK_EVIDENCE_QUESTION}`,
    `2. ${SOURCE_BACKED_WORK_EVIDENCE_FOLLOW_UP}`,
  ].join('\n');
}

describe('InterviewDetailPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.api.get.mockReset();
    mocks.api.post.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the interview visible while transcript polling refreshes in the background', async () => {
    let resolveBackground:
      | ((value: { interview: ScheduledInterviewDetail }) => void)
      | undefined;
    const backgroundRefresh = new Promise<{ interview: ScheduledInterviewDetail }>((resolve) => {
      resolveBackground = resolve;
    });

    mocks.api.get
      .mockResolvedValueOnce({
        interview: makeInterview({
          linkedMeeting: {
            id: 'meeting-1',
            title: 'Ada Candidate interview',
            description: null,
            status: 'ACTIVE',
            scheduledAt: null,
            startedAt: null,
            endedAt: null,
            durationSecs: null,
            meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
            meetingType: 'INTERVIEW',
            transcriptStatus: 'PROCESSING',
            transcriptSummary: null,
            transcriptJson: null,
            transcriptAnalysisJson: null,
            transcriptError: null,
            recordingR2Key: null,
            room: null,
            createdAt: '2026-06-23T00:00:00.000Z',
            updatedAt: '2026-06-23T00:00:00.000Z',
          },
        }),
      })
      .mockReturnValueOnce(backgroundRefresh);

    renderDetail();

    await flushAsyncUpdates();
    expect(screen.getByText('Ada Candidate')).toBeTruthy();
    expect(screen.getByText('Meeting room')).toBeTruthy();
    expect(screen.getByText('Linked to this interview')).toBeTruthy();
    expect(screen.queryByText('meeting-1')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mocks.api.get).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Ada Candidate')).toBeTruthy();
    expect(screen.getByText('Processing transcript')).toBeTruthy();

    resolveBackground?.({
      interview: makeInterview({
        linkedMeeting: {
          id: 'meeting-1',
          title: 'Ada Candidate interview',
          description: null,
          status: 'ACTIVE',
          scheduledAt: null,
          startedAt: null,
          endedAt: null,
          durationSecs: null,
          meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
          meetingType: 'INTERVIEW',
          transcriptStatus: 'PROCESSING',
          transcriptSummary: 'Call is being processed.',
          transcriptJson: null,
          transcriptAnalysisJson: null,
          transcriptError: null,
          recordingR2Key: null,
          room: null,
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
      }),
    });

    await flushAsyncUpdates();
    expect(screen.getByText('Call is being processed.')).toBeTruthy();
  });

  it('shows source-backed assessment progress and next action for open-source workspaces', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        githubRepoUrl: 'https://github.com/open-source/widgets',
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
            id: 'assessment-session-1',
            ingestionKey: 'assessment-session:interview-1',
            interviewId: 'interview-1',
            candidateId: null,
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
          hasFinalSubmission: false,
          hasAiInteraction: true,
          hasTranscriptEvidence: true,
          hasTestEvidence: true,
          evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
          sourceRefCounts: [
            { kind: 'git_commit', count: 1 },
            { kind: 'code_diff', count: 1 },
            { kind: 'test_run', count: 1 },
            { kind: 'ai_user_prompt', count: 2 },
            { kind: 'ai_agent_response', count: 1 },
          ],
          evidenceSnippets: [
            {
              eventKind: 'recruiter_note',
              sourceRefType: 'review_challenge_packet',
              evidenceRole: 'assigned_challenge',
              exactText: 'Task: Fix the popover cleanup regression.',
              occurredAt: '2026-06-23T00:00:00.000Z',
            },
            {
              eventKind: 'commit_submission',
              sourceRefType: 'code_diff',
              evidenceRole: 'submitted_diff',
              exactText: 'diff --git a/src/popover.ts b/src/popover.ts +cleanupStaleHandler();',
              occurredAt: '2026-06-23T00:18:00.000Z',
            },
            {
              eventKind: 'commit_submission',
              sourceRefType: 'test_run',
              evidenceRole: 'verification_test_output',
              exactText: 'pnpm test popover -- --runInBand passed the impatient click regression.',
              occurredAt: '2026-06-23T00:19:00.000Z',
            },
          ],
          challenge: {
            sourceRefType: 'review_challenge_packet',
            sourceRefId: 'challenge-packet-popover',
            evidenceRole: 'assigned_challenge',
            exactText: [
              'Repo: https://github.com/open-source/widgets',
              'Base commit: 1111111111111111111111111111111111111111',
              'Task: Fix the popover cleanup regression.',
              'Success criteria:',
              '- Keep hover-open behavior intact.',
              '- Add a regression test for impatient trigger clicks.',
              'Expected evidence:',
              '- Commit on pipe-assessment/* with a focused diff.',
              '- Test output showing the regression suite passed.',
            ].join('\n'),
            locator: {
              repositoryUrl: 'https://github.com/open-source/widgets',
              baseCommitSha: '1111111111111111111111111111111111111111',
            },
          },
          latestEvent: {
            id: 'assessment-event-commit',
            kind: 'commit_submission',
            sequence: 2,
            occurredAt: '2026-06-23T00:18:00.000Z',
          },
          commit: {
            eventId: 'assessment-event-commit',
            repositoryUrl: 'https://github.com/open-source/widgets',
            forkRepositoryUrl: 'https://github.com/candidate/widgets',
            branchName: 'pipe-assessment/popover-cleanup',
            baseCommitSha: '1111111111111111111111111111111111111111',
            commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
            commitUrl: 'https://github.com/candidate/widgets/commit/abcdef1234567890abcdef1234567890abcdef12',
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
              detail: 'Submitted repository and base commit match the assigned source-backed challenge packet.',
              tone: 'verified',
            },
            changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
            occurredAt: '2026-06-23T00:18:00.000Z',
          },
          evaluation: null,
        },
      }),
    });

    renderDetail();
    await flushAsyncUpdates();

    const progress = screen.getByTestId('interview-assessment-progress');
    expect(progress).toHaveTextContent('Assessment progress');
    expect(progress).toHaveTextContent('Ready for evaluation');
    const assignment = screen.getByTestId('interview-assessment-assignment');
    expect(assignment).toHaveTextContent('Assignment');
    expect(assignment).toHaveTextContent('PIPE-matched challenge');
    expect(assignment).toHaveTextContent(
      'Repo task was selected from source-backed candidate evidence and an approved challenge packet.',
    );
    expect(progress).toHaveTextContent('Start source-backed AI or human evaluation.');
    expect(progress).toHaveTextContent('challenge, chat, workspace telemetry, tool activity, commit, AI use, transcript, tests');
    expect(progress).toHaveTextContent('Workspace');
    expect(progress).toHaveTextContent('Ready · open-source/widgets · base 1111111111');
    expect(progress).toHaveTextContent('abcdef1234');
    expect(progress).toHaveTextContent('Commit integrity');
    expect(progress).toHaveTextContent('Workspace-captured commit');
    expect(progress).toHaveTextContent('Captured by the live dev-container finalizer from the workspace HEAD and exact source refs.');
    expect(progress).toHaveTextContent('Challenge binding');
    expect(progress).toHaveTextContent('Bound to assigned challenge');
    expect(progress).toHaveTextContent('Submitted repository and base commit match the assigned source-backed challenge packet.');
    const workPacket = screen.getByTestId('interview-assessment-work-packet');
    expect(workPacket).toHaveTextContent('Candidate work packet');
    expect(workPacket).toHaveTextContent('Commit artifact');
    expect(workPacket).toHaveTextContent('abcdef1234');
    expect(workPacket).toHaveTextContent('Workspace-captured commit');
    expect(workPacket).toHaveTextContent('Bound to assigned challenge');
    expect(workPacket).toHaveTextContent('Branch pipe-assessment/popover-cleanup');
    expect(workPacket).toHaveTextContent('1 changed file: src/popover.ts · Modified');
    expect(workPacket).toHaveTextContent('Verification');
    expect(workPacket).toHaveTextContent('Tests captured');
    expect(workPacket).toHaveTextContent('AI transparency');
    expect(workPacket).toHaveTextContent('AI use observed');
    expect(workPacket).toHaveTextContent('2 prompts and 1 agent response captured from the real agent bridge.');
    expect(workPacket).toHaveTextContent('Human review');
    expect(workPacket).toHaveTextContent('Run evaluation');
    const contract = screen.getByTestId('interview-assessment-challenge-contract');
    expect(contract).toHaveTextContent('Repo open-source/widgets');
    expect(contract).toHaveTextContent('Base 1111111111');
    expect(contract).toHaveTextContent('Task');
    expect(contract).toHaveTextContent('Fix the popover cleanup regression.');
    expect(contract).toHaveTextContent('Success criteria');
    expect(contract).toHaveTextContent('Keep hover-open behavior intact.');
    expect(contract).toHaveTextContent('Add a regression test for impatient trigger clicks.');
    expect(contract).toHaveTextContent('Expected evidence');
    expect(contract).toHaveTextContent('Commit on pipe-assessment/* with a focused diff.');
    expect(contract).toHaveTextContent('Test output showing the regression suite passed.');
    const snippets = screen.getByTestId('interview-assessment-evidence-snippets');
    expect(snippets).toHaveTextContent('Evidence trail');
    expect(snippets).toHaveTextContent('Challenge evidence');
    expect(snippets).toHaveTextContent('Diff evidence');
    expect(snippets).toHaveTextContent('Test evidence');
    expect(snippets).toHaveTextContent('Fix the popover cleanup regression.');
    expect(snippets).toHaveTextContent('cleanupStaleHandler');
    expect(snippets).toHaveTextContent('passed the impatient click regression');
    expect(progress).toHaveTextContent('pipe-assessment/popover-cleanup');
    expect(progress).not.toHaveTextContent('challenge-packet-popover');
  });

  it('treats missing AI bridge evidence as unobserved instead of absent in the work packet', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        status: 'COMPLETED',
        assessmentProgress: {
          session: {
            id: 'assessment-session-no-ai',
            ingestionKey: 'assessment-session:no-ai',
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
          hasChallengePacket: true,
          hasWorkEvidence: true,
          hasMessageEvidence: false,
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
          challenge: {
            sourceRefType: 'review_challenge_packet',
            sourceRefId: 'challenge-packet-no-ai',
            evidenceRole: 'assigned_challenge',
            exactText: 'Task: fix the no-ai transparency copy.',
            locator: { repositoryUrl: 'https://github.com/open-source/widgets' },
          },
          latestEvent: {
            id: 'assessment-event-no-ai',
            kind: 'commit_submission',
            sequence: 2,
            occurredAt: '2026-06-23T00:18:00.000Z',
          },
          commit: {
            eventId: 'assessment-event-no-ai',
            repositoryUrl: 'https://github.com/open-source/widgets',
            forkRepositoryUrl: 'https://github.com/candidate/widgets',
            branchName: 'pipe-assessment/no-ai-copy',
            baseCommitSha: '2222222222222222222222222222222222222222',
            commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            commitUrl: 'https://github.com/candidate/widgets/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            changedFiles: [{ path: 'src/transparency.ts', status: 'modified' }],
            occurredAt: '2026-06-23T00:18:00.000Z',
          },
          evaluation: null,
        },
      }),
    });

    renderDetail();
    await flushAsyncUpdates();

    const workPacket = screen.getByTestId('interview-assessment-work-packet');
    expect(workPacket).toHaveTextContent('AI transparency');
    expect(workPacket).toHaveTextContent('No AI evidence captured');
    expect(workPacket).toHaveTextContent(
      'No candidate AI-assistance evidence is attached; treat AI use as unobserved, not absent.',
    );
    expect(workPacket).not.toHaveTextContent('AI use observed');
    expect(workPacket).not.toHaveTextContent('agent response captured');
  });

  it('shows the exact missing proof checklist before an open-source workspace can be evaluated', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        githubRepoUrl: 'https://github.com/open-source/streaming',
        assessmentSetup: {
          status: 'reviewable_task_assigned',
          kind: 'github_pr',
          source: 'recruiter_manual_override',
          blocksPositiveAssessment: false,
          message: 'A concrete open-source task packet was assigned by the recruiter.',
        },
        workspaceSession: {
          status: 'READY',
          errorMessage: null,
          expiresAt: '2026-06-23T01:00:00.000Z',
          updatedAt: '2026-06-23T00:10:00.000Z',
          repoGitUrl: 'https://github.com/open-source/streaming',
          baseCommitSha: '2222222222222222222222222222222222222222',
        },
        assessmentProgress: {
          session: {
            id: 'assessment-session-missing-proof',
            ingestionKey: 'assessment-session:missing-proof',
            interviewId: 'interview-1',
            candidateId: null,
            workspaceId: 'workspace-1',
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
          assignmentTrust: {
            state: 'manual_challenge',
            label: 'Manual task assignment',
            detail: 'A concrete open-source task packet was assigned by the recruiter.',
            tone: 'manual',
          },
          readiness: {
            status: 'READY_TO_START',
            label: 'Challenge ready',
            detail: '3 required proof items are still missing before evaluation.',
            isReadyForEvaluation: false,
            isUsableHiringSignal: false,
            missingRequiredCount: 3,
            required: [
              {
                id: 'challenge_packet',
                label: 'Complete challenge packet',
                required: true,
                satisfied: true,
                sourceRefTypes: ['open_source_challenge_packet'],
                missingImpact: 'Without a source-backed task packet, PIPE cannot prove what work was assigned.',
              },
              {
                id: 'work_evidence',
                label: 'Candidate work evidence',
                required: true,
                satisfied: false,
                sourceRefTypes: ['terminal_output', 'code_diff', 'room_chat_message'],
                missingImpact: 'Without work evidence, the session only proves an assignment existed.',
              },
              {
                id: 'assessment_commit',
                label: 'Assessment branch commit',
                required: true,
                satisfied: false,
                sourceRefTypes: ['git_commit'],
                missingImpact: 'A real commit hash is required before evaluating open-source implementation work.',
              },
              {
                id: 'code_diff',
                label: 'Exact code diff',
                required: true,
                satisfied: false,
                sourceRefTypes: ['code_diff'],
                missingImpact: 'The evaluator must inspect the exact diff from base commit to submitted commit.',
              },
            ],
            confidence: [
              {
                id: 'workspace_captured_commit',
                label: 'Workspace-captured commit',
                required: false,
                satisfied: false,
                sourceRefTypes: ['git_commit', 'dev_container_workspace_state'],
                missingImpact: 'Manual commit evidence can start review, but workspace capture is needed for highest trust.',
              },
              {
                id: 'ai_usage_transparency',
                label: 'AI-use transparency',
                required: false,
                satisfied: false,
                sourceRefTypes: ['ai_usage_event'],
                missingImpact: 'If the candidate used AI, prompts and responses should be captured honestly.',
              },
            ],
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
          hasVerificationGap: false,
          evidenceCounts: [{ kind: 'recruiter_note', count: 1 }],
          sourceRefCounts: [{ kind: 'open_source_challenge_packet', count: 1 }],
          evidenceSnippets: [],
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
          challenge: {
            sourceRefType: 'open_source_challenge_packet',
            sourceRefId: 'challenge-packet-hidden',
            evidenceRole: 'assigned_challenge',
            exactText: [
              'Repo: https://github.com/open-source/streaming',
              'Base commit: 2222222222222222222222222222222222222222',
              'Task: Fix reconnect ordering in the event stream.',
              'Success criteria:',
              '- Reconnect keeps event order deterministic',
              'Expected evidence:',
              '- Commit SHA on assessment branch',
              '- Exact diff from base commit to submitted commit',
            ].join('\n'),
            locator: {
              repositoryUrl: 'https://github.com/open-source/streaming',
              baseCommitSha: '2222222222222222222222222222222222222222',
            },
          },
          latestEvent: {
            id: 'assessment-event-hidden',
            kind: 'recruiter_note',
            sequence: 1,
            occurredAt: '2026-06-23T00:20:00.000Z',
          },
          commit: null,
          evaluation: null,
          humanDecision: null,
        },
      }),
    });

    renderDetail();
    await flushAsyncUpdates();

    const progress = screen.getByTestId('interview-assessment-progress');
    expect(progress).toHaveTextContent('Challenge ready');
    expect(progress).toHaveTextContent('3 required proof items are still missing before evaluation.');
    const checklist = screen.getByTestId('interview-assessment-proof-checklist');
    expect(checklist).toHaveTextContent('Required proof');
    expect(checklist).toHaveTextContent('Complete challenge packet');
    expect(checklist).toHaveTextContent('Captured');
    expect(checklist).toHaveTextContent('Candidate work evidence');
    expect(checklist).toHaveTextContent('Missing');
    expect(checklist).toHaveTextContent('Without work evidence, the session only proves an assignment existed.');
    expect(checklist).toHaveTextContent('Assessment branch commit');
    expect(checklist).toHaveTextContent('A real commit hash is required before evaluating open-source implementation work.');
    expect(checklist).toHaveTextContent('Exact code diff');
    expect(checklist).toHaveTextContent('The evaluator must inspect the exact diff from base commit to submitted commit.');
    expect(checklist).toHaveTextContent('Confidence signals');
    expect(checklist).toHaveTextContent('Workspace-captured commit');
    expect(checklist).toHaveTextContent('AI-use transparency');
    expect(progress).not.toHaveTextContent('assessment-session-missing-proof');
    expect(progress).not.toHaveTextContent('challenge-packet-hidden');
    expect(progress).not.toHaveTextContent('assessment-event-hidden');
  });

  it('starts source-backed assessment evaluation and surfaces a specific evaluator diagnostic', async () => {
    const readyProgress: NonNullable<ScheduledInterviewDetail['assessmentProgress']> = {
      session: {
        id: 'assessment-session-ready',
        ingestionKey: 'assessment-session:ready',
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
      hasChallengePacket: true,
      hasWorkEvidence: true,
      hasCommitSubmission: true,
      hasFinalSubmission: false,
      hasAiInteraction: true,
      hasTranscriptEvidence: true,
      hasTestEvidence: false,
      evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
      sourceRefCounts: [],
      challenge: {
        sourceRefType: 'review_challenge_packet',
        sourceRefId: 'challenge-packet-ready',
        evidenceRole: 'assigned_challenge',
        exactText: 'Task: fix the popover cleanup regression.',
        locator: { repositoryUrl: 'https://github.com/open-source/widgets' },
      },
      latestEvent: {
        id: 'assessment-event-commit-ready',
        kind: 'commit_submission',
        sequence: 2,
        occurredAt: '2026-06-23T00:18:00.000Z',
      },
      commit: {
        eventId: 'assessment-event-commit-ready',
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/popover-cleanup',
        baseCommitSha: '1111111111111111111111111111111111111111',
        commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
        commitUrl: 'https://github.com/candidate/widgets/commit/abcdef1234567890abcdef1234567890abcdef12',
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
        occurredAt: '2026-06-23T00:18:00.000Z',
      },
      evaluation: null,
    };
    const diagnosticProgress: NonNullable<ScheduledInterviewDetail['assessmentProgress']> = {
      ...readyProgress,
      session: {
        ...readyProgress.session,
        state: 'DIAGNOSTIC',
        updatedAt: '2026-06-23T00:22:00.000Z',
      },
      stage: 'NEEDS_ATTENTION',
      nextAction: 'RESOLVE_DIAGNOSTIC',
      nextActionLabel: 'Resolve the blocking diagnostic before continuing.',
      evidenceCounts: [
        { kind: 'commit_submission', count: 1 },
        { kind: 'recruiter_note', count: 2 },
      ],
      evaluation: {
        id: 'assessment-report-ai-unavailable',
        status: 'AI_DEVELOPER_UNAVAILABLE',
        summary: 'Workers AI is not configured for source-backed repo-task evaluation.',
        createdAt: '2026-06-23T00:22:00.000Z',
      },
    };
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        status: 'COMPLETED',
        assessmentProgress: readyProgress,
      }),
    });
    mocks.api.post.mockResolvedValueOnce({
      progress: diagnosticProgress,
      diagnostic: {
        id: 'assessment-diagnostic-ai-unavailable',
        sessionId: 'assessment-session-ready',
        reportId: 'assessment-report-ai-unavailable',
        code: 'AI_DEVELOPER_UNAVAILABLE',
        severity: 'blocking',
      },
      report: null,
    });

    renderDetail();
    await flushAsyncUpdates();

    fireEvent.click(screen.getByRole('button', { name: /start evaluation/i }));
    await flushAsyncUpdates();

    expect(mocks.api.post).toHaveBeenCalledWith(
      '/api/v1/scheduling/interviews/interview-1/assessment/start-evaluation',
      {},
    );
    const progress = screen.getByTestId('interview-assessment-progress');
    expect(progress).toHaveTextContent('Needs attention');
    expect(progress).toHaveTextContent('Resolve the blocking diagnostic before continuing.');
    expect(progress).toHaveTextContent('Evaluator unavailable · Workers AI is not configured for source-backed repo-task evaluation.');
    expect(progress).toHaveTextContent('Evaluation needs attention: Workers AI is not configured for source-backed repo-task evaluation.');
    expect(screen.queryByRole('button', { name: /start evaluation/i })).toBeNull();
  });

  it('starts source-backed assessment evaluation and surfaces a report-ready notice when evaluated', async () => {
    const readyProgress: NonNullable<ScheduledInterviewDetail['assessmentProgress']> = {
      session: {
        id: 'assessment-session-ready',
        ingestionKey: 'assessment-session:ready',
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
      hasChallengePacket: true,
      hasWorkEvidence: true,
      hasCommitSubmission: true,
      hasFinalSubmission: false,
      hasAiInteraction: true,
      hasTranscriptEvidence: true,
      hasTestEvidence: true,
      evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
      sourceRefCounts: [
        { kind: 'git_commit', count: 1 },
        { kind: 'code_diff', count: 1 },
        { kind: 'test_run', count: 1 },
      ],
      challenge: {
        sourceRefType: 'review_challenge_packet',
        sourceRefId: 'challenge-packet-ready',
        evidenceRole: 'assigned_challenge',
        exactText: 'Task: fix the popover cleanup regression.',
        locator: { repositoryUrl: 'https://github.com/open-source/widgets' },
      },
      latestEvent: {
        id: 'assessment-event-commit-ready',
        kind: 'commit_submission',
        sequence: 2,
        occurredAt: '2026-06-23T00:18:00.000Z',
      },
      commit: {
        eventId: 'assessment-event-commit-ready',
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/popover-cleanup',
        baseCommitSha: '1111111111111111111111111111111111111111',
        commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
        commitUrl: 'https://github.com/candidate/widgets/commit/abcdef1234567890abcdef1234567890abcdef12',
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
        occurredAt: '2026-06-23T00:18:00.000Z',
      },
      evaluation: null,
    };
    const evaluatedProgress: NonNullable<ScheduledInterviewDetail['assessmentProgress']> = {
      ...readyProgress,
      session: {
        ...readyProgress.session,
        state: 'EVALUATED',
        updatedAt: '2026-06-23T00:22:00.000Z',
      },
      stage: 'EVALUATED',
      nextAction: 'REVIEW_EVALUATION',
      nextActionLabel: 'Review the assessment report and evidence.',
      evidenceCounts: [
        { kind: 'ai_interaction', count: 1 },
        { kind: 'commit_submission', count: 1 },
        { kind: 'recruiter_note', count: 2 },
      ],
      evaluation: {
        id: 'assessment-report-source-backed',
        status: 'EVALUATED',
        summary: 'Candidate made a focused source-backed change and cited the submitted diff evidence.',
        recommendation: 'hire_now',
        createdAt: '2026-06-23T00:22:00.000Z',
        claims: [{
          id: 'claim-focused-diff',
          polarity: 'positive',
          dimension: 'commit_quality',
          narrative: 'The candidate produced a focused patch backed by the submitted diff.',
          confidence: 0.82,
          sourceRefCount: 2,
          sourceRefTypes: ['code_diff', 'git_commit'],
        }],
        diagnostics: [{
          id: 'diagnostic-missing-runner',
          code: 'VERIFICATION_UNOBSERVED',
          severity: 'info',
          message: 'The test evidence shows changed files but no test runner output.',
          sourceRefCount: 1,
          sourceRefTypes: ['test_run'],
        }],
        evidenceCoverage: {
          schemaVersion: 'assessment-evidence-coverage-v1',
          sourceRefCount: 3,
          sourceRefTypeCounts: {
            review_challenge_packet: 1,
            git_commit: 1,
            code_diff: 1,
          },
          requiredForEvaluation: [
            {
              label: 'challenge_packet',
              required: true,
              sourceRefTypes: ['review_challenge_packet'],
              satisfied: true,
              sourceRefKeys: ['review_challenge_packet:challenge-packet-ready:assigned_challenge:'],
              missingImpact: '',
            },
            {
              label: 'git_commit',
              required: true,
              sourceRefTypes: ['git_commit'],
              satisfied: true,
              sourceRefKeys: ['git_commit:abcdef1234567890abcdef1234567890abcdef12:support:'],
              missingImpact: '',
            },
            {
              label: 'code_diff',
              required: true,
              sourceRefTypes: ['code_diff'],
              satisfied: true,
              sourceRefKeys: ['code_diff:abcdef1234567890abcdef1234567890abcdef12:diff:support:'],
              missingImpact: '',
            },
          ],
          expectedForHighConfidence: [
            {
              label: 'test_run',
              required: false,
              sourceRefTypes: ['test_run'],
              satisfied: false,
              sourceRefKeys: [],
              missingImpact: 'Do not make positive test_strategy or verification claims without test_run evidence.',
            },
            {
              label: 'terminal_activity',
              required: false,
              sourceRefTypes: ['terminal_command', 'terminal_output'],
              satisfied: true,
              sourceRefKeys: ['terminal_output:terminal-1:support:'],
              missingImpact: '',
            },
            {
              label: 'code_editor_activity',
              required: false,
              sourceRefTypes: ['code_editor_save'],
              satisfied: false,
              sourceRefKeys: [],
              missingImpact: 'Treat edit process as unobserved when editor/file evidence is absent.',
            },
            {
              label: 'ai_assistance',
              required: false,
              sourceRefTypes: ['ai_user_prompt', 'ai_agent_response'],
              satisfied: false,
              sourceRefKeys: [],
              missingImpact: 'Treat AI usage as unobserved when real agent bridge chat evidence is absent.',
            },
          ],
        },
      },
    };
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        status: 'COMPLETED',
        assessmentProgress: readyProgress,
      }),
    });
    mocks.api.post.mockResolvedValueOnce({
      progress: evaluatedProgress,
      report: {
        id: 'assessment-report-source-backed',
        sessionId: 'assessment-session-ready',
        status: 'EVALUATED',
        contextRecordId: null,
      },
      diagnostic: null,
    });

    renderDetail();
    await flushAsyncUpdates();

    fireEvent.click(screen.getByRole('button', { name: /start evaluation/i }));
    await flushAsyncUpdates();

    const progress = screen.getByTestId('interview-assessment-progress');
    expect(progress).toHaveTextContent('Evaluated');
    expect(progress).toHaveTextContent('Review the assessment report and evidence.');
    expect(progress).toHaveTextContent('Evaluated · Unvalidated recommendation · Candidate made a focused source-backed change and cited the submitted diff evidence.');
    expect(progress).not.toHaveTextContent('Hire now');
    const decision = screen.getByTestId('interview-workspace-assessment-decision-summary');
    expect(decision).toHaveTextContent('Assessment decision');
    expect(decision).toHaveTextContent('Hiring manager readout');
    expect(decision).toHaveTextContent('Decision');
    expect(decision).toHaveTextContent('Unvalidated recommendation');
    expect(decision).not.toHaveTextContent('Hire now');
    expect(decision).toHaveTextContent('Candidate made a focused source-backed change and cited the submitted diff evidence.');
    expect(decision).toHaveTextContent('Challenge fit');
    expect(decision).toHaveTextContent('Source-backed task');
    expect(decision).toHaveTextContent('Required proof');
    expect(decision).toHaveTextContent('Required proof captured');
    expect(decision).toHaveTextContent('Challenge, commit, and diff are source-backed');
    expect(decision).toHaveTextContent('Risk');
    expect(decision).toHaveTextContent('Verification gap');
    expect(decision).toHaveTextContent('Test evidence is missing');
    expect(decision).toHaveTextContent('Next action');
    expect(decision).toHaveTextContent('Review evaluation');
    const claims = screen.getByTestId('interview-assessment-evaluation-claims');
    expect(claims).toHaveTextContent('Evidence-backed claims');
    expect(claims).toHaveTextContent('Strength');
    expect(claims).toHaveTextContent('Commit quality');
    expect(claims).toHaveTextContent('82% confidence');
    expect(claims).toHaveTextContent('The candidate produced a focused patch backed by the submitted diff.');
    expect(claims).toHaveTextContent('2 source refs: Code diff, Git commit');
    const diagnostics = screen.getByTestId('interview-assessment-evaluation-diagnostics');
    expect(diagnostics).toHaveTextContent('Evaluator cautions');
    expect(diagnostics).toHaveTextContent('Info');
    expect(diagnostics).toHaveTextContent('Verification unobserved');
    expect(diagnostics).toHaveTextContent('The test evidence shows changed files but no test runner output.');
    expect(diagnostics).toHaveTextContent('1 source ref: Test run');
    expect(progress).toHaveTextContent('Required proof');
    expect(progress).toHaveTextContent('Challenge captured');
    expect(progress).toHaveTextContent('Commit captured');
    expect(progress).toHaveTextContent('Diff captured');
    expect(progress).toHaveTextContent('Confidence signals');
    expect(progress).toHaveTextContent('Tests missing');
    expect(progress).toHaveTextContent('Terminal captured');
    expect(progress).toHaveTextContent('Editor missing');
    expect(progress).toHaveTextContent('AI use missing');
    expect(progress).toHaveTextContent('Source-backed assessment report is ready to review.');
    expect(screen.queryByRole('button', { name: /start evaluation/i })).toBeNull();
  });

  it('records a source-backed recruiter human decision from an evaluated workspace assessment', async () => {
    const evaluatedProgress: NonNullable<ScheduledInterviewDetail['assessmentProgress']> = {
      session: {
        id: 'assessment-session-decision',
        ingestionKey: 'assessment-session:decision',
        interviewId: 'interview-1',
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
      nextActionLabel: 'Review the assessment report and evidence.',
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
      sourceRefCounts: [{ kind: 'code_diff', count: 1 }],
      challenge: {
        sourceRefType: 'review_challenge_packet',
        sourceRefId: 'challenge-packet-decision',
        evidenceRole: 'assigned_challenge',
        exactText: 'Task: fix the popover cleanup regression.',
        locator: { repositoryUrl: 'https://github.com/open-source/widgets' },
      },
      latestEvent: {
        id: 'assessment-event-decision-commit',
        kind: 'commit_submission',
        sequence: 2,
        occurredAt: '2026-06-23T00:18:00.000Z',
      },
      commit: {
        eventId: 'assessment-event-decision-commit',
        repositoryUrl: 'https://github.com/open-source/widgets',
        forkRepositoryUrl: 'https://github.com/candidate/widgets',
        branchName: 'pipe-assessment/popover-cleanup',
        baseCommitSha: '1111111111111111111111111111111111111111',
        commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
        commitUrl: 'https://github.com/candidate/widgets/commit/abcdef1234567890abcdef1234567890abcdef12',
        changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
        occurredAt: '2026-06-23T00:18:00.000Z',
      },
      evaluation: {
        id: 'assessment-report-decision',
        status: 'EVALUATED',
        summary: 'Candidate made a focused source-backed change and cited the submitted diff evidence.',
        recommendation: 'strong_evidence_to_advance',
        createdAt: '2026-06-23T00:22:00.000Z',
      },
    };
    const decidedProgress: NonNullable<ScheduledInterviewDetail['assessmentProgress']> = {
      ...evaluatedProgress,
      nextAction: 'NONE',
      nextActionLabel: 'No further assessment action is required.',
      humanDecision: {
        eventId: 'assessment-human-decision-1',
        decision: 'advance',
        reviewerId: 'recruiter-1',
        summary: 'Advance after reviewing the source-backed diff, tests, and evaluator report.',
        notes: 'Candidate explained the tradeoff clearly.',
        occurredAt: '2026-06-23T00:30:00.000Z',
        sourceRefCount: 1,
        sourceRefTypes: ['assessment_evaluation_report'],
      },
    };
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        status: 'COMPLETED',
        assessmentProgress: evaluatedProgress,
      }),
    });
    mocks.api.post.mockResolvedValueOnce({
      decision: decidedProgress.humanDecision,
      progress: decidedProgress,
    });

    renderDetail();
    await flushAsyncUpdates();

    fireEvent.change(screen.getByLabelText(/^decision$/i), {
      target: { value: 'advance' },
    });
    fireEvent.change(screen.getByLabelText(/decision summary/i), {
      target: { value: 'Advance after reviewing the source-backed diff, tests, and evaluator report.' },
    });
    fireEvent.change(screen.getByLabelText(/review notes/i), {
      target: { value: 'Candidate explained the tradeoff clearly.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /record human decision/i }));
    await flushAsyncUpdates();

    expect(mocks.api.post).toHaveBeenCalledWith(
      '/api/v1/scheduling/interviews/interview-1/assessment/human-decision',
      {
        decision: 'advance',
        summary: 'Advance after reviewing the source-backed diff, tests, and evaluator report.',
        notes: 'Candidate explained the tradeoff clearly.',
      },
    );
    const progress = screen.getByTestId('interview-assessment-progress');
    expect(progress).toHaveTextContent('No further assessment action is required.');
    expect(progress).toHaveTextContent('Human: advance');
    expect(progress).toHaveTextContent('Advance after reviewing the source-backed diff, tests, and evaluator report.');
    expect(progress).toHaveTextContent('Human decision recorded against the latest source-backed evaluation report.');
    expect(screen.queryByRole('button', { name: /record human decision/i })).toBeNull();
    expect(progress).not.toHaveTextContent('assessment-human-decision-1');
  });

  it('does not poll forever for pending local transcript artifacts', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        transcriptArtifact: {
          id: 'artifact-1',
          interviewId: 'interview-1',
          status: 'PENDING',
          transcriptJson: null,
          errorMessage: null,
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    expect(screen.getByText('Ada Candidate')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(mocks.api.get).toHaveBeenCalledTimes(1);
  });

  it('shows Calendly event linkage on the interview detail', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        status: 'SCHEDULED',
        scheduledAt: '2026-07-03T19:00:00.000Z',
        schedulingProvider: 'CALENDLY',
        externalEventId: 'https://api.calendly.com/scheduled_events/event-katherine',
        linkedMeeting: {
          id: 'meeting-katherine',
          title: 'Katherine Johnson interview',
          description: null,
          status: 'SCHEDULED',
          scheduledAt: '2026-07-03T19:00:00.000Z',
          startedAt: null,
          endedAt: null,
          durationSecs: null,
          meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
          meetingType: 'INTERVIEW',
          schedulingProvider: 'CALENDLY',
          externalEventId: 'https://api.calendly.com/scheduled_events/event-katherine',
          transcriptStatus: 'NONE',
          transcriptSummary: null,
          transcriptJson: null,
          transcriptAnalysisJson: null,
          transcriptError: null,
          recordingR2Key: null,
          room: null,
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    expect(screen.getByText('Scheduling')).toBeTruthy();
    expect(screen.getByText('CALENDLY')).toBeTruthy();
    expect(screen.getByText('event-katherine')).toBeTruthy();
    expect(screen.getByText('Meeting room')).toBeTruthy();
    expect(screen.getByText('Linked to this interview')).toBeTruthy();
    expect(screen.queryByText('meeting-katherine')).toBeNull();
  });

  it('leads completed code-review interviews with recruiter decision value', async () => {
    const deliveredUrl = 'https://app-dev.hire-pipe.com/assess/recruiter-visible-token';
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        matchedRepoId: 973,
        assessmentSetup: {
          status: 'reviewable_task_assigned',
          kind: 'github_pr',
          source: 'matched_repo_id',
          blocksPositiveAssessment: false,
          message: 'PIPE matched a reviewable source-backed PR task.',
          lastDeliveredUrl: deliveredUrl,
          lastDeliveredUrlState: 'active',
          lastDeliveredUrlMessage: 'Candidate assessment link delivered.',
        },
        linkedMeeting: {
          id: 'meeting-code-review-empty-call',
          title: 'Code review assessment',
          description: null,
          status: 'ACTIVE',
          scheduledAt: null,
          startedAt: null,
          endedAt: null,
          durationSecs: null,
          meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
          meetingType: 'INTERVIEW',
          transcriptStatus: 'NONE',
          transcriptSummary: null,
          transcriptJson: null,
          transcriptAnalysisJson: null,
          transcriptError: null,
          recordingR2Key: null,
          room: null,
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
        submissionJson: JSON.stringify({
          type: 'CODE_REVIEW',
          verdict: 'request_changes',
          summary: 'The click timing behavior needs a regression test before this should merge.',
          annotations: [
            {
              file: 'packages/react/src/popover/root/usePopoverRoot.ts',
              line: 66,
              severity: 'major',
              comment: 'This threshold changes click semantics and needs a focused impatient-click regression.',
            },
          ],
          transcript: {
            rounds: [
              {
                round: 1,
                reviewer_comments: [
                  {
                    id: 'comment-1',
                    file: 'packages/react/src/popover/root/usePopoverRoot.ts',
                    line: 66,
                    severity: 'major',
                    comment: 'This threshold changes click semantics and needs a focused impatient-click regression.',
                  },
                ],
                implementer_responses: [
                  {
                    to_comment_id: 'comment-1',
                    move: 'pushback',
                    content: 'Can you explain why 500ms is too broad for intentional clicks?',
                  },
                ],
              },
            ],
          },
        }),
        codeReviewMatch: {
          status: 'MATCHED',
          matchRunId: 'match-run-1',
          packetId: 'packet-1',
          summary: 'Matched 6 source-backed demands.',
          score: 0.82,
          assessmentQuality: {
            verdict: 'STRONG',
            score: 10,
            maxScore: 12,
            metrics: [
              {
                id: 'skill_stack_overlap',
                label: 'Skill stack overlap',
                score: 2,
                maxScore: 2,
                reason: 'Candidate evidence and repo demand both cover React interaction behavior.',
              },
            ],
          },
          reviewProfile: null,
          validatorAgent: {
            agentName: 'quality-gate',
            agentVersion: '1',
            mode: 'source_backed',
            verdict: 'PASSED',
            rationale: 'The match is grounded in candidate, role, and repo evidence.',
            checks: [],
            sourceBridge: {
              prNumber: 973,
              candidateSourceCount: 2,
              roleSourceCount: 1,
              repoSourceCount: 6,
              alignedDemandCount: 6,
              stretchCount: 0,
              provenanceComplete: true,
            },
          },
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [
            {
              relation: 'candidate_repo_evidence_alignment',
              label: 'Candidate evidence bridge 1',
              pairScore: 0.74,
              nodes: [
                {
                  kind: 'person_evidence',
                  label: 'Person evidence',
                  sourceRef: {
                    exactText: 'Implemented popover trigger click handling in usePopoverRoot',
                    locator: 'resume:span-1',
                  },
                },
                {
                  kind: 'repo_challenge',
                  label: 'Repo challenge',
                  sourceRef: {
                    exactText: 'Ignore impatient trigger clicks within 500ms',
                    locator: 'packages/react/src/popover/root/usePopoverRoot.ts',
                  },
                },
              ],
            },
          ],
          gaps: [],
        },
        codeReviewScore: {
          reviewSessionId: 'review-session-1',
          status: 'scored',
          score: 72,
          band: 'adequate',
          narrative: 'Candidate found the interaction regression and gave a concrete blocking reason, but missed one verification detail.',
          strengths: ['Concrete source-backed blocking comment.'],
          growthAreas: ['Probe how they would validate timing cleanup.'],
          provenance: {
            rubricDimensionCount: 6,
            evidenceItemCount: 2,
            metricCount: 5,
          },
          updatedAt: '2026-06-23T01:00:00.000Z',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const priority = screen.getByTestId('interview-code-review-priority-cockpit');
    expect(priority).toHaveTextContent('Decision cockpit');
    expect(priority).toHaveTextContent('Candidate requested changes');
    expect(priority).toHaveTextContent('Usable with calibration');
    expect(priority).toHaveTextContent('Advance with focused probe');
    const linkPanel = screen.getByTestId('interview-assessment-link');
    expect(linkPanel).toHaveTextContent('Assessment invite');
    expect(
      priority.compareDocumentPosition(linkPanel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const decision = screen.getByTestId('interview-code-review-decision-summary');
    expect(decision).toHaveTextContent('Candidate requested changes');
    const hiringReadout = screen.getByTestId('interview-code-review-hiring-readout');
    expect(hiringReadout).toHaveTextContent('Hiring manager readout');
    expect(hiringReadout).toHaveTextContent('Decision');
    expect(hiringReadout).toHaveTextContent('Assignment');
    expect(hiringReadout).toHaveTextContent('Score validity');
    expect(hiringReadout).toHaveTextContent('Risk');
    expect(hiringReadout).toHaveTextContent('Next action');
    expect(hiringReadout).toHaveTextContent('Candidate requested changes');
    expect(hiringReadout).toHaveTextContent('Usable with calibration');
    expect(hiringReadout).toHaveTextContent('Advance with focused probe');
    expect(decision).toHaveTextContent('Candidate signal');
    expect(decision).toHaveTextContent('72/100 Adequate');
    expect(decision).toHaveTextContent('Candidate found the interaction regression and gave a concrete blocking reason, but missed one verification detail.');
    expect(decision).toHaveTextContent('Concrete source-backed blocking comment.');
    expect(decision).toHaveTextContent('Probe how they would validate timing cleanup.');
    expect(decision).toHaveTextContent('Recommended next step');
    expect(decision).toHaveTextContent('Advance with focused probe');
    expect(decision).toHaveTextContent('Verify the growth area in the next live interview before treating this as a clean pass.');
    expect(decision).toHaveTextContent('Uncertainty');
    expect(decision).toHaveTextContent('Focused calibration needed');
    expect(decision).toHaveTextContent('Missing context');
    expect(decision).toHaveTextContent('Probe how they would validate timing cleanup.');
    expect(decision).toHaveTextContent('Score validity');
    expect(decision).toHaveTextContent('Usable with calibration');
    expect(decision).toHaveTextContent('Score, review comments, implementation-author replies, and match proof are present');
    expect(decision).toHaveTextContent('Assignment trust');
    expect(decision).toHaveTextContent('Matched');
    expect(decision).toHaveTextContent('PIPE selected this challenge from source-backed candidate evidence');
    expect(decision).toHaveTextContent('Use the annotated lines and implementation-author replies to judge whether the requested changes are concrete, source-backed, and worth blocking the PR.');
    expect(decision).toHaveTextContent('Strong assessment fit');
    expect(decision).toHaveTextContent('72/100 Adequate');
    expect(decision).toHaveTextContent('1 implementation-author reply thread');
    const scoreSummary = screen.getByTestId('interview-code-review-score-summary');
    expect(scoreSummary).toHaveTextContent('Signal basis');
    expect(scoreSummary).toHaveTextContent('Score report');
    expect(scoreSummary).toHaveTextContent('Scored');
    expect(scoreSummary).toHaveTextContent('Review evidence');
    expect(scoreSummary).toHaveTextContent('1 annotation');
    expect(scoreSummary).toHaveTextContent('Author replies');
    expect(scoreSummary).toHaveTextContent('1 implementation-author reply thread');
    expect(scoreSummary).toHaveTextContent('Match proof');
    expect(scoreSummary).toHaveTextContent('1 bridge');
    const scoreTrust = screen.getByTestId('interview-code-review-score-trust');
    expect(scoreTrust).toHaveTextContent('Score trust');
    expect(scoreTrust).toHaveTextContent('Valid because');
    expect(scoreTrust).toHaveTextContent('Scored review');
    expect(scoreTrust).toHaveTextContent('1 annotation');
    expect(scoreTrust).toHaveTextContent('1 implementation-author reply thread');
    expect(scoreTrust).toHaveTextContent('1 evidence bridge');
    expect(scoreTrust).toHaveTextContent('strong match gate');
    expect(scoreTrust).toHaveTextContent('Calibrate because');
    expect(scoreTrust).toHaveTextContent('adequate band');
    expect(scoreTrust).toHaveTextContent('Probe how they would validate timing cleanup.');
    expect(scoreTrust).toHaveTextContent('Score provenance');
    expect(scoreTrust).toHaveTextContent('6 rubric dimensions');
    expect(scoreTrust).toHaveTextContent('2 evidence items');
    expect(scoreTrust).toHaveTextContent('5 scoring metrics');
    expect(scoreTrust).toHaveTextContent('Use as');
    expect(scoreTrust).toHaveTextContent('source-backed signal, not an automatic decision');
    expect(screen.queryByTestId('interview-assessment-progress')).toBeNull();
    expect(decision).not.toHaveTextContent('Not started');
    expect(decision).not.toHaveTextContent('No assessment session');
    expect(screen.queryByText('Call record')).toBeNull();
    expect(screen.queryByText('Not recorded yet')).toBeNull();
    expect(screen.queryByText('Confidence')).toBeNull();
    expect(screen.queryByTestId('interview-code-review-evidence-plan')).toBeNull();

    const qualityGate = screen.getByTestId('interview-code-review-match-quality');
    expect(qualityGate).not.toHaveAttribute('open');
    expect(qualityGate.querySelector('summary')).toHaveTextContent('Assessment quality gate');
    expect(qualityGate.querySelector('summary')).toHaveTextContent('STRONG · 10/12 · 1 rubric check');

    const sourceProof = screen.getByText('Source proof').closest('details');
    expect(sourceProof).not.toHaveAttribute('open');
    expect(sourceProof?.querySelector('summary')).toHaveTextContent(
      'candidate-repo evidence bridges, candidate evidence, role evidence, repo evidence, and scoring provenance',
    );
  });

  it('labels failed code-review scoring as unavailable instead of pending', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        matchedRepoId: 973,
        submissionJson: JSON.stringify({
          type: 'CODE_REVIEW',
          verdict: 'request_changes',
          summary: 'Candidate requested changes with one concrete blocker.',
          annotations: [
            {
              file: 'packages/react/src/popover/root/usePopoverRoot.ts',
              line: 60,
              severity: 'major',
              comment: 'Add a regression test for impatient trigger clicks.',
            },
          ],
          transcript: {
            rounds: [
              {
                round: 1,
                reviewer_comments: [
                  {
                    id: 'comment-1',
                    file: 'packages/react/src/popover/root/usePopoverRoot.ts',
                    line: 60,
                    severity: 'major',
                    comment: 'Add a regression test for impatient trigger clicks.',
                  },
                ],
                implementer_responses: [
                  {
                    to_comment_id: 'comment-1',
                    move: 'comment',
                    content: 'Good catch. I will add coverage around the impatient click path.',
                  },
                ],
              },
            ],
          },
        }),
        codeReviewMatch: {
          status: 'MATCHED',
          matchRunId: 'match-run-score-failed',
          packetId: 'packet-score-failed',
          summary: 'Matched source-backed React interaction evidence to the Base UI popover PR.',
          score: 0.82,
          assessmentQuality: {
            verdict: 'STRONG',
            score: 10,
            maxScore: 12,
            metrics: [],
          },
          reviewProfile: null,
          validatorAgent: {
            agentName: 'quality-gate',
            agentVersion: '1',
            mode: 'source_backed',
            verdict: 'PASSED',
            rationale: 'The match is grounded in candidate and repo evidence.',
            checks: [],
            sourceBridge: {
              prNumber: 973,
              candidateSourceCount: 2,
              roleSourceCount: 0,
              repoSourceCount: 4,
              alignedDemandCount: 4,
              stretchCount: 0,
              provenanceComplete: true,
            },
          },
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [
            {
              relation: 'candidate_repo_evidence_alignment',
              label: 'Candidate evidence bridge 1',
              pairScore: 0.74,
              nodes: [
                {
                  kind: 'person_evidence',
                  label: 'Person evidence',
                  sourceRef: {
                    exactText: 'Reviewed React popover timing behavior.',
                    locator: 'resume:span-1',
                  },
                },
                {
                  kind: 'repo_challenge',
                  label: 'Repo challenge',
                  sourceRef: {
                    exactText: 'click = useClick(context, { enabled: clickEnabled })',
                    locator: 'packages/react/src/popover/root/usePopoverRoot.ts',
                  },
                },
              ],
            },
          ],
          gaps: [],
        },
        codeReviewScore: {
          reviewSessionId: 'review-session-score-failed',
          status: 'scoring_failed',
          score: null,
          band: null,
          narrative: null,
          strengths: [],
          growthAreas: [],
          updatedAt: '2026-06-23T01:00:00.000Z',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const decision = screen.getByTestId('interview-code-review-decision-summary');
    const hiringReadout = screen.getByTestId('interview-code-review-hiring-readout');
    expect(hiringReadout).toHaveTextContent('Score unavailable');
    expect(hiringReadout).toHaveTextContent('Retry scoring or review manually');
    expect(decision).toHaveTextContent('Score validity');
    expect(decision).toHaveTextContent('Score unavailable');
    expect(decision).toHaveTextContent('Scoring failed, so this assessment is not a scored hiring signal.');
    expect(decision).toHaveTextContent('Recommended next step');
    expect(decision).toHaveTextContent('Retry scoring or review manually');
    expect(decision).toHaveTextContent('Submitted review can be read as source-backed raw evidence');
    expect(decision).toHaveTextContent('Uncertainty');
    expect(decision).toHaveTextContent('Score unavailable');
    expect(decision).toHaveTextContent('no scored assessment should drive a hiring decision');
    expect(decision).not.toHaveTextContent('Wait for scoring');
    expect(decision).not.toHaveTextContent('scoring pending');
  });

  it('labels manual repo tasks as assignment evidence, not automatic candidate-fit proof', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        githubRepoUrl: 'https://github.com/pipe/manual-task',
        githubPrNumber: null,
        assessmentSetup: {
          status: 'reviewable_task_assigned',
          kind: 'manual_open_source_task',
          source: 'recruiter_manual_override',
          blocksPositiveAssessment: false,
          message: 'A recruiter supplied a repo-only task packet.',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const assignmentTrust = screen.getByTestId('interview-review-assignment-trust');
    expect(assignmentTrust).toHaveTextContent('Manual task');
    expect(assignmentTrust).toHaveTextContent('not as proof that PIPE automatically matched the candidate');
    const assessmentAssignment = screen.getByTestId('interview-assessment-assignment');
    expect(assessmentAssignment).toHaveTextContent('Manual task assignment');
    expect(assessmentAssignment).toHaveTextContent('A recruiter supplied a repo-only task packet.');
    expect(assessmentAssignment).not.toHaveTextContent('PIPE-matched challenge');
    expect(screen.queryByTestId('interview-code-review-decision-summary')).toBeNull();
  });

  it('keeps manual scored PR proof wording honest and deduped', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        candidateId: 'candidate-manual-1',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        submissionJson: JSON.stringify({
          type: 'CODE_REVIEW',
          verdict: 'request_changes',
          summary: 'Candidate requested changes with one concrete blocker.',
          annotations: [
            { file: 'packages/react/src/popover/root/usePopoverRoot.ts', line: 60, comment: 'Add a regression test.' },
          ],
          transcript: {
            rounds: [
              {
                round: 1,
                reviewer_comments: [
                  { id: 1, file: 'packages/react/src/popover/root/usePopoverRoot.ts', line: 60, comment: 'Add a regression test.' },
                ],
                implementer_responses: [
                  { to_comment_id: 1, move: 'comment', content: 'Good catch. I will add coverage.' },
                ],
              },
            ],
          },
        }),
        codeReviewMatch: {
          status: 'MATCHED',
          matchRunId: 'manual-match-run',
          packetId: 'manual-packet',
          summary: 'Manual override: recruiter-selected source-backed review challenge.',
          score: null,
          assessmentQuality: {
            verdict: 'USABLE',
            score: 8,
            maxScore: 12,
            metrics: [
              {
                id: 'pr_reviewability',
                label: 'PR reviewability',
                score: 2,
                maxScore: 2,
                reason: 'The selected PR has a concrete behavior diff.',
              },
            ],
          },
          reviewProfile: null,
          validatorAgent: {
            agentName: 'quality-gate',
            agentVersion: '1',
            mode: 'manual_override',
            verdict: 'PASSED',
            rationale: 'The PR is source-backed and reviewable, but no candidate-fit inference was made.',
            checks: [],
            sourceBridge: null,
          },
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: [],
        },
        codeReviewScore: {
          reviewSessionId: 'manual-review-session',
          status: 'scored',
          score: 68,
          band: 'adequate',
          narrative: 'Candidate found one issue but missed implementation risks.',
          strengths: ['Concrete blocker.'],
          growthAreas: ['Probe implementation trade-offs.'],
          provenance: {
            rubricDimensionCount: 6,
            evidenceItemCount: 6,
            metricCount: 8,
          },
          updatedAt: '2026-06-23T01:00:00.000Z',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const decision = screen.getByTestId('interview-code-review-decision-summary');
    expect(decision).toHaveTextContent('Review assignment fairness before advancing');
    expect(decision).not.toHaveTextContent('Advance with focused probe');
    const scoreValidity = screen.getByTestId('interview-code-review-score-validity');
    expect(scoreValidity).toHaveTextContent('Usable with assignment calibration');
    expect(scoreValidity).toHaveTextContent('manual PR selection does not prove candidate-fit');
    expect(scoreValidity).toHaveTextContent('Calibrate assignment fairness before making a hiring decision');
    const scoreTrust = screen.getByTestId('interview-code-review-score-trust');
    expect(scoreTrust).toHaveTextContent('usable match gate');
    const gateMentions = scoreTrust.textContent?.match(/usable match gate/g) ?? [];
    expect(gateMentions).toHaveLength(1);
    expect(scoreTrust).toHaveTextContent('no rendered source bridge');
    const scoreSummary = screen.getByTestId('interview-code-review-score-summary');
    expect(scoreSummary).toHaveTextContent('Match proof');
    expect(scoreSummary).toHaveTextContent('Assignment evidence only');
    expect(scoreSummary).not.toHaveTextContent('8/12 Usable');
    const explanation = screen.getByTestId('interview-code-review-match-explanation');
    expect(explanation).toHaveTextContent('Quality gate 8/12 Usable');
    expect(explanation).toHaveTextContent('no rendered source bridge is available');
    expect(explanation).toHaveTextContent('treat this as assignment evidence until exact candidate, role, and repo spans are visible');

    const sourceProof = screen.getByText('Source proof').closest('details');
    expect(sourceProof).not.toHaveAttribute('open');
    expect(sourceProof?.querySelector('summary')).toHaveTextContent('repo challenge proof and scoring provenance');
    expect(sourceProof?.querySelector('summary')).not.toHaveTextContent('candidate, role, repo');

    fireEvent.click(screen.getAllByTestId('interview-open-person-profile')[0]!);
    const state = screen.getByTestId('person-route-state').textContent ?? '';
    const routeState = JSON.parse(state) as {
      selectedCodeReviewDecision?: {
        basisItems?: Array<{ label: string; value: string; satisfied: boolean }>;
      };
    };
    expect(routeState.selectedCodeReviewDecision?.basisItems).toContainEqual({
      label: 'Match proof',
      value: 'Assignment evidence only',
      satisfied: false,
    });
  });

  it('shows assessment progress as a quiet hiring-manager snapshot', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        assessmentProgress: {
          session: {
            id: 'assessment-session-progress-detail',
            ingestionKey: 'assessment-session:progress-detail',
            interviewId: 'interview-1',
            candidateId: 'candidate-1',
            workspaceId: 'workspace-1',
            workspacePersonId: null,
            applicationId: null,
            mode: 'CODE_REVIEW',
            state: 'EVALUATED',
            createdAt: '2026-06-23T00:00:00.000Z',
            updatedAt: '2026-06-23T00:10:00.000Z',
          },
          stage: 'EVALUATED',
          nextAction: 'NONE',
          nextActionLabel: 'No further assessment action is required.',
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
          evidenceCounts: [
            { kind: 'recruiter_note', count: 1 },
            { kind: 'commit_submission', count: 1 },
          ],
          sourceRefCounts: [
            { kind: 'git_commit', count: 1 },
            { kind: 'code_diff', count: 1 },
            { kind: 'test_run', count: 1 },
          ],
          challenge: {
            sourceRefType: 'review_challenge_packet',
            sourceRefId: 'challenge-packet-progress-detail',
            evidenceRole: 'assigned_challenge',
            exactText: [
              'Repo: https://github.com/open-source/widgets',
              'Base commit: 5555555555555555555555555555555555555555',
              'Task: fix the popover cleanup regression.',
              'Success: commit a focused patch with tests.',
            ].join('\n'),
            locator: {
              repositoryUrl: 'https://github.com/open-source/widgets',
            },
          },
          latestEvent: {
            id: 'assessment-event-progress-commit',
            kind: 'commit_submission',
            sequence: 2,
            occurredAt: '2026-06-23T00:05:00.000Z',
          },
          commit: {
            eventId: 'assessment-event-progress-commit',
            repositoryUrl: 'https://github.com/open-source/widgets',
            forkRepositoryUrl: 'https://github.com/candidate/widgets',
            branchName: 'pipe-assessment/popover-cleanup',
            baseCommitSha: '5555555555555555555555555555555555555555',
            commitSha: 'ffffffffffffffffffffffffffffffffffffffff',
            commitUrl: 'https://github.com/candidate/widgets/commit/ffffffffffffffffffffffffffffffffffffffff',
            changedFiles: [{ path: 'src/popover.ts', status: 'modified' }],
            occurredAt: '2026-06-23T00:05:00.000Z',
          },
          evaluation: {
            id: 'assessment-report-progress',
            status: 'EVALUATED',
            summary: 'Candidate fixed the regression and added focused tests.',
            createdAt: '2026-06-23T00:09:00.000Z',
          },
          humanDecision: {
            eventId: 'assessment-human-decision-progress',
            decision: 'advance',
            reviewerId: 'recruiter-progress',
            summary: 'Human reviewer advances after checking the source-backed report.',
            notes: 'Diff and tests support the final decision.',
            occurredAt: '2026-06-23T00:12:00.000Z',
            sourceRefCount: 1,
            sourceRefTypes: ['assessment_evaluation_report'],
          },
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const progress = screen.getByTestId('interview-assessment-progress');
    expect(progress).toHaveTextContent('Assessment progress');
    expect(progress).toHaveTextContent('Evaluated');
    expect(progress).toHaveTextContent('No further assessment action is required.');
    expect(progress).toHaveTextContent('challenge, chat, workspace telemetry, tool activity, commit, AI use, transcript, tests');
    expect(progress).toHaveTextContent('1 Test run');
    expect(progress).toHaveTextContent('ffffffffff');
    expect(progress).toHaveTextContent('fix the popover cleanup regression.');
    expect(progress).toHaveTextContent('Candidate fixed the regression and added focused tests.');
    expect(progress).toHaveTextContent('Human: advance');
    expect(progress).toHaveTextContent('Human reviewer advances after checking the source-backed report.');
    expect(progress).toHaveTextContent('1 source ref');
    expect(progress).not.toHaveTextContent('assessment-session-progress-detail');
    expect(progress).not.toHaveTextContent('assessment-human-decision-progress');
    expect(progress).not.toHaveTextContent('recruiter-progress');
    expect(progress).not.toHaveTextContent('challenge-packet-progress-detail');
  });

  it('labels blocked code-review matching as an assignment issue, not a candidate delay', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        codeReviewMatch: {
          status: 'NEEDS_MORE_EVIDENCE',
          matchRunId: 'match-run-blocked-1',
          packetId: null,
          summary: 'No quality-gated source-backed PR challenge was selected.',
          score: 0,
          assessmentQuality: null,
          reviewProfile: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: ['The deterministic repo matcher did not return a quality-gated PR.'],
          evidencePlan: [{
            id: 'candidate-source-evidence:NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
            missingSignal: 'Source-backed candidate work evidence',
            whyItMatters: 'PIPE cannot fairly select a real PR challenge until it has evidence of what kinds of engineering work this person has actually done.',
            recommendedAssessment: 'recorded_evidence_question',
            expectedEvidence: 'A short recorded or written answer with a concrete project, personal actions, technical constraints, and verification details.',
            question: SOURCE_BACKED_WORK_EVIDENCE_QUESTION,
            source: {
              matchRunId: 'match-run-blocked-1',
              matchStatus: 'NEEDS_MORE_EVIDENCE',
              gap: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
            },
          }],
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const decision = screen.getByTestId('interview-code-review-decision-summary');
    expect(decision).toHaveTextContent('No confident repo match yet');
    const hiringReadout = screen.getByTestId('interview-code-review-hiring-readout');
    expect(hiringReadout).toHaveTextContent('Hiring manager readout');
    expect(hiringReadout).toHaveTextContent('Needs evidence');
    expect(hiringReadout).toHaveTextContent('Do not rely on score yet');
    expect(hiringReadout).toHaveTextContent('Repo fit not proven');
    expect(hiringReadout).toHaveTextContent('Schedule evidence call');
    expect(hiringReadout).toHaveTextContent(SOURCE_BACKED_WORK_EVIDENCE_QUESTION);
    expect(decision).toHaveTextContent('Resolve the source-backed match quality gate before sending or trusting this code-review assignment.');
    expect(decision).toHaveTextContent('NEEDS MORE EVIDENCE');
    expect(decision).toHaveTextContent('resolve missing evidence');
    expect(decision).toHaveTextContent('Recommended next step');
    expect(decision).toHaveTextContent('Schedule evidence call');
    expect(decision).toHaveTextContent('Ask:');
    expect(decision).toHaveTextContent(SOURCE_BACKED_WORK_EVIDENCE_QUESTION);
    expect(decision).toHaveTextContent('Uncertainty');
    expect(decision).toHaveTextContent('Repo fit not proven');
    expect(decision).toHaveTextContent('Missing context');
    expect(decision).toHaveTextContent('The deterministic repo matcher did not return a quality-gated PR.');
    expect(decision).toHaveTextContent('Score validity');
    expect(decision).toHaveTextContent('Do not rely on score yet');
    expect(decision).toHaveTextContent('Repo fit is not source-backed');
    const explanation = screen.getByTestId('interview-code-review-match-explanation');
    expect(explanation).toHaveTextContent('Why this challenge');
    expect(explanation).toHaveTextContent('NEEDS MORE EVIDENCE');
    expect(explanation).toHaveTextContent('Why selected');
    expect(explanation).toHaveTextContent('No quality-gated source-backed PR challenge was selected.');
    expect(explanation).toHaveTextContent('Valid because');
    expect(explanation).toHaveTextContent('Missing: The deterministic repo matcher did not return a quality-gated PR.');
    expect(explanation).toHaveTextContent('Do not over-trust because');
    expect(explanation).toHaveTextContent('Repo fit is not source-backed');
    expect(explanation).toHaveTextContent('Remaining question');
    expect(explanation).toHaveTextContent('No quality-gated source-backed PR challenge was selected.');
    expect(decision).not.toHaveTextContent('Waiting for candidate review');
    const evidencePlan = screen.getByTestId('interview-code-review-evidence-plan');
    expect(evidencePlan).toHaveTextContent('Resolve missing evidence');
    expect(evidencePlan).toHaveTextContent('Evidence to collect');
    expect(evidencePlan).not.toHaveTextContent('Recommended next step');
    expect(evidencePlan).toHaveTextContent('Plan a follow-up assessment');
    expect(evidencePlan).toHaveTextContent('Use the answer to rerun repo matching.');
    expect(evidencePlan).toHaveTextContent('What PIPE needs');
    expect(evidencePlan).toHaveTextContent('Source-backed candidate work evidence');
    expect(evidencePlan).toHaveTextContent('What to ask');
    expect(evidencePlan).toHaveTextContent(SOURCE_BACKED_WORK_EVIDENCE_QUESTION);
    expect(evidencePlan).toHaveTextContent('What good evidence looks like');
    expect(evidencePlan).toHaveTextContent('A short recorded or written answer with a concrete project, personal actions, technical constraints, and verification details.');
    expect(evidencePlan).toHaveTextContent('CREATE FOLLOW-UP ASSESSMENT');
  });

  it('treats matched code-review PRs with needs-review quality as unsafe assignments', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        codeReviewMatch: {
          status: 'MATCHED',
          matchRunId: 'match-run-needs-review',
          packetId: 'packet-needs-review',
          summary: 'Matched 5 source-backed demands (0 stretch).',
          score: 0.91,
          assessmentQuality: {
            verdict: 'NEEDS_REVIEW',
            score: 9,
            maxScore: 12,
            metrics: [{
              id: 'contrast_separation',
              label: 'Contrast separation',
              score: 0,
              maxScore: 2,
              reason: 'The selected challenge leads the next comparable challenge by 1%.',
            }],
          },
          reviewProfile: null,
          validatorAgent: {
            agentName: 'quality-gate',
            agentVersion: '1',
            mode: 'source_backed',
            verdict: 'NEEDS_REVIEW',
            rationale: 'The selected PR is source-backed, but contrast separation is too weak.',
            checks: [],
            sourceBridge: {
              prNumber: 973,
              candidateSourceCount: 5,
              roleSourceCount: 1,
              repoSourceCount: 17,
              alignedDemandCount: 5,
              stretchCount: 0,
              provenanceComplete: true,
            },
          },
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: ['The selected challenge leads the next comparable challenge by 1%.'],
          evidencePlan: [],
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const decision = screen.getByTestId('interview-code-review-decision-summary');
    expect(decision).toHaveTextContent('No confident repo match yet');
    expect(decision).toHaveTextContent('No safe challenge');
    expect(decision).toHaveTextContent('Review challenge assignment');
    expect(decision).toHaveTextContent('Do not rely on score yet');
    expect(decision).toHaveTextContent('The selected challenge leads the next comparable challenge by 1%.');
    expect(decision).not.toHaveTextContent('The PR assignment is ready. Wait for the candidate review');
  });

  it('keeps accumulated person context out of the meeting evidence timeline', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        contactId: 'stale-contact-id',
        livingContext: {
          person: {
            personId: 'person-graph-1',
            workspacePersonId: 'workspace-person-1',
            applicationId: 'application-1',
            displayName: 'Ada Candidate',
            primaryEmail: 'ada@example.com',
            primaryPhone: null,
            relationshipSummary: null,
            applicationStatus: null,
            pipelineId: null,
            roles: [],
          },
          summary: {
            interactionCount: 3,
            artifactCount: 4,
            contextRecordCount: 2,
            assertionCount: 1,
            signalCount: 1,
            sourceSpanCount: 5,
          },
          interactions: [
            {
              id: 'interaction-evidence-call',
              interactionType: 'code_review_context_call_recommendation',
              externalReference: 'interview-code-review-blocked',
              startedAt: '2026-06-24T15:30:00.000Z',
              endedAt: null,
              createdAt: '2026-06-24T15:30:00.000Z',
              updatedAt: '2026-06-24T15:30:00.000Z',
              metadata: {
                matchStatus: 'NEEDS_MORE_EVIDENCE',
                contextCallInterviewId: 'context-call-1',
              },
              artifactIds: ['artifact-1'],
              contextRecordIds: ['record-1'],
              assertionIds: [],
              signalKeys: ['term:react-review'],
            },
            {
              id: 'interaction-invite',
              interactionType: 'scheduled_interview_invite_delivery',
              externalReference: 'interview-1',
              startedAt: '2026-06-23T00:00:00.000Z',
              endedAt: null,
              createdAt: '2026-06-23T00:00:00.000Z',
              updatedAt: '2026-06-23T00:00:00.000Z',
              metadata: {
                emailSent: true,
                deliveredUrl: 'https://app-dev.hire-pipe.com/assess/token',
              },
              artifactIds: ['artifact-2'],
              contextRecordIds: ['record-2'],
              assertionIds: ['assertion-1'],
              signalKeys: [],
            },
          ],
          artifacts: [],
          contextRecords: [],
          assertions: [],
          signals: [],
          relationships: [],
        },
        relatedEvidenceInterviews: [
          {
            id: 'context-call-1',
            relationship: 'code_review_evidence_follow_up',
            interviewType: 'VIDEO',
            meetingType: 'SCREENING_INTERVIEW',
            status: 'INVITED',
            scheduledAt: null,
            candidateId: 'candidate-1',
            contactId: null,
            displayName: 'Ada Candidate',
            primaryEmail: 'ada@example.com',
            linkedMeetingId: 'meeting-context-1',
            transcriptStatus: 'NONE',
            assessmentSessionId: 'assessment-plan-1',
            assessmentSessionState: 'IN_PROGRESS',
            createdAt: '2026-06-24T15:35:00.000Z',
            updatedAt: '2026-06-24T15:35:00.000Z',
          },
          {
            id: 'interview-second-code-review',
            relationship: 'same_person_assessment',
            interviewType: 'CODE_REVIEW',
            meetingType: null,
            status: 'INVITED',
            scheduledAt: null,
            candidateId: 'candidate-2',
            contactId: null,
            displayName: null,
            primaryEmail: 'ada@example.com',
            linkedMeetingId: null,
            transcriptStatus: null,
            assessmentSessionId: null,
            assessmentSessionState: null,
            createdAt: '2026-06-24T16:00:00.000Z',
            updatedAt: '2026-06-24T16:00:00.000Z',
          },
          {
            id: 'interview-background-call',
            relationship: 'same_person_assessment',
            interviewType: 'VIDEO',
            meetingType: 'DIRECT_VIDEO_CALL',
            status: 'COMPLETED',
            scheduledAt: null,
            candidateId: 'candidate-3',
            contactId: null,
            displayName: 'Background call',
            primaryEmail: 'ada@example.com',
            linkedMeetingId: 'meeting-background',
            transcriptStatus: 'READY',
            assessmentSessionId: null,
            assessmentSessionState: null,
            createdAt: '2026-06-24T17:00:00.000Z',
            updatedAt: '2026-06-24T17:00:00.000Z',
          },
          {
            id: 'interview-dev-challenge',
            relationship: 'same_person_assessment',
            interviewType: 'DEV_CONTAINER_CHALLENGE',
            meetingType: null,
            status: 'INVITED',
            scheduledAt: null,
            candidateId: 'candidate-4',
            contactId: null,
            displayName: 'Dev challenge',
            primaryEmail: 'ada@example.com',
            linkedMeetingId: null,
            transcriptStatus: null,
            assessmentSessionId: 'assessment-dev-1',
            assessmentSessionState: 'READY',
            createdAt: '2026-06-24T18:00:00.000Z',
            updatedAt: '2026-06-24T18:00:00.000Z',
          },
          {
            id: 'interview-hidden-extra',
            relationship: 'same_person_assessment',
            interviewType: 'SCREENING',
            meetingType: 'SCREENING_INTERVIEW',
            status: 'INVITED',
            scheduledAt: null,
            candidateId: 'candidate-5',
            contactId: null,
            displayName: 'Hidden extra context',
            primaryEmail: 'ada@example.com',
            linkedMeetingId: null,
            transcriptStatus: null,
            assessmentSessionId: null,
            assessmentSessionState: null,
            createdAt: '2026-06-24T19:00:00.000Z',
            updatedAt: '2026-06-24T19:00:00.000Z',
          },
        ],
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const relationship = screen.getByTestId('interview-person-context-relationship');
    expect(relationship).toHaveTextContent('Person context rollup');
    expect(relationship).toHaveTextContent('3 evidence moments on the person profile');
    expect(relationship).toHaveTextContent('This meeting remains scoped to its own invite, room, transcript, and assessment evidence.');
    const related = screen.getByTestId('interview-related-evidence-interviews');
    expect(related).toHaveTextContent('Other interviews for this person');
    expect(related).toHaveTextContent('These are separate interviews on the same person graph. Open the person profile for the full cross-meeting view.');
    const relatedSummary = screen.getByTestId('interview-related-evidence-summary');
    expect(relatedSummary).toHaveTextContent('Evidence follow-up is already linked');
    expect(relatedSummary).toHaveTextContent('Use it to capture the missing person context, then rerun repo matching from source-backed evidence.');
    expect(relatedSummary).toHaveTextContent('Open the linked follow-up before creating another interview.');
    expect(relatedSummary).toHaveTextContent('1');
    expect(relatedSummary).toHaveTextContent('follow-ups');
    expect(relatedSummary).toHaveTextContent('2');
    expect(relatedSummary).toHaveTextContent('technical assessments');
    expect(relatedSummary).toHaveTextContent('1');
    expect(relatedSummary).toHaveTextContent('ready transcripts');
    expect(related).toHaveTextContent('Showing 4 of 5 related context previews.');
    expect(related).toHaveTextContent('Open full person graph');
    expect(related).toHaveTextContent('Evidence follow-up');
    expect(related).toHaveTextContent('assessment in progress');
    expect(related).toHaveTextContent('meeting room attached');
    expect(related).not.toHaveTextContent('meeting-context-1');
    expect(related).toHaveTextContent('Other code review');
    expect(related).not.toHaveTextContent('Same person assessment');
    expect(related).toHaveTextContent('ada@example.com');
    expect(related).toHaveTextContent('Code review');
    expect(related).toHaveTextContent('Background call');
    expect(related).toHaveTextContent('Dev challenge');
    expect(related).not.toHaveTextContent('Hidden extra context');
    expect(related).not.toHaveTextContent('interview-second-code-review');
    fireEvent.click(screen.getAllByTestId('interview-open-person-profile')[0]!);
    expect(screen.getByTestId('person-route-echo')).toHaveTextContent('person-graph-1');
    expect(screen.queryByTestId('interview-person-context-timeline')).toBeNull();
    expect(screen.queryByText('Code Review Context Call Recommendation')).toBeNull();
    expect(screen.queryByText('Scheduled Interview Invite Delivery')).toBeNull();
  });

  it('keeps the single-meeting scope visible before person context exists', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        contactId: 'person-without-context',
        recipientName: 'Sparse Candidate',
        recipientEmail: 'sparse@example.com',
        livingContext: null,
        relatedEvidenceInterviews: [],
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const relationship = screen.getByTestId('interview-person-context-relationship');
    expect(relationship).toHaveTextContent('Person context rollup');
    expect(relationship).toHaveTextContent('0 evidence moments on the person profile');
    expect(relationship).toHaveTextContent('This meeting remains scoped to its own invite, room, transcript, and assessment evidence.');
    expect(screen.getByText('Person context will appear after PIPE has exact source evidence from the invite, transcript, assessment, or code-review material.')).toBeVisible();
    expect(screen.queryByTestId('interview-related-evidence-interviews')).toBeNull();
  });

  it('labels repo-only code-review rows as setup gaps instead of assignments', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'ACTIVE',
        recipientName: 'Bob',
        recipientEmail: 'bob@example.com',
        githubRepoUrl: 'https://github.com/Jorybraun/agentic-engineering-book',
        githubPrNumber: null,
        matchedRepoId: null,
        assessmentSetup: {
          status: 'waiting_for_candidate_evidence',
          kind: 'auto_match',
          source: 'contact_first_invite',
          blocksPositiveAssessment: true,
          message: 'This contact-first assessment invite has no candidate evidence yet.',
          nextAction: 'COLLECT_CANDIDATE_EVIDENCE',
          nextActionLabel: 'Send the intake link or schedule a context call.',
          lastDeliveredUrl: null,
          lastDeliveredUrlState: null,
          lastDeliveredUrlMessage: null,
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    expect(screen.queryByText('Review assignment')).toBeNull();
    const setupGap = screen.getByText('Assignment setup gap').closest('section');
    expect(setupGap).toHaveTextContent('Draft repository');
    expect(setupGap).toHaveTextContent('Jorybraun/agentic-engineering-book');
    expect(setupGap).toHaveTextContent('Why it is not ready');
    expect(setupGap).toHaveTextContent("No reviewable PR or source-backed match is attached yet, so this should not be treated as the candidate's code-review assignment.");
    expect(setupGap).toHaveTextContent('Next action');
    expect(setupGap).toHaveTextContent('Send the intake link or schedule a context call.');
  });

  it('shows completed evidence-plan refresh state instead of the old missing-evidence prompt', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        codeReviewMatch: {
          status: 'NEEDS_MORE_EVIDENCE',
          matchRunId: 'match-run-blocked-1',
          packetId: null,
          summary: 'No quality-gated source-backed PR challenge was selected.',
          score: 0,
          assessmentQuality: null,
          reviewProfile: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
          evidencePlan: [{
            id: 'candidate-source-evidence:NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
            missingSignal: 'Source-backed candidate work evidence',
            whyItMatters: 'PIPE cannot fairly select a real PR challenge until it has evidence of what kinds of engineering work this person has actually done.',
            recommendedAssessment: 'recorded_evidence_question',
            expectedEvidence: 'A short recorded or written answer with a concrete project, personal actions, technical constraints, and verification details.',
            question: SOURCE_BACKED_WORK_EVIDENCE_QUESTION,
            source: {
              matchRunId: 'match-run-blocked-1',
              matchStatus: 'NEEDS_MORE_EVIDENCE',
              gap: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
            },
          }],
          evidenceRefresh: {
            status: 'READY_FOR_REPO_MATCH_REFRESH',
            assessmentSessionId: 'assessment-plan-refresh-ready',
            contextCallInterviewId: 'context-call-refresh-ready',
            reportId: 'assessment-report-refresh-ready',
            summary: 'Evidence call captured 3 source-backed transcript spans for repo-match refresh.',
            sourceSpanCount: 3,
            matcherContextCount: 1,
            matchRunId: 'match-run-blocked-1',
            matchStatus: 'NEEDS_MORE_EVIDENCE',
            completedAt: '2026-06-22T19:00:00.000Z',
            updatedAt: '2026-06-22T19:01:00.000Z',
            evidenceSnippets: [{
              eventId: 'assessment-event-refresh-ready-span-1',
              sourceRefId: 'source-span-refresh-ready-1',
              sourceSpanId: 'source-span-refresh-ready-1',
              evidenceRole: 'evidence_plan_response_span',
              exactText: 'I debugged checkout retry idempotency, reviewed the failing PR, and verified duplicate-delivery safeguards with regression tests.',
              occurredAt: '2026-06-22T19:00:30.000Z',
              locator: {
                meetingId: 'meeting-refresh-ready',
                stableSegmentId: 'guest-1',
              },
            }],
          },
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const refresh = screen.getByTestId('interview-code-review-evidence-refresh');
    expect(refresh).toHaveTextContent('New evidence is ready');
    expect(refresh).toHaveTextContent('Rerun repo matching');
    expect(refresh).toHaveTextContent('Captured follow-up assessment');
    expect(refresh).toHaveTextContent('Evidence call captured 3 source-backed transcript spans for repo-match refresh.');
    expect(refresh).toHaveTextContent('3 source-backed transcript spans are linked to this original code-review match.');
    expect(refresh).toHaveTextContent('Use the new source-backed spans to try PR selection again.');
    expect(refresh).toHaveTextContent('Captured source evidence');
    expect(refresh).toHaveTextContent('I debugged checkout retry idempotency, reviewed the failing PR, and verified duplicate-delivery safeguards with regression tests.');
    expect(screen.getByTestId('interview-code-review-refresh-match-cta')).toHaveTextContent('RERUN REPO MATCH');
    expect(screen.getByTestId('interview-code-review-open-evidence-call')).toHaveTextContent('OPEN EVIDENCE CALL');
    expect(screen.queryByTestId('interview-code-review-evidence-plan')).toBeNull();
  });

  it('labels active assessment links without a source-backed PR as profile handoff links', async () => {
    const deliveredUrl = 'https://app-dev.hire-pipe.com/assess/recruiter-visible-token';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        candidateId: 'candidate-1',
        assessmentSetup: {
          status: 'waiting_for_source_backed_match',
          kind: 'auto_match',
          source: 'candidate_id',
          blocksPositiveAssessment: true,
          message: 'Candidate evidence is available for matching, but no source-backed PR task has been assigned yet.',
          lastDeliveredUrl: deliveredUrl,
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const linkPanel = screen.getByTestId('interview-assessment-link');
    expect(linkPanel).toHaveTextContent('Assessment invite');
    expect(linkPanel).toHaveTextContent('Candidate assessment link');
    expect(linkPanel).toHaveTextContent('Candidate evidence is available for matching, but no source-backed PR task has been assigned yet.');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Active');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Copyable one-use link');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('ASSESSMENT');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Profile handoff, no PR challenge');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('RECIPIENT');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Ada Candidate · ada@example.com');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Assign or refresh a source-backed PR before treating this as a code-review assessment.');
    expect(linkPanel).toHaveTextContent('The candidate can use this link for profile intake only; PIPE will show a profile-received handoff until a source-backed PR is assigned.');
    expect(linkPanel).toHaveTextContent('CANDIDATE ASSESSMENT URL');
    expect(screen.getByDisplayValue(deliveredUrl)).toBeTruthy();

    fireEvent.click(screen.getByText('COPY CANDIDATE LINK'));
    await flushAsyncUpdates();

    expect(writeText).toHaveBeenCalledWith(deliveredUrl);
    expect(linkPanel).toHaveTextContent('Assessment link copied.');
  });

  it('uses the selected assessment link input when async clipboard writes may stall', async () => {
    const deliveredUrl = 'https://app-dev.hire-pipe.com/assess/recruiter-visible-token';
    const writeText = vi.fn(() => new Promise<void>(() => undefined));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        candidateId: 'candidate-1',
        assessmentSetup: {
          status: 'waiting_for_source_backed_match',
          kind: 'auto_match',
          source: 'candidate_id',
          blocksPositiveAssessment: true,
          message: 'Candidate evidence is available for matching, but no source-backed PR task has been assigned yet.',
          lastDeliveredUrl: deliveredUrl,
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const input = screen.getByDisplayValue(deliveredUrl);
    fireEvent.click(screen.getByText('COPY CANDIDATE LINK'));
    await flushAsyncUpdates();

    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.activeElement).toBe(input);
    expect(screen.getByTestId('interview-assessment-link')).toHaveTextContent('Assessment link copied.');
  });

  it('labels active open-source assessment room links as controlled workspace links', async () => {
    const deliveredUrl = 'https://room-dev.hire-pipe.com/room/workspace-token';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        candidateId: 'candidate-1',
        assessmentSetup: {
          status: 'reviewable_task_assigned',
          kind: 'github_pr',
          source: 'recruiter_manual_override',
          blocksPositiveAssessment: false,
          message: 'A concrete GitHub repo task was assigned by the recruiter.',
          lastDeliveredUrl: deliveredUrl,
          lastDeliveredUrlState: 'active',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const linkPanel = screen.getByTestId('interview-assessment-link');
    expect(linkPanel).toHaveTextContent('Candidate workspace room link');
    expect(linkPanel).toHaveTextContent('Controlled workspace room invite.');
    expect(linkPanel).toHaveTextContent('video, chat, terminal, code-server, AI use, and commit evidence');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Active');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Copyable workspace room link');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Share the candidate workspace link; open the host room to watch progress.');
    expect(linkPanel).toHaveTextContent('CANDIDATE WORKSPACE ROOM URL');
    expect(linkPanel).toHaveTextContent('COPY WORKSPACE LINK');
    expect(linkPanel).toHaveTextContent('RESEND WORKSPACE INVITE');
    expect(linkPanel).not.toHaveTextContent('Copyable one-use link');
    expect(linkPanel).not.toHaveTextContent('COPY CANDIDATE LINK');
    expect(screen.getByDisplayValue(deliveredUrl)).toBeTruthy();

    fireEvent.click(screen.getByText('COPY WORKSPACE LINK'));
    await flushAsyncUpdates();

    expect(writeText).toHaveBeenCalledWith(deliveredUrl);
    expect(linkPanel).toHaveTextContent('Workspace link copied.');
  });

  it('keeps the assessment link selected when browser clipboard APIs are blocked', async () => {
    const deliveredUrl = 'https://app-dev.hire-pipe.com/assess/recruiter-visible-token';
    const writeText = vi.fn(() => new Promise<void>(() => undefined));
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        candidateId: 'candidate-1',
        assessmentSetup: {
          status: 'waiting_for_source_backed_match',
          kind: 'auto_match',
          source: 'candidate_id',
          blocksPositiveAssessment: true,
          message: 'Candidate evidence is available for matching, but no source-backed PR task has been assigned yet.',
          lastDeliveredUrl: deliveredUrl,
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const input = screen.getByDisplayValue(deliveredUrl);
    fireEvent.click(screen.getByText('COPY CANDIDATE LINK'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(801);
    });
    await flushAsyncUpdates();

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(writeText).toHaveBeenCalledWith(deliveredUrl);
    expect(document.activeElement).toBe(input);
    expect(screen.getByTestId('interview-assessment-link')).toHaveTextContent('Assessment link selected. Press Cmd+C to copy.');
    expect(screen.getByTestId('interview-assessment-link')).not.toHaveTextContent('Copy failed');
  });

  it('treats claimed assessment links as historical and offers resend from code-review interviews', async () => {
    const deliveredUrl = 'https://app-dev.hire-pipe.com/assess/claimed-token';
    const freshUrl = 'https://app-dev.hire-pipe.com/assess/fresh-token';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mocks.api.get
      .mockResolvedValueOnce({
        interview: makeInterview({
          interviewType: 'CODE_REVIEW',
          candidateId: 'candidate-1',
          assessmentSetup: {
            status: 'waiting_for_source_backed_match',
            kind: 'auto_match',
            source: 'candidate_id',
            blocksPositiveAssessment: true,
            message: 'Candidate evidence is available for matching, but no source-backed PR task has been assigned yet.',
            lastDeliveredUrl: deliveredUrl,
            lastDeliveredUrlState: 'claimed',
            lastDeliveredUrlMessage: 'The candidate has already started this one-use assessment link. Resend the invite if they need a fresh link.',
          },
        }),
      })
      .mockResolvedValueOnce({
        interview: makeInterview({
          interviewType: 'CODE_REVIEW',
          candidateId: 'candidate-1',
          assessmentSetup: {
            status: 'waiting_for_source_backed_match',
            kind: 'auto_match',
            source: 'candidate_id',
            blocksPositiveAssessment: true,
            message: 'Candidate evidence is available for matching, but no source-backed PR task has been assigned yet.',
            lastDeliveredUrl: freshUrl,
            lastDeliveredUrlState: 'active',
            lastDeliveredUrlMessage: null,
          },
        }),
      });
    mocks.api.post.mockResolvedValueOnce({
      success: true,
      emailSent: false,
      meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
      deliveredUrl: freshUrl,
    });

    renderDetail();

    await flushAsyncUpdates();
    const linkPanel = screen.getByTestId('interview-assessment-link');
    expect(linkPanel).toHaveTextContent('The candidate started this one-use assessment link, but this interview has no submitted assessment evidence yet.');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Started');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Historical link only');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('ASSESSMENT');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Started, no submission');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('RECIPIENT');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Ada Candidate · ada@example.com');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Resend the invite to issue a fresh one-use assessment link.');
    expect(linkPanel).toHaveTextContent('LAST CANDIDATE ASSESSMENT URL');
    expect(screen.queryByText('COPY CANDIDATE LINK')).toBeNull();
    expect(screen.getByDisplayValue(deliveredUrl)).toBeTruthy();

    fireEvent.click(screen.getByText('RESEND ASSESSMENT INVITE'));
    await flushAsyncUpdates();

    expect(writeText).not.toHaveBeenCalled();
    expect(mocks.api.post).toHaveBeenCalledWith(
      '/api/v1/scheduling/interviews/interview-1/invite',
      { email: 'ada@example.com' },
    );
    expect(screen.getByTestId('interview-assessment-link')).toHaveTextContent('Fresh assessment link is ready.');
    expect(screen.getByDisplayValue(freshUrl)).toBeTruthy();
  });

  it('treats stale workspace room links as historical and blocks copying the old token', async () => {
    const deliveredUrl = 'https://room-dev.hire-pipe.com/room/old-token';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        candidateId: 'candidate-1',
        assessmentSetup: {
          status: 'reviewable_task_assigned',
          kind: 'github_pr',
          source: 'recruiter_manual_override',
          blocksPositiveAssessment: false,
          message: 'A concrete GitHub PR was assigned by the recruiter.',
          lastDeliveredUrl: deliveredUrl,
          lastDeliveredUrlState: 'stale',
          lastDeliveredUrlMessage: 'This is an older delivered assessment link. Resend the invite to deliver the current candidate token.',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const linkPanel = screen.getByTestId('interview-assessment-link');
    expect(linkPanel).toHaveTextContent('This is an older delivered assessment link.');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Stale');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Older room link, do not share');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('ASSESSMENT');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('No current assessment evidence');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Resend the invite before sharing this workspace room link.');
    expect(linkPanel).toHaveTextContent('LAST CANDIDATE WORKSPACE ROOM URL');
    expect(linkPanel).toHaveTextContent('RESEND WORKSPACE INVITE');
    expect(screen.queryByText('COPY WORKSPACE LINK')).toBeNull();
    expect(screen.getByDisplayValue(deliveredUrl)).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('offers repo-match refresh so captured evidence can prepare matcher-visible context', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        codeReviewMatch: {
          status: 'NEEDS_MORE_EVIDENCE',
          matchRunId: 'match-run-blocked-1',
          packetId: null,
          summary: 'No quality-gated source-backed PR challenge was selected.',
          score: 0,
          assessmentQuality: null,
          reviewProfile: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
          evidencePlan: [],
          evidenceRefresh: {
            status: 'READY_FOR_REPO_MATCH_REFRESH',
            assessmentSessionId: 'assessment-plan-refresh-ready',
            contextCallInterviewId: 'context-call-refresh-ready',
            reportId: 'assessment-report-refresh-ready',
            summary: 'Evidence call captured 1 source-backed transcript span for repo-match refresh.',
            sourceSpanCount: 1,
            matcherContextCount: 0,
            matchRunId: 'match-run-blocked-1',
            matchStatus: 'NEEDS_MORE_EVIDENCE',
            completedAt: '2026-06-22T19:00:00.000Z',
            updatedAt: '2026-06-22T19:01:00.000Z',
          },
        },
      }),
    });
    mocks.api.post.mockResolvedValueOnce({
      refreshed: false,
      status: 'NEEDS_MORE_EVIDENCE',
      matchRunId: 'match-run-after-context-repair-attempt',
    });

    renderDetail();

    await flushAsyncUpdates();

    const refresh = screen.getByTestId('interview-code-review-evidence-refresh');
    expect(refresh).toHaveTextContent('Evidence captured, prepare context');
    expect(refresh).toHaveTextContent('Prepare matcher context and rerun');
    expect(refresh).toHaveTextContent('1 source-backed transcript span is linked to this original code-review match.');
    expect(refresh).toHaveTextContent('0 matcher-visible context records are ready for repo matching.');
    const cta = screen.getByTestId('interview-code-review-refresh-match-cta') as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    expect(cta).toHaveTextContent('PREPARE + RERUN MATCH');
    fireEvent.click(cta);
    await flushAsyncUpdates();
    expect(mocks.api.post).toHaveBeenCalledWith(
      '/api/v1/scheduling/interviews/interview-1/code-review-match/refresh',
      {},
    );
  });

  it('shows an existing pending follow-up assessment instead of creating duplicates', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        codeReviewMatch: {
          status: 'NEEDS_MORE_EVIDENCE',
          matchRunId: 'match-run-blocked-1',
          packetId: null,
          summary: 'No quality-gated source-backed PR challenge was selected.',
          score: 0,
          assessmentQuality: null,
          reviewProfile: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
          evidencePlan: [{
            id: 'candidate-source-evidence:NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
            missingSignal: 'Source-backed candidate work evidence',
            whyItMatters: 'PIPE cannot fairly select a real PR challenge until it has evidence of what kinds of engineering work this person has actually done.',
            recommendedAssessment: 'recorded_evidence_question',
            expectedEvidence: 'A short recorded or written answer with a concrete project, personal actions, technical constraints, and verification details.',
            question: SOURCE_BACKED_WORK_EVIDENCE_QUESTION,
            source: {
              matchRunId: 'match-run-blocked-1',
              matchStatus: 'NEEDS_MORE_EVIDENCE',
              gap: 'NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE',
            },
          }],
          evidenceFollowUp: {
            assessmentSessionId: 'assessment-plan-pending-1',
            contextCallInterviewId: 'context-call-pending-1',
            state: 'IN_PROGRESS',
            matchRunId: 'match-run-blocked-1',
            matchStatus: 'NEEDS_MORE_EVIDENCE',
            gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
            questions: [SOURCE_BACKED_WORK_EVIDENCE_QUESTION],
            createdAt: '2026-06-22T18:00:00.000Z',
            updatedAt: '2026-06-22T18:05:00.000Z',
          },
          evidenceRefresh: null,
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const followUp = screen.getByTestId('interview-code-review-evidence-follow-up');
    expect(followUp).toHaveTextContent('Follow-up assessment open');
    expect(followUp).toHaveTextContent('Waiting for source-backed response');
    expect(followUp).toHaveTextContent('Linked evidence interview');
    expect(followUp).toHaveTextContent('Follow-up assessment ready');
    expect(followUp).not.toHaveTextContent('context-call-pending-1');
    expect(followUp).toHaveTextContent('Same person graph');
    expect(followUp).toHaveTextContent('adds source evidence to the original code-review match');
    expect(followUp).toHaveTextContent(SOURCE_BACKED_WORK_EVIDENCE_QUESTION);
    expect(followUp).toHaveTextContent('OPEN FOLLOW-UP ASSESSMENT');
    expect(screen.queryByTestId('interview-code-review-context-call-cta')).toBeNull();
    expect(screen.queryByTestId('interview-code-review-evidence-plan')).toBeNull();
  });

  it('shows blocked follow-up assessment attribution state instead of waiting forever', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        codeReviewMatch: {
          status: 'NEEDS_MORE_EVIDENCE',
          matchRunId: 'match-run-blocked-1',
          packetId: null,
          summary: 'No quality-gated source-backed PR challenge was selected.',
          score: 0,
          assessmentQuality: null,
          reviewProfile: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
          evidencePlan: [],
          evidenceFollowUp: {
            assessmentSessionId: 'assessment-plan-blocked-1',
            contextCallInterviewId: 'context-call-blocked-1',
            state: 'BLOCKED',
            blockedReason: 'Evidence-plan follow-up transcript was summary-only and cannot be attributed to the candidate.',
            matchRunId: 'match-run-blocked-1',
            matchStatus: 'NEEDS_MORE_EVIDENCE',
            gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
            questions: [SOURCE_BACKED_WORK_EVIDENCE_QUESTION],
            createdAt: '2026-06-22T18:00:00.000Z',
            updatedAt: '2026-06-22T18:05:00.000Z',
          },
          evidenceRefresh: null,
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const followUp = screen.getByTestId('interview-code-review-evidence-follow-up');
    expect(followUp).toHaveTextContent('Follow-up needs attribution');
    expect(followUp).toHaveTextContent('Record another answer with clear candidate audio before rerunning matching.');
    expect(followUp).toHaveTextContent('Evidence-plan follow-up transcript was summary-only and cannot be attributed to the candidate.');
    expect(followUp).not.toHaveTextContent('Waiting for source-backed response');
    expect(followUp).toHaveTextContent(SOURCE_BACKED_WORK_EVIDENCE_QUESTION);
    expect(screen.getByTestId('interview-code-review-open-follow-up-assessment')).toHaveTextContent('OPEN FOLLOW-UP ASSESSMENT');
    expect(screen.queryByTestId('interview-code-review-evidence-plan')).toBeNull();
  });

  it('refreshes the code-review match from captured follow-up evidence', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        codeReviewMatch: {
          status: 'NEEDS_MORE_EVIDENCE',
          matchRunId: 'match-run-blocked-1',
          packetId: null,
          summary: 'No quality-gated source-backed PR challenge was selected.',
          score: 0,
          assessmentQuality: null,
          reviewProfile: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
          evidencePlan: [],
          evidenceRefresh: {
            status: 'READY_FOR_REPO_MATCH_REFRESH',
            assessmentSessionId: 'assessment-plan-refresh-ready',
            contextCallInterviewId: 'context-call-refresh-ready',
            reportId: 'assessment-report-refresh-ready',
            summary: 'Evidence call captured 3 source-backed transcript spans for repo-match refresh.',
            sourceSpanCount: 3,
            matcherContextCount: 1,
            matchRunId: 'match-run-blocked-1',
            matchStatus: 'NEEDS_MORE_EVIDENCE',
            completedAt: '2026-06-22T19:00:00.000Z',
            updatedAt: '2026-06-22T19:01:00.000Z',
          },
        },
      }),
    });
    mocks.api.post.mockResolvedValueOnce({
      refreshed: true,
      status: 'MATCHED',
      matchRunId: 'match-run-after-refresh',
      repoId: 77,
      repoUrl: 'https://github.com/pipe-labs/orders',
      prNumber: 314,
      codeReviewMatch: {
        status: 'MATCHED',
        matchRunId: 'match-run-after-refresh',
        packetId: 'packet-refresh-314',
        summary: 'Matched 2 source-backed demands (0 stretch).',
        score: 0.91,
        assessmentQuality: null,
        reviewProfile: null,
        validatorAgent: null,
        roleSources: [],
        evidence: [],
        evidenceHyperedges: [],
        gaps: [],
        evidencePlan: [],
        evidenceRefresh: {
          status: 'READY_FOR_REPO_MATCH_REFRESH',
          assessmentSessionId: 'assessment-plan-refresh-ready',
          contextCallInterviewId: 'context-call-refresh-ready',
          reportId: 'assessment-report-refresh-ready',
          summary: 'Evidence call captured 3 source-backed transcript spans for repo-match refresh.',
          sourceSpanCount: 3,
          matcherContextCount: 1,
          matchRunId: 'match-run-blocked-1',
          matchStatus: 'NEEDS_MORE_EVIDENCE',
          completedAt: '2026-06-22T19:00:00.000Z',
          updatedAt: '2026-06-22T19:01:00.000Z',
        },
      },
    });

    renderDetail();

    await flushAsyncUpdates();
    fireEvent.click(screen.getByTestId('interview-code-review-refresh-match-cta'));
    await flushAsyncUpdates();

    expect(mocks.api.post).toHaveBeenCalledWith(
      '/api/v1/scheduling/interviews/interview-1/code-review-match/refresh',
      {},
    );
    expect(screen.getByTestId('interview-code-review-decision-summary')).toHaveTextContent('MATCHED');
    expect(screen.getByTestId('interview-code-review-match')).toHaveTextContent('MATCHED');
    expect(screen.getByText('Repo match refreshed from captured evidence: pipe-labs/orders PR #314.')).toBeTruthy();
    expect(screen.getByTestId('interview-code-review-evidence-refresh')).toHaveTextContent('Evidence used for current match');
    expect(screen.getByTestId('interview-code-review-evidence-refresh')).toHaveTextContent('These source-backed follow-up spans were used to select the current PR assignment.');
    expect(screen.queryByTestId('interview-code-review-refresh-match-cta')).toBeNull();
  });

  it('shows explicit feedback when refreshed evidence still does not produce a repo match', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
        codeReviewMatch: {
          status: 'NEEDS_MORE_EVIDENCE',
          matchRunId: 'match-run-blocked-1',
          packetId: null,
          summary: 'No quality-gated source-backed PR challenge was selected.',
          score: 0,
          assessmentQuality: null,
          reviewProfile: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
          evidencePlan: [],
          evidenceRefresh: {
            status: 'READY_FOR_REPO_MATCH_REFRESH',
            assessmentSessionId: 'assessment-plan-refresh-ready',
            contextCallInterviewId: 'context-call-refresh-ready',
            reportId: 'assessment-report-refresh-ready',
            summary: 'Evidence call captured 1 source-backed transcript span for repo-match refresh.',
            sourceSpanCount: 1,
            matcherContextCount: 1,
            matchRunId: 'match-run-blocked-1',
            matchStatus: 'NEEDS_MORE_EVIDENCE',
            completedAt: '2026-06-22T19:00:00.000Z',
            updatedAt: '2026-06-22T19:01:00.000Z',
          },
        },
      }),
    });
    mocks.api.post.mockResolvedValueOnce({
      refreshed: false,
      status: 'NEEDS_MORE_EVIDENCE',
      matchRunId: 'match-run-after-refresh-still-blocked',
      codeReviewMatch: {
        status: 'NEEDS_MORE_EVIDENCE',
        matchRunId: 'match-run-blocked-1',
        packetId: null,
        summary: 'PIPE needs more source-backed candidate evidence before assigning a fair code-review challenge.',
        score: null,
        assessmentQuality: null,
        reviewProfile: null,
        validatorAgent: null,
        roleSources: [],
        evidence: [],
        evidenceHyperedges: [],
        gaps: ['NO_SCOREABLE_SOURCE_BACKED_CANDIDATE_EVIDENCE'],
        evidencePlan: [],
        evidenceRefresh: {
          status: 'READY_FOR_REPO_MATCH_REFRESH',
          assessmentSessionId: 'assessment-plan-refresh-ready',
          contextCallInterviewId: 'context-call-refresh-ready',
          reportId: 'assessment-report-refresh-ready',
          summary: 'Evidence call captured 1 source-backed transcript span for repo-match refresh.',
          sourceSpanCount: 1,
          matcherContextCount: 1,
          matchRunId: 'match-run-blocked-1',
          matchStatus: 'NEEDS_MORE_EVIDENCE',
          consumptionReportId: 'assessment-report-consumed-still-blocked',
          consumedByMatchRunId: 'match-run-after-refresh-still-blocked',
          consumedByMatchStatus: 'NEEDS_MORE_EVIDENCE',
          consumedAt: '2026-06-22T19:02:00.000Z',
          completedAt: '2026-06-22T19:00:00.000Z',
          updatedAt: '2026-06-22T19:01:00.000Z',
        },
      },
    });
    mocks.api.post.mockResolvedValueOnce({
      contextCall: {
        id: 'context-call-after-still-blocked',
        originalInterviewId: 'interview-1',
        candidateId: 'candidate-1',
        evidenceAssessmentSessionId: 'assessment-plan-after-still-blocked',
        questions: [SOURCE_BACKED_WORK_EVIDENCE_QUESTION],
        recruiterNotes: 'PIPE context call for blocked code-review matching.',
      },
    });

    renderDetail();

    await flushAsyncUpdates();
    fireEvent.click(screen.getByTestId('interview-code-review-refresh-match-cta'));
    await flushAsyncUpdates();

    expect(mocks.api.post).toHaveBeenCalledWith(
      '/api/v1/scheduling/interviews/interview-1/code-review-match/refresh',
      {},
    );
    expect(screen.getByText('Refresh ran, but matcher returned NEEDS MORE EVIDENCE.')).toBeTruthy();
    expect(screen.getByTestId('interview-code-review-decision-summary')).toHaveTextContent('NEEDS MORE EVIDENCE');
    const refresh = screen.getByTestId('interview-code-review-evidence-refresh');
    expect(refresh).toHaveTextContent('Evidence tried, still insufficient');
    expect(refresh).toHaveTextContent('Capture another concrete source-backed answer before rerunning.');
    expect(refresh).toHaveTextContent('Still missing');
    expect(refresh).toHaveTextContent('NO SCOREABLE SOURCE BACKED CANDIDATE EVIDENCE');
    expect(refresh).toHaveTextContent('Next evidence to collect');
    expect(refresh).toHaveTextContent('Source-backed candidate work evidence');
    expect(refresh).toHaveTextContent('What to ask');
    expect(refresh).toHaveTextContent(SOURCE_BACKED_WORK_EVIDENCE_QUESTION);
    expect(refresh).toHaveTextContent('What good evidence looks like');
    expect(refresh).toHaveTextContent('A concrete project, personal action, technical constraint, and verification detail that can be cited back to the candidate.');
    expect(screen.queryByTestId('interview-code-review-refresh-match-cta')).toBeNull();

    const nextFollowUp = screen.getByTestId('interview-code-review-next-follow-up-cta');
    expect(nextFollowUp).toHaveTextContent('CREATE NEXT FOLLOW-UP ASSESSMENT');
    fireEvent.click(nextFollowUp);
    await flushAsyncUpdates();
    expect(mocks.api.post).toHaveBeenLastCalledWith(
      '/api/v1/scheduling/interviews/interview-1/context-call',
      {},
    );
  });

  it('shows the source-backed follow-up assessment plan on created context-call interviews', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        id: 'context-call-1',
        candidateId: 'candidate-1',
        candidateName: 'Ada Candidate',
        candidateEmail: 'ada@example.com',
        interviewType: 'VIDEO',
        meetingType: 'SCREENING_INTERVIEW',
        status: 'INVITED',
        inviteLinkSentAt: null,
        emailSentAt: null,
        recruiterNotes: evidenceFollowUpNotes(),
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const plan = screen.getByTestId('interview-evidence-follow-up-plan');
    expect(plan).toHaveTextContent('Follow-up assessment plan');
    expect(plan).toHaveTextContent('Original code-review interview');
    expect(plan).toHaveTextContent('interview-code-review-blocked');
    expect(plan).toHaveTextContent('NEEDS MORE EVIDENCE');
    expect(plan).toHaveTextContent('Ask this first');
    expect(plan).toHaveTextContent(SOURCE_BACKED_WORK_EVIDENCE_QUESTION);
    expect(plan).toHaveTextContent('Candidate answer becomes source-backed context for repo matching.');
    expect(plan).toHaveTextContent('The invite includes this question so the call has a concrete purpose.');
  });

  it('opens the living-context person profile when an interview has no contact id', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'OPEN_SOURCE_BUG_FIX',
        candidateId: 'candidate-with-graph',
        contactId: null,
        livingContext: {
          person: {
            personId: 'person-graph-1',
            workspacePersonId: 'workspace-person-1',
            applicationId: 'application-1',
            displayName: 'Ada Candidate',
            primaryEmail: 'ada@example.com',
            primaryPhone: null,
            relationshipSummary: null,
            applicationStatus: null,
            pipelineId: null,
            roles: [],
          },
          summary: {
            interactionCount: 1,
            artifactCount: 1,
            contextRecordCount: 1,
            assertionCount: 0,
            signalCount: 0,
            sourceSpanCount: 1,
          },
          interactions: [],
          artifacts: [],
          contextRecords: [],
          assertions: [],
          signals: [],
          relationships: [],
        },
      }),
    });

    renderDetail();
    await flushAsyncUpdates();

    fireEvent.click(screen.getAllByTestId('interview-open-person-profile')[0]!);

    expect(screen.getByTestId('person-route-echo')).toHaveTextContent('person-graph-1');
  });

  it('passes a compact code-review decision when opening the person profile', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        candidateId: 'candidate-1',
        contactId: null,
        githubRepoUrl: 'https://github.com/acme/widgets',
        githubPrNumber: 42,
        livingContext: {
          person: {
            personId: 'person-code-review-1',
            workspacePersonId: 'workspace-person-1',
            applicationId: 'application-1',
            displayName: 'Ada Candidate',
            primaryEmail: 'ada@example.com',
            primaryPhone: null,
            relationshipSummary: null,
            applicationStatus: null,
            pipelineId: null,
            roles: [],
          },
          summary: {
            interactionCount: 18,
            artifactCount: 19,
            contextRecordCount: 24,
            assertionCount: 18,
            signalCount: 0,
            sourceSpanCount: 25,
          },
          interactions: [],
          artifacts: [],
          contextRecords: [],
          assertions: [],
          signals: [],
          relationships: [],
        },
        codeReviewMatch: {
          status: 'MATCHED',
          matchRunId: 'match-run-1',
          packetId: 'packet-1',
          summary: 'Matched to a source-backed review challenge.',
          score: 0.87,
          assessmentQuality: null,
          reviewProfile: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: [],
          evidencePlan: [],
          evidenceFollowUp: null,
          evidenceRefresh: null,
        },
        codeReviewScore: {
          reviewSessionId: 'review-session-1',
          status: 'scored',
          score: 82,
          band: 'strong',
          narrative: 'Candidate found the missing retry test and defended the review.',
          strengths: ['Found the release-blocking risk.'],
          growthAreas: ['Probe timing trade-offs.'],
          provenance: {
            rubricDimensionCount: 6,
            evidenceItemCount: 2,
            metricCount: 5,
          },
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
      }),
    });

    renderDetail();
    await flushAsyncUpdates();

    fireEvent.click(screen.getAllByTestId('interview-open-person-profile')[0]!);

    expect(screen.getByTestId('person-route-echo')).toHaveTextContent('person-code-review-1');
    const state = screen.getByTestId('person-route-state').textContent ?? '';
    expect(state).toContain('selectedCodeReviewDecision');
    expect(state).toContain('Code-review decision');
    expect(state).toContain('82/100 Strong');
    expect(state).toContain('6 rubric dimensions');
    expect(state).toContain('2 evidence items');
    expect(state).toContain('5 scoring metrics');
    expect(state).toContain('acme/widgets PR #42');
    expect(state).not.toContain('contextRecords":[{');
  });

  it('passes weak code-review scores to the person profile as assignment-fairness decisions', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        candidateId: 'candidate-weak-1',
        contactId: null,
        recipientName: 'Casey Candidate',
        recipientEmail: 'casey@example.com',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        livingContext: {
          person: {
            personId: 'person-weak-code-review-1',
            workspacePersonId: 'workspace-person-weak-1',
            applicationId: 'application-weak-1',
            displayName: 'Casey Candidate',
            primaryEmail: 'casey@example.com',
            primaryPhone: null,
            relationshipSummary: null,
            applicationStatus: null,
            pipelineId: null,
            roles: [],
          },
          summary: {
            interactionCount: 4,
            artifactCount: 6,
            contextRecordCount: 8,
            assertionCount: 3,
            signalCount: 0,
            sourceSpanCount: 10,
          },
          interactions: [],
          artifacts: [],
          contextRecords: [],
          assertions: [],
          signals: [],
          relationships: [],
        },
        codeReviewMatch: {
          status: 'MATCHED',
          matchRunId: 'match-run-weak-1',
          packetId: 'packet-weak-1',
          summary: 'Matched to a source-backed review challenge, but the weak score needs fairness review.',
          score: 0.74,
          assessmentQuality: null,
          reviewProfile: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [],
          gaps: [],
          evidencePlan: [],
          evidenceFollowUp: null,
          evidenceRefresh: null,
        },
        codeReviewScore: {
          reviewSessionId: 'review-session-weak-1',
          status: 'scored',
          score: 42,
          band: 'weak',
          narrative: 'Candidate missed the core regression risk in the review.',
          strengths: [],
          growthAreas: ['Confirm whether the selected PR was fair for their React experience.'],
          provenance: {
            rubricDimensionCount: 6,
            evidenceItemCount: 2,
            metricCount: 5,
          },
          updatedAt: '2026-06-23T00:00:00.000Z',
        },
      }),
    });

    renderDetail();
    await flushAsyncUpdates();

    fireEvent.click(screen.getAllByTestId('interview-open-person-profile')[0]!);

    expect(screen.getByTestId('person-route-echo')).toHaveTextContent('person-weak-code-review-1');
    const state = screen.getByTestId('person-route-state').textContent ?? '';
    expect(state).toContain('selectedCodeReviewDecision');
    expect(state).toContain('42/100 Weak');
    expect(state).toContain('mui/base-ui PR #973');
    expect(state).toContain('Review assignment fairness before rejecting');
    expect(state).toContain('verify whether this reflects candidate ability, assignment fit, or missing context');
    expect(state).not.toContain('Schedule targeted follow-up');
    expect(state).not.toContain('contextRecords":[{');
  });

  it('includes the evidence-plan question when inviting a follow-up assessment candidate', async () => {
    const followUp = makeInterview({
      id: 'context-call-1',
      candidateId: 'candidate-1',
      candidateName: 'Ada Candidate',
      candidateEmail: 'ada@example.com',
      interviewType: 'VIDEO',
      meetingType: 'SCREENING_INTERVIEW',
      status: 'INVITED',
      inviteLinkSentAt: null,
      emailSentAt: null,
      recruiterNotes: evidenceFollowUpNotes(),
    });
    mocks.api.get
      .mockResolvedValueOnce({ interview: followUp })
      .mockResolvedValueOnce({ interview: { ...followUp, inviteLinkSentAt: '2026-06-23T00:05:00.000Z' } });
    mocks.api.post.mockResolvedValueOnce({
      success: true,
      emailSent: false,
      meetingUrl: 'https://room-dev.hire-pipe.com/guest/context-call-1',
      room: {
        id: 'room-context-call-1',
        sessionId: 'session-context-call-1',
        hostUrl: 'https://room-dev.hire-pipe.com/host/context-call-1',
        guestUrl: 'https://room-dev.hire-pipe.com/guest/context-call-1',
        expiresAt: '2026-06-24T00:00:00.000Z',
      },
    });

    renderDetail();

    await flushAsyncUpdates();
    fireEvent.click(screen.getByText('SEND INVITE'));
    await flushAsyncUpdates();

    expect(mocks.api.post).toHaveBeenCalledWith(
      '/api/v1/scheduling/interviews/context-call-1/invite',
      expect.objectContaining({
        email: 'ada@example.com',
        message: expect.stringContaining(SOURCE_BACKED_WORK_EVIDENCE_QUESTION),
      }),
    );
    const invitePayload = mocks.api.post.mock.calls[0]?.[1] as { message?: string };
    expect(invitePayload.message).toContain('source-backed context');
    expect(invitePayload.message).toContain('codebase context');
  });

  it('creates a linked context call from a blocked code-review match', async () => {
    mocks.api.get
      .mockResolvedValueOnce({
        interview: makeInterview({
          id: 'interview-blocked-1',
          candidateId: 'candidate-1',
          candidateName: 'Ada Candidate',
          candidateEmail: 'ada@example.com',
          interviewType: 'CODE_REVIEW',
          status: 'INVITED',
          codeReviewMatch: {
            status: 'NEEDS_MORE_EVIDENCE',
            matchRunId: 'match-run-blocked-1',
            packetId: null,
            summary: 'No quality-gated source-backed PR challenge was selected.',
            score: 0,
            assessmentQuality: null,
            reviewProfile: null,
            validatorAgent: null,
            roleSources: [],
            evidence: [],
            evidenceHyperedges: [],
            gaps: ['The deterministic repo matcher did not return a quality-gated PR.'],
          },
        }),
      })
      .mockResolvedValueOnce({
        interview: makeInterview({
          id: 'context-call-1',
          candidateId: 'candidate-1',
          candidateName: 'Ada Candidate',
          candidateEmail: 'ada@example.com',
          interviewType: 'VIDEO',
          meetingType: 'SCREENING_INTERVIEW',
          status: 'INVITED',
        }),
      });
    mocks.api.post.mockResolvedValueOnce({
      contextCall: {
        id: 'context-call-1',
        originalInterviewId: 'interview-blocked-1',
        questions: [],
      },
    });

    renderDetail();

    await flushAsyncUpdates();
    fireEvent.click(screen.getByTestId('interview-code-review-context-call-cta'));
    await flushAsyncUpdates();

    expect(mocks.api.post).toHaveBeenCalledWith(
      '/api/v1/scheduling/interviews/interview-blocked-1/context-call',
      {},
    );
  });

  it('shows code-review evidence hyperedges for recruiter match justification', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        matchedRepoId: 973,
        codeReviewMatch: {
          status: 'MATCHED',
          matchRunId: 'match-run-1',
          packetId: 'packet-1',
          summary: 'Matched 2 source-backed demands.',
          score: 0.82,
          assessmentQuality: null,
          reviewProfile: {
            source: 'deterministic_engineering_prior',
            difficultyBand: 'advanced',
            expectedSeniority: 'staff',
            expectedTimeMinutes: 75,
            basis: {
              changedFileCount: 3,
              changedLineCount: 443,
              sourceHunkCount: 28,
              testChangeCount: 1,
              demandFamilyCount: 6,
              hasIssueContext: false,
            },
            rationale: 'advanced review calibrated for staff candidates; 75 minute target; 3 files; 443 changed lines; 28 source hunks; 6 demand families; 1 test change; no issue context.',
          },
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [
            {
              relation: 'candidate_role_repo_alignment',
              label: 'Evidence bridge 1',
              pairScore: 0.91,
              nodes: [
                {
                  kind: 'person_evidence',
                  label: 'Person evidence',
                  sourceRef: {
                    exactText: 'Implemented React TypeScript popover click handling',
                    locator: 'resume:span-1',
                  },
                },
                {
                  kind: 'role_source',
                  label: 'Role source',
                  sourceRef: {
                    exactText: 'Review React TypeScript popover pull requests',
                    locator: 'job_description_md',
                    conceptKeys: ['term:react', 'term:popover'],
                  },
                },
                {
                  kind: 'repo_challenge',
                  label: 'Repo challenge',
                  sourceRef: {
                    exactText: 'click = useClick(context, { enabled: clickEnabled })',
                    locator: 'packages/react/src/popover/root/usePopoverRoot.ts',
                  },
                },
              ],
            },
          ],
          gaps: [],
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const reviewAssignmentSection = screen.getByText('Review assignment').closest('section');
    const matchDecisionSection = screen.getByText('Match decision').closest('section');
    const schedulingSection = screen.getByText('Scheduling').closest('section');
    const personContextSection = screen.getByText('Person context').closest('section');
    expect(reviewAssignmentSection?.style.order).toBe('-30');
    expect(matchDecisionSection?.style.order).toBe('-20');
    expect(schedulingSection?.style.order).toBe('20');
    expect(personContextSection?.style.order).toBe('40');

    const reviewProfile = screen.getByTestId('code-review-review-profile');
    expect(reviewProfile).toHaveTextContent('ASSESSMENT_FIT');
    expect(reviewProfile).toHaveTextContent('ADVANCED');
    expect(reviewProfile).toHaveTextContent('STAFF');
    expect(reviewProfile).toHaveTextContent('75 min');
    expect(reviewProfile).toHaveTextContent('443');
    expect(reviewProfile).toHaveTextContent('28');

    const explanation = screen.getByTestId('interview-code-review-match-explanation');
    expect(explanation).toHaveTextContent('Why this challenge');
    expect(explanation).toHaveTextContent('mui/base-ui PR #973');
    expect(explanation).toHaveTextContent('Why selected');
    expect(explanation).toHaveTextContent('Matched 2 source-backed demands.');
    expect(explanation).toHaveTextContent('Valid because');
    expect(explanation).toHaveTextContent('1 evidence bridge');
    expect(explanation).toHaveTextContent('quality 0.82');
    expect(explanation).toHaveTextContent('Do not over-trust because');
    expect(explanation).toHaveTextContent('PIPE selected this challenge from source-backed candidate evidence');
    expect(explanation).toHaveTextContent('Remaining question');
    expect(explanation).toHaveTextContent('No score signal yet');

    const hyperedges = screen.getByTestId('interview-code-review-match-hyperedges');
    expect(screen.getByText('Source proof')).toBeTruthy();
    expect(hyperedges).toHaveTextContent('Evidence trace');
    expect(hyperedges).toHaveTextContent('Person evidence');
    expect(hyperedges).toHaveTextContent('Role source');
    expect(hyperedges).toHaveTextContent('Repo challenge');
    expect(hyperedges).toHaveTextContent('Implemented React TypeScript popover click handling');
    expect(hyperedges).toHaveTextContent('Review React TypeScript popover pull requests');
    expect(hyperedges).toHaveTextContent('click = useClick');
  });

  it('labels roleless code-review hyperedges as candidate-to-repo evidence', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        matchedRepoId: 973,
        codeReviewMatch: {
          status: 'MATCHED',
          matchRunId: 'match-run-roleless-1',
          packetId: 'packet-roleless-1',
          summary: 'Matched roleless candidate evidence to a reviewable PR.',
          score: 0.68,
          assessmentQuality: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [
            {
              atomId: 'candidate-atom-1',
              demandId: 'repo-demand-1',
              sharedConcepts: [],
              roleSourceRefs: [],
              candidateSourceRefs: [{
                sourceRefId: 'candidate-ref-raw-1',
                sourceSpanId: 'candidate-source-span-raw-1',
              }],
              challengeSourceRefs: [{
                sourceRefId: 'repo-ref-raw-1',
                sourceSpanId: 'repo-source-span-raw-1',
              }],
            },
          ],
          evidenceHyperedges: [
            {
              relation: 'candidate_repo_evidence_alignment',
              label: 'Candidate evidence bridge 1',
              pairScore: 0.74,
              nodes: [
                {
                  kind: 'person_evidence',
                  label: 'Person evidence',
                  sourceRef: {
                    sourceRefId: 'candidate-hyperedge-ref-raw-1',
                    sourceSpanId: 'candidate-hyperedge-source-span-raw-1',
                  },
                },
                {
                  kind: 'repo_challenge',
                  label: 'Repo challenge',
                  sourceRef: {
                    sourceRefId: 'repo-hyperedge-ref-raw-1',
                    sourceSpanId: 'repo-hyperedge-source-span-raw-1',
                  },
                },
              ],
            },
          ],
          gaps: [],
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const hyperedges = screen.getByTestId('interview-code-review-match-hyperedges');
    expect(hyperedges).toHaveTextContent('candidate evidence -> repo challenge');
    expect(hyperedges).toHaveTextContent('CANDIDATE_REPO');
    expect(hyperedges).not.toHaveTextContent('PERSON_ROLE_REPO');
    expect(hyperedges).toHaveTextContent('Candidate source evidence');
    expect(hyperedges).toHaveTextContent('Repo challenge evidence');
    expect(hyperedges).not.toHaveTextContent('candidate-hyperedge-source-span-raw-1');
    expect(hyperedges).not.toHaveTextContent('repo-hyperedge-source-span-raw-1');
    const bridge = screen.getByTestId('interview-code-review-evidence-bridge');
    expect(bridge).toHaveTextContent('candidate evidence -> repo challenge');
    expect(bridge).toHaveTextContent('Match concepts');
    expect(bridge).not.toHaveTextContent('Role requirement');
    expect(bridge).toHaveTextContent('Source-backed match alignment');
    expect(bridge).toHaveTextContent('Candidate source evidence');
    expect(bridge).toHaveTextContent('Repo challenge evidence');
    expect(bridge).not.toHaveTextContent('candidate-atom-1');
    expect(bridge).not.toHaveTextContent('repo-demand-1');
    expect(bridge).not.toHaveTextContent('candidate-source-span-raw-1');
    expect(bridge).not.toHaveTextContent('repo-source-span-raw-1');
  });

  it('shows submitted code-review verdict, summary, and annotations to recruiters', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        submissionJson: JSON.stringify({
          type: 'CODE_REVIEW',
          verdict: 'request_changes',
          summary: 'The click timing behavior needs a regression test before this should merge.',
          annotations: [
            {
              file: 'packages/react/src/popover/root/usePopoverRoot.ts',
              line: 66,
              severity: 'major',
              comment: 'This threshold changes click semantics and needs a focused impatient-click regression.',
            },
          ],
          reviewSessionId: 'sess-review-1',
        }),
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const result = screen.getByTestId('interview-code-review-result');
    expect(result).toHaveTextContent('Request Changes');
    expect(result).toHaveTextContent('The click timing behavior needs a regression test before this should merge.');
    expect(result).toHaveTextContent('1 annotation');
    expect(result).toHaveTextContent('packages/react/src/popover/root/usePopoverRoot.ts');
    expect(result).toHaveTextContent('line 66');
    expect(result).toHaveTextContent('major');
    expect(result).toHaveTextContent('This threshold changes click semantics and needs a focused impatient-click regression.');
  });

  it('shows implementation-author reply threads from submitted code-review transcripts', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        submissionJson: JSON.stringify({
          type: 'CODE_REVIEW',
          verdict: 'request_changes',
          summary: 'The impatient click behavior needs a stronger regression test.',
          annotations: [
            {
              file: 'packages/react/src/popover/root/usePopoverRoot.ts',
              line: 66,
              severity: 'major',
              comment: 'This timing threshold can hide a real click and should have direct coverage.',
            },
          ],
          reviewSessionId: 'sess-review-defense',
          transcript: {
            rounds: [
              {
                round: 1,
                reviewer_comments: [
                  {
                    id: 1,
                    file: 'packages/react/src/popover/root/usePopoverRoot.ts',
                    line: 66,
                    severity: 'major',
                    what: 'This timing threshold can hide a real click and should have direct coverage.',
                  },
                ],
                reviewer_summary: 'Initial review',
                implementer_responses: [
                  {
                    to_comment_id: 1,
                    move: 'pushback',
                    content: 'Can you point to a user-visible failure? The threshold only applies immediately after hover opens.',
                  },
                ],
              },
              {
                round: 2,
                reviewer_comments: [
                  {
                    id: 1,
                    what: 'Yes: keyboard and pointer users can issue the click while the hover-open transition is still settling, so we need a targeted impatient-click regression.',
                  },
                ],
                implementer_responses: [
                  {
                    to_comment_id: 1,
                    move: 'comment',
                    content: 'That makes sense; I will add coverage around the impatient click path.',
                  },
                ],
              },
            ],
          },
        }),
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const defenseThreads = screen.getByTestId('interview-code-review-defense-threads');
    expect(defenseThreads).toHaveTextContent('Review interaction');
    expect(defenseThreads).toHaveTextContent('candidate comments and implementation author replies');
    expect(defenseThreads).toHaveTextContent('Candidate comment');
    expect(defenseThreads).toHaveTextContent('Implementation author · author reply · round 1');
    expect(defenseThreads).toHaveTextContent('Can you point to a user-visible failure?');
    expect(defenseThreads).toHaveTextContent('Candidate defense · round 2');
    expect(defenseThreads).toHaveTextContent('keyboard and pointer users can issue the click');
    expect(defenseThreads).toHaveTextContent('Implementation author · author comment · round 2');
    expect(defenseThreads).toHaveTextContent('I will add coverage around the impatient click path.');
  });

  it('shows code-review evidence hyperedges for recruiter match justification', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        matchedRepoId: 973,
        codeReviewMatch: {
          status: 'MATCHED',
          matchRunId: 'match-run-1',
          packetId: 'packet-1',
          summary: 'Matched 2 source-backed demands.',
          score: 0.82,
          assessmentQuality: null,
          reviewProfile: {
            source: 'deterministic_engineering_prior',
            difficultyBand: 'advanced',
            expectedSeniority: 'staff',
            expectedTimeMinutes: 75,
            basis: {
              changedFileCount: 3,
              changedLineCount: 443,
              sourceHunkCount: 28,
              testChangeCount: 1,
              demandFamilyCount: 6,
              hasIssueContext: false,
            },
            rationale: 'advanced review calibrated for staff candidates; 75 minute target; 3 files; 443 changed lines; 28 source hunks; 6 demand families; 1 test change; no issue context.',
          },
          validatorAgent: null,
          roleSources: [],
          evidence: [],
          evidenceHyperedges: [
            {
              relation: 'candidate_role_repo_alignment',
              label: 'Evidence bridge 1',
              pairScore: 0.91,
              nodes: [
                {
                  kind: 'person_evidence',
                  label: 'Person evidence',
                  sourceRef: {
                    exactText: 'Implemented React TypeScript popover click handling',
                    locator: 'resume:span-1',
                  },
                },
                {
                  kind: 'role_source',
                  label: 'Role source',
                  sourceRef: {
                    exactText: 'Review React TypeScript popover pull requests',
                    locator: 'job_description_md',
                    conceptKeys: ['term:react', 'term:popover'],
                  },
                },
                {
                  kind: 'repo_challenge',
                  label: 'Repo challenge',
                  sourceRef: {
                    exactText: 'click = useClick(context, { enabled: clickEnabled })',
                    locator: 'packages/react/src/popover/root/usePopoverRoot.ts',
                  },
                },
              ],
            },
          ],
          gaps: [],
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const reviewProfile = screen.getByTestId('code-review-review-profile');
    expect(reviewProfile).toHaveTextContent('ASSESSMENT_FIT');
    expect(reviewProfile).toHaveTextContent('ADVANCED');
    expect(reviewProfile).toHaveTextContent('STAFF');
    expect(reviewProfile).toHaveTextContent('75 min');
    expect(reviewProfile).toHaveTextContent('443');
    expect(reviewProfile).toHaveTextContent('28');

    const hyperedges = screen.getByTestId('interview-code-review-match-hyperedges');
    expect(hyperedges).toHaveTextContent('Evidence trace');
    expect(hyperedges).toHaveTextContent('Person evidence');
    expect(hyperedges).toHaveTextContent('Role source');
    expect(hyperedges).toHaveTextContent('Repo challenge');
    expect(hyperedges).toHaveTextContent('Implemented React TypeScript popover click handling');
    expect(hyperedges).toHaveTextContent('Review React TypeScript popover pull requests');
    expect(hyperedges).toHaveTextContent('click = useClick');
  });

  it('labels roleless code-review hyperedges as candidate-to-repo evidence', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        matchedRepoId: 973,
        codeReviewMatch: {
          status: 'MATCHED',
          matchRunId: 'match-run-roleless-1',
          packetId: 'packet-roleless-1',
          summary: 'Matched roleless candidate evidence to a reviewable PR.',
          score: 0.68,
          assessmentQuality: null,
          validatorAgent: null,
          roleSources: [],
          evidence: [
            {
              atomId: 'candidate-atom-1',
              demandId: 'repo-demand-1',
              sharedConcepts: ['term:popover', 'term:trigger'],
              roleSourceRefs: [],
              candidateSourceRefs: [{
                exactText: 'Implemented popover trigger click handling in usePopoverRoot',
                locator: 'resume:span-1',
              }],
              challengeSourceRefs: [{
                exactText: 'Ignore impatient trigger clicks within 500ms',
                locator: 'packages/react/src/popover/root/usePopoverRoot.ts',
              }],
            },
          ],
          evidenceHyperedges: [
            {
              relation: 'candidate_repo_evidence_alignment',
              label: 'Candidate evidence bridge 1',
              pairScore: 0.74,
              nodes: [
                {
                  kind: 'person_evidence',
                  label: 'Person evidence',
                  sourceRef: {
                    exactText: 'Implemented popover trigger click handling in usePopoverRoot',
                    locator: 'resume:span-1',
                  },
                },
                {
                  kind: 'repo_challenge',
                  label: 'Repo challenge',
                  sourceRef: {
                    exactText: 'Ignore impatient trigger clicks within 500ms',
                    locator: 'packages/react/src/popover/root/usePopoverRoot.ts',
                  },
                },
              ],
            },
          ],
          gaps: [],
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const hyperedges = screen.getByTestId('interview-code-review-match-hyperedges');
    expect(hyperedges).toHaveTextContent('candidate evidence -> repo challenge');
    expect(hyperedges).toHaveTextContent('CANDIDATE_REPO');
    expect(hyperedges).not.toHaveTextContent('PERSON_ROLE_REPO');
    expect(hyperedges).toHaveTextContent('Implemented popover trigger click handling');
    expect(hyperedges).toHaveTextContent('Ignore impatient trigger clicks');
    const bridge = screen.getByTestId('interview-code-review-evidence-bridge');
    expect(bridge).toHaveTextContent('candidate evidence -> repo challenge');
    expect(bridge).toHaveTextContent('Match concepts');
    expect(bridge).not.toHaveTextContent('Role requirement');
  });

  it('shows submitted code-review verdict, summary, and annotations to recruiters', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        submissionJson: JSON.stringify({
          type: 'CODE_REVIEW',
          verdict: 'request_changes',
          summary: 'The click timing behavior needs a regression test before this should merge.',
          annotations: [
            {
              file: 'packages/react/src/popover/root/usePopoverRoot.ts',
              line: 66,
              severity: 'major',
              comment: 'This threshold changes click semantics and needs a focused impatient-click regression.',
            },
          ],
          reviewSessionId: 'sess-review-1',
        }),
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const result = screen.getByTestId('interview-code-review-result');
    expect(result).toHaveTextContent('Request Changes');
    expect(result).toHaveTextContent('The click timing behavior needs a regression test before this should merge.');
    expect(result).toHaveTextContent('1 annotation');
    expect(result).toHaveTextContent('packages/react/src/popover/root/usePopoverRoot.ts');
    expect(result).toHaveTextContent('line 66');
    expect(result).toHaveTextContent('major');
    expect(result).toHaveTextContent('This threshold changes click semantics and needs a focused impatient-click regression.');
  });

  it('shows implementation-author reply threads from submitted code-review transcripts', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        submissionJson: JSON.stringify({
          type: 'CODE_REVIEW',
          verdict: 'request_changes',
          summary: 'The impatient click behavior needs a stronger regression test.',
          annotations: [
            {
              file: 'packages/react/src/popover/root/usePopoverRoot.ts',
              line: 66,
              severity: 'major',
              comment: 'This timing threshold can hide a real click and should have direct coverage.',
            },
          ],
          reviewSessionId: 'sess-review-defense',
          transcript: {
            rounds: [
              {
                round: 1,
                reviewer_comments: [
                  {
                    id: 1,
                    file: 'packages/react/src/popover/root/usePopoverRoot.ts',
                    line: 66,
                    severity: 'major',
                    what: 'This timing threshold can hide a real click and should have direct coverage.',
                  },
                ],
                reviewer_summary: 'Initial review',
                implementer_responses: [
                  {
                    to_comment_id: 1,
                    move: 'pushback',
                    content: 'Can you point to a user-visible failure? The threshold only applies immediately after hover opens.',
                  },
                ],
              },
              {
                round: 2,
                reviewer_comments: [
                  {
                    id: 1,
                    what: 'Yes: keyboard and pointer users can issue the click while the hover-open transition is still settling, so we need a targeted impatient-click regression.',
                  },
                ],
                implementer_responses: [
                  {
                    to_comment_id: 1,
                    move: 'comment',
                    content: 'That makes sense; I will add coverage around the impatient click path.',
                  },
                ],
              },
            ],
          },
        }),
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const defenseThreads = screen.getByTestId('interview-code-review-defense-threads');
    expect(defenseThreads).toHaveTextContent('Review interaction');
    expect(defenseThreads).toHaveTextContent('candidate comments and implementation author replies');
    expect(defenseThreads).toHaveTextContent('Candidate comment');
    expect(defenseThreads).toHaveTextContent('Implementation author · author reply · round 1');
    expect(defenseThreads).toHaveTextContent('Can you point to a user-visible failure?');
    expect(defenseThreads).toHaveTextContent('Candidate defense · round 2');
    expect(defenseThreads).toHaveTextContent('keyboard and pointer users can issue the click');
    expect(defenseThreads).toHaveTextContent('Implementation author · author comment · round 2');
    expect(defenseThreads).toHaveTextContent('I will add coverage around the impatient click path.');
  });

  it('does not poll forever for stale recording state after a disconnected call', async () => {
    vi.setSystemTime(new Date('2026-06-23T12:00:00.000Z'));
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        linkedMeeting: {
          id: 'meeting-1',
          title: 'Ada Candidate interview',
          description: null,
          status: 'COMPLETED',
          scheduledAt: null,
          startedAt: '2026-06-22T12:00:00.000Z',
          endedAt: null,
          durationSecs: null,
          meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
          meetingType: 'INTERVIEW',
          transcriptStatus: 'RECORDING',
          transcriptSummary: null,
          transcriptJson: null,
          transcriptAnalysisJson: null,
          transcriptError: null,
          recordingR2Key: null,
          room: { id: 'room-1', sessionId: 'session-1', status: 'ENDED' },
          createdAt: '2026-06-22T12:00:00.000Z',
          updatedAt: '2026-06-22T12:00:00.000Z',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    expect(screen.getByText('Ada Candidate')).toBeTruthy();
    expect(screen.getByText('Not recorded yet')).toBeTruthy();
    expect(screen.getByText('The call ended or disconnected before a recording was saved. Start a fresh room to collect transcript evidence.')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(mocks.api.get).toHaveBeenCalledTimes(1);
  });
});
