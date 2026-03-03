import type { Schema } from '../../../amplify/data/resource';

export type InterviewStatus = 'INVITED' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type SchedulingProvider = 'CALENDLY' | 'CAL_COM' | 'MANUAL';

/** Sync source for status updates — manual (recruiter) or automated (webhook) */
export type SyncSource = 'MANUAL' | 'WEBHOOK';

/**
 * Re-export the generated Amplify type so all scheduling code imports from one place.
 */
export type ScheduledInterview = Schema['ScheduledInterview']['type'];

/**
 * Re-export the SchedulingConnection type for hooks and components.
 */
export type SchedulingConnection = Schema['SchedulingConnection']['type'];
