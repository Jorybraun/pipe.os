import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Eye, Mic, Video, Type, AlertCircle } from 'lucide-react';
import { ChromeMeshGrid, LiquidMetalCard } from '../components';
import { SmartInterviewInput } from '../components/AIChat';
import { useStageDetail } from '../hooks/useStageDetail';
import { SCREENING_QUESTIONS } from '../content/screeningQuestions';
import type { ChallengeItem } from '../lib/api/types';
import { normalizeShortAnswerConfig } from '../lib/shortAnswerUtils';

interface ScreeningQuestion {
  id: string;
  text: string;
  inputMode: 'text' | 'voice' | 'video';
  placeholder: string;
}

function extractQuestions(stage: NonNullable<ReturnType<typeof useStageDetail>['stage']>): ScreeningQuestion[] {
  const challenges = stage.challenges?.filter((c): c is ChallengeItem & { type: 'QUIZ_SHORT_ANSWER' } => c.type === 'QUIZ_SHORT_ANSWER') ?? [];

  if (challenges.length > 0) {
    return challenges.map((c) => {
      const cfg = normalizeShortAnswerConfig(c.config ?? {});
      const placeholder = cfg.inputMode === 'text'
        ? (cfg as { placeholder?: string }).placeholder
        : undefined;
      return {
        id: c.id,
        text: cfg.question || c.title || 'Untitled question',
        inputMode: cfg.inputMode || stage.screeningInputMode || 'text',
        placeholder: placeholder || 'Share your thoughts...',
      };
    });
  }

  // Fallback to generic defaults — first 3 questions from the bank
  const defaults = SCREENING_QUESTIONS.slice(0, 3);
  const fallbackMode = stage.screeningInputMode || 'text';
  return defaults.map((q) => ({
    id: q.id,
    text: q.text,
    inputMode: q.defaultInputMode || fallbackMode,
    placeholder: fallbackMode === 'text'
      ? 'Type your answer...'
      : fallbackMode === 'voice'
        ? 'Record a voice response...'
        : 'Record a video response...',
  }));
}

const VIDEO_MARKER = '[VIDEO_RECORDED]';

/**
 * CandidateScreeningPage — Recruiter preview of the candidate screening experience.
 *
 * Route: /screenings/:id/preview
 *
 * Fetches the stage's configured QUIZ_SHORT_ANSWER challenges and renders them
 * with SmartInterviewInput. Falls back to generic defaults if no questions are
 * configured. Respects stage.screeningInputMode (text / voice / video).
 */
