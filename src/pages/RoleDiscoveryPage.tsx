/**
 * RoleDiscoveryPage — AI-powered role context interview (ADR-027)
 *
 * Three-phase flow:
 * 1. Baseline form — structured data always collected
 * 2. AI interview — turn-based conversation with typed inputs
 * 3. Synthesis — narrative summary + domain coverage
 *
 * Route: /pipeline/new
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { FieldGroup, TextInput, TextareaInput, TagsInput, RadioGroup, SelectInput } from '../components/ui/form';
import { JobDescriptionImportModal } from '../components/RoleDiscovery/JobDescriptionImportModal';
import { InterviewDepthModal } from '../components/RoleDiscovery/InterviewDepthModal';
import { useRoleDiscovery } from '../hooks/useRoleDiscovery';
import { usePipelineCreate } from '../hooks/usePipelineCreate';
import { useApiClient } from '../hooks/useApiClient';
import { Loader2, ArrowRight, Sparkles, Check, MessageSquare, ChevronDown, Mic, Square, Flag, Settings, FileUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { RoleContextBaseline, RoleContextQuestion, RoleContextProgress, DomainCoverage, ParseJDResponse, CandidatePersona, GeneratedJobDescription } from '../lib/api/types';
import type { PastExchange } from '../hooks/useRoleDiscovery';

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_BUDGET = 15;

const DOMAIN_LABELS: Record<string, string> = {
  why: 'WHY',
  work: 'WORK',
  team: 'TEAM',
  bar: 'BAR',
  codebase: 'CODE',
  process: 'PROC',
};

const COVERAGE_LEVELS: Record<DomainCoverage, number> = {
  none: 0,
  sparse: 0.2,
  partial: 0.45,
  covered: 0.75,
  deep: 1,
};

const COVERAGE_COLORS: Record<DomainCoverage, string> = {
  none: 'rgba(255,255,255,0.06)',
  sparse: 'rgba(251, 191, 36, 0.4)',
  partial: 'rgba(251, 191, 36, 0.65)',
  covered: 'rgba(74, 222, 128, 0.6)',
  deep: 'rgba(74, 222, 128, 0.9)',
};

// ─── Domain Coverage Bars ───────────────────────────────────────────────────

function DomainBars({ domains }: { domains: Record<string, DomainCoverage> }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 48 }}>
      {Object.entries(DOMAIN_LABELS).map(([key, label]) => {
        const coverage = (domains[key] ?? 'none') as DomainCoverage;
        const level = COVERAGE_LEVELS[coverage];
        const color = COVERAGE_COLORS[coverage];
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div
              style={{
                width: 28,
                height: 36,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: `${level * 100}%`,
                  background: color,
                  transition: 'height 0.6s cubic-bezier(0.16, 1, 0.3, 1), background 0.4s ease',
                }}
              />
            </div>
            <span style={{
              fontSize: 7,
              letterSpacing: '0.1em',
              color: coverage === 'none' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)',
              fontFamily: '"Space Mono", monospace',
            }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Typing Indicator ───────────────────────────────────────────────────────

function ThinkingIndicator({ message }: { message?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '20px 0', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'rgba(74, 222, 128, 0.5)',
              animation: `typingPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      {message && (
        <span style={{
          fontSize: 10,
          letterSpacing: '0.1em',
          color: 'rgba(255,255,255,0.3)',
          fontFamily: '"Space Mono", monospace',
        }}>
          {message}
        </span>
      )}
      <style>{`
        @keyframes typingPulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ─── Past Exchange (collapsed) ──────────────────────────────────────────────

function PastExchangeCard({ exchange, index, onFeedback }: {
  exchange: PastExchange;
  index: number;
  onFeedback?: (questionId: string, feedback: string) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState(exchange.feedback ?? '');

  const hasFeedback = !!(exchange.feedback || feedbackText.trim());

  const handleFlagClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setShowFeedback(!showFeedback);
    if (!expanded) setExpanded(true);
  };

  const handleSubmitFeedback = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (feedbackText.trim() && onFeedback) {
      onFeedback(exchange.questionId, feedbackText.trim());
      setShowFeedback(false);
    }
  };

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        padding: expanded ? '16px 20px' : '10px 20px',
        background: 'rgba(255,255,255,0.02)',
        borderLeft: `2px solid ${hasFeedback ? 'rgba(251, 191, 36, 0.4)' : 'rgba(139, 92, 246, 0.2)'}`,
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        marginBottom: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{
            fontSize: 8,
            letterSpacing: '0.15em',
            color: 'rgba(139, 92, 246, 0.5)',
            fontFamily: '"Space Mono", monospace',
            flexShrink: 0,
          }}>
            Q{index + 1}
          </span>
          <span style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.4)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: expanded ? 'normal' : 'nowrap',
            fontFamily: '"Space Mono", monospace',
          }}>
            {exchange.questionText}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div
            onClick={handleFlagClick}
            title={hasFeedback ? 'Flagged — click to edit' : 'Flag this question'}
            style={{
              padding: 4,
              cursor: 'pointer',
              opacity: hasFeedback ? 1 : 0.3,
              transition: 'opacity 0.2s ease',
            }}
            onMouseOver={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseOut={(e) => { e.currentTarget.style.opacity = hasFeedback ? '1' : '0.3'; }}
          >
            <Flag size={11} color={hasFeedback ? 'rgba(251, 191, 36, 0.9)' : 'rgba(255,255,255,0.5)'} />
          </div>
          <ChevronDown
            size={12}
            style={{
              color: 'rgba(255,255,255,0.2)',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 0.2s ease',
            }}
          />
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.3)',
            marginBottom: 6,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
          }}>
            YOUR ANSWER
          </div>
          <div style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.55)',
            lineHeight: 1.6,
            fontFamily: '"Space Mono", monospace',
          }}>
            {exchange.answer}
          </div>

          {/* Feedback section */}
          {showFeedback && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ marginTop: 12, borderTop: '1px solid rgba(251, 191, 36, 0.15)', paddingTop: 12 }}
            >
              <div style={{
                fontSize: 10,
                color: 'rgba(251, 191, 36, 0.6)',
                marginBottom: 6,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
              }}>
                FLAG_QUESTION
              </div>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="What's wrong with this question? Too vague, leading, irrelevant..."
                style={{
                  width: '100%',
                  minHeight: 48,
                  padding: '10px 12px',
                  background: 'rgba(251, 191, 36, 0.04)',
                  border: '1px solid rgba(251, 191, 36, 0.15)',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 11,
                  fontFamily: '"Space Mono", monospace',
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleSubmitFeedback}
                disabled={!feedbackText.trim()}
                style={{
                  marginTop: 8,
                  padding: '6px 16px',
                  background: feedbackText.trim() ? 'rgba(251, 191, 36, 0.1)' : 'transparent',
                  border: `1px solid ${feedbackText.trim() ? 'rgba(251, 191, 36, 0.3)' : 'rgba(255,255,255,0.06)'}`,
                  color: feedbackText.trim() ? 'rgba(251, 191, 36, 0.9)' : 'rgba(255,255,255,0.2)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: feedbackText.trim() ? 'pointer' : 'default',
                }}
              >
                SAVE_FLAG
              </button>
            </div>
          )}

          {/* Show saved feedback inline */}
          {!showFeedback && hasFeedback && (
            <div style={{
              marginTop: 10,
              padding: '8px 12px',
              background: 'rgba(251, 191, 36, 0.04)',
              borderLeft: '2px solid rgba(251, 191, 36, 0.3)',
              fontSize: 10,
              color: 'rgba(251, 191, 36, 0.6)',
              fontFamily: '"Space Mono", monospace',
            }}>
              {exchange.feedback || feedbackText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Dynamic Input Renderer ─────────────────────────────────────────────────

function QuestionInput({
  question,
  value,
  onChange,
  onSubmit,
}: {
  question: RoleContextQuestion;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}): JSX.Element {
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // Submit on Enter (but not in textarea — there use Cmd+Enter)
    if (e.key === 'Enter' && !e.shiftKey && question.input.type !== 'textarea') {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && question.input.type === 'textarea') {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
  };

  const inputProps = {
    value: value || '',
    onChange,
    placeholder: question.input.placeholder ?? '',
  };

  return (
    <div onKeyDown={handleKeyDown}>
      {question.input.type === 'textarea' && (
        <TextareaInput {...inputProps} rows={4} />
      )}
      {question.input.type === 'text' && (
        <TextInput {...inputProps} />
      )}
      {question.input.type === 'select' && question.input.options && (
        <SelectInput {...inputProps} options={question.input.options} />
      )}
      {question.input.type === 'radio' && question.input.options && (
        <RadioGroup value={value} onChange={onChange} options={question.input.options} />
      )}
      {question.input.type === 'tags' && (
        <TagsInput
          value={value ? value.split('|||') : []}
          onChange={(tags) => onChange(tags.join('|||'))}
          placeholder={question.input.placeholder ?? ''}
        />
      )}

      {/* Submit hint */}
      <div style={{
        marginTop: 10,
        fontSize: 9,
        color: 'rgba(255,255,255,0.2)',
        fontFamily: '"Space Mono", monospace',
        letterSpacing: '0.1em',
      }}>
        {question.input.type === 'textarea' ? 'CMD+ENTER TO SEND' : 'ENTER TO SEND'}
      </div>
    </div>
  );
}

// ─── Baseline Form ────��─────────────────────────────────────────────────────

function BaselinePhase({
  onSubmit,
  onSkipInterview,
  isLoading,
  isSkipping,
}: {
  onSubmit: (baseline: RoleContextBaseline, budget: number) => void;
  onSkipInterview: (baseline: RoleContextBaseline) => void;
  isLoading: boolean;
  isSkipping: boolean;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [location, setLocation] = useState('');
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  const [didImport, setDidImport] = useState(false);

  const [isJDModalOpen, setIsJDModalOpen] = useState(false);
  const [isDepthModalOpen, setIsDepthModalOpen] = useState(false);

  const isBusy = isLoading || isSkipping;
  const canSubmit = title.trim().length > 0 && !isBusy;

  const applyParsed = (parsed: ParseJDResponse['parsed']): void => {
    if (parsed.title) setTitle(parsed.title);
    if (parsed.department) setDepartment(parsed.department);
    if (parsed.companyName) setCompanyName(parsed.companyName);
    if (parsed.companyUrl) setCompanyUrl(parsed.companyUrl);
    if (parsed.location) setLocation(parsed.location);
    setDidImport(true);
  };

  const buildBaseline = (): RoleContextBaseline => {
    const baseline: RoleContextBaseline = { title: title.trim() };
    if (department.trim()) baseline.department = department.trim();
    if (companyName.trim()) baseline.companyName = companyName.trim();
    if (companyUrl.trim()) baseline.companyUrl = companyUrl.trim();
    if (location.trim()) baseline.location = location.trim();
    return baseline;
  };

  const handleStartInterview = (): void => {
    if (!canSubmit) return;
    onSubmit(buildBaseline(), budget);
  };

  const handleSkipInterview = (): void => {
    if (!canSubmit) return;
    onSkipInterview(buildBaseline());
  };

  return (
    <div>
      {/* Header — matches ListingPage / OverviewPage */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, gap: 16 }}>
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 8,
          }}>
            ROLE_DISCOVERY
          </div>
          <h1 style={{
            fontSize: 28,
            fontWeight: 800,
            color: 'var(--pipe-text, #fff)',
            letterSpacing: '-0.02em',
            margin: 0,
          }}>
            New Role
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          {/* START_INTERVIEW — secondary, optional AI enhancement path */}
          <button
            onClick={handleStartInterview}
            disabled={!canSubmit}
            title="Run the AI Discovery interview to enrich the role context before creating the pipeline"
            style={{
              padding: '14px 22px',
              background: 'transparent',
              border: canSubmit
                ? '1px solid rgba(255,255,255,0.12)'
                : '1px solid rgba(255,255,255,0.05)',
              color: canSubmit ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.15em',
              fontFamily: '"Space Mono", monospace',
              cursor: canSubmit ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {isLoading ? (
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Sparkles size={12} />
            )}
            START_INTERVIEW
          </button>
          {/* CREATE_ROLE — primary, creates pipeline directly from the form */}
          <button
            onClick={handleSkipInterview}
            disabled={!canSubmit}
            style={{
              padding: '14px 28px',
              background: canSubmit
                ? 'rgba(74, 222, 128, 0.08)'
                : 'rgba(255,255,255,0.03)',
              border: canSubmit
                ? '1px solid rgba(74, 222, 128, 0.3)'
                : '1px solid rgba(255,255,255,0.06)',
              color: canSubmit ? 'rgba(74, 222, 128, 0.9)' : 'rgba(255,255,255,0.2)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.15em',
              fontFamily: '"Space Mono", monospace',
              cursor: canSubmit ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            {isSkipping ? (
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <ArrowRight size={14} />
            )}
            CREATE_ROLE
          </button>
        </div>
      </div>

      {/* Action row — JD import + interview depth triggers */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          onClick={() => setIsJDModalOpen(true)}
          disabled={isBusy}
          style={{
            padding: '12px 18px',
            background: didImport
              ? 'rgba(74, 222, 128, 0.06)'
              : 'transparent',
            border: didImport
              ? '1px solid rgba(74, 222, 128, 0.3)'
              : '1px solid rgba(255,255,255,0.08)',
            color: didImport
              ? 'rgba(74, 222, 128, 0.85)'
              : 'rgba(255,255,255,0.55)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.15em',
            fontFamily: '"Space Mono", monospace',
            cursor: isBusy ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 4,
          }}
        >
          {didImport ? <Check size={12} /> : <FileUp size={12} />}
          {didImport ? 'IMPORTED_FROM_JD' : 'IMPORT_FROM_JD'}
        </button>

        <button
          onClick={() => setIsDepthModalOpen(true)}
          disabled={isBusy}
          style={{
            padding: '12px 18px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.55)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.15em',
            fontFamily: '"Space Mono", monospace',
            cursor: isBusy ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 4,
          }}
        >
          <Settings size={12} />
          INTERVIEW_DEPTH: {budget}
        </button>
      </div>

      {/* Role fields — simplified for any role type (ADR-028) */}
      <LiquidMetalCard style={{ padding: 32, borderRadius: 16, marginBottom: 28 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <FieldGroup label="Role Title" required>
              <TextInput value={title} onChange={setTitle} placeholder="e.g., Senior Backend Engineer, Marketing Director, UX Designer" />
            </FieldGroup>
          </div>
          <FieldGroup label="Department">
            <TextInput value={department} onChange={setDepartment} placeholder="Engineering, Marketing, Design..." />
          </FieldGroup>
          <FieldGroup label="Location">
            <TextInput value={location} onChange={setLocation} placeholder="San Francisco / Remote / Hybrid" />
          </FieldGroup>
          <FieldGroup label="Company Name">
            <TextInput value={companyName} onChange={setCompanyName} placeholder="Acme Corp" />
          </FieldGroup>
          <FieldGroup label="Company Website" hint="Agent will research before asking questions">
            <TextInput value={companyUrl} onChange={setCompanyUrl} placeholder="https://acme.com" />
          </FieldGroup>
        </div>
      </LiquidMetalCard>

      {/* Modals */}
      {isJDModalOpen && (
        <JobDescriptionImportModal
          onParsed={applyParsed}
          onClose={() => setIsJDModalOpen(false)}
        />
      )}
      {isDepthModalOpen && (
        <InterviewDepthModal
          initialBudget={budget}
          onSave={setBudget}
          onClose={() => setIsDepthModalOpen(false)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Interview Phase ──────────��─────────────────────────────────────────────

function InterviewPhase({
  acknowledgment,
  question,
  progress,
  pastExchanges,
  isLoading,
  onRespond,
  onComplete,
  onFeedback,
}: {
  acknowledgment: string | null;
  question: RoleContextQuestion | null;
  progress: RoleContextProgress | null;
  pastExchanges: PastExchange[];
  isLoading: boolean;
  onRespond: (answer: string, questionId: string) => void;
  onComplete: () => void;
  onFeedback?: (questionId: string, feedback: string) => void;
}): JSX.Element {
  const [answer, setAnswer] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll on new question
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [question?.id, pastExchanges.length]);

  // Reset answer when question changes
  useEffect(() => {
    setAnswer('');
  }, [question?.id]);

  const handleSubmit = (): void => {
    if (!question || !answer.trim() || isLoading) return;
    const finalAnswer = question.input.type === 'tags'
      ? answer.split('|||').join(', ')
      : answer.trim();
    onRespond(finalAnswer, question.id);
  };

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
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

        if (chunksRef.current.length === 0) return;

        setIsTranscribing(true);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const formData = new FormData();
        formData.append('audio', blob, 'voice.webm');

        try {
          const baseUrl = import.meta.env?.VITE_API_URL ?? 'http://localhost:8787';
          const clerkWindow = window as { Clerk?: { session?: { getToken: () => Promise<string> } } };
          const token = await clerkWindow.Clerk?.session?.getToken();

          const res = await fetch(`${baseUrl}/api/v1/role-contexts/transcribe`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          });

          if (res.ok) {
            const data = (await res.json()) as { transcript: string };
            if (data.transcript) {
              setAnswer((prev) => prev ? `${prev} ${data.transcript}` : data.transcript);
            }
          } else {
            const data = await res.json().catch(() => ({})) as { error?: string };
            console.error('[InterviewPhase] Transcription error:', res.status, data);
            setTranscribeError(data.error ?? 'Transcription failed. Please type your answer.');
          }
        } catch (err) {
          console.error('[InterviewPhase] Transcription failed:', err);
          setTranscribeError('Transcription failed. Please type your answer.');
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start(250);
      timerRef.current = setInterval(() => setRecordDuration((d) => d + 1), 1000);
      setIsRecording(true);
    } catch {
      console.error('[InterviewPhase] Mic access denied');
    }
  }, []);

  const stopRecording = useCallback((): void => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const asked = progress?.asked ?? 0;
  const budget = progress?.budget ?? 10;
  const remaining = budget - asked;

  return (
    <div>
      {/* Header bar — matches page style */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 8,
          }}>
            QUESTION_{asked + 1}_OF_{budget}
          </div>
          <div style={{
            height: 2,
            width: 200,
            background: 'rgba(255,255,255,0.04)',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${(asked / budget) * 100}%`,
              background: 'rgba(74, 222, 128, 0.5)',
              transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
            }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {progress?.domains && <DomainBars domains={progress.domains} />}
          {asked >= 3 && (
            <button
              onClick={onComplete}
              disabled={isLoading}
              style={{
                padding: '8px 16px',
                fontSize: 10,
                letterSpacing: '0.15em',
                color: 'rgba(74, 222, 128, 0.7)',
                background: 'rgba(74, 222, 128, 0.06)',
                border: '1px solid rgba(74, 222, 128, 0.2)',
                cursor: isLoading ? 'default' : 'pointer',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              SUBMIT_INTERVIEW
            </button>
          )}
        </div>
      </div>

      {/* Past exchanges (collapsed) */}
      {pastExchanges.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {pastExchanges.map((ex, i) => (
            <PastExchangeCard key={ex.questionId} exchange={ex} index={i} onFeedback={onFeedback} />
          ))}
        </div>
      )}

      {/* Current turn */}
      {isLoading && !question ? (
        <ThinkingIndicator message={pastExchanges.length === 0 ? "Researching and preparing your first question..." : "Thinking..."} />
      ) : isLoading ? (
        <div>
          {acknowledgment && (
            <div style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.45)',
              lineHeight: 1.7,
              marginBottom: 12,
              fontFamily: '"Space Mono", monospace',
            }}>
              {acknowledgment}
            </div>
          )}
          <ThinkingIndicator message="Generating next question..." />
        </div>
      ) : question ? (
        <div
          ref={scrollRef}
          style={{
            padding: 32,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16,
          }}
        >
          {/* Agent message */}
          {acknowledgment && (
            <div style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.45)',
              lineHeight: 1.7,
              marginBottom: 12,
              fontFamily: '"Space Mono", monospace',
            }}>
              {acknowledgment}
            </div>
          )}
          <div style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--pipe-text, #fff)',
            lineHeight: 1.4,
            marginBottom: 28,
            letterSpacing: '-0.01em',
          }}>
            {question.text}
          </div>

          {/* Voice button — big, centered, primary action */}
          {(question.input.type === 'text' || question.input.type === 'textarea') && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 24 }}>
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isTranscribing}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: isRecording
                    ? 'rgba(248, 113, 113, 0.15)'
                    : isTranscribing
                      ? 'rgba(255,255,255,0.04)'
                      : 'rgba(255,255,255,0.03)',
                  border: isRecording
                    ? '2px solid rgba(248, 113, 113, 0.4)'
                    : '2px solid rgba(255,255,255,0.08)',
                  color: isRecording
                    ? 'rgba(248, 113, 113, 0.9)'
                    : 'rgba(255,255,255,0.35)',
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
                    <span style={{ fontSize: 9, fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>{recordDuration}s</span>
                  </>
                ) : (
                  <Mic size={26} />
                )}
              </button>
              <span style={{
                fontSize: 8,
                letterSpacing: '0.15em',
                color: 'rgba(255,255,255,0.15)',
                fontFamily: '"Space Mono", monospace',
              }}>
                {isRecording ? 'TAP_TO_STOP' : isTranscribing ? 'TRANSCRIBING...' : 'TAP_TO_SPEAK'}
              </span>
              {transcribeError && (
                <span style={{ fontSize: 10, color: '#f87171', fontFamily: '"Space Mono", monospace', textAlign: 'center', marginTop: 4 }}>
                  {transcribeError}
                </span>
              )}
            </div>
          )}

          {/* Divider */}
          {(question.input.type === 'text' || question.input.type === 'textarea') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.04)' }} />
              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>OR_TYPE</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.04)' }} />
            </div>
          )}

          {/* Text input + send */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'start' }}>
            <div style={{ flex: 1 }}>
              <QuestionInput
                question={question}
                value={answer}
                onChange={setAnswer}
                onSubmit={handleSubmit}
                disabled={isLoading}
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={!answer.trim() || isLoading}
              style={{
                padding: '10px 20px',
                flexShrink: 0,
                background: answer.trim() && !isLoading
                  ? 'rgba(74, 222, 128, 0.08)'
                  : 'transparent',
                border: answer.trim() && !isLoading
                  ? '1px solid rgba(74, 222, 128, 0.3)'
                  : '1px solid rgba(255,255,255,0.06)',
                color: answer.trim() && !isLoading
                  ? 'rgba(74, 222, 128, 0.9)'
                  : 'rgba(255,255,255,0.15)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.15em',
                fontFamily: '"Space Mono", monospace',
                cursor: answer.trim() && !isLoading ? 'pointer' : 'default',
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
              SEND
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Synthesis Phase ────────────────────────────────────────────────────────

type SynthesisTab = 'PERSONA' | 'JOB_DESCRIPTION';

function PersonaField({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 8,
        letterSpacing: '0.2em',
        color: 'rgba(139, 92, 246, 0.55)',
        fontFamily: '"Space Mono", monospace',
        marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 13,
        color: 'rgba(255,255,255,0.85)',
        lineHeight: 1.7,
        fontFamily: '"Space Mono", monospace',
      }}>
        {children}
      </div>
    </div>
  );
}

function PersonaTagList({ items, tone }: { items: string[]; tone: 'neutral' | 'warn' | 'danger' }): JSX.Element {
  if (items.length === 0) {
    return <span style={{ color: 'rgba(255,255,255,0.35)' }}>—</span>;
  }
  const palette = {
    neutral: { bg: 'rgba(139, 92, 246, 0.12)', border: 'rgba(139, 92, 246, 0.3)', fg: 'rgba(216, 180, 254, 0.95)' },
    warn:    { bg: 'rgba(251, 191, 36, 0.1)',  border: 'rgba(251, 191, 36, 0.3)',  fg: 'rgba(253, 224, 71, 0.95)' },
    danger:  { bg: 'rgba(252, 165, 165, 0.1)', border: 'rgba(252, 165, 165, 0.3)', fg: 'rgba(252, 165, 165, 0.95)' },
  }[tone];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((item, i) => (
        <span key={i} style={{
          fontSize: 11,
          padding: '4px 10px',
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          color: palette.fg,
          fontFamily: '"Space Mono", monospace',
        }}>
          {item}
        </span>
      ))}
    </div>
  );
}

function SynthesisPhase({
  persona,
  jobDescription,
  progress,
  onCreatePipeline,
  isCreating,
}: {
  persona: CandidatePersona | null;
  jobDescription: GeneratedJobDescription | null;
  progress: RoleContextProgress | null;
  onCreatePipeline: () => void;
  isCreating: boolean;
}): JSX.Element {
  const [tab, setTab] = useState<SynthesisTab>('PERSONA');

  const tabButton = (value: SynthesisTab, label: string): JSX.Element => {
    const active = tab === value;
    return (
      <button
        onClick={() => setTab(value)}
        style={{
          padding: '10px 18px',
          background: active ? 'rgba(139, 92, 246, 0.18)' : 'transparent',
          border: active ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid rgba(255,255,255,0.08)',
          color: active ? '#fff' : 'rgba(255,255,255,0.5)',
          fontSize: 9,
          letterSpacing: '0.2em',
          fontFamily: '"Space Mono", monospace',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <div style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(74, 222, 128, 0.1)',
          border: '1px solid rgba(74, 222, 128, 0.3)',
        }}>
          <Check size={16} style={{ color: 'rgba(74, 222, 128, 0.8)' }} />
        </div>
        <div>
          <div style={{
            fontSize: 8,
            letterSpacing: '0.25em',
            color: 'rgba(74, 222, 128, 0.6)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 4,
          }}>
            INTERVIEW COMPLETE
          </div>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--pipe-text, #fff)',
          }}>
            Role Profile
          </div>
        </div>
      </div>

      {/* Domain coverage final state */}
      {progress?.domains && (
        <div style={{ marginBottom: 28 }}>
          <DomainBars domains={progress.domains} />
        </div>
      )}

      {/* Tab toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabButton('PERSONA', 'CANDIDATE PERSONA')}
        {tabButton('JOB_DESCRIPTION', 'JOB DESCRIPTION')}
      </div>

      {/* Persona card */}
      {tab === 'PERSONA' && (
        <LiquidMetalCard variant="mercury" style={{ padding: 28, marginBottom: 32 }}>
          {persona ? (
            <>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 20,
              }}>
                <Sparkles size={14} style={{ color: 'rgba(139, 92, 246, 0.6)' }} />
                <span style={{
                  fontSize: 8,
                  letterSpacing: '0.2em',
                  color: 'rgba(139, 92, 246, 0.5)',
                  fontFamily: '"Space Mono", monospace',
                }}>
                  INTERNAL HIRING TRUTH
                </span>
              </div>

              <PersonaField label="SENIORITY">{persona.seniority}</PersonaField>
              <PersonaField label="ARCHETYPE">{persona.archetype}</PersonaField>
              <PersonaField label="MUST-HAVE SKILLS">
                <PersonaTagList items={persona.mustHaveSkills} tone="neutral" />
              </PersonaField>
              <PersonaField label="NICE-TO-HAVE SKILLS">
                <PersonaTagList items={persona.niceToHaveSkills} tone="neutral" />
              </PersonaField>
              <PersonaField label="DISPOSITION">
                <PersonaTagList items={persona.disposition} tone="neutral" />
              </PersonaField>
              <PersonaField label="CAREER SIGNAL">{persona.careerSignal}</PersonaField>
              <PersonaField label="RED FLAGS">
                <PersonaTagList items={persona.redFlags} tone="warn" />
              </PersonaField>
              <div style={{ marginBottom: 0 }}>
                <div style={{
                  fontSize: 8,
                  letterSpacing: '0.2em',
                  color: 'rgba(252, 165, 165, 0.65)',
                  fontFamily: '"Space Mono", monospace',
                  marginBottom: 8,
                }}>
                  DEALBREAKERS
                </div>
                <PersonaTagList items={persona.dealbreakers} tone="danger" />
              </div>
            </>
          ) : (
            <div style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.45)',
              fontFamily: '"Space Mono", monospace',
            }}>
              No persona generated.
            </div>
          )}
        </LiquidMetalCard>
      )}

      {/* JD card */}
      {tab === 'JOB_DESCRIPTION' && (
        <LiquidMetalCard variant="mercury" style={{ padding: 28, marginBottom: 32 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 20,
          }}>
            <MessageSquare size={14} style={{ color: 'rgba(139, 92, 246, 0.6)' }} />
            <span style={{
              fontSize: 8,
              letterSpacing: '0.2em',
              color: 'rgba(139, 92, 246, 0.5)',
              fontFamily: '"Space Mono", monospace',
            }}>
              CANDIDATE-FACING JD
            </span>
          </div>
          {jobDescription ? (
            <div className="jd-markdown" style={{
              fontSize: 13,
              color: 'rgba(255,255,255,0.82)',
              lineHeight: 1.75,
              fontFamily: '"Space Mono", monospace',
            }}>
              <ReactMarkdown>{jobDescription}</ReactMarkdown>
            </div>
          ) : (
            <div style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.45)',
              fontFamily: '"Space Mono", monospace',
            }}>
              No job description generated.
            </div>
          )}
        </LiquidMetalCard>
      )}

      {/* Create pipeline CTA */}
      <button
        onClick={onCreatePipeline}
        disabled={isCreating}
        style={{
          width: '100%',
          padding: '16px 32px',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(59, 130, 246, 0.2))',
          border: '1px solid rgba(139, 92, 246, 0.4)',
          color: '#fff',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.15em',
          fontFamily: '"Space Mono", monospace',
          cursor: isCreating ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        {isCreating ? (
          <>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            CREATING PIPELINE...
          </>
        ) : (
          <>
            <ArrowRight size={14} />
            CREATE PIPELINE FROM PROFILE
          </>
        )}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────��─────────────────────────

export default function RoleDiscoveryPage(): JSX.Element {
  const navigate = useNavigate();
  const api = useApiClient();
  const rd = useRoleDiscovery();
  const { create: createPipeline, isCreating } = usePipelineCreate();

  const handleBaselineSubmit = async (baseline: RoleContextBaseline, budget: number): Promise<void> => {
    try {
      await rd.createAndStart(baseline, budget);
    } catch {
      // Error is surfaced via rd.error
    }
  };

  // Skip the AI interview entirely — create the pipeline directly from baseline data.
  // No role_context is created and no synthesis is generated; the recruiter can fill
  // in the rest of the pipeline manually.
  const handleSkipInterview = async (baseline: RoleContextBaseline): Promise<void> => {
    try {
      const pipelineId = await createPipeline({
        title: baseline.title,
        level: 'Senior',
        status: 'DRAFT',
        creationMode: 'BLANK',
      });
      navigate(`/pipeline/${pipelineId}`);
    } catch (err) {
      console.error('[RoleDiscoveryPage] Skip-interview create failed:', err);
    }
  };

  const handleRespond = (answer: string, questionId: string): void => {
    rd.respond(answer, questionId).catch(() => {
      // Error surfaced via rd.error
    });
  };

  const handleCreatePipeline = async (): Promise<void> => {
    try {
      // Use baseline data from the discovery session
      const baseline = rd.baseline;
      const pipelineId = await createPipeline({
        title: baseline?.title ?? 'New Role',
        level: 'Senior',
        status: 'DRAFT',
        creationMode: 'BLANK',
      });

      // Link the role context to this pipeline
      if (rd.contextId) {
        try {
          await api.patch(`/api/v1/role-contexts/${rd.contextId}`, { pipelineId });
        } catch (err) {
          console.error('[RoleDiscoveryPage] Failed to link role context:', err);
        }
      }

      navigate(`/pipeline/${pipelineId}`);
    } catch {
      // Error surfaced via pipeline create hook
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: 40 }}>
      {/* Error banner */}
      {rd.error && (
        <div style={{
          marginBottom: 0,
          padding: '12px 20px',
          background: 'rgba(252, 165, 165, 0.08)',
          border: '1px solid rgba(252, 165, 165, 0.2)',
          fontSize: 11,
          color: 'rgba(252, 165, 165, 0.85)',
          fontFamily: '"Space Mono", monospace',
        }}>
          {rd.error}
        </div>
      )}

      {/* Phase rendering */}
      {(rd.phase === 'IDLE' || rd.phase === 'BASELINE') && (
        <BaselinePhase
          onSubmit={handleBaselineSubmit}
          onSkipInterview={(baseline) => { handleSkipInterview(baseline).catch(() => {}); }}
          isLoading={rd.isLoading}
          isSkipping={isCreating}
        />
      )}

      {(rd.phase === 'CALIBRATING' || rd.phase === 'INTERVIEWING') && (
        <InterviewPhase
          acknowledgment={rd.acknowledgment}
          question={rd.currentQuestion}
          progress={rd.progress}
          pastExchanges={rd.pastExchanges}
          isLoading={rd.isLoading}
          onRespond={handleRespond}
          onComplete={() => { rd.completeEarly().catch(() => {}); }}
          onFeedback={(qId, fb) => { rd.submitFeedback(qId, fb).catch(() => {}); }}
        />
      )}

      {rd.phase === 'COMPLETE' && (rd.persona || rd.jobDescription) && (
        <SynthesisPhase
          persona={rd.persona}
          jobDescription={rd.jobDescription}
          progress={rd.progress}
          onCreatePipeline={handleCreatePipeline}
          isCreating={isCreating}
        />
      )}
    </div>
  );
}
