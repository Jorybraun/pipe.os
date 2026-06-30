import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import type { CandidateComparisonReport } from '../../lib/api/types';
import { useCandidateComparison } from '../useCandidateComparison';

const apiMocks = vi.hoisted(() => ({
  mockPost: vi.fn(),
}));

const mockApiClient: ApiClient = {
  get: vi.fn(),
  post: apiMocks.mockPost,
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  postStream: vi.fn(),
};

vi.mock('../useApiClient', () => ({
  useApiClient: () => mockApiClient,
}));

function comparisonReport(overrides: Partial<CandidateComparisonReport> = {}): CandidateComparisonReport {
  return {
    pipelineId: 'pipeline-1',
    candidateProfiles: [
      {
        candidateId: 'cand-1',
        workspacePersonId: 'wp-1',
        candidateName: 'Alice',
        totalInteractions: 3,
        totalAssertions: 12,
        totalSourceSpans: 8,
        sourceDiversity: 0.75,
        interactionBreakdown: { resume_upload: 1, meeting: 2 },
        topConcepts: [
          { conceptKey: 'typescript', label: 'TypeScript', evidenceCount: 5, bestStrength: 0.9, effectiveStrength: 0.85, sources: ['resume', 'meeting'] },
        ],
        latestInteractionAt: '2026-06-28T10:00:00Z',
        freshestEvidenceAt: '2026-06-28T10:00:00Z',
      },
      {
        candidateId: 'cand-2',
        workspacePersonId: 'wp-2',
        candidateName: 'Bob',
        totalInteractions: 2,
        totalAssertions: 8,
        totalSourceSpans: 5,
        sourceDiversity: 0.5,
        interactionBreakdown: { resume_upload: 1, phone_screen: 1 },
        topConcepts: [
          { conceptKey: 'react', label: 'React', evidenceCount: 3, bestStrength: 0.8, effectiveStrength: 0.7, sources: ['resume'] },
        ],
        latestInteractionAt: '2026-06-27T15:00:00Z',
        freshestEvidenceAt: '2026-06-27T15:00:00Z',
      },
    ],
    conceptComparisons: [
      {
        conceptKey: 'typescript',
        label: 'TypeScript',
        candidates: [
          { candidateId: 'cand-1', evidenceCount: 5, bestStrength: 0.9, effectiveStrength: 0.85, coverageLevel: 'strong' },
          { candidateId: 'cand-2', evidenceCount: 1, bestStrength: 0.4, effectiveStrength: 0.35, coverageLevel: 'weak' },
        ],
      },
    ],
    summary: {
      totalCandidates: 2,
      comparedConceptCount: 5,
      sharedConceptCount: 2,
      uniqueConceptsPerCandidate: { 'cand-1': 3, 'cand-2': 1 },
      evidenceDiversityRanking: [
        { candidateId: 'cand-1', score: 0.75 },
        { candidateId: 'cand-2', score: 0.5 },
      ],
      evidenceDepthRanking: [
        { candidateId: 'cand-1', totalAssertions: 12 },
        { candidateId: 'cand-2', totalAssertions: 8 },
      ],
      evidenceFreshnessRanking: [
        { candidateId: 'cand-1', freshestAt: '2026-06-28T10:00:00Z' },
        { candidateId: 'cand-2', freshestAt: '2026-06-27T15:00:00Z' },
      ],
    },
    ...overrides,
  };
}

describe('useCandidateComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts idle when no candidate IDs provided', () => {
    const { result } = renderHook(() => useCandidateComparison(null));
    expect(result.current.report).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when fewer than 2 candidates', () => {
    const { result } = renderHook(() => useCandidateComparison(['cand-1']));
    expect(apiMocks.mockPost).not.toHaveBeenCalled();
    expect(result.current.report).toBeNull();
  });

  it('fetches comparison when 2+ candidate IDs provided', async () => {
    const report = comparisonReport();
    apiMocks.mockPost.mockResolvedValue(report);

    const { result } = renderHook(() =>
      useCandidateComparison(null),
    );

    await act(async () => {
      await result.current.compare(['cand-1', 'cand-2'], 'pipeline-1');
    });

    expect(apiMocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/candidates/compare',
      { candidateIds: ['cand-1', 'cand-2'], pipelineId: 'pipeline-1' },
    );
    expect(result.current.report).toEqual(report);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('records API failures without throwing', async () => {
    apiMocks.mockPost.mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useCandidateComparison(null));

    await act(async () => {
      await result.current.compare(['cand-1', 'cand-2']);
    });

    expect(result.current.error?.message).toBe('Server error');
    expect(result.current.report).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('supports manual compare calls', async () => {
    const report = comparisonReport();
    apiMocks.mockPost.mockResolvedValue(report);

    const { result } = renderHook(() => useCandidateComparison(null));

    await act(async () => {
      await result.current.compare(['cand-1', 'cand-2']);
    });

    expect(apiMocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/candidates/compare',
      { candidateIds: ['cand-1', 'cand-2'], pipelineId: undefined },
    );
    expect(result.current.report).toEqual(report);
  });
});
