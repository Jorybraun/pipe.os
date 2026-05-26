/**
 * SmartInterviewInput — reusable interview answer input with voice & TTS.
 *
 * Extracted from AIChat.tsx. Powers the answer-input area across:
 *   - Role Discovery (via AIChat)
 *   - Culture Interview
 *   - Candidate Screening
 *
 * Features:
 *   • Textarea (or polymorphic QuestionInput) for typed answers
 *   • Push-to-talk voice recording via browser SpeechRecognition
 *   • Google Cloud TTS auto-read with replay + mute controls
 *   • Suggested answer chips
 *   • CMD+Enter / Enter to submit
 */

import { useState, useRef, useEffect, useCallback, type JSX } from 'react';
import { Mic, Square, Loader2, ArrowRight, Volume2, VolumeX, RotateCw, Video, VideoOff } from 'lucide-react';
import { useTTS } from '../../hooks/useTTS';
import { useVoiceInput } from '../../hooks/useVoiceInput';

import { QuestionInput } from './QuestionInput';
import { EQVisualizer } from './EQVisualizer';
import type { RoleContextQuestion } from '../../lib/api/types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SmartInterviewInputProps {
  /** Current input value (text transcript or typed answer). */
  value: string;
  /** Called when the text value changes. */
  onChange: (value: string) => void;
  /** Called when the user submits their answer. */
  onSubmit: () => void;

  /** The question text being answered (used for TTS and aria). */
  questionText: string;
  /** Optional chips that pre-fill the input when clicked. */
  suggestedAnswers?: string[];

  /**
   * When provided, renders the polymorphic QuestionInput (text/textarea/radio/select/tags).
   * When omitted, renders a plain auto-expanding textarea.
   */
  question?: RoleContextQuestion;

  /** Enable the push-to-talk mic button. Default: true. */
  enableVoice?: boolean;
  /** Enable inline video recording. Default: false. */
  enableVideo?: boolean;
  /** When true and enableVideo is true, a video recording is required to submit (text alone is insufficient). Default: false. */
  requireVideo?: boolean;
  /** Enable Google Cloud TTS auto-read + replay. Default: false. */
  enableTTS?: boolean;

  /** Existing recorded video blob (for re-hydration / playback). */
  recordedVideoBlob?: Blob | null;
  /** Called when a video recording is completed. */
  onVideoRecorded?: (blob: Blob) => void;
  /** Called when the user clears/re-records a video. */
  onVideoClear?: () => void;

  /** Show loading spinner on the send button. */
  isLoading?: boolean;
  /** Disable the entire input area. */
  disabled?: boolean;

  /** Placeholder text for the textarea (when question is not provided). */
  placeholder?: string;

  /** Optional id for the textarea element (useful for e2e tests). */
  inputId?: string;

  /** Label for the submit button. Default: "SEND". */
  submitLabel?: string;

  /** Optional callback invoked when TTS speaks a new question.
   *  If omitted, the component will speak questionText automatically when it changes. */
  onSpeakQuestion?: (text: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SmartInterviewInput({
  value,
  onChange,
  onSubmit,
  questionText,
  suggestedAnswers,
  question,
  enableVoice = true,
  enableVideo = false,
  requireVideo = false,
  enableTTS = false,
  recordedVideoBlob,
  onVideoRecorded,
  onVideoClear,
  isLoading = false,
  disabled = false,
  placeholder = 'Take your time and answer thoughtfully…',
  inputId,
  submitLabel = 'SEND',
  onSpeakQuestion,
}: SmartInterviewInputProps): JSX.Element {
  // ── Voice on/off toggle — gates both TTS and mic ───────────────────────────
  const [voiceOn, setVoiceOn] = useState(enableTTS);

  // ── Video recording state ──────────────────────────────────────────────────
  type VideoState = 'idle' | 'previewing' | 'recording' | 'recorded';
  const [videoState, setVideoState] = useState<VideoState>(recordedVideoBlob ? 'recorded' : 'idle');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoElapsed, setVideoElapsed] = useState(0);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<BlobEvent['data'][]>([]);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydrate playback when recordedVideoBlob is provided from parent
  useEffect(() => {
    if (recordedVideoBlob && videoState !== 'recording') {
      const url = URL.createObjectURL(recordedVideoBlob);
      setVideoPreviewUrl(url);
      setVideoState('recorded');
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.muted = false;
      }
      return () => { URL.revokeObjectURL(url); };
    }
    return undefined;
  }, [recordedVideoBlob]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up video on unmount
  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      videoStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (videoTimerRef.current) clearInterval(videoTimerRef.current);
    };
  }, [videoPreviewUrl]);

  const startVideoPreview = useCallback(async () => {
    setVideoError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      setVideoError('Could not access camera/microphone. Check browser permissions.');
      return;
    }
    videoStreamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      void videoRef.current.play();
    }
    setVideoState('previewing');
  }, []);

  const startVideoRecording = useCallback(() => {
    if (!videoStreamRef.current) return;
    videoChunksRef.current = [];
    setVideoElapsed(0);

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';

    const recorder = new MediaRecorder(videoStreamRef.current, { mimeType });
    videoRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) videoChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      videoStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (videoTimerRef.current) clearInterval(videoTimerRef.current);
      const blob = new Blob(videoChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      setVideoPreviewUrl(url);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.muted = false;
      }
      setVideoState('recorded');
      onVideoRecorded?.(blob);
    };

    recorder.start(100);
    setVideoState('recording');

    videoTimerRef.current = setInterval(() => {
      setVideoElapsed((prev) => prev + 1);
    }, 1000);
  }, [onVideoRecorded]);

  const stopVideoRecording = useCallback(() => {
    videoRecorderRef.current?.stop();
  }, []);

  const handleVideoReRecord = useCallback(() => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(null);
    setVideoElapsed(0);
    setVideoError(null);
    onVideoClear?.();
    void startVideoPreview();
  }, [videoPreviewUrl, onVideoClear, startVideoPreview]);

  const videoTimeStr = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };
  const ttsActive = enableTTS && voiceOn;
  const { speak, cancel: cancelSpeech, isPlaying: isTTSPlaying, analyserRef } = useTTS(ttsActive);

  // ── Auto-speak question when it changes ────────────────────────────────────
  const spokenQuestionRef = useRef<string>('');
  useEffect(() => {
    if (!ttsActive || !questionText) return;
    if (spokenQuestionRef.current === questionText) return;
    spokenQuestionRef.current = questionText;
    if (onSpeakQuestion) {
      onSpeakQuestion(questionText);
    } else {
      speak(questionText);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionText, ttsActive, onSpeakQuestion]);

  // ── Toggle voice off → cancel TTS and stop recording ───────────────────────
  const handleToggleVoice = useCallback((): void => {
    setVoiceOn((prev) => {
      const next = !prev;
      if (!next) {
        cancelSpeech();
        voice.stopRecording();
      }
      return next;
    });
  }, [cancelSpeech]);

  // ── Voice input hook ───────────────────────────────────────────────────────
  const voice = useVoiceInput({
    enabled: enableVoice && !disabled,
    onTranscript: onChange,
    onError: (msg) => {
      // Error is already set inside the hook; no extra action needed.
      console.error('[SmartInterviewInput] voice error:', msg);
    },
  });

  // ── Auto-expand textarea ref ───────────────────────────────────────────────
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!question && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value, question]);

  // ── Submit handler ─────────────────────────────────────────────────────────
  const hasVideo = videoState === 'recorded' && recordedVideoBlob != null;
  const canSubmit = (requireVideo ? hasVideo : (value.trim().length > 0 || hasVideo)) && !isLoading && !disabled;

  const handleSubmit = useCallback((): void => {
    if (!canSubmit) return;
    cancelSpeech();
    voice.stopRecording();
    if (videoState === 'recording') {
      stopVideoRecording();
    }
    onSubmit();
  }, [canSubmit, cancelSpeech, voice, videoState, stopVideoRecording, onSubmit]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* TTS controls (replay + mute) — top-right of question card */}
      {enableTTS && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {voiceOn && (
            <button
              onClick={() => speak(questionText)}
              title={isTTSPlaying ? 'AI speaking…' : 'Replay question'}
              aria-label={isTTSPlaying ? 'AI speaking…' : 'Replay question'}
              disabled={isTTSPlaying}
              style={{
                padding: '6px 10px',
                background: 'transparent',
                border: '1px solid var(--pipe-border-light)',
                color: 'var(--pipe-text-dim)',
                cursor: isTTSPlaying ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 44,
                height: 28,
              }}
            >
              {isTTSPlaying ? <EQVisualizer analyserRef={analyserRef} maxHeight={18} /> : <RotateCw size={13} />}
            </button>
          )}
          <button
            onClick={handleToggleVoice}
            title={voiceOn ? 'Mute voice' : 'Unmute voice'}
            aria-label={voiceOn ? 'Mute voice' : 'Unmute voice'}
            style={{
              padding: '6px 10px',
              background: voiceOn ? 'transparent' : 'rgba(248,113,113,0.08)',
              border: `1px solid ${voiceOn ? 'var(--pipe-border-light)' : 'rgba(248,113,113,0.3)'}`,
              color: voiceOn ? 'var(--pipe-text-dim)' : 'rgba(248,113,113,0.85)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 28,
            }}
          >
            {voiceOn ? <Volume2 size={13} /> : <VolumeX size={13} />}
          </button>
        </div>
      )}

      {/* Inline video recorder */}
      {enableVideo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(videoState !== 'idle' || videoPreviewUrl) && (
            <div style={{ position: 'relative' }}>
              <video
                ref={videoRef}
                style={{
                  width: '100%',
                  maxHeight: 260,
                  borderRadius: 6,
                  border: '1px solid var(--pipe-border)',
                  background: '#000',
                  objectFit: 'cover',
                  display: 'block',
                }}
                controls={videoState === 'recorded'}
                playsInline
              />
              {videoState === 'recording' && (
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'rgba(0,0,0,0.6)',
                    padding: '4px 10px',
                    borderRadius: 4,
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 11,
                    color: '#f87171',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f87171', display: 'inline-block' }} />
                  REC {videoTimeStr(videoElapsed)}
                </div>
              )}
            </div>
          )}

          {videoError && (
            <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, color: '#f87171', lineHeight: 1.5 }}>
              {videoError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {videoState === 'idle' && (
              <button
                onClick={() => void startVideoPreview()}
                style={{
                  padding: '10px 20px',
                  background: 'rgba(74,222,128,0.1)',
                  border: '1px solid rgba(74,222,128,0.4)',
                  color: '#4ade80',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontFamily: '"Space Mono", monospace',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                }}
              >
                <Video size={14} style={{ display: 'inline', marginRight: 6 }} />
                ENABLE CAMERA
              </button>
            )}

            {videoState === 'previewing' && (
              <button
                onClick={startVideoRecording}
                style={{
                  padding: '10px 20px',
                  background: 'rgba(74,222,128,0.1)',
                  border: '1px solid rgba(74,222,128,0.4)',
                  color: '#4ade80',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontFamily: '"Space Mono", monospace',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                }}
              >
                <Video size={14} style={{ display: 'inline', marginRight: 6 }} />
                START RECORDING
              </button>
            )}

            {videoState === 'recording' && (
              <button
                onClick={stopVideoRecording}
                style={{
                  padding: '10px 20px',
                  background: 'rgba(248,113,113,0.1)',
                  border: '1px solid rgba(248,113,113,0.4)',
                  color: '#f87171',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontFamily: '"Space Mono", monospace',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                }}
              >
                <VideoOff size={14} style={{ display: 'inline', marginRight: 6 }} />
                STOP RECORDING
              </button>
            )}

            {videoState === 'recorded' && (
              <>
                <button
                  onClick={handleVideoReRecord}
                  style={{
                    padding: '10px 20px',
                    background: 'var(--pipe-surface)',
                    border: '1px solid var(--pipe-border)',
                    color: 'var(--pipe-text-muted)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 11,
                    letterSpacing: '0.1em',
                  }}
                >
                  RE-RECORD
                </button>
                <span style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, color: '#4ade80', letterSpacing: '0.1em' }}>
                  ✓ RECORDED
                </span>
              </>
            )}
          </div>

          {/* Divider between video and text */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--pipe-border-light)' }} />
            <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
              OR_TYPE_BELOW
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--pipe-border-light)' }} />
          </div>
        </div>
      )}

      {/* Voice button (mic / stop / EQ visualizer) */}
      {enableVoice && (
        <>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              marginBottom: 8,
            }}
          >
            <button
              onClick={voice.isRecording ? voice.stopRecording : () => { voice.startRecording().catch(() => {}); }}
              disabled={isTTSPlaying || disabled}
              aria-label={
                voice.isRecording
                  ? 'Stop recording'
                  : isTTSPlaying
                    ? 'AI speaking'
                    : 'Start voice recording'
              }
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: voice.isRecording
                  ? 'rgba(248, 113, 113, 0.15)'
                  : isTTSPlaying
                    ? 'rgba(74, 222, 128, 0.08)'
                    : 'var(--pipe-surface)',
                border: voice.isRecording
                  ? '2px solid rgba(248, 113, 113, 0.4)'
                  : isTTSPlaying
                    ? '2px solid rgba(74, 222, 128, 0.5)'
                    : '2px solid var(--pipe-text)',
                color: voice.isRecording
                  ? 'rgba(248, 113, 113, 0.9)'
                  : isTTSPlaying
                    ? 'rgba(74, 222, 128, 0.95)'
                    : 'var(--pipe-text-dim)',
                cursor: isTTSPlaying || disabled ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 4,
                transition: 'all 0.25s ease',
                animation: isTTSPlaying ? 'aiSpeakingPulse 1.6s ease-in-out infinite' : 'none',
              }}
            >
              {voice.isRecording ? (
                <>
                  <Square size={20} fill="currentColor" />
                  <span
                    style={{
                      fontSize: 9,
                      fontFamily: '"Space Mono", monospace',
                      letterSpacing: '0.1em',
                    }}
                  >
                    {voice.recordDuration}s
                  </span>
                </>
              ) : isTTSPlaying ? (
                <EQVisualizer analyserRef={analyserRef} maxHeight={40} />
              ) : (
                <Mic size={26} />
              )}
            </button>

            <span
              style={{
                fontSize: 8,
                letterSpacing: '0.15em',
                color: isTTSPlaying ? 'rgba(74, 222, 128, 0.85)' : 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                transition: 'color 0.25s ease',
              }}
            >
              {voice.isRecording ? 'LISTENING...' : isTTSPlaying ? 'AI_SPEAKING' : 'TAP_TO_SPEAK'}
            </span>

            {voice.recordError && (
              <span
                style={{
                  fontSize: 10,
                  color: '#f87171',
                  fontFamily: '"Space Mono", monospace',
                  textAlign: 'center',
                  marginTop: 4,
                }}
              >
                {voice.recordError}
              </span>
            )}
          </div>

          {/* OR divider */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 8,
            }}
          >
            <div style={{ flex: 1, height: 1, background: 'var(--pipe-border-light)' }} />
            <span
              style={{
                fontSize: 8,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.1em',
              }}
            >
              OR_TYPE
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--pipe-border-light)' }} />
          </div>
        </>
      )}

      {/* Suggested answer chips */}
      {suggestedAnswers && suggestedAnswers.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          {suggestedAnswers.map((s) => (
            <button
              key={s}
              onClick={() => onChange(s)}
              style={{
                padding: '6px 14px',
                background: value === s ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: `1px solid ${value === s ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)'}`,
                color: value === s ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
                fontSize: 11,
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.03em',
                cursor: 'pointer',
                borderRadius: 4,
                transition: 'all 0.15s ease',
              }}
              onMouseOver={(e) => {
                if (value !== s) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.28)';
                  e.currentTarget.style.color = 'var(--pipe-text)';
                }
              }}
              onMouseOut={(e) => {
                if (value !== s) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                  e.currentTarget.style.color = 'var(--pipe-text-dim)';
                }
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Text input + SEND */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div data-testid="interview-input" style={{ flex: 1 }}>
          {question ? (
            <QuestionInput
              question={question}
              value={value}
              onChange={onChange}
              onSubmit={handleSubmit}
            />
          ) : (
            <div onKeyDown={handleKeyDown}>
              <textarea
                id={inputId}
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={4}
                disabled={disabled || isLoading}
                style={{
                  width: '100%',
                  minHeight: 120,
                  padding: '16px 20px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 0,
                  color: '#fff',
                  fontSize: 14,
                  fontFamily: '"Space Mono", monospace',
                  lineHeight: 1.7,
                  resize: 'none',
                  outline: 'none',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                }}
              />
              <div
                style={{
                  marginTop: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--pipe-text-dim)',
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: '0.1em',
                  }}
                >
                  CMD+ENTER TO SEND
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          data-testid="interview-send-btn"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: '10px 20px',
            flexShrink: 0,
            background: canSubmit ? 'rgba(74, 222, 128, 0.08)' : 'transparent',
            border: `1px solid ${canSubmit ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border-light)'}`,
            color: canSubmit ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-dim)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.15em',
            fontFamily: '"Space Mono", monospace',
            cursor: canSubmit ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {isLoading ? (
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <ArrowRight size={12} />
          )}
          {submitLabel}
        </button>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes aiSpeakingPulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.45), 0 0 18px 2px rgba(74, 222, 128, 0.25);
          }
          50% {
            box-shadow: 0 0 0 14px rgba(74, 222, 128, 0), 0 0 34px 6px rgba(74, 222, 128, 0.45);
          }
        }
      `}</style>
    </div>
  );
}
