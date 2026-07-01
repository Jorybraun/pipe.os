import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import { useGraphTraversal } from '../useGraphTraversal';

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

describe('useGraphTraversal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null graph when candidateId is null', () => {
    const { result } = renderHook(() => useGraphTraversal(null, null));
    expect(result.current.graph).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(apiMocks.mockGet).not.toHaveBeenCalled();
  });

  it('fetches graph when startId provided', async () => {
    const mockGraph = {
      root: { id: 'wp-1', entityType: 'workspace_person', label: 'Test', metadata: {}, depth: 0 },
      nodes: [
        { id: 'wp-1', entityType: 'workspace_person', label: 'Test', metadata: {}, depth: 0 },
        { id: 'int-1', entityType: 'interaction', label: 'meeting', metadata: {}, depth: 1 },
      ],
      edges: [
        { fromId: 'wp-1', fromType: 'workspace_person', toId: 'int-1', toType: 'interaction', relationship: 'participated_in', sourceEvidence: null },
      ],
      truncated: false,
    };
    apiMocks.mockGet.mockResolvedValue(mockGraph);

    const { result } = renderHook(() =>
      useGraphTraversal('cand-1', 'wp-1', 'person'),
    );

    await waitFor(() => {
      expect(result.current.graph).not.toBeNull();
    });

    expect(result.current.graph?.nodes).toHaveLength(2);
    expect(apiMocks.mockGet).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/candidates/cand-1/living-context/graph?'),
    );
  });

  it('sets error on fetch failure', async () => {
    apiMocks.mockGet.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() =>
      useGraphTraversal('cand-1', 'wp-1', 'person'),
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error!.message).toBe('Network error');
    expect(result.current.graph).toBeNull();
  });

  it('clears graph when candidateId becomes null', () => {
    const { result, rerender } = renderHook(
      ({ candidateId }) => useGraphTraversal(candidateId, 'wp-1', 'person'),
      { initialProps: { candidateId: null as string | null } },
    );

    expect(result.current.graph).toBeNull();
    rerender({ candidateId: null });
    expect(result.current.graph).toBeNull();
  });
});
