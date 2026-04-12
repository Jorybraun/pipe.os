import type { JSX } from 'react';
import type { DomainCoverage } from '../../lib/api/types';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DOMAIN_LABELS: Record<string, string> = {
  why: 'WHY', work: 'WORK', team: 'TEAM', bar: 'BAR', codebase: 'CODE', process: 'PROC',
};
export const COVERAGE_LEVELS: Record<DomainCoverage, number> = {
  none: 0, sparse: 0.2, partial: 0.45, covered: 0.75, deep: 1,
};
export const COVERAGE_COLORS: Record<DomainCoverage, string> = {
  none: 'var(--pipe-border-light)',
  sparse: 'rgba(251, 191, 36, 0.4)',
  partial: 'rgba(251, 191, 36, 0.65)',
  covered: 'rgba(74, 222, 128, 0.6)',
  deep: 'rgba(74, 222, 128, 0.9)',
};

// ─── DomainBars ──────────────────────────────────────────────────────────────

export function DomainBars({ domains }: { domains: Record<string, DomainCoverage> }): JSX.Element {
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
