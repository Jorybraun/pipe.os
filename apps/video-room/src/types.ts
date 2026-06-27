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

export interface RoomWorkspace {
  enabled: boolean;
  canLaunch: boolean;
  repoUrl: string | null;
  githubPrNumber: number | null;
  matchedRepoId: number | null;
  session: RoomWorkspaceSession | null;
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
