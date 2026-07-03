export type RoomRole = 'HOST' | 'GUEST';
export type RecordingSpeakerRole = 'host' | 'guest';
export type RecordingAudioSource = 'local' | 'remote';
export type IceServerProvider = 'cloudflare' | 'metered' | 'fallback' | 'unknown';
export type RoomPhase =
  | 'disconnected'
  | 'waiting'
  | 'peer_connected'
  | 'offer_received'
  | 'connecting'
  | 'connected'
  | 'peer_disconnected'
  | 'ended'
  | 'error';

export interface RoomMetadata {
  id: string;
  meetingId: string;
  sessionId: string;
  role: RoomRole;
  status: string;
  title: string;
  description: string | null;
  scheduledAt: string | null;
  meetingType: string;
  participants: Array<{ name: string; role: string }>;
  workspace?: RoomWorkspace | null;
  features?: {
    videoEnabled: boolean;
    workspaceEnabled: boolean;
    recordingEnabled: boolean;
    agentEnabled: boolean;
  };
}

export interface RoomWorkspaceSession {
  sessionId: string;
  status: 'LAUNCHING' | 'READY' | 'SLEEPING' | 'ERROR' | 'STOPPED' | 'EXPIRED' | string;
  ttlSeconds: number;
  ttlSource: string;
  expiresAt: string;
  warnedAt: string | null;
  expiringSoon: boolean;
  proxyPath: string | null;
  errorMessage: string | null;
}

export type RoomWorkspaceChallengeStatus =
  | 'github_pr_assigned'
  | 'repo_task_assigned'
  | 'missing_reviewable_task'
  | 'not_configured';

export type RoomWorkspaceChallengeKind = 'github_pr' | 'repo_only' | null;

export type RoomWorkspaceChallengeSource =
  | 'scheduled_interview.github_pr_number'
  | 'scheduled_interview.challenge_packet'
  | 'matched_repo_without_pr'
  | 'scheduled_repo_without_pr'
  | 'missing_repo_and_task'
  | 'workspace_not_enabled';

export interface RoomWorkspaceChallenge {
  status: RoomWorkspaceChallengeStatus;
  kind: RoomWorkspaceChallengeKind;
  source: RoomWorkspaceChallengeSource;
  message: string | null;
  packet: RoomWorkspaceChallengePacket | null;
}

export interface RoomWorkspaceChallengePacket {
  sourceRefType: string;
  evidenceRole: string;
  exactText: string;
  locator: Record<string, unknown>;
  contentHash: string;
}

export interface RoomWorkspace {
  enabled: boolean;
  canLaunch: boolean;
  repoUrl: string | null;
  githubPrNumber: number | null;
  matchedRepoId: number | null;
  challenge: RoomWorkspaceChallenge;
  session: RoomWorkspaceSession | null;
}

export type RoomCommitChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface RoomCommitChangedFile {
  path: string;
  status: RoomCommitChangedFileStatus;
  previousPath?: string | null;
  additions?: number | null;
  deletions?: number | null;
}

export interface RoomCommitSourceRef {
  sourceRefType: string;
  sourceRefId: string;
  sourceSpanId?: string | null;
  evidenceRole?: string;
  locator?: Record<string, unknown>;
  exactText: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}

export interface RoomCommitSubmissionRequest {
  narrative: string;
  repositoryUrl: string;
  forkRepositoryUrl?: string | null;
  branchName: string;
  baseCommitSha: string;
  commitSha: string;
  commitUrl?: string | null;
  upstreamPullRequestUrl?: string | null;
  upstreamPrConsent?: boolean;
  changedFiles: RoomCommitChangedFile[];
  occurredAt?: string | null;
  sourceRefs: RoomCommitSourceRef[];
}

export interface RoomAssessmentProgressCommit {
  repositoryUrl: string | null;
  forkRepositoryUrl: string | null;
  branchName: string | null;
  baseCommitSha: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  upstreamPullRequestUrl?: string | null;
  upstreamPrConsent?: boolean;
  submissionSource?: 'live_workspace' | 'manual_fallback' | 'mixed' | 'unknown';
  submissionSourceLabel?: string;
  integrity?: {
    status: 'workspace_captured' | 'manual_needs_verification' | 'mixed_needs_review' | 'unknown_needs_review';
    label: string;
    detail: string;
    tone: 'verified' | 'warning' | 'neutral';
  };
  challengeBinding?: {
    status: 'bound_to_assigned_challenge' | 'missing_challenge_packet' | 'challenge_packet_missing_anchor' | 'commit_missing_anchor' | 'challenge_binding_mismatch';
    label: string;
    detail: string;
    tone: 'verified' | 'warning' | 'neutral';
  };
  changedFiles: unknown[];
  occurredAt: string;
}

