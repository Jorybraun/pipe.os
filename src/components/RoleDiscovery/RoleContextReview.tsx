/**
 * RoleContextReview — Displays the Role Context Document in three sections
 * with per-attribute calibration flags.
 */

import { useState, useCallback } from 'react';
import { Flag, AlertTriangle, Plus, Loader2 } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { GapFillModal } from './GapFillModal';
import type {
  RoleContextDocument,
  LadderingChain,
  DomainCell,
  StakeholderType,
  Domain,
} from '../../lib/api/types';

interface RoleContextReviewProps {
  rcd: RoleContextDocument | null;
  contextId: string | null;
  onFlagAttribute: (
    flagType: string,
    domain: string,
    attribute: string,
    note?: string,
  ) => Promise<{ question: string }>;
  onSubmitGapAnswer: (answer: string) => Promise<unknown>;
  onRcdUpdated: () => Promise<void>;
}

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: 8,
  letterSpacing: '0.25em',
  color: 'rgba(255,255,255,0.25)',
  fontFamily: '"Space Mono", monospace',
  marginBottom: 12,
};

const CARD_STYLE: React.CSSProperties = {
  padding: 20,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6,
  marginBottom: 16,
};

function EnergyDot({ signal }: { signal: LadderingChain['energy_signal'] }): JSX.Element {
  const color =
    signal === 'high'
      ? 'rgba(74, 222, 128, 0.8)'
      : signal === 'medium'
        ? 'rgba(251, 191, 36, 0.8)'
        : signal === 'low'
          ? 'rgba(252, 165, 165, 0.8)'
          : 'rgba(255,255,255,0.2)';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        marginRight: 8,
      }}
      title={`Energy: ${signal}`}
    />
  );
}

