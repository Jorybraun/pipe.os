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
      assessmentSetup: {
        status: 'reviewable_task_assigned',
        kind: 'github_pr',
        source: 'recruiter_manual_override',
        blocksPositiveAssessment: false,
        message: 'A reviewable open-source task is assigned.',
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
        sourceRefCounts: [{ kind: 'test_run', count: 1 }],
        challenge: {
          sourceRefType: 'review_challenge_packet',
          sourceRefId: 'challenge-packet-card',
          evidenceRole: 'assigned_challenge',
          exactText: [
            'Repo: https://github.com/open-source/widgets',
            'Base commit: 1111111111111111111111111111111111111111',
            'Task: Fix the assessment card progress regression.',
            'Success criteria:',
            '- Card shows stage and next action',
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
          changedFiles: [{ path: 'src/card.ts', status: 'modified' }],
          occurredAt: '2026-06-23T00:18:00.000Z',
        },
        evaluation: null,
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('ASSESSMENT');
    expect(progress).toHaveTextContent('Ready for evaluation');
    expect(progress).toHaveTextContent('DECISION');
    expect(progress).toHaveTextContent('Challenge and commit evidence are captured; run source-backed AI or human evaluation.');
    expect(progress).toHaveTextContent('Start source-backed AI or human evaluation.');
    expect(progress).toHaveTextContent('challenge, chat, workspace telemetry, room actions, commit, AI use, transcript, tests');
    expect(progress).toHaveTextContent('WORKSPACE');
    expect(progress).toHaveTextContent('Ready · open-source/widgets · base 111111111111');
    expect(progress).toHaveTextContent('open-source/widgets');
    expect(progress).toHaveTextContent('PR #72');
    expect(progress).toHaveTextContent('BASE');
    expect(progress).toHaveTextContent('111111111111');
    expect(progress).toHaveTextContent('TASK');
    expect(progress).toHaveTextContent('Fix the assessment card progress regression.');
    expect(progress).toHaveTextContent('abcdef123456');
    expect(progress).not.toHaveTextContent('assessment-session-card');
    expect(progress).not.toHaveTextContent('challenge-packet-card');
    expect(progress).not.toHaveTextContent('abcdef1234567890abcdef1234567890abcdef12');
  });

  it('shows the assigned open-source task before candidate work starts', () => {
    renderCard({
      id: 'interview-setup-task',
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
    expect(progress).toHaveTextContent('Challenge ready');
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
    expect(progress).not.toHaveTextContent('challenge-packet-setup');
    expect(progress).not.toHaveTextContent('assessment-session-setup');
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
      },
      assessmentProgress: null,
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('Setup gap');
    expect(progress).toHaveTextContent('PIPE must ingest source-backed evidence before selecting a PR task.');
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

  it('shows evaluated recommendation without exposing evaluator ids', () => {
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
      },
    });

    const progress = screen.getByTestId('interview-card-assessment-progress');
    expect(progress).toHaveTextContent('Evaluated');
    expect(progress).toHaveTextContent('DECISION');
    expect(progress).toHaveTextContent('Strong evidence to advance');
    expect(progress).toHaveTextContent('Candidate produced a focused source-backed fix with commit and test evidence.');
    expect(progress).toHaveTextContent('EVAL');
    expect(progress).toHaveTextContent('CAUTION');
    expect(progress).toHaveTextContent('1 evaluator caution');
    expect(progress).not.toHaveTextContent('assessment-evaluation-secret');
    expect(progress).not.toHaveTextContent('assessment-session-evaluated');
    expect(progress).not.toHaveTextContent('diagnostic-card-secret');
  });
});
