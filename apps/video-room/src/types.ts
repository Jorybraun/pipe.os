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
    clippyEnabled: boolean;
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
  | 'missing_reviewable_task'
  | 'not_configured';

export type RoomWorkspaceChallengeKind = 'github_pr' | 'repo_only' | null;

export type RoomWorkspaceChallengeSource =
  | 'scheduled_interview.github_pr_number'
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
  changedFiles: unknown[];
  occurredAt: string;
}

export interface RoomAssessmentProgressSnapshot {
  mode: string;
  state: string;
  stage: string;
  nextAction: string;
  nextActionLabel: string;
  hasChallengePacket: boolean;
  hasWorkEvidence: boolean;
  hasCommitSubmission: boolean;
  hasFinalSubmission: boolean;
  hasAiInteraction: boolean;
  hasTranscriptEvidence: boolean;
  evidenceCounts: Array<{ kind: string; count: number }>;
  latestEvent: {
    kind: string;
    sequence: number;
    occurredAt: string;
  } | null;
  commit: RoomAssessmentProgressCommit | null;
  evaluation: {
    status: string;
    summary: string;
    createdAt: string;
  } | null;
}

export interface RoomCommitSubmissionResponse {
  submission: {
    accepted: boolean;
    repositoryUrl: string;
    branchName: string;
    commitSha: string;
    commitUrl: string | null;
  };
  progress: RoomAssessmentProgressSnapshot;
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
