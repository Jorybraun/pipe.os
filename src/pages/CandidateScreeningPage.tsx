import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ChromeMeshGrid, LiquidMetalCard } from '../components';
import { SmartInterviewInput } from '../components/AIChat';

const SCREENING_QUESTIONS = [
  'Tell us about a recent project where you used AI tools to enhance your development workflow.',
  'Describe a time when you had to make a critical technical decision under tight constraints.',
  'How do you approach learning a new technology or programming language?',
];

/**
 * CandidateScreeningPage — candidate-facing screening interface.
 *
 * Replaces the previous placeholder with a real text/voice input
 * powered by SmartInterviewInput. Video recording coming next.
 */
export default function CandidateScreeningPage(): JSX.Element {
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const currentQuestion = SCREENING_QUESTIONS[currentIndex]!;
  const answer = answers[currentIndex] ?? '';
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === SCREENING_QUESTIONS.length - 1;

  const handleSubmit = (): void => {
    if (!answer.trim()) return;
    setAnswers((prev) => ({ ...prev, [currentIndex]: answer.trim() }));
    if (!isLast) {
      setCurrentIndex((i) => i + 1);
    } else {
      // All done — navigate to next stage or show completion
      navigate('/assess/complete');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e', fontFamily: '"Space Mono", monospace', color: 'var(--pipe-text, #fff)' }}>
      <ChromeMeshGrid />

      {/* Progress bar */}
      <div style={{ height: 4, background: 'var(--pipe-surface)' }}>
        <div
          style={{
            width: `${((currentIndex + 1) / SCREENING_QUESTIONS.length) * 100}%`,
            height: '100%',
            background: 'linear-gradient(90deg, rgba(150,255,150,0.6), rgba(150,255,150,0.8))',
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      <div style={{ padding: '60px 32px', maxWidth: 800, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.3em', color: 'var(--pipe-text-dim)', marginBottom: 16 }}>
            SCREENING // QUESTION {currentIndex + 1} OF {SCREENING_QUESTIONS.length}
          </div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: 0,
              background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            SCREENING
          </h1>
        </div>

        <LiquidMetalCard variant="mercury" style={{ padding: 48 }}>
          <div style={{ marginBottom: 32 }}>
            <p style={{ fontSize: 16, color: 'var(--pipe-text, #fff)', lineHeight: 1.7, marginBottom: 24 }}>
              {currentQuestion}
            </p>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
              Question {currentIndex + 1} of {SCREENING_QUESTIONS.length}
            </div>
          </div>

          {/* Answer input — text/voice via SmartInterviewInput */}
          <SmartInterviewInput
            value={answer}
            onChange={(v) => setAnswers((prev) => ({ ...prev, [currentIndex]: v }))}
            onSubmit={handleSubmit}
            questionText={currentQuestion}
            enableVoice
            placeholder="Share your thoughts..."
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
              disabled={!answer.trim()}
              style={{
                padding: '12px 32px',
                background: answer.trim()
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))'
                  : 'transparent',
                border: '1px solid var(--pipe-border)',
                color: answer.trim() ? 'var(--pipe-text, #fff)' : 'var(--pipe-text-muted)',
                fontSize: 10,
                letterSpacing: '0.15em',
                fontWeight: 700,
                cursor: answer.trim() ? 'pointer' : 'not-allowed',
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
