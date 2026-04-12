/**
 * RoleDiscoveryPage — unified conversation-first role intake (ADR-027/028).
 *
 * Single continuous conversation from first question through synthesis.
 * Scripted questions collect baseline data (title, company, URL, salary,
 * tech stack) using the same card aesthetic as the AI interview — no form
 * grid. Once all scripted questions are answered, `initConfig` is set and
 * `<AIChat>` initializes its conversation via the roleDiscoveryAdapter.
 *
 * Flow:
 *   Scripted Q1–Q5 (role, company, URL, salary, tech stack)
 *   → initConfig set → <AIChat> initializes
 *   → Calibration Q (participant role)
 *   → AI interview (N turns)
 *   → Synthesis (persona + JD) — rendered in page via rd.phase === 'COMPLETE'
 *   → CREATE PIPELINE
 *
 * Route: /pipeline/new
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { TextInput, TagsInput } from '../components/ui/form';
import { JobDescriptionImportModal } from '../components/RoleDiscovery/JobDescriptionImportModal';
import { AIChat } from '../components/AIChat/AIChat';
import { DomainBars } from '../components/AIChat';
import { useRoleDiscovery } from '../hooks/useRoleDiscovery';
import { usePipelineCreate } from '../hooks/usePipelineCreate';
import { useApiClient } from '../hooks/useApiClient';
import {
  Loader2, ArrowRight, Check, MessageSquare,
  FileUp, Sparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type {
  RoleContextBaseline, RoleContextProgress,
  ParseJDResponse, CandidatePersona, GeneratedJobDescription,
} from '../lib/api/types';
import type { PastExchange } from '../hooks/useRoleDiscovery';
import type { AdapterConfig } from '../components/AIChat/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BUDGET = 15;

interface ScriptedQuestion {
  id: string;
  text: string;
  optional: boolean;
  placeholder: string;
  inputType?: 'text' | 'tags' | 'choice';
  options?: string[];
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
  {
    id: 'sq-mode',
    text: "How do you want to run this interview?",
    optional: false,
    placeholder: '',
    inputType: 'choice',
    options: ['Voice', 'Text'],
  },
];

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

// ─── StepIndicator ────────────────────────────────────────────────────────────

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

  // ── Scripted phase state ──
  const [scriptedIdx, setScriptedIdx] = useState(0);
  const [scriptedAnswer, setScriptedAnswer] = useState('');
  const [scriptedAnswers, setScriptedAnswers] = useState<Record<string, string>>({});
  const [scriptedExchanges, setScriptedExchanges] = useState<PastExchange[]>([]);
  const [isJDModalOpen, setIsJDModalOpen] = useState(false);

  // ── initConfig: null until scripted questions complete ──
  // Setting this triggers <AIChat> to call adapter.initialize() and start the session.
  const [initConfig, setInitConfig] = useState<AdapterConfig | null>(null);
  // ── Whether to start in live voice mode (set by sq-mode choice) ──
  const [defaultLiveMode, setDefaultLiveMode] = useState(false);

  // ── Build AdapterConfig from scripted answers and hand off to AIChat ──
  const fireCreateAndStart = useCallback((answers: Record<string, string>, liveMode = false): void => {
    const techTags = (answers['sq-stack'] ?? '').split('|||').filter(Boolean);
    const baseline: RoleContextBaseline = {
      title: answers['sq-title']?.trim() || '',
      ...(answers['sq-company']?.trim() ? { companyName: answers['sq-company'].trim() } : {}),
      ...(answers['sq-url']?.trim() ? { companyUrl: answers['sq-url'].trim() } : {}),
      ...(answers['sq-salary']?.trim() ? { salaryRange: answers['sq-salary'].trim() } : {}),
      ...(techTags.length > 0 ? { techStack: techTags } : {}),
    };
    setDefaultLiveMode(liveMode);
    setInitConfig({ baseline: baseline as unknown as Record<string, unknown>, questionBudget: DEFAULT_BUDGET });
  }, []);

  // ── Choice question select (sq-mode: Voice / Text) ──
  const handleChoiceSelect = useCallback((choice: string): void => {
    const q = SCRIPTED[scriptedIdx];
    if (!q) return;

    setScriptedExchanges((prev) => [
      ...prev,
      { questionId: q.id, acknowledgment: '', questionText: q.text, answer: choice },
    ]);

    const newAnswers = { ...scriptedAnswers, [q.id]: choice };
    setScriptedAnswers(newAnswers);
    setScriptedAnswer('');

    if (scriptedIdx < SCRIPTED.length - 1) {
      setScriptedIdx(scriptedIdx + 1);
    } else {
      fireCreateAndStart(newAnswers, choice === 'Voice');
    }
  }, [scriptedIdx, scriptedAnswers, fireCreateAndStart]);

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
    setInitConfig({ baseline: baseline as unknown as Record<string, unknown>, questionBudget: DEFAULT_BUDGET });
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
    initConfig !== null ? 'interview' :
    'role';

  const isInScriptedPhase = initConfig === null;
  const currentScriptedQ = isInScriptedPhase ? SCRIPTED[scriptedIdx] ?? null : null;

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

      {/* ── Scripted phase — shown until initConfig is set ── */}
      {isInScriptedPhase && (
        <div>
          {/* Past scripted exchanges */}
          {scriptedExchanges.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              {scriptedExchanges.map((ex, i) => (
                <div key={ex.questionId} style={{
                  padding: '16px 24px',
                  background: 'transparent',
                  borderLeft: '2px solid var(--pipe-border)',
                  marginBottom: 12,
                  opacity: 0.6,
                }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>
                    Q{i + 1} — {ex.questionText}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace' }}>
                    {ex.answer}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Current scripted question card */}
          {currentScriptedQ && (
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

              {/* Choice input — renders two big option buttons, no text field */}
              {currentScriptedQ.inputType === 'choice' ? (
                <div style={{ display: 'flex', gap: 12 }}>
                  {(currentScriptedQ.options ?? []).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => handleChoiceSelect(opt)}
                      style={{
                        flex: 1,
                        padding: '20px 24px',
                        background: 'var(--pipe-surface)',
                        border: '1px solid var(--pipe-border-light)',
                        color: 'var(--pipe-text)',
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        fontFamily: '"Space Mono", monospace',
                        cursor: 'pointer',
                        borderRadius: 8,
                        transition: 'border-color 0.15s ease, background 0.15s ease',
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(74, 222, 128, 0.4)';
                        e.currentTarget.style.background = 'rgba(74, 222, 128, 0.04)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.borderColor = 'var(--pipe-border-light)';
                        e.currentTarget.style.background = 'var(--pipe-surface)';
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : (
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
              )}
            </div>
          )}
        </div>
      )}

      {/* ── AI phase — shown once scripted questions complete, until synthesis ── */}
      {initConfig !== null && rd.phase !== 'COMPLETE' && (
        <AIChat
          adapter={rd.adapter}
          initConfig={initConfig}
          defaultLiveMode={defaultLiveMode}
          enableVoice
          enableLiveVoice
          showDomainBars
          onComplete={() => {
            // Phase transition is tracked in rd (useRoleDiscovery → useConversation).
            // The SynthesisPhase block below re-renders when rd.phase === 'COMPLETE'.
          }}
        />
      )}

      {/* ── Synthesis — shown when AI interview is complete ── */}
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