function LadderingCard({
  chain,
  onFlag,
  isFlagging,
}: {
  chain: LadderingChain;
  onFlag: (flagType: string, attribute: string) => void;
  isFlagging: boolean;
}): JSX.Element {
  return (
    <div style={CARD_STYLE} data-testid="laddering-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace', marginBottom: 8, lineHeight: 1.5 }}>
            <EnergyDot signal={chain.energy_signal} />
            {chain.consequence}
          </div>
          <div style={{ fontSize: 11, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace', lineHeight: 1.6, marginBottom: 6 }}>
            “{chain.attribute_quote}”
          </div>
          <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
            TURN {chain.source_exchange_id} · VALUE: {chain.value} · CONFIDENCE: {chain.confidence}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <FlagButton
          label="Not quite right"
          icon={<Flag size={10} />}
          onClick={() => onFlag('inaccurate', chain.consequence)}
          disabled={isFlagging}
          testId="flag-button-inaccurate"
        />
        <FlagButton
          label="Missing evidence"
          icon={<AlertTriangle size={10} />}
          onClick={() => onFlag('missing_evidence', chain.consequence)}
          disabled={isFlagging}
          testId="flag-button-missing-evidence"
        />
        <FlagButton
          label="Add detail"
          icon={<Plus size={10} />}
          onClick={() => onFlag('add_detail', chain.consequence)}
          disabled={isFlagging}
          testId="flag-button-add-detail"
        />
      </div>
    </div>
  );
}

function FlagButton({
  label,
  icon,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  icon: JSX.Element;
  onClick: () => void;
  disabled: boolean;
  testId?: string;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{
        padding: '5px 10px',
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'var(--pipe-text-dim)',
        fontSize: 9,
        letterSpacing: '0.08em',
        fontFamily: '"Space Mono", monospace',
        cursor: disabled ? 'default' : 'pointer',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseOver={(e) => {
        if (!disabled) {
          e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.4)';
          e.currentTarget.style.color = 'rgba(251, 191, 36, 0.85)';
        }
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
        e.currentTarget.style.color = 'var(--pipe-text-dim)';
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function collectDomainChains(
  rcd: RoleContextDocument,
  domain: Domain,
): Array<{ stakeholder: StakeholderType; cell: DomainCell; chain: LadderingChain }> {
  const out: Array<{ stakeholder: StakeholderType; cell: DomainCell; chain: LadderingChain }> = [];
  for (const [stakeholder, domains] of Object.entries(rcd.domain_matrix)) {
    const cell = domains?.[domain];
    if (!cell) continue;
    for (const chain of cell.laddering_chains) {
      out.push({ stakeholder: stakeholder as StakeholderType, cell, chain });
    }
  }
  return out;
}

export function RoleContextReview({
  rcd,
  contextId,
  onFlagAttribute,
  onSubmitGapAnswer,
  onRcdUpdated,
}: RoleContextReviewProps): JSX.Element {
  const [gapQuestion, setGapQuestion] = useState<string | null>(null);
  const [isFlagging, setIsFlagging] = useState(false);

  const handleFlag = useCallback(
    async (flagType: string, domain: string, attribute: string): Promise<void> => {
      if (!contextId || isFlagging) return;
      setIsFlagging(true);
      try {
        const res = await onFlagAttribute(flagType, domain, attribute);
        setGapQuestion(res.question);
      } catch {
        // Error surfaced by API client — modal stays closed
      } finally {
        setIsFlagging(false);
      }
    },
    [contextId, isFlagging, onFlagAttribute],
  );

  const handleSubmitGap = useCallback(
    async (answer: string): Promise<void> => {
      await onSubmitGapAnswer(answer);
      setGapQuestion(null);
      await onRcdUpdated();
    },
    [onSubmitGapAnswer, onRcdUpdated],
  );

  if (!rcd) {
    return (
      <LiquidMetalCard variant="mercury" style={{ padding: 28, marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
          No Role Context Document generated yet.
        </div>
      </LiquidMetalCard>
    );
  }

  const teamChains = collectDomainChains(rcd, 'team');
  const barChains = collectDomainChains(rcd, 'bar');

  return (
    <>
      <LiquidMetalCard variant="mercury" style={{ padding: 28, marginBottom: 20 }} data-testid="role-context-review">
        {isFlagging && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            <span data-testid="calibration-loading">Contacting calibration agent…</span>
          </div>
        )}

        {/* ── Team Context ── */}
        <div style={{ marginBottom: 28 }} data-testid="role-context-section-team">
          <div style={SECTION_TITLE_STYLE}>TEAM CONTEXT</div>
          {teamChains.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
              No team laddering chains recorded.
            </div>
          ) : (
            teamChains.map((item, i) => (
              <LadderingCard
                key={`team-${item.stakeholder}-${i}`}
                chain={item.chain}
                onFlag={(flagType, attribute) => { void handleFlag(flagType, 'team', attribute); }}
                isFlagging={isFlagging}
              />
            ))
          )}
        </div>

        {/* ── Technical Context ── */}
        <div style={{ marginBottom: 28 }} data-testid="role-context-section-technical">
          <div style={SECTION_TITLE_STYLE}>TECHNICAL CONTEXT</div>
          <div style={CARD_STYLE}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="STACK" value={rcd.technical_context.stack.join(', ')} />
              <Field label="CONSTRUCTS" value={rcd.technical_context.constructs.join(', ')} />
              <Field label="SENIORITY BAND" value={rcd.technical_context.seniority_band} />
              <Field label="CODEBASE EXPECTATIONS" value={rcd.technical_context.codebase_expectations.join(', ')} />
            </div>
            {Object.keys(rcd.technical_context.dispositional_weights).length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.25)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
                  DISPOSITIONAL WEIGHTS
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(rcd.technical_context.dispositional_weights).map(([k, v]) => (
                    <span
                      key={k}
                      style={{
                        fontSize: 10,
                        padding: '4px 10px',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'var(--pipe-text-muted)',
                        fontFamily: '"Space Mono", monospace',
                        borderRadius: 4,
                      }}
                    >
                      {k}: {v.toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Dispositional Context ── */}
        <div data-testid="role-context-section-dispositional">
          <div style={SECTION_TITLE_STYLE}>DISPOSITIONAL CONTEXT</div>
          {barChains.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 16 }}>
              No bar laddering chains recorded.
            </div>
          ) : (
            barChains.map((item, i) => (
              <LadderingCard
                key={`bar-${item.stakeholder}-${i}`}
                chain={item.chain}
                onFlag={(flagType, attribute) => { void handleFlag(flagType, 'bar', attribute); }}
                isFlagging={isFlagging}
              />
            ))
          )}

          {rcd.team_culture_profile && (
            <div style={{ ...CARD_STYLE, marginTop: 16 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.25)', fontFamily: '"Space Mono", monospace', marginBottom: 12 }}>
                TEAM CULTURE PROFILE
              </div>
              {Object.entries(rcd.team_culture_profile.per_stakeholder).map(([stakeholder, scores]) => {
                if (!scores) return null;
                return (
                  <div key={stakeholder} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
                      {stakeholder.replace(/_/g, ' ')}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <CulturePill label="Clan" value={scores.clan_affinity} />
                      <CulturePill label="Adhocracy" value={scores.adhocracy_affinity} />
                      <CulturePill label="Market" value={scores.market_affinity} />
                      <CulturePill label="Hierarchy" value={scores.hierarchy_affinity} />
                      <CulturePill label="Psych Safety" value={scores.psychological_safety} />
                    </div>
                  </div>
                );
              })}
              {rcd.team_culture_profile.aggregated && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
                    AGGREGATED · {rcd.team_culture_profile.aggregated.formula}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <CulturePill label="Clan" value={rcd.team_culture_profile.aggregated.clan_affinity} />
                    <CulturePill label="Adhocracy" value={rcd.team_culture_profile.aggregated.adhocracy_affinity} />
                    <CulturePill label="Market" value={rcd.team_culture_profile.aggregated.market_affinity} />
                    <CulturePill label="Hierarchy" value={rcd.team_culture_profile.aggregated.hierarchy_affinity} />
                    <CulturePill label="Psych Safety" value={rcd.team_culture_profile.aggregated.psychological_safety} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </LiquidMetalCard>

      {gapQuestion && (
        <GapFillModal
          question={gapQuestion}
          onSubmit={handleSubmitGap}
          onClose={() => setGapQuestion(null)}
        />
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.25)', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 11, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace' }}>
        {value || '—'}
      </div>
    </div>
  );
}

function CulturePill({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '3px 8px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'var(--pipe-text-muted)',
        fontFamily: '"Space Mono", monospace',
        borderRadius: 4,
      }}
    >
      {label}: {value}
    </span>
  );
}
