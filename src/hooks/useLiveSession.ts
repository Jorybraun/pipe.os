/**
 * useLiveSession — real-time voice session hook for VoiceSessionDO.
 *
 * Manages the full lifecycle of a WebSocket-based voice session:
 *   - WebSocket connection to the VoiceSessionDO backend
 *   - PCM16 microphone capture via AudioWorklet (16 kHz input)
 *   - PCM16 audio playback (24 kHz output) with sequential queuing
 *   - Transcript accumulation for both user and model speech
 *
 * Usage:
 *   const session = useLiveSession();
 *   session.start(sessionId, authToken);
 *   // session.isConnected, session.userTranscript, session.modelTranscript …
 *   session.stop();
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// ============================================================================
// Public interface
// ============================================================================

export interface UseLiveSessionResult {
  start: (sessionId: string, authToken: string) => void;
  stop: () => void;
  isConnected: boolean;
  isAISpeaking: boolean;
  /** Full transcript of all user speech this session (completed turns only). */
  userTranscript: string;
  /** Full transcript of all model speech this session (completed turns only). */
  modelTranscript: string;
  /** Live current utterance being spoken by the user — resets when AI starts responding. */
  currentUserSpeech: string;
  /** Live current utterance being spoken by the AI — resets when user starts speaking. */
  currentModelSpeech: string;
  error: string | null;
}

// ============================================================================
// Config
// ============================================================================

const API_BASE = import.meta.env?.VITE_API_URL ?? 'http://localhost:8787';
const WS_BASE = API_BASE.replace(/^https/, 'wss').replace(/^http/, 'ws');

/** Mic capture sample rate required by the VoiceSessionDO ingest pipeline. */
const MIC_SAMPLE_RATE = 16_000;

/** Playback sample rate produced by the VoiceSessionDO audio response stream. */
const PLAYBACK_SAMPLE_RATE = 24_000;

// ============================================================================
// AudioWorklet processor source
// Loaded as a Blob URL so the hook ships no separate asset file.
// ============================================================================

const PCM16_PROCESSOR_SOURCE = `
class Pcm16Processor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const pcm16 = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      pcm16[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
    }
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    return true;
  }
}
registerProcessor('pcm16-processor', Pcm16Processor);
`;

// ============================================================================
// Base64 helpers (inline — no external dependency)
// ============================================================================

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ============================================================================
// Incoming WebSocket message shapes
// ============================================================================

interface WsAudioMessage {
  type: 'audio';
  data: string; // base64-encoded PCM16
}

interface WsTranscriptMessage {
  type: 'transcript';
  role: 'user' | 'model';
  text: string;
}

interface WsErrorMessage {
  type: 'error';
  message: string;
}

type WsIncomingMessage = WsAudioMessage | WsTranscriptMessage | WsErrorMessage;

// ============================================================================
// Hook
// ============================================================================

