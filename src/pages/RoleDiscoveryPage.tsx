/**
 * RoleDiscoveryPage — unified conversation-first role intake (ADR-027/028).
 *
 * Single continuous conversation from first question through synthesis.
 * Scripted questions collect baseline data (title, company, URL) using the
 * same card aesthetic as the AI interview — no form grid.
 *
 * Flow:
 *   Scripted Q1–Q3 (role, company, URL)
 *   → API: create context + start
 *   → Calibration Q (participant role)
 *   → AI interview (N turns)
 *   → Synthesis (persona + JD)
 *   → CREATE PIPELINE
 *
 * Route: /pipeline/new
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { TextInput, TextareaInput, TagsInput, RadioGroup, SelectInput } from '../components/ui/form';
import { JobDescriptionImportModal } from '../components/RoleDiscovery/JobDescriptionImportModal';
import { useRoleDiscovery } from '../hooks/useRoleDiscovery';
import { usePipelineCreate } from '../hooks/usePipelineCreate';
import { useApiClient } from '../hooks/useApiClient';
import {
  Loader2, ArrowRight, Check, MessageSquare,
  ChevronDown, Mic, Square, Flag, FileUp, Sparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type {
  RoleContextBaseline, RoleContextQuestion, RoleContextProgress,
  DomainCoverage, ParseJDResponse, CandidatePersona, GeneratedJobDescription,
} from '../lib/api/types';
import type { PastExchange } from '../hooks/useRoleDiscovery';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BUDGET = 15;

const DOMAIN_LABELS: Record<string, string> = {
  why: 'WHY', work: 'WORK', team: 'TEAM', bar: 'BAR', codebase: 'CODE', process: 'PROC',
};
const COVERAGE_LEVELS: Record<DomainCoverage, number> = {
  none: 0, sparse: 0.2, partial: 0.45, covered: 0.75, deep: 1,
};
const COVERAGE_COLORS: Record<DomainCoverage, string> = {
  none: 'var(--pipe-border-light)',
  sparse: 'rgba(251, 191, 36, 0.4)',
  partial: 'rgba(251, 191, 36, 0.65)',
  covered: 'rgba(74, 222, 128, 0.6)',
  deep: 'rgba(74, 222, 128, 0.9)',
};

interface ScriptedQuestion {
  id: string;
  text: string;
  optional: boolean;
  placeholder: string;
  inputType?: 'text' | 'tags';
}

const SCRIPTED: ScriptedQuestion[] = [
  {
    id: 'sq-title',
    text: "What role are you hiring for?",
    optional: false,
    placeholder: 'e.g., Senior Backend Engineer, Head of Product...',
  },
  {
    id: 'sq-company',
    text: "What company is this for?",
    optional: true,
    placeholder: 'Acme Corp',
  },
  {
    id: 'sq-url',
    text: "Got a company website? I'll research it before asking questions.",
    optional: true,
    placeholder: 'https://acme.com',
  },
  {
    id: 'sq-salary',
    text: "What's the comp range?",
    optional: true,
    placeholder: 'e.g., $150K–$180K base + equity',
  },
  {
    id: 'sq-stack',
    text: "What technologies do they need on day one?",
    optional: true,
    placeholder: 'e.g., React, TypeScript, PostgreSQL',
    inputType: 'tags',
  },
];

// ─── DomainBars ──────────────────────────────────────────────────────────────

function DomainBars({ domains }: { domains: Record<string, DomainCoverage> }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 48 }}>
      {Object.entries(DOMAIN_LABELS).map(([key, label]) => {
        const coverage = (domains[key] ?? 'none') as DomainCoverage;
        const level = COVERAGE_LEVELS[coverage];
        const color = COVERAGE_COLORS[coverage];
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 28, height: 36,
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border-light)',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: `${level * 100}%`,
                background: color,
                transition: 'height 0.6s cubic-bezier(0.16, 1, 0.3, 1), background 0.4s ease',
              }} />
            </div>
            <span style={{
              fontSize: 7, letterSpacing: '0.1em',
              color: coverage === 'none' ? 'var(--pipe-text-dim)' : 'var(--pipe-text-muted)',
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

// ─── ThinkingIndicator ───────────────────────────────────────────────────────

function ThinkingIndicator({ message }: { message?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '20px 0', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'rgba(74, 222, 128, 0.5)',
              animation: `typingPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      {message && (
        <span style={{
          fontSize: 10, letterSpacing: '0.1em',
          color: 'var(--pipe-text-dim)',
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

// ─── PastExchangeCard ────────────────────────────────────────────────────────

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
        background: 'var(--pipe-surface)',
        borderLeft: `2px solid ${hasFeedback ? 'rgba(251, 191, 36, 0.4)' : 'rgba(139, 92, 246, 0.2)'}`,
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        marginBottom: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{
            fontSize: 8, letterSpacing: '0.15em',
            color: 'rgba(139, 92, 246, 0.5)',
            fontFamily: '"Space Mono", monospace', flexShrink: 0,
          }}>
            Q{index + 1}
          </span>
          <span style={{
            fontSize: 11, color: 'var(--pipe-text-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: expanded ? 'normal' : 'nowrap',
            fontFamily: '"Space Mono", monospace',
          }}>
            {exchange.questionText}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {onFeedback && (
            <div
              onClick={handleFlagClick}
              title={hasFeedback ? 'Flagged — click to edit' : 'Flag this question'}
              style={{ padding: 4, cursor: 'pointer', opacity: hasFeedback ? 1 : 0.3, transition: 'opacity 0.2s ease' }}
              onMouseOver={(e) => { e.currentTarget.style.opacity = '1'; }}
              onMouseOut={(e) => { e.currentTarget.style.opacity = hasFeedback ? '1' : '0.3'; }}
            >
              <Flag size={11} color={hasFeedback ? 'rgba(251, 191, 36, 0.9)' : 'var(--pipe-text-muted)'} />
            </div>
          )}
          <ChevronDown
            size={12}
            style={{
              color: 'var(--pipe-text-dim)',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 0.2s ease',
            }}
          />
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: 6, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace' }}>
            YOUR ANSWER
          </div>
          <div style={{ fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.6, fontFamily: '"Space Mono", monospace' }}>
            {exchange.answer}
          </div>

          {showFeedback && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ marginTop: 12, borderTop: '1px solid rgba(251, 191, 36, 0.15)', paddingTop: 12 }}
            >
              <div style={{ fontSize: 10, color: 'rgba(251, 191, 36, 0.6)', marginBottom: 6, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace' }}>
                FLAG_QUESTION
              </div>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="What's wrong with this question? Too vague, leading, irrelevant..."
                style={{ width: '100%', minHeight: 48, padding: '10px 12px', background: 'rgba(251, 191, 36, 0.04)', border: '1px solid rgba(251, 191, 36, 0.15)', color: 'var(--pipe-text-muted)', fontSize: 11, fontFamily: '"Space Mono", monospace', resize: 'vertical', outline: 'none' }}
              />
              <button
                onClick={handleSubmitFeedback}
                disabled={!feedbackText.trim()}
                style={{ marginTop: 8, padding: '6px 16px', background: feedbackText.trim() ? 'rgba(251, 191, 36, 0.1)' : 'transparent', border: `1px solid ${feedbackText.trim() ? 'rgba(251, 191, 36, 0.3)' : 'var(--pipe-border-light)'}`, color: feedbackText.trim() ? 'rgba(251, 191, 36, 0.9)' : 'var(--pipe-text-dim)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace', cursor: feedbackText.trim() ? 'pointer' : 'default' }}
              >
                SAVE_FLAG
              </button>
            </div>
          )}

          {!showFeedback && hasFeedback && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(251, 191, 36, 0.04)', borderLeft: '2px solid rgba(251, 191, 36, 0.3)', fontSize: 10, color: 'rgba(251, 191, 36, 0.6)', fontFamily: '"Space Mono", monospace' }}>
              {exchange.feedback || feedbackText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── QuestionInput ────────────────────────────────────────────────────────────

function QuestionInput({
  question, value, onChange, onSubmit,
}: {
  question: RoleContextQuestion;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}): JSX.Element {
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey && question.input.type !== 'textarea') {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && question.input.type === 'textarea') {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
  };

  const inputProps = { value: value || '', onChange, placeholder: question.input.placeholder ?? '' };

  return (
    <div onKeyDown={handleKeyDown}>
      {question.input.type === 'textarea' && <TextareaInput {...inputProps} rows={4} />}
      {question.input.type === 'text' && <TextInput {...inputProps} />}
      {question.input.type === 'select' && question.input.options && <SelectInput {...inputProps} options={question.input.options} />}
      {question.input.type === 'radio' && question.input.options && <RadioGroup value={value} onChange={onChange} options={question.input.options} />}
      {question.input.type === 'tags' && (
        <TagsInput
          value={value ? value.split('|||') : []}
          onChange={(tags) => onChange(tags.join('|||'))}
          placeholder={question.input.placeholder ?? ''}
        />
      )}
      <div style={{ marginTop: 10, fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
        {question.input.type === 'textarea' ? 'CMD+ENTER TO SEND' : 'ENTER TO SEND'}
      </div>
    </div>
  );
}

// ─── PersonaField / PersonaTagList ────────────────────────────────────────────

function PersonaField({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(139, 92, 246, 0.55)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: 'var(--pipe-text)', lineHeight: 1.7, fontFamily: '"Space Mono", monospace' }}>
        {children}
      </div>
    </div>
  );
}

function PersonaTagList({ items, tone }: { items: string[]; tone: 'neutral' | 'warn' | 'danger' }): JSX.Element {
  if (items.length === 0) return <span style={{ color: 'var(--pipe-text-dim)' }}>—</span>;
  const palette = {
    neutral: { bg: 'rgba(139, 92, 246, 0.12)', border: 'rgba(139, 92, 246, 0.3)', fg: 'rgba(216, 180, 254, 0.95)' },
    warn:    { bg: 'rgba(251, 191, 36, 0.1)',  border: 'rgba(251, 191, 36, 0.3)',  fg: 'rgba(253, 224, 71, 0.95)' },
    danger:  { bg: 'rgba(252, 165, 165, 0.1)', border: 'rgba(252, 165, 165, 0.3)', fg: 'rgba(252, 165, 165, 0.95)' },
  }[tone];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((item, i) => (
        <span key={i} style={{ fontSize: 11, padding: '4px 10px', background: palette.bg, border: `1px solid ${palette.border}`, color: palette.fg, fontFamily: '"Space Mono", monospace' }}>
          {item}
        </span>
      ))}
    </div>
  );
}

// ─── SynthesisPhase ───────────────────────────────────────────────────────────

type SynthesisTab = 'PERSONA' | 'JOB_DESCRIPTION';

function SynthesisPhase({
  persona, jobDescription, progress, onCreatePipeline, isCreating,
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
        style={{ padding: '10px 18px', background: active ? 'rgba(139, 92, 246, 0.18)' : 'transparent', border: active ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid var(--pipe-border)', color: active ? '#fff' : 'var(--pipe-text-muted)', fontSize: 9, letterSpacing: '0.2em', fontFamily: '"Space Mono", monospace', fontWeight: 700, cursor: 'pointer' }}
      >
        {label}
      </button>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(74, 222, 128, 0.1)', border: '1px solid rgba(74, 222, 128, 0.3)' }}>
          <Check size={16} style={{ color: 'rgba(74, 222, 128, 0.8)' }} />
        </div>
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.25em', color: 'rgba(74, 222, 128, 0.6)', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>
            INTERVIEW COMPLETE
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pipe-text)' }}>
            Role Profile
          </div>
        </div>
      </div>

      {/* Domain coverage */}
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

      {tab === 'PERSONA' && (
        <LiquidMetalCard variant="mercury" style={{ padding: 28, marginBottom: 32 }}>
          {persona ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Sparkles size={14} style={{ color: 'rgba(139, 92, 246, 0.6)' }} />
                <span style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(139, 92, 246, 0.5)', fontFamily: '"Space Mono", monospace' }}>
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
                <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(252, 165, 165, 0.65)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
                  DEALBREAKERS
                </div>
                <PersonaTagList items={persona.dealbreakers} tone="danger" />
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
              No persona generated.
            </div>
          )}
        </LiquidMetalCard>
      )}

      {tab === 'JOB_DESCRIPTION' && (
        <LiquidMetalCard variant="mercury" style={{ padding: 28, marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <MessageSquare size={14} style={{ color: 'rgba(139, 92, 246, 0.6)' }} />
            <span style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(139, 92, 246, 0.5)', fontFamily: '"Space Mono", monospace' }}>
              CANDIDATE-FACING JD
            </span>
          </div>
          {jobDescription ? (
            <div className="jd-markdown" style={{ fontSize: 13, color: 'var(--pipe-text)', lineHeight: 1.75, fontFamily: '"Space Mono", monospace' }}>
              <ReactMarkdown>{jobDescription}</ReactMarkdown>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
              No job description generated.
            </div>
          )}
        </LiquidMetalCard>
      )}

      <button
        onClick={onCreatePipeline}
        disabled={isCreating}
        style={{ width: '100%', padding: '16px 32px', background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(59, 130, 246, 0.2))', border: '1px solid rgba(139, 92, 246, 0.4)', color: 'var(--pipe-text)', fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', fontFamily: '"Space Mono", monospace', cursor: isCreating ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
      >
        {isCreating ? (
          <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> CREATING PIPELINE...</>
        ) : (
          <><ArrowRight size={14} /> CREATE PIPELINE FROM PROFILE</>
        )}
      </button>
    </div>
  );
}

// ─── StepIndicator ───────────────────────────────────────────────────────────

type StepId = 'role' | 'interview' | 'review';

function StepIndicator({ active }: { active: StepId }): JSX.Element {
  const steps: Array<{ id: StepId; label: string }> = [
    { id: 'role', label: 'ROLE' },
    { id: 'interview', label: 'INTERVIEW' },
    { id: 'review', label: 'REVIEW' },
  ];
  const activeIdx = steps.findIndex((s) => s.id === active);

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {steps.map((step, i) => {
        const isDone = i < activeIdx;
        const isCurrent = i === activeIdx;
        const nodeColor = isCurrent ? 'var(--pipe-text)' : isDone ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-dim)';
        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 6,
              background: isCurrent ? 'var(--pipe-surface-hover)' : isDone ? 'rgba(74, 222, 128, 0.06)' : 'transparent',
              border: isCurrent ? '1px solid var(--pipe-text-dim)' : isDone ? '1px solid rgba(74, 222, 128, 0.2)' : '1px solid transparent',
              opacity: isCurrent ? 1 : isDone ? 1 : 0.35,
            }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%',
                background: isCurrent ? 'var(--pipe-surface)' : isDone ? 'rgba(74, 222, 128, 0.15)' : 'var(--pipe-surface)',
                border: `1px solid ${isCurrent ? 'var(--pipe-border)' : isDone ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 800, color: nodeColor, flexShrink: 0,
              }}>
                {isDone ? <Check size={10} /> : i + 1}
              </div>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.15em',
                color: nodeColor, fontFamily: '"Space Mono", monospace', whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: 24, height: 1, background: isDone ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border)', flexShrink: 0 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RoleDiscoveryPage(): JSX.Element {
  const navigate = useNavigate();
  const api = useApiClient();
  const rd = useRoleDiscovery();
  const { create: createPipeline, isCreating } = usePipelineCreate();

  // ── Scripted phase ──
  const [scriptedIdx, setScriptedIdx] = useState(0);
  const [scriptedAnswer, setScriptedAnswer] = useState('');
  const [scriptedAnswers, setScriptedAnswers] = useState<Record<string, string>>({});
  const [scriptedExchanges, setScriptedExchanges] = useState<PastExchange[]>([]);
  const [isJDModalOpen, setIsJDModalOpen] = useState(false);

  // ── AI interview answer ──
  const [aiAnswer, setAiAnswer] = useState('');

  // ── Voice recording ──
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Scroll ──
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [rd.currentQuestion?.id, rd.pastExchanges.length, scriptedIdx]);

  useEffect(() => {
    setAiAnswer('');
  }, [rd.currentQuestion?.id]);

  // ── Build and fire the API ──
  const fireCreateAndStart = useCallback((answers: Record<string, string>): void => {
    const techTags = (answers['sq-stack'] ?? '').split('|||').filter(Boolean);
    const baseline: RoleContextBaseline = {
      title: answers['sq-title']?.trim() || '',
      ...(answers['sq-company']?.trim() ? { companyName: answers['sq-company'].trim() } : {}),
      ...(answers['sq-url']?.trim() ? { companyUrl: answers['sq-url'].trim() } : {}),
      ...(answers['sq-salary']?.trim() ? { salaryRange: answers['sq-salary'].trim() } : {}),
      ...(techTags.length > 0 ? { techStack: techTags } : {}),
    };
    rd.createAndStart(baseline, DEFAULT_BUDGET).catch(() => {});
  }, [rd]);

  // ── Scripted question submit ──
  const handleScriptedSubmit = useCallback((): void => {
    const q = SCRIPTED[scriptedIdx];
    if (!q) return;
    if (!q.optional && !scriptedAnswer.trim()) return;

    const displayAnswer = q.inputType === 'tags'
      ? (scriptedAnswer.split('|||').filter(Boolean).join(', ') || '(skipped)')
      : (scriptedAnswer.trim() || '(skipped)');

    setScriptedExchanges((prev) => [
      ...prev,
      { questionId: q.id, acknowledgment: '', questionText: q.text, answer: displayAnswer },
    ]);

    const newAnswers = { ...scriptedAnswers, [q.id]: scriptedAnswer };
    setScriptedAnswers(newAnswers);
    setScriptedAnswer('');

    if (scriptedIdx < SCRIPTED.length - 1) {
      setScriptedIdx(scriptedIdx + 1);
    } else {
      fireCreateAndStart(newAnswers);
    }
  }, [scriptedIdx, scriptedAnswer, scriptedAnswers, fireCreateAndStart]);

  const handleScriptedSkip = useCallback((): void => {
    const q = SCRIPTED[scriptedIdx];
    if (!q?.optional) return;

    setScriptedExchanges((prev) => [
      ...prev,
      { questionId: q.id, acknowledgment: '', questionText: q.text, answer: '(skipped)' },
    ]);

    const newAnswers = { ...scriptedAnswers, [q.id]: '' };
    setScriptedAnswers(newAnswers);
    setScriptedAnswer('');

    if (scriptedIdx < SCRIPTED.length - 1) {
      setScriptedIdx(scriptedIdx + 1);
    } else {
      fireCreateAndStart(newAnswers);
    }
  }, [scriptedIdx, scriptedAnswers, fireCreateAndStart]);

  // ── JD import — skip scripted questions, fire immediately ──
  const handleJDImport = useCallback((parsed: ParseJDResponse['parsed']): void => {
    setIsJDModalOpen(false);
    const title = parsed.title ?? '';
    const companyName = parsed.companyName ?? '';
    const companyUrl = parsed.companyUrl ?? '';

    const exchanges: PastExchange[] = [];
    if (title) exchanges.push({ questionId: 'sq-title', acknowledgment: '', questionText: SCRIPTED[0]!.text, answer: title });
    if (companyName) exchanges.push({ questionId: 'sq-company', acknowledgment: '', questionText: SCRIPTED[1]!.text, answer: companyName });
    if (companyUrl) exchanges.push({ questionId: 'sq-url', acknowledgment: '', questionText: SCRIPTED[2]!.text, answer: companyUrl });
    setScriptedExchanges(exchanges);

    const baseline: RoleContextBaseline = {
      title,
      ...(companyName ? { companyName } : {}),
      ...(companyUrl ? { companyUrl } : {}),
      ...(parsed.department ? { department: parsed.department } : {}),
      ...(parsed.location ? { location: parsed.location } : {}),
    };
    rd.createAndStart(baseline, DEFAULT_BUDGET).catch(() => {});
  }, [rd]);

  // ── AI interview respond ──
  const handleAIRespond = useCallback((): void => {
    if (!rd.currentQuestion || !aiAnswer.trim() || rd.isLoading) return;
    const finalAnswer = rd.currentQuestion.input.type === 'tags'
      ? aiAnswer.split('|||').join(', ')
      : aiAnswer.trim();
    rd.respond(finalAnswer, rd.currentQuestion.id).catch(() => {});
  }, [rd, aiAnswer]);

  // ── Voice recording ──
  const startRecording = useCallback(async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      setRecordDuration(0);
      setTranscribeError(null);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

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
            if (data.transcript) setAiAnswer((prev) => prev ? `${prev} ${data.transcript}` : data.transcript);
          } else {
            const data = await res.json().catch(() => ({})) as { error?: string };
            console.error('[RoleDiscoveryPage] Transcription error:', res.status, data);
            setTranscribeError(data.error ?? 'Transcription failed. Please type your answer.');
          }
        } catch (err) {
          console.error('[RoleDiscoveryPage] Transcription failed:', err);
          setTranscribeError('Transcription failed. Please type your answer.');
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start(250);
      timerRef.current = setInterval(() => setRecordDuration((d) => d + 1), 1000);
      setIsRecording(true);
    } catch {
      console.error('[RoleDiscoveryPage] Mic access denied');
    }
  }, []);

  const stopRecording = useCallback((): void => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    setIsRecording(false);
  }, []);

  // ── Pipeline creation ──
  const handleCreatePipeline = async (): Promise<void> => {
    try {
      const baseline = rd.baseline;
      const pipelineId = await createPipeline({
        title: baseline?.title ?? 'New Role',
        level: 'Senior',
        status: 'DRAFT',
        creationMode: 'BLANK',
      });
      if (rd.contextId) {
        api.patch(`/api/v1/role-contexts/${rd.contextId}`, { pipelineId }).catch((err) => {
          console.error('[RoleDiscoveryPage] Failed to link role context:', err);
        });
      }
      navigate(`/pipeline/${pipelineId}`);
    } catch {
      // surfaced via pipeline hook
    }
  };

  // ── Computed ──
  const currentStep: StepId =
    rd.phase === 'COMPLETE' ? 'review' :
    rd.phase === 'IDLE' ? 'role' :
    'interview';

  const isInScriptedPhase = rd.phase === 'IDLE' && !rd.isLoading;
  const currentScriptedQ = isInScriptedPhase ? SCRIPTED[scriptedIdx] ?? null : null;
  const isAIPhase = rd.phase === 'CALIBRATING' || rd.phase === 'INTERVIEWING';
  const asked = rd.progress?.asked ?? 0;
  const budget = rd.progress?.budget ?? DEFAULT_BUDGET;
  const allPastExchanges: PastExchange[] = [...scriptedExchanges, ...rd.pastExchanges];

  const needsVoice = rd.currentQuestion &&
    (rd.currentQuestion.input.type === 'text' || rd.currentQuestion.input.type === 'textarea');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 40 }}>

      {/* Page header — consistent throughout */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            ROLE_DISCOVERY
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--pipe-text)', letterSpacing: '-0.02em', margin: 0 }}>
            New Role
          </h1>
        </div>
        <StepIndicator active={currentStep} />
      </div>

      {/* Error banner */}
      {rd.error && (
        <div style={{ padding: '12px 20px', background: 'rgba(252, 165, 165, 0.08)', border: '1px solid rgba(252, 165, 165, 0.2)', fontSize: 11, color: 'rgba(252, 165, 165, 0.85)', fontFamily: '"Space Mono", monospace' }}>
          {rd.error}
        </div>
      )}

      {/* AI interview progress + domain bars */}
      {isAIPhase && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
              QUESTION_{asked + 1}_OF_{budget}
            </div>
            <div style={{ height: 2, width: 200, background: 'var(--pipe-surface)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(asked / budget) * 100}%`, background: 'rgba(74, 222, 128, 0.5)', transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {rd.progress?.domains && <DomainBars domains={rd.progress.domains} />}
            {asked >= 3 && (
              <button
                onClick={() => { rd.completeEarly().catch(() => {}); }}
                disabled={rd.isLoading}
                style={{ padding: '8px 16px', fontSize: 10, letterSpacing: '0.15em', color: 'rgba(74, 222, 128, 0.7)', background: 'rgba(74, 222, 128, 0.06)', border: '1px solid rgba(74, 222, 128, 0.2)', cursor: rd.isLoading ? 'default' : 'pointer', fontFamily: '"Space Mono", monospace' }}
              >
                SUBMIT_INTERVIEW
              </button>
            )}
          </div>
        </div>
      )}

      {/* Conversation area */}
      {rd.phase !== 'COMPLETE' && (
        <div>
          {/* Past exchanges */}
          {allPastExchanges.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              {allPastExchanges.map((ex, i) => (
                <PastExchangeCard
                  key={ex.questionId}
                  exchange={ex}
                  index={i}
                  {...(isAIPhase && !ex.questionId.startsWith('sq-')
                    ? { onFeedback: (qId: string, fb: string) => { rd.submitFeedback(qId, fb).catch(() => {}); } }
                    : {}
                  )}
                />
              ))}
            </div>
          )}

          <div ref={scrollRef}>
            {/* ── Loading ── */}
            {rd.isLoading && (
              <ThinkingIndicator
                message={
                  rd.phase === 'IDLE'
                    ? 'Starting your interview...'
                    : rd.pastExchanges.length === 0
                      ? 'Preparing your first question...'
                      : 'Thinking...'
                }
              />
            )}

            {/* ── Scripted question card ── */}
            {!rd.isLoading && currentScriptedQ && (
              <div style={{ padding: 32, background: 'var(--pipe-surface)', border: '1px solid var(--pipe-border-light)', borderRadius: 16 }}>
                {/* JD import — only on first question */}
                {scriptedIdx === 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <button
                      onClick={() => setIsJDModalOpen(true)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'transparent', border: '1px solid var(--pipe-border)', color: 'var(--pipe-text-muted)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', fontFamily: '"Space Mono", monospace', cursor: 'pointer', borderRadius: 4 }}
                    >
                      <FileUp size={10} />
                      IMPORT_FROM_JD
                    </button>
                  </div>
                )}

                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--pipe-text)', lineHeight: 1.4, marginBottom: 28, letterSpacing: '-0.01em' }}>
                  {currentScriptedQ.text}
                </div>

                <div
                  style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
                  onKeyDown={(e) => {
                    if (currentScriptedQ.inputType === 'tags') return;
                    if (e.key === 'Enter' && (scriptedAnswer.trim() || currentScriptedQ.optional)) {
                      e.preventDefault();
                      handleScriptedSubmit();
                    }
                  }}
                >
                  <div style={{ flex: 1 }}>
                    {currentScriptedQ.inputType === 'tags' ? (
                      <TagsInput
                        value={scriptedAnswer ? scriptedAnswer.split('|||') : []}
                        onChange={(tags) => setScriptedAnswer(tags.join('|||'))}
                        placeholder={currentScriptedQ.placeholder}
                      />
                    ) : (
                      <TextInput
                        value={scriptedAnswer}
                        onChange={setScriptedAnswer}
                        placeholder={currentScriptedQ.placeholder}
                      />
                    )}
                    <div style={{ marginTop: 10, fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
                      {currentScriptedQ.inputType === 'tags' ? 'SEND WHEN DONE' : `ENTER TO SEND${currentScriptedQ.optional ? ' · or SKIP' : ''}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={handleScriptedSubmit}
                      disabled={!scriptedAnswer.trim() && !currentScriptedQ.optional}
                      style={{
                        padding: '10px 20px',
                        background: (scriptedAnswer.trim() || currentScriptedQ.optional) ? 'rgba(74, 222, 128, 0.08)' : 'transparent',
                        border: `1px solid ${(scriptedAnswer.trim() || currentScriptedQ.optional) ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border-light)'}`,
                        color: (scriptedAnswer.trim() || currentScriptedQ.optional) ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-dim)',
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', fontFamily: '"Space Mono", monospace',
                        cursor: (scriptedAnswer.trim() || currentScriptedQ.optional) ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      <ArrowRight size={12} /> SEND
                    </button>
                    {currentScriptedQ.optional && (
                      <button
                        onClick={handleScriptedSkip}
                        style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--pipe-border-light)', color: 'var(--pipe-text-dim)', fontSize: 9, letterSpacing: '0.12em', fontFamily: '"Space Mono", monospace', cursor: 'pointer' }}
                      >
                        SKIP
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── AI question card ── */}
            {!rd.isLoading && rd.currentQuestion && (
              <div style={{ padding: 32, background: 'var(--pipe-surface)', border: '1px solid var(--pipe-border-light)', borderRadius: 16 }}>
                {rd.acknowledgment && (
                  <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', lineHeight: 1.7, marginBottom: 12, fontFamily: '"Space Mono", monospace' }}>
                    {rd.acknowledgment}
                  </div>
                )}
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--pipe-text)', lineHeight: 1.4, marginBottom: 28, letterSpacing: '-0.01em' }}>
                  {rd.currentQuestion.text}
                </div>

                {/* Voice button */}
                {needsVoice && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 24 }}>
                      <button
                        onClick={isRecording ? stopRecording : startRecording}
                        disabled={isTranscribing}
                        style={{
                          width: 80, height: 80, borderRadius: '50%',
                          background: isRecording ? 'rgba(248, 113, 113, 0.15)' : 'var(--pipe-surface)',
                          border: isRecording ? '2px solid rgba(248, 113, 113, 0.4)' : '2px solid var(--pipe-text)',
                          color: isRecording ? 'rgba(248, 113, 113, 0.9)' : 'var(--pipe-text-dim)',
                          cursor: isTranscribing ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexDirection: 'column', gap: 4, transition: 'all 0.2s ease',
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
                      <span style={{ fontSize: 8, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                        {isRecording ? 'TAP_TO_STOP' : isTranscribing ? 'TRANSCRIBING...' : 'TAP_TO_SPEAK'}
                      </span>
                      {transcribeError && (
                        <span style={{ fontSize: 10, color: '#f87171', fontFamily: '"Space Mono", monospace', textAlign: 'center', marginTop: 4 }}>
                          {transcribeError}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                      <div style={{ flex: 1, height: 1, background: 'var(--pipe-border-light)' }} />
                      <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>OR_TYPE</span>
                      <div style={{ flex: 1, height: 1, background: 'var(--pipe-border-light)' }} />
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <QuestionInput
                      question={rd.currentQuestion}
                      value={aiAnswer}
                      onChange={setAiAnswer}
                      onSubmit={handleAIRespond}
                    />
                  </div>
                  <button
                    onClick={handleAIRespond}
                    disabled={!aiAnswer.trim() || rd.isLoading}
                    style={{
                      padding: '10px 20px', flexShrink: 0,
                      background: aiAnswer.trim() && !rd.isLoading ? 'rgba(74, 222, 128, 0.08)' : 'transparent',
                      border: `1px solid ${aiAnswer.trim() && !rd.isLoading ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border-light)'}`,
                      color: aiAnswer.trim() && !rd.isLoading ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-dim)',
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', fontFamily: '"Space Mono", monospace',
                      cursor: aiAnswer.trim() && !rd.isLoading ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {rd.isLoading
                      ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      : <ArrowRight size={12} />
                    }
                    SEND
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Synthesis */}
      {rd.phase === 'COMPLETE' && (rd.persona || rd.jobDescription) && (
        <SynthesisPhase
          persona={rd.persona}
          jobDescription={rd.jobDescription}
          progress={rd.progress}
          onCreatePipeline={handleCreatePipeline}
          isCreating={isCreating}
        />
      )}

      {/* JD import modal */}
      {isJDModalOpen && (
        <JobDescriptionImportModal
          onParsed={handleJDImport}
          onClose={() => setIsJDModalOpen(false)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
