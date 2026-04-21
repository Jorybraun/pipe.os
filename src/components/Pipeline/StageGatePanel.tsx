/**
 * StageGatePanel — slide-in config panel for a stage gate.
 *
 * Opens when a recruiter clicks the circle gate connector between stages.
 * Shows the inherited match config, candidate count at this gate, and
 * stubs for email automation + repo config.
 */

import { createPortal } from 'react-dom';
import { X, Settings2, Users, Mail, GitBranch, ChevronRight } from 'lucide-react';
import type { OverviewStage, OverviewCandidate, OverviewMatchConfig } from '../../lib/api/types';

export interface StageGatePanelProps {
  stage: OverviewStage;
  candidates: OverviewCandidate[];
  matchConfig: OverviewMatchConfig | null;
  onClose: () => void;
}

const PHILOSOPHY_DESC: Record<string, string> = {
  tailored: 'Challenges are matched to the role profile. Every candidate sees a repo chosen specifically for this opening.',
  hybrid: 'Blend of role-tailored and standardised challenges. Mix ratio controls the balance.',
  validate: 'Standardised challenges for consistent cross-candidate benchmarking.',
};

const TOLERANCE_DESC: Record<string, string> = {
  strict: 'Top-decile repo match only. High signal; smaller candidate pool.',
  moderate: 'Top-quartile repo match. Balances signal strength with pipeline volume.',
  lenient: 'Broad repo match. Maximises pipeline volume.',
};

const LINKAGE_DESC: Record<string, string> = {
  'shared-repo': 'All stages use the same matched repo. Continuity across the interview.',
  'per-stage': 'Each stage independently matches a repo. Widens coverage; may surface different skill dimensions.',
};

const AUTOMATION_DESC: Record<string, string> = {
  'per-pipeline': 'Challenges are assigned once when the pipeline is published.',
  'per-candidate': 'Each candidate receives a fresh challenge assignment on invite. Recommended.',
  'per-stage': 'Challenge is re-assigned when the candidate advances to this stage.',
  'recruiter-override': 'Recruiter manually assigns challenges. No automation.',
};

function ConfigRow({
  axis,
  value,
  description,
}: {
  axis: string;
  value: string;
  description: string;
}): JSX.Element {
  return (
    <div
      style={{
        padding: '14px 0',
        borderBottom: '1px solid var(--pipe-border-light)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            fontWeight: 700,
          }}
        >
          {axis}
        </div>
        <div
          style={{
            fontSize: 10,
            fontFamily: '"Space Mono", monospace',
            color: 'var(--pipe-text)',
            fontWeight: 700,
            letterSpacing: '0.05em',
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          {value.toUpperCase()}
        </div>
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--pipe-text-muted)',
          lineHeight: 1.55,
          fontFamily: '"Space Mono", monospace',
        }}
      >
        {description}
      </div>
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
        marginTop: 28,
      }}
    >
      {icon}
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.2em',
          fontWeight: 700,
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ComingSoonBadge(): JSX.Element {
  return (
    <span
      style={{
        fontSize: 8,
        letterSpacing: '0.15em',
        fontFamily: '"Space Mono", monospace',
        padding: '2px 7px',
        background: 'rgba(96,165,250,0.08)',
        border: '1px solid rgba(96,165,250,0.2)',
        color: '#60a5fa',
        borderRadius: 3,
        marginLeft: 8,
      }}
    >
      SOON
    </span>
  );
}

