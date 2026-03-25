import { useRef, useState, useCallback, useEffect } from 'react';
import { QuestionVideoPlayer } from '../Challenge/QuestionVideoPlayer';

export interface VoicePanelProps {
  /** Question heading displayed above the recording controls */
  question: string;
  /** Current transcript (controlled) */
  transcript: string;
  /** Called whenever the transcript updates */
  onTranscriptChange: (transcript: string) => void;
  /** Called when a raw audio blob is ready for S3 backup upload */
  onAudioReady?: (blob: Blob) => void;
  /** Full URL for the recruiter's question video — shown above controls if present */
  questionVideoUrl?: string;
}

type RecorderState = 'idle' | 'recording' | 'done';

// Browser SpeechRecognition types
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

/**
 * VoicePanel — candidate answers by speaking.
 *
 * Uses the Web Speech API for live transcription. If Speech API is unavailable
 * (Firefox, some Safari versions) a fallback textarea is shown with a warning.
 *
 * A parallel MediaRecorder captures raw audio for S3 backup; the audio blob is
 * delivered via onAudioReady after the candidate stops recording.
 */
export function VoicePanel({
  question,
  transcript,
  onTranscriptChange,
  onAudioReady,
  questionVideoUrl,
}: VoicePanelProps): JSX.Element {
  const [state, setState] = useState<RecorderState>('idle');
  const [interimText, setInterimText] = useState('');
  const [speechSupported] = useState(() => getSpeechRecognition() !== null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobEvent['data'][]>([]);
  const finalTranscriptRef = useRef(transcript);

  // Keep ref in sync with controlled prop
  useEffect(() => {
    finalTranscriptRef.current = transcript;
  }, [transcript]);

  const stopAll = useCallback(() => {
    recognitionRef.current?.stop();
    mediaRecorderRef.current?.stop();
    setInterimText('');
    setState('done');
  }, []);

  const startRecording = useCallback(async () => {
    if (state === 'recording') return;
    setInterimText('');
    audioChunksRef.current = [];

    // Start MediaRecorder for audio backup
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (onAudioReady && audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          onAudioReady(blob);
        }
      };
      recorder.start(100);
    } catch {
      // Audio backup is non-fatal — proceed with speech recognition only
      console.warn('[VoicePanel] Could not start audio recorder');
    }

    // Start Web Speech API
    const SR = getSpeechRecognition();
    if (!SR) {
      setState('recording');
      return;
    }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
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
      onTranscriptChange(final);
      setInterimText(interim);
    };

    recognition.onerror = () => {
      console.warn('[VoicePanel] Speech recognition error');
    };

    recognition.onend = () => {
      setInterimText('');
    };

    recognition.start();
    setState('recording');
  }, [state, onAudioReady, onTranscriptChange]);

  const mono: React.CSSProperties = {
    fontFamily: '"Space Mono", monospace',
  };

  const btnBase: React.CSSProperties = {
    ...mono,
    fontSize: 11,
    letterSpacing: '0.1em',
    padding: '10px 20px',
    borderRadius: 4,
    cursor: 'pointer',
    border: '1px solid',
    transition: 'all 0.15s ease',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: '24px 32px',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* Recruiter question video — shown when available */}
      {questionVideoUrl && <QuestionVideoPlayer src={questionVideoUrl} />}

      {/* Question heading */}
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.9)',
          lineHeight: 1.4,
          maxWidth: 700,
        }}
      >
        {question}
      </div>

      {/* Speech API unavailable fallback */}
      {!speechSupported && (
        <div
          style={{
            ...mono,
            fontSize: 10,
            color: '#fbbf24',
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: 4,
            padding: '8px 12px',
            lineHeight: 1.6,
          }}
        >
          VOICE_INPUT_UNAVAILABLE — your browser does not support Speech Recognition.
          Type your answer below instead.
        </div>
      )}

      {/* Recording controls */}
      {speechSupported && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {state === 'idle' && (
            <button
              onClick={() => void startRecording()}
              style={{
                ...btnBase,
                background: 'rgba(74,222,128,0.1)',
                borderColor: 'rgba(74,222,128,0.4)',
                color: '#4ade80',
              }}
            >
              ● START_VOICE_RECORDING
            </button>
          )}
          {state === 'recording' && (
            <>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#f87171',
                  animation: 'pulse 1s ease-in-out infinite',
                }}
              />
              <button
                onClick={stopAll}
                style={{
                  ...btnBase,
                  background: 'rgba(248,113,113,0.1)',
                  borderColor: 'rgba(248,113,113,0.4)',
                  color: '#f87171',
                }}
              >
                ■ STOP_RECORDING
              </button>
            </>
          )}
          {state === 'done' && (
            <>
              <span style={{ ...mono, fontSize: 10, color: '#4ade80' }}>
                ✓ RECORDING_COMPLETE
              </span>
              <button
                onClick={() => {
                  setState('idle');
                  onTranscriptChange('');
                }}
                style={{
                  ...btnBase,
                  fontSize: 10,
                  background: 'rgba(255,255,255,0.04)',
                  borderColor: 'rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.5)',
                }}
              >
                RE-RECORD
              </button>
            </>
          )}
        </div>
      )}

      {/* Live transcript / editable text area */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {state === 'recording' && interimText && (
          <div
            style={{
              ...mono,
              fontSize: 12,
              color: 'rgba(255,255,255,0.35)',
              fontStyle: 'italic',
              lineHeight: 1.6,
            }}
          >
            {interimText}
          </div>
        )}
        <textarea
          value={transcript + (state === 'recording' ? interimText : '')}
          onChange={(e) => {
            // Allow manual editing at any time
            onTranscriptChange(e.target.value);
            finalTranscriptRef.current = e.target.value;
          }}
          placeholder={
            state === 'recording'
              ? 'Transcribing your speech...'
              : 'Speak to transcribe, or type here...'
          }
          style={{
            ...mono,
            flex: 1,
            minHeight: 160,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            color: 'rgba(255,255,255,0.85)',
            fontSize: 14,
            lineHeight: 1.7,
            padding: '14px 16px',
            resize: 'vertical',
            outline: 'none',
          }}
        />
        <div
          style={{
            ...mono,
            fontSize: 9,
            color: 'rgba(255,255,255,0.2)',
            textAlign: 'right',
          }}
        >
          {(transcript + (state === 'recording' ? interimText : '')).length} chars
        </div>
      </div>
    </div>
  );
}