export function useLiveSession(): UseLiveSessionResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [modelTranscript, setModelTranscript] = useState('');
  const [currentUserSpeech, setCurrentUserSpeech] = useState('');
  const [currentModelSpeech, setCurrentModelSpeech] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Refs mirror current-turn state so flush logic in handleMessage can read
  // latest values without stale closures.
  const currentUserSpeechRef = useRef('');
  const currentModelSpeechRef = useRef('');

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);

  // Mic capture
  const micStreamRef = useRef<MediaStream | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletBlobUrlRef = useRef<string | null>(null);

  // Playback
  const playbackContextRef = useRef<AudioContext | null>(null);
  /**
   * Sequential playback queue — each enqueued chunk appends a .then() so
   * buffers play one after another without overlap.
   */
  const playQueueRef = useRef<Promise<void>>(Promise.resolve());

  // ── Mic teardown ───────────────────────────────────────────────────────────

  const stopMic = useCallback((): void => {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    micContextRef.current?.close().catch((err) => {
      console.error('[useLiveSession] Error closing mic AudioContext:', err);
    });
    micContextRef.current = null;

    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;

    if (workletBlobUrlRef.current) {
      URL.revokeObjectURL(workletBlobUrlRef.current);
      workletBlobUrlRef.current = null;
    }
  }, []);

  // ── Playback teardown ──────────────────────────────────────────────────────

  const stopPlayback = useCallback((): void => {
    playbackContextRef.current?.close().catch((err) => {
      console.error('[useLiveSession] Error closing playback AudioContext:', err);
    });
    playbackContextRef.current = null;
    // Reset queue so future calls don't chain off a stale promise
    playQueueRef.current = Promise.resolve();
  }, []);

  // ── Enqueue one PCM16 audio chunk for sequential playback ─────────────────

  const enqueueAudio = useCallback((base64: string): void => {
    playQueueRef.current = playQueueRef.current.then(async () => {
      // Lazily create playback context on first audio chunk
      if (!playbackContextRef.current) {
        playbackContextRef.current = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
      }
      const ctx = playbackContextRef.current;

      // Decode base64 → PCM16 ArrayBuffer → Float32 AudioBuffer
      const rawBuffer = base64ToArrayBuffer(base64);
      const int16 = new Int16Array(rawBuffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i]! / 32768;
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
      audioBuffer.copyToChannel(float32, 0);

      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        setIsAISpeaking(true);
        source.onended = () => {
          setIsAISpeaking(false);
          resolve();
        };

        source.start();
      });
    }).catch((err) => {
      console.error('[useLiveSession] Playback error:', err);
      setIsAISpeaking(false);
    });
  }, []);

  // ── Start mic capture ──────────────────────────────────────────────────────

  const startMic = useCallback(async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
      micContextRef.current = ctx;

      // Build a Blob URL for the inline AudioWorklet processor
      const blob = new Blob([PCM16_PROCESSOR_SOURCE], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      workletBlobUrlRef.current = blobUrl;

      await ctx.audioWorklet.addModule(blobUrl);

      const sourceNode = ctx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(ctx, 'pcm16-processor');
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const base64 = arrayBufferToBase64(event.data);
        ws.send(JSON.stringify({ type: 'audio', data: base64 }));
      };

      sourceNode.connect(workletNode);
      // The worklet is a sink — no downstream connection needed for capture-only
    } catch (err) {
      console.error('[useLiveSession] startMic failed:', err);
      setError(err instanceof Error ? err.message : 'Microphone access failed');
    }
  }, []);

  // ── WebSocket message handler ──────────────────────────────────────────────

  const handleMessage = useCallback(
    (event: MessageEvent): void => {
      let msg: WsIncomingMessage;
      try {
        msg = JSON.parse(event.data as string) as WsIncomingMessage;
      } catch (parseErr) {
        console.error('[useLiveSession] Failed to parse WS message:', parseErr);
        return;
      }

      switch (msg.type) {
        case 'audio':
          // AI audio starting → flush current user speech to history, clear live display
          if (currentUserSpeechRef.current) {
            const flushed = currentUserSpeechRef.current;
            currentUserSpeechRef.current = '';
            setCurrentUserSpeech('');
            setUserTranscript((prev) => (prev ? `${prev}\n${flushed}` : flushed));
          }
          enqueueAudio(msg.data);
          break;

        case 'transcript':
          if (msg.role === 'user') {
            // User speaking → flush any completed model turn to history
            if (currentModelSpeechRef.current) {
              const flushed = currentModelSpeechRef.current;
              currentModelSpeechRef.current = '';
              setCurrentModelSpeech('');
              setModelTranscript((prev) => (prev ? `${prev}\n${flushed}` : flushed));
            }
            // Append to live current-user display
            const nextUser = currentUserSpeechRef.current
              ? `${currentUserSpeechRef.current} ${msg.text}`
              : msg.text;
            currentUserSpeechRef.current = nextUser;
            setCurrentUserSpeech(nextUser);
          } else {
            // Model transcript segment arriving
            const nextModel = currentModelSpeechRef.current
              ? `${currentModelSpeechRef.current} ${msg.text}`
              : msg.text;
            currentModelSpeechRef.current = nextModel;
            setCurrentModelSpeech(nextModel);
          }
          break;

        case 'error':
          console.error('[useLiveSession] Server error:', msg.message);
          setError(msg.message);
          break;

        default:
          // Exhaustiveness guard — unknown message types are silently ignored
          break;
      }
    },
    [enqueueAudio],
  );

  // ── Full teardown (shared by stop() and cleanup on unmount) ───────────────

  const teardown = useCallback((): void => {
    wsRef.current?.close();
    wsRef.current = null;
    stopMic();
    stopPlayback();
  }, [stopMic, stopPlayback]);

  // ── Public: start ──────────────────────────────────────────────────────────

  const start = useCallback(
    (sessionId: string, authToken: string): void => {
      // Guard: don't open a second connection if already connected
      if (wsRef.current) {
        console.warn('[useLiveSession] start() called while already connected — ignoring');
        return;
      }

      setError(null);
      setUserTranscript('');
      setModelTranscript('');
      setCurrentUserSpeech('');
      setCurrentModelSpeech('');
      currentUserSpeechRef.current = '';
      currentModelSpeechRef.current = '';

      const url = `${WS_BASE}/api/v1/voice-sessions/${sessionId}/ws?token=${encodeURIComponent(authToken)}`;
      console.log('[useLiveSession] Connecting to', url);

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[useLiveSession] WebSocket connected');
        setIsConnected(true);
        void startMic();
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        console.log('[useLiveSession] WebSocket closed');
        setIsConnected(false);
        stopMic();
      };

      ws.onerror = () => {
        console.error('[useLiveSession] WebSocket error');
        setError('WebSocket connection error');
        setIsConnected(false);
        stopMic();
      };
    },
    [startMic, handleMessage, stopMic],
  );

  // ── Public: stop ───────────────────────────────────────────────────────────

  const stop = useCallback((): void => {
    teardown();
    setIsConnected(false);
    setIsAISpeaking(false);
  }, [teardown]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  return {
    start,
    stop,
    isConnected,
    isAISpeaking,
    userTranscript,
    modelTranscript,
    currentUserSpeech,
    currentModelSpeech,
    error,
  };
}
