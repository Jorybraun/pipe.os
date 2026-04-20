/**
 * PipelineInsightsPanel — index route under /pipeline/:id.
 *
 * Shows the role profile (when the pipeline was created via AI Discovery)
 * plus simple pipeline insights. When the pipeline is a DRAFT with no stages
 * this panel also renders the empty-state quickstart (template, AI interview,
 * single stage).
 *
 * All data is read from the parent shell's outlet context — no fetches.
 */

import { useState, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  Sparkles,
  FileText,
  Plus,
  Users,
  Target,
  Activity,
  UserCircle2,
} from 'lucide-react';
import { SectionCard } from '../components';
import { PipelineTemplateModal } from '../components/PipelineTemplateModal';
import { useStageMutations } from '../hooks/useStageMutations';
import type { PipelineShellContext } from './PipelineShellPage';
import type { OverviewRoleContext, CandidatePersona } from '../lib/api/types';

/**
 * The Six Domains model used by the Role Discovery interview. Order here is
 * the canonical render order.
 */
const SIX_DOMAINS = [
  { key: 'why', label: 'WHY_THIS_ROLE' },
  { key: 'work', label: 'THE_WORK' },
  { key: 'team', label: 'TEAM_AND_CULTURE' },
  { key: 'bar', label: 'REQUIREMENTS' },
  { key: 'codebase', label: 'CODEBASE' },
  { key: 'process', label: 'HIRING_PROCESS' },
] as const;

/** Convert a camelCase knowledge-state key to a display label. */
function formatKsKey(key: string): string {
  return key
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toUpperCase();
}

