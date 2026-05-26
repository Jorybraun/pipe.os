/**
 * CareerArcSection — narrative + velocity badge + transition arrows.
 */

import { ArrowRight } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../../';

interface CareerArcSectionProps {
  props: {
    narrative?: string;
    growth_velocity?: 'fast' | 'normal' | 'slow';
    transitions?: Array<{ from: string; to: string; at_company: string }>;
  };
}

export function CareerArcSection({ props }: CareerArcSectionProps): JSX.Element {
  const { narrative, growth_velocity, transitions } = props;

  const velocityColor =
    growth_velocity === 'fast'
      ? '#10b981'
      : growth_velocity === 'normal'
        ? '#60a5fa'
        : 'var(--pipe-text-dim)';

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <SubTitle>CAREER ARC</SubTitle>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {growth_velocity && (
          <span
            style={{
              display: 'inline-flex',
              alignSelf: 'flex-start',
              padding: '4px 10px',
              background: `${velocityColor}14`,
              border: `1px solid ${velocityColor}40`,
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              color: velocityColor,
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {growth_velocity} GROWTH
          </span>
        )}
        {narrative && (
          <div style={{ fontSize: 13, color: 'var(--pipe-text-muted)', lineHeight: 1.7 }}>
            {narrative}
          </div>
        )}
        {transitions && transitions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {transitions.map((t, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 6,
                  fontSize: 11,
                  color: 'var(--pipe-text-muted)',
                }}
              >
                <span style={{ fontWeight: 700, color: 'var(--pipe-text, #fff)' }}>{t.from}</span>
                <ArrowRight size={12} color="var(--pipe-text-dim)" />
                <span style={{ fontWeight: 700, color: 'var(--pipe-text, #fff)' }}>{t.to}</span>
                <span style={{ color: 'var(--pipe-text-dim)', marginLeft: 4 }}>@ {t.at_company}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </LiquidMetalCard>
  );
}
