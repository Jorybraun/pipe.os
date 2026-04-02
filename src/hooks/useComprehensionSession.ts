/**
 * useComprehensionSession — manages the blind comprehension review session lifecycle.
 *
 * Wraps the review RPC endpoints in comprehension mode:
 *   POST /rpc/review/submit        → create session + get first explainer response
 *   POST /rpc/review/:id/respond   → follow-up question + explainer response
 *   POST /rpc/review/:id/verdict   → finalize session with verdict + rationale
 *
 * Auth via useSessionToken() (candidate JWT).
 */

import { useState, useCallback, useRef } from 'react';
import { useSessionToken } from '../contexts/SessionTokenContext';
import type {
  ComprehensionExchange,
  ComprehensionVerdict,
} from '../types/conversation';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SubmitQuestionResponse {
  sessionId: string;
  round: number;
  mode: 'comprehension';
  exchanges: ComprehensionExchange[];
}

interface RespondResponse {
  round: number;
  mode: 'comprehension';
  exchanges: ComprehensionExchange[];
}

export interface UseComprehensionSessionReturn {
  sessionId: string | null;
  isLoading: boolean;
  error: string | null;
  exchanges: ComprehensionExchange[];
  currentQuestion: number;
  submitQuestion: (
    challengeOrder: number,
    question: string,
    file?: string,
    line?: number,
  ) => Promise<void>;
  submitFollowUp: (
    question: string,
    file?: string,
    line?: number,
  ) => Promise<void>;
  submitVerdict: (
    verdict: ComprehensionVerdict,
    rationale: string,
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

export function useComprehensionSession(): UseComprehensionSessionReturn {
  const sessionToken = useSessionToken();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<ComprehensionExchange[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const sessionIdRef = useRef<string | null>(null);

  const submitQuestion = useCallback(
    async (
      challengeOrder: number,
      question: string,
      file?: string,
      line?: number,
    ): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { challengeOrder, question };
        if (file !== undefined) body.file = file;
        if (line !== undefined) body.line = line;

        const result = await rpcPost<SubmitQuestionResponse>(
          '/rpc/review/submit',
          body,
          sessionToken,
        );
        setSessionId(result.sessionId);
        sessionIdRef.current = result.sessionId;
        setExchanges(result.exchanges);
        setCurrentQuestion(result.round);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Submit question failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionToken],
  );

  const submitFollowUp = useCallback(
    async (question: string, file?: string, line?: number): Promise<void> => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error('No active comprehension session');

      setIsLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { question };
        if (file !== undefined) body.file = file;
        if (line !== undefined) body.line = line;

        const result = await rpcPost<RespondResponse>(
          `/rpc/review/${sid}/respond`,
          body,
          sessionToken,
        );
        setExchanges(result.exchanges);
        setCurrentQuestion(result.round);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Submit follow-up failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionToken],
  );

  const submitVerdict = useCallback(
    async (verdict: ComprehensionVerdict, rationale: string): Promise<void> => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error('No active comprehension session');

      setIsLoading(true);
      setError(null);
      try {
        await rpcPost<{ status: string }>(
          `/rpc/review/${sid}/verdict`,
          { verdict, rationale },
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
    exchanges,
    currentQuestion,
    submitQuestion,
    submitFollowUp,
    submitVerdict,
  };
}
