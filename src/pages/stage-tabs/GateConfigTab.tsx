/**
 * GateConfigTab — /pipeline/:id/stage/:stageId/gate
 *
 * Entry-config page for a stage gate. Shows the conditions a candidate must
 * meet to enter this stage: score threshold from the previous stage, inherited
 * match config, and email triggers fired on entry.
 */

import { useOutletContext } from 'react-router-dom';
import { GitMerge, Settings2, Mail } from 'lucide-react';
import type { StagePanelContext } from '../StagePanel';
import type { OverviewMatchConfig } from '../../lib/api/types';

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

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 14,
        marginTop: 32,
        paddingBottom: 10,
        borderBottom: '1px solid var(--pipe-border-light)',
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

function ConfigRow({ axis, value, description }: { axis: string; value: string; description: string }): JSX.Element {
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--pipe-border-light)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', fontWeight: 700 }}>
          {axis}
        </div>
        <div style={{ fontSize: 10, fontFamily: '"Space Mono", monospace', color: 'var(--pipe-text)', fontWeight: 700, letterSpacing: '0.05em', textAlign: 'right', flexShrink: 0 }}>
          {value.toUpperCase()}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.55, fontFamily: '"Space Mono", monospace' }}>
        {description}
      </div>
    </div>
  );
}

function ComingSoon(): JSX.Element {
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

function MatchConfigSection({ matchConfig }: { matchConfig: OverviewMatchConfig }): JSX.Element {
  return (
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
  );
}

export default function GateConfigTab(): JSX.Element {
  const { shell, stage } = useOutletContext<StagePanelContext>();
  const { matchConfig, stages } = shell;

  // The stage that feeds this gate — the one immediately before in sort order.
  const prevStage = stages.find((s) => s.sortOrder === stage.order - 1) ?? null;

  return (
    <div data-testid="stage-tab-content-gate">
      {/* Gate identity */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '18px 20px',
          background: 'var(--pipe-surface)',
          border: '1px solid var(--pipe-border-light)',
          borderRadius: 8,
          marginBottom: 4,
        }}
      >
        <GitMerge size={16} color="#60a5fa" />
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>
            GATE — ENTRY_CONDITIONS
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace' }}>
            {prevStage ? `${prevStage.title} → ${stage.title}` : `Enter ${stage.title}`}
          </div>
          {prevStage && (
            <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginTop: 3 }}>
              Candidates leaving <span style={{ color: 'var(--pipe-text-muted)' }}>{prevStage.title}</span> must pass this gate to enter <span style={{ color: 'var(--pipe-text-muted)' }}>{stage.title}</span>.
            </div>
          )}
        </div>
      </div>

      {/* Score gate threshold */}
      <SectionHeader
        icon={<Settings2 size={14} color="var(--pipe-text-dim)" />}
        label="SCORE_GATE_THRESHOLD"
      />
      <div
        style={{
          padding: '16px 18px',
          background: 'var(--pipe-surface)',
          border: '1px solid var(--pipe-border-light)',
          borderRadius: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace', fontWeight: 700, letterSpacing: '0.1em' }}>
            MINIMUM_SCORE_TO_ADVANCE
          </span>
          <ComingSoon />
        </div>
        <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', lineHeight: 1.55 }}>
          Set a minimum score from {prevStage ? `the ${prevStage.title} stage` : 'the previous stage'} to automatically advance candidates through this gate.
        </div>
      </div>

      {/* Match config */}
      <SectionHeader
        icon={<Settings2 size={14} color="var(--pipe-text-dim)" />}
        label="MATCH_CONFIG"
      />
      {matchConfig ? (
        <MatchConfigSection matchConfig={matchConfig} />
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

      {/* Email triggers */}
      <SectionHeader
        icon={<Mail size={14} color="var(--pipe-text-dim)" />}
        label="EMAIL_TRIGGERS"
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {([
          ['STAGE_INVITE', 'Sent when candidate is advanced to this stage'],
          ['REMINDER_24H', 'Sent 24 h before stage deadline expires'],
          ['STAGE_COMPLETE', 'Sent when candidate submits their work'],
        ] as [string, string][]).map(([name, desc]) => (
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
            <ComingSoon />
          </div>
        ))}
      </div>
    </div>
  );
}
