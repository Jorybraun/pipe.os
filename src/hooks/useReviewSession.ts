/**
 * useReviewSession — manages the multi-turn review session lifecycle.
 *
 * Wraps the review RPC endpoints:
 *   POST /rpc/review/submit        → create session + get first agent response
 *   POST /rpc/review/:id/respond   → follow-up reply + agent response
 *   POST /rpc/review/:id/verdict   → finalize session with verdict
 *
 * Auth via useSessionToken() (candidate JWT).
 */

import { useState, useCallback, useRef } from 'react';
import { useSessionToken } from '../contexts/SessionTokenContext';
import type { ReviewRound } from '../types/conversation';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ThreadResponse {
  comment_id: number;
  comment: {
    id: number;
    what: string;
    severity?: string | null;
    file?: string;
    line?: number;
  };
  exchanges: Array<{
    round: number;
    actor: 'implementer' | 'reviewer';
    move?: string;
    content: string;
  }>;
}

interface SubmitReviewResponse {
  sessionId: string;
  round: number;
  rounds: ReviewRound[];
  threads: ThreadResponse[];
}

interface RespondResponse {
  round: number;
  rounds: ReviewRound[];
  threads: ThreadResponse[];
}

interface AnnotationInput {
  id: string;
  file: string;
  line: number;
  severity: 'critical' | 'major' | 'minor';
  comment: string;
}

interface ReplyInput {
  toCommentId: number;
  content: string;
}

export interface UseReviewSessionReturn {
  sessionId: string | null;
  isLoading: boolean;
  error: string | null;
  submitReview: (
    challengeOrder: number,
    annotations: AnnotationInput[],
    summary: string,
  ) => Promise<SubmitReviewResponse>;
  submitResponse: (
    replies: ReplyInput[],
    newAnnotations?: AnnotationInput[],
  ) => Promise<RespondResponse>;
  submitVerdict: (
    verdict: 'approve' | 'request_changes' | 'comment_only',
    summary: string,
  ) => Promise<void>;
}

// ─── API helper ─────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '';

async function rpcPost<T>(
  path: string,
  body: Record<string, unknown>,
  sessionToken: string | null,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    const errMsg = (data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return res.json() as Promise<T>;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useReviewSession(initialSessionId?: string | null): UseReviewSessionReturn {
  const sessionToken = useSessionToken();
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(initialSessionId ?? null);

  const submitReview = useCallback(
    async (
      challengeOrder: number,
      annotations: AnnotationInput[],
      summary: string,
    ): Promise<SubmitReviewResponse> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await rpcPost<SubmitReviewResponse>(
          '/rpc/review/submit',
          {
            challengeOrder,
            annotations: annotations.map((a) => ({
              threadId: a.id,
              file: a.file,
              line: a.line,
              severity: a.severity,
              content: a.comment,
            })),
            summary,
          },
          sessionToken,
        );
        setSessionId(result.sessionId);
        sessionIdRef.current = result.sessionId;
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Submit review failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionToken],
  );

  const submitResponse = useCallback(
    async (replies: ReplyInput[], newAnnotations?: AnnotationInput[]): Promise<RespondResponse> => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error('No active review session');

      setIsLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = {
          replies: replies.map((r) => ({
            toCommentId: r.toCommentId,
            content: r.content,
          })),
        };
        if (newAnnotations && newAnnotations.length > 0) {
          body.newAnnotations = newAnnotations.map((a) => ({
            threadId: a.id,
            file: a.file,
            line: a.line,
            severity: a.severity,
            content: a.comment,
          }));
        }
        const result = await rpcPost<RespondResponse>(
          `/rpc/review/${sid}/respond`,
          body,
          sessionToken,
        );
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Submit response failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionToken],
  );

  const submitVerdict = useCallback(
    async (
      verdict: 'approve' | 'request_changes' | 'comment_only',
      summary: string,
    ): Promise<void> => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error('No active review session');

      setIsLoading(true);
      setError(null);
      try {
        await rpcPost<{ status: string }>(
          `/rpc/review/${sid}/verdict`,
          { verdict, summary },
          sessionToken,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Submit verdict failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionToken],
  );

  return {
    sessionId,
    isLoading,
    error,
    submitReview,
    submitResponse,
    submitVerdict,
  };
}
