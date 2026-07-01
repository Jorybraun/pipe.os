import { useCallback, useEffect, useState } from 'react';
import type { StalenessAlertSummary } from '../lib/api/types';
import { useApiClient } from './useApiClient';

export interface UseStalenessAlertsResult {
  alerts: StalenessAlertSummary | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useStalenessAlerts(
  candidateId: string | null,
): UseStalenessAlertsResult {
  const api = useApiClient();
  const [alerts, setAlerts] = useState<StalenessAlertSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async (): Promise<void> => {
    if (!candidateId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<StalenessAlertSummary>(
        `/api/v1/candidates/${encodeURIComponent(candidateId)}/living-context/staleness-alerts`,
      );
      setAlerts(response);
    } catch (cause) {
      console.error('[useStalenessAlerts] fetch failed:', { candidateId, cause });
      setError(cause instanceof Error ? cause : new Error('Failed to load staleness alerts'));
    } finally {
      setIsLoading(false);
    }
  }, [api, candidateId]);

  useEffect(() => {
    if (candidateId) {
      void refetch();
    } else {
      setAlerts(null);
    }
  }, [refetch, candidateId]);

  return { alerts, isLoading, error, refetch };
}
