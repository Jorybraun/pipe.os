import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Video,
  Clock,
  Wand2,
  Plus,
  CheckCircle,
  Activity,
  Trash2,
  Edit3,
  GripVertical,
  Play,
} from 'lucide-react';
import {
  Layout,
  ProfileHeader,
  LiquidMetalCard,
  SidebarNav,
  SubTitle,
} from '../components';

/**
 * ScreeningStageBuilderPage - Configure screening questions for pipeline
 *
 * Features:
 * - Question management (add, edit, delete, reorder)
 * - AI-powered question generation
 * - Video recording status tracking
 * - Time estimate calculation
 */

interface Question {
  id: number;
  text: string;
  type: 'technical' | 'motivation' | 'behavioral' | 'general';
  timeLimit: number;
  required: boolean;
  hasRecording: boolean;
  recordingDuration: number | null;
}

// Mock initial questions
const initialQuestions: Question[] = [
  {
    id: 1,
    text: "Tell me about your experience with distributed systems and how you've applied that knowledge in previous roles.",
    type: 'technical',
    timeLimit: 3,
    required: true,
    hasRecording: true,
    recordingDuration: 45,
  },
  {
    id: 2,
    text: 'Why are you interested in this role and what excites you about our company?',
    type: 'motivation',
    timeLimit: 2,
    required: true,
    hasRecording: false,
    recordingDuration: null,
  },
  {
    id: 3,
    text: 'Describe a challenging technical problem you solved recently. Walk me through your approach.',
    type: 'behavioral',
    timeLimit: 3,
    required: true,
    hasRecording: true,
    recordingDuration: 62,
  },
];

