import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import type { PersonEvidenceTimeline } from '../../lib/api/types';
import { useEvidenceTimeline } from '../useEvidenceTimeline';

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

function makeTimeline(): PersonEvidenceTimeline {
  return {
    workspacePersonId: 'wp-1',
    totalEntries: 3,
    entries: [
      {
        id: 'entry-1',
        timestamp: '2026-06-30T10:00:00Z',
        entryType: 'interaction',
        interactionId: 'int-1',
        interactionType: 'resume_review',
        narrative: 'Resume reviewed',
        concepts: [],
        sourceCount: 0,
        confidence: null,
      },
      {
        id: 'entry-2',
        timestamp: '2026-06-29T15:00:00Z',
        entryType: 'assertion',
        interactionId: 'int-1',
        interactionType: 'resume_review',
        narrative: 'Candidate has 5 years TypeScript experience',
        concepts: ['typescript', 'experience'],
        sourceCount: 2,
        confidence: 0.85,
      },
      {
        id: 'entry-3',
        timestamp: '2026-06-28T09:00:00Z',
        entryType: 'context_record',
        interactionId: null,
        interactionType: null,
        narrative: 'Initial context record created',
        concepts: [],
        sourceCount: 0,
        confidence: null,
      },
    ],
  };
}

describe('useEvidenceTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts idle when no candidate ID provided', () => {
    const { result } = renderHook(() => useEvidenceTimeline(null));
    expect(result.current.timeline).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(apiMocks.mockGet).not.toHaveBeenCalled();
  });

  it('fetches timeline when candidate ID is provided', async () => {
    const timeline = makeTimeline();
    apiMocks.mockGet.mockResolvedValue(timeline);

    const { result } = renderHook(() => useEvidenceTimeline('cand-1'));

    await waitFor(() => {
      expect(result.current.timeline).toEqual(timeline);
    });

    expect(apiMocks.mockGet).toHaveBeenCalledWith(
      '/api/v1/candidates/cand-1/living-context/timeline',
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('records API failures without throwing', async () => {
    apiMocks.mockGet.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useEvidenceTimeline('cand-1'));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe('Network error');
    expect(result.current.timeline).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('supports manual refetch', async () => {
    const timeline = makeTimeline();
    apiMocks.mockGet.mockResolvedValue(timeline);

    const { result } = renderHook(() => useEvidenceTimeline('cand-1'));

    await waitFor(() => {
      expect(result.current.timeline).toEqual(timeline);
    });

    const updatedTimeline = { ...timeline, totalEntries: 5 };
    apiMocks.mockGet.mockResolvedValue(updatedTimeline);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.timeline).toEqual(updatedTimeline);
    expect(apiMocks.mockGet).toHaveBeenCalledTimes(2);
  });

  it('clears timeline when candidate ID becomes null', async () => {
    const timeline = makeTimeline();
    apiMocks.mockGet.mockResolvedValue(timeline);

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useEvidenceTimeline(id),
      { initialProps: { id: 'cand-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.timeline).toEqual(timeline);
    });

    rerender({ id: null });

    expect(result.current.timeline).toBeNull();
  });
});
