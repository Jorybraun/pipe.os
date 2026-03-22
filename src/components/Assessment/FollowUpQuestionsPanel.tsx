import { useState } from 'react';
import { ChevronLeft, ChevronRight, Send, AlertTriangle } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import type { FollowUpQuestion } from '../../hooks/useAssessment';

// ============================================================================
// Types
// ============================================================================

export interface FollowUpQuestionsPanelProps {
  questions: FollowUpQuestion[];
  onSubmit: (answers: Record<string, string>) => Promise<void>;
  onSkip: () => void;
  isSubmitting: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/** Accent colours per question type */
const CONTEXT_COLORS: Record<string, string> = {
  WHY:             '#60a5fa',
  FIX:             '#f87171',
  MISSED:          '#fbbf24',
  PRIORITISATION:  '#a78bfa',
  DEPTH:           '#4ade80',
};

// ============================================================================
// Component
// ============================================================================

/**
 * FollowUpQuestionsPanel — Displays follow-up questions one at a time,
 * mirroring the QuizRenderer step-by-step pattern.
 *
 * - One SHORT_ANSWER question per screen with a textarea
 * - NEXT enabled once the current question has a non-empty answer
 * - On the last question NEXT becomes SUBMIT_ANSWERS
 * - PREVIOUS lets the candidate go back and revise
 * - Coloured context badge (WHY / FIX / MISSED / PRIORITISATION / DEPTH)
 */
export function FollowUpQuestionsPanel({
  questions,
  onSubmit,
  onSkip,
  isSubmitting,
}: FollowUpQuestionsPanelProps): JSX.Element {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    questions.forEach((q) => { initial[q.id] = ''; });
    return initial;
  });

  const currentQuestion = questions[currentIndex];
  const currentAnswer = currentQuestion ? (answers[currentQuestion.id] ?? '') : '';
  const canAdvance = currentAnswer.trim().length > 0;
  const isLastQuestion = currentIndex === questions.length - 1;
  const allAnswered = questions.every((q) => (answers[q.id] ?? '').trim().length > 0);

  const handleChange = (value: string): void => {
    if (!currentQuestion) return;
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: value }));
  };

  const handleNext = (): void => {
    if (!canAdvance || currentIndex >= questions.length - 1) return;
    setCurrentIndex(currentIndex + 1);
  };

  const handlePrev = (): void => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const handleSubmit = async (): Promise<void> => {
    if (!allAnswered || isSubmitting) return;
    await onSubmit(answers);
  };

  if (!currentQuestion) {
    return (
      <LiquidMetalCard variant="dark" style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace', fontSize: 12 }}>
          NO_QUESTIONS_FOUND
        </div>
      </LiquidMetalCard>
    );
  }

  const contextColor = CONTEXT_COLORS[currentQuestion.context] ?? 'rgba(255,255,255,0.3)';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0c0c0e',
        padding: '48px 24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 640 }}>

        {/* Stage label */}
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'rgba(255,255,255,0.3)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 32,
          }}
        >
          FOLLOW_UP_QUESTIONS
        </div>

        <LiquidMetalCard variant="mercury" style={{ padding: 40 }}>

          {/* Header: context badge + progress counter */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 24,
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
            <div
              style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.25)',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              QUESTION {currentIndex + 1} OF {questions.length}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 32 }}>
            {questions.map((q, i) => {
              const answered = (answers[q.id] ?? '').trim().length > 0;
              const isCurrent = i === currentIndex;
              return (
                <div
                  key={i}
                  style={{
                    height: 3,
                    flex: 1,
                    borderRadius: 2,
                    background: isCurrent
                      ? '#fff'
                      : answered
                        ? 'rgba(255,255,255,0.35)'
                        : 'rgba(255,255,255,0.1)',
                    transition: 'background 0.2s',
                  }}
                />
              );
            })}
          </div>

          {/* Question text */}
          <h2
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1.55,
              margin: '0 0 24px',
              letterSpacing: '0.01em',
            }}
          >
            {currentQuestion.question}
          </h2>

          {/* Answer textarea */}
          <textarea
            value={currentAnswer}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Your answer..."
            disabled={isSubmitting}
            rows={5}
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 4,
              color: '#fff',
              fontSize: 14,
              fontFamily: 'inherit',
              lineHeight: 1.6,
              padding: '14px 16px',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              marginBottom: 28,
            }}
          />

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={handlePrev}
              disabled={currentIndex === 0 || isSubmitting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '12px 18px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)',
                color: currentIndex === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.45)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: currentIndex === 0 || isSubmitting ? 'not-allowed' : 'pointer',
                borderRadius: 4,
                transition: 'all 0.15s',
                flexShrink: 0,
              }}
            >
              <ChevronLeft size={13} />
              PREV
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
                  padding: '12px 24px',
                  background: canAdvance && !isSubmitting ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: `1px solid ${canAdvance && !isSubmitting ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)'}`,
                  color: canAdvance && !isSubmitting ? '#fff' : 'rgba(255,255,255,0.2)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: canAdvance && !isSubmitting ? 'pointer' : 'not-allowed',
                  borderRadius: 4,
                  transition: 'all 0.15s',
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
                  padding: '12px 24px',
                  background: allAnswered && !isSubmitting ? '#fff' : 'rgba(255,255,255,0.06)',
                  color: allAnswered && !isSubmitting ? '#000' : 'rgba(255,255,255,0.2)',
                  border: 'none',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: allAnswered && !isSubmitting ? 'pointer' : 'not-allowed',
                  transition: 'all 0.15s',
                }}
              >
                {isSubmitting ? 'SAVING...' : 'SUBMIT_ANSWERS'}
                {!isSubmitting && <Send size={13} />}
              </button>
            )}
          </div>

          {/* Skip — de-emphasised at the bottom */}
          <div style={{ textAlign: 'right', marginTop: 20 }}>
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
                padding: 0,
              }}
            >
              <AlertTriangle size={10} />
              SKIP_FOLLOW_UP
            </button>
          </div>

        </LiquidMetalCard>
      </div>
    </div>
  );
}
