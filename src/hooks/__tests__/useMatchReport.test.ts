import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMatchReport } from '../useMatchReport';

const mockGet = vi.fn();
vi.mock('../useApiClient', () => ({
  useApiClient: () => ({ get: mockGet }),
}));

describe('useMatchReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null report when candidateId is null', () => {
    const { result } = renderHook(() => useMatchReport(null, 'pkt-1'));
    expect(result.current.report).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns null report when packetId is null', () => {
    const { result } = renderHook(() => useMatchReport('cand-1', null));
    expect(result.current.report).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
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
    mockGet.mockResolvedValue(mockReport);

    const { result } = renderHook(() => useMatchReport('cand-1', 'pkt-1'));

    await waitFor(() => {
      expect(result.current.report).not.toBeNull();
    });

    expect(result.current.report?.verdict.verdict).toBe('likely_match');
    expect(mockGet).toHaveBeenCalledWith(
      '/api/v1/candidates/cand-1/living-context/match-report?packetId=pkt-1',
    );
  });

  it('includes matchRunId in URL when provided', async () => {
    mockGet.mockResolvedValue({ verdict: { verdict: 'strong_match' } });

    renderHook(() => useMatchReport('cand-1', 'pkt-1', 'run-42'));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/api/v1/candidates/cand-1/living-context/match-report?packetId=pkt-1&matchRunId=run-42',
      );
    });
  });

  it('sets error on failure', async () => {
    mockGet.mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useMatchReport('cand-1', 'pkt-1'));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe('Server error');
    expect(result.current.report).toBeNull();
  });
});
