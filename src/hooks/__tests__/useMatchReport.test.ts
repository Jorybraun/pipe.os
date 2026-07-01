import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import { useMatchReport } from '../useMatchReport';

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

describe('useMatchReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null report when candidateId is null', () => {
    const { result } = renderHook(() => useMatchReport(null, 'pkt-1'));
    expect(result.current.report).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(apiMocks.mockGet).not.toHaveBeenCalled();
  });

  it('returns null report when challengePacketId is null', () => {
    const { result } = renderHook(() => useMatchReport('cand-1', null));
    expect(result.current.report).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(apiMocks.mockGet).not.toHaveBeenCalled();
  });

  it('fetches match report when both IDs are provided', async () => {
    const mockReport = {
      candidateId: 'cand-1',
      challengePacketId: 'pkt-1',
      matchRunId: null,
      verdict: { verdict: 'likely_match', score: 0.62, label: 'Likely Match', primaryReasons: [], riskFactors: [] },
      confidence: { loaded: true, errorMessage: null, report: null },
      gaps: { loaded: true, errorMessage: null, report: null },
      staleness: { loaded: true, errorMessage: null, summary: null },
      provenance: { loaded: false, errorMessage: null, chain: null },
      decisionHistory: { loaded: true, errorMessage: null, exclusions: null },
      generatedAt: '2026-07-01T00:00:00.000Z',
      pipelineVersion: '1.0.0',
    };
    apiMocks.mockGet.mockResolvedValue(mockReport);

    const { result } = renderHook(() => useMatchReport('cand-1', 'pkt-1'));

    await waitFor(() => {
      expect(result.current.report).not.toBeNull();
    });

    expect(result.current.report?.verdict.verdict).toBe('likely_match');
    expect(apiMocks.mockGet).toHaveBeenCalledWith(
      '/api/v1/candidates/cand-1/living-context/match-report?challengePacketId=pkt-1',
    );
  });

  it('sets error on fetch failure', async () => {
    apiMocks.mockGet.mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useMatchReport('cand-1', 'pkt-1'));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error!.message).toBe('Server error');
    expect(result.current.report).toBeNull();
  });
});
