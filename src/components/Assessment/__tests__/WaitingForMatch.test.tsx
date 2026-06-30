import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.queryByRole('button', { name: 'VIEW PROFILE' })).toBeNull();
    expect(screen.getByText('Profile appears after evidence decomposition.')).toBeInTheDocument();
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
        sessionToken="session-token"
      />,
    );

    expect(screen.getByTestId('code-review-pipeline-status')).toHaveTextContent('REPO MATCHING NEEDS ATTENTION');
    expect(screen.getByTestId('code-review-pipeline')).toHaveTextContent('No quality-gated PR');
    expect(screen.queryByRole('button', { name: 'VIEW PROFILE' })).toBeNull();
    expect(screen.getByText('Profile is unavailable while matching needs recruiter attention.')).toBeInTheDocument();
  });

  it('makes manual status checks visible instead of silently refetching', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
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
            currentStep: 'parse_resume',
            matchableNodeCount: 0,
            rawNodeCount: 0,
          },
        }}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CHECK STATUS NOW' }));

    expect(screen.getByRole('button', { name: 'CHECKING...' })).toBeDisabled();
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByText(/Status checked/)).toBeInTheDocument();
    });
  });

  it('shows a failed manual status check when refresh rejects', async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error('refresh failed'));
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
            currentStep: 'parse_resume',
            matchableNodeCount: 0,
            rawNodeCount: 0,
          },
        }}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CHECK STATUS NOW' }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByText('Status check failed. Refresh the page or contact the recruiter for a fresh invite.')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Status checked/)).toBeNull();
  });

  it('reports when profile data is not ready instead of doing nothing', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

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
            ingestionStatus: 'profile_generated',
            currentStep: 'match_pr',
            matchableNodeCount: 0,
            rawNodeCount: 2,
          },
        }}
        onRefresh={vi.fn()}
        sessionToken="session-token"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'VIEW PROFILE' }));

    await waitFor(() => {
      expect(screen.getByText('Profile is not ready yet. Evidence decomposition has not produced a candidate profile.')).toBeInTheDocument();
    });
    globalThis.fetch = originalFetch;
  });
});
