/**
 * useExplainerSession — manages the explainer Q&A alongside review sessions.
 *
 * Wraps the explainer RPC endpoints:
 *   POST /rpc/review/ask           → lazy-create session + first explainer response
 *   POST /rpc/review/:id/ask      → follow-up explainer question
 *
 * Writes sessionId back to InterviewContext when a lazy session is created.
 * Auth via useSessionToken() (candidate JWT).
 */

import { useState, useCallback, useRef } from 'react';
import { useSessionToken } from '../contexts/SessionTokenContext';
import { useInterview } from '../contexts/InterviewContext';
import type { ComprehensionExchange } from '../types/conversation';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AskResponse {
  sessionId: string;
  exchanges: ComprehensionExchange[];
}

export interface UseExplainerSessionReturn {
  isLoading: boolean;
  error: string | null;
  exchanges: ComprehensionExchange[];
  askQuestion: (
    challengeOrder: number,
    question: string,
    file?: string,
    line?: number,
  ) => Promise<void>;
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

export function useExplainerSession(): UseExplainerSessionReturn {
  const sessionToken = useSessionToken();
  const ctx = useInterview();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<ComprehensionExchange[]>([]);
  const sessionIdRef = useRef<string | null>(null);

  // Sync sessionIdRef with context on first render
  if (!sessionIdRef.current && ctx.submission.sessionId) {
    sessionIdRef.current = ctx.submission.sessionId as string;
  }

  const askQuestion = useCallback(
    async (
      challengeOrder: number,
      question: string,
      file?: string,
      line?: number,
    ): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { question };
        if (file !== undefined) body.file = file;
        if (line !== undefined) body.line = line;

        const sid = sessionIdRef.current;
        let result: AskResponse;

        if (sid) {
          // Existing session — ask on it
          result = await rpcPost<AskResponse>(
            `/rpc/review/${sid}/ask`,
            body,
            sessionToken,
          );
        } else {
          // No session yet — lazy create via /rpc/review/ask
          body.challengeOrder = challengeOrder;
          result = await rpcPost<AskResponse>(
            '/rpc/review/ask',
            body,
            sessionToken,
          );
          // Write sessionId back to InterviewContext so review tab can use it
          sessionIdRef.current = result.sessionId;
          ctx.updateSubmission({ sessionId: result.sessionId });
        }

        setExchanges(result.exchanges);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ask question failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionToken, ctx],
  );

  return {
    isLoading,
    error,
    exchanges,
    askQuestion,
  };
}
