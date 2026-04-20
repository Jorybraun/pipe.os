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

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { TextInput, TagsInput } from '../components/ui/form';
import { JobDescriptionImportModal } from '../components/RoleDiscovery/JobDescriptionImportModal';
import { MatchConfigWizard, type MatchConfigOutput } from '../components/RoleDiscovery/MatchConfigWizard';
import { AIChat } from '../components/AIChat/AIChat';
import { DomainBars } from '../components/AIChat';
import { EQVisualizer } from '../components/AIChat/EQVisualizer';
import { useTTS } from '../hooks/useTTS';
import { useRoleDiscovery } from '../hooks/useRoleDiscovery';
import { usePipelineCreate } from '../hooks/usePipelineCreate';
import { useApiClient } from '../hooks/useApiClient';
import { FEATURE_FLAGS } from '../config/featureFlags';
import { useRoleDiscoveryDraft, type RoleDiscoveryDraft } from '../hooks/useRoleDiscoveryDraft';
import { useScriptedPhase, buildBaseline, SCRIPTED, type RolePreset } from '../hooks/useScriptedPhase';
import {
  Loader2, ArrowRight, ArrowLeft, Check, MessageSquare,
  FileUp, Sparkles, RotateCcw, RotateCw, Volume2, VolumeX,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type {
  RoleContextBaseline, RoleContextProgress, RoleContextFullState,
  ParseJDResponse, CandidatePersona, GeneratedJobDescription,
} from '../lib/api/types';
import type { AdapterConfig } from '../components/AIChat/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BUDGET = 15;

// ─── Quick-start presets ──────────────────────────────────────────────────────

const ROLE_PRESETS: RolePreset[] = [
  {
    label: 'Sr. Frontend Eng',
    answers: {
      'sq-title': 'Senior Frontend Engineer',
      'sq-company': 'Acme Corp',
      'sq-url': 'https://acme.com',
      'sq-salary': '$150K–$180K + equity',
      'sq-stack': 'React|||TypeScript|||Next.js|||CSS',
    },
  },
  {
    label: 'Sr. Backend Eng',
    answers: {
      'sq-title': 'Senior Backend Engineer',
      'sq-company': 'Acme Corp',
      'sq-url': 'https://acme.com',
      'sq-salary': '$150K–$180K + equity',
      'sq-stack': 'Node.js|||TypeScript|||PostgreSQL|||Redis',
    },
  },
  {
    label: 'Head of Product',
    answers: {
      'sq-title': 'Head of Product',
      'sq-company': 'Acme Corp',
      'sq-url': 'https://acme.com',
      'sq-salary': '$180K–$220K + equity',
      'sq-stack': '',
    },
  },
  {
    label: 'Staff Eng',
    answers: {
      'sq-title': 'Staff Engineer',
      'sq-company': 'Acme Corp',
      'sq-url': 'https://acme.com',
      'sq-salary': '$200K–$240K + equity',
      'sq-stack': 'TypeScript|||Go|||Kubernetes|||Terraform',
    },
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

function StepIndicator({
  active,
  onStepClick,
}: {
  active: StepId;
  onStepClick?: (id: StepId) => void;
}): JSX.Element {
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
        // Only already-reached steps (done) are clickable — forward-nav via the
        // normal flow (SEND / CREATE_PIPELINE), back-nav via the indicator.
        const isClickable = isDone && !!onStepClick;
        const nodeColor = isCurrent ? 'var(--pipe-text)' : isDone ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-dim)';
        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center' }}>
            <div
              onClick={isClickable ? () => onStepClick(step.id) : undefined}
              role={isClickable ? 'button' : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onKeyDown={
                isClickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onStepClick(step.id);
                      }
                    }
                  : undefined
              }
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 14px', borderRadius: 6,
                background: isCurrent ? 'var(--pipe-surface-hover)' : isDone ? 'rgba(74, 222, 128, 0.06)' : 'transparent',
                border: isCurrent ? '1px solid var(--pipe-text-dim)' : isDone ? '1px solid rgba(74, 222, 128, 0.2)' : '1px solid transparent',
                opacity: isCurrent ? 1 : isDone ? 1 : 0.35,
                cursor: isClickable ? 'pointer' : 'default',
                transition: 'background 0.15s ease, border-color 0.15s ease',
              }}
              onMouseOver={
                isClickable
                  ? (e) => {
                      e.currentTarget.style.background = 'rgba(74, 222, 128, 0.14)';
                      e.currentTarget.style.borderColor = 'rgba(74, 222, 128, 0.45)';
                    }
                  : undefined
              }
              onMouseOut={
                isClickable
                  ? (e) => {
                      e.currentTarget.style.background = 'rgba(74, 222, 128, 0.06)';
                      e.currentTarget.style.borderColor = 'rgba(74, 222, 128, 0.2)';
                    }
                  : undefined
              }
            >
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
  const draft = useRoleDiscoveryDraft();

  const [isJDModalOpen, setIsJDModalOpen] = useState(false);

  // ── initConfig: null until scripted questions complete ──
  // Setting this triggers <AIChat> to call adapter.initialize() and start the session.
  const [initConfig, setInitConfig] = useState<AdapterConfig | null>(null);
  // ── Whether to start in live voice mode (set by sq-mode choice) ──
  const [defaultLiveMode, setDefaultLiveMode] = useState(false);
  // ── Resume prompt — shown when a completed draft is found on mount ──
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const pendingDraftRef = useRef<RoleDiscoveryDraft | null>(null);

  // ── Scripted-phase TTS (must be declared before the hook that calls cancel) ──
  // Default OFF: the scripted questions are short and readable; TTS defaults on
  // felt intrusive. Users can opt in via the speaker toggle on the question card.
  const [scriptedVoiceOn, setScriptedVoiceOn] = useState(false);
  const scriptedTTS = useTTS(scriptedVoiceOn);
  const handleScriptedVoiceToggle = useCallback((): void => {
    setScriptedVoiceOn((prev) => {
      if (prev) scriptedTTS.cancel();
      return !prev;
    });
  }, [scriptedTTS]);

  // ── Clears page-owned interview state — invoked by the hook on reset/startOver ──
  const clearInterview = useCallback((): void => {
    setInitConfig(null);
    setDefaultLiveMode(false);
  }, []);

  // ── Hook callback: fire the AI interview with the finalised answers ──
  const handleFire = useCallback((answers: Record<string, string>, liveMode: boolean): void => {
    setDefaultLiveMode(liveMode);
    setInitConfig({ baseline: buildBaseline(answers) as unknown as Record<string, unknown>, questionBudget: DEFAULT_BUDGET });
  }, []);

  // ── Hook callback: JD import delivered a baseline — start the interview ──
  const handleJdImport = useCallback((baseline: RoleContextBaseline): void => {
    setDefaultLiveMode(false);
    setInitConfig({ baseline: baseline as unknown as Record<string, unknown>, questionBudget: DEFAULT_BUDGET });
  }, []);

  // ── Hook callback: completed draft found on mount — show resume prompt ──
  const handleResumeDraftFound = useCallback((savedDraft: RoleDiscoveryDraft): void => {
    pendingDraftRef.current = savedDraft;
    setShowResumePrompt(true);
  }, []);

  const scripted = useScriptedPhase({
    onFire: handleFire,
    onJdImport: handleJdImport,
    ttsCancel: scriptedTTS.cancel,
    clearInterview,
    onResumeDraftFound: handleResumeDraftFound,
  });

  // ── Persist contextId + participantId to draft when they first appear ────────

  useEffect(() => {
    if (!rd.contextId) return;
    const current = draft.load();
    if (!current) return;
    draft.save({ ...current, contextId: rd.contextId, ...(rd.participantId ? { participantId: rd.participantId } : {}) });
  }, [rd.contextId, rd.participantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start over — clears draft and resets to Q1 ───────────────────────────────

  const handleStartOver = useCallback((): void => {
    scripted.startOver();
    setShowResumePrompt(false);
    pendingDraftRef.current = null;
  }, [scripted]);

  // ── Resume session — hydrate from server if COMPLETE, else restart interview ─

  const handleResumeSession = useCallback(async (): Promise<void> => {
    const saved = pendingDraftRef.current;
    if (!saved) return;
    setShowResumePrompt(false);

    const baseline = buildBaseline(saved.scriptedAnswers);

    // If we have a contextId, try to hydrate from the server
    if (saved.contextId) {
      try {
        const ctx = await api.get<RoleContextFullState>(`/api/v1/role-contexts/${saved.contextId}`);

        if (ctx.persona || ctx.jobDescription) {
          // Context is COMPLETE — hydrate directly to synthesis, skip the interview
          rd.hydrateComplete({ id: ctx.id, baseline: ctx.baseline ?? baseline, persona: ctx.persona, jobDescription: ctx.jobDescription });
          setDefaultLiveMode(false);
          setInitConfig({ baseline: baseline as unknown as Record<string, unknown>, questionBudget: DEFAULT_BUDGET });
          return;
        }

        // Context is mid-interview — restore exchange history and current question
        const creator = ctx.participants?.find((p) => p.isCreator) ?? ctx.participants?.[0];
        if (creator && (creator.status === 'INTERVIEWING' || creator.status === 'CALIBRATING') && creator.exchanges.length > 0) {
          rd.hydrateInterviewing({
            id: ctx.id,
            participantId: saved.participantId ?? creator.id,
            participantRole: creator.participantRole,
            baseline: ctx.baseline ?? baseline,
            exchanges: creator.exchanges,
            questionsAsked: creator.questionsAsked,
            questionBudget: creator.questionBudget,
            knowledgeState: ctx.knowledgeState,
          });
          setDefaultLiveMode(saved.defaultLiveMode);
          setInitConfig({ baseline: baseline as unknown as Record<string, unknown>, questionBudget: creator.questionBudget });
          return;
        }
      } catch {
        // Context fetch failed — fall through to restart
      }
    }

    // No resumable context — restart the AI interview from the saved baseline
    setDefaultLiveMode(saved.defaultLiveMode);
    setInitConfig({ baseline: baseline as unknown as Record<string, unknown>, questionBudget: DEFAULT_BUDGET });
  }, [api, rd]);

  // ── JD import modal — closes the modal then hands parsed payload to the hook ──
  const handleJDImport = useCallback((parsed: ParseJDResponse['parsed']): void => {
    setIsJDModalOpen(false);
    scripted.jdImport(parsed);
  }, [scripted]);

  // ── Live session ended — return to Voice/Text choice without losing answers ──
  const handleLiveEnd = scripted.resetToMode;

  // ── Step indicator click — back-nav between phases ──
  // Only past steps (isDone) are clickable; the indicator hands us the target.
  // ROLE back-nav clears interview + synthesis state but leaves the scripted
  // draft intact so the user returns to their answers. INTERVIEW back-nav from
  // REVIEW drops the synthesis and re-fires the interview so the user lands
  // on a fresh first question.
  const handleStepClick = useCallback((target: StepId): void => {
    if (target === 'role') {
      setInitConfig(null);
      setDefaultLiveMode(false);
      if (rd.phase === 'COMPLETE') rd.reset();
      return;
    }
    if (target === 'interview' && rd.phase === 'COMPLETE') {
      rd.reset();
      // Re-fire using the current scripted answers so AIChat re-initializes
      // with a new initConfig reference (triggers adapter.initialize()).
      handleFire(scripted.answers, defaultLiveMode);
    }
  }, [rd, scripted.answers, defaultLiveMode, handleFire]);

  // ── Pipeline creation ──
  // ADR-039: open the MatchConfigWizard before any pipeline write. Wizard
  // completion calls /api/v1/pipelines/auto-build which provisions the
  // pipeline + 2 stations atomically. Falls back to legacy blank-pipeline
  // creation if the role context id is missing (no role to match against).
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isAutoBuilding, setIsAutoBuilding] = useState(false);
  const [autoBuildError, setAutoBuildError] = useState<string | null>(null);
  const [wizardDraft, setWizardDraft] = useState<Partial<MatchConfigOutput>>(
    () => draft.load()?.wizardDraft ?? {},
  );

  const handleWizardDraftChange = useCallback((d: Partial<MatchConfigOutput>): void => {
    setWizardDraft(d);
    const current = draft.load();
    if (current) draft.save({ ...current, wizardDraft: d });
  }, [draft]);

  const handleCreatePipeline = (): void => {
    if (!rd.contextId) {
      void handleLegacyCreatePipeline();
      return;
    }
    setAutoBuildError(null);
    setIsWizardOpen(true);
  };

  const handleLegacyCreatePipeline = async (): Promise<void> => {
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
      draft.clear();
      navigate(`/pipeline/${pipelineId}`);
    } catch {
      // surfaced via pipeline hook
    }
  };

  const handleWizardComplete = async (output: MatchConfigOutput): Promise<void> => {
    if (!rd.contextId) return;
    setIsAutoBuilding(true);
    setAutoBuildError(null);
    try {
      const res = await api.post<{
        pipeline: { id: string };
        warnings?: Array<{ code: string; severity: 'warn'; message: string }>;
      }>(
        '/api/v1/pipelines/auto-build',
        {
          role_context_id: rd.contextId,
          pipeline_title: rd.baseline?.title,
          match_config: output,
        },
      );
      draft.clear();
      setWizardDraft({});
      setIsWizardOpen(false);
      navigate(`/pipeline/${res.pipeline.id}`, {
        state: res.warnings && res.warnings.length > 0
          ? { autoBuildWarnings: res.warnings }
          : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Auto-build failed';
      setAutoBuildError(message);
    } finally {
      setIsAutoBuilding(false);
    }
  };

  // ── Computed ──
  const currentStep: StepId =
    rd.phase === 'COMPLETE' ? 'review' :
    initConfig !== null ? 'interview' :
    'role';

  const isInScriptedPhase = initConfig === null;
  const currentScriptedQ = isInScriptedPhase ? scripted.currentQuestion : null;

  // Speak each scripted question — covers radio/select intake questions too.
  useEffect(() => {
    if (!currentScriptedQ || !scriptedVoiceOn) return;
    scriptedTTS.speak(currentScriptedQ.text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScriptedQ?.id, scriptedVoiceOn]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {isInScriptedPhase && scripted.hasProgress && (
            <button
              onClick={handleStartOver}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'transparent', border: '1px solid var(--pipe-border)', color: 'var(--pipe-text-dim)', fontSize: 9, letterSpacing: '0.12em', fontFamily: '"Space Mono", monospace', cursor: 'pointer', borderRadius: 4 }}
            >
              <RotateCcw size={9} />
              START OVER
            </button>
          )}
          <StepIndicator active={currentStep} onStepClick={handleStepClick} />
        </div>
      </div>

      {/* ── Resume prompt — ask user to resume or start fresh ──
          Suppress once the interview/review is under way so a stale
          `showResumePrompt` flag can't re-appear over the active UI. */}
      {showResumePrompt && isInScriptedPhase && rd.phase !== 'COMPLETE' && (
        <div style={{ padding: 32, background: 'var(--pipe-surface)', border: '1px solid rgba(139, 92, 246, 0.25)', borderRadius: 16 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(139, 92, 246, 0.6)', fontFamily: '"Space Mono", monospace', marginBottom: 12 }}>
            PREVIOUS_SESSION_FOUND
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pipe-text)', marginBottom: 8 }}>
            You have an unfinished role discovery.
          </div>
          <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', lineHeight: 1.6, marginBottom: 24 }}>
            {pendingDraftRef.current?.scriptedAnswers['sq-title'] ? `"${pendingDraftRef.current.scriptedAnswers['sq-title']}"` : 'Role details saved.'}
            {' '}Want to pick up where you left off?
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => { handleResumeSession().catch(() => {}); }}
              style={{ padding: '10px 24px', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.35)', color: 'rgba(216, 180, 254, 0.9)', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', fontFamily: '"Space Mono", monospace', cursor: 'pointer' }}
            >
              RESUME_SESSION
            </button>
            <button
              onClick={handleStartOver}
              style={{ padding: '10px 24px', background: 'transparent', border: '1px solid var(--pipe-border-light)', color: 'var(--pipe-text-dim)', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', fontFamily: '"Space Mono", monospace', cursor: 'pointer' }}
            >
              START_NEW
            </button>
          </div>
        </div>
      )}

      {/* ── Scripted phase — linear flow, shown until every question has been captured ── */}
      {isInScriptedPhase && !showResumePrompt && !scripted.isComplete && (
        <div>
          {/* Past scripted exchanges */}
          {scripted.exchanges.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              {scripted.exchanges.map((ex, i) => (
                <div key={`${ex.questionId}-${i}`} style={{
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

              {/* Top toolbar — JD import + quick-start presets (first question only) */}
              {scripted.idx === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setIsJDModalOpen(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'transparent', border: '1px solid var(--pipe-border)', color: 'var(--pipe-text-muted)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', fontFamily: '"Space Mono", monospace', cursor: 'pointer', borderRadius: 4 }}
                  >
                    <FileUp size={10} />
                    IMPORT_FROM_JD
                  </button>

                  <div style={{ width: 1, height: 20, background: 'var(--pipe-border)', flexShrink: 0 }} />

                  <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em', flexShrink: 0 }}>
                    QUICK START:
                  </span>

                  {ROLE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => scripted.presetSelect(preset)}
                      style={{ padding: '6px 12px', background: 'rgba(139, 92, 246, 0.06)', border: '1px solid rgba(139, 92, 246, 0.25)', color: 'rgba(216, 180, 254, 0.8)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', fontFamily: '"Space Mono", monospace', cursor: 'pointer', borderRadius: 4, whiteSpace: 'nowrap' }}
                      onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.14)'; e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.45)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.06)'; e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.25)'; }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 28 }}>
                <div style={{ flex: 1, fontSize: 18, fontWeight: 700, color: 'var(--pipe-text)', lineHeight: 1.4, letterSpacing: '-0.01em' }}>
                  {currentScriptedQ.text}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginTop: 2 }}>
                  {scriptedVoiceOn && (
                    <button
                      onClick={() => scriptedTTS.speak(currentScriptedQ.text)}
                      title={scriptedTTS.isPlaying ? 'AI speaking…' : 'Replay question'}
                      disabled={scriptedTTS.isPlaying}
                      style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--pipe-border-light)', color: 'var(--pipe-text-dim)', cursor: scriptedTTS.isPlaying ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, height: 28, borderRadius: 4 }}
                    >
                      {scriptedTTS.isPlaying ? <EQVisualizer analyserRef={scriptedTTS.analyserRef} maxHeight={18} /> : <RotateCw size={13} />}
                    </button>
                  )}
                  <button
                    onClick={handleScriptedVoiceToggle}
                    title={scriptedVoiceOn ? 'Mute voice' : 'Unmute voice'}
                    style={{ padding: '6px 10px', background: scriptedVoiceOn ? 'transparent' : 'rgba(248,113,113,0.08)', border: `1px solid ${scriptedVoiceOn ? 'var(--pipe-border-light)' : 'rgba(248,113,113,0.3)'}`, color: scriptedVoiceOn ? 'var(--pipe-text-dim)' : 'rgba(248,113,113,0.85)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 28, borderRadius: 4 }}
                  >
                    {scriptedVoiceOn ? <Volume2 size={13} /> : <VolumeX size={13} />}
                  </button>
                </div>
              </div>

              {/* Choice input — renders two big option buttons, no text field */}
              {currentScriptedQ.inputType === 'choice' ? (
                <div style={{ display: 'flex', gap: 12 }}>
                  {(currentScriptedQ.options ?? []).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => scripted.choiceSelect(opt)}
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
                    if (e.key === 'Enter' && (scripted.answer.trim() || currentScriptedQ.optional)) {
                      e.preventDefault();
                      scripted.submit();
                    }
                  }}
                >
                  <div style={{ flex: 1 }}>
                    {currentScriptedQ.inputType === 'tags' ? (
                      <TagsInput
                        value={scripted.answer ? scripted.answer.split('|||') : []}
                        onChange={(tags) => scripted.setAnswer(tags.join('|||'))}
                        placeholder={currentScriptedQ.placeholder}
                      />
                    ) : (
                      <TextInput
                        value={scripted.answer}
                        onChange={scripted.setAnswer}
                        placeholder={currentScriptedQ.placeholder}
                      />
                    )}
                    <div style={{ marginTop: 10, fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>
                      {currentScriptedQ.inputType === 'tags' ? 'SEND WHEN DONE' : `ENTER TO SEND${currentScriptedQ.optional ? ' · or SKIP' : ''}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={scripted.submit}
                      disabled={!scripted.answer.trim() && !currentScriptedQ.optional}
                      style={{
                        padding: '10px 20px',
                        background: (scripted.answer.trim() || currentScriptedQ.optional) ? 'rgba(74, 222, 128, 0.08)' : 'transparent',
                        border: `1px solid ${(scripted.answer.trim() || currentScriptedQ.optional) ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border-light)'}`,
                        color: (scripted.answer.trim() || currentScriptedQ.optional) ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-dim)',
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', fontFamily: '"Space Mono", monospace',
                        cursor: (scripted.answer.trim() || currentScriptedQ.optional) ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      <ArrowRight size={12} /> SEND
                    </button>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {scripted.idx > 0 && (
                        <button
                          onClick={scripted.back}
                          style={{ flex: 1, padding: '6px 10px', background: 'transparent', border: '1px solid var(--pipe-border-light)', color: 'var(--pipe-text-dim)', fontSize: 9, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                        >
                          <ArrowLeft size={9} /> BACK
                        </button>
                      )}
                      {currentScriptedQ.optional && (
                        <button
                          onClick={scripted.skip}
                          style={{ flex: 1, padding: '6px 10px', background: 'transparent', border: '1px solid var(--pipe-border-light)', color: 'var(--pipe-text-dim)', fontSize: 9, letterSpacing: '0.12em', fontFamily: '"Space Mono", monospace', cursor: 'pointer' }}
                        >
                          SKIP
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Scripted phase — review & edit, shown when every question is answered ── */}
      {isInScriptedPhase && !showResumePrompt && scripted.isComplete && (
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 20 }}>
            ROLE_SUMMARY · EDIT OR CONTINUE
          </div>

          {SCRIPTED.map((q, i) => {
            const raw = scripted.answers[q.id] ?? '';
            return (
              <div key={q.id} style={{
                marginBottom: 14,
                padding: 20,
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border-light)',
                borderRadius: 12,
              }}>
                <div style={{
                  fontSize: 10, letterSpacing: '0.15em',
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  marginBottom: 10,
                }}>
                  Q{i + 1} — {q.text}
                </div>
                {q.inputType === 'tags' ? (
                  <TagsInput
                    value={raw ? raw.split('|||').filter(Boolean) : []}
                    onChange={(tags) => scripted.editAnswer(q.id, tags.join('|||'))}
                    placeholder={q.placeholder}
                  />
                ) : q.inputType === 'choice' ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(q.options ?? []).map((opt) => {
                      const selected = raw === opt;
                      return (
                        <button
                          key={opt}
                          onClick={() => scripted.editAnswer(q.id, opt)}
                          style={{
                            flex: 1, padding: '12px 18px',
                            background: selected ? 'rgba(74, 222, 128, 0.08)' : 'var(--pipe-surface)',
                            border: `1px solid ${selected ? 'rgba(74, 222, 128, 0.4)' : 'var(--pipe-border-light)'}`,
                            color: selected ? 'rgba(74, 222, 128, 0.95)' : 'var(--pipe-text)',
                            fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
                            fontFamily: '"Space Mono", monospace',
                            cursor: 'pointer', borderRadius: 8,
                          }}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <TextInput
                    value={raw}
                    onChange={(v) => scripted.editAnswer(q.id, v)}
                    placeholder={q.placeholder}
                  />
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
            <button
              onClick={() => handleFire(scripted.answers, defaultLiveMode)}
              style={{
                padding: '14px 28px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.16))',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                color: 'var(--pipe-text)',
                fontSize: 11, fontWeight: 700, letterSpacing: '0.15em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
                borderRadius: 6,
              }}
            >
              CONTINUE TO INTERVIEW <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── AI phase — shown once scripted questions complete, until synthesis ── */}
      {initConfig !== null && rd.phase !== 'COMPLETE' && (
        <AIChat
          conv={rd.conv}
          initConfig={initConfig}
          defaultLiveMode={defaultLiveMode}
          enableVoice
          enableLiveVoice={FEATURE_FLAGS.FEATURE_FLAG_LIVE_VOICE}
          enableTTS
          greeting="Hi, I'm Pipe's interview assistant. I'll ask you a few questions to help define the role you're building for. Let's get started."
          showDomainBars
          onLiveEnd={handleLiveEnd}
        />
      )}

      {/* ── Synthesis — shown when AI interview is complete ──
          Rendered even when persona/JD are both null so the user always has
          a path forward (CREATE_PIPELINE). SynthesisPhase handles empty
          sub-sections gracefully. */}
      {rd.phase === 'COMPLETE' && (
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

      {/* Match-config wizard (ADR-039 v1) */}
      {isWizardOpen && (
        <div
          onClick={() => !isAutoBuilding && setIsWizardOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 720,
              background: '#13131a',
              border: '1px solid var(--pipe-border)',
              borderRadius: 12,
              padding: 32,
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            data-testid="match-config-wizard-modal"
          >
            <MatchConfigWizard
              candidateSkills={rd.persona?.mustHaveSkills ?? []}
              initial={wizardDraft}
              onChange={handleWizardDraftChange}
              onComplete={(output) => { void handleWizardComplete(output); }}
              onCancel={() => !isAutoBuilding && setIsWizardOpen(false)}
            />
            {(isAutoBuilding || autoBuildError) && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: '"Space Mono", monospace',
                  background: autoBuildError ? 'rgba(248, 113, 113, 0.08)' : 'rgba(96, 165, 250, 0.08)',
                  border: autoBuildError ? '1px solid rgba(248, 113, 113, 0.3)' : '1px solid rgba(96, 165, 250, 0.3)',
                  color: autoBuildError ? 'rgba(248, 113, 113, 0.9)' : 'rgba(96, 165, 250, 0.9)',
                }}
                data-testid="auto-build-status"
              >
                {autoBuildError ?? 'Building pipeline + matching repo…'}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
