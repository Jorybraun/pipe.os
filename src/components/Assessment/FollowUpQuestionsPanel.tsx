import { useState } from 'react';
import { ChevronLeft, ChevronRight, Send, AlertTriangle } from 'lucide-react';
import type { FollowUpQuestion } from '../../hooks/useAssessment';
import { TextareaPanel } from '../Panels/TextareaPanel';
import { VoicePanel } from '../Panels/VoicePanel';
import { VideoSubmissionPanel } from '../Panels/VideoSubmissionPanel';
import { OptionsPanel } from '../Panels/OptionsPanel';

// ============================================================================
// Types
// ============================================================================

export interface FollowUpQuestionsPanelProps {
  questions: FollowUpQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
  isSubmitting: boolean;
  candidateId?: string;
  challengeId?: string;
}

// ============================================================================
// Helpers
// ============================================================================

const CONTEXT_COLORS: Record<string, string> = {
  WHY:            '#60a5fa',
  FIX:            '#f87171',
  MISSED:         '#fbbf24',
  PRIORITISATION: '#a78bfa',
  DEPTH:          '#4ade80',
};

// ============================================================================
// Component
// ============================================================================

/**
 * FollowUpQuestionsPanel — panel-style component that steps through
 * follow-up questions one at a time, rendering each using the appropriate
 * existing panel component (TextareaPanel, VoicePanel, VideoSubmissionPanel,
 * or OptionsPanel) based on question.type.
 *
 * Designed to be used as the centerPanel in WorkspaceLayout, the same way
 * other challenge types render their panels.
 */
export function FollowUpQuestionsPanel({
  questions,
  onSubmit,
  onSkip,
  isSubmitting,
  candidateId,
  challengeId,
}: FollowUpQuestionsPanelProps): JSX.Element {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    questions.forEach((q) => { init[q.id] = ''; });
    return init;
  });

  const currentQuestion = questions[currentIndex];
  const currentAnswer = currentQuestion ? (answers[currentQuestion.id] ?? '') : '';
  const canAdvance = currentAnswer.trim().length > 0;
  const isLastQuestion = currentIndex === questions.length - 1;
  const allAnswered = questions.every((q) => (answers[q.id] ?? '').trim().length > 0);

  const handleAnswerChange = (value: string): void => {
    if (!currentQuestion) return;
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: value }));
  };

  const handleNext = (): void => {
    if (!canAdvance || isLastQuestion) return;
    setCurrentIndex((i) => i + 1);
  };

  const handlePrev = (): void => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };

  const handleSubmit = (): void => {
    if (!allAnswered || isSubmitting) return;
    onSubmit(answers);
  };

  if (!currentQuestion) return <></>;

  const contextColor = CONTEXT_COLORS[currentQuestion.context] ?? 'rgba(255,255,255,0.3)';

  // ── Render the correct input panel for this question type ──────────────────

  const renderQuestionInput = (): JSX.Element => {
    switch (currentQuestion.type) {
      case 'MCQ':
        return (
          <OptionsPanel
            question={currentQuestion.question}
            options={currentQuestion.options ?? []}
            selectedId={currentAnswer || null}
            onSelect={handleAnswerChange}
            locked={isSubmitting}
          />
        );

      case 'VOICE':
        return (
          <VoicePanel
            question={currentQuestion.question}
            transcript={currentAnswer}
            onTranscriptChange={handleAnswerChange}
          />
        );

      case 'VIDEO':
        return (
          <VideoSubmissionPanel
            question={currentQuestion.question}
            videoS3Key={currentAnswer}
            filename=""
            onUploaded={(s3Key) => handleAnswerChange(s3Key)}
            maxDurationSeconds={120}
            candidateId={candidateId ?? ''}
            challengeId={challengeId ?? currentQuestion.id}
          />
        );

      case 'SHORT_ANSWER':
      default:
        return (
          <TextareaPanel
            question={currentQuestion.question}
            value={currentAnswer}
            onChange={handleAnswerChange}
          />
        );
    }
  };

  // ── Layout: chrome header + panel content + nav footer ─────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Context badge + progress + counter */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 20px 0',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.15em',
            fontFamily: '"Space Mono", monospace',
            color: contextColor,
            padding: '4px 10px',
            border: `1px solid ${contextColor}`,
            borderRadius: 3,
          }}
        >
          {currentQuestion.context}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 5 }}>
            {questions.map((q, i) => {
              const answered = (answers[q.id] ?? '').trim().length > 0;
              const isCurrent = i === currentIndex;
              return (
                <div
                  key={i}
                  style={{
                    width: 24,
                    height: 3,
                    borderRadius: 2,
                    background: isCurrent ? '#fff' : answered ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)',
                    transition: 'background 0.2s',
                  }}
                />
              );
            })}
          </div>

          <div
            style={{
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {currentIndex + 1}/{questions.length}
          </div>
        </div>
      </div>

      {/* Question panel — fills remaining space */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {renderQuestionInput()}
      </div>

      {/* Navigation footer */}
      <div
        style={{
          flexShrink: 0,
          padding: '16px 20px',
          borderTop: '1px solid var(--pipe-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0 || isSubmitting}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 16px',
            background: 'transparent',
            border: '1px solid var(--pipe-border)',
            color: currentIndex === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.45)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            cursor: currentIndex === 0 || isSubmitting ? 'not-allowed' : 'pointer',
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          <ChevronLeft size={13} />
          PREV
        </button>

        <div style={{ flex: 1 }} />

        {/* Skip link */}
        <button
          onClick={onSkip}
          disabled={isSubmitting}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.18)',
            fontSize: 9,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            padding: '10px 0',
          }}
        >
          <AlertTriangle size={10} />
          SKIP
        </button>

        <div style={{ flex: 1 }} />

        {!isLastQuestion ? (
          <button
            onClick={handleNext}
            disabled={!canAdvance || isSubmitting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 20px',
              background: canAdvance && !isSubmitting ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: `1px solid ${canAdvance && !isSubmitting ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)'}`,
              color: canAdvance && !isSubmitting ? '#fff' : 'rgba(255,255,255,0.2)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: canAdvance && !isSubmitting ? 'pointer' : 'not-allowed',
              borderRadius: 4,
            }}
          >
            NEXT
            <ChevronRight size={13} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!allAnswered || isSubmitting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              background: allAnswered && !isSubmitting ? '#fff' : 'rgba(255,255,255,0.06)',
              color: allAnswered && !isSubmitting ? '#000' : 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.12em',
              fontFamily: '"Space Mono", monospace',
              cursor: allAnswered && !isSubmitting ? 'pointer' : 'not-allowed',
            }}
          >
            {isSubmitting ? 'SAVING...' : 'SUBMIT_ANSWERS'}
            {!isSubmitting && <Send size={13} />}
          </button>
        )}
      </div>

    </div>
  );
}
