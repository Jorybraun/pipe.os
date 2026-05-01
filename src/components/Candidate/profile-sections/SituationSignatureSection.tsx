/**
 * SituationSignatureSection — tag grids per category.
 */

import { LiquidMetalCard, SubTitle } from '../../';

interface SituationSignatureSectionProps {
  props: Record<string, unknown>;
}

export function SituationSignatureSection({ props }: SituationSignatureSectionProps): JSX.Element {
  const entries = Object.entries(props).filter(([, v]) =>
    Array.isArray(v) ? v.length > 0 : v != null && v !== '' && v !== 'unknown',
  );

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <SubTitle>SITUATION SIGNATURE</SubTitle>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {entries.map(([key, value]) => {
          const tags = Array.isArray(value)
            ? value.filter((v): v is string => typeof v === 'string')
            : typeof value === 'string'
              ? [value]
              : [];
          if (tags.length === 0) return null;
          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span
                style={{
                  fontSize: 9,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                }}
              >
                {key.replace(/_/g, ' ')}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      display: 'inline-block',
                      padding: '3px 8px',
                      background: 'rgba(251,191,36,0.06)',
                      border: '1px solid rgba(251,191,36,0.12)',
                      borderRadius: 4,
                      fontSize: 9,
                      fontWeight: 700,
                      color: 'rgba(251,191,36,0.8)',
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    {tag.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </LiquidMetalCard>
  );
}
