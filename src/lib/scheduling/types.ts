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
export type InterviewType =
  | 'VIDEO'
  | 'SCREENING'
  | 'CODE_REVIEW'
  | 'DEV_CONTAINER_CHALLENGE'
  | 'OPEN_SOURCE_BUG_FIX';

export const INTERVIEW_TYPE_LABELS = {
  VIDEO: 'Video interview',
  CODE_REVIEW: 'Code-review interview',
  SCREENING: 'Video interview',
  DEV_CONTAINER_CHALLENGE: 'Dev-container challenge',
  OPEN_SOURCE_BUG_FIX: 'Open-source bug fix',
} satisfies Record<InterviewType, string>;

export type AssessmentSetupStatus =
  | 'not_applicable'
  | 'reviewable_task_assigned'
  | 'missing_reviewable_task'
  | 'waiting_for_candidate_evidence'
  | 'waiting_for_source_backed_match';

export type AssessmentSetupKind =
  | 'not_applicable'
  | 'github_pr'
  | 'manual_open_source_task'
  | 'matched_repo_without_pr'
  | 'auto_match';

export type AssessmentSetupSource =
  | 'not_workspace_assessment'
  | 'recruiter_manual_override'
  | 'matched_repo_id'
  | 'contact_first_invite'
  | 'candidate_id';

export interface AssessmentSetupProjection {
  status: AssessmentSetupStatus;
  kind: AssessmentSetupKind;
  source: AssessmentSetupSource;
  blocksPositiveAssessment: boolean;
  message: string | null;
  lastDeliveredUrl?: string | null;
  lastDeliveredUrlState?: 'active' | 'claimed' | 'stale' | null;
  lastDeliveredUrlMessage?: string | null;
}

export type AssessmentProgressStage =
  | 'WAITING_FOR_CHALLENGE'
  | 'CHALLENGE_READY'
  | 'WORK_IN_PROGRESS'
  | 'READY_FOR_EVALUATION'
  | 'EVALUATED'
  | 'NEEDS_ATTENTION'
  | 'CANCELLED';

export type AssessmentProgressNextAction =
  | 'ASSIGN_CHALLENGE'
  | 'OPEN_ROOM_OR_WORKSPACE'
  | 'CAPTURE_WORK_EVIDENCE'
  | 'SUBMIT_COMMIT'
  | 'START_EVALUATION'
  | 'REVIEW_EVALUATION'
  | 'RESOLVE_DIAGNOSTIC'
  | 'NONE';

export interface AssessmentEvidenceCoverageItem {
  label: string;
  required: boolean;
  sourceRefTypes: string[];
  satisfied: boolean;
  sourceRefKeys: string[];
  missingImpact: string;
}

export interface AssessmentEvidenceCoverageSnapshot {
  schemaVersion: string;
  sourceRefCount: number;
  sourceRefTypeCounts: Record<string, number>;
  requiredForEvaluation: AssessmentEvidenceCoverageItem[];
  expectedForHighConfidence: AssessmentEvidenceCoverageItem[];
}

export interface AssessmentProgressSnapshot {
  session: {
    id: string;
    ingestionKey: string;
    interviewId: string | null;
    candidateId: string | null;
    workspaceId: string | null;
    workspacePersonId: string | null;
    applicationId: string | null;
    mode: string;
    state: string;
    createdAt: string;
    updatedAt: string;
  };
  stage: AssessmentProgressStage;
  nextAction: AssessmentProgressNextAction;
  nextActionLabel: string;
  hasChallengePacket: boolean;
  hasWorkEvidence: boolean;
  hasCommitSubmission: boolean;
  hasFinalSubmission: boolean;
  hasAiInteraction: boolean;
  hasTranscriptEvidence: boolean;
  hasTestEvidence: boolean;
  hasVerificationGap?: boolean;
  evidenceCounts: Array<{ kind: string; count: number }>;
  sourceRefCounts: Array<{ kind: string; count: number }>;
  challenge: {
    sourceRefType: string;
    sourceRefId: string;
    evidenceRole: string;
    exactText: string;
    locator: Record<string, unknown>;
  } | null;
  latestEvent: {
    id: string;
    kind: string;
    sequence: number;
    occurredAt: string;
  } | null;
  commit: {
    eventId: string;
    repositoryUrl: string | null;
    forkRepositoryUrl: string | null;
    branchName: string | null;
    baseCommitSha: string | null;
    commitSha: string | null;
    commitUrl: string | null;
    changedFiles: unknown[];
    occurredAt: string;
  } | null;
  evaluation: {
    id: string;
    status: string;
    summary: string;
    createdAt: string;
    evidenceCoverage?: AssessmentEvidenceCoverageSnapshot | null;
  } | null;
}

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
  assessmentSetup?: AssessmentSetupProjection | null;
  assessmentProgress?: AssessmentProgressSnapshot | null;
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

export interface CodeReviewEvidencePlanItem {
  id: string;
  missingSignal: string;
  whyItMatters: string;
  recommendedAssessment: 'recorded_evidence_question' | 'technical_pr_review' | 'manual_review_selection';
  expectedEvidence: string;
  question: string;
  source: {
    matchRunId: string | null;
    matchStatus: string;
    gap: string;
  };
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
  evidencePlan?: CodeReviewEvidencePlanItem[];
  evidenceFollowUp?: CodeReviewEvidenceFollowUp | null;
  evidenceRefresh?: CodeReviewEvidenceRefresh | null;
}

export interface CodeReviewScoreSummary {
  reviewSessionId: string;
  status: string;
  score: number | null;
  band: string | null;
  narrative: string | null;
  strengths: string[];
  growthAreas: string[];
  updatedAt: string;
}

export interface CodeReviewEvidenceFollowUp {
  assessmentSessionId: string;
  contextCallInterviewId: string | null;
  state: string;
  blockedReason?: string | null;
  matchRunId: string | null;
  matchStatus: string | null;
  gaps: string[];
  questions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CodeReviewEvidenceRefresh {
  status: string;
  assessmentSessionId: string;
  contextCallInterviewId: string | null;
  reportId: string;
  summary: string;
  sourceSpanCount: number | null;
  matcherContextCount?: number;
  evidenceSnippets?: CodeReviewEvidenceSnippet[];
  matchRunId: string | null;
  matchStatus: string | null;
  consumptionReportId?: string | null;
  consumedByMatchRunId?: string | null;
  consumedByMatchStatus?: string | null;
  consumedAt?: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

export interface CodeReviewEvidenceSnippet {
  eventId: string;
  sourceRefId: string;
  sourceSpanId: string | null;
  evidenceRole: string;
  exactText: string;
  occurredAt: string | null;
  locator?: Record<string, unknown>;
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

export interface RelatedEvidenceInterview {
  id: string;
  relationship: 'code_review_evidence_follow_up' | 'originating_code_review' | 'same_person_assessment';
  interviewType?: InterviewType | string | null;
  meetingType?: MeetingType | string | null;
  status: string;
  scheduledAt?: string | null;
  candidateId?: string | null;
  contactId?: string | null;
  displayName?: string | null;
  primaryEmail?: string | null;
  linkedMeetingId?: string | null;
  transcriptStatus?: string | null;
  assessmentSessionId?: string | null;
  assessmentSessionState?: string | null;
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
  relatedEvidenceInterviews?: RelatedEvidenceInterview[];
  livingContext?: LivingContextReadModel | null;
  codeReviewMatch?: CodeReviewMatchDetail | null;
  codeReviewScore?: CodeReviewScoreSummary | null;
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