/** Render any knowledge-state value as a string — no raw JSON. */
function formatKsValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return (value as unknown[])
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${formatKsKey(k)}: ${formatKsValue(v)}`)
      .join(' • ');
  }
  return String(value);
}

/** Total number of filled domain keys — used as a completeness badge. */
function countFilledSignals(roleContext: OverviewRoleContext): number {
  let n = 0;
  for (const { key } of SIX_DOMAINS) {
    const domain = roleContext.knowledgeState[key];
    if (!domain) continue;
    for (const v of Object.values(domain)) {
      if (v !== null && v !== undefined && formatKsValue(v) !== '') n++;
    }
  }
  return n;
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}): JSX.Element {
  return (
    <div
      style={{
        padding: '20px 24px',
        background: 'var(--pipe-surface)',
        border: '1px solid var(--pipe-border-light)',
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 8,
          letterSpacing: '0.2em',
          color: 'var(--pipe-text-dim)',
          marginBottom: 10,
          fontFamily: '"Space Mono", monospace',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          color: 'var(--pipe-text)',
          fontFamily: '"Space Mono", monospace',
        }}
      >
        {value}
      </div>
    </div>
  );
}

type CombinedTab =
  | 'profile'
  | 'persona'
  | 'job_description'
  | 'insights'
  | 'candidates';

// ─── Persona renderer ───────────────────────────────────────────────────────

function PersonaChipList({
  label,
  values,
  tone = 'neutral',
}: {
  label: string;
  values: string[];
  tone?: 'neutral' | 'warn' | 'danger';
}): JSX.Element | null {
  if (!values || values.length === 0) return null;
  const toneStyle: React.CSSProperties =
    tone === 'danger'
      ? {
          color: '#f87171',
          background: 'rgba(248,113,113,0.08)',
          border: '1px solid rgba(248,113,113,0.25)',
        }
      : tone === 'warn'
        ? {
            color: '#fbbf24',
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.25)',
          }
        : {
            color: 'var(--pipe-text-muted)',
            background: 'var(--pipe-surface-hover)',
            border: '1px solid var(--pipe-border-light)',
          };
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.2em',
          color: 'var(--pipe-text-dim)',
          marginBottom: 10,
          fontFamily: '"Space Mono", monospace',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {values.map((v) => (
          <span
            key={v}
            style={{
              ...toneStyle,
              padding: '4px 10px',
              fontSize: 10,
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.05em',
              borderRadius: 4,
            }}
          >
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function PersonaView({ persona }: { persona: CandidatePersona }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Headline: archetype + seniority */}
      <div>
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            marginBottom: 6,
            fontFamily: '"Space Mono", monospace',
          }}
        >
          ARCHETYPE
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: 'var(--pipe-text)',
            letterSpacing: '-0.01em',
            marginBottom: 4,
          }}
        >
          {persona.archetype}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--pipe-text-muted)',
            fontFamily: '"Space Mono", monospace',
            letterSpacing: '0.05em',
          }}
        >
          {persona.seniority}
        </div>
      </div>

      {/* Career signal (narrative) */}
      {persona.careerSignal && (
        <div
          style={{
            padding: 18,
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border-light)',
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
              marginBottom: 10,
              fontFamily: '"Space Mono", monospace',
              fontWeight: 700,
            }}
          >
            CAREER_SIGNAL
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--pipe-text-muted)',
              lineHeight: 1.6,
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {persona.careerSignal}
          </div>
        </div>
      )}

      {/* Skills grids */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
        }}
      >
        <PersonaChipList label="MUST_HAVE" values={persona.mustHaveSkills} />
        <PersonaChipList label="NICE_TO_HAVE" values={persona.niceToHaveSkills} />
        <PersonaChipList label="DISPOSITION" values={persona.disposition} />
        <PersonaChipList label="RED_FLAGS" values={persona.redFlags} tone="warn" />
        <PersonaChipList label="DEALBREAKERS" values={persona.dealbreakers} tone="danger" />
      </div>
    </div>
  );
}

/**
 * Pill-style toggle button used inside the combined card's header meta slot
 * to switch between ROLE_PROFILE and PIPELINE_INSIGHTS.
 */
function CombinedTabButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`combined-tab-${label.toLowerCase()}`}
      data-active={isActive ? 'true' : 'false'}
      style={{
        padding: '6px 14px',
        background: isActive ? 'var(--pipe-surface-hover)' : 'transparent',
        border: `1px solid ${
          isActive ? 'var(--pipe-text-dim)' : 'var(--pipe-border-light)'
        }`,
        borderRadius: 4,
        color: isActive ? 'var(--pipe-text)' : 'var(--pipe-text-muted)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.15em',
        fontFamily: '"Space Mono", monospace',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {label}
    </button>
  );
}

export default function PipelineInsightsPanel(): JSX.Element {
  const {
    pipelineId,
    pipeline,
    stages,
    candidates,
    roleContext,
    refetch,
  } = useOutletContext<PipelineShellContext>();
  const navigate = useNavigate();

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [isCreatingStage, setIsCreatingStage] = useState(false);

  const { createStage } = useStageMutations();

  const isDraft = pipeline.status === 'DRAFT';
  const isEmpty = stages.length === 0;

  // Tab state for the combined card. Each tab is independently available
  // depending on what data the pipeline has. The tab bar only appears if 2+
  // tabs are available.
  const hasProfile = !!roleContext;
  const hasPersona = !!roleContext?.persona;
  const hasJobDescription =
    !!roleContext?.jobDescription && roleContext.jobDescription.trim() !== '';
  const hasInsights = !isEmpty;
  const hasCandidates = candidates.length > 0;

  // Default tab order: persona → job description → profile → insights → candidates
  const defaultTab: CombinedTab = hasPersona
    ? 'persona'
    : hasJobDescription
      ? 'job_description'
      : hasProfile
        ? 'profile'
        : hasInsights
          ? 'insights'
          : 'candidates';

  const [activeTab, setActiveTab] = useState<CombinedTab>(defaultTab);
  const availableTabCount =
    (hasPersona ? 1 : 0) +
    (hasJobDescription ? 1 : 0) +
    (hasProfile ? 1 : 0) +
    (hasInsights ? 1 : 0) +
    (hasCandidates ? 1 : 0);
  const showTabBar = availableTabCount >= 2;
  // If the active tab drifts out of availability (e.g. after a refetch),
  // fall back to the default.
  const effectiveTab: CombinedTab = (() => {
    if (activeTab === 'persona' && hasPersona) return 'persona';
    if (activeTab === 'job_description' && hasJobDescription)
      return 'job_description';
    if (activeTab === 'profile' && hasProfile) return 'profile';
    if (activeTab === 'insights' && hasInsights) return 'insights';
    if (activeTab === 'candidates' && hasCandidates) return 'candidates';
    return defaultTab;
  })();

  const metrics = useMemo(() => {
    const total = candidates.length;
    const completed = candidates.filter((c) => c.status === 'COMPLETED').length;
    const inProgress = candidates.filter(
      (c) => c.status === 'IN_PROGRESS',
    ).length;
    const scored = candidates.filter(
      (c) => c.score !== undefined && c.score !== null,
    );
    const avgScore =
      scored.length > 0
        ? Math.round(
            scored.reduce((sum, c) => sum + (c.score ?? 0), 0) / scored.length,
          )
        : null;
    return { total, completed, inProgress, avgScore };
  }, [candidates]);

  return (
    <div
      data-testid="insights-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Empty-state quickstart — DRAFT with no stages */}
      {isDraft && isEmpty && (
        <SectionCard
          label="EMPTY_PIPELINE"
          icon={<Plus size={16} color="var(--pipe-text-dim)" />}
          meta="START HERE"
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--pipe-text)',
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.03em',
              marginBottom: 8,
            }}
          >
            START FROM A TEMPLATE OR BUILD STAGES ONE AT A TIME
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
              marginBottom: 24,
              maxWidth: 560,
              lineHeight: 1.6,
            }}
          >
            Pick a curated template to seed stages and questions in one shot,
            run the role discovery interview to generate a pipeline tailored to
            the role, or add a single stage manually.
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowTemplateModal(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 18px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  fontFamily: '"Space Mono", monospace',
                  background: 'rgba(96,165,250,0.12)',
                  border: '1px solid rgba(96,165,250,0.35)',
                  borderRadius: 6,
                  color: '#60a5fa',
                  cursor: 'pointer',
                }}
              >
                <FileText size={14} />
                USE_TEMPLATE
              </button>
              <button
                onClick={() => navigate('/pipeline/new')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 18px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  fontFamily: '"Space Mono", monospace',
                  background: 'var(--pipe-accent-surface)',
                  border: '1px solid var(--pipe-accent-border)',
                  borderRadius: 6,
                  color: 'var(--pipe-accent)',
                  cursor: 'pointer',
                }}
              >
                <Sparkles size={14} />
                ROLE_DISCOVERY
              </button>
              <button
                onClick={() => {
                  setIsCreatingStage(true);
                  void (async () => {
                    try {
                      const created = await createStage(pipelineId, 'New Stage');
                      await refetch();
                      navigate(`/pipeline/${pipelineId}/stage/${created.id}?adder=1`);
                    } catch (err) {
                      console.error('[PipelineInsightsPanel] Failed to create stage:', err);
                    } finally {
                      setIsCreatingStage(false);
                    }
                  })();
                }}
                disabled={isCreatingStage}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 18px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  fontFamily: '"Space Mono", monospace',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 6,
                  color: 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                }}
              >
                <Plus size={14} />
                {isCreatingStage ? 'CREATING...' : 'ADD_SINGLE_STAGE'}
              </button>
            </div>
        </SectionCard>
      )}

      {/* Combined card with internal tab toggle in the header meta slot. */}
      {(hasPersona ||
        hasJobDescription ||
        hasProfile ||
        hasInsights ||
        hasCandidates) && (
        <SectionCard
          label={
            effectiveTab === 'persona'
              ? 'CANDIDATE_PERSONA'
              : effectiveTab === 'job_description'
                ? 'JOB_DESCRIPTION'
                : effectiveTab === 'profile'
                  ? 'ROLE_PROFILE'
                  : effectiveTab === 'insights'
                    ? 'PIPELINE_INSIGHTS'
                    : 'CANDIDATES'
          }
          icon={
            effectiveTab === 'persona' ? (
              <UserCircle2 size={16} color="#fbbf24" />
            ) : effectiveTab === 'job_description' ? (
              <FileText size={16} color="#60a5fa" />
            ) : effectiveTab === 'profile' ? (
              <Sparkles size={16} color="var(--pipe-accent)" />
            ) : effectiveTab === 'insights' ? (
              <Activity size={16} color="#4ade80" />
            ) : (
              <Users size={16} color="#60a5fa" />
            )
          }
          meta={
            showTabBar ? (
              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {hasPersona && (
                  <CombinedTabButton
                    label="PERSONA"
                    isActive={effectiveTab === 'persona'}
                    onClick={() => setActiveTab('persona')}
                  />
                )}
                {hasJobDescription && (
                  <CombinedTabButton
                    label="JD"
                    isActive={effectiveTab === 'job_description'}
                    onClick={() => setActiveTab('job_description')}
                  />
                )}
                {hasProfile && (
                  <CombinedTabButton
                    label="PROFILE"
                    isActive={effectiveTab === 'profile'}
                    onClick={() => setActiveTab('profile')}
                  />
                )}
                {hasInsights && (
                  <CombinedTabButton
                    label="INSIGHTS"
                    isActive={effectiveTab === 'insights'}
                    onClick={() => setActiveTab('insights')}
                  />
                )}
                {hasCandidates && (
                  <CombinedTabButton
                    label="CANDIDATES"
                    isActive={effectiveTab === 'candidates'}
                    onClick={() => setActiveTab('candidates')}
                  />
                )}
              </div>
            ) : effectiveTab === 'persona' && roleContext?.persona ? (
              roleContext.persona.seniority.toUpperCase()
            ) : effectiveTab === 'job_description' ? (
              'MARKDOWN'
            ) : effectiveTab === 'profile' && roleContext ? (
              `${roleContext.questionsAsked} QUESTIONS · ${countFilledSignals(roleContext)} SIGNALS`
            ) : effectiveTab === 'insights' ? (
              `${stages.length} STAGE${stages.length === 1 ? '' : 'S'}`
            ) : (
              `${candidates.length} CANDIDATE${candidates.length === 1 ? '' : 'S'}`
            )
          }
        >
          {effectiveTab === 'persona' && roleContext?.persona && (
            <PersonaView persona={roleContext.persona} />
          )}

          {effectiveTab === 'job_description' && hasJobDescription && (
            <div
              className="markdown-body"
              style={{
                color: 'var(--pipe-text)',
                fontSize: 14,
                lineHeight: 1.7,
                fontFamily:
                  '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                maxWidth: 760,
              }}
            >
              <ReactMarkdown>{roleContext!.jobDescription!}</ReactMarkdown>
            </div>
          )}

          {effectiveTab === 'profile' && roleContext && (
            <>
          {/* Baseline metadata row */}
          <div
            style={{
              display: 'flex',
              gap: 32,
              marginBottom: 24,
              flexWrap: 'wrap',
            }}
          >
            {(
              [
                ['TITLE', roleContext.baseline.title],
                ['DEPARTMENT', roleContext.baseline.department],
                ['COMPANY', roleContext.baseline.companyName],
                ['LOCATION', roleContext.baseline.location],
              ] as [string, string | undefined][]
            )
              .filter(([, v]) => !!v)
              .map(([label, value]) => (
                <div key={label}>
                  <div
                    style={{
                      fontSize: 8,
                      letterSpacing: '0.2em',
                      color: 'var(--pipe-text-dim)',
                      marginBottom: 4,
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--pipe-text)',
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
          </div>

          {/* Six Domains — render every signal captured during Role Discovery.
              Domains with no data are hidden so the layout stays tight. */}
          <div
            style={{
              borderTop: '1px solid var(--pipe-border-light)',
              marginTop: 4,
              paddingTop: 24,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 20,
            }}
          >
            {SIX_DOMAINS.map(({ key, label }) => {
              const domain = roleContext.knowledgeState[key] as
                | Record<string, unknown>
                | undefined;
              if (!domain) return null;
              const entries = Object.entries(domain).filter(([, v]) => {
                if (v === null || v === undefined) return false;
                return formatKsValue(v) !== '';
              });
              if (entries.length === 0) return null;

              return (
                <div
                  key={key}
                  style={{
                    padding: 18,
                    background: 'var(--pipe-surface)',
                    border: '1px solid var(--pipe-border-light)',
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      letterSpacing: '0.2em',
                      color: 'var(--pipe-text-dim)',
                      marginBottom: 14,
                      fontFamily: '"Space Mono", monospace',
                      fontWeight: 700,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    {entries.map(([k, v]) => (
                      <div key={k}>
                        <div
                          style={{
                            fontSize: 8,
                            letterSpacing: '0.15em',
                            color: 'var(--pipe-text-dim)',
                            marginBottom: 4,
                            fontFamily: '"Space Mono", monospace',
                          }}
                        >
                          {formatKsKey(k)}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--pipe-text-muted)',
                            lineHeight: 1.5,
                            fontFamily: '"Space Mono", monospace',
                          }}
                        >
                          {formatKsValue(v)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
            </>
          )}

          {effectiveTab === 'insights' && !isEmpty && (
            <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <Metric label="CANDIDATES" value={metrics.total} />
            <Metric label="IN_PROGRESS" value={metrics.inProgress} />
            <Metric label="COMPLETED" value={metrics.completed} />
            <Metric
              label="AVG_SCORE"
              value={metrics.avgScore !== null ? `${metrics.avgScore}` : '—'}
            />
          </div>

          {/* Per-stage funnel */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div
              style={{
                fontSize: 8,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              PER_STAGE
            </div>
            {stages.map((stage, index) => {
              const stageCandidates = candidates.filter(
                (c) => c.currentStageId === stage.id,
              );
              const count = stageCandidates.length;
              const pct =
                metrics.total > 0
                  ? Math.round((count / metrics.total) * 100)
                  : 0;
              return (
                <button
                  key={stage.id}
                  onClick={() =>
                    navigate(`/pipeline/${pipelineId}/stage/${stage.id}`)
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '12px 16px',
                    background: 'var(--pipe-surface)',
                    border: '1px solid var(--pipe-border-light)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                      width: 24,
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--pipe-text)',
                      fontFamily: '"Space Mono", monospace',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {(stage.title ?? 'STAGE').toUpperCase()}
                  </div>
                  <div
                    style={{
                      flex: 2,
                      height: 4,
                      background: 'var(--pipe-surface-hover)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background:
                          'linear-gradient(90deg, rgba(74,222,128,0.3), rgba(74,222,128,0.7))',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 10,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                      minWidth: 64,
                      justifyContent: 'flex-end',
                    }}
                  >
                    <Users size={12} />
                    {count}
                  </div>
                </button>
              );
            })}
          </div>
            </>
          )}

          {effectiveTab === 'candidates' && hasCandidates && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {candidates.map((c) => {
                const stage = stages.find((s) => s.id === c.currentStageId);
                const statusColor =
                  c.status === 'COMPLETED'
                    ? '#4ade80'
                    : c.status === 'IN_PROGRESS'
                      ? '#8b5cf6'
                      : 'var(--pipe-text-dim)';
                return (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/candidates/${c.id}`)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '12px 16px',
                      background: 'var(--pipe-surface)',
                      border: '1px solid var(--pipe-border-light)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: statusColor,
                        flexShrink: 0,
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--pipe-text)',
                          letterSpacing: '0.02em',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {(c.name || c.email || 'UNKNOWN').toUpperCase()}
                      </div>
                      {c.email && c.name && (
                        <div
                          style={{
                            fontSize: 9,
                            color: 'var(--pipe-text-dim)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {c.email.toLowerCase()}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        letterSpacing: '0.15em',
                        color: 'var(--pipe-text-muted)',
                        padding: '4px 10px',
                        background: 'var(--pipe-surface-hover)',
                        border: '1px solid var(--pipe-border-light)',
                        borderRadius: 4,
                        whiteSpace: 'nowrap',
                        maxWidth: 160,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {(stage?.title ?? 'NO_STAGE').toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        color: statusColor,
                        fontWeight: 700,
                        minWidth: 92,
                        textAlign: 'right',
                      }}
                    >
                      {(c.status || 'INVITED').toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color:
                          c.score !== null && c.score !== undefined
                            ? 'var(--pipe-text)'
                            : 'var(--pipe-text-dim)',
                        minWidth: 36,
                        textAlign: 'right',
                      }}
                    >
                      {c.score !== null && c.score !== undefined
                        ? String(Math.round(c.score)).padStart(2, '0')
                        : '—'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      {/* Fallback when no role context and pipeline is empty (draft path) */}
      {!hasProfile && !hasInsights && !isDraft && (
        <SectionCard
          label="NO_ROLE_PROFILE"
          icon={<Target size={16} color="var(--pipe-text-dim)" />}
        >
          <div
            style={{
              fontSize: 11,
              color: 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
              lineHeight: 1.6,
            }}
          >
            This pipeline was created without running the role discovery
            interview. Role insights will appear here once a discovery session
            is attached.
          </div>
        </SectionCard>
      )}

      {showTemplateModal && (
        <PipelineTemplateModal
          pipelineId={pipelineId}
          onClose={() => setShowTemplateModal(false)}
          onApplied={(firstStageId) => {
            setShowTemplateModal(false);
            void refetch();
            if (firstStageId) {
              navigate(`/pipeline/${pipelineId}/stage/${firstStageId}`);
            }
          }}
        />
      )}
    </div>
  );
}
