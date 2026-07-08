import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WaitingForMatch } from '../WaitingForMatch';

describe('WaitingForMatch', () => {
  it('shows plain-language progress instead of raw matching diagnostics', () => {
    render(
      <WaitingForMatch
        title="Preparing your review"
        instructions="PIPE is organizing the next step."
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
              { id: 'intake', label: 'Analyzing your background', status: 'complete' },
              { id: 'decomposition', label: 'Analyzing your background', status: 'active', detail: 'PIPE is reviewing your background.' },
              { id: 'repo_matching', label: 'Finding a real project that fits', status: 'pending' },
              { id: 'challenge', label: 'Preparing your review', status: 'pending' },
              { id: 'review', label: 'Preparing your review', status: 'pending' },
              { id: 'scoring', label: 'Preparing your review', status: 'pending' },
            ],
          },
        }}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Analyzing your background' })).toBeInTheDocument();
    expect(screen.getByText('PIPE is analyzing your background, finding a real project that fits, and preparing your review.')).toBeInTheDocument();
    expect(screen.getByTestId('code-review-pipeline-status')).toHaveTextContent('Analyzing your background');
    expect(screen.getByTestId('code-review-pipeline')).toHaveTextContent('Analyzing your background');
    expect(screen.getByTestId('code-review-pipeline')).toHaveTextContent('Finding a real project that fits');
    expect(screen.getByTestId('code-review-pipeline')).toHaveTextContent('Preparing your review');
    expect(screen.queryByText(/MATCHING IN PROGRESS/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'VIEW PROFILE' })).toBeNull();
    expect(screen.getByText('Profile appears after PIPE finishes reviewing your background.')).toBeInTheDocument();
  });

  it('shows blocked repo matching as an attention state', () => {
    render(
      <WaitingForMatch
        title="Finding a real project that fits"
        instructions="PIPE is checking for a source-backed match."
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
              { id: 'intake', label: 'Analyzing your background', status: 'complete' },
              { id: 'decomposition', label: 'Analyzing your background', status: 'complete' },
              { id: 'repo_matching', label: 'Finding a real project that fits', status: 'blocked', detail: 'A recruiter review is needed.' },
              { id: 'challenge', label: 'Preparing your review', status: 'pending' },
              { id: 'review', label: 'Preparing your review', status: 'pending' },
              { id: 'scoring', label: 'Preparing your review', status: 'pending' },
            ],
          },
        }}
        onRefresh={vi.fn()}
        sessionToken="session-token"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Finding a real project that fits' })).toBeInTheDocument();
    expect(screen.getByTestId('code-review-pipeline-status')).toHaveTextContent('Finding a real project that fits needs attention');
    expect(screen.getByTestId('code-review-pipeline')).toHaveTextContent('Finding a real project that fits');
    expect(screen.queryByRole('button', { name: 'VIEW PROFILE' })).toBeNull();
    expect(screen.getByText('Profile is unavailable while matching needs recruiter attention.')).toBeInTheDocument();
  });

  it('makes manual status checks visible instead of silently refetching', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <WaitingForMatch
        title="Preparing your review"
        instructions="PIPE is organizing the next step."
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
        title="Preparing your review"
        instructions="PIPE is organizing the next step."
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
        title="Preparing your review"
        instructions="PIPE is organizing the next step."
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
      expect(screen.getByText('Profile is not ready yet. PIPE is still reviewing your background.')).toBeInTheDocument();
    });
    globalThis.fetch = originalFetch;
  });
});
