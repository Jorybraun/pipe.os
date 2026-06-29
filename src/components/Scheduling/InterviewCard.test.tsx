import { render, screen } from '@testing-library/react';
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

function renderCard(interview: ScheduledInterview): void {
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
        hasCommitSubmission: true,
        hasFinalSubmission: false,
        hasAiInteraction: true,
        hasTranscriptEvidence: true,
        evidenceCounts: [{ kind: 'commit_submission', count: 1 }],
        challenge: {
          sourceRefType: 'review_challenge_packet',
          sourceRefId: 'challenge-packet-card',
          evidenceRole: 'assigned_challenge',
          exactText: 'Fix the assessment card progress regression.',
          locator: { repositoryUrl: 'https://github.com/open-source/widgets' },
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
    expect(progress).toHaveTextContent('Start source-backed AI or human evaluation.');
    expect(progress).toHaveTextContent('challenge, work evidence, commit, AI use, transcript');
    expect(progress).not.toHaveTextContent('assessment-session-card');
    expect(progress).not.toHaveTextContent('challenge-packet-card');
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
});