export default function CandidateScreeningPage(): JSX.Element {
  const { id: stageId } = useParams<{ id: string }>();
  const { stage, isLoading, error } = useStageDetail(stageId);

  const questions = useMemo(() => (stage ? extractQuestions(stage) : []), [stage]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [videoBlobs, setVideoBlobs] = useState<Record<number, Blob>>({});

  const currentQuestion = questions[currentIndex];
  const answer = answers[currentIndex] ?? '';
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === questions.length - 1;

  const hasAnswer = answer.trim().length > 0;
  const hasVideo = !!videoBlobs[currentIndex];
  const canAdvance = currentQuestion?.inputMode === 'video' ? hasVideo : hasAnswer;

  const handleSubmit = (): void => {
    if (!canAdvance) return;
    setAnswers((prev) => ({ ...prev, [currentIndex]: answer.trim() }));
    if (!isLast) {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleVideoRecorded = (blob: Blob) => {
    setVideoBlobs((prev) => ({ ...prev, [currentIndex]: blob }));
    setAnswers((prev) => ({ ...prev, [currentIndex]: VIDEO_MARKER }));
  };

  const handleVideoClear = () => {
    setVideoBlobs((prev) => {
      const next = { ...prev };
      delete next[currentIndex];
      return next;
    });
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[currentIndex];
      return next;
    });
  };

  const inputModeIcon = {
    text: Type,
    voice: Mic,
    video: Video,
  };
  const InputModeIcon = currentQuestion ? inputModeIcon[currentQuestion.inputMode] : Type;

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--pipe-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 11, color: 'var(--pipe-text-dim)', letterSpacing: '0.2em' }}>
          LOADING SCREENING PREVIEW...
        </div>
      </div>
    );
  }

  if (error || !stage) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--pipe-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <AlertCircle size={32} style={{ color: '#ef4444', marginBottom: 16 }} />
          <h2 style={{ fontFamily: '"Space Mono", monospace', fontSize: 16, color: 'var(--pipe-text)', marginBottom: 8 }}>Failed to load preview</h2>
          <p style={{ fontFamily: '"Space Mono", monospace', fontSize: 12, color: 'var(--pipe-text-muted)' }}>{error || 'Stage not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--pipe-bg)', fontFamily: '"Space Mono", monospace', color: 'var(--pipe-text, #fff)' }}>
      <ChromeMeshGrid />

      {/* Preview banner */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'rgba(251,191,36,0.08)',
        borderBottom: '1px solid rgba(251,191,36,0.2)',
        padding: '10px 32px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <Eye size={14} style={{ color: '#fbbf24' }} />
        <span style={{ fontSize: 10, letterSpacing: '0.15em', color: '#fbbf24', fontWeight: 700 }}>
          PREVIEW MODE — ANSWERS ARE NOT SAVED
        </span>
        <span style={{ fontSize: 10, color: 'rgba(251,191,36,0.6)', marginLeft: 'auto' }}>
          {stage.title}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: 'var(--pipe-surface)' }}>
        <div
          style={{
            width: `${questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0}%`,
            height: '100%',
            background: 'linear-gradient(90deg, rgba(150,255,150,0.6), rgba(150,255,150,0.8))',
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      <div style={{ padding: '60px 32px', maxWidth: 800, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.3em', color: 'var(--pipe-text-dim)', marginBottom: 16 }}>
            SCREENING // QUESTION {currentIndex + 1} OF {questions.length}
          </div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: 0,
              background: 'linear-gradient(135deg, var(--pipe-text) 0%, var(--pipe-text-muted) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            SCREENING
          </h1>
        </div>

        <LiquidMetalCard variant="mercury" style={{ padding: 48 }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <InputModeIcon size={14} style={{ color: 'var(--pipe-text-dim)' }} />
              <span style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', textTransform: 'uppercase' }}>
                {currentQuestion?.inputMode} RESPONSE
              </span>
            </div>
            <p style={{ fontSize: 16, color: 'var(--pipe-text, #fff)', lineHeight: 1.7, marginBottom: 24 }}>
              {currentQuestion?.text}
            </p>
            <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)' }}>
              Question {currentIndex + 1} of {questions.length}
            </div>
          </div>

          {/* Answer input — unified SmartInterviewInput handles text / voice / video */}
          <SmartInterviewInput
            key={currentIndex}
            value={answer}
            onChange={(v) => setAnswers((prev) => ({ ...prev, [currentIndex]: v }))}
            onSubmit={handleSubmit}
            questionText={currentQuestion?.text ?? ''}
            enableVoice={currentQuestion?.inputMode === 'voice'}
            enableVideo={currentQuestion?.inputMode === 'video'}
            enableTTS
            placeholder={currentQuestion?.placeholder ?? 'Share your thoughts...'}
            recordedVideoBlob={videoBlobs[currentIndex] ?? null}
            onVideoRecorded={handleVideoRecorded}
            onVideoClear={handleVideoClear}
          />

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 32 }}>
            {!isFirst && (
              <button
                onClick={() => setCurrentIndex((i) => i - 1)}
                style={{
                  padding: '12px 24px',
                  background: 'transparent',
                  border: '1px solid var(--pipe-border)',
                  color: 'var(--pipe-text-muted)',
                  fontSize: 10,
                  letterSpacing: '0.15em',
                  cursor: 'pointer',
                }}
              >
                <ArrowLeft size={12} style={{ display: 'inline', marginRight: 8 }} />
                BACK
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={!canAdvance}
              style={{
                padding: '12px 32px',
                background: canAdvance
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))'
                  : 'transparent',
                border: '1px solid var(--pipe-border)',
                color: canAdvance ? 'var(--pipe-text, #fff)' : 'var(--pipe-text-muted)',
                fontSize: 10,
                letterSpacing: '0.15em',
                fontWeight: 700,
                cursor: canAdvance ? 'pointer' : 'not-allowed',
              }}
            >
              {isLast ? 'FINISH' : 'NEXT QUESTION →'}
            </button>
          </div>
        </LiquidMetalCard>
      </div>
    </div>
  );
}
