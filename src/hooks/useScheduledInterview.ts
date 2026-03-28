import { useState, useEffect } from 'react';
import { useData } from '../providers';
import type { DataProviderFactory } from '../providers';
import type { ScheduledInterview } from '../lib/scheduling/types';

interface UseScheduledInterviewResult {
  interview: ScheduledInterview | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * useScheduledInterview — loads the ScheduledInterview record for a specific
 * candidate + stage combination.
 *
 * Used by the candidate-facing SchedulingStep. Calls the public API key endpoint
 * so no Cognito auth is required.
 *
 * TODO: The publicApiKey authorization on ScheduledInterview allows read-only
 * access, so candidates cannot tamper with status. However, any candidate who
 * knows another candidateId could read their interview record. Before production,
 * either:
 *   a) Add a Lambda resolver that validates candidateId matches the inviteToken, or
 *   b) Add a separate `inviteToken` field to ScheduledInterview and filter by that.
 */
export function useScheduledInterview(
  candidateId: string,
  stageId: string
): UseScheduledInterviewResult {
  const factory: DataProviderFactory = useData();

  const [interview, setInterview] = useState<ScheduledInterview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState<Error | null>(null);

  useEffect(() => {
    if (!candidateId || !stageId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const client = factory.createPublicClient();
        const { data, errors } = await client.models.ScheduledInterview.list({
          filter: {
            candidateId: { eq: candidateId },
            stageId:     { eq: stageId },
          },
        });

        if (errors) throw new Error(errors[0]?.message ?? 'List failed');
        if (!cancelled) {
          // Take the most recent record if multiple exist (shouldn't happen in practice)
          // TODO: enforce a unique constraint on (candidateId, stageId) at the schema level
          const items = data as ScheduledInterview[];
          setInterview(items[0] ?? null);
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

    load();
    return () => { cancelled = true; };
  }, [candidateId, stageId, factory]);

  return { interview, isLoading, error };
}
