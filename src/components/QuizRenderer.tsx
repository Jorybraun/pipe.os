import { useState } from 'react';
import { LiquidMetalCard } from './ui/LiquidMetalCard';

// ============================================================================
// Types
// ============================================================================

interface QuizQuestion {
  q: string;
  options: string[];
  // correct: number; // component never sees this
}

interface QuizRendererProps {
  questions: QuizQuestion[];
  onAnswersChange: (answers: Record<number, number>) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * QuizRenderer - Renders a quiz stage with one question at a time.
 *
 * Provides radio-style option buttons and navigation.
 * Design: Brutalist Glassmorphic / Dark
 */
export function QuizRenderer({
  questions,
  onAnswersChange,
}: QuizRendererProps): JSX.Element {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});

  const handleSelect = (optionIndex: number): void => {
    const newAnswers = { ...answers, [currentIndex]: optionIndex };
    setAnswers(newAnswers);
    onAnswersChange(newAnswers);
  };

  const handleNext = (): void => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrev = (): void => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const currentQuestion = questions[currentIndex];
  const selectedOption = answers[currentIndex];

  if (!currentQuestion) {
    return (
      <LiquidMetalCard variant="dark" style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', fontSize: 12 }}>
          NO_QUESTIONS_FOUND_FOR_QUIZ
        </div>
      </LiquidMetalCard>
    );
  }

  return (
    <LiquidMetalCard variant="dark" style={{ padding: 40 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 32,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          QUIZ_STAGE
        </div>
        <div
          style={{
            fontSize: 10,
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          QUESTION {currentIndex + 1} OF {questions.length}
        </div>
      </div>

      {/* Question */}
      <div style={{ marginBottom: 40 }}>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--pipe-text, #fff)',
            lineHeight: 1.4,
            margin: 0,
            letterSpacing: '0.01em',
          }}
        >
          {currentQuestion.q}
        </h2>
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 48 }}>
        {currentQuestion.options.map((option, idx) => {
          const isSelected = selectedOption === idx;
          return (
            <button
              key={idx}
              onClick={() => handleSelect(idx)}
              style={{
                textAlign: 'left',
                padding: '20px 24px',
                background: isSelected ? 'rgba(255,255,255,0.06)' : 'var(--pipe-surface)',
                border: isSelected ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.06)',
                borderRadius: 4,
                color: isSelected ? '#fff' : 'rgba(255,255,255,0.6)',
                fontSize: 14,
                fontFamily: 'inherit',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: isSelected ? '4px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                  background: isSelected ? 'transparent' : 'transparent',
                  flexShrink: 0,
                }}
              />
              {option}
            </button>
          );
        })}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          style={{
            padding: '12px 24px',
            background: 'transparent',
            border: '1px solid var(--pipe-border)',
            color: 'var(--pipe-text-dim)',
            fontSize: 10,
            letterSpacing: '0.15em',
            fontFamily: '"Space Mono", monospace',
            cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          PREVIOUS
        </button>

        <button
          onClick={handleNext}
          disabled={currentIndex === questions.length - 1}
          style={{
            padding: '12px 24px',
            background: 'transparent',
            border: '1px solid var(--pipe-border)',
            color: 'var(--pipe-text-dim)',
            fontSize: 10,
            letterSpacing: '0.15em',
            fontFamily: '"Space Mono", monospace',
            cursor: currentIndex === questions.length - 1 ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          NEXT
        </button>
      </div>
    </LiquidMetalCard>
  );
}
