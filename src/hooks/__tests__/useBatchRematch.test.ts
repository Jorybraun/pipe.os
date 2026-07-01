import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import type { BatchRematchResult } from '../../lib/api/types';
import { useBatchRematch } from '../useBatchRematch';

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

function makeBatchResult(): BatchRematchResult {
  return {
    totalCandidates: 2,
    processedCount: 2,
    results: [
      {
        candidateId: 'cand-1',
        status: 'MATCHED',
        matchRunId: 'run-1',
        repoId: 1,
        prNumber: 42,
        evaluatedCount: 5,
        topChallenge: {
          challengeId: 'pkt-1',
          repoId: '1',
          prNumber: 42,
          rank: 1,
          alignedDemandCount: 3,
          stretchCount: 1,
          eligible: true,
        },
        priorDecisions: null,
        error: null,
      },
      {
        candidateId: 'cand-2',
        status: 'NEEDS_MORE_EVIDENCE',
        matchRunId: null,
        repoId: null,
        prNumber: null,
        evaluatedCount: 0,
        topChallenge: null,
        priorDecisions: null,
        error: 'Candidate has no workspace identity.',
      },
    ],
    skippedCandidateIds: [],
  };
}

describe('useBatchRematch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with null result', () => {
    const { result } = renderHook(() => useBatchRematch());
    expect(result.current.result).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('runs batch rematch and returns results', async () => {
    const batchResult = makeBatchResult();
    apiMocks.mockPost.mockResolvedValue(batchResult);

    const { result } = renderHook(() => useBatchRematch());

    await act(async () => {
      await result.current.runBatch(['cand-1', 'cand-2']);
    });

    expect(apiMocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/candidates/batch-rematch',
      { candidateIds: ['cand-1', 'cand-2'] },
    );
    expect(result.current.result).not.toBeNull();
    expect(result.current.result!.totalCandidates).toBe(2);
    expect(result.current.result!.results).toHaveLength(2);
    expect(result.current.isLoading).toBe(false);
  });

  it('sets error on failure', async () => {
    apiMocks.mockPost.mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useBatchRematch());

    await act(async () => {
      await result.current.runBatch(['cand-1']);
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.message).toBe('Server error');
    expect(result.current.result).toBeNull();
  });

  it('does nothing for empty candidate list', async () => {
    const { result } = renderHook(() => useBatchRematch());

    await act(async () => {
      await result.current.runBatch([]);
    });

    expect(apiMocks.mockPost).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
  });
});
