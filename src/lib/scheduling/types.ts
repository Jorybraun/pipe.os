import type { LivingContextReadModel } from '../api/types';

export type InterviewStatus = 'INVITED' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type MeetingType = 'DIRECT_VIDEO_CALL' | 'SCREENING_INTERVIEW';

export interface TranscriptEntry {
  role: string;
  text: string;
  timestamp?: string | null;
  timestampStartMs?: number | null;
  timestampEndMs?: number | null;
}

export interface TranscriptArtifact {
  id: string;
  interviewId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  transcriptJson?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SchedulingProvider = 'CALENDLY' | 'CAL_COM' | 'MANUAL';

/** Sync source for status updates — manual (recruiter) or automated (webhook) */
export type SyncSource = 'MANUAL' | 'WEBHOOK' | 'POLL';

/**
 * ScheduledInterview — local TypeScript interface.
 * Matches the D1 schema (see workers/api/migrations/).
 */
export type InterviewType = 'VIDEO' | 'TECHNICAL' | 'SCREENING' | 'CODE_REVIEW';

export interface ScheduledInterview {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  candidateId?: string | null;
  contactId?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  interviewType?: InterviewType | null;
  meetingType?: MeetingType | null;
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
  // Contact-first fields
  recipientName?: string | null;
  recipientEmail?: string | null;
  // Enriched fields (from JOIN with candidates, pipelines, stages)
  candidateName?: string | null;
  candidateEmail?: string | null;
  pipelineTitle?: string | null;
  stageTitle?: string | null;
  matchedRepoId?: number | null;
  githubRepoUrl?: string | null;
  githubPrNumber?: number | null;
  submissionJson?: string | null;
  completedAt?: string | null;
  // Transcript artifact
  transcriptArtifact?: TranscriptArtifact | null;
}

export interface LinkedMeetingSummary {
  id: string;
  title: string;
  description: string | null;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSecs: number | null;
  meetingUrl: string | null;
  meetingType: string;
  transcriptStatus: string;
  transcriptSummary: string | null;
  transcriptJson?: string | null;
  transcriptAnalysisJson?: string | null;
  transcriptError?: string | null;
  recordingR2Key: string | null;
  room: {
    id: string;
    sessionId: string | null;
    status: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledInterviewDetail extends ScheduledInterview {
  externalEventId?: string | null;
  candidateName?: string | null;
  candidateEmail?: string | null;
  pipelineTitle?: string | null;
  stageTitle?: string | null;
  linkedMeeting: LinkedMeetingSummary | null;
  livingContext?: LivingContextReadModel | null;
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
