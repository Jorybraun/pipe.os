export type RoomRole = 'HOST' | 'GUEST';
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
}

export interface SdpPayload {
  type: RTCSdpType;
  sdp?: string;
  iceServers?: RTCIceServer[];
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}
