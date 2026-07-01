import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import type { RepoDecompositionOverlay } from '../../lib/api/types';
import { useRepoDecomposition } from '../useRepoDecomposition';

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

function makeOverlay(): RepoDecompositionOverlay {
  return {
    packetId: 'pkt-1',
    repoSnapshotId: 'snap-1',
    repoName: 'acme/backend',
    prNumber: 42,
    prTitle: 'Add request handling',
    primaryLanguage: 'TypeScript',
    files: [
      {
        path: 'src/handler.ts',
        language: 'TypeScript',
        artifactType: 'source',
        lineCount: null,
        symbolCount: 2,
        demandCount: 1,
        candidateAlignmentScore: 0.85,
      },
    ],
    symbols: [
      {
        id: 'sym-1',
        qualifiedName: 'handleRequest',
        kind: 'function',
        language: 'TypeScript',
        signature: null,
        filePath: 'src/handler.ts',
        lineStart: 1,
        lineEnd: 10,
        containingSymbolId: null,
        demandIds: ['demand-1'],
        candidateAlignmentScore: 0.85,
      },
    ],
    demands: [
      {
        id: 'demand-1',
        family: 'http_handling',
        narrative: 'Handle HTTP requests',
        conceptKeys: ['domain:http'],
        weight: 1.0,
        sourceFilePaths: ['src/handler.ts'],
        symbolIds: ['sym-1'],
        candidateAlignmentScore: 0.85,
        candidateEvidenceCount: 3,
      },
    ],
    structuralFacts: [],
    candidateEvidenceOverlay: [
      {
        conceptKey: 'domain:http',
        evidenceCount: 3,
        totalStrength: 2.4,
        sourceTypes: ['resume_assertion', 'interview_observation'],
      },
    ],
    coverageSummary: {
      totalDemands: 1,
      coveredDemands: 1,
      partialDemands: 0,
      uncoveredDemands: 0,
      overallScore: 0.85,
    },
  };
}

describe('useRepoDecomposition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when candidateId is null', () => {
    const { result } = renderHook(() => useRepoDecomposition(null, 'pkt-1'));
    expect(result.current.overlay).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(apiMocks.mockGet).not.toHaveBeenCalled();
  });

  it('returns null when packetId is null', () => {
    const { result } = renderHook(() => useRepoDecomposition('cand-1', null));
    expect(result.current.overlay).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(apiMocks.mockGet).not.toHaveBeenCalled();
  });

  it('fetches overlay when both IDs are provided', async () => {
    const overlay = makeOverlay();
    apiMocks.mockGet.mockResolvedValue(overlay);

    const { result } = renderHook(() => useRepoDecomposition('cand-1', 'pkt-1'));

    await waitFor(() => {
      expect(result.current.overlay).not.toBeNull();
    });

    expect(apiMocks.mockGet).toHaveBeenCalledWith(
      '/api/v1/candidates/cand-1/living-context/repo-decomposition?packetId=pkt-1',
    );
    expect(result.current.overlay!.repoName).toBe('acme/backend');
    expect(result.current.overlay!.coverageSummary.overallScore).toBe(0.85);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    apiMocks.mockGet.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useRepoDecomposition('cand-1', 'pkt-1'));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error!.message).toBe('Network error');
    expect(result.current.overlay).toBeNull();
  });
});
