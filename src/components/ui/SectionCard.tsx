import { type ReactNode } from 'react';
import { LiquidMetalCard, type LiquidMetalCardVariant } from './LiquidMetalCard';
import { SubTitle } from './SubTitle';

/**
 * Props for the SectionCard component.
 */
export interface SectionCardProps {
  /** Required section label, rendered uppercase in the header via SubTitle. */
  label: string;

  /** Optional leading icon (usually a lucide-react icon component instance). */
  icon?: ReactNode;

  /** Optional right-aligned metadata (e.g. counts, status). */
  meta?: ReactNode;

  /** Card body. */
  children: ReactNode;

  /** LiquidMetalCard variant. Defaults to 'default'. */
  variant?: LiquidMetalCardVariant;

  /** Override body padding. Defaults to '32px'. */
  bodyPadding?: string | number;

  /** Optional data-testid for the wrapper. */
  'data-testid'?: string;
}

/**
 * SectionCard — the single labeled-card primitive for the Pipe recruiter UI.
 *
 * Wraps LiquidMetalCard with the pattern that was previously duplicated inline
 * across pages (see the challenge editors): a header row with an optional icon
 * + uppercase label + optional meta, a divider, and a padded body.
 *
 * Every new surface in the pipeline overview and stage detail redesign should
 * use this component instead of building its own card chrome, so the whole
 * area reads as one cohesive design.
 *
 * @example
 * ```tsx
 * <SectionCard label="ROLE_PROFILE" icon={<Sparkles size={16} />} meta="12 SIGNALS">
 *   ...
 * </SectionCard>
 * ```
 */
export function SectionCard({
  label,
  icon,
  meta,
  children,
  variant = 'default',
  bodyPadding = '32px',
  'data-testid': dataTestId,
}: SectionCardProps): JSX.Element {
  return (
    <LiquidMetalCard variant={variant} style={{ padding: 0, borderRadius: 16 }}>
      <div data-testid={dataTestId}>
        <div
          style={{
            padding: '24px 32px',
            borderBottom: '1px solid var(--pipe-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {icon}
            <SubTitle>{label}</SubTitle>
          </div>
          {meta !== undefined && (
            <span
              style={{
                fontSize: 9,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.1em',
              }}
            >
              {meta}
            </span>
          )}
        </div>
        <div style={{ padding: bodyPadding }}>{children}</div>
      </div>
    </LiquidMetalCard>
  );
}
