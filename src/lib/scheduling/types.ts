export type InterviewStatus = 'INVITED' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type SchedulingProvider = 'CALENDLY' | 'CAL_COM' | 'MANUAL';

/** Sync source for status updates — manual (recruiter) or automated (webhook) */
export type SyncSource = 'MANUAL' | 'WEBHOOK';

/** Meeting type — distinguishes contact-first from pipeline-integrated meetings */
export type MeetingType = 'DIRECT_VIDEO_CALL' | 'SCREENING_INTERVIEW';

/**
 * ScheduledInterview — local TypeScript interface.
 * Matches the D1 schema (see workers/api/migrations/).
 * 
 * Contact-first model: candidateId, pipelineId, and stageId are optional.
 * For direct video calls, use recipientName and recipientEmail instead.
 */
export interface ScheduledInterview {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  candidateId?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
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
  meetingType?: MeetingType | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
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
