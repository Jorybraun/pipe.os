/**
 * HeroSection — big name + seniority badge + domain pill + years.
 */

import { LiquidMetalCard } from '../../';

interface HeroSectionProps {
  props: {
    name?: string;
    seniority?: string;
    primaryLanguage?: string;
    yearsExperience?: number;
    domain?: string;
  };
}

export function HeroSection({ props }: HeroSectionProps): JSX.Element {
  const { name, seniority, primaryLanguage, yearsExperience, domain } = props;

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {name && (
          <h2
            style={{
              fontSize: 28,
              fontWeight: 900,
              color: 'var(--pipe-text, #fff)',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            {name}
          </h2>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {seniority && (
            <span
              style={{
                padding: '4px 10px',
                background: 'rgba(96,165,250,0.1)',
                border: '1px solid rgba(96,165,250,0.25)',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                color: '#60a5fa',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {seniority}
            </span>
          )}
          {primaryLanguage && primaryLanguage !== 'unknown' && (
            <span
              style={{
                padding: '4px 10px',
                background: 'rgba(16,185,129,0.1)',
                border: '1px solid rgba(16,185,129,0.25)',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                color: '#10b981',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {primaryLanguage}
            </span>
          )}
          {domain && domain !== 'general' && (
            <span
              style={{
                padding: '4px 10px',
                background: 'rgba(251,191,36,0.1)',
                border: '1px solid rgba(251,191,36,0.25)',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                color: '#fbbf24',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {domain}
            </span>
          )}
          {yearsExperience != null && yearsExperience > 0 && (
            <span
              style={{
                padding: '4px 10px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.08em',
              }}
            >
              {yearsExperience} YRS EXP
            </span>
          )}
        </div>
      </div>
    </LiquidMetalCard>
  );
}
