import type { InterviewStatus } from './types';

/**
 * Allowed status transitions for a ScheduledInterview.
 *
 * Enforced on the client only — the backend relies on Amplify owner auth.
 * TODO: Add a Lambda authorizer or AppSync resolver to enforce these transitions
 * server-side, so a compromised API key cannot set arbitrary status values.
 */
const VALID_TRANSITIONS: Record<InterviewStatus, InterviewStatus[]> = {
  INVITED:   ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: ['INVITED'],   // Allow re-inviting if cancelled
  NO_SHOW:   ['SCHEDULED', 'CANCELLED'],
};

export function canTransition(from: InterviewStatus, to: InterviewStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Returns the list of statuses a recruiter can transition to from the given status.
 */
export function getAllowedTransitions(from: InterviewStatus): InterviewStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}
