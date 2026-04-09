/**
 * useRepoDiscovery — manages repo discovery lifecycle for the REPOS tab.
 *
 * Handles: starting discovery, polling job status, listing repos,
 * accepting/rejecting, and converting repos to challenge templates.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useApiClient } from './useApiClient';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RepoStatus =
  | 'DISCOVERING' | 'DISCOVERED' | 'ASSESSED'
  | 'ACCEPTED' | 'REJECTED'
  | 'CONVERTING' | 'CHALLENGE_READY' | 'FAILED';

export type SeniorityBand = 'JUNIOR' | 'MID' | 'SENIOR' | 'STAFF';

export interface DiscoveredRepo {
  id: string;
  pipelineId: string;
  githubOwner: string;
  githubRepo: string;
  githubUrl: string;
  discoverySource: string;
  stars: number | null;
  lastPushedAt: string | null;
  license: string | null;
  primaryLanguage: string | null;
  topics: string[];
  stackMatchScore: number | null;
  sloc: number | null;
  meanCyclomaticComplexity: number | null;
  sourceFileCount: number | null;
  seniorityBand: SeniorityBand | null;
  qualityScore: number | null;
  status: RepoStatus;
  rejectionReason: string | null;
  challengeTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryJob {
  id: string;
  pipelineId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  skillsQueried: string[];
  totalCandidates: number;
  totalPassed: number;
  totalRejected: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface UseRepoDiscoveryResult {
  // Discovery
  startDiscovery: (pipelineId: string) => Promise<void>;
  job: DiscoveryJob | null;
  isDiscovering: boolean;

  // Repo list
  repos: DiscoveredRepo[];
  isLoadingRepos: boolean;
  fetchRepos: (pipelineId: string, status?: string) => Promise<void>;

  // Actions
  acceptRepo: (repoId: string) => Promise<void>;
  rejectRepo: (repoId: string, reason?: string) => Promise<void>;
  convertToChallenge: (repoId: string, prNumber?: number) => Promise<string | null>;
  isConverting: boolean;

  error: string | null;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useRepoDiscovery(): UseRepoDiscoveryResult {
  const api = useApiClient();

  const [job, setJob] = useState<DiscoveryJob | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [repos, setRepos] = useState<DiscoveredRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePipelineRef = useRef<string | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const fetchRepos = useCallback(async (pipelineId: string, status?: string) => {
    setIsLoadingRepos(true);
    setError(null);
    try {
      const qs = status ? `&status=${status}` : '';
      const data = await api.get<{ repos: DiscoveredRepo[] }>(
        `/api/v1/repos?pipelineId=${pipelineId}${qs}`,
      );
      setRepos(data.repos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch repos');
    } finally {
      setIsLoadingRepos(false);
    }
  }, [api]);

  const pollJob = useCallback(async (jobId: string, pipelineId: string) => {
    try {
      const data = await api.get<{ job: DiscoveryJob }>(`/api/v1/repos/jobs/${jobId}`);
      setJob(data.job);

      if (data.job.status === 'COMPLETED' || data.job.status === 'FAILED') {
        setIsDiscovering(false);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        // Refresh repo list
        await fetchRepos(pipelineId);
      }
    } catch {
      // Polling failure is non-fatal; next tick will retry
    }
  }, [api, fetchRepos]);

  const startDiscovery = useCallback(async (pipelineId: string) => {
    setIsDiscovering(true);
    setError(null);
    setJob(null);
    activePipelineRef.current = pipelineId;

    try {
      const data = await api.post<{ jobId: string; status: string }>(
        '/api/v1/repos/discover',
        { pipelineId },
      );

      // Start polling
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        void pollJob(data.jobId, pipelineId);
      }, 3000);

      // Do an initial poll immediately
      await pollJob(data.jobId, pipelineId);
    } catch (err) {
      setIsDiscovering(false);
      setError(err instanceof Error ? err.message : 'Failed to start discovery');
    }
  }, [api, pollJob]);

  const acceptRepo = useCallback(async (repoId: string) => {
    setError(null);
    try {
      await api.patch<unknown>(`/api/v1/repos/${repoId}`, { status: 'ACCEPTED' });
      setRepos((prev) => prev.map((r) =>
        r.id === repoId ? { ...r, status: 'ACCEPTED' as const } : r,
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept repo');
    }
  }, [api]);

  const rejectRepo = useCallback(async (repoId: string, reason?: string) => {
    setError(null);
    try {
      await api.patch<unknown>(`/api/v1/repos/${repoId}`, {
        status: 'REJECTED',
        rejectionReason: reason,
      });
      setRepos((prev) => prev.map((r) =>
        r.id === repoId ? { ...r, status: 'REJECTED' as const } : r,
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject repo');
    }
  }, [api]);

  const convertToChallenge = useCallback(async (repoId: string, prNumber?: number): Promise<string | null> => {
    setIsConverting(true);
    setError(null);
    try {
      const data = await api.post<{ challengeTemplateId: string }>(
        `/api/v1/repos/${repoId}/convert`,
        prNumber ? { prNumber } : {},
      );
      setRepos((prev) => prev.map((r) =>
        r.id === repoId
          ? { ...r, status: 'CHALLENGE_READY' as const, challengeTemplateId: data.challengeTemplateId }
          : r,
      ));
      return data.challengeTemplateId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert repo');
      return null;
    } finally {
      setIsConverting(false);
    }
  }, [api]);

  return {
    startDiscovery,
    job,
    isDiscovering,
    repos,
    isLoadingRepos,
    fetchRepos,
    acceptRepo,
    rejectRepo,
    convertToChallenge,
    isConverting,
    error,
  };
}
