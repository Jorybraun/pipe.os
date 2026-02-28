// ============================================================================
// Video Interview — Shared Types
// ============================================================================

/**
 * Roles in a video session. Determines signal direction and UI rendered.
 */
export type VideoRole = 'RECRUITER' | 'CANDIDATE';

/**
 * Lifecycle states of a VideoSession record.
 */
export type VideoSessionStatus = 'WAITING' | 'CALLING' | 'ACTIVE' | 'ENDED';

/**
 * The type of a WebRTC signaling message.
 */
export type VideoSignalType = 'OFFER' | 'ANSWER' | 'ICE_CANDIDATE' | 'HANGUP';

/**
 * Payload stored in VideoSignal.payload for OFFER and ANSWER types.
 */
export interface SdpPayload {
  type: RTCSdpType;
  sdp: string;
}

/**
 * Payload stored in VideoSignal.payload for ICE_CANDIDATE type.
 */
export interface IceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

/**
 * Payload stored in VideoSignal.payload for HANGUP type.
 */
export interface HangupPayload {
  reason?: string;
}

export type VideoSignalPayload = SdpPayload | IceCandidatePayload | HangupPayload;

/**
 * Connection state surfaced to the UI.
 */
export type VideoConnectionState =
  | 'idle'         // No session started
  | 'waiting'      // Recruiter: waiting for candidate | Candidate: waiting for call
  | 'calling'      // Recruiter: ringing candidate
  | 'incoming'     // Candidate: incoming call notification
  | 'connecting'   // ICE negotiation in progress
  | 'connected'    // Streams flowing
  | 'ended'        // Session finished
  | 'error';       // Unrecoverable error

/**
 * Configuration passed into VideoShell via stage config.
 */
export interface VideoStageConfig {
  recordingEnabled?: boolean;
}

/**
 * Media device state.
 */
export interface MediaDeviceState {
  cameraEnabled: boolean;
  micEnabled: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}
