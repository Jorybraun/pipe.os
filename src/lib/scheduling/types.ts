import type { Schema } from '../../../amplify/data/resource';

export type InterviewStatus = 'INVITED' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type SchedulingProvider = 'CALENDLY' | 'CAL_COM' | 'MANUAL';

/**
 * Re-export the generated Amplify type so all scheduling code imports from one place.
 */
export type ScheduledInterview = Schema['ScheduledInterview']['type'];
