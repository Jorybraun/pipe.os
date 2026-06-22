import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from './useApiClient';

export interface RepoOverlaySpan {
  id: string;
  byteStart: number;
  byteEnd: number;
  lineStart: number | null;
  lineEnd: number | null;
  exactText: string;
  contentHash: string;
  demandIds: string[];
}

export interface RepoOverlaySymbol {
  id: string;
  qualifiedName: string;
  kind: string;
  signature: string | null;
  language: string;
  definingSpanId: string;
}

export interface RepoOverlayFile {
  path: string;
  artifactId: string;
  artifactVersionId: string;
  byteLength: number;
  mediaType: string;
  spans: RepoOverlaySpan[];
  symbols: RepoOverlaySymbol[];
}

export interface RepoOverlayData {
  repoId: number;
  snapshotId: string;
  commitSha: string;
  packetId: string | null;
  prNumber: number | null;
  fileCount: number;
  spanCount: number;
  symbolCount: number;
  files: RepoOverlayFile[];
}

export interface UseRepoOverlayResult {
  overlay: RepoOverlayData | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useRepoOverlay(
  repoId: number | null,
  packetId?: string | null,
): UseRepoOverlayResult {
  const api = useApiClient();
  const [overlay, setOverlay] = useState<RepoOverlayData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = packetId ? `?packetId=${encodeURIComponent(packetId)}` : '';
      const data = await api.get<RepoOverlayData>(
        `/api/v1/internal/repo-graph/${repoId}/overlay${params}`,
      );
      setOverlay(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Failed to load repo overlay'));
    } finally {
      setIsLoading(false);
    }
  }, [api, repoId, packetId]);

  useEffect(() => {
    if (repoId) {
      void refetch();
    }
  }, [refetch, repoId]);

  return { overlay, isLoading, error, refetch };
}
