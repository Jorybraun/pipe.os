import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./pages/CandidateAssessmentPage', () => ({
  default: () => <div data-testid="candidate-assess-route">Candidate assessment route</div>,
}));

vi.mock('./pages/CultureInterviewPage', () => ({
  default: () => <div data-testid="candidate-culture-route">Candidate culture route</div>,
}));

vi.mock('./pages/VideoJoinPage', () => ({
  default: () => <div data-testid="candidate-video-route">Candidate video route</div>,
}));

function renderAt(path: string): void {
  window.history.pushState({}, '', path);
  render(<App recruiterAuthUnavailable />);
}

describe('App public candidate routes', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renders /assess/:token without requiring Clerk configuration', async () => {
    renderAt('/assess/public-token');

    expect(await screen.findByTestId('candidate-assess-route')).toBeTruthy();
    expect(screen.queryByText('Auth configuration missing')).toBeNull();
  });

  it('still blocks recruiter routes when Clerk configuration is missing', () => {
    renderAt('/interviews');

    expect(screen.getByText('Auth configuration missing')).toBeTruthy();
    expect(screen.getByText(/VITE_CLERK_PUBLISHABLE_KEY/)).toBeTruthy();
  });
});
