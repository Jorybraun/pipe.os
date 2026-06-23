import { useCallback, useEffect, useRef, useState } from 'react';
import { getIceServers, roomWebSocketUrl } from '../lib/api';
import type {
  IceCandidatePayload,
  RoomPhase,
  RoomRole,
  SdpPayload,
} from '../types';

interface RoomConnection {
  phase: RoomPhase;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  setLocalStream: (stream: MediaStream) => void;
  startCall: () => Promise<void>;
  acceptCall: () => Promise<void>;
  hangUp: () => void;
  toggleCamera: () => void;
  toggleMic: () => void;
}

const FALLBACK_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const PEER_DISCONNECT_GRACE_MS = 8000;
const PEER_FAILED_GRACE_MS = 2500;

export function useRoomConnection(token: string, role: RoomRole, active: boolean): RoomConnection {
  const [phase, setPhase] = useState<RoomPhase>('disconnected');
  const [localStream, setLocalStreamState] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
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
  phaseRef.current = phase;

  useEffect(() => {
    remoteRef.current = remoteStream;
  }, [remoteStream]);

  const send = useCallback((type: string, payload: unknown): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const sendStatus = useCallback((status: string): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'STATUS_UPDATE', status }));
    }
  }, []);

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

  const closePeer = useCallback((nextPhase?: RoomPhase): void => {
    clearPeerDisconnectTimer();
    const peer = peerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    peerRef.current = null;
    pendingIceRef.current = [];
    remoteReadyRef.current = false;
    setRemoteStream(null);
    if (nextPhase) {
      phaseRef.current = nextPhase;
      setPhase(nextPhase);
    }
  }, [clearPeerDisconnectTimer]);

  const schedulePeerClose = useCallback((peer: RTCPeerConnection, delayMs: number): void => {
    if (phaseRef.current === 'ended') return;
    phaseRef.current = 'peer_disconnected';
    setPhase('peer_disconnected');
    if (peerDisconnectTimerRef.current !== null) return;
    peerDisconnectTimerRef.current = window.setTimeout(() => {
      peerDisconnectTimerRef.current = null;
      if (peerRef.current !== peer || phaseRef.current === 'ended') return;
      if (peer.connectionState === 'connected') {
        phaseRef.current = 'connected';
        setPhase('connected');
        return;
      }
      closePeer('peer_disconnected');
    }, delayMs);
  }, [closePeer]);

  const createPeer = useCallback((iceServers: RTCIceServer[]): RTCPeerConnection => {
    closePeer();
    pendingIceRef.current = [];
    remoteReadyRef.current = false;
    const peer = new RTCPeerConnection({ iceServers });
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
        setPhase('connected');
      }
    };
    peer.onconnectionstatechange = () => {
      if (peerRef.current !== peer) return;
      if (peer.connectionState === 'connected') {
        clearPeerDisconnectTimer();
        setPhase('connected');
      } else if (peer.connectionState === 'disconnected') {
        schedulePeerClose(peer, PEER_DISCONNECT_GRACE_MS);
      } else if (peer.connectionState === 'failed') {
        schedulePeerClose(peer, PEER_FAILED_GRACE_MS);
      } else if (peer.connectionState === 'closed' && phaseRef.current !== 'ended') {
        closePeer('peer_disconnected');
      }
    };
    return peer;
  }, [clearPeerDisconnectTimer, closePeer, schedulePeerClose, send]);

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
        if (phaseRef.current === 'disconnected') setPhase('waiting');
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
            phaseRef.current = 'ended';
            setPhase('ended');
          } else if ((message.peers ?? 0) > 1 && !remoteRef.current && phaseRef.current !== 'connected') {
            setPhase('peer_connected');
          } else if (
            phaseRef.current === 'disconnected' ||
            phaseRef.current === 'error'
          ) {
            setPhase('waiting');
          }
        } else if (message.type === 'PEER_CONNECTED') {
          const peer = peerRef.current;
          if (peer?.connectionState === 'failed' || peer?.connectionState === 'closed') {
            closePeer('peer_connected');
          } else if (remoteRef.current || peer?.connectionState === 'connected') {
            clearPeerDisconnectTimer();
            setPhase('connected');
          } else if (phaseRef.current !== 'connected') {
            clearPeerDisconnectTimer();
            setPhase('peer_connected');
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
          setPhase('offer_received');
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
        setPhase((current) => {
          if (current === 'connected') return 'peer_disconnected';
          if (current === 'ended') return current;
          return 'disconnected';
        });
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
  }, [active, clearPeerDisconnectTimer, closePeer, drainIce, role, schedulePeerClose, token]);

  useEffect(() => () => {
    if (peerDisconnectTimerRef.current !== null) {
      window.clearTimeout(peerDisconnectTimerRef.current);
      peerDisconnectTimerRef.current = null;
    }
    const peer = peerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    localRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const setLocalStream = useCallback((stream: MediaStream): void => {
    localRef.current = stream;
    setLocalStreamState(stream);
  }, []);

  const startCall = useCallback(async (): Promise<void> => {
    if (role !== 'HOST') return;
    setPhase('connecting');
    const iceServers = await getIceServers(token).catch(() => FALLBACK_ICE);
    const peer = createPeer(iceServers);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send('OFFER', { type: offer.type, sdp: offer.sdp, iceServers });
    sendStatus('CALLING');
  }, [createPeer, role, send, sendStatus, token]);

  const acceptCall = useCallback(async (): Promise<void> => {
    const offer = offerRef.current;
    if (role !== 'GUEST' || !offer) return;
    setPhase('connecting');
    const peer = createPeer(offer.iceServers ?? FALLBACK_ICE);
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    remoteReadyRef.current = true;
    await drainIce();
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    send('ANSWER', { type: answer.type, sdp: answer.sdp });
    sendStatus('ACTIVE');
  }, [createPeer, drainIce, role, send, sendStatus]);

  const hangUp = useCallback((): void => {
    phaseRef.current = 'ended';
    if (role === 'HOST') {
      send('HANGUP', {});
      sendStatus('ENDED');
    } else {
      sendStatus('LEFT');
    }
    closePeer('ended');
  }, [closePeer, role, send, sendStatus]);

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

  return {
    phase,
    localStream,
    remoteStream,
    cameraEnabled,
    micEnabled,
    setLocalStream,
    startCall,
    acceptCall,
    hangUp,
    toggleCamera,
    toggleMic,
  };
}
