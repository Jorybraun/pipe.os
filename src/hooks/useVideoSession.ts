import { useState, useEffect, useCallback, useRef } from 'react';
import { createPeerConnection } from '../lib/video/webrtcConfig';
import {
  requestMediaPermissions,
  releaseStream,
} from '../lib/video/mediaPermissions';
import type {
  VideoRole,
  VideoConnectionState,
  SdpPayload,
  IceCandidatePayload,
  VideoSignalPayload,
  VideoSignalType,
} from '../lib/video/types';

// ============================================================================
// Types
// ============================================================================

interface UseVideoSessionOptions {
  role: VideoRole;
  /** Called to send a signaling message via AppSync */
  sendSignal: (type: VideoSignalType, payload: VideoSignalPayload) => Promise<void>;
  /** Called when the session ends (either party hangs up) */
  onEnded?: () => void;
}

interface UseVideoSessionReturn {
  connectionState: VideoConnectionState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  /** Initialise local media. Call before initiating or accepting a call. */
  initMedia: () => Promise<boolean>;
  /**
   * RECRUITER only: creates an SDP offer and sends it via signaling.
   * Call after initMedia() succeeds.
   */
  startCall: () => Promise<void>;
  /**
   * CANDIDATE only: receives the incoming SDP offer and sends an answer.
   * Called automatically by VideoShell when an OFFER signal arrives.
   */
  acceptCall: (offer: SdpPayload) => Promise<void>;
  /**
   * Process an ICE_CANDIDATE signal from the remote peer.
   * Called automatically by VideoShell when ICE signals arrive.
   *
   * Internally buffers candidates received before setRemoteDescription
   * has completed — they are drained immediately after remote desc is set.
   */
  addIceCandidate: (candidate: IceCandidatePayload) => Promise<void>;
  /** Toggle camera on/off */
  toggleCamera: () => void;
  /** Toggle microphone on/off */
  toggleMic: () => void;
  /** End the call and release all resources */
  hangUp: () => Promise<void>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useVideoSession — Manages the local RTCPeerConnection, media streams,
 * and WebRTC negotiation for one video session.
 *
 * Signaling transport (AppSync) is injected via sendSignal so this hook
 * stays purely focused on WebRTC mechanics.
 *
 * ICE candidate buffering:
 *   Remote ICE candidates often arrive via AppSync before
 *   setRemoteDescription has completed on the receiving side. Adding them
 *   before the remote description is set causes silent failures and leaves
 *   the connection stuck in "connecting". We buffer all incoming candidates
 *   in pendingCandidatesRef and drain the queue immediately after
 *   setRemoteDescription resolves.
 */
export function useVideoSession({
  role,
  sendSignal,
  onEnded,
}: UseVideoSessionOptions): UseVideoSessionReturn {
  const [connectionState, setConnectionState] =
    useState<VideoConnectionState>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // ---- ICE candidate buffering -----------------------------------------------
  //
  // Remote ICE candidates often arrive via AppSync before setRemoteDescription
  // has completed. Buffer them here and drain after remote desc is set.
  const pendingCandidatesRef = useRef<IceCandidatePayload[]>([]);
  const remoteDescSetRef = useRef<boolean>(false);

  // ---- Cleanup on unmount -------------------------------------------------

  useEffect(() => {
    return () => {
      pcRef.current?.close();
      releaseStream(localStreamRef.current);
    };
  }, []);

  // ---- Helper: drain buffered ICE candidates after remote desc is set ------

  const drainPendingCandidates = useCallback(async (): Promise<void> => {
    const pc = pcRef.current;
    if (!pc) return;
    const pending = pendingCandidatesRef.current.splice(0);
    if (pending.length > 0) {
      console.log(`[useVideoSession] Draining ${pending.length} buffered ICE candidate(s)`);
    }
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[useVideoSession] drainPendingCandidates error:', err);
      }
    }
  }, []);

  // ---- Helper: wire up a fresh RTCPeerConnection --------------------------

  const initPeerConnection = useCallback(async (): Promise<RTCPeerConnection> => {
    if (pcRef.current) {
      // Replacing an existing connection (re-call). Close it and discard any
      // stale buffered candidates — they belonged to the old session.
      pcRef.current.close();
      pendingCandidatesRef.current = [];
    }
    // Reset the remote-desc gate. Do NOT clear pendingCandidatesRef here for
    // the first-call case: ICE candidates from the recruiter often arrive over
    // AppSync BEFORE the candidate clicks Accept and initPeerConnection() runs.
    // Those candidates are already buffered; clearing the array would lose them.
    remoteDescSetRef.current = false;

    const pc = await createPeerConnection();
    pcRef.current = pc;

    // Forward ICE candidates to the remote peer via AppSync
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      void sendSignal('ICE_CANDIDATE', {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    };

    // Update connection state for UI
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('[useVideoSession] Connection state:', state);
      if (state === 'connected') {
        setConnectionState('connected');
      } else if (state === 'failed' || state === 'disconnected') {
        setConnectionState('error');
      } else if (state === 'closed') {
        setConnectionState('ended');
        onEnded?.();
      }
    };

    // Receive remote tracks
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) setRemoteStream(stream);
    };

    // Add local tracks if already acquired
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        if (localStreamRef.current) {
          pc.addTrack(track, localStreamRef.current);
        }
      });
    }

    return pc;
  }, [sendSignal, onEnded]);

  // ---- Public API ---------------------------------------------------------

  const initMedia = useCallback(async (): Promise<boolean> => {
    const { stream, error } = await requestMediaPermissions(true, true);
    if (error || !stream) {
      console.error('[useVideoSession] initMedia failed:', error);
      setConnectionState('error');
      return false;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    return true;
  }, []);

  const startCall = useCallback(async (): Promise<void> => {
    if (role !== 'RECRUITER') return;
    setConnectionState('calling');

    try {
      const pc = await initPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (!offer.sdp) throw new Error('Offer SDP is empty');

      await sendSignal('OFFER', { type: offer.type, sdp: offer.sdp });
    } catch (err) {
      console.error('[useVideoSession] startCall error:', err);
      setConnectionState('error');
    }
  }, [role, initPeerConnection, sendSignal]);

  const acceptCall = useCallback(
    async (offer: SdpPayload): Promise<void> => {
      if (role !== 'CANDIDATE') return;
      setConnectionState('connecting');

      try {
        // initPeerConnection resets remoteDescSetRef and pendingCandidatesRef
        const pc = await initPeerConnection();

        // Set remote description — ICE candidates received during this await
        // will be buffered by addIceCandidate and drained below.
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        remoteDescSetRef.current = true;

        // Drain any ICE candidates that arrived before remote desc was ready
        await drainPendingCandidates();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (!answer.sdp) throw new Error('Answer SDP is empty');

        await sendSignal('ANSWER', { type: answer.type, sdp: answer.sdp });
      } catch (err) {
        console.error('[useVideoSession] acceptCall error:', err);
        setConnectionState('error');
      }
    },
    [role, initPeerConnection, sendSignal, drainPendingCandidates]
  );

  const addIceCandidate = useCallback(
    async (candidate: IceCandidatePayload): Promise<void> => {
      // Buffer the candidate if remote description hasn't been set yet.
      // This prevents the "cannot add ICE candidate before setRemoteDescription"
      // error that leaves the connection stuck in "connecting".
      if (!remoteDescSetRef.current) {
        console.log('[useVideoSession] Buffering ICE candidate (remote desc not yet set)');
        pendingCandidatesRef.current.push(candidate);
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[useVideoSession] addIceCandidate error:', err);
      }
    },
    []
  );

  const handleAnswerReceived = useCallback(
    async (answer: SdpPayload): Promise<void> => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        remoteDescSetRef.current = true;

        // Drain any ICE candidates from the candidate that arrived before
        // we processed the answer
        await drainPendingCandidates();

        setConnectionState('connecting');
      } catch (err) {
        console.error('[useVideoSession] handleAnswerReceived error:', err);
        setConnectionState('error');
      }
    },
    [drainPendingCandidates]
  );

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setCameraEnabled((prev) => !prev);
  }, []);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setMicEnabled((prev) => !prev);
  }, []);

  const hangUp = useCallback(async (): Promise<void> => {
    await sendSignal('HANGUP', {});
    pcRef.current?.close();
    releaseStream(localStreamRef.current);
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setConnectionState('ended');
    onEnded?.();
  }, [sendSignal, onEnded]);

  // Expose answer handler so VideoShell can call it when ANSWER signal arrives
  return {
    connectionState,
    localStream,
    remoteStream,
    cameraEnabled,
    micEnabled,
    initMedia,
    startCall,
    acceptCall,
    addIceCandidate,
    toggleCamera,
    toggleMic,
    hangUp,
    // Internal: exposed for VideoShell to call when it receives ANSWER
    // (not in the public interface type, accessed via cast in VideoShell)
    ...(role === 'RECRUITER' ? { _handleAnswer: handleAnswerReceived } : {}),
  } as UseVideoSessionReturn;
}
