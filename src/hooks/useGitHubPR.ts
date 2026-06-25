/**
 * useGitHubPR
 *
 * Fetches GitHub PR diff and metadata via the Worker proxy endpoint.
 * The Worker holds the GITHUB_TOKEN — no token is ever exposed to the frontend.
 *
 * POST /api/v1/github/pr
 *   Body: { repoUrl: string; prNumber: number }
 *   Response: { success: true, data: { diff, metadata } }
 *           | { success: false, error: string }
 *
 * Uses raw fetch (not the api client) so that non-2xx responses with
 * `{ success: false, error: string }` bodies are handled gracefully
 * and surfaced as user-visible error messages.
 */

import { useState, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface GitHubPRMetadata {
  title: string;
  author: string;
  created_at: string;
  state: string;
  base: string;
  head: string;
  description: string;
}

export interface GitHubDiffLine {
  type: 'context' | 'added' | 'removed';
  content: string;
}

export interface GitHubDiffHunk {
  header: string;
  lines: GitHubDiffLine[];
}

export interface GitHubDiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: GitHubDiffHunk[];
}

export interface GitHubPRData {
  diff: { files: GitHubDiffFile[] };
  metadata: GitHubPRMetadata;
}

interface GitHubPRResponseSuccess {
  success: true;
  data: GitHubPRData;
}

interface GitHubPRResponseError {
  success: false;
  error: string;
}

type GitHubPRApiResponse = GitHubPRResponseSuccess | GitHubPRResponseError;

// ─── Return type ──────────────────────────────────────────────────────────────

export interface UseGitHubPRReturn {
  fetchPR: (repoUrl: string, prNumber: number) => Promise<GitHubPRData | null>;
  data: GitHubPRData | null;
  isLoading: boolean;
  error: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE_URL =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env !== 'undefined' &&
  import.meta.env.VITE_API_URL
    ? (import.meta.env.VITE_API_URL as string)
    : '';

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGitHubPR(): UseGitHubPRReturn {
  const { getToken } = useClerkAuth();
  const [data, setData] = useState<GitHubPRData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPR = useCallback(
    async (repoUrl: string, prNumber: number): Promise<GitHubPRData | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const token = await getToken();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_BASE_URL}/api/v1/github/pr`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ repoUrl, prNumber }),
        });

        // Parse the response body regardless of status code.
        // The github route always returns JSON (even on 4xx).
        let body: GitHubPRApiResponse;
        try {
          body = (await response.json()) as GitHubPRApiResponse;
        } catch {
          const statusText = response.statusText || String(response.status);
          setError(`Request failed: ${statusText}`);
          setData(null);
          return null;
        }

        if (!body.success) {
          const msg = (body as GitHubPRResponseError).error ?? 'GitHub PR fetch failed';
          setError(msg);
          setData(null);
          return null;
        }

        const prData = (body as GitHubPRResponseSuccess).data;
        setData(prData);
        return prData;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to fetch GitHub PR';
        console.error('[useGitHubPR] fetch error:', err);
        setError(message);
        setData(null);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [getToken],
  );

  return { fetchPR, data, isLoading, error };
}
