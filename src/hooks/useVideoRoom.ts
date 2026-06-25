/**
 * useVideoRoom — single hook for WebRTC video calls via Durable Object signaling.
 *
 * Replaces useVideoSignaling + useVideoSession with one unified interface.
 * The DO WebSocket IS the state channel — no polling, no bridge effects.
 *
 * Usage:
 *   const room = useVideoRoom({ sessionId, role: 'CANDIDATE', sessionToken });
 *   // room.phase tells you everything
 *   // room.startCall() / room.acceptCall() / room.hangUp()
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { requestMediaPermissions, releaseStream } from '../lib/video/mediaPermissions';
import { createPeerConnection } from '../lib/video/webrtcConfig';
import type { VideoRole, SdpPayload, IceCandidatePayload } from '../lib/video/types';

// ============================================================================
// Types
// ============================================================================

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

export interface UseVideoRoomOptions {
  sessionId: string | null;
  role: VideoRole;
  sessionToken?: string | null;
}

export interface UseVideoRoomReturn {
  phase: RoomPhase;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  pendingOffer: SdpPayload | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  initMedia: () => Promise<boolean>;
  setExistingStream: (stream: MediaStream) => void;
  startCall: () => Promise<void>;
  acceptCall: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleCamera: () => void;
  toggleMic: () => void;
}

// ============================================================================
// Config
// ============================================================================

const API_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '';
const WS_BASE = API_BASE.replace(/^http/, 'ws');

// ============================================================================
// Hook
// ============================================================================

export function useVideoRoom({
  sessionId,
  role,
  sessionToken,
}: UseVideoRoomOptions): UseVideoRoomReturn {
  const [phase, _setPhase] = useState<RoomPhase>('disconnected');
  const setPhase = useCallback((next: RoomPhase) => {
    console.log(`[useVideoRoom:${role}] ${phaseRef.current} → ${next}`);
    _setPhase(next);
  }, [role]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [pendingOffer, setPendingOffer] = useState<SdpPayload | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<IceCandidatePayload[]>([]);
  const remoteDescSetRef = useRef(false);
  const phaseRef = useRef<RoomPhase>('disconnected');

  // Keep phaseRef in sync for use inside callbacks
  phaseRef.current = phase;

  // ── WebSocket lifecycle ────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId) {
      setPhase('disconnected');
      return;
    }

    // Both roles need token in query param — WebSocket upgrades can't carry headers
    const buildWsPath = async (): Promise<string> => {
      if (role === 'CANDIDATE') {
        // Use authenticated route when we have a session token, public route otherwise
        if (sessionToken) {
          return `${WS_BASE}/rpc/video/sessions/${sessionId}/ws?token=${sessionToken}`;
        }
        return `${WS_BASE}/api/v1/video/public/sessions/${sessionId}/ws`;
      }
      // Recruiter: get Clerk token
      let clerkToken: string | null = null;
      try {
        const clerk = (window as unknown as { Clerk?: { session?: { getToken: () => Promise<string> } } }).Clerk;
        clerkToken = clerk?.session ? await clerk.session.getToken() : null;
      } catch { /* no clerk */ }
      return `${WS_BASE}/api/v1/video/sessions/${sessionId}/ws${clerkToken ? `?token=${clerkToken}` : ''}`;
    };

    let cancelled = false;

    void buildWsPath().then((wsPath) => {
      if (cancelled) return;

      const ws = new WebSocket(wsPath);
      wsRef.current = ws;

    ws.onopen = () => {
      console.log(`[useVideoRoom] WebSocket connected as ${role}`);
      // Phase will be set by the STATUS_UPDATE message from the DO
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          role?: string;
          status?: string;
          peers?: number;
          payload?: unknown;
        };

        console.log(`[useVideoRoom:${role}] WS message:`, msg.type, msg.role ?? '', msg.status ?? '');

        switch (msg.type) {
          case 'STATUS_UPDATE': {
            const peers = msg.peers ?? 0;
            const status = msg.status as string | undefined;

            // Handle ENDED from remote peer
            if (status === 'ENDED') {
              pcRef.current?.close();
              pcRef.current = null;
              setPhase('ended');
              break;
            }

            // Handle CALLING from remote peer (recruiter started call — offer is incoming)
            if (status === 'CALLING' && role === 'CANDIDATE') {
              // Offer message follows separately; no phase change needed here
              break;
            }

            // On initial connect, DO sends current status + peer count
            if (peers > 1) {
              // Other peer already here
              setPhase('peer_connected');
            } else if (phaseRef.current === 'disconnected') {
              setPhase('waiting');
            }
            break;
          }

          case 'PEER_CONNECTED':
            setPhase('peer_connected');
            break;

          case 'PEER_DISCONNECTED':
            // If we were connected, go to peer_disconnected
            // If we were waiting, stay waiting
            if (phaseRef.current === 'connected' || phaseRef.current === 'connecting') {
              pcRef.current?.close();
              pcRef.current = null;
              remoteDescSetRef.current = false;
              pendingCandidatesRef.current = [];
              setRemoteStream(null);
              setPhase('peer_disconnected');
            } else {
              setPhase('waiting');
            }
            break;

          case 'OFFER':
            if (msg.role !== role) {
              setPendingOffer(msg.payload as SdpPayload);
              setPhase('offer_received');
            }
            break;

          case 'ANSWER':
            if (msg.role !== role && pcRef.current) {
              void handleAnswer(msg.payload as SdpPayload);
            }
            break;

          case 'ICE_CANDIDATE':
            if (msg.role !== role) {
              void handleIceCandidate(msg.payload as IceCandidatePayload);
            }
            break;

          case 'HANGUP':
            pcRef.current?.close();
            pcRef.current = null;
            setPhase('ended');
            break;
        }
      } catch (err) {
        console.error('[useVideoRoom] Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      console.log('[useVideoRoom] WebSocket closed');
      wsRef.current = null;
      if (phaseRef.current !== 'ended') {
        setPhase('disconnected');
      }
    };

    ws.onerror = () => {
      console.error('[useVideoRoom] WebSocket error');
    };

    }); // end buildWsPath().then

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [sessionId, role, sessionToken]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      pcRef.current?.close();
      releaseStream(localStreamRef.current);
    };
  }, []);

  // ── WebSocket send helpers ─────────────────────────────────────────────

  const wsSendSignal = useCallback((type: string, payload: unknown): void => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[useVideoRoom] WebSocket not connected');
      return;
    }
    ws.send(JSON.stringify({ type, payload }));
  }, []);

  const wsSendStatus = useCallback((status: string): void => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'STATUS_UPDATE', status }));
  }, []);

  // ── ICE candidate handling ─────────────────────────────────────────────

  const handleIceCandidate = useCallback(async (candidate: IceCandidatePayload): Promise<void> => {
    if (!remoteDescSetRef.current) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    try {
      await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[useVideoRoom] addIceCandidate error:', err);
    }
  }, []);

  const drainPendingCandidates = useCallback(async (): Promise<void> => {
    const pc = pcRef.current;
    if (!pc) return;
    const pending = pendingCandidatesRef.current.splice(0);
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[useVideoRoom] drain ICE error:', err);
      }
    }
  }, []);

  // ── ANSWER handler (recruiter receives candidate's answer) ─────────────

  const handleAnswer = useCallback(async (answer: SdpPayload): Promise<void> => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      remoteDescSetRef.current = true;
      await drainPendingCandidates();
    } catch (err) {
      console.error('[useVideoRoom] handleAnswer error:', err);
      setPhase('error');
    }
  }, [drainPendingCandidates]);

  // ── Create RTCPeerConnection ───────────────────────────────────────────

  const initPeerConnection = useCallback((iceServers?: RTCIceServer[]): RTCPeerConnection => {
    if (pcRef.current) {
      pcRef.current.close();
      pendingCandidatesRef.current = [];
    }
    remoteDescSetRef.current = false;

    const pc = createPeerConnection(iceServers);
    pcRef.current = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      wsSendSignal('ICE_CANDIDATE', {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('[useVideoRoom] RTCPeerConnection state:', state);
      if (state === 'connected') setPhase('connected');
      else if (state === 'failed' || state === 'disconnected') setPhase('error');
      else if (state === 'closed') setPhase('ended');
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) setRemoteStream(stream);
    };

    // Add local tracks if already acquired
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    return pc;
  }, [wsSendSignal]);

  // ── Public API ─────────────────────────────────────────────────────────

  const initMedia = useCallback(async (): Promise<boolean> => {
    const { stream, error } = await requestMediaPermissions(true, true);
    if (error || !stream) {
      console.error('[useVideoRoom] initMedia failed:', error);
      return false;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    return true;
  }, []);

  const setExistingStream = useCallback((stream: MediaStream): void => {
    localStreamRef.current = stream;
    setLocalStream(stream);
  }, []);

  const startCall = useCallback(async (): Promise<void> => {
    if (role !== 'RECRUITER') return;
    setPhase('connecting');

    try {
      const { getIceServers } = await import('../lib/video/webrtcConfig');
      const getToken = async (): Promise<string | null> => {
        try {
          const clerk = (window as unknown as { Clerk?: { session?: { getToken: () => Promise<string> } } }).Clerk;
          return clerk?.session ? await clerk.session.getToken() : null;
        } catch { return null; }
      };
      const iceServers = await getIceServers(getToken);
      const pc = initPeerConnection(iceServers);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      wsSendSignal('OFFER', { type: offer.type, sdp: offer.sdp, iceServers });
      wsSendStatus('CALLING');
    } catch (err) {
      console.error('[useVideoRoom] startCall error:', err);
      setPhase('error');
    }
  }, [role, initPeerConnection, wsSendSignal, wsSendStatus]);

  const acceptCall = useCallback(async (): Promise<void> => {
    if (role !== 'CANDIDATE' || !pendingOffer) return;
    setPhase('connecting');

    try {
      const pc = initPeerConnection(pendingOffer.iceServers);
      await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      remoteDescSetRef.current = true;
      await drainPendingCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      wsSendSignal('ANSWER', { type: answer.type, sdp: answer.sdp });
      wsSendStatus('ACTIVE');
      setPendingOffer(null);
    } catch (err) {
      console.error('[useVideoRoom] acceptCall error:', err);
      setPhase('error');
    }
  }, [role, pendingOffer, initPeerConnection, drainPendingCandidates, wsSendSignal, wsSendStatus]);

  const hangUp = useCallback(async (): Promise<void> => {
    pcRef.current?.close();
    pcRef.current = null;
    wsSendSignal('HANGUP', {});
    wsSendStatus('ENDED');
    setPhase('ended');
  }, [wsSendSignal, wsSendStatus]);

  const toggleCamera = useCallback((): void => {
    localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
    setCameraEnabled((prev) => !prev);
  }, []);

  const toggleMic = useCallback((): void => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setMicEnabled((prev) => !prev);
  }, []);

  return {
    phase,
    localStream,
    remoteStream,
    pendingOffer,
    cameraEnabled,
    micEnabled,
    initMedia,
    setExistingStream,
    startCall,
    acceptCall,
    hangUp,
    toggleCamera,
    toggleMic,
  };
}
