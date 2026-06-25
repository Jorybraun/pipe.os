import { useState, useEffect } from 'react';
import type { ScheduledInterview } from '../lib/scheduling/types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '';

interface UseScheduledInterviewResult {
  interview: ScheduledInterview | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * useScheduledInterview — loads the ScheduledInterview record for a specific
 * candidate + stage combination.
 *
 * Used by the candidate-facing SchedulingStep. Calls the RPC endpoint
 * with the candidate session JWT. No Clerk auth required.
 */
export function useScheduledInterview(
  candidateId: string,
  stageId: string,
): UseScheduledInterviewResult {
  const [interview, setInterview] = useState<ScheduledInterview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!candidateId || !stageId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const sessionToken = sessionStorage.getItem('pipe_session_token');
        const res = await fetch(`${API_BASE}/rpc/get-scheduled-interview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
          },
          body: JSON.stringify({ stageId }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json() as { interview: ScheduledInterview | null };
        if (!cancelled) {
          setInterview(data.interview);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[useScheduledInterview] Error:', err);
          setError(err instanceof Error ? err : new Error('Failed to load interview'));
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [candidateId, stageId]);

  return { interview, isLoading, error };
}
