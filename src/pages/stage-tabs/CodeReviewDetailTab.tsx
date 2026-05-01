/**
 * CodeReviewDetailTab — default tab for CODE_REVIEW stages.
 *
 * Replaces the generic "Challenges" tab entirely. Contains:
 *   - What the code review interview is + candidate flow
 *   - PR configuration (repo + PR select) with inline CTA
 *   - Interview mode toggles: multi-turn, AI assistant, persona
 *   - The 3 scoring dimensions (Communication, Technical, Review Practice)
 */

import { useState, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  GitPullRequest,
  MessageSquare,
  Code2,
  Shield,
  Clock,
  ChevronRight,
  Target,
  Search,
  Repeat,
  FileCode,
  CheckCircle2,
  Bot,
  HelpCircle,
  ToggleLeft,
  ToggleRight,
  Save,
  Check,
} from 'lucide-react';
import { SectionCard } from '../../components';
import { useChallengeMutations } from '../../hooks/useChallengeMutations';
import type { StagePanelContext } from '../StagePanel';

const mono = '"Space Mono", monospace';

/** The 3 scoring dimensions from the panel-based scorer. */
const SCORING_DIMENSIONS = [
  {
    key: 'communication',
    label: 'Communication',
    weight: '25%',
    color: '#60a5fa',
    icon: MessageSquare,
    description: 'Tone, clarity, pushback handling, guidance quality',
    signals: ['Constructive framing', 'Clear explanations', 'Handles disagreement well'],
  },
  {
    key: 'technical',
    label: 'Technical',
    weight: '40%',
    color: '#f97316',
    icon: Code2,
    description: 'Bug detection, severity calibration, trade-off awareness',
    signals: ['Finds planted bugs', 'Correct severity', 'Design trade-off discussion'],
  },
  {
    key: 'review-practice',
    label: 'Review Practice',
    weight: '35%',
    color: '#4ade80',
    icon: Search,
    description: 'Understanding first, prioritization, completeness, driving to conclusion',
    signals: ['Reads before commenting', 'Prioritizes critical issues', 'Positive recognition'],
  },
] as const;

const SCORE_BANDS = [
  { label: 'STRONG', range: '75–100', color: '#4ade80', description: 'Trust with independent review' },
  { label: 'ADEQUATE', range: '45–74', color: '#fbbf24', description: 'Solid foundation, needs mentoring' },
  { label: 'WEAK', range: '0–44', color: '#f87171', description: 'Not ready for independent review' },
] as const;

/* ── Toggle row ─────────────────────────────────────────────────────────── */

function ToggleRow({
  label,
  description,
  enabled,
  onChange,
  icon: Icon,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (val: boolean) => void;
  icon: typeof Bot;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        borderRadius: 8,
        background: enabled ? 'rgba(96,165,250,0.04)' : 'transparent',
        border: `1px solid ${enabled ? 'rgba(96,165,250,0.12)' : 'var(--pipe-border-light)'}`,
        transition: 'all 0.15s ease',
      }}
    >
      <Icon size={16} color={enabled ? '#60a5fa' : 'var(--pipe-text-dim)'} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: enabled ? 'var(--pipe-text)' : 'var(--pipe-text-muted)',
            fontFamily: mono,
            letterSpacing: '0.05em',
            marginBottom: 2,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 9,
            color: 'var(--pipe-text-dim)',
            fontFamily: mono,
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        {enabled ? (
          <ToggleRight size={24} color="#60a5fa" />
        ) : (
          <ToggleLeft size={24} color="var(--pipe-text-dim)" />
        )}
      </button>
    </div>
  );
}

/* ── Persona selector ──────────────────────────────────────────────────── */

function PersonaSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}): JSX.Element {
  const options = [
    { key: 'junior', label: 'Junior', description: 'Agrees easily, naive pushback ~40% of the time' },
    { key: 'mid', label: 'Mid', description: 'Reasonable pushback, asks for clarification' },
    { key: 'senior', label: 'Senior', description: 'Strong opinions, defends design decisions, harder to convince' },
  ];

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          style={{
            flex: 1,
            padding: '12px 14px',
            background: value === opt.key ? 'rgba(96,165,250,0.08)' : 'var(--pipe-surface)',
            border: `1px solid ${value === opt.key ? 'rgba(96,165,250,0.3)' : 'var(--pipe-border)'}`,
            borderRadius: 8,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: value === opt.key ? '#60a5fa' : 'var(--pipe-text)',
              fontFamily: mono,
              letterSpacing: '0.1em',
              marginBottom: 4,
            }}
          >
            {opt.label.toUpperCase()}
          </div>
          <div
            style={{
              fontSize: 8,
              color: 'var(--pipe-text-dim)',
              fontFamily: mono,
              lineHeight: 1.5,
            }}
          >
            {opt.description}
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Rounds selector ───────────────────────────────────────────────────── */

function RoundsSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (val: number) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--pipe-text-dim)',
          fontFamily: mono,
          letterSpacing: '0.08em',
          flexShrink: 0,
        }}
      >
        MAX_ROUNDS
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        {[2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: value === n ? '#60a5fa' : 'var(--pipe-surface)',
              border: `1px solid ${value === n ? '#60a5fa' : 'var(--pipe-border)'}`,
              borderRadius: 6,
              color: value === n ? '#0c0c0e' : 'var(--pipe-text-muted)',
              fontSize: 12,
              fontWeight: 800,
              fontFamily: mono,
              cursor: 'pointer',
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────────── */

export default function CodeReviewDetailTab(): JSX.Element {
  const { shell, stage, stageId, refetchStage } = useOutletContext<StagePanelContext>();
  const navigate = useNavigate();
  const { createChallenge } = useChallengeMutations();

  const stagePath = `/pipeline/${shell.pipelineId}/stage/${stageId}`;

  // Find CODE_REVIEW challenges
  const crChallenges = stage.challenges?.filter((c) => c.type === 'CODE_REVIEW') ?? [];
  const hasChallenge = crChallenges.length > 0;
  const challenge = crChallenges[0];

  // Extract config from first challenge if it exists
  const existingConfig = challenge?.config as Record<string, unknown> | null;

  // Local state for configuration
  const [multiTurn, setMultiTurn] = useState<boolean>(
    (existingConfig?.isMultiTurn as boolean) ?? true,
  );
  const [aiAssistant, setAiAssistant] = useState<boolean>(
    (existingConfig?.enableExplainer as boolean) ?? false,
  );
  const [followUp, setFollowUp] = useState<boolean>(
    (existingConfig?.enableFollowUp as boolean) ?? false,
  );
  const [persona, setPersona] = useState<string>(
    (existingConfig?.implementerPersona as string) ?? 'junior',
  );
  const [maxRounds, setMaxRounds] = useState<number>(
    (existingConfig?.maxRounds as number) ?? 4,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const configChanged =
    multiTurn !== ((existingConfig?.isMultiTurn as boolean) ?? true) ||
    aiAssistant !== ((existingConfig?.enableExplainer as boolean) ?? false) ||
    followUp !== ((existingConfig?.enableFollowUp as boolean) ?? false) ||
    persona !== ((existingConfig?.implementerPersona as string) ?? 'junior') ||
    maxRounds !== ((existingConfig?.maxRounds as number) ?? 4);

  const handleSaveConfig = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      const newConfig = {
        ...(existingConfig ?? {}),
        isMultiTurn: multiTurn,
        enableExplainer: aiAssistant,
        enableFollowUp: followUp,
        implementerPersona: persona,
        maxRounds,
        maxExplainerQuestions: 6,
      };

      if (challenge) {
        await fetch(`/api/v1/challenges/${challenge.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: newConfig }),
        });
      } else {
        await createChallenge(stageId, {
          type: 'CODE_REVIEW',
          title: 'Code Review Challenge',
          instructions: 'Review the pull request and provide feedback.',
          config: newConfig,
        });
      }
      await refetchStage();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[CodeReviewDetailTab] Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  }, [existingConfig, multiTurn, aiAssistant, followUp, persona, maxRounds, challenge, stageId, createChallenge, refetchStage]);

  /** Create a placeholder challenge with no repo/PR so the matching
   *  system assigns the best-matched repository per candidate. */
  const handleUseMatchedRepo = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      const newConfig = {
        ...(existingConfig ?? {}),
        isMultiTurn: multiTurn,
        enableExplainer: aiAssistant,
        enableFollowUp: followUp,
        implementerPersona: persona,
        maxRounds,
        maxExplainerQuestions: 6,
        useMatchedRepo: true,
      };
      await createChallenge(stageId, {
        type: 'CODE_REVIEW',
        title: 'Code Review Challenge',
        instructions: 'Review the pull request and provide feedback.',
        config: newConfig,
      });
      await refetchStage();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[CodeReviewDetailTab] Failed to create matched-repo challenge:', err);
    } finally {
      setSaving(false);
    }
  }, [existingConfig, multiTurn, aiAssistant, followUp, persona, maxRounds, stageId, createChallenge, refetchStage]);

  return (
    <div
      data-testid="stage-tab-content-code-review-detail"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Hero — what this stage is */}
      <SectionCard
        label="CODE_REVIEW_INTERVIEW"
        icon={<GitPullRequest size={16} color="var(--pipe-text-dim)" />}
        meta="AI_IMPLEMENTER_AGENT"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.7,
              color: 'var(--pipe-text)',
              fontFamily: mono,
            }}
          >
            The candidate reviews a real GitHub PR containing planted bugs and
            design trade-offs. When multi-turn is enabled, an AI implementer
            agent plays the PR author — responding to review comments with
            pushback, clarification, or fixes. The conversation continues for
            multiple rounds, testing how the candidate drives a review to
            resolution.
          </p>

          {/* Candidate flow */}
          <div
            style={{
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              padding: '14px 0',
              borderTop: '1px solid var(--pipe-border-light)',
              borderBottom: '1px solid var(--pipe-border-light)',
            }}
          >
            {(multiTurn
              ? [
                  { label: 'RECEIVE PR', icon: FileCode },
                  { label: 'REVIEW', icon: Search },
                  { label: 'AGENT RESPONDS', icon: Bot },
                  { label: 'BACK & FORTH', icon: Repeat },
                  { label: 'VERDICT', icon: CheckCircle2 },
                ]
              : [
                  { label: 'RECEIVE PR', icon: FileCode },
                  { label: 'REVIEW CODE', icon: Search },
                  { label: 'ANNOTATE', icon: MessageSquare },
                  { label: 'VERDICT', icon: CheckCircle2 },
                ]
            ).map((step, i, arr) => (
              <div
                key={step.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  flex: 1,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    flex: 1,
                  }}
                >
                  <step.icon
                    size={14}
                    color={i === 0 ? '#60a5fa' : 'var(--pipe-text-dim)'}
                  />
                  <span
                    style={{
                      fontSize: 7,
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      color: i === 0 ? '#60a5fa' : 'var(--pipe-text-dim)',
                      fontFamily: mono,
                      textAlign: 'center',
                    }}
                  >
                    {step.label}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <ChevronRight
                    size={10}
                    color="var(--pipe-border)"
                    style={{ flexShrink: 0 }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Key stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              {
                icon: Clock,
                label: 'DURATION',
                value: multiTurn ? '30–60 min' : '15–30 min',
                sub: 'async, candidate-paced',
              },
              {
                icon: Bot,
                label: 'PERSONA',
                value: persona.toUpperCase(),
                sub: multiTurn ? `${maxRounds} rounds max` : 'single-pass review',
              },
              {
                icon: Shield,
                label: 'SCORING',
                value: '3-PANEL',
                sub: 'specialist evaluators',
              },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  padding: '14px 16px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <stat.icon size={11} color="var(--pipe-text-dim)" />
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: mono }}>
                    {stat.label}
                  </span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--pipe-text)', fontFamily: mono, lineHeight: 1, marginBottom: 4 }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-muted)', fontFamily: mono, letterSpacing: '0.05em' }}>
                  {stat.sub}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* PR configuration */}
      <SectionCard
        label="PULL_REQUEST"
        icon={<GitPullRequest size={16} color="var(--pipe-text-dim)" />}
        meta={
          hasChallenge && challenge?.githubRepoUrl ? (
            <button
              onClick={() => challenge && navigate(`/pipeline/${shell.pipelineId}/challenges/${challenge.id}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', background: 'transparent',
                border: '1px solid var(--pipe-border)', borderRadius: 4,
                color: 'var(--pipe-text-dim)', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.1em', fontFamily: mono, cursor: 'pointer',
              }}
            >
              EDIT_PR <ChevronRight size={10} />
            </button>
          ) : hasChallenge ? (
            <button
              onClick={() => navigate(`${stagePath}/configure`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', background: 'transparent',
                border: '1px solid var(--pipe-border)', borderRadius: 4,
                color: 'var(--pipe-text-dim)', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.1em', fontFamily: mono, cursor: 'pointer',
              }}
            >
              SELECT_PR <ChevronRight size={10} />
            </button>
          ) : undefined
        }
      >
        {hasChallenge && challenge ? (
          challenge.githubRepoUrl ? (
            /* Manually selected PR */
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '16px 20px', background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)', borderRadius: 10,
              }}
            >
              <GitPullRequest size={18} color="#60a5fa" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: mono, marginBottom: 4 }}>
                  {challenge.githubPrTitle ?? challenge.title}
                </div>
                {challenge.githubRepoUrl && (
                  <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: mono }}>
                    {challenge.githubRepoUrl.replace('https://github.com/', '')}
                    {challenge.githubPrNumber ? ` #${challenge.githubPrNumber}` : ''}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Placeholder — candidate-matched repository */
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '16px 20px', background: 'rgba(74,222,128,0.04)',
                border: '1px solid rgba(74,222,128,0.15)', borderRadius: 10,
              }}
            >
              <Target size={18} color="#4ade80" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: mono, marginBottom: 4 }}>
                  Candidate-Matched Repository
                </div>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: mono, lineHeight: 1.5 }}>
                  Each candidate receives a pull request from the repository
                  best matched to their profile by the AI ingestion pipeline.
                  Requires candidate resume ingestion to complete.
                </div>
              </div>
            </div>
          )
        ) : (
          /* No challenge yet — offer both options */
          <div
            style={{
              padding: '32px 24px', textAlign: 'center',
              border: '1px dashed rgba(96,165,250,0.2)', borderRadius: 10,
              background: 'rgba(96,165,250,0.03)',
            }}
          >
            <GitPullRequest size={24} color="rgba(96,165,250,0.4)" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 11, color: 'var(--pipe-text-muted)', fontFamily: mono, marginBottom: 20, lineHeight: 1.6 }}>
              Choose how the pull request for this stage is selected.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => void handleUseMatchedRepo()}
                style={{
                  padding: '10px 18px', background: 'rgba(74,222,128,0.1)', color: '#4ade80',
                  border: '1px solid rgba(74,222,128,0.3)', borderRadius: 4, fontSize: 10, fontWeight: 800,
                  letterSpacing: '0.12em', fontFamily: mono, cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Target size={12} /> USE MATCHED REPO
                </span>
              </button>
              <button
                onClick={() => navigate(`${stagePath}/configure`)}
                style={{
                  padding: '10px 18px', background: '#60a5fa', color: '#0c0c0e',
                  border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 800,
                  letterSpacing: '0.12em', fontFamily: mono, cursor: 'pointer',
                }}
              >
                + SELECT_PR
              </button>
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ textAlign: 'left', padding: '10px 12px', background: 'var(--pipe-surface)', borderRadius: 6, border: '1px solid var(--pipe-border)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#4ade80', fontFamily: mono, letterSpacing: '0.1em', marginBottom: 4 }}>
                  <Target size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> MATCHED REPO
                </div>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: mono, lineHeight: 1.5 }}>
                  AI selects the best repository for each candidate based on their resume, skills, and experience.
                </div>
              </div>
              <div style={{ textAlign: 'left', padding: '10px 12px', background: 'var(--pipe-surface)', borderRadius: 6, border: '1px solid var(--pipe-border)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#60a5fa', fontFamily: mono, letterSpacing: '0.1em', marginBottom: 4 }}>
                  <GitPullRequest size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> MANUAL PR
                </div>
                <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: mono, lineHeight: 1.5 }}>
                  Every candidate reviews the same specific pull request that you choose.
                </div>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Interview mode configuration */}
      <SectionCard
        label="INTERVIEW_MODE"
        icon={<Bot size={16} color="var(--pipe-text-dim)" />}
        meta={
          <button
            onClick={() => void handleSaveConfig()}
            disabled={saving || (!configChanged && !saved)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px',
              background: saved ? 'rgba(74,222,128,0.12)' : configChanged ? 'var(--pipe-text)' : 'var(--pipe-surface)',
              border: saved ? '1px solid rgba(74,222,128,0.3)' : configChanged ? '1px solid var(--pipe-text)' : '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: saved ? '#4ade80' : configChanged ? 'var(--pipe-bg)' : 'var(--pipe-text-dim)',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', fontFamily: mono,
              cursor: saving || (!configChanged && !saved) ? 'default' : 'pointer',
              opacity: saving || (!configChanged && !saved) ? 0.5 : 1,
              transition: 'all 0.2s ease',
            }}
          >
            {saved ? <><Check size={10} /> SAVED</> : saving ? 'SAVING...' : <><Save size={10} /> SAVE</>}
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ToggleRow
            icon={Repeat}
            label="Multi-Turn Conversation"
            description="AI implementer agent responds to review comments with pushback, clarification, or code fixes. Without this, candidates submit a one-pass review."
            enabled={multiTurn}
            onChange={setMultiTurn}
          />

          <ToggleRow
            icon={HelpCircle}
            label="AI Code Assistant"
            description="Candidates can ask an AI assistant questions about the codebase — architecture, patterns, test approach. Budget: 6 questions."
            enabled={aiAssistant}
            onChange={setAiAssistant}
          />

          <ToggleRow
            icon={MessageSquare}
            label="Follow-Up Debrief"
            description="After submitting their review, the candidate answers 5 AI-generated follow-up questions based on their actual annotations and verdict. Probes depth of understanding — did they find the bug by pattern-matching or do they understand why it matters?"
            enabled={followUp}
            onChange={setFollowUp}
          />

          {/* Persona selector — only visible when multi-turn is on */}
          {multiTurn && (
            <div style={{ padding: '4px 0' }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: mono, marginBottom: 10 }}>
                IMPLEMENTER_PERSONA
              </div>
              <PersonaSelector value={persona} onChange={setPersona} />
            </div>
          )}

          {/* Rounds selector — only visible when multi-turn is on */}
          {multiTurn && (
            <div style={{ padding: '8px 0 0' }}>
              <RoundsSelector value={maxRounds} onChange={setMaxRounds} />
            </div>
          )}
        </div>
      </SectionCard>

      {/* Scoring dimensions */}
      <SectionCard
        label="SCORING_PANEL"
        icon={<Target size={16} color="var(--pipe-text-dim)" />}
        meta="3 SPECIALIST EVALUATORS"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {SCORING_DIMENSIONS.map((dim) => (
            <div
              key={dim.key}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '16px', borderRadius: 8,
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--pipe-surface)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: `${dim.color}12`, border: `1px solid ${dim.color}25`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >
                <dim.icon size={16} color={dim.color} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: mono, letterSpacing: '0.05em' }}>
                    {dim.label}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: dim.color, fontFamily: mono, letterSpacing: '0.08em' }}>
                    {dim.weight}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: mono, marginBottom: 8 }}>
                  {dim.description}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {dim.signals.map((signal) => (
                    <span
                      key={signal}
                      style={{
                        fontSize: 8, padding: '2px 8px',
                        background: `${dim.color}08`, border: `1px solid ${dim.color}18`,
                        borderRadius: 3, color: 'var(--pipe-text-dim)',
                        fontFamily: mono, letterSpacing: '0.05em',
                      }}
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ width: 48, flexShrink: 0 }}>
                <div style={{ width: '100%', height: 4, background: 'var(--pipe-border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: dim.weight, height: '100%', background: dim.color, borderRadius: 2 }} />
                </div>
              </div>
            </div>
          ))}

          {/* Score bands */}
          <div style={{ display: 'flex', gap: 12, marginTop: 12, padding: '14px 16px', borderTop: '1px solid var(--pipe-border-light)' }}>
            {SCORE_BANDS.map((band) => (
              <div key={band.label} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: band.color, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: band.color, fontFamily: mono, letterSpacing: '0.1em' }}>
                    {band.label} ({band.range})
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--pipe-text-dim)', fontFamily: mono }}>
                    {band.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
