import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import type { MatchConfidenceReport } from '../../lib/api/types';
import { useMatchConfidence } from '../useMatchConfidence';

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

function makeReport(): MatchConfidenceReport {
  return {
    candidateId: 'cand-1',
    workspacePersonId: 'wp-1',
    challengeId: 'packet-1',
    compositeScore: 0.72,
    compositeLevel: 'high',
    dimensions: [
      { name: 'coverage', label: 'Evidence Coverage', score: 0.85, weight: 0.35, detail: '4/5 demands have matching evidence' },
      { name: 'recency', label: 'Evidence Recency', score: 0.9, weight: 0.25, detail: 'Average temporal decay multiplier: 90%' },
      { name: 'depth', label: 'Corroboration Depth', score: 0.7, weight: 0.25, detail: 'Average 2 independent source types per demand' },
      { name: 'consistency', label: 'Evidence Consistency', score: 0.95, weight: 0.15, detail: 'Evidence strengths are consistent across sources' },
    ],
    demands: [
      {
        demandId: 'd1',
        demandNarrative: 'TypeScript proficiency',
        demandWeight: 0.8,
        demandConcepts: ['typescript'],
        matchedConcepts: ['typescript'],
        missingConcepts: [],
        coverageRatio: 1.0,
        averageRecency: 0.95,
        corroboratingSourceCount: 3,
        bestStrength: 0.9,
        effectiveStrength: 0.855,
        confidenceScore: 0.82,
        confidenceLevel: 'high',
        isStretch: false,
        stretchReason: null,
      },
    ],
    stretchAreas: [],
    strongMatches: [
      {
        demandId: 'd1',
        demandNarrative: 'TypeScript proficiency',
        demandWeight: 0.8,
        demandConcepts: ['typescript'],
        matchedConcepts: ['typescript'],
        missingConcepts: [],
        coverageRatio: 1.0,
        averageRecency: 0.95,
        corroboratingSourceCount: 3,
        bestStrength: 0.9,
        effectiveStrength: 0.855,
        confidenceScore: 0.82,
        confidenceLevel: 'high',
        isStretch: false,
        stretchReason: null,
      },
    ],
    recommendations: [],
    computedAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('useMatchConfidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when candidateId is null', () => {
    const { result } = renderHook(() => useMatchConfidence(null, 'pkt-1'));
    expect(result.current.report).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(apiMocks.mockGet).not.toHaveBeenCalled();
  });

  it('returns null when packetId is null', () => {
    const { result } = renderHook(() => useMatchConfidence('cand-1', null));
    expect(result.current.report).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(apiMocks.mockGet).not.toHaveBeenCalled();
  });

  it('fetches confidence report when both IDs are provided', async () => {
    const report = makeReport();
    apiMocks.mockGet.mockResolvedValue(report);

    const { result } = renderHook(() => useMatchConfidence('cand-1', 'pkt-1'));

    await waitFor(() => {
      expect(result.current.report).not.toBeNull();
    });

    expect(apiMocks.mockGet).toHaveBeenCalledWith(
      '/api/v1/candidates/cand-1/living-context/match-confidence?packetId=pkt-1',
    );
    expect(result.current.report!.compositeScore).toBe(0.72);
    expect(result.current.report!.compositeLevel).toBe('high');
    expect(result.current.report!.dimensions).toHaveLength(4);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    apiMocks.mockGet.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useMatchConfidence('cand-1', 'pkt-1'));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error!.message).toBe('Network error');
    expect(result.current.report).toBeNull();
  });

  it('refetches when candidateId changes', async () => {
    const report = makeReport();
    apiMocks.mockGet.mockResolvedValue(report);

    const { result, rerender } = renderHook(
      ({ candidateId, packetId }: { candidateId: string | null; packetId: string | null }) =>
        useMatchConfidence(candidateId, packetId),
      { initialProps: { candidateId: 'cand-1', packetId: 'pkt-1' } },
    );

    await waitFor(() => {
      expect(result.current.report).not.toBeNull();
    });

    const updatedReport = { ...report, candidateId: 'cand-2', compositeScore: 0.55 };
    apiMocks.mockGet.mockResolvedValue(updatedReport);

    rerender({ candidateId: 'cand-2', packetId: 'pkt-1' });

    await waitFor(() => {
      expect(result.current.report!.compositeScore).toBe(0.55);
    });

    expect(apiMocks.mockGet).toHaveBeenCalledTimes(2);
  });
});
