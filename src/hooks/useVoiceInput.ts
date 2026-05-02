/**
 * useVoiceInput — reusable browser SpeechRecognition (STT) hook.
 *
 * Extracted from AIChat.tsx to be shared across Culture Interview,
 * Role Discovery, Screening, and any future interview flows.
 *
 * Uses the native Web Speech API (SpeechRecognition / webkitSpeechRecognition)
 * with continuous + interimResults for streaming transcription.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Web Speech API typings (not in lib.dom.d.ts by default) ─────────────────

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

// ─── Options & Result ─────────────────────────────────────────────────────────

export interface UseVoiceInputOptions {
  /** Whether voice input is enabled. When false, startRecording is a no-op. */
  enabled: boolean;
  /** Called with the merged transcript whenever speech is recognized. */
  onTranscript: (text: string) => void;
  /** Called when a fatal error occurs (unsupported browser, permission denied, etc.). */
  onError?: (message: string) => void;
}

export interface UseVoiceInputResult {
  isRecording: boolean;
  recordDuration: number;
  recordError: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  /** True if the browser supports SpeechRecognition. */
  isSupported: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputResult {
  const { enabled, onTranscript, onError } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseAnswerRef = useRef('');   // text that existed when recording started
  const finalTranscriptRef = useRef(''); // finalized chunks accumulated this session
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const w = typeof window !== 'undefined' ? (window as unknown as SpeechWindow) : null;
  const Ctor = w ? (w.SpeechRecognition ?? w.webkitSpeechRecognition) : undefined;
  const isSupported = !!Ctor;

  const startRecording = useCallback(async (): Promise<void> => {
    if (!enabled || !Ctor) {
      onError?.('Voice input is not supported in this browser.');
      return;
    }

    try {
      // Warm up mic permission so the first `start()` doesn't stall.
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) =>
        s.getTracks().forEach((t) => t.stop()),
      );
    } catch {
      const msg = 'Microphone permission denied.';
      setRecordError(msg);
      onError?.(msg);
      return;
    }

    baseAnswerRef.current = '';
    finalTranscriptRef.current = '';
    setRecordDuration(0);
    setRecordError(null);

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e) => {
      let interim = '';
      let newFinal = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result) continue;
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) newFinal += alt.transcript;
        else interim += alt.transcript;
      }
      if (newFinal) finalTranscriptRef.current += newFinal;
      const merged = [baseAnswerRef.current, (finalTranscriptRef.current + interim).trim()]
        .filter((s) => s && s.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ');
      onTranscript(merged);
    };

    recognition.onerror = (e) => {
      console.error('[useVoiceInput] SpeechRecognition error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        const msg = 'Microphone permission denied.';
        setRecordError(msg);
        onError?.(msg);
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        const msg = 'Voice input failed. Please type your answer.';
        setRecordError(msg);
        onError?.(msg);
      }
    };

    recognition.onend = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      console.error('[useVoiceInput] SpeechRecognition start error:', err);
      const msg = 'Could not start voice input.';
      setRecordError(msg);
      onError?.(msg);
      return;
    }

    timerRef.current = setInterval(() => setRecordDuration((d) => d + 1), 1000);
    setIsRecording(true);
  }, [enabled, Ctor, onTranscript, onError]);

  const stopRecording = useCallback((): void => {
    recognitionRef.current?.stop();
    // onend handles state cleanup
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recognitionRef.current?.stop();
    };
  }, []);

  return {
    isRecording,
    recordDuration,
    recordError,
    startRecording,
    stopRecording,
    isSupported,
  };
}
