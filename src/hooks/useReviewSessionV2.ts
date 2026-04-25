/**
 * useReviewSessionV2 — manages the multi-turn review session lifecycle (v2 endpoints).
 *
 * Wraps the review RPC endpoints:
 *   POST /rpc/review/session/init           → create session
 *   POST /rpc/review/session/:id/message    → send message + annotations
 *   POST /rpc/review/session/:id/complete   → finalize session
 *
 * Auth via useSessionToken() (candidate JWT).
 */

import { useState, useCallback, useRef } from 'react';
import { useSessionToken } from '../contexts/SessionTokenContext';
import type { ReviewRound, ReviewVerdict } from '../types/conversation';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AnnotationInput {
  id: string;
  file: string;
  line: number;
  severity: 'critical' | 'major' | 'minor';
  comment: string;
}

export interface ThreadReplyInput {
  toCommentId: number;
  content: string;
}

export interface ReviewSessionV2Status {
  sessionId: string;
  rounds: ReviewRound[];
  currentRound: number;
  maxRounds: number;
}

export interface UseReviewSessionV2Return {
  sessionId: string | null;
  isLoading: boolean;
  error: string | null;
  initSession: (challengeId: string) => Promise<ReviewSessionV2Status>;
  sendMessage: (
    message: string,
    annotations?: AnnotationInput[],
    replies?: ThreadReplyInput[],
  ) => Promise<ReviewSessionV2Status>;
  completeSession: (verdict: ReviewVerdict, summary: string) => Promise<void>;
  sessionStatus: ReviewSessionV2Status | null;
}

// ─── API helper ─────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

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

export function useReviewSessionV2(initialSessionId?: string | null, explicitToken?: string | null): UseReviewSessionV2Return {
  const contextToken = useSessionToken();
  const sessionToken = explicitToken ?? contextToken;
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<ReviewSessionV2Status | null>(null);
  const sessionIdRef = useRef<string | null>(initialSessionId ?? null);

  const initSession = useCallback(
    async (challengeId: string): Promise<ReviewSessionV2Status> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await rpcPost<ReviewSessionV2Status>(
          '/rpc/review/session/init',
          { challengeId },
          sessionToken,
        );
        setSessionId(result.sessionId);
        sessionIdRef.current = result.sessionId;
        setSessionStatus(result);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Init session failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionToken],
  );

  const sendMessage = useCallback(
    async (
      message: string,
      annotations?: AnnotationInput[],
      replies?: ThreadReplyInput[],
    ): Promise<ReviewSessionV2Status> => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error('No active review session');

      setIsLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { message };
        if (annotations && annotations.length > 0) {
          body.annotations = annotations.map((a) => ({
            id: a.id,
            file: a.file,
            line: a.line,
            severity: a.severity,
            comment: a.comment,
          }));
        }
        if (replies && replies.length > 0) {
          body.replies = replies.map((r) => ({
            toCommentId: r.toCommentId,
            content: r.content,
          }));
        }
        const result = await rpcPost<ReviewSessionV2Status>(
          `/rpc/review/session/${sid}/message`,
          body,
          sessionToken,
        );
        setSessionStatus(result);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Send message failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionToken],
  );

  const completeSession = useCallback(
    async (verdict: ReviewVerdict, summary: string): Promise<void> => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error('No active review session');

      setIsLoading(true);
      setError(null);
      try {
        await rpcPost<{ success: boolean }>(
          `/rpc/review/session/${sid}/complete`,
          { verdict, summary },
          sessionToken,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Complete session failed';
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
    initSession,
    sendMessage,
    completeSession,
    sessionStatus,
  };
}
