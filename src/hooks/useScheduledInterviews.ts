import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import type { ScheduledInterview, InterviewStatus } from '../lib/scheduling/types';

// Recruiter hook — uses Cognito user pool auth (default)
const client = generateClient<Schema>();

interface UseScheduledInterviewsResult {
  interviews: ScheduledInterview[];
  isLoading: boolean;
  error: Error | null;
  updateStatus: (
    id: string,
    patch: {
      status: InterviewStatus;
      scheduledAt?: string;
      meetingUrl?: string;
      recruiterNotes?: string;
    }
  ) => Promise<void>;
}

/**
 * useScheduledInterviews — real-time subscription to all ScheduledInterviews
 * owned by the authenticated recruiter.
 *
 * TODO: Add filter support (by pipeline, status, date range) so the subscription
 * doesn't pull the entire table when a recruiter has many interviews. For MVP
 * the filtering happens client-side inside SchedulingFilters.
 */
export function useScheduledInterviews(): UseScheduledInterviewsResult {
  const [interviews, setInterviews] = useState<ScheduledInterview[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [error, setError]           = useState<Error | null>(null);

  useEffect(() => {
    if (!client.models.ScheduledInterview) {
      console.warn('[useScheduledInterviews] ScheduledInterview model not deployed yet — run `npx ampx sandbox`');
      setIsLoading(false);
      return;
    }

    const subscription = client.models.ScheduledInterview.observeQuery().subscribe({
      next: ({ items, isSynced }) => {
        setInterviews([...items]);
        if (isSynced) setIsLoading(false);
      },
      error: (err: unknown) => {
        console.error('[useScheduledInterviews] Subscription error:', err);
        setError(err instanceof Error ? err : new Error('Subscription failed'));
        setIsLoading(false);
      },
    });

    return () => subscription.unsubscribe();
  }, []);

  const updateStatus = useCallback(
    async (
      id: string,
      patch: {
        status: InterviewStatus;
        scheduledAt?: string;
        meetingUrl?: string;
        recruiterNotes?: string;
      }
    ): Promise<void> => {
      const { errors } = await client.models.ScheduledInterview.update({
        id,
        ...patch,
      });
      if (errors) {
        console.error('[useScheduledInterviews] updateStatus failed:', errors);
        throw new Error(errors[0].message);
      }
    },
    []
  );

  return { interviews, isLoading, error, updateStatus };
}
