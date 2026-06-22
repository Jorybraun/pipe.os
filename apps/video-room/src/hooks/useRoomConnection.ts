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

export function useRoomConnection(token: string, role: RoomRole): RoomConnection {
  const [phase, setPhase] = useState<RoomPhase>('disconnected');
  const [localStream, setLocalStreamState] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const offerRef = useRef<SdpPayload | null>(null);
  const pendingIceRef = useRef<IceCandidatePayload[]>([]);
  const remoteReadyRef = useRef(false);
  const phaseRef = useRef<RoomPhase>('disconnected');
  phaseRef.current = phase;

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
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  const createPeer = useCallback((iceServers: RTCIceServer[]): RTCPeerConnection => {
    peerRef.current?.close();
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
        setRemoteStream(streams[0]);
        setPhase('connected');
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') setPhase('connected');
      if (peer.connectionState === 'failed') setPhase('error');
    };
    return peer;
  }, [send]);

  useEffect(() => {
    const ws = new WebSocket(roomWebSocketUrl(token));
    wsRef.current = ws;
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as {
        type: string;
        role?: RoomRole;
        status?: string;
        peers?: number;
        payload?: unknown;
      };
      if (message.type === 'STATUS_UPDATE') {
        if (message.status === 'ENDED') setPhase('ended');
        else if ((message.peers ?? 0) > 1) setPhase('peer_connected');
        else if (phaseRef.current === 'disconnected') setPhase('waiting');
      } else if (message.type === 'PEER_CONNECTED') {
        setPhase('peer_connected');
      } else if (message.type === 'PEER_DISCONNECTED') {
        setRemoteStream(null);
        setPhase('peer_disconnected');
      } else if (message.type === 'OFFER' && message.role !== role) {
        offerRef.current = message.payload as SdpPayload;
        setPhase('offer_received');
      } else if (message.type === 'ANSWER' && message.role !== role && peerRef.current) {
        void peerRef.current
          .setRemoteDescription(new RTCSessionDescription(message.payload as SdpPayload))
          .then(async () => {
            remoteReadyRef.current = true;
            await drainIce();
          });
      } else if (message.type === 'ICE_CANDIDATE' && message.role !== role) {
        const candidate = message.payload as IceCandidatePayload;
        if (!remoteReadyRef.current) pendingIceRef.current.push(candidate);
        else void peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
      } else if (message.type === 'HANGUP') {
        setPhase('ended');
      }
    };
    ws.onerror = () => setPhase('error');
    ws.onclose = () => {
      if (phaseRef.current !== 'ended') setPhase('disconnected');
    };
    return () => ws.close();
  }, [drainIce, role, token]);

  useEffect(() => () => {
    peerRef.current?.close();
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
    send('HANGUP', {});
    sendStatus('ENDED');
    peerRef.current?.close();
    setPhase('ended');
  }, [send, sendStatus]);

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
