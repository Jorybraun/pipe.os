import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRematch } from '../useRematch';
import type { ApiClient } from '../../lib/api/client';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('test-token') }),
}));

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

describe('useRematch hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with null result and not loading', () => {
    const { result } = renderHook(() => useRematch('cand-123'));
    expect(result.current.result).toBe(null);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('calls POST /candidates/:id/living-context/rematch and returns result', async () => {
    const mockResponse = {
      candidateId: 'cand-123',
      status: 'MATCHED',
      matchRunId: 'run-abc',
      repoId: 'repo-1',
      prNumber: 42,
      evaluatedCount: 3,
      topChallenge: { repoId: 'repo-1', prNumber: 42, rank: 1, compositeScore: 0.87 },
    };
    apiMocks.mockPost.mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useRematch('cand-123'));

    await act(async () => {
      const response = await result.current.triggerRematch();
      expect(response).toEqual(mockResponse);
    });

    expect(apiMocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/candidates/cand-123/living-context/rematch',
      {},
    );
    expect(result.current.result).toEqual(mockResponse);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('handles NEEDS_MORE_EVIDENCE status', async () => {
    const mockResponse = {
      candidateId: 'cand-456',
      status: 'NEEDS_MORE_EVIDENCE',
      matchRunId: null,
      repoId: null,
      prNumber: null,
      evaluatedCount: 0,
      topChallenge: null,
      reason: 'Candidate has no living context workspace identity yet.',
    };
    apiMocks.mockPost.mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useRematch('cand-456'));

    await act(async () => {
      await result.current.triggerRematch();
    });

    expect(result.current.result).toEqual(mockResponse);
    expect(result.current.result?.status).toBe('NEEDS_MORE_EVIDENCE');
  });

  it('sets error on API failure', async () => {
    apiMocks.mockPost.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useRematch('cand-789'));

    await act(async () => {
      const response = await result.current.triggerRematch();
      expect(response).toBe(null);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
    expect(result.current.result).toBe(null);
  });

  it('sets isLoading during request', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    apiMocks.mockPost.mockImplementation(() => new Promise((resolve) => {
      resolvePost = resolve;
    }));

    const { result } = renderHook(() => useRematch('cand-123'));

    let triggerPromise: Promise<unknown>;
    act(() => {
      triggerPromise = result.current.triggerRematch();
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolvePost({ candidateId: 'cand-123', status: 'MATCHED', matchRunId: 'x', repoId: null, prNumber: null, evaluatedCount: 1, topChallenge: null });
      await triggerPromise;
    });

    expect(result.current.isLoading).toBe(false);
  });
});
