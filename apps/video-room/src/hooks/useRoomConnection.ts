import { useCallback, useEffect, useRef, useState } from 'react';
import { getIceServerConfig, roomWebSocketUrl } from '../lib/api';
import type {
  IceServerProvider,
  IceCandidatePayload,
  RoomPhase,
  RoomRole,
  SdpPayload,
} from '../types';

interface RoomConnection {
  phase: RoomPhase;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  iceProvider: IceServerProvider;
  cameraEnabled: boolean;
  micEnabled: boolean;
  setLocalStream: (stream: MediaStream) => void;
  startCall: () => Promise<void>;
  acceptCall: () => Promise<void>;
  hangUp: () => void;
  toggleCamera: () => void;
  toggleMic: () => void;
  retryConnection: () => void;
}

const FALLBACK_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const PEER_DISCONNECT_GRACE_MS = 8000;
const PEER_FAILED_GRACE_MS = 8000;
const PEER_RENEGOTIATE_DELAY_MS = 750;

function createPeerConfiguration(iceServers: RTCIceServer[]): RTCConfiguration {
  return {
    iceServers,
    // Keep TURN available, but do not force relay-only. When the relay path is
    // slow or blocked, browsers should still be allowed to use healthy direct
    // or STUN candidates.
    iceTransportPolicy: 'all',
  };
}

