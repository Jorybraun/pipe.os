export type InterviewStatus = 'INVITED' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type SchedulingProvider = 'CALENDLY' | 'CAL_COM' | 'MANUAL';

/** Sync source for status updates — manual (recruiter) or automated (webhook) */
export type SyncSource = 'MANUAL' | 'WEBHOOK';

/**
 * Local mirror of the ScheduledInterview Amplify model.
 * Fields match the schema defined in amplify/data/resource.ts.
 */
export interface ScheduledInterview {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  candidateId: string;
  pipelineId: string;
  stageId: string;
  status?: InterviewStatus | null;
  scheduledAt?: string | null;
  meetingUrl?: string | null;
  schedulingProvider?: SchedulingProvider | null;
  schedulingUrl?: string | null;
  externalEventId?: string | null;
  recruiterNotes?: string | null;
  syncSource?: SyncSource | null;
  lastSyncedAt?: string | null;
  inviteLinkSentAt?: string | null;
  emailSentAt?: string | null;
  owner?: string | null;
}

/**
 * Local mirror of the SchedulingConnection Amplify model.
 * Fields match the schema defined in amplify/data/resource.ts.
 */
export interface SchedulingConnection {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  recruiterId: string;
  providerId?: 'CALENDLY' | 'CAL_COM' | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiry?: string | null;
  accountEmail?: string | null;
  accountName?: string | null;
  webhookSecret?: string | null;
  webhookId?: string | null;
  status?: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | null;
  connectedAt: string;
  lastSyncAt?: string | null;
  owner?: string | null;
}
