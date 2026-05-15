import { useMemo } from 'react';

export type CoveragePhase =
  | 'consent'
  | 'rapport_building'
  | 'probing'
  | 'drilling'
  | 'wrap_up'
  | 'scoring'
  | 'complete';

interface CoverageProgressProps {
  coverage: Record<string, number>;
  phase: CoveragePhase;
  turnsAsked: number;
  totalBudget: number;
}

const PHASE_LABELS: Record<CoveragePhase, string> = {
  consent: 'Consent',
  rapport_building: 'Rapport',
  probing: 'Probing',
  drilling: 'Drilling',
  wrap_up: 'Wrap-up',
  scoring: 'Scoring',
  complete: 'Complete',
};

const PHASE_COLORS: Record<CoveragePhase, string> = {
  consent: 'rgba(255,255,255,0.2)',
  rapport_building: '#60a5fa',
  probing: '#a78bfa',
  drilling: '#fbbf24',
  wrap_up: '#34d399',
  scoring: '#f87171',
  complete: '#34d399',
};

function coverageToColor(depth: number): string {
  if (depth >= 3) return '#34d399';
  if (depth >= 2) return '#60a5fa';
  if (depth >= 1) return '#fbbf24';
  return 'rgba(255,255,255,0.15)';
}

function coverageLabel(depth: number): string {
  if (depth >= 3) return 'deep';
  if (depth >= 2) return 'good';
  if (depth >= 1) return 'surface';
  return 'none';
}

export function CoverageProgress({
  coverage,
  phase,
  turnsAsked,
  totalBudget,
}: CoverageProgressProps): JSX.Element {
  const dimensions = useMemo(() => {
    return Object.entries(coverage).sort(([a], [b]) => a.localeCompare(b));
  }, [coverage]);

  const coveredCount = useMemo(
    () => dimensions.filter(([, d]) => d >= 2).length,
    [dimensions],
  );

  const maxDepth = 3;

  return (
    <div
      style={{
        background: 'rgba(12, 12, 14, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '16px 18px',
        width: 220,
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 9,
            letterSpacing: '0.15em',
            color: 'var(--pipe-text-dim)',
            fontWeight: 700,
          }}
        >
          COVERAGE
        </span>
        <span
          style={{
            fontSize: 9,
            color: PHASE_COLORS[phase],
            fontWeight: 700,
            letterSpacing: '0.05em',
          }}
        >
          {PHASE_LABELS[phase].toUpperCase()}
        </span>
      </div>

      {/* Budget bar */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 9,
            color: 'var(--pipe-text-dim)',
            marginBottom: 4,
          }}
        >
          <span>QUESTIONS</span>
          <span>
            {turnsAsked}/{totalBudget}
          </span>
        </div>
        <div
          style={{
            height: 3,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.min((turnsAsked / totalBudget) * 100, 100)}%`,
              background: 'linear-gradient(90deg, #60a5fa, #a78bfa)',
              borderRadius: 2,
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* Dimension bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dimensions.map(([dim, depth]) => {
          const label = dim
            .replace(/_/g, ' ')
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
          return (
            <div key={dim}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 9,
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: 3,
                }}
              >
                <span>{label}</span>
                <span style={{ color: coverageToColor(depth), fontSize: 8 }}>
                  {coverageLabel(depth)}
                </span>
              </div>
              <div
                style={{
                  height: 3,
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min((depth / maxDepth) * 100, 100)}%`,
                    background: coverageToColor(depth),
                    borderRadius: 2,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: 9,
          color: 'var(--pipe-text-dim)',
          textAlign: 'center',
        }}
      >
        {coveredCount}/{dimensions.length} dimensions covered
      </div>
    </div>
  );
}
