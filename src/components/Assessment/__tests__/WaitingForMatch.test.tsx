import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WaitingForMatch } from '../WaitingForMatch';

describe('WaitingForMatch', () => {
  it('shows the exact code-review pipeline phase instead of generic matching copy', () => {
    render(
      <WaitingForMatch
        title="Building your personalized challenge"
        instructions="We are preparing your code review."
        config={{
          autoRefresh: false,
          refreshIntervalSeconds: 30,
          state: 'pending',
          diagnostics: {
            phase: 'candidate_evidence',
            ingestionStatus: 'pending',
            currentStep: 'decompose_resume',
            matchableNodeCount: 0,
            rawNodeCount: 2,
            pipeline: [
              { id: 'intake', label: 'CV intake', status: 'complete' },
              { id: 'decomposition', label: 'Evidence decomposition', status: 'active', detail: 'decompose_resume' },
              { id: 'repo_matching', label: 'Repo matching', status: 'pending' },
              { id: 'challenge', label: 'Challenge assignment', status: 'pending' },
              { id: 'review', label: 'Candidate review', status: 'pending' },
              { id: 'scoring', label: 'Scoring', status: 'pending' },
            ],
          },
        }}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByTestId('code-review-pipeline-status')).toHaveTextContent('EVIDENCE DECOMPOSITION ACTIVE');
    expect(screen.getByTestId('code-review-pipeline')).toHaveTextContent('CV intake');
    expect(screen.getByTestId('code-review-pipeline')).toHaveTextContent('Evidence decomposition');
    expect(screen.getByTestId('code-review-pipeline')).toHaveTextContent('Repo matching');
    expect(screen.queryByText(/MATCHING IN PROGRESS/)).toBeNull();
  });

  it('shows blocked repo matching as an attention state', () => {
    render(
      <WaitingForMatch
        title="Challenge needs attention"
        instructions="We could not pick a PR."
        config={{
          autoRefresh: false,
          refreshIntervalSeconds: 30,
          state: 'blocked',
          diagnostics: {
            phase: 'repo_matching',
            ingestionStatus: 'embedded',
            currentStep: 'match_pr',
            matchableNodeCount: 16,
            rawNodeCount: 16,
            pipeline: [
              { id: 'intake', label: 'CV intake', status: 'complete' },
              { id: 'decomposition', label: 'Evidence decomposition', status: 'complete' },
              { id: 'repo_matching', label: 'Repo matching', status: 'blocked', detail: 'No quality-gated PR' },
              { id: 'challenge', label: 'Challenge assignment', status: 'pending' },
              { id: 'review', label: 'Candidate review', status: 'pending' },
              { id: 'scoring', label: 'Scoring', status: 'pending' },
            ],
          },
        }}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByTestId('code-review-pipeline-status')).toHaveTextContent('REPO MATCHING NEEDS ATTENTION');
    expect(screen.getByTestId('code-review-pipeline')).toHaveTextContent('No quality-gated PR');
  });
});
