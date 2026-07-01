import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import type { StalenessAlertSummary } from '../../lib/api/types';
import { useStalenessAlerts } from '../useStalenessAlerts';

const apiMocks = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

const mockApiClient: ApiClient = {
  get: apiMocks.mockGet,
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  postStream: vi.fn(),
};

vi.mock('../useApiClient', () => ({
  useApiClient: () => mockApiClient,
}));

function makeAlertSummary(): StalenessAlertSummary {
  return {
    candidateId: 'cand-1',
    workspacePersonId: 'wp-1',
    criticalCount: 1,
    warningCount: 2,
    infoCount: 1,
    overallHealth: 'critical',
    alerts: [
      {
        id: 'staleness:stale_evidence:resume',
        severity: 'critical',
        category: 'stale_evidence',
        dimension: 'resume',
        title: 'Resume / CV evidence is stale',
        detail: 'Most recent evidence is 200 days old.',
        ageDays: 200,
        decayMultiplier: 0.21,
        recommendation: 'Schedule a new resume upload to refresh this evidence dimension.',
      },
      {
        id: 'staleness:missing_dimension:interview',
        severity: 'warning',
        category: 'missing_dimension',
        dimension: 'interview',
        title: 'No Interviews evidence',
        detail: 'This core evidence dimension has no entries.',
        ageDays: null,
        decayMultiplier: null,
        recommendation: 'Conduct a structured interview.',
      },
    ],
    computedAt: '2026-06-30T12:00:00Z',
  };
}

describe('useStalenessAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts idle when no candidate ID provided', () => {
    const { result } = renderHook(() => useStalenessAlerts(null));
    expect(result.current.alerts).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(apiMocks.mockGet).not.toHaveBeenCalled();
  });

  it('fetches alerts when candidate ID is provided', async () => {
    const summary = makeAlertSummary();
    apiMocks.mockGet.mockResolvedValue(summary);

    const { result } = renderHook(() => useStalenessAlerts('cand-1'));

    await waitFor(() => {
      expect(result.current.alerts).toEqual(summary);
    });

    expect(apiMocks.mockGet).toHaveBeenCalledWith(
      '/api/v1/candidates/cand-1/living-context/staleness-alerts',
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('records API failures without throwing', async () => {
    apiMocks.mockGet.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useStalenessAlerts('cand-1'));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe('Network error');
    expect(result.current.alerts).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('supports manual refetch', async () => {
    const summary = makeAlertSummary();
    apiMocks.mockGet.mockResolvedValue(summary);

    const { result } = renderHook(() => useStalenessAlerts('cand-1'));

    await waitFor(() => {
      expect(result.current.alerts).toEqual(summary);
    });

    const updated = { ...summary, criticalCount: 0, overallHealth: 'healthy' as const };
    apiMocks.mockGet.mockResolvedValue(updated);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.alerts).toEqual(updated);
    expect(apiMocks.mockGet).toHaveBeenCalledTimes(2);
  });

  it('clears alerts when candidate ID becomes null', async () => {
    const summary = makeAlertSummary();
    apiMocks.mockGet.mockResolvedValue(summary);

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useStalenessAlerts(id),
      { initialProps: { id: 'cand-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.alerts).toEqual(summary);
    });

    rerender({ id: null });

    expect(result.current.alerts).toBeNull();
  });
});