export function useRoomConnection(token: string, role: RoomRole, active: boolean): RoomConnection {
  const [phase, setPhase] = useState<RoomPhase>('disconnected');
  const [localStream, setLocalStreamState] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [iceProvider, setIceProvider] = useState<IceServerProvider>('unknown');
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const offerRef = useRef<SdpPayload | null>(null);
  const pendingIceRef = useRef<IceCandidatePayload[]>([]);
  const remoteReadyRef = useRef(false);
  const phaseRef = useRef<RoomPhase>('disconnected');
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const peerDisconnectTimerRef = useRef<number | null>(null);
  const peerRenegotiateTimerRef = useRef<number | null>(null);
  const startingCallRef = useRef(false);
  const startCallRef = useRef<RoomConnection['startCall'] | null>(null);
  const autoStartTimerRef = useRef<number | null>(null);
  phaseRef.current = phase;

  const setConnectionPhase = useCallback((nextPhase: RoomPhase): void => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  useEffect(() => {
    remoteRef.current = remoteStream;
  }, [remoteStream]);

  const hasOpenSignal = useCallback((): boolean => (
    wsRef.current?.readyState === WebSocket.OPEN
  ), []);

  const send = useCallback((type: string, payload: unknown): boolean => {
    if (!hasOpenSignal()) return false;
    wsRef.current!.send(JSON.stringify({ type, payload }));
    return true;
  }, [hasOpenSignal]);

  const sendStatus = useCallback((status: string): boolean => {
    if (!hasOpenSignal()) return false;
    wsRef.current!.send(JSON.stringify({ type: 'STATUS_UPDATE', status }));
    return true;
  }, [hasOpenSignal]);

  const drainIce = useCallback(async (): Promise<void> => {
    const peer = peerRef.current;
    if (!peer) return;
    for (const candidate of pendingIceRef.current.splice(0)) {
      await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
    }
  }, []);

  const clearPeerDisconnectTimer = useCallback((): void => {
    if (peerDisconnectTimerRef.current !== null) {
      window.clearTimeout(peerDisconnectTimerRef.current);
      peerDisconnectTimerRef.current = null;
    }
  }, []);

  const clearPeerRenegotiateTimer = useCallback((): void => {
    if (peerRenegotiateTimerRef.current !== null) {
      window.clearTimeout(peerRenegotiateTimerRef.current);
      peerRenegotiateTimerRef.current = null;
    }
  }, []);

  const closePeer = useCallback((nextPhase?: RoomPhase): void => {
    clearPeerDisconnectTimer();
    clearPeerRenegotiateTimer();
    const peer = peerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
    }
    peerRef.current = null;
    pendingIceRef.current = [];
    remoteReadyRef.current = false;
    setRemoteStream(null);
    if (nextPhase) {
      setConnectionPhase(nextPhase);
    }
  }, [clearPeerDisconnectTimer, clearPeerRenegotiateTimer, setConnectionPhase]);

  const handleSignalUnavailable = useCallback((): void => {
    if (phaseRef.current === 'ended') return;
    closePeer('peer_disconnected');
  }, [closePeer]);

  const scheduleHostRenegotiation = useCallback((): void => {
    if (role !== 'HOST' || phaseRef.current === 'ended') return;
    if (!localRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;
    if (peerRenegotiateTimerRef.current !== null) return;

    peerRenegotiateTimerRef.current = window.setTimeout(() => {
      peerRenegotiateTimerRef.current = null;
      if (role !== 'HOST' || phaseRef.current === 'ended') return;
      if (!localRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;
      void startCallRef.current?.();
    }, PEER_RENEGOTIATE_DELAY_MS);
  }, [role]);

  const schedulePeerClose = useCallback((
    peer: RTCPeerConnection,
    delayMs: number,
    options: { retryHost?: boolean } = {},
  ): void => {
    if (phaseRef.current === 'ended') return;
    setConnectionPhase('peer_disconnected');
    if (peerDisconnectTimerRef.current !== null) return;
    peerDisconnectTimerRef.current = window.setTimeout(() => {
      peerDisconnectTimerRef.current = null;
      if (peerRef.current !== peer || phaseRef.current === 'ended') return;
      if (peer.connectionState === 'connected') {
        setConnectionPhase('connected');
        return;
      }
      closePeer('peer_disconnected');
      if (options.retryHost) scheduleHostRenegotiation();
    }, delayMs);
  }, [closePeer, scheduleHostRenegotiation, setConnectionPhase]);

  const createPeer = useCallback((iceServers: RTCIceServer[]): RTCPeerConnection => {
    closePeer();
    pendingIceRef.current = [];
    remoteReadyRef.current = false;
    const peer = new RTCPeerConnection(createPeerConfiguration(iceServers));
    peerRef.current = peer;
    localRef.current?.getTracks().forEach((track) => {
      peer.addTrack(track, localRef.current!);
    });
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      send('ICE_CANDIDATE', {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    };
    peer.ontrack = ({ streams }) => {
      if (streams[0]) {
        clearPeerDisconnectTimer();
        setRemoteStream(streams[0]);
        setConnectionPhase('connected');
      }
    };
    peer.onconnectionstatechange = () => {
      if (peerRef.current !== peer) return;
      if (peer.connectionState === 'connected') {
        clearPeerDisconnectTimer();
        setConnectionPhase('connected');
      } else if (peer.connectionState === 'disconnected') {
        schedulePeerClose(peer, PEER_DISCONNECT_GRACE_MS, { retryHost: true });
      } else if (peer.connectionState === 'failed') {
        schedulePeerClose(peer, PEER_FAILED_GRACE_MS, { retryHost: true });
      } else if (peer.connectionState === 'closed' && phaseRef.current !== 'ended') {
        closePeer('peer_disconnected');
      }
    };
    peer.oniceconnectionstatechange = () => {
      if (peerRef.current !== peer) return;
      if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
        clearPeerDisconnectTimer();
        setConnectionPhase('connected');
      } else if (peer.iceConnectionState === 'disconnected') {
        schedulePeerClose(peer, PEER_DISCONNECT_GRACE_MS, { retryHost: true });
      } else if (peer.iceConnectionState === 'failed') {
        schedulePeerClose(peer, PEER_FAILED_GRACE_MS, { retryHost: true });
      } else if (peer.iceConnectionState === 'closed' && phaseRef.current !== 'ended') {
        closePeer('peer_disconnected');
      }
    };
    return peer;
  }, [clearPeerDisconnectTimer, closePeer, schedulePeerClose, send, setConnectionPhase]);

  useEffect(() => {
    if (!active) return undefined;

    let disposed = false;
    const clearReconnect = (): void => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = (): void => {
      if (disposed) return;
      clearReconnect();
      const ws = new WebSocket(roomWebSocketUrl(token));
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        const peer = peerRef.current;
        if (
          remoteRef.current ||
          peer?.connectionState === 'connected' ||
          peer?.iceConnectionState === 'connected' ||
          peer?.iceConnectionState === 'completed'
        ) {
          clearPeerDisconnectTimer();
          setConnectionPhase('connected');
          sendStatus('ACTIVE');
          return;
        }
        if (phaseRef.current === 'disconnected') {
          setConnectionPhase('waiting');
        } else if (phaseRef.current === 'peer_disconnected' && role === 'HOST') {
          scheduleHostRenegotiation();
        }
      };
      ws.onmessage = (event) => {
        let message: {
          type: string;
          role?: RoomRole;
          status?: string;
          peers?: number;
          payload?: unknown;
        };
        try {
          message = JSON.parse(event.data as string) as typeof message;
        } catch {
          return;
        }
        if (message.type === 'STATUS_UPDATE') {
          if (message.status === 'ENDED') {
            setConnectionPhase('ended');
          } else if ((message.peers ?? 0) > 1 && !remoteRef.current && phaseRef.current !== 'connected') {
            setConnectionPhase('peer_connected');
          } else if (
            phaseRef.current === 'disconnected' ||
            phaseRef.current === 'error'
          ) {
            setConnectionPhase('waiting');
          }
        } else if (message.type === 'PEER_CONNECTED') {
          const peer = peerRef.current;
          if (peer?.connectionState === 'failed' || peer?.connectionState === 'closed') {
            closePeer('peer_connected');
          } else if (remoteRef.current || peer?.connectionState === 'connected') {
            clearPeerDisconnectTimer();
            setConnectionPhase('connected');
          } else if (phaseRef.current !== 'connected') {
            clearPeerDisconnectTimer();
            setConnectionPhase('peer_connected');
          }
        } else if (message.type === 'PEER_DISCONNECTED') {
          const peer = peerRef.current;
          if (peer && remoteRef.current) {
            schedulePeerClose(peer, PEER_DISCONNECT_GRACE_MS);
          } else {
            closePeer('peer_disconnected');
          }
        } else if (message.type === 'OFFER' && message.role !== role) {
          offerRef.current = message.payload as SdpPayload;
          setIceProvider(offerRef.current.iceProvider ?? 'unknown');
          setConnectionPhase('offer_received');
        } else if (message.type === 'ANSWER' && message.role !== role && peerRef.current) {
          void peerRef.current
            .setRemoteDescription(new RTCSessionDescription(message.payload as SdpPayload))
            .then(async () => {
              remoteReadyRef.current = true;
              await drainIce();
            })
            .catch(() => {
              if (phaseRef.current !== 'ended') closePeer('peer_disconnected');
            });
        } else if (message.type === 'ICE_CANDIDATE' && message.role !== role) {
          const candidate = message.payload as IceCandidatePayload;
          if (!remoteReadyRef.current) pendingIceRef.current.push(candidate);
          else void peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
        } else if (message.type === 'HANGUP') {
          closePeer('ended');
        }
      };
      ws.onerror = () => {
        if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
          ws.close();
        }
      };
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        if (disposed || phaseRef.current === 'ended') return;
        reconnectAttemptRef.current += 1;
        const delayMs = Math.min(500 * 2 ** Math.min(reconnectAttemptRef.current - 1, 4), 5000);
        const nextPhase = phaseRef.current === 'connected'
          ? 'peer_disconnected'
          : 'disconnected';
        setConnectionPhase(nextPhase);
        reconnectTimerRef.current = window.setTimeout(connect, delayMs);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearReconnect();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [
    active,
    clearPeerDisconnectTimer,
    closePeer,
    drainIce,
    role,
    scheduleHostRenegotiation,
    schedulePeerClose,
    sendStatus,
    setConnectionPhase,
    token,
  ]);

  useEffect(() => () => {
    if (peerDisconnectTimerRef.current !== null) {
      window.clearTimeout(peerDisconnectTimerRef.current);
      peerDisconnectTimerRef.current = null;
    }
    if (autoStartTimerRef.current !== null) {
      window.clearTimeout(autoStartTimerRef.current);
      autoStartTimerRef.current = null;
    }
    clearPeerRenegotiateTimer();
    const peer = peerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
    }
    localRef.current?.getTracks().forEach((track) => track.stop());
  }, [clearPeerRenegotiateTimer]);

  const setLocalStream = useCallback((stream: MediaStream): void => {
    localRef.current = stream;
    setLocalStreamState(stream);
  }, []);

  const startCall = useCallback(async (): Promise<void> => {
    if (role !== 'HOST') return;
    if (startingCallRef.current) return;
    startingCallRef.current = true;
    setConnectionPhase('connecting');
    try {
      if (!localRef.current || !hasOpenSignal()) {
        handleSignalUnavailable();
        return;
      }
      const config = await getIceServerConfig(token).catch(() => ({
        iceServers: FALLBACK_ICE,
        provider: 'fallback' as const,
      }));
      if (!localRef.current || !hasOpenSignal()) {
        handleSignalUnavailable();
        return;
      }
      setIceProvider(config.provider);
      const peer = createPeer(config.iceServers);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const offered = send('OFFER', {
        type: offer.type,
        sdp: offer.sdp,
        iceServers: config.iceServers,
        iceProvider: config.provider,
      });
      if (!offered) {
        handleSignalUnavailable();
        return;
      }
      sendStatus('CALLING');
    } catch {
      closePeer('error');
    } finally {
      startingCallRef.current = false;
    }
  }, [
    closePeer,
    createPeer,
    handleSignalUnavailable,
    hasOpenSignal,
    role,
    send,
    sendStatus,
    setConnectionPhase,
    token,
  ]);
  startCallRef.current = startCall;

  const acceptCall = useCallback(async (): Promise<void> => {
    const offer = offerRef.current;
    if (role !== 'GUEST' || !offer) return;
    setConnectionPhase('connecting');
    setIceProvider(offer.iceProvider ?? 'unknown');
    try {
      if (!localRef.current || !hasOpenSignal()) {
        handleSignalUnavailable();
        return;
      }
      const peer = createPeer(offer.iceServers ?? FALLBACK_ICE);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      remoteReadyRef.current = true;
      await drainIce();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const answered = send('ANSWER', { type: answer.type, sdp: answer.sdp });
      if (!answered) {
        handleSignalUnavailable();
        return;
      }
      sendStatus('ACTIVE');
    } catch {
      closePeer('error');
    }
  }, [
    closePeer,
    createPeer,
    drainIce,
    handleSignalUnavailable,
    hasOpenSignal,
    role,
    send,
    sendStatus,
    setConnectionPhase,
  ]);

  const retryConnection = useCallback((): void => {
    if (phaseRef.current === 'ended') return;
    clearPeerRenegotiateTimer();
    clearPeerDisconnectTimer();
    if (role === 'HOST') {
      closePeer('connecting');
      void startCallRef.current?.();
      return;
    }
    if (offerRef.current) {
      closePeer('offer_received');
      void acceptCall();
      return;
    }
    closePeer('waiting');
  }, [
    acceptCall,
    clearPeerDisconnectTimer,
    clearPeerRenegotiateTimer,
    closePeer,
    role,
  ]);

  const hangUp = useCallback((): void => {
    setConnectionPhase('ended');
    if (autoStartTimerRef.current !== null) {
      window.clearTimeout(autoStartTimerRef.current);
      autoStartTimerRef.current = null;
    }
    clearPeerRenegotiateTimer();
    if (role === 'HOST') {
      send('HANGUP', {});
      sendStatus('ENDED');
    } else {
      sendStatus('LEFT');
    }
    closePeer('ended');
  }, [clearPeerRenegotiateTimer, closePeer, role, send, sendStatus, setConnectionPhase]);

  const toggleCamera = useCallback((): void => {
    localRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled;
    });
    setCameraEnabled((value) => !value);
  }, []);

  const toggleMic = useCallback((): void => {
    localRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled;
    });
    setMicEnabled((value) => !value);
  }, []);

  useEffect(() => {
    if (
      !active ||
      role !== 'HOST' ||
      !localStream ||
      phase !== 'peer_connected' ||
      startingCallRef.current ||
      autoStartTimerRef.current !== null
    ) {
      return undefined;
    }

    autoStartTimerRef.current = window.setTimeout(() => {
      autoStartTimerRef.current = null;
      if (phaseRef.current === 'peer_connected' && localRef.current) {
        void startCall();
      }
    }, 350);

    return () => {
      if (autoStartTimerRef.current !== null) {
        window.clearTimeout(autoStartTimerRef.current);
        autoStartTimerRef.current = null;
      }
    };
  }, [active, localStream, phase, role, startCall]);

  return {
    phase,
    localStream,
    remoteStream,
    iceProvider,
    cameraEnabled,
    micEnabled,
    setLocalStream,
    startCall,
    acceptCall,
    hangUp,
    toggleCamera,
    toggleMic,
    retryConnection,
  };
}
