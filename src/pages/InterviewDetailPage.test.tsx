import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

function renderDetail(): void {
  render(
    <MemoryRouter initialEntries={['/interviews/interview-1']}>
      <Routes>
        <Route path="/interviews/:interviewId" element={<InterviewDetailPage />} />
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
          source: 'recruiter_manual_override',
          blocksPositiveAssessment: false,
          message: 'A reviewable open-source task is assigned.',
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
            sourceRefId: 'challenge-packet-popover',
            evidenceRole: 'assigned_challenge',
            exactText: 'Fix the popover cleanup regression.',
            locator: { repositoryUrl: 'https://github.com/open-source/widgets' },
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
    expect(progress).toHaveTextContent('Start source-backed AI or human evaluation.');
    expect(progress).toHaveTextContent('challenge, work evidence, commit, AI use, transcript, tests');
    expect(progress).toHaveTextContent('abcdef1234');
    expect(progress).toHaveTextContent('Fix the popover cleanup regression.');
    expect(progress).toHaveTextContent('pipe-assessment/popover-cleanup');
    expect(progress).not.toHaveTextContent('challenge-packet-popover');
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
        createdAt: '2026-06-23T00:22:00.000Z',
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
              sourceRefTypes: ['clippy_user_prompt', 'clippy_agent_response'],
              satisfied: false,
              sourceRefKeys: [],
              missingImpact: 'Treat AI usage as unobserved when Clippy/Devin or AI chat evidence is absent.',
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
    expect(progress).toHaveTextContent('Evaluated · Candidate made a focused source-backed change and cited the submitted diff evidence.');
    expect(progress).toHaveTextContent('Tests missing');
    expect(progress).toHaveTextContent('Terminal captured');
    expect(progress).toHaveTextContent('Editor missing');
    expect(progress).toHaveTextContent('AI use missing');
    expect(progress).toHaveTextContent('Source-backed assessment report is ready to review.');
    expect(screen.queryByRole('button', { name: /start evaluation/i })).toBeNull();
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
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'COMPLETED',
        githubRepoUrl: 'https://github.com/mui/base-ui',
        githubPrNumber: 973,
        matchedRepoId: 973,
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
          updatedAt: '2026-06-23T01:00:00.000Z',
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const decision = screen.getByTestId('interview-code-review-decision-summary');
    expect(decision).toHaveTextContent('Candidate requested changes');
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
    expect(decision).toHaveTextContent('Use the annotated lines and developer pushback to judge whether the requested changes are concrete, source-backed, and worth blocking the PR.');
    expect(decision).toHaveTextContent('Strong assessment fit');
    expect(decision).toHaveTextContent('72/100 Adequate');
    expect(decision).toHaveTextContent('1 pushback thread');
    const scoreSummary = screen.getByTestId('interview-code-review-score-summary');
    expect(scoreSummary).toHaveTextContent('Signal basis');
    expect(scoreSummary).toHaveTextContent('Score report');
    expect(scoreSummary).toHaveTextContent('Scored');
    expect(scoreSummary).toHaveTextContent('Review evidence');
    expect(scoreSummary).toHaveTextContent('1 annotation');
    expect(scoreSummary).toHaveTextContent('Pushback');
    expect(scoreSummary).toHaveTextContent('1 thread');
    expect(scoreSummary).toHaveTextContent('Match proof');
    expect(scoreSummary).toHaveTextContent('1 bridge');
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
          nextAction: 'REVIEW_EVALUATION',
          nextActionLabel: 'Review the assessment report and evidence.',
          hasChallengePacket: true,
          hasWorkEvidence: true,
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
        },
      }),
    });

    renderDetail();

    await flushAsyncUpdates();
    const progress = screen.getByTestId('interview-assessment-progress');
    expect(progress).toHaveTextContent('Assessment progress');
    expect(progress).toHaveTextContent('Evaluated');
    expect(progress).toHaveTextContent('Review the assessment report and evidence.');
    expect(progress).toHaveTextContent('challenge, work evidence, commit, AI use, transcript, tests');
    expect(progress).toHaveTextContent('1 Test run');
    expect(progress).toHaveTextContent('ffffffffff');
    expect(progress).toHaveTextContent('fix the popover cleanup regression.');
    expect(progress).toHaveTextContent('Candidate fixed the regression and added focused tests.');
    expect(progress).not.toHaveTextContent('assessment-session-progress-detail');
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
    expect(decision).toHaveTextContent('Resolve the missing source-backed evidence before relying on this code-review assignment.');
    expect(decision).toHaveTextContent('NEEDS MORE EVIDENCE');
    expect(decision).toHaveTextContent('resolve missing evidence');
    expect(decision).toHaveTextContent('Recommended next step');
    expect(decision).toHaveTextContent('Collect missing evidence');
    expect(decision).toHaveTextContent('Uncertainty');
    expect(decision).toHaveTextContent('Repo fit not proven');
    expect(decision).toHaveTextContent('Missing context');
    expect(decision).toHaveTextContent('The deterministic repo matcher did not return a quality-gated PR.');
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

  it('keeps accumulated person context out of the meeting evidence timeline', async () => {
    mocks.api.get.mockResolvedValueOnce({
      interview: makeInterview({
        interviewType: 'CODE_REVIEW',
        status: 'INVITED',
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
    expect(screen.queryByTestId('interview-person-context-timeline')).toBeNull();
    expect(screen.queryByText('Code Review Context Call Recommendation')).toBeNull();
    expect(screen.queryByText('Scheduled Interview Invite Delivery')).toBeNull();
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

  it('shows a copyable assessment link for code-review interviews after invite delivery', async () => {
    const deliveredUrl = 'https://app-dev.hire-pipe.com/assess/recruiter-visible-token';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
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
    expect(linkPanel).toHaveTextContent('One-use candidate invite');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Active');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Copyable one-use link');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('ASSESSMENT');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Awaiting candidate submission');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Copy the candidate link, or resend if the candidate needs a new email.');
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

  it('treats stale assessment links as historical and blocks copying the old token', async () => {
    const deliveredUrl = 'https://app-dev.hire-pipe.com/assess/old-token';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
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
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Older token, do not share');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('ASSESSMENT');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('No current assessment evidence');
    expect(screen.getByTestId('interview-assessment-link-state')).toHaveTextContent('Resend the invite before sharing a candidate assessment link.');
    expect(linkPanel).toHaveTextContent('LAST CANDIDATE ASSESSMENT URL');
    expect(linkPanel).toHaveTextContent('RESEND ASSESSMENT INVITE');
    expect(screen.queryByText('COPY CANDIDATE LINK')).toBeNull();
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

  it('shows AI developer pushback threads from submitted code-review transcripts', async () => {
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
    expect(defenseThreads).toHaveTextContent('Candidate comment');
    expect(defenseThreads).toHaveTextContent('AI developer · pushback · round 1');
    expect(defenseThreads).toHaveTextContent('Can you point to a user-visible failure?');
    expect(defenseThreads).toHaveTextContent('Candidate defense · round 2');
    expect(defenseThreads).toHaveTextContent('keyboard and pointer users can issue the click');
    expect(defenseThreads).toHaveTextContent('AI developer · comment · round 2');
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
