import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import type { RematchResult } from '../../lib/api/types';
import { useRematch } from '../useRematch';

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

function matchedResult(overrides: Partial<RematchResult> = {}): RematchResult {
  return {
    candidateId: 'cand-123',
    status: 'MATCHED',
    matchRunId: 'run-abc',
    repoId: 42,
    prNumber: 17,
    evaluatedCount: 3,
    topChallenge: {
      challengeId: 'challenge-1',
      repoId: 42,
      prNumber: 17,
      rank: 1,
      alignedDemandCount: 5,
      stretchCount: 1,
      eligible: true,
    },
    ...overrides,
  };
}

describe('useRematch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts idle without a previous result', () => {
    const { result } = renderHook(() => useRematch('cand-123'));

    expect(result.current.result).toBeNull();
    expect(result.current.isRunning).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('posts to the recruiter rematch endpoint and stores the response', async () => {
    const response = matchedResult();
    apiMocks.mockPost.mockResolvedValue(response);

    const { result } = renderHook(() => useRematch('cand-123'));

    let returned: RematchResult | null = null;
    await act(async () => {
      returned = await result.current.rematch();
    });

    expect(apiMocks.mockPost).toHaveBeenCalledWith(
      '/api/v1/candidates/cand-123/living-context/rematch',
      {},
    );
    expect(returned).toEqual(response);
    expect(result.current.result).toEqual(response);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('preserves needs-more-evidence results for the UI', async () => {
    const response = matchedResult({
      status: 'NEEDS_MORE_EVIDENCE',
      matchRunId: null,
      repoId: null,
      prNumber: null,
      evaluatedCount: 0,
      topChallenge: null,
      reason: 'Candidate has no living context evidence yet.',
    });
    apiMocks.mockPost.mockResolvedValue(response);

    const { result } = renderHook(() => useRematch('cand-456'));

    await act(async () => {
      await result.current.rematch();
    });

    expect(result.current.result).toEqual(response);
    expect(result.current.result?.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.current.result?.reason).toContain('living context evidence');
  });

  it('records API failures without throwing into the component tree', async () => {
    apiMocks.mockPost.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useRematch('cand-789'));

    let returned: RematchResult | null = matchedResult();
    await act(async () => {
      returned = await result.current.rematch();
    });

    expect(returned).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
    expect(result.current.result).toBeNull();
    expect(result.current.isRunning).toBe(false);
  });

  it('does not call the API without a candidate id', async () => {
    const { result } = renderHook(() => useRematch(null));

    let returned: RematchResult | null = matchedResult();
    await act(async () => {
      returned = await result.current.rematch();
    });

    expect(returned).toBeNull();
    expect(apiMocks.mockPost).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(false);
  });

  it('sets isRunning while the rematch request is pending', async () => {
    let resolvePost: (value: RematchResult) => void = () => {};
    const pending = new Promise<RematchResult>((resolve) => {
      resolvePost = resolve;
    });
    apiMocks.mockPost.mockReturnValue(pending);

    const { result } = renderHook(() => useRematch('cand-123'));

    let request: Promise<RematchResult | null> | null = null;
    act(() => {
      request = result.current.rematch();
    });

    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      resolvePost(matchedResult());
      await request;
    });

    expect(result.current.isRunning).toBe(false);
  });
});
