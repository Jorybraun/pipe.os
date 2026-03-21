import { useState } from 'react';
import { Send, AlertTriangle } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { FieldGroup } from '../ui/form/FieldGroup';
import { TextareaInput } from '../ui/form/TextareaInput';
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
// Component
// ============================================================================

/**
 * FollowUpQuestionsPanel — Displays 5 SHORT_ANSWER follow-up questions generated
 * after a CODE_REVIEW submission.
 *
 * Uses the same FieldGroup + TextareaInput primitives as QUIZ_SHORT_ANSWER.
 * SUBMIT_ANSWERS is enabled once all 5 questions have a non-empty answer.
 * SKIP_FOLLOW_UP is always available as an escape hatch.
 *
 * @example
 * ```tsx
 * <FollowUpQuestionsPanel
 *   questions={followUpQuestions}
 *   onSubmit={submitFollowUpAnswers}
 *   onSkip={handleSkip}
 *   isSubmitting={isLoading}
 * />
 * ```
 */
export function FollowUpQuestionsPanel({
  questions,
  onSubmit,
  onSkip,
  isSubmitting,
}: FollowUpQuestionsPanelProps): JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    questions.forEach((q) => { initial[q.id] = ''; });
    return initial;
  });

  const allAnswered = questions.every((q) => (answers[q.id] ?? '').trim().length > 0);

  const handleChange = (questionId: string, value: string): void => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleSubmit = async (): Promise<void> => {
    if (!allAnswered || isSubmitting) return;
    await onSubmit(answers);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        background: '#0c0c0e',
        padding: '48px 24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 720 }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'rgba(255,255,255,0.3)',
              fontFamily: '"Space Mono", monospace',
              marginBottom: 12,
            }}
          >
            FOLLOW_UP_QUESTIONS
          </div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#fff',
              letterSpacing: '-0.01em',
              marginBottom: 8,
            }}
          >
            A few follow-up questions
          </h2>
          <p
            style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.4)',
              fontFamily: '"Space Mono", monospace',
              lineHeight: 1.6,
            }}
          >
            Based on your code review, we have {questions.length} short questions. Answer all to complete.
          </p>
        </div>

        {/* Questions */}
        <LiquidMetalCard
          variant="mercury"
          style={{ padding: 32, marginBottom: 24 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {questions.map((q, idx) => (
              <div key={q.id}>
                <FieldGroup
                  label={`${idx + 1}. ${q.question}`}
                >
                  <TextareaInput
                    value={answers[q.id] ?? ''}
                    onChange={(value) => handleChange(q.id, value)}
                    placeholder="Your answer..."
                    rows={4}
                  />
                </FieldGroup>
                {q.context && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 10,
                      color: 'rgba(255,255,255,0.25)',
                      fontFamily: '"Space Mono", monospace',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {q.context}
                  </div>
                )}
              </div>
            ))}
          </div>
        </LiquidMetalCard>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            onClick={handleSubmit}
            disabled={!allAnswered || isSubmitting}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '14px 24px',
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

          <button
            onClick={onSkip}
            disabled={isSubmitting}
            title="Skip follow-up questions"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '14px 18px',
              background: 'transparent',
              color: 'rgba(255,255,255,0.25)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            <AlertTriangle size={12} />
            SKIP_FOLLOW_UP
          </button>
        </div>

        {!allAnswered && (
          <div
            style={{
              marginTop: 10,
              fontSize: 9,
              color: 'rgba(255,255,255,0.2)',
              textAlign: 'center',
              letterSpacing: '0.08em',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            ANSWER ALL {questions.length} QUESTIONS TO SUBMIT
          </div>
        )}
      </div>
    </div>
  );
}
