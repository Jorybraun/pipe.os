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
import { Mic, Square, Loader2, ArrowRight, Radio, Bot, Volume2, VolumeX, RotateCw, ChevronUp, ChevronDown, X, Video, VideoOff } from 'lucide-react';
import { useLiveSession } from '../../hooks/useLiveSession';
import { useTTS } from '../../hooks/useTTS';
import Logo from '../ui/Logo';
import { PastExchangeCard } from './PastExchangeCard';
import { QuestionInput } from './QuestionInput';
import { DomainBars } from './DomainBars';
import { EQVisualizer } from './EQVisualizer';
import type { AIChatProps, SynthesisResult } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env?.VITE_API_URL || 'http://localhost:8787';

// Clerk window shape — avoids `any`
interface ClerkWindow extends Window {
  Clerk?: {
    session?: {
      getToken: () => Promise<string>;
    };
  };
}

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

// ─── Component ────────────────────────────────────────────────────────────────

export function AIChat({
  conv,
  initConfig,
  enableVoice = true,
  enableLiveVoice = false,
  defaultLiveMode = false,
  onComplete,
  renderSynthesis,
  renderHeader,
  showDomainBars = false,
  enableTTS = false,
  enableVideo = false,
  greeting = '',
  onLiveEnd,
  currentDomain,
  domainCompletion,
}: AIChatProps): JSX.Element {
  const live = useLiveSession();

  // Live voice mode — starts true when defaultLiveMode is set
  const [liveMode, setLiveMode] = useState(defaultLiveMode);
  // Ref so the init useEffect can read the latest value without re-running
  const defaultLiveModeRef = useRef(defaultLiveMode);
  useEffect(() => { defaultLiveModeRef.current = defaultLiveMode; }, [defaultLiveMode]);

  // Text input
  const [aiAnswer, setAiAnswer] = useState('');

  // Streaming STT state
  const [isRecording, setIsRecording] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);

  // SpeechRecognition refs
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseAnswerRef = useRef(''); // answer text that existed when recording started
  const finalTranscriptRef = useRef(''); // finalized chunks accumulated this session
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Video recording state ───────────────────────────────────────────────────
  type VideoState = 'idle' | 'previewing' | 'recording' | 'recorded';
  const [videoState, setVideoState] = useState<VideoState>('idle');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoElapsed, setVideoElapsed] = useState(0);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoR2Key, setVideoR2Key] = useState<string | null>(null);
  const [videoUploading, setVideoUploading] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<BlobEvent['data'][]>([]);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Voice on/off — user-controlled toggle gating both TTS and mic ─────────

  const [voiceOn, setVoiceOn] = useState(enableTTS);
  const ttsActive = enableTTS && voiceOn;
  const { speak, cancel: cancelSpeech, isPlaying: isTTSPlaying, analyserRef } = useTTS(ttsActive);

  // Greeting — spoken once when the interview begins (text/hybrid mode only).
  const greetingSpokenRef = useRef(false);
  useEffect(() => {
    if (!initConfig || !greeting || !ttsActive || greetingSpokenRef.current) return;
    if (defaultLiveModeRef.current && enableLiveVoice) return;
    greetingSpokenRef.current = true;
    speak(greeting);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initConfig]);

  // Clear any residual audio when a new exchange arrives so the next question
  // plays cleanly. Acknowledgments remain visible as text but are not spoken —
  // this keeps the flow tight instead of padding between questions.
  const lastExchangeCountRef = useRef(0);
  useEffect(() => {
    if (!ttsActive || conv.pastExchanges.length <= lastExchangeCountRef.current) return;
    lastExchangeCountRef.current = conv.pastExchanges.length;
    cancelSpeech();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.pastExchanges.length]);

  // Question — spoken when a new question loads.
  useEffect(() => {
    if (!ttsActive || conv.isLoading || !conv.currentQuestion) return;
    speak(conv.currentQuestion.text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.currentQuestion?.id, conv.isLoading, ttsActive]);

  // Toggling voice off mid-speech should silence the AI and stop any recording.
  const handleToggleVoice = useCallback((): void => {
    setVoiceOn((prev) => {
      const next = !prev;
      if (!next) {
        cancelSpeech();
        recognitionRef.current?.stop();
      }
      return next;
    });
  }, [cancelSpeech]);

  // Bad robot — tracks which questionId has been one-click flagged
  const [badBotQuestionId, setBadBotQuestionId] = useState<string | null>(null);

  // ── Vertical carousel — browse past exchanges & edit their answers ───────
  // null = live (new question). Numeric = index into conv.pastExchanges being edited.
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editAnswer, setEditAnswer] = useState('');
  const pastCount = conv.pastExchanges.length;
  const focusedPast = editIdx !== null ? conv.pastExchanges[editIdx] ?? null : null;

  // When the carousel focus changes, prime the textarea with the saved answer.
  useEffect(() => {
    if (focusedPast) setEditAnswer(focusedPast.answer);
  }, [editIdx, focusedPast]);

  // If a new exchange lands while we're editing, snap back to live so we don't
  // point at a stale index.
  useEffect(() => {
    if (editIdx !== null && editIdx >= pastCount) setEditIdx(null);
  }, [pastCount, editIdx]);

  const goUp = useCallback((): void => {
    setEditIdx((cur) => {
      if (cur === null) return pastCount > 0 ? pastCount - 1 : null;
      return cur > 0 ? cur - 1 : cur;
    });
  }, [pastCount]);

  const goDown = useCallback((): void => {
    setEditIdx((cur) => {
      if (cur === null) return null;
      return cur < pastCount - 1 ? cur + 1 : null;
    });
  }, [pastCount]);

  const returnToLive = useCallback((): void => setEditIdx(null), []);

  const handleResubmitEdit = useCallback((): void => {
    if (!focusedPast || !editAnswer.trim() || conv.isLoading) return;
    cancelSpeech();
    recognitionRef.current?.stop();
    conv.respond(editAnswer.trim(), focusedPast.questionId).catch(() => {});
    setEditIdx(null);
  }, [conv, editAnswer, focusedPast, cancelSpeech]);

  // Auto-scroll ref
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Initialize when initConfig transitions from null to non-null ───────────
  // In live mode: skip the HTTP agent entirely and go straight to the voice session.
  // In text mode: initialize the HTTP conversation turn loop as normal.

  useEffect(() => {
    if (!initConfig) return;
    // Skip if already hydrated (e.g. mid-interview resume via hydrateInterviewing)
    if (conv.phase !== 'IDLE') return;
    if (defaultLiveModeRef.current && enableLiveVoice) {
      // Voice agent owns the interview — no HTTP turn loop
      handleGoLive(initConfig.baseline as Record<string, unknown>).catch(() => {});
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

  // ── Clear text input + video on new question ───────────────────────────────

  useEffect(() => {
    setAiAnswer('');
    // Reset video state so the previous question's recording doesn't leak forward
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(null);
    setVideoElapsed(0);
    setVideoError(null);
    setVideoR2Key(null);
    setVideoState('idle');
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, [conv.currentQuestion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fire onComplete when phase transitions to COMPLETE ──────────────────────

  useEffect(() => {
    if (conv.phase !== 'COMPLETE' || !onComplete) return;

    const result: SynthesisResult = {
      type: 'synthesis',
      synthesis: conv.synthesis ?? '',
      persona: conv.persona,
      jobDescription: conv.jobDescription,
      progress: conv.progress ?? { asked: 0, budget: 0, domains: {} },
      ...(conv.transcript ? { transcript: conv.transcript } : {}),
    };

    onComplete(result);
  }, [conv.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  // Intentionally depend only on phase to avoid double-firing on ref changes.

  // ── Bad robot — flag + skip the current question ──────────────────────────

  const handleBadBot = useCallback((questionId: string): void => {
    if (conv.isLoading) return;
    cancelSpeech();
    recognitionRef.current?.stop();
    conv.submitFeedback(questionId, '[BAD_ROBOT] User skipped this question as bad').catch(() => {});
    setBadBotQuestionId(questionId);
    // Skip by submitting a minimal non-answer so the server generates the next question
    conv.respond('[Skip]', questionId).catch(() => {});
  }, [conv, cancelSpeech]);

  // ── Submit AI answer ────────────────────────────────────────────────────────

  const handleRespond = useCallback((): void => {
    const hasMedia = !!videoR2Key;
    if (!conv.currentQuestion || (!aiAnswer.trim() && !hasMedia) || conv.isLoading) return;
    // Silence the AI and stop any live transcription before submitting.
    cancelSpeech();
    recognitionRef.current?.stop();
    const finalAnswer = conv.currentQuestion.input.type === 'tags'
      ? aiAnswer.split('|||').join(', ')
      : aiAnswer.trim();
    setAiAnswer('');
    const media = videoR2Key ? { videoR2Key } : undefined;
    // Clear video state immediately so a probe or new question starts fresh
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(null);
    setVideoElapsed(0);
    setVideoError(null);
    setVideoR2Key(null);
    setVideoState('idle');
    videoStreamRef.current?.getTracks().forEach((t) => t.stop());
    conv.respond(finalAnswer, conv.currentQuestion.id, media).catch(() => {});
  }, [conv, aiAnswer, cancelSpeech, videoR2Key, videoPreviewUrl]);

  // ── Streaming STT: startRecording ───────────────────────────────────────────

  const startRecording = useCallback(async (): Promise<void> => {
    cancelSpeech();
    const w = window as SpeechWindow;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setTranscribeError('Voice input is not supported in this browser.');
      return;
    }

    try {
      // Warm up mic permission so the first `start()` doesn't stall.
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
    } catch {
      setTranscribeError('Microphone permission denied.');
      return;
    }

    // Preserve whatever's already in the input so we append, not overwrite.
    setAiAnswer((prev) => {
      baseAnswerRef.current = prev;
      return prev;
    });
    finalTranscriptRef.current = '';
    setRecordDuration(0);
    setTranscribeError(null);

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
      setAiAnswer(merged);
    };

    recognition.onerror = (e) => {
      console.error('[AIChat] SpeechRecognition error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setTranscribeError('Microphone permission denied.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setTranscribeError('Voice input failed. Please type your answer.');
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
      console.error('[AIChat] SpeechRecognition start error:', err);
      setTranscribeError('Could not start voice input.');
      return;
    }

    timerRef.current = setInterval(() => setRecordDuration((d) => d + 1), 1000);
    setIsRecording(true);
  }, [cancelSpeech]);

  // ── Streaming STT: stopRecording ────────────────────────────────────────────

  const stopRecording = useCallback((): void => {
    recognitionRef.current?.stop();
    // onend handles state cleanup
  }, []);

  // ── Video recording helpers ─────────────────────────────────────────────────

  const videoTimeStr = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const startVideoPreview = useCallback(async () => {
    setVideoError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      setVideoError('Could not access camera. Check browser permissions.');
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
      // Upload immediately after recording stops
      void uploadVideoBlob(blob);
    };

    recorder.start(100);
    setVideoState('recording');

    videoTimerRef.current = setInterval(() => {
      setVideoElapsed((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopVideoRecording = useCallback(() => {
    videoRecorderRef.current?.stop();
  }, []);

  const handleVideoReRecord = useCallback(() => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(null);
    setVideoElapsed(0);
    setVideoError(null);
    setVideoR2Key(null);
    void startVideoPreview();
  }, [videoPreviewUrl, startVideoPreview]);

  const uploadVideoBlob = useCallback(async (blob: Blob) => {
    const sessionToken = initConfig?.sessionToken;
    const challengeId = initConfig?.challengeId;
    if (!sessionToken || !challengeId) {
      setVideoError('Cannot upload: missing session token or challenge ID.');
      return;
    }

    setVideoUploading(true);
    const formData = new FormData();
    formData.append('file', blob, `response-${challengeId}.webm`);
    formData.append('challengeId', challengeId);

    try {
      const res = await fetch(`${BASE_URL}/rpc/upload-media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: formData,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? `Upload failed (${res.status})`);
      }
      const data = await res.json() as { r2Key: string };
      setVideoR2Key(data.r2Key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Video upload failed';
      setVideoError(msg);
    } finally {
      setVideoUploading(false);
    }
  }, [initConfig]);

  // Clean up video on unmount
  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      videoStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (videoTimerRef.current) clearInterval(videoTimerRef.current);
    };
  }, [videoPreviewUrl]);

  // ── Live voice: start session ───────────────────────────────────────────────

  const handleGoLive = useCallback(async (baseline?: Record<string, unknown>): Promise<void> => {
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
        body: JSON.stringify({
          type: 'role-discovery',
          ...(baseline && Object.keys(baseline).length > 0 ? { baseline } : {}),
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error('[AIChat] Failed to create voice session:', res.status, errBody);
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
    onLiveEnd?.();
  }, [live, onLiveEnd]);

  // ── Computed ────────────────────────────────────────────────────────────────

  const isAIPhase = conv.phase === 'CALIBRATING' || conv.phase === 'INTERVIEWING';

  // ── Live voice phase — full-screen orb, bypasses question card entirely ──────

  if (liveMode) {
    const showUserSpeech = live.currentUserSpeech && !live.isAISpeaking;
    // Show current streaming text, or fall back to the last completed AI turn
    const lastCompletedTurn = live.modelTranscript.split('\n').filter(Boolean).pop() ?? '';
    const displayedQuestion = live.currentModelSpeech || lastCompletedTurn;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, padding: '60px 0' }}>

        {/* AI current question — persists after AI finishes speaking */}
        <div style={{ minHeight: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', maxWidth: 520, width: '100%' }}>
          {displayedQuestion && (
            <div style={{
              fontSize: 14,
              color: live.currentModelSpeech ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
              lineHeight: 1.75,
              fontFamily: '"Space Mono", monospace',
              textAlign: 'center',
              transition: 'color 0.4s ease',
            }}>
              {displayedQuestion}
            </div>
          )}
        </div>

        {/* Orb */}
        <div style={{
          width: 140, height: 140, borderRadius: '50%',
          background: live.isAISpeaking ? 'rgba(74, 222, 128, 0.15)' : 'rgba(74, 222, 128, 0.05)',
          border: `2px solid ${live.isAISpeaking ? 'rgba(74, 222, 128, 0.6)' : 'rgba(74, 222, 128, 0.2)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.3s ease',
          animation: live.isAISpeaking ? 'liveOrbPulse 1.4s ease-in-out infinite' : 'none',
        }}>
          <Radio size={48} style={{ color: live.isAISpeaking ? 'rgba(74, 222, 128, 0.9)' : 'rgba(74, 222, 128, 0.4)' }} />
        </div>

        <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
          {live.isConnected ? (live.isAISpeaking ? 'AI_SPEAKING' : 'LISTENING...') : 'CONNECTING...'}
        </div>

        {/* Live user speech — streams in real time as the user speaks */}
        <div style={{ minHeight: 48, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', maxWidth: 520, width: '100%' }}>
          {showUserSpeech ? (
            <div style={{ fontSize: 13, color: 'var(--pipe-text-dim)', lineHeight: 1.6, fontFamily: '"Space Mono", monospace', textAlign: 'center', opacity: 0.8 }}>
              {live.currentUserSpeech}
              <span style={{ animation: 'liveCursor 1s step-start infinite', opacity: 0.6 }}>▊</span>
            </div>
          ) : (
            <div style={{ height: 20 }} />
          )}
        </div>

        {live.error && (
          <div style={{ fontSize: 10, color: '#f87171', fontFamily: '"Space Mono", monospace', textAlign: 'center' }}>
            {live.error}
          </div>
        )}

        <button
          onClick={handleEndLive}
          style={{ marginTop: 8, padding: '10px 28px', background: 'rgba(248, 113, 113, 0.08)', border: '1px solid rgba(248, 113, 113, 0.3)', color: 'rgba(248, 113, 113, 0.9)', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', fontFamily: '"Space Mono", monospace', cursor: 'pointer' }}
        >
          END_SESSION
        </button>

        <style>{`
          @keyframes liveOrbPulse { 0%,100%{transform:scale(1);opacity:0.8} 50%{transform:scale(1.08);opacity:1} }
          @keyframes liveCursor { 0%,100%{opacity:1} 50%{opacity:0} }
        `}</style>
      </div>
    );
  }

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

      {/* Phase badge + progress bar + domain bars + early submit */}
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
              {currentDomain ? currentDomain.toUpperCase() : 'INTERVIEWING'}
            </div>
            <div style={{
              fontSize: 9,
              letterSpacing: '0.1em',
              color: 'var(--pipe-text-muted)',
              fontFamily: '"Space Mono", monospace',
              marginBottom: 6,
            }}>
              {domainCompletion
                ? `${Object.values(domainCompletion).filter((s) => s === 'complete').length} / 6 domains explored`
                : 'Interview in progress'}
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
                width: domainCompletion
                  ? `${(Object.values(domainCompletion).filter((s) => s === 'complete').length / 6) * 100}%`
                  : '0%',
                background: 'rgba(74, 222, 128, 0.5)',
                transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
              }} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {showDomainBars && conv.progress?.domains && (
              <DomainBars
                domains={conv.progress.domains}
                domainCompletion={domainCompletion ?? undefined}
                currentDomain={currentDomain ?? undefined}
              />
            )}
            {domainCompletion && Object.values(domainCompletion).some((s) => s === 'complete') && (
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
        {/* Past exchanges — vertical carousel (shows one at a time) */}
        {pastCount > 0 && (() => {
          const carouselIdx = editIdx !== null ? editIdx : pastCount - 1;
          const carouselEx = conv.pastExchanges[carouselIdx];
          if (!carouselEx) return null;
          const canUp = carouselIdx > 0;
          const canDown = editIdx !== null; // going down from live doesn't exist
          return (
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
                <button
                  onClick={goUp}
                  disabled={!canUp}
                  title="Previous question"
                  aria-label="Previous question"
                  style={{ padding: 4, background: 'transparent', border: '1px solid var(--pipe-border-light)', color: canUp ? 'var(--pipe-text-dim)' : 'var(--pipe-border-light)', cursor: canUp ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
                >
                  <ChevronUp size={12} />
                </button>
                <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', textAlign: 'center' }}>
                  {carouselIdx + 1}/{pastCount}
                </div>
                <button
                  onClick={goDown}
                  disabled={!canDown}
                  title="Next question"
                  aria-label="Next question"
                  style={{ padding: 4, background: 'transparent', border: '1px solid var(--pipe-border-light)', color: canDown ? 'var(--pipe-text-dim)' : 'var(--pipe-border-light)', cursor: canDown ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
                >
                  <ChevronDown size={12} />
                </button>
              </div>
              <div style={{ flex: 1, borderLeft: editIdx !== null ? '2px solid rgba(251, 191, 36, 0.5)' : '2px solid transparent', transition: 'border-color 0.2s ease' }}>
                <PastExchangeCard
                  key={carouselEx.questionId}
                  exchange={carouselEx}
                  index={carouselIdx}
                  {...(isAIPhase && !carouselEx.questionId.startsWith('sq-')
                    ? {
                        onFeedback: (qId: string, fb: string) => {
                          conv.submitFeedback(qId, fb).catch(() => {});
                        },
                      }
                    : {}
                  )}
                />
                {editIdx === null && (
                  <button
                    onClick={() => setEditIdx(carouselIdx)}
                    style={{ marginTop: 6, padding: '4px 10px', background: 'transparent', border: '1px solid var(--pipe-border-light)', color: 'var(--pipe-text-dim)', fontSize: 9, letterSpacing: '0.12em', fontFamily: '"Space Mono", monospace', cursor: 'pointer', borderRadius: 4 }}
                  >
                    EDIT_ANSWER
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        <div ref={scrollRef}>
          {/* Loading indicator */}
          {conv.isLoading && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              padding: '32px 0',
            }}>
              <div style={{
                width: 48,
                height: 48,
                animation: 'pipeSpin 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
                opacity: 0.85,
              }}>
                <Logo />
              </div>
              {conv.streamingText ? (
                <span style={{
                  fontSize: 9,
                  letterSpacing: '0.2em',
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                }}>
                  THINKING...
                </span>
              ) : (
                <span style={{
                  fontSize: 9,
                  letterSpacing: '0.2em',
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                }}>
                  {conv.phase === 'IDLE'
                    ? 'STARTING YOUR INTERVIEW...'
                    : conv.currentQuestion === null && conv.pastExchanges.length === 0
                      ? 'PREPARING YOUR FIRST QUESTION...'
                      : 'THINKING...'}
                </span>
              )}
            </div>
          )}

          {/* Edit-past card — takes over the form when the carousel focuses on a past exchange */}
          {!conv.isLoading && focusedPast && (
            <div style={{ padding: 32, background: 'var(--pipe-surface)', border: '1px solid rgba(251, 191, 36, 0.35)', borderRadius: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
                <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(251, 191, 36, 0.75)', fontFamily: '"Space Mono", monospace' }}>
                  EDITING_Q{(editIdx ?? 0) + 1}
                </div>
                <button
                  onClick={returnToLive}
                  title="Return to live question"
                  style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--pipe-border-light)', color: 'var(--pipe-text-dim)', fontSize: 9, letterSpacing: '0.12em', fontFamily: '"Space Mono", monospace', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, borderRadius: 4 }}
                >
                  <X size={10} /> RETURN_TO_LIVE
                </button>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--pipe-text)', lineHeight: 1.4, letterSpacing: '-0.01em', marginBottom: 20 }}>
                {focusedPast.questionText}
              </div>
              <textarea
                value={editAnswer}
                onChange={(e) => setEditAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleResubmitEdit();
                  }
                }}
                rows={4}
                style={{ width: '100%', padding: '12px 14px', background: 'rgba(251, 191, 36, 0.04)', border: '1px solid rgba(251, 191, 36, 0.2)', color: 'var(--pipe-text)', fontSize: 13, fontFamily: '"Space Mono", monospace', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              />
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
                  CMD+ENTER TO RESUBMIT
                </div>
                <button
                  onClick={handleResubmitEdit}
                  disabled={!editAnswer.trim() || conv.isLoading}
                  style={{ padding: '10px 20px', background: editAnswer.trim() && !conv.isLoading ? 'rgba(251, 191, 36, 0.1)' : 'transparent', border: `1px solid ${editAnswer.trim() && !conv.isLoading ? 'rgba(251, 191, 36, 0.4)' : 'var(--pipe-border-light)'}`, color: editAnswer.trim() && !conv.isLoading ? 'rgba(251, 191, 36, 0.95)' : 'var(--pipe-text-dim)', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', fontFamily: '"Space Mono", monospace', cursor: editAnswer.trim() && !conv.isLoading ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 4 }}
                >
                  <ArrowRight size={12} /> RESUBMIT
                </button>
              </div>
            </div>
          )}

          {/* Current AI question card */}
          {!conv.isLoading && !focusedPast && conv.currentQuestion && (
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--pipe-text)', lineHeight: 1.4, letterSpacing: '-0.01em', flex: 1 }}>
                    {conv.currentQuestion.text}
                  </div>
                  {enableTTS && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginTop: 2 }}>
                      {voiceOn && (
                        <button
                          onClick={() => speak(conv.currentQuestion!.text)}
                          title={isTTSPlaying ? 'AI speaking…' : 'Replay question'}
                          aria-label={isTTSPlaying ? 'AI speaking…' : 'Replay question'}
                          disabled={isTTSPlaying}
                          style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--pipe-border-light)', color: 'var(--pipe-text-dim)', cursor: isTTSPlaying ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, height: 28 }}
                        >
                          {isTTSPlaying ? <EQVisualizer analyserRef={analyserRef} maxHeight={18} /> : <RotateCw size={13} />}
                        </button>
                      )}
                      <button
                        onClick={handleToggleVoice}
                        title={voiceOn ? 'Mute voice' : 'Unmute voice'}
                        aria-label={voiceOn ? 'Mute voice' : 'Unmute voice'}
                        style={{ padding: '6px 10px', background: voiceOn ? 'transparent' : 'rgba(248,113,113,0.08)', border: `1px solid ${voiceOn ? 'var(--pipe-border-light)' : 'rgba(248,113,113,0.3)'}`, color: voiceOn ? 'var(--pipe-text-dim)' : 'rgba(248,113,113,0.85)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 28 }}
                      >
                        {voiceOn ? <Volume2 size={13} /> : <VolumeX size={13} />}
                      </button>
                    </div>
                  )}
                </div>
                {!conv.currentQuestion.id.startsWith('sq-') && (
                  <button
                    onClick={() => handleBadBot(conv.currentQuestion!.id)}
                    disabled={conv.isLoading}
                    title="Skip this question and report it"
                    aria-label="Skip this question and report it"
                    style={{ flexShrink: 0, padding: '4px 8px', background: 'transparent', border: `1px solid ${badBotQuestionId === conv.currentQuestion.id ? 'rgba(248,113,113,0.3)' : 'var(--pipe-border-light)'}`, color: badBotQuestionId === conv.currentQuestion.id ? 'rgba(248,113,113,0.8)' : 'var(--pipe-text-dim)', fontSize: 9, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace', cursor: (conv.isLoading || badBotQuestionId === conv.currentQuestion.id) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, opacity: conv.isLoading ? 0.4 : 1 }}
                  >
                    <Bot size={10} />
                    {badBotQuestionId === conv.currentQuestion.id ? 'SKIPPED' : 'BAD_ROBOT'}
                  </button>
                )}
              </div>

              <>
                  {/* Inline video recorder */}
                  {enableVideo && videoState !== 'idle' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                      <div style={{ position: 'relative' }}>
                        <video
                          ref={videoRef}
                          style={{
                            width: '100%',
                            maxHeight: 220,
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
                              top: 10,
                              left: 10,
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

                      {videoError && (
                        <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, color: '#f87171' }}>
                          {videoError}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {videoState === 'previewing' && (
                          <button
                            onClick={startVideoRecording}
                            style={{
                              padding: '8px 16px',
                              background: 'rgba(74,222,128,0.1)',
                              border: '1px solid rgba(74,222,128,0.4)',
                              color: '#4ade80',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontFamily: '"Space Mono", monospace',
                              fontSize: 10,
                              letterSpacing: '0.1em',
                            }}
                          >
                            <Video size={12} style={{ display: 'inline', marginRight: 5 }} />
                            START RECORDING
                          </button>
                        )}

                        {videoState === 'recording' && (
                          <button
                            onClick={stopVideoRecording}
                            style={{
                              padding: '8px 16px',
                              background: 'rgba(248,113,113,0.1)',
                              border: '1px solid rgba(248,113,113,0.4)',
                              color: '#f87171',
                              borderRadius: 4,
                              cursor: 'pointer',
                              fontFamily: '"Space Mono", monospace',
                              fontSize: 10,
                              letterSpacing: '0.1em',
                            }}
                          >
                            <VideoOff size={12} style={{ display: 'inline', marginRight: 5 }} />
                            STOP RECORDING
                          </button>
                        )}

                        {videoState === 'recorded' && (
                          <>
                            <button
                              onClick={handleVideoReRecord}
                              style={{
                                padding: '8px 16px',
                                background: 'var(--pipe-surface)',
                                border: '1px solid var(--pipe-border)',
                                color: 'var(--pipe-text-muted)',
                                borderRadius: 4,
                                cursor: 'pointer',
                                fontFamily: '"Space Mono", monospace',
                                fontSize: 10,
                                letterSpacing: '0.1em',
                              }}
                            >
                              RE-RECORD
                            </button>
                            {videoUploading && (
                              <span style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                                UPLOADING...
                              </span>
                            )}
                            {videoR2Key && !videoUploading && (
                              <span style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, color: '#4ade80', letterSpacing: '0.1em' }}>
                                ✓ UPLOADED
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Suggested answer chips */}
                  {conv.currentQuestion.suggestedAnswers && conv.currentQuestion.suggestedAnswers.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      {conv.currentQuestion.suggestedAnswers.map((s) => (
                        <button
                          key={s}
                          onClick={() => setAiAnswer(s)}
                          style={{
                            padding: '6px 14px',
                            background: aiAnswer === s ? 'rgba(255,255,255,0.08)' : 'transparent',
                            border: `1px solid ${aiAnswer === s ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)'}`,
                            color: aiAnswer === s ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
                            fontSize: 11,
                            fontFamily: '"Space Mono", monospace',
                            letterSpacing: '0.03em',
                            cursor: 'pointer',
                            borderRadius: 4,
                            transition: 'all 0.15s ease',
                          }}
                          onMouseOver={(e) => {
                            if (aiAnswer !== s) {
                              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.28)';
                              e.currentTarget.style.color = 'var(--pipe-text)';
                            }
                          }}
                          onMouseOut={(e) => {
                            if (aiAnswer !== s) {
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

                  {/* Text input + SEND + voice record button */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                    <div data-testid="ai-input" style={{ flex: 1 }}>
                      <QuestionInput
                        question={conv.currentQuestion}
                        value={aiAnswer}
                        onChange={setAiAnswer}
                        onSubmit={handleRespond}
                      />
                    </div>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexShrink: 0,
                    }}>
                      <button
                        data-testid="ai-send-btn"
                        onClick={handleRespond}
                        disabled={!aiAnswer.trim() || conv.isLoading}
                        style={{
                          padding: '10px 20px',
                          background: (aiAnswer.trim() || videoR2Key) && !conv.isLoading
                            ? 'rgba(74, 222, 128, 0.08)'
                            : 'transparent',
                          border: `1px solid ${(aiAnswer.trim() || videoR2Key) && !conv.isLoading
                            ? 'rgba(74, 222, 128, 0.3)'
                            : 'var(--pipe-border-light)'}`,
                          color: (aiAnswer.trim() || videoR2Key) && !conv.isLoading
                            ? 'rgba(74, 222, 128, 0.9)'
                            : 'var(--pipe-text-dim)',
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.15em',
                          fontFamily: '"Space Mono", monospace',
                          cursor: (aiAnswer.trim() || videoR2Key) && !conv.isLoading ? 'pointer' : 'default',
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

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                        {enableVoice && (
                          <button
                            onClick={isRecording ? stopRecording : () => { startRecording().catch(() => {}); }}
                            disabled={isTTSPlaying}
                            aria-label={isRecording ? `Stop recording (${recordDuration}s)` : isTTSPlaying ? 'AI speaking' : 'Start voice recording'}
                            title={isRecording ? `Recording… ${recordDuration}s` : isTTSPlaying ? 'AI speaking' : 'Start voice recording'}
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: '50%',
                              background: isRecording
                                ? 'rgba(248, 113, 113, 0.15)'
                                : isTTSPlaying
                                  ? 'rgba(74, 222, 128, 0.08)'
                                  : 'var(--pipe-surface)',
                              border: isRecording
                                ? '2px solid rgba(248, 113, 113, 0.4)'
                                : isTTSPlaying
                                  ? '2px solid rgba(74, 222, 128, 0.5)'
                                  : '2px solid var(--pipe-text)',
                              color: isRecording
                                ? 'rgba(248, 113, 113, 0.9)'
                                : isTTSPlaying
                                  ? 'rgba(74, 222, 128, 0.95)'
                                  : 'var(--pipe-text-dim)',
                              cursor: isTTSPlaying ? 'default' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.25s ease',
                              animation: isTTSPlaying ? 'aiSpeakingPulse 1.6s ease-in-out infinite' : 'none',
                            }}
                          >
                            {isRecording ? (
                              <Square size={14} fill="currentColor" />
                            ) : isTTSPlaying ? (
                              <EQVisualizer analyserRef={analyserRef} maxHeight={20} />
                            ) : (
                              <Mic size={18} />
                            )}
                          </button>
                        )}

                        {/* Video button */}
                        {enableVideo && videoState === 'idle' ? (
                          <button
                            onClick={() => void startVideoPreview()}
                            title="Record video answer"
                            aria-label="Record video answer"
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: '50%',
                              background: 'var(--pipe-surface)',
                              border: '2px solid var(--pipe-text)',
                              color: 'var(--pipe-text-dim)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.25s ease',
                            }}
                          >
                            <Video size={18} />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
                              setVideoPreviewUrl(null);
                              setVideoElapsed(0);
                              setVideoError(null);
                              setVideoR2Key(null);
                              videoStreamRef.current?.getTracks().forEach((t) => t.stop());
                              setVideoState('idle');
                            }}
                            title="Cancel video"
                            aria-label="Cancel video"
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: '50%',
                              background: 'rgba(248, 113, 113, 0.1)',
                              border: '2px solid rgba(248, 113, 113, 0.4)',
                              color: 'rgba(248, 113, 113, 0.9)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.25s ease',
                            }}
                          >
                            <X size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {transcribeError && (
                    <div style={{
                      marginTop: 8,
                      fontSize: 10,
                      color: '#f87171',
                      fontFamily: '"Space Mono", monospace',
                      textAlign: 'center',
                    }}>
                      {transcribeError}
                    </div>
                  )}
                </>
            </div>
          )}
        </div>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pipeSpin {
          0%   { transform: rotate(0deg)   scale(1); }
          75%  { transform: rotate(290deg) scale(1); }
          88%  { transform: rotate(372deg) scale(1.06); }
          100% { transform: rotate(360deg) scale(1); }
        }
        @keyframes liveOrbPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.2); }
          50% { box-shadow: 0 0 0 16px rgba(74, 222, 128, 0); }
        }
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
