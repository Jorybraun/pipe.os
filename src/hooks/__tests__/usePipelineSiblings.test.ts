import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import { usePipelineSiblings } from '../usePipelineSiblings';

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

describe('usePipelineSiblings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts idle when no candidate ID provided', () => {
    const { result } = renderHook(() => usePipelineSiblings(null));
    expect(result.current.siblingIds).toEqual([]);
    expect(result.current.pipelineId).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(apiMocks.mockGet).not.toHaveBeenCalled();
  });

  it('fetches sibling IDs when candidate ID is provided', async () => {
    apiMocks.mockGet.mockResolvedValue({
      pipelineId: 'pipeline-1',
      siblingIds: ['cand-2', 'cand-3'],
    });

    const { result } = renderHook(() => usePipelineSiblings('cand-1'));

    await waitFor(() => {
      expect(result.current.siblingIds).toEqual(['cand-2', 'cand-3']);
    });

    expect(apiMocks.mockGet).toHaveBeenCalledWith(
      '/api/v1/candidates/cand-1/pipeline-siblings',
    );
    expect(result.current.pipelineId).toBe('pipeline-1');
    expect(result.current.isLoading).toBe(false);
  });

  it('returns empty array when candidate has no pipeline', async () => {
    apiMocks.mockGet.mockResolvedValue({
      pipelineId: null,
      siblingIds: [],
    });

    const { result } = renderHook(() => usePipelineSiblings('cand-1'));

    await waitFor(() => {
      expect(result.current.pipelineId).toBeNull();
    });

    expect(result.current.siblingIds).toEqual([]);
  });

  it('records API failures without throwing', async () => {
    apiMocks.mockGet.mockRejectedValue(new Error('Not found'));

    const { result } = renderHook(() => usePipelineSiblings('cand-1'));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe('Not found');
    expect(result.current.siblingIds).toEqual([]);
  });
});
