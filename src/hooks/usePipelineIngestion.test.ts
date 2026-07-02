import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePipelineIngestion } from './usePipelineIngestion';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  getToken: vi.fn(async () => 'test-token'),
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: apiMocks.getToken }),
}));

vi.mock('../lib/api/client', () => ({
  createApiClient: () => ({
    get: apiMocks.get,
    post: apiMocks.post,
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    postStream: vi.fn(),
  }),
}));

describe('usePipelineIngestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps failed candidate AI ingestion details visible to the recruiter', async () => {
    apiMocks.get.mockResolvedValueOnce({
      results: [
        {
          candidateId: 'candidate-1',
          candidateName: 'Casey Candidate',
          status: 'failed',
          candidateSearchableProfile: '',
          matchedRepoName: null,
          triangulatedScore: null,
          roleCandidateCosine: null,
          matchPhilosophy: null,
          errorText: 'Candidate Discovery profile too short',
        },
      ],
    });

    const { result } = renderHook(() => usePipelineIngestion('pipeline-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      candidateId: 'candidate-1',
      status: 'failed',
      errorText: 'Candidate Discovery profile too short',
    });
  });

  it('queues source-backed failed ingestion retries and refreshes the list', async () => {
    apiMocks.get
      .mockResolvedValueOnce({
        results: [
          {
            candidateId: 'candidate-1',
            candidateName: 'Casey Candidate',
            status: 'failed',
            candidateSearchableProfile: '',
            matchedRepoName: null,
            triangulatedScore: null,
            roleCandidateCosine: null,
            matchPhilosophy: null,
            errorText: 'Workers AI response was not JSON.',
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            candidateId: 'candidate-1',
            candidateName: 'Casey Candidate',
            status: 'embedded',
            candidateSearchableProfile: 'Casey has source-backed React evidence.',
            matchedRepoName: null,
            triangulatedScore: null,
            roleCandidateCosine: null,
            matchPhilosophy: null,
            errorText: null,
          },
        ],
      });
    apiMocks.post.mockResolvedValueOnce({
      success: true,
      result: {
        scanned: 1,
        queued: 1,
        skipped: 0,
        failed: 0,
      },
    });

    const { result } = renderHook(() => usePipelineIngestion('pipeline-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.retryFailed(2);
    });

    expect(apiMocks.post).toHaveBeenCalledWith(
      '/api/v1/pipelines/pipeline-1/ingestion/retry-failed',
      { limit: 2 },
    );
    expect(apiMocks.get).toHaveBeenCalledTimes(2);
    expect(result.current.lastRetryResult).toEqual({
      scanned: 1,
      queued: 1,
      skipped: 0,
      failed: 0,
    });
    expect(result.current.items[0]?.status).toBe('embedded');
  });
});