export type RoomAssessmentReadinessStatus =
  | 'WAITING_FOR_CHALLENGE'
  | 'READY_TO_START'
  | 'WORK_IN_PROGRESS'
  | 'READY_FOR_EVALUATION'
  | 'EVALUATED'
  | 'NEEDS_ATTENTION'
  | 'CANCELLED';

export interface RoomAssessmentReadinessItem {
  id: string;
  label: string;
  required: boolean;
  satisfied: boolean;
  sourceRefTypes: string[];
  missingImpact: string;
}

export interface RoomAssessmentReadinessSnapshot {
  status: RoomAssessmentReadinessStatus;
  label: string;
  detail: string;
  isReadyForEvaluation: boolean;
  isUsableHiringSignal: boolean;
  missingRequiredCount: number;
  required: RoomAssessmentReadinessItem[];
  confidence: RoomAssessmentReadinessItem[];
}

export interface RoomAssessmentEvaluationDiagnostic {
  id: string;
  code: string;
  severity: string;
  message: string;
  sourceRefCount: number;
  sourceRefTypes: string[];
}

export interface RoomAssessmentChallengePacketContract {
  schemaVersion: 'challenge-packet-contract-v1';
  isComplete: boolean;
  missingFields: string[];
  hasRepositoryUrl: boolean;
  hasBaseCommitSha: boolean;
  hasTask: boolean;
  hasSuccessCriteria: boolean;
  hasExpectedEvidence: boolean;
}

export interface RoomAssessmentProgressSnapshot {
  mode: string;
  state: string;
  stage: string;
  nextAction: string;
  nextActionLabel: string;
  assignmentTrust?: {
    state: 'matched_challenge' | 'manual_challenge' | 'source_backed_challenge' | 'waiting_for_challenge';
    label: string;
    detail: string;
    tone: 'matched' | 'manual' | 'waiting' | 'blocked' | 'neutral';
  };
  challengePacketContract?: RoomAssessmentChallengePacketContract;
  hasChallengePacket: boolean;
  hasWorkEvidence: boolean;
  hasMessageEvidence?: boolean;
  hasDevContainerEvidence?: boolean;
  hasToolUsageEvidence?: boolean;
  hasCommitSubmission: boolean;
  hasFinalSubmission: boolean;
  hasAiInteraction: boolean;
  hasTranscriptEvidence: boolean;
  hasTestEvidence: boolean;
  hasVerificationGap?: boolean;
  evidenceCounts: Array<{ kind: string; count: number }>;
  sourceRefCounts: Array<{ kind: string; count: number }>;
  evidenceSnippets?: Array<{
    eventKind: string;
    sourceRefType: string;
    evidenceRole: string;
    exactText: string;
    occurredAt: string;
  }>;
  latestEvent: {
    kind: string;
    sequence: number;
    occurredAt: string;
  } | null;
  commit: RoomAssessmentProgressCommit | null;
  evaluation: {
    status: string;
    summary: string;
    recommendation?: string | null;
    createdAt: string;
    evidenceCoverage?: unknown;
    diagnostics?: RoomAssessmentEvaluationDiagnostic[];
    claims?: Array<{
      id: string;
      polarity: string;
      dimension: string;
      narrative: string;
      confidence: number | null;
      sourceRefCount: number;
      sourceRefTypes: string[];
    }>;
  } | null;
  readiness?: RoomAssessmentReadinessSnapshot;
}

export interface RoomWorkspaceLaunchResponse {
  workspace: RoomWorkspace;
  progress: RoomAssessmentProgressSnapshot | null;
}

export interface RoomCommitSubmissionResponse {
  submission: {
    accepted: boolean;
    repositoryUrl: string;
    branchName: string;
    commitSha: string;
    commitUrl: string | null;
    upstreamPullRequestUrl?: string | null;
    upstreamPrConsent?: boolean;
  };
  progress: RoomAssessmentProgressSnapshot;
}

export interface RoomWorkspaceFinalizeRequest {
  narrative?: string;
  testCommand?: string;
  verificationNotes?: string;
}

export interface RoomWorkspaceFinalizeResponse {
  ok: boolean;
  submitted: boolean;
  commit: {
    repositoryUrl: string;
    branchName: string;
    baseCommitSha: string;
    commitSha: string;
    changedFiles: RoomCommitChangedFile[];
    sourceRefTypes: string[];
  };
  submission: RoomCommitSubmissionResponse['submission'] | null;
  progress: RoomAssessmentProgressSnapshot | null;
}

export interface RecordingSpeakerChannel {
  channel: number;
  role: RecordingSpeakerRole;
  source: RecordingAudioSource;
}

export interface RecordingSpeakerMetadata {
  version: 1;
  transcriptionAudio: {
    channelLayout: string;
    channelCount: number;
    channels: RecordingSpeakerChannel[];
  };
}

export interface SdpPayload {
  type: RTCSdpType;
  sdp?: string;
  iceServers?: RTCIceServer[];
  iceProvider?: IceServerProvider;
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}
