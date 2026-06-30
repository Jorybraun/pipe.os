import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CandidateAssessmentPage from './CandidateAssessmentPage';
import { useAssessment } from '../hooks/useAssessment';

vi.mock('../hooks/useAssessment', () => ({
  useAssessment: vi.fn(),
}));

vi.mock('@codesandbox/sandpack-react', () => ({
  SandpackProvider: ({ children }: { children: ReactNode }) => <div data-testid="sandpack-provider">{children}</div>,
  SandpackLayout: ({ children }: { children: ReactNode }) => <div data-testid="sandpack-layout">{children}</div>,
  SandpackPreview: () => <div data-testid="sandpack-preview" />,
}));

vi.mock('../components/Assessment/StageRenderer', () => ({
  StageRenderer: () => <div data-testid="stage-renderer" />,
}));

vi.mock('../components/Assessment/StageShell', () => ({
  StageShell: ({ children }: { children: ReactNode }) => <div data-testid="stage-shell">{children}</div>,
}));

vi.mock('../components/Assessment/TimerContext', () => ({
  TimerProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../components/Assessment/CodeReviewChallenge', () => ({
  CodeReviewChallenge: () => <div data-testid="code-review-challenge" />,
  asCodeReviewReviewProfile: () => null,
}));

vi.mock('../components/Assessment/ChallengeRegistry', () => ({
  ChallengeRegistry: () => <div data-testid="challenge-registry" />,
}));

vi.mock('../components/Assessment/IntakeChallenge', () => ({
  IntakeChallenge: () => <div data-testid="intake-challenge" />,
}));

vi.mock('../components/Assessment/WaitingForMatch', () => ({
  WaitingForMatch: () => <div data-testid="waiting-for-match" />,
}));

vi.mock('../components/Assessment/WelcomeScreen', () => ({
  WelcomeScreen: ({
    pipelineName,
    challenges,
    isStarting,
    startError,
    onStart,
  }: {
    pipelineName: string;
    challenges: Array<{ title: string }>;
    isStarting?: boolean;
    startError?: string | null;
    onStart: () => void;
  }) => (
    <div data-testid="welcome-screen">
      <h1>Ready to begin?</h1>
      <div>{pipelineName}</div>
      {challenges.map((challenge) => <div key={challenge.title}>{challenge.title}</div>)}
      {startError && <div role="alert">{startError}</div>}
      <button data-testid="start-interview-btn" disabled={isStarting} onClick={onStart}>
        {isStarting ? 'STARTING...' : 'START_INTERVIEW'}
      </button>
    </div>
  ),
}));

vi.mock('../components/Shells/VideoShell', () => ({
  VideoShell: () => <div data-testid="video-shell" />,
}));

vi.mock('./ReviewSessionPage', () => ({
  ReviewSessionPage: () => <div data-testid="review-session-page" />,
}));

const useAssessmentMock = vi.mocked(useAssessment);

