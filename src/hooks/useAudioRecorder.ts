/**
 * useAudioRecorder — record audio from the microphone, upload to R2,
 * and get a server-side Whisper transcript back.
 *
 * Replaces the unreliable browser Web Speech API with:
 *   1. MediaRecorder for raw audio capture
 *   2. Server-side transcription via Cloudflare Workers AI Whisper (free)
 *
 * Reusable across VoicePanel, VideoSubmissionPanel, or any future component
 * that needs audio → transcript.
 *
 * Usage:
 *   const recorder = useAudioRecorder({ uploadUrl, sessionToken, challengeId });
 *   recorder.start();
 *   // ... user speaks ...
 *   recorder.stop();
 *   // recorder.transcript populated after upload completes
 */

import { useState, useRef, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AudioRecorderConfig {
  /** Full URL for the upload endpoint (e.g. `${API_BASE}/rpc/upload-media`) */
  uploadUrl: string;
  /** Auth token for the upload request */
  sessionToken: string | null;
  /** Challenge ID — used to build the R2 key on the server */
  challengeId: string;
  /** Filename for the uploaded blob (default: `voice-{challengeId}.webm`) */
  filename?: string;
}

export type RecordingState = 'idle' | 'recording' | 'uploading' | 'done' | 'error';

export interface UseAudioRecorderReturn {
  /** Current recording state */
  state: RecordingState;
  /** Server-side Whisper transcript (populated after upload completes) */
  transcript: string;
  /** R2 storage key returned from the server */
  r2Key: string | null;
  /** Error message if something went wrong */
  error: string | null;
  /** Recording duration in seconds (ticks while recording) */
  duration: number;
  /** Start recording from the microphone */
  start: () => Promise<void>;
  /** Stop recording — triggers upload + transcription */
  stop: () => void;
  /** Reset to idle state, clearing transcript and duration */
  reset: () => void;
  /** Manually set the transcript (for user edits) */
  setTranscript: (text: string) => void;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAudioRecorder(config: AudioRecorderConfig): UseAudioRecorderReturn {
  const [state, setState] = useState<RecordingState>('idle');
  const [transcript, setTranscript] = useState('');
  const [r2Key, setR2Key] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback((): void => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const upload = useCallback(async (blob: Blob): Promise<void> => {
    if (!config.sessionToken) {
      setError('No session token — cannot upload');
      setState('error');
      return;
    }

    setState('uploading');

    try {
      const formData = new FormData();
      const filename = config.filename ?? `voice-${config.challengeId}.webm`;
      formData.append('file', blob, filename);
      formData.append('challengeId', config.challengeId);

      const res = await fetch(config.uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.sessionToken}` },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        console.error('[useAudioRecorder] Upload failed:', res.status, text);
        setError(`Upload failed (${res.status})`);
        setState('error');
        return;
      }

      const data = await res.json() as { r2Key: string; transcript?: string | null };
      setR2Key(data.r2Key);

      if (data.transcript) {
        setTranscript(data.transcript);
      }

      setState('done');
    } catch (err) {
      console.error('[useAudioRecorder] Upload error:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
      setState('error');
    }
  }, [config.uploadUrl, config.sessionToken, config.challengeId, config.filename]);

  const start = useCallback(async (): Promise<void> => {
    if (state === 'recording') return;

    setError(null);
    chunksRef.current = [];
    setDuration(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Release mic
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        stopTimer();

        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          void upload(blob);
        } else {
          setState('idle');
        }
      };

      recorder.start(250); // Collect chunks every 250ms

      // Duration timer
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);

      setState('recording');
    } catch (err) {
      console.error('[useAudioRecorder] Mic access failed:', err);
      setError('Microphone access denied');
      setState('error');
    }
  }, [state, upload, stopTimer]);

  const stop = useCallback((): void => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  const reset = useCallback((): void => {
    // Stop any active recording
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    stopTimer();
    setState('idle');
    setTranscript('');
    setR2Key(null);
    setError(null);
    setDuration(0);
    chunksRef.current = [];
  }, [stopTimer]);

  return {
    state,
    transcript,
    r2Key,
    error,
    duration,
    start,
    stop,
    reset,
    setTranscript,
  };
}
