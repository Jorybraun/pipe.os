export type InterviewStatus = 'INVITED' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type SchedulingProvider = 'CALENDLY' | 'CAL_COM' | 'MANUAL';

/** Sync source for status updates — manual (recruiter) or automated (webhook) */
export type SyncSource = 'MANUAL' | 'WEBHOOK';

/**
 * ScheduledInterview — local TypeScript interface.
 * Matches the D1 schema (see workers/api/migrations/).
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
  // Enriched fields (from JOIN with candidates, pipelines, stages)
  candidateName?: string | null;
  candidateEmail?: string | null;
  pipelineTitle?: string | null;
  stageTitle?: string | null;
}

/**
 * SchedulingConnection — local TypeScript interface.
 * Matches the D1 schema (see workers/api/migrations/).
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
