import { useEffect, useRef } from 'react';
import { QuestionVideoPlayer } from '../Challenge/QuestionVideoPlayer';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import type { RecordingState } from '../../hooks/useAudioRecorder';
import { Loader } from 'lucide-react';

export interface VoicePanelProps {
  /** Question heading displayed above the recording controls */
  question: string;
  /** Current transcript (controlled) */
  transcript: string;
  /** Called whenever the transcript updates */
  onTranscriptChange: (transcript: string) => void;
  /** Called when audio is uploaded and R2 key is available */
  onAudioUploaded?: (r2Key: string) => void;
  /** Full URL for the recruiter's question video — shown above controls if present */
  questionVideoUrl?: string;
  /** Upload endpoint URL */
  uploadUrl: string;
  /** Candidate session token */
  sessionToken: string | null;
  /** Challenge ID for R2 key path */
  challengeId: string;
}

/**
 * VoicePanel — candidate answers by speaking.
 *
 * Records audio via MediaRecorder, uploads to R2, and gets a Whisper
 * transcript back from the server (Cloudflare Workers AI — free).
 *
 * No browser Speech API dependency. Works in all modern browsers.
 */
export function VoicePanel({
  question,
  transcript,
  onTranscriptChange,
  onAudioUploaded,
  questionVideoUrl,
  uploadUrl,
  sessionToken,
  challengeId,
}: VoicePanelProps): JSX.Element {
  const recorder = useAudioRecorder({ uploadUrl, sessionToken, challengeId });

  // Sync recorder transcript → controlled prop
  const lastSynced = useRef('');
  useEffect(() => {
    if (recorder.transcript && recorder.transcript !== lastSynced.current) {
      lastSynced.current = recorder.transcript;
      onTranscriptChange(recorder.transcript);
    }
  }, [recorder.transcript, onTranscriptChange]);

  // Notify parent when R2 key is available
  useEffect(() => {
    if (recorder.r2Key && onAudioUploaded) {
      onAudioUploaded(recorder.r2Key);
    }
  }, [recorder.r2Key, onAudioUploaded]);

  const durationStr = formatDuration(recorder.duration);

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
      {/* Recruiter question video */}
      {questionVideoUrl && <QuestionVideoPlayer src={questionVideoUrl} />}

      {/* Question heading */}
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--pipe-text, #fff)',
          lineHeight: 1.4,
          maxWidth: 700,
        }}
      >
        {question}
      </div>

      {/* Recording controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {recorder.state === 'idle' && (
          <button
            onClick={() => void recorder.start()}
            style={{
              ...btnBase,
              background: 'rgba(74,222,128,0.1)',
              borderColor: 'rgba(74,222,128,0.4)',
              color: '#4ade80',
            }}
          >
            ● START_RECORDING
          </button>
        )}

        {recorder.state === 'recording' && (
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
            <span style={{ ...mono, fontSize: 14, fontWeight: 700, color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>
              {durationStr}
            </span>
            <button
              onClick={recorder.stop}
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

        {recorder.state === 'uploading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader size={14} style={{ animation: 'spin 1s linear infinite', color: '#60a5fa' }} />
            <span style={{ ...mono, fontSize: 10, color: '#60a5fa', letterSpacing: '0.1em' }}>
              TRANSCRIBING...
            </span>
          </div>
        )}

        {(recorder.state === 'done' || recorder.state === 'error') && (
          <>
            {recorder.state === 'done' && (
              <span style={{ ...mono, fontSize: 10, color: '#4ade80' }}>
                ✓ RECORDING_COMPLETE — {durationStr}
              </span>
            )}
            {recorder.state === 'error' && (
              <span style={{ ...mono, fontSize: 10, color: '#f87171' }}>
                ✗ {recorder.error ?? 'Recording failed'}
              </span>
            )}
            <button
              onClick={() => {
                recorder.reset();
                onTranscriptChange('');
              }}
              style={{
                ...btnBase,
                fontSize: 10,
                background: 'var(--pipe-surface)',
                borderColor: 'rgba(255,255,255,0.12)',
                color: 'var(--pipe-text-muted)',
              }}
            >
              RE-RECORD
            </button>
          </>
        )}
      </div>

      {/* Transcript — editable at all times */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <textarea
          value={transcript}
          onChange={(e) => onTranscriptChange(e.target.value)}
          placeholder={placeholderForState(recorder.state)}
          style={{
            ...mono,
            flex: 1,
            minHeight: 160,
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border)',
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
            color: 'var(--pipe-text-dim)',
            textAlign: 'right',
          }}
        >
          {transcript.length} chars
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function placeholderForState(state: RecordingState): string {
  switch (state) {
    case 'recording': return 'Recording... stop to transcribe';
    case 'uploading': return 'Transcribing your recording...';
    case 'done': return 'Edit the transcript if needed';
    default: return 'Record your answer, or type here...';
  }
}
