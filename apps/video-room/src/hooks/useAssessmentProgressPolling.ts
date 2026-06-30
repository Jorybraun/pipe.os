import { useEffect, useRef } from 'react';
import { getRoomAssessmentProgress } from '../lib/api';
import type { RoomAssessmentProgressSnapshot } from '../types';

export const ASSESSMENT_PROGRESS_POLL_MS = 5000;

interface UseAssessmentProgressPollingInput {
  token: string;
  enabled: boolean;
  intervalMs?: number;
  fetchProgress?: (token: string) => Promise<RoomAssessmentProgressSnapshot | null>;
  onProgressChange: (progress: RoomAssessmentProgressSnapshot | null) => void;
  onError?: (error: unknown) => void;
}

export function useAssessmentProgressPolling({
  token,
  enabled,
  intervalMs = ASSESSMENT_PROGRESS_POLL_MS,
  fetchProgress = getRoomAssessmentProgress,
  onProgressChange,
  onError,
}: UseAssessmentProgressPollingInput): void {
  const onProgressChangeRef = useRef(onProgressChange);
  const onErrorRef = useRef(onError);
  onProgressChangeRef.current = onProgressChange;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let inFlight = false;

    const loadProgress = async (): Promise<void> => {
      if (inFlight) return;
      inFlight = true;
      try {
        const progress = await fetchProgress(token);
        if (!cancelled) onProgressChangeRef.current(progress);
      } catch (error) {
        if (!cancelled) onErrorRef.current?.(error);
      } finally {
        inFlight = false;
      }
    };

    void loadProgress();
    const timer = window.setInterval(() => {
      void loadProgress();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, fetchProgress, intervalMs, token]);
}