// Question card component
function QuestionCard({
  question,
  index,
  onDelete,
}: {
  question: Question;
  index: number;
  onDelete: (id: number) => void;
}) {
  const formatTime = (seconds: number | null) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <LiquidMetalCard variant="dark" style={{ marginBottom: 8 }}>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          {/* Drag handle */}
          <button
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--pipe-text-dim)',
              cursor: 'grab',
              marginTop: 4,
            }}
          >
            <GripVertical size={16} />
          </button>

          {/* Question number */}
          <div
            style={{
              width: 36,
              height: 36,
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>
              {index + 1}
            </span>
          </div>

          {/* Question content */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span
                style={{
                  fontSize: 8,
                  letterSpacing: '0.15em',
                  padding: '4px 8px',
                  background: 'var(--pipe-surface)',
                  color: 'var(--pipe-text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                {question.type}
              </span>
              <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>
                {question.timeLimit} MIN RESPONSE
              </span>
              {question.required && (
                <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'rgba(255,100,100,0.6)' }}>
                  REQUIRED
                </span>
              )}
            </div>

            <p style={{ fontSize: 13, color: 'var(--pipe-text, #fff)', lineHeight: 1.6, margin: 0 }}>
              {question.text}
            </p>

            {/* Recording status */}
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
              {question.hasRecording ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      background: 'rgba(150,255,150,0.8)',
                      boxShadow: '0 0 8px rgba(150,255,150,0.5)',
                    }}
                  />
                  <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(150,255,150,0.8)' }}>
                    RECORDED · {formatTime(question.recordingDuration)}
                  </span>
                  <button
                    onClick={() => console.log('Preview recording')}
                    style={{
                      padding: '4px 10px',
                      background: 'transparent',
                      border: '1px solid var(--pipe-border)',
                      color: 'var(--pipe-text-dim)',
                      fontSize: 8,
                      letterSpacing: '0.1em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Play size={8} />
                    PREVIEW
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => console.log('Record video')}
                  style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(135deg, rgba(255,80,80,0.2), rgba(255,100,100,0.1))',
                    border: '1px solid rgba(255,80,80,0.3)',
                    color: 'rgba(255,100,100,0.9)',
                    fontSize: 9,
                    letterSpacing: '0.1em',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Video size={12} />
                  RECORD VIDEO
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => console.log('Edit question')}
              style={{
                padding: 8,
                background: 'transparent',
                border: 'none',
                color: 'var(--pipe-text-dim)',
                cursor: 'pointer',
              }}
            >
              <Edit3 size={14} />
            </button>
            <button
              onClick={() => onDelete(question.id)}
              style={{
                padding: 8,
                background: 'transparent',
                border: 'none',
                color: 'var(--pipe-text-dim)',
                cursor: 'pointer',
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </LiquidMetalCard>
  );
}

export default function ScreeningStageBuilderPage(): JSX.Element {
  const navigate = useNavigate();
  const [activeSection] = useState('roles');

  const isAgentOpen = false;
  const [mounted, setMounted] = useState(false);
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  const [showAddManual, setShowAddManual] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  const recordedCount = questions.filter((q) => q.hasRecording).length;
  const totalTime = questions.reduce((sum, q) => sum + q.timeLimit, 0);

  const handleDeleteQuestion = (id: number) => {
    setQuestions(questions.filter((q) => q.id !== id));
  };

  const handleAddManualQuestion = () => {
    if (!newQuestionText.trim()) return;
    setQuestions([
      ...questions,
      {
        id: questions.length + 1,
        text: newQuestionText,
        type: 'general',
        timeLimit: 2,
        required: false,
        hasRecording: false,
        recordingDuration: null,
      },
    ]);
    setNewQuestionText('');
    setShowAddManual(false);
  };

  return (
    <Layout
      header={
        <ProfileHeader
          title="SCREENING_QUESTIONS"
        />
      }
      sidebar={
        <SidebarNav
          activeSection={activeSection}
          onRolesClick={() => {
            navigate("/");
          }}
        />
      }
      isAgentOpen={isAgentOpen}
      agentPanel={
        <div style={{ padding: 24 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.2em',
              color: 'rgba(139, 92, 246, 0.8)',
              marginBottom: 8,
            }}
          >
            AI AGENT
          </div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: 'var(--pipe-text, #fff)',
              margin: '0 0 24px 0',
            }}
          >
            Question Generator
          </h2>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: 'var(--pipe-text-muted)',
            }}
          >
            I can help you generate role-specific screening questions based on your requirements and best practices.
          </p>
        </div>
      }
    >
      {/* Stats bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          marginBottom: 32,
          paddingBottom: 20,
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
              marginBottom: 6,
            }}
          >
            QUESTIONS
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {questions.length}
          </div>
        </div>
        <div style={{ width: 1, height: 40, background: 'var(--pipe-surface-hover)' }} />
        <div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
              marginBottom: 6,
            }}
          >
            RECORDED
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              background:
                recordedCount === questions.length
                  ? 'linear-gradient(180deg, rgba(150,255,150,0.9) 0%, rgba(150,255,150,0.6) 100%)'
                  : 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {recordedCount}/{questions.length}
          </div>
        </div>
        <div style={{ width: 1, height: 40, background: 'var(--pipe-surface-hover)' }} />
        <div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
              marginBottom: 6,
            }}
          >
            EST. TIME
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {totalTime} MIN
          </div>
        </div>

        <div style={{ marginLeft: 'auto' }}>
          <SubTitle>SCREENING_STAGE</SubTitle>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 32 }}>
        {/* Questions list */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
            }}
          >
            <SubTitle>QUESTIONS</SubTitle>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => console.log('AI Generate questions')}
                style={{
                  padding: '8px 14px',
                  background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.15))',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                  color: 'rgba(139, 92, 246, 0.9)',
                  fontSize: 8,
                  letterSpacing: '0.15em',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Wand2 size={10} />
                AI GENERATE
              </button>
              <button
                onClick={() => setShowAddManual(true)}
                style={{
                  padding: '8px 14px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  color: 'var(--pipe-text-muted)',
                  fontSize: 8,
                  letterSpacing: '0.15em',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Plus size={10} />
                ADD MANUAL
              </button>
            </div>
          </div>

          {/* Add manual question form */}
          {showAddManual && (
            <LiquidMetalCard variant="mercury" style={{ padding: 20, marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 8,
                  letterSpacing: '0.2em',
                  color: 'var(--pipe-text-dim)',
                  marginBottom: 12,
                }}
              >
                NEW QUESTION
              </div>
              <textarea
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                placeholder="Enter your question..."
                style={{
                  width: '100%',
                  height: 80,
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--pipe-border)',
                  color: 'var(--pipe-text, #fff)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  padding: 12,
                  resize: 'none',
                  outline: 'none',
                  fontFamily: '"Space Mono", monospace',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => setShowAddManual(false)}
                  style={{
                    padding: '8px 16px',
                    background: 'transparent',
                    border: '1px solid var(--pipe-border)',
                    color: 'var(--pipe-text-muted)',
                    fontSize: 9,
                    letterSpacing: '0.1em',
                    cursor: 'pointer',
                  }}
                >
                  CANCEL
                </button>
                <button
                  onClick={handleAddManualQuestion}
                  style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
                    border: '1px solid var(--pipe-border)',
                    color: 'var(--pipe-text, #fff)',
                    fontSize: 9,
                    letterSpacing: '0.1em',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ADD QUESTION
                </button>
              </div>
            </LiquidMetalCard>
          )}

          {/* Questions */}
          {questions.map((question, i) => (
            <div
              key={question.id}
              style={{
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'translateY(0)' : 'translateY(15px)',
                transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${i * 60}ms`,
              }}
            >
              <QuestionCard question={question} index={i} onDelete={handleDeleteQuestion} />
            </div>
          ))}
        </div>

        {/* Right sidebar */}
        <div>
          {/* Recording progress */}
          <LiquidMetalCard variant="mercury" style={{ padding: 24, marginBottom: 16 }}>
            <SubTitle>RECORDING_PROGRESS</SubTitle>
            <div style={{ marginTop: 20 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Videos recorded</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pipe-text, #fff)' }}>
                  {recordedCount}/{questions.length}
                </span>
              </div>
              <div style={{ height: 4, background: 'var(--pipe-surface)' }}>
                <div
                  style={{
                    width: `${(recordedCount / questions.length) * 100}%`,
                    height: '100%',
                    background:
                      recordedCount === questions.length
                        ? 'linear-gradient(90deg, rgba(150,255,150,0.5), rgba(150,255,150,0.9))'
                        : 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))',
                    boxShadow:
                      recordedCount === questions.length
                        ? '0 0 12px rgba(150,255,150,0.4)'
                        : '0 0 10px rgba(255,255,255,0.2)',
                    transition: 'width 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />
              </div>
            </div>

            {recordedCount === questions.length ? (
              <div
                style={{
                  marginTop: 20,
                  padding: 16,
                  background: 'rgba(150,255,150,0.1)',
                  border: '1px solid rgba(150,255,150,0.2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle size={16} color="rgba(150,255,150,0.9)" />
                  <span style={{ fontSize: 11, color: 'rgba(150,255,150,0.9)' }}>
                    All questions recorded!
                  </span>
                </div>
              </div>
            ) : (
              <div
                style={{
                  marginTop: 20,
                  padding: 16,
                  background: 'rgba(255,200,100,0.1)',
                  border: '1px solid rgba(255,200,100,0.2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Activity size={16} color="rgba(255,200,100,0.9)" />
                  <span style={{ fontSize: 11, color: 'rgba(255,200,100,0.9)' }}>
                    {questions.length - recordedCount} question
                    {questions.length - recordedCount !== 1 ? 's' : ''} need recording
                  </span>
                </div>
              </div>
            )}
          </LiquidMetalCard>

          {/* Tips */}
          <LiquidMetalCard variant="default" style={{ padding: 24 }}>
            <SubTitle>TIPS</SubTitle>
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    background: 'var(--pipe-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Video size={12} color="var(--pipe-text-dim)" />
                </div>
                <p style={{ fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.6, margin: 0 }}>
                  Record a video for each question to give candidates context
                </p>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    background: 'var(--pipe-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Clock size={12} color="var(--pipe-text-dim)" />
                </div>
                <p style={{ fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.6, margin: 0 }}>
                  Keep intro videos under 90 seconds for better engagement
                </p>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    background: 'var(--pipe-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Wand2 size={12} color="var(--pipe-text-dim)" />
                </div>
                <p style={{ fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.6, margin: 0 }}>
                  Use AI to generate role-specific questions quickly
                </p>
              </div>
            </div>
          </LiquidMetalCard>
        </div>
      </div>
    </Layout>
  );
}
