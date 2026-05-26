/**
 * CareerContextSection — key-value pairs + tag pills.
 */

import { LiquidMetalCard, SubTitle } from '../../';

interface CareerContextSectionProps {
  props: Record<string, unknown>;
}

export function CareerContextSection({ props }: CareerContextSectionProps): JSX.Element {
  const entries = Object.entries(props).filter(([, v]) =>
    Array.isArray(v) ? v.length > 0 : v != null && v !== '' && v !== 'unknown',
  );

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <SubTitle>CAREER CONTEXT</SubTitle>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {entries.map(([key, value]) => {
          const isArray = Array.isArray(value);
          const display = isArray
            ? (value as string[]).join(', ')
            : typeof value === 'number'
              ? String(value)
              : String(value);
          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
              {isArray ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(value as string[]).map((item) => (
                    <span
                      key={item}
                      style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        background: 'rgba(96,165,250,0.06)',
                        border: '1px solid rgba(96,165,250,0.12)',
                        borderRadius: 4,
                        fontSize: 9,
                        fontWeight: 700,
                        color: 'rgba(96,165,250,0.7)',
                        fontFamily: '"Space Mono", monospace',
                      }}
                    >
                      {item.toUpperCase()}
                    </span>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--pipe-text-muted)' }}>{display}</span>
              )}
            </div>
          );
        })}
      </div>
    </LiquidMetalCard>
  );
}