export function StageGatePanel({
  stage,
  candidates,
  matchConfig,
  onClose,
}: StageGatePanelProps): JSX.Element {
  const atStage = candidates.filter((c) => c.currentStageId === stage.id);
  const completed = atStage.filter((c) => c.status === 'COMPLETED').length;
  const inProgress = atStage.filter((c) => c.status === 'IN_PROGRESS').length;
  const invited = atStage.filter((c) => c.status === 'INVITED').length;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1040,
          background: 'rgba(0,0,0,0.4)',
        }}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        data-testid="stage-gate-panel"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          zIndex: 1050,
          background: '#0f0f17',
          borderLeft: '1px solid var(--pipe-border)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px 24px 20px',
            borderBottom: '1px solid var(--pipe-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexShrink: 0,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 8,
                letterSpacing: '0.25em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 6,
              }}
            >
              STAGE_GATE
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: 'var(--pipe-text)',
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}
            >
              {stage.title ?? 'Stage'}
            </div>
            {stage.stageType && (
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: '0.15em',
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  marginTop: 4,
                }}
              >
                {stage.stageType}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close gate panel"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '4px 24px 40px', flex: 1 }}>

          {/* ── MATCH CONFIG ── */}
          <SectionHeader
            icon={<Settings2 size={14} color="var(--pipe-text-dim)" />}
            label="MATCH_CONFIG"
          />
          {matchConfig ? (
            <div>
              {matchConfig.matchPhilosophy && (
                <ConfigRow
                  axis="PHILOSOPHY"
                  value={matchConfig.matchPhilosophy}
                  description={PHILOSOPHY_DESC[matchConfig.matchPhilosophy] ?? ''}
                />
              )}
              {matchConfig.tolerance && (
                <ConfigRow
                  axis="TOLERANCE"
                  value={matchConfig.tolerance}
                  description={TOLERANCE_DESC[matchConfig.tolerance] ?? ''}
                />
              )}
              {matchConfig.stageLinkage && (
                <ConfigRow
                  axis="STAGE_LINKAGE"
                  value={matchConfig.stageLinkage === 'shared-repo' ? 'Shared repo' : 'Per stage'}
                  description={LINKAGE_DESC[matchConfig.stageLinkage] ?? ''}
                />
              )}
              {matchConfig.automationGranularity && (
                <ConfigRow
                  axis="AUTOMATION"
                  value={matchConfig.automationGranularity.replace(/-/g, ' ')}
                  description={AUTOMATION_DESC[matchConfig.automationGranularity] ?? ''}
                />
              )}
              {matchConfig.hybridMixRatio !== null && matchConfig.hybridMixRatio !== undefined && (
                <ConfigRow
                  axis="HYBRID_MIX_RATIO"
                  value={`${Math.round(matchConfig.hybridMixRatio * 100)}% role / ${Math.round((1 - matchConfig.hybridMixRatio) * 100)}% standard`}
                  description="Proportion of role-tailored vs standardised challenge weight."
                />
              )}
              <div
                style={{
                  marginTop: 14,
                  fontSize: 9,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  lineHeight: 1.6,
                  padding: '10px 12px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border-light)',
                  borderRadius: 4,
                }}
              >
                Config inherited from role. Per-stage overrides coming soon.
              </div>
            </div>
          ) : (
            <div
              style={{
                fontSize: 11,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                lineHeight: 1.6,
                padding: '12px 14px',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border-light)',
                borderRadius: 4,
              }}
            >
              No match config set. Run the Role Discovery wizard to configure automatic repo matching.
            </div>
          )}

          {/* ── REPO CONFIG ── */}
          <SectionHeader
            icon={<GitBranch size={14} color="var(--pipe-text-dim)" />}
            label="REPO_CONFIG"
          />
          <div
            style={{
              padding: '14px 16px',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border-light)',
              borderRadius: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>SELECTION METHOD</span>
              <span style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace' }}>
                {matchConfig?.stageLinkage === 'shared-repo' ? 'Shared repo (auto-matched)' : matchConfig?.stageLinkage === 'per-stage' ? 'Per-stage (auto-matched)' : 'Not configured'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>MATCH SIGNALS</span>
              <span style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace' }}>Non-negotiable skills + seniority</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.1em' }}>CHALLENGE TYPES</span>
              <span style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace' }}>Code review + Implementation</span>
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 9,
                color: '#60a5fa',
                fontFamily: '"Space Mono", monospace',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'default',
              }}
            >
              <ChevronRight size={10} />
              Repo details + PR/issue selection
              <ComingSoonBadge />
            </div>
          </div>

          {/* ── CANDIDATES AT GATE ── */}
          <SectionHeader
            icon={<Users size={14} color="var(--pipe-text-dim)" />}
            label="CANDIDATES_AT_GATE"
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
            }}
          >
            {([
              ['INVITED', invited, 'var(--pipe-text-muted)'],
              ['IN PROGRESS', inProgress, '#60a5fa'],
              ['COMPLETED', completed, '#4ade80'],
            ] as [string, number, string][]).map(([label, count, color]) => (
              <div
                key={label}
                style={{
                  padding: '14px 12px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border-light)',
                  borderRadius: 6,
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color,
                    fontFamily: '"Space Mono", monospace',
                    lineHeight: 1,
                    marginBottom: 6,
                  }}
                >
                  {count}
                </div>
                <div
                  style={{
                    fontSize: 7,
                    letterSpacing: '0.2em',
                    color: 'var(--pipe-text-dim)',
                    fontFamily: '"Space Mono", monospace',
                  }}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>

          {/* Candidate filtering — coming soon */}
          <div
            style={{
              marginTop: 14,
              padding: '12px 14px',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border-light)',
              borderRadius: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.15em', fontWeight: 700 }}>
                SCORE_GATE_THRESHOLD
              </span>
              <ComingSoonBadge />
            </div>
            <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', lineHeight: 1.5 }}>
              Set a minimum score to automatically advance candidates to the next stage.
            </div>
          </div>

          {/* ── EMAIL AUTOMATION ── */}
          <SectionHeader
            icon={<Mail size={14} color="var(--pipe-text-dim)" />}
            label="EMAIL_AUTOMATION"
          />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {[
              ['STAGE_INVITE', 'Sent when candidate is advanced to this stage'],
              ['REMINDER_24H', 'Sent 24 h before stage deadline expires'],
              ['STAGE_COMPLETE', 'Sent when candidate submits their work'],
            ].map(([name, desc]) => (
              <div
                key={name}
                style={{
                  padding: '12px 14px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border-light)',
                  borderRadius: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace', fontWeight: 700, marginBottom: 4 }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', lineHeight: 1.5 }}>
                    {desc}
                  </div>
                </div>
                <ComingSoonBadge />
              </div>
            ))}
          </div>

        </div>
      </div>
    </>,
    document.body,
  );
}
