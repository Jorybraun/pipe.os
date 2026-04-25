import { useRef, useState, useCallback, useEffect } from 'react';

// ── Browser SpeechRecognition types ──────────────────────────────────────────
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: { transcript: string };
}
interface SpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionConstructor {
  new(): SpeechRecognitionInstance;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const w = window as unknown as Record<string, unknown>;
  const SR = (w['SpeechRecognition'] ?? w['webkitSpeechRecognition']) as SpeechRecognitionConstructor | undefined;
  return SR ?? null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseSpeechTranscriptionResult {
  /** Whether the Web Speech API is available in this browser */
  isSupported: boolean;
  /** Accumulated final transcript */
  transcript: string;
  /** In-progress (interim) text that hasn't been finalized yet */
  interimText: string;
  /** Whether speech recognition is currently active */
  isListening: boolean;
  /** Start listening — idempotent if already listening */
  start: () => void;
  /** Stop listening */
  stop: () => void;
  /** Clear transcript and interim text */
  reset: () => void;
}

/**
 * useSpeechTranscription — shared hook for Web Speech API live transcription.
 *
 * Used by both VoicePanel (audio-only) and VideoSubmissionPanel (video + transcript).
 * Runs the browser's SpeechRecognition in continuous mode, accumulating final results
 * and exposing interim text for live display.
 *
 * @param lang BCP-47 language tag (default 'en-US')
 */
export function useSpeechTranscription(lang = 'en-US'): UseSpeechTranscriptionResult {
  const [isSupported] = useState(() => getSpeechRecognition() !== null);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [isListening, setIsListening] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef('');

  // Keep ref in sync with state
  useEffect(() => {
    finalTranscriptRef.current = transcript;
  }, [transcript]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setInterimText('');
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    if (isListening) return;

    const SR = getSpeechRecognition();
    if (!SR) return;

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognitionRef.current = recognition;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = finalTranscriptRef.current;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result) {
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) {
            final += text + ' ';
          } else {
            interim += text;
          }
        }
      }

      finalTranscriptRef.current = final;
      setTranscript(final);
      setInterimText(interim);
    };

    recognition.onerror = () => {
      console.warn('[useSpeechTranscription] Speech recognition error');
    };

    recognition.onend = () => {
      setInterimText('');
      setIsListening(false);
    };

    recognition.start();
    setIsListening(true);
  }, [isListening, lang]);

  const reset = useCallback(() => {
    stop();
    setTranscript('');
    setInterimText('');
    finalTranscriptRef.current = '';
  }, [stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  return { isSupported, transcript, interimText, isListening, start, stop, reset };
}
