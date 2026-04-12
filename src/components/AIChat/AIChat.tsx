/**
 * AIChat — universal drop-in conversation UI component.
 *
 * Renders the full conversation loop: past exchanges, the current question
 * card, voice controls, and text input. Synthesis output is delegated to
 * `onComplete`/`renderSynthesis`; scripted intake questions are delegated to
 * `renderHeader`. This component owns only the AI turn flow.
 *
 * Voice modes:
 *   - Whisper (enableVoice): MediaRecorder → POST /api/v1/role-contexts/transcribe
 *   - Live (enableLiveVoice): WebSocket via useLiveSession + VoiceSessionDO
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { JSX } from 'react';
import { Mic, Square, Loader2, ArrowRight, Radio } from 'lucide-react';
import { useConversation } from '../../hooks/useConversation';
import { useLiveSession } from '../../hooks/useLiveSession';
import { ThinkingIndicator } from './ThinkingIndicator';
import { PastExchangeCard } from './PastExchangeCard';
import { QuestionInput } from './QuestionInput';
import { DomainBars } from './DomainBars';
import type { AIChatProps, SynthesisResult } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env?.VITE_API_URL ?? 'http://localhost:8787';
const TRANSCRIBE_URL = `${BASE_URL}/api/v1/role-contexts/transcribe`;

// Clerk window shape — avoids `any`
interface ClerkWindow extends Window {
  Clerk?: {
    session?: {
      getToken: () => Promise<string>;
    };
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AIChat({
  adapter,
  initConfig,
  enableVoice = true,
  enableLiveVoice = false,
  defaultLiveMode = false,
  onComplete,
  renderSynthesis,
  renderHeader,
  showDomainBars = false,
}: AIChatProps): JSX.Element {
  const conv = useConversation(adapter);
  const live = useLiveSession();

  // Live voice mode — starts true when defaultLiveMode is set
  const [liveMode, setLiveMode] = useState(defaultLiveMode);
  // Ref so the init useEffect can read the latest value without re-running
  const defaultLiveModeRef = useRef(defaultLiveMode);
  useEffect(() => { defaultLiveModeRef.current = defaultLiveMode; }, [defaultLiveMode]);

  // Text input
  const [aiAnswer, setAiAnswer] = useState('');

  // Whisper voice state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);

  // Whisper recording refs
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll ref
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Initialize when initConfig transitions from null to non-null ───────────
  // In live mode: skip the HTTP agent entirely and go straight to the voice session.
  // In text mode: initialize the HTTP conversation turn loop as normal.

  useEffect(() => {
    if (!initConfig) return;
    if (defaultLiveModeRef.current) {
      // Voice agent owns the interview — no HTTP turn loop
      handleGoLive().catch(() => {});
    } else {
      conv.initialize(initConfig).catch(() => {});
    }
    // conv and handleGoLive intentionally excluded — only re-runs when initConfig is set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initConfig]);

  // ── Scroll to latest on new question or exchange ────────────────────────────

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conv.currentQuestion?.id, conv.pastExchanges.length]);

  // ── Clear text input on new question ───────────────────────────────────────

  useEffect(() => {
    setAiAnswer('');
  }, [conv.currentQuestion?.id]);

  // ── Fire onComplete when phase transitions to COMPLETE ──────────────────────

  useEffect(() => {
    if (conv.phase !== 'COMPLETE' || !onComplete) return;

    const result: SynthesisResult = {
      type: 'synthesis',
      synthesis: conv.synthesis ?? '',
      persona: conv.persona,
      jobDescription: conv.jobDescription,
      progress: conv.progress ?? { asked: 0, budget: 0, domains: {} },
    };

    onComplete(result);
  }, [conv.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  // Intentionally depend only on phase to avoid double-firing on ref changes.

  // ── Submit AI answer ────────────────────────────────────────────────────────

  const handleRespond = useCallback((): void => {
    if (!conv.currentQuestion || !aiAnswer.trim() || conv.isLoading) return;
    const finalAnswer = conv.currentQuestion.input.type === 'tags'
      ? aiAnswer.split('|||').join(', ')
      : aiAnswer.trim();
    conv.respond(finalAnswer, conv.currentQuestion.id).catch(() => {});
  }, [conv, aiAnswer]);

  // ── Whisper: startRecording ─────────────────────────────────────────────────

  const startRecording = useCallback(async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      setRecordDuration(0);
      setTranscribeError(null);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (chunksRef.current.length === 0) return;

        setIsTranscribing(true);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const formData = new FormData();
        formData.append('audio', blob, 'voice.webm');

        try {
          const clerkWindow = window as ClerkWindow;
          const token = await clerkWindow.Clerk?.session?.getToken();
          const res = await fetch(TRANSCRIBE_URL, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          });

          if (res.ok) {
            const data = (await res.json()) as { transcript: string };
            if (data.transcript) {
              setAiAnswer((prev) => prev ? `${prev} ${data.transcript}` : data.transcript);
            }
          } else {
            const data = await res.json().catch(() => ({})) as { error?: string };
            console.error('[AIChat] Transcription error:', res.status, data);
            setTranscribeError(data.error ?? 'Transcription failed. Please type your answer.');
          }
        } catch (err) {
          console.error('[AIChat] Transcription failed:', err);
          setTranscribeError('Transcription failed. Please type your answer.');
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start(250);
      timerRef.current = setInterval(() => setRecordDuration((d) => d + 1), 1000);
      setIsRecording(true);
    } catch {
      console.error('[AIChat] Mic access denied');
    }
  }, []);

  // ── Whisper: stopRecording ──────────────────────────────────────────────────

  const stopRecording = useCallback((): void => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  // ── Live voice: start session ───────────────────────────────────────────────

  const handleGoLive = useCallback(async (): Promise<void> => {
    try {
      const clerkWindow = window as ClerkWindow;
      const token = await clerkWindow.Clerk?.session?.getToken();
      if (!token) {
        console.error('[AIChat] No Clerk token — cannot start live session');
        return;
      }

      const res = await fetch(`${BASE_URL}/api/v1/voice-sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: 'role-discovery', systemPrompt: '' }),
      });

      if (!res.ok) {
        console.error('[AIChat] Failed to create voice session:', res.status);
        return;
      }

      const data = (await res.json()) as { sessionId: string };
      live.start(data.sessionId, token);
      setLiveMode(true);
    } catch (err) {
      console.error('[AIChat] Failed to start live session:', err);
    }
  }, [live]);

  // ── Live voice: end session ─────────────────────────────────────────────────

  const handleEndLive = useCallback((): void => {
    live.stop();
    setLiveMode(false);
  }, [live]);

  // ── Computed ────────────────────────────────────────────────────────────────

  const isAIPhase = conv.phase === 'CALIBRATING' || conv.phase === 'INTERVIEWING';
  const asked = conv.progress?.asked ?? 0;
  const budget = conv.progress?.budget ?? 0;

  // Only show voice mic button for text/textarea input types
  const needsVoice = enableVoice &&
    conv.currentQuestion !== null &&
    (conv.currentQuestion.input.type === 'text' || conv.currentQuestion.input.type === 'textarea');

  // ── Synthesis phase ─────────────────────────────────────────────────────────

  if (conv.phase === 'COMPLETE') {
    const synthesisResult: SynthesisResult = {
      type: 'synthesis',
      synthesis: conv.synthesis ?? '',
      persona: conv.persona,
      jobDescription: conv.jobDescription,
      progress: conv.progress ?? { asked: 0, budget: 0, domains: {} },
    };

    if (renderSynthesis) {
      return renderSynthesis(synthesisResult);
    }

    // Default synthesis fallback — minimal, callers should supply renderSynthesis
    return (
      <div style={{ padding: 32, background: 'var(--pipe-surface)', border: '1px solid var(--pipe-border-light)', borderRadius: 16 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 16 }}>
          INTERVIEW_COMPLETE
        </div>
        {conv.synthesis && (
          <div style={{ fontSize: 13, color: 'var(--pipe-text)', lineHeight: 1.7, fontFamily: '"Space Mono", monospace', whiteSpace: 'pre-wrap' }}>
            {conv.synthesis}
          </div>
        )}
      </div>
    );
  }

  // ── Interview phase ─────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Error banner */}
      {conv.error && (
        <div style={{
          padding: '12px 20px',
          background: 'rgba(252, 165, 165, 0.08)',
          border: '1px solid rgba(252, 165, 165, 0.2)',
          fontSize: 11,
          color: 'rgba(252, 165, 165, 0.85)',
          fontFamily: '"Space Mono", monospace',
        }}>
          {conv.error}
        </div>
      )}

      {/* Delegated header (scripted questions, JD import, etc.) */}
      {renderHeader?.()}

      {/* Progress bar + domain bars + early submit */}
      {isAIPhase && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{
              fontSize: 10,
              letterSpacing: '0.15em',
              color: 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
              marginBottom: 6,
            }}>
              QUESTION_{asked + 1}_OF_{budget}
            </div>
            <div style={{
              height: 2,
              width: 200,
              background: 'var(--pipe-surface)',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute',
                left: 0, top: 0, bottom: 0,
                width: budget > 0 ? `${(asked / budget) * 100}%` : '0%',
                background: 'rgba(74, 222, 128, 0.5)',
                transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
              }} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {showDomainBars && conv.progress?.domains && (
              <DomainBars domains={conv.progress.domains} />
            )}
            {asked >= 3 && (
              <button
                onClick={() => { conv.completeEarly().catch(() => {}); }}
                disabled={conv.isLoading}
                style={{
                  padding: '8px 16px',
                  fontSize: 10,
                  letterSpacing: '0.15em',
                  color: 'rgba(74, 222, 128, 0.7)',
                  background: 'rgba(74, 222, 128, 0.06)',
                  border: '1px solid rgba(74, 222, 128, 0.2)',
                  cursor: conv.isLoading ? 'default' : 'pointer',
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                SUBMIT_INTERVIEW
              </button>
            )}
          </div>
        </div>
      )}

      {/* Conversation area */}
      <div>
        {/* Past exchanges */}
        {conv.pastExchanges.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            {conv.pastExchanges.map((ex, i) => (
              <PastExchangeCard
                key={ex.questionId}
                exchange={ex}
                index={i}
                {...(isAIPhase && !ex.questionId.startsWith('sq-')
                  ? {
                      onFeedback: (qId: string, fb: string) => {
                        conv.submitFeedback(qId, fb).catch(() => {});
                      },
                    }
                  : {}
                )}
              />
            ))}
          </div>
        )}

        <div ref={scrollRef}>
          {/* Loading indicator */}
          {conv.isLoading && (
            <ThinkingIndicator
              message={
                conv.phase === 'IDLE'
                  ? 'Starting your interview...'
                  : conv.pastExchanges.length === 0
                    ? 'Preparing your first question...'
                    : 'Thinking...'
              }
            />
          )}

          {/* Current AI question card */}
          {!conv.isLoading && conv.currentQuestion && (
            <div style={{
              padding: 32,
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border-light)',
              borderRadius: 16,
            }}>
              {/* Acknowledgment */}
              {conv.acknowledgment && (
                <div style={{
                  fontSize: 12,
                  color: 'var(--pipe-text-dim)',
                  lineHeight: 1.7,
                  marginBottom: 12,
                  fontFamily: '"Space Mono", monospace',
                }}>
                  {conv.acknowledgment}
                </div>
              )}

              {/* Question text */}
              <div style={{
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--pipe-text)',
                lineHeight: 1.4,
                marginBottom: 28,
                letterSpacing: '-0.01em',
              }}>
                {conv.currentQuestion.text}
              </div>

              {/* Live voice mode UI */}
              {liveMode ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 16,
                  padding: '32px 0',
                }}>
                  {/* Model transcript */}
                  {live.modelTranscript && (
                    <div style={{
                      fontSize: 12,
                      color: 'var(--pipe-text-dim)',
                      lineHeight: 1.6,
                      fontFamily: '"Space Mono", monospace',
                      textAlign: 'center',
                      maxWidth: 400,
                    }}>
                      {live.modelTranscript}
                    </div>
                  )}

                  {/* Pulsing live orb */}
                  <div style={{
                    width: 120,
                    height: 120,
                    borderRadius: '50%',
                    background: live.isAISpeaking
                      ? 'rgba(74, 222, 128, 0.2)'
                      : 'rgba(74, 222, 128, 0.06)',
                    border: `2px solid ${live.isAISpeaking ? 'rgba(74, 222, 128, 0.7)' : 'rgba(74, 222, 128, 0.3)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.3s ease',
                    animation: live.isAISpeaking ? 'liveOrbPulse 1.4s ease-in-out infinite' : 'none',
                  }}>
                    <Radio
                      size={40}
                      style={{ color: live.isAISpeaking ? 'rgba(74, 222, 128, 0.9)' : 'rgba(74, 222, 128, 0.5)' }}
                    />
                  </div>

                  {/* User transcript */}
                  {live.userTranscript && (
                    <div style={{
                      fontSize: 11,
                      color: 'var(--pipe-text-dim)',
                      lineHeight: 1.6,
                      fontFamily: '"Space Mono", monospace',
                      textAlign: 'center',
                      maxWidth: 400,
                      opacity: 0.7,
                    }}>
                      {live.userTranscript}
                    </div>
                  )}

                  {/* Live error */}
                  {live.error && (
                    <div style={{
                      fontSize: 10,
                      color: '#f87171',
                      fontFamily: '"Space Mono", monospace',
                      textAlign: 'center',
                    }}>
                      {live.error}
                    </div>
                  )}

                  {/* End session button */}
                  <button
                    onClick={handleEndLive}
                    style={{
                      padding: '10px 24px',
                      background: 'rgba(248, 113, 113, 0.08)',
                      border: '1px solid rgba(248, 113, 113, 0.3)',
                      color: 'rgba(248, 113, 113, 0.9)',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.15em',
                      fontFamily: '"Space Mono", monospace',
                      cursor: 'pointer',
                    }}
                  >
                    END_SESSION
                  </button>
                </div>
              ) : (
                <>
                  {/* Whisper voice button */}
                  {needsVoice && (
                    <>
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                        marginBottom: 24,
                      }}>
                        <button
                          onClick={isRecording ? stopRecording : () => { startRecording().catch(() => {}); }}
                          disabled={isTranscribing}
                          style={{
                            width: 80,
                            height: 80,
                            borderRadius: '50%',
                            background: isRecording ? 'rgba(248, 113, 113, 0.15)' : 'var(--pipe-surface)',
                            border: isRecording
                              ? '2px solid rgba(248, 113, 113, 0.4)'
                              : '2px solid var(--pipe-text)',
                            color: isRecording ? 'rgba(248, 113, 113, 0.9)' : 'var(--pipe-text-dim)',
                            cursor: isTranscribing ? 'default' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexDirection: 'column',
                            gap: 4,
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {isTranscribing ? (
                            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
                          ) : isRecording ? (
                            <>
                              <Square size={20} fill="currentColor" />
                              <span style={{
                                fontSize: 9,
                                fontFamily: '"Space Mono", monospace',
                                letterSpacing: '0.1em',
                              }}>
                                {recordDuration}s
                              </span>
                            </>
                          ) : (
                            <Mic size={26} />
                          )}
                        </button>

                        <span style={{
                          fontSize: 8,
                          letterSpacing: '0.15em',
                          color: 'var(--pipe-text-dim)',
                          fontFamily: '"Space Mono", monospace',
                        }}>
                          {isRecording ? 'TAP_TO_STOP' : isTranscribing ? 'TRANSCRIBING...' : 'TAP_TO_SPEAK'}
                        </span>

                        {transcribeError && (
                          <span style={{
                            fontSize: 10,
                            color: '#f87171',
                            fontFamily: '"Space Mono", monospace',
                            textAlign: 'center',
                            marginTop: 4,
                          }}>
                            {transcribeError}
                          </span>
                        )}
                      </div>

                      {/* OR divider */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        marginBottom: 16,
                      }}>
                        <div style={{ flex: 1, height: 1, background: 'var(--pipe-border-light)' }} />
                        <span style={{
                          fontSize: 8,
                          color: 'var(--pipe-text-dim)',
                          fontFamily: '"Space Mono", monospace',
                          letterSpacing: '0.1em',
                        }}>
                          OR_TYPE
                        </span>
                        <div style={{ flex: 1, height: 1, background: 'var(--pipe-border-light)' }} />
                      </div>
                    </>
                  )}

                  {/* Text input + SEND */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <QuestionInput
                        question={conv.currentQuestion}
                        value={aiAnswer}
                        onChange={setAiAnswer}
                        onSubmit={handleRespond}
                      />
                    </div>
                    <button
                      onClick={handleRespond}
                      disabled={!aiAnswer.trim() || conv.isLoading}
                      style={{
                        padding: '10px 20px',
                        flexShrink: 0,
                        background: aiAnswer.trim() && !conv.isLoading
                          ? 'rgba(74, 222, 128, 0.08)'
                          : 'transparent',
                        border: `1px solid ${aiAnswer.trim() && !conv.isLoading
                          ? 'rgba(74, 222, 128, 0.3)'
                          : 'var(--pipe-border-light)'}`,
                        color: aiAnswer.trim() && !conv.isLoading
                          ? 'rgba(74, 222, 128, 0.9)'
                          : 'var(--pipe-text-dim)',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.15em',
                        fontFamily: '"Space Mono", monospace',
                        cursor: aiAnswer.trim() && !conv.isLoading ? 'pointer' : 'default',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {conv.isLoading
                        ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                        : <ArrowRight size={12} />
                      }
                      SEND
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes liveOrbPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.2); }
          50% { box-shadow: 0 0 0 16px rgba(74, 222, 128, 0); }
        }
      `}</style>
    </div>
  );
}