describe('CandidateAssessmentPage', () => {
  beforeEach(() => {
    useAssessmentMock.mockReturnValue({
      candidate: null,
      stageConfig: null,
      challengeContent: null,
      currentOrder: 0,
      isLoading: false,
      error: new Error('TOKEN_ALREADY_CLAIMED'),
      isSubmitted: false,
      hasStarted: false,
      followUpQuestions: null,
      followUpLoading: false,
      lastChallengeSubmissionId: null,
      submitChallenge: vi.fn(),
      onStart: vi.fn(),
      claimAssessmentStart: vi.fn(),
      reset: vi.fn(),
      refresh: vi.fn(),
      sessionToken: null,
    });
  });

  it('describes a claimed token as an already-started assessment, not a merely used link', () => {
    render(
      <MemoryRouter initialEntries={['/assess/claimed-token']}>
        <Routes>
          <Route path="/assess/:token" element={<CandidateAssessmentPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Assessment Already Started' })).toBeInTheDocument();
    expect(screen.getByText('This one-use assessment link has already started. Please contact your recruiter if you need a fresh link.')).toBeInTheDocument();
    expect(screen.queryByText('Link Already Used')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'RETRY_CONNECTION' })).not.toBeInTheDocument();
  });

  it('requires an explicit start before claiming a fresh direct code-review assessment', async () => {
    const claimAssessmentStart = vi.fn().mockResolvedValue(undefined);
    useAssessmentMock.mockReturnValue({
      candidate: {
        id: 'candidate-1',
        pipelineId: null,
        status: 'INVITED',
        name: 'Ada Candidate',
        email: 'ada@example.com',
      },
      stageConfig: {
        isComplete: false,
        stageId: 'standalone-code-review',
        candidateId: 'candidate-1',
        stageTitle: 'Code Review',
        mode: 'ASYNC',
        timeLimit: null,
        challenges: [{ type: 'CODE_REVIEW', order: 0, title: 'Code Review' }],
        currentIndex: 0,
      },
      challengeContent: {
        id: 'challenge-1',
        type: 'CODE_REVIEW',
        title: 'Code Review',
        instructions: 'Review the pull request.',
        config: {},
        cachedDiffJson: { files: [] },
      },
      currentOrder: 0,
      isLoading: false,
      error: null,
      isSubmitted: false,
      hasStarted: true,
      followUpQuestions: null,
      followUpLoading: false,
      lastChallengeSubmissionId: null,
      submitChallenge: vi.fn(),
      onStart: vi.fn(),
      claimAssessmentStart,
      reset: vi.fn(),
      refresh: vi.fn(),
      sessionToken: 'session-token',
    });

    render(
      <MemoryRouter initialEntries={['/assess/fresh-code-review-token']}>
        <Routes>
          <Route path="/assess/:token" element={<CandidateAssessmentPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Ready to begin?' })).toBeInTheDocument();
    expect(screen.getAllByText('Code Review').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('code-review-challenge')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('start-interview-btn'));

    await waitFor(() => expect(claimAssessmentStart).toHaveBeenCalledTimes(1));
  });

  it('skips the start gate when a direct code-review assessment is already in progress', () => {
    useAssessmentMock.mockReturnValue({
      candidate: {
        id: 'candidate-1',
        pipelineId: null,
        status: 'IN_PROGRESS',
        name: 'Ada Candidate',
        email: 'ada@example.com',
      },
      stageConfig: {
        isComplete: false,
        stageId: 'standalone-code-review',
        candidateId: 'candidate-1',
        stageTitle: 'Code Review',
        mode: 'ASYNC',
        timeLimit: null,
        challenges: [{ type: 'CODE_REVIEW', order: 0, title: 'Code Review' }],
        currentIndex: 0,
      },
      challengeContent: {
        id: 'challenge-1',
        type: 'CODE_REVIEW',
        title: 'Code Review',
        instructions: 'Review the pull request.',
        config: {},
        cachedDiffJson: { files: [] },
      },
      currentOrder: 0,
      isLoading: false,
      error: null,
      isSubmitted: false,
      hasStarted: true,
      followUpQuestions: null,
      followUpLoading: false,
      lastChallengeSubmissionId: null,
      submitChallenge: vi.fn(),
      onStart: vi.fn(),
      claimAssessmentStart: vi.fn(),
      reset: vi.fn(),
      refresh: vi.fn(),
      sessionToken: 'session-token',
    });

    render(
      <MemoryRouter initialEntries={['/assess/started-code-review-token']}>
        <Routes>
          <Route path="/assess/:token" element={<CandidateAssessmentPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('heading', { name: 'Ready to begin?' })).not.toBeInTheDocument();
    expect(screen.getByTestId('code-review-challenge')).toBeInTheDocument();
  });

  it('shows profile received instead of a waiting matcher screen when code review assignment is not ready', () => {
    useAssessmentMock.mockReturnValue({
      candidate: {
        id: 'candidate-1',
        pipelineId: null,
        status: 'IN_PROGRESS',
        name: 'Ada Candidate',
        email: 'ada@example.com',
      },
      stageConfig: {
        isComplete: false,
        stageId: 'standalone-code-review',
        candidateId: 'candidate-1',
        stageTitle: 'Code Review',
        mode: 'ASYNC',
        timeLimit: null,
        challenges: [{ type: 'CODE_REVIEW', order: 0, title: 'Code Review' }],
        currentIndex: 0,
      },
      challengeContent: {
        id: 'profile-received',
        type: 'PROFILE_RECEIVED',
        title: 'Profile received',
        instructions: 'Your profile has been received. PIPE will email you when your code review is ready.',
        config: {},
      },
      currentOrder: 0,
      isLoading: false,
      error: null,
      isSubmitted: false,
      hasStarted: true,
      followUpQuestions: null,
      followUpLoading: false,
      lastChallengeSubmissionId: null,
      submitChallenge: vi.fn(),
      onStart: vi.fn(),
      claimAssessmentStart: vi.fn(),
      reset: vi.fn(),
      refresh: vi.fn(),
      sessionToken: 'session-token',
    });

    render(
      <MemoryRouter initialEntries={['/assess/pending-code-review-token']}>
        <Routes>
          <Route path="/assess/:token" element={<CandidateAssessmentPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('assessment-submitted')).toHaveTextContent('Submitted.');
    expect(screen.getByTestId('assessment-submitted')).toHaveTextContent('PIPE will email you when your code review is ready.');
    expect(screen.queryByTestId('waiting-for-match')).not.toBeInTheDocument();
    expect(screen.queryByTestId('code-review-challenge')).not.toBeInTheDocument();
  });

  it('shows a start error when a fresh direct code-review assessment cannot be claimed', async () => {
    const claimAssessmentStart = vi.fn().mockRejectedValue(new Error('This invite link is no longer current.'));
    useAssessmentMock.mockReturnValue({
      candidate: {
        id: 'candidate-1',
        pipelineId: null,
        status: 'INVITED',
        name: 'Ada Candidate',
        email: 'ada@example.com',
      },
      stageConfig: {
        isComplete: false,
        stageId: 'standalone-code-review',
        candidateId: 'candidate-1',
        stageTitle: 'Code Review',
        mode: 'ASYNC',
        timeLimit: null,
        challenges: [{ type: 'CODE_REVIEW', order: 0, title: 'Code Review' }],
        currentIndex: 0,
      },
      challengeContent: {
        id: 'challenge-1',
        type: 'CODE_REVIEW',
        title: 'Code Review',
        instructions: 'Review the pull request.',
        config: {},
        cachedDiffJson: { files: [] },
      },
      currentOrder: 0,
      isLoading: false,
      error: null,
      isSubmitted: false,
      hasStarted: true,
      followUpQuestions: null,
      followUpLoading: false,
      lastChallengeSubmissionId: null,
      submitChallenge: vi.fn(),
      onStart: vi.fn(),
      claimAssessmentStart,
      reset: vi.fn(),
      refresh: vi.fn(),
      sessionToken: 'session-token',
    });

    render(
      <MemoryRouter initialEntries={['/assess/stale-code-review-token']}>
        <Routes>
          <Route path="/assess/:token" element={<CandidateAssessmentPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('start-interview-btn'));

    await waitFor(() => expect(claimAssessmentStart).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite link is no longer current.');
    expect(screen.queryByTestId('code-review-challenge')).not.toBeInTheDocument();
  });
});
