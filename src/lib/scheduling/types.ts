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
export type InterviewType = 'VIDEO' | 'SCREENING' | 'CODE_REVIEW' | 'DEV_CONTAINER_CHALLENGE';

export const INTERVIEW_TYPE_LABELS = {
  VIDEO: 'Video interview',
  CODE_REVIEW: 'Code-review interview',
  SCREENING: 'Video interview',
  DEV_CONTAINER_CHALLENGE: 'Dev-container challenge',
} satisfies Record<InterviewType, string>;

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
  // Room status (enriched from meeting_rooms join)
  meetingId?: string | null;
  meetingSchedulingProvider?: string | null;
  meetingExternalEventId?: string | null;
  roomStatus?: string | null;
  guestWaiting?: boolean;
  // Transcript artifact
  transcriptArtifact?: TranscriptArtifact | null;
}

export interface CodeReviewMatchSourceRef {
  sourceRefType?: string;
  sourceRefId?: string;
  sourceSpanId?: string;
  locator?: string;
  exactText?: string;
  contentHash?: string;
}

export interface CodeReviewMatchRoleSource extends CodeReviewMatchSourceRef {
  entityId: string;
  conceptKeys: string[];
}

export interface CodeReviewMatchQualityMetric {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  reason: string;
}

export interface CodeReviewMatchAssessmentQuality {
  verdict: string;
  score: number;
  maxScore: number;
  metrics: CodeReviewMatchQualityMetric[];
}

export interface CodeReviewMatchReviewProfile {
  source: 'deterministic_engineering_prior';
  difficultyBand: 'introductory' | 'focused' | 'advanced' | 'oversized';
  expectedSeniority: 'mid' | 'senior' | 'staff';
  expectedTimeMinutes: number;
  basis: {
    changedFileCount: number;
    changedLineCount: number;
    sourceHunkCount: number;
    testChangeCount: number;
    demandFamilyCount: number;
    hasIssueContext: boolean;
  };
  rationale: string;
}

export interface CodeReviewMatchValidatorCheck {
  id: string;
  passed: boolean;
  reason: string;
}

export interface CodeReviewMatchValidatorSourceBridge {
  prNumber: number | null;
  candidateSourceCount: number;
  repoSourceCount: number;
  roleSourceCount: number;
  alignedDemandCount: number;
  stretchCount: number;
  provenanceComplete: boolean;
}

export interface CodeReviewMatchValidatorAgent {
  agentName: string;
  agentVersion: string;
  mode: string;
  verdict: string;
  rationale: string;
  checks: CodeReviewMatchValidatorCheck[];
  sourceBridge: CodeReviewMatchValidatorSourceBridge | null;
}

export interface CodeReviewMatchAlignment {
  atomId: string;
  demandId: string;
  sharedConcepts: string[];
  roleSourceRefs: CodeReviewMatchRoleSource[];
  candidateSourceRefs: CodeReviewMatchSourceRef[];
  challengeSourceRefs: CodeReviewMatchSourceRef[];
}

export interface CodeReviewMatchHyperedgeNode {
  kind: 'person_evidence' | 'role_source' | 'repo_challenge';
  label: string;
  sourceRef: CodeReviewMatchSourceRef & {
    conceptKeys?: string[];
  };
}

export interface CodeReviewMatchHyperedge {
  relation: 'candidate_role_repo_alignment' | 'candidate_repo_evidence_alignment';
  label: string;
  pairScore: number | null;
  nodes: CodeReviewMatchHyperedgeNode[];
}

export interface CodeReviewMatchDetail {
  status: string;
  matchRunId: string | null;
  packetId: string | null;
  summary: string;
  score: number | null;
  assessmentQuality: CodeReviewMatchAssessmentQuality | null;
  reviewProfile?: CodeReviewMatchReviewProfile | null;
  validatorAgent: CodeReviewMatchValidatorAgent | null;
  roleSources: CodeReviewMatchRoleSource[];
  evidence: CodeReviewMatchAlignment[];
  evidenceHyperedges: CodeReviewMatchHyperedge[];
  gaps: string[];
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
  schedulingProvider?: SchedulingProvider | null;
  externalEventId?: string | null;
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
  codeReviewMatch?: CodeReviewMatchDetail | null;
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
