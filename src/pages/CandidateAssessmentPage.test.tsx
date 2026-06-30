import { render, screen } from '@testing-library/react';
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
});
