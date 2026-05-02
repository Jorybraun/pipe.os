/**
 * MatchScoreSection — big score + dimension bars + match/mismatch tags.
 */

import { GitBranch } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../../';

interface MatchScoreSectionProps {
  props: {
    score: number | null;
    dimensions?: {
      skillCoverage: number;
      semanticSimilarity: number;
      situationFit: number;
      roleAlignment: number;
    };
    reasoning?: {
      matches: string[];
      mismatches: string[];
    };
    philosophy?: string;
    repoName?: string;
    repoUrl?: string;
  };
}

function getScoreColor(score: number | null): string {
  if (score === null) return 'var(--pipe-text-dim)';
  if (score >= 0.70) return '#10b981';
  if (score >= 0.40) return '#fbbf24';
  return '#f87171';
}

function DimensionBar({ label, value }: { label: string; value: number }): JSX.Element {
  const color = getScoreColor(value);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 9,
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, color, fontFamily: '"Space Mono", monospace' }}>
          {Math.round(value * 100)}
        </span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.min(100, Math.max(0, value * 100))}%`,
            height: '100%',
            background: color,
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

export function MatchScoreSection({ props }: MatchScoreSectionProps): JSX.Element {
  const { score, dimensions, reasoning, philosophy, repoName, repoUrl } = props;
  const scoreColor = getScoreColor(score);

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <SubTitle>REPO MATCH</SubTitle>
        {philosophy && (
          <span
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              background: 'rgba(96,165,250,0.08)',
              border: '1px solid rgba(96,165,250,0.2)',
              borderRadius: 4,
              fontSize: 9,
              fontWeight: 700,
              color: '#60a5fa',
              letterSpacing: '0.08em',
              fontFamily: '"Space Mono", monospace',
              textTransform: 'uppercase',
            }}
          >
            {philosophy}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {repoName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <GitBranch size={16} color="var(--pipe-accent)" />
            {repoUrl ? (
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'var(--pipe-accent)',
                  fontFamily: '"Space Mono", monospace',
                  textDecoration: 'none',
                }}
              >
                {repoName}
              </a>
            ) : (
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pipe-text)', fontFamily: '"Space Mono", monospace' }}>
                {repoName}
              </span>
            )}
          </div>
        )}

        {score !== null && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <div style={{ fontSize: 56, fontWeight: 900, color: scoreColor, lineHeight: 1, letterSpacing: '-0.04em' }}>
                {Math.round((score ?? 0) * 100)}
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.15em',
                }}
              >
                TRIANGULATED
              </div>
            </div>
          </div>
        )}

        {dimensions && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                fontSize: 9,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.15em',
                marginBottom: 4,
                textTransform: 'uppercase',
              }}
            >
              DIMENSION BREAKDOWN
            </div>
            <DimensionBar label="SKILL COVERAGE" value={dimensions.skillCoverage} />
            <DimensionBar label="SEMANTIC SIMILARITY" value={dimensions.semanticSimilarity} />
            <DimensionBar label="SITUATION FIT" value={dimensions.situationFit} />
            <DimensionBar label="ROLE ALIGNMENT" value={dimensions.roleAlignment} />
          </div>
        )}

        {reasoning && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {reasoning.matches.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 9,
                    color: '#10b981',
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: '0.15em',
                    marginBottom: 10,
                    textTransform: 'uppercase',
                  }}
                >
                  MATCHES
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {reasoning.matches.map((m, i) => (
                    <span
                      key={i}
                      style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        background: 'rgba(16,185,129,0.08)',
                        border: '1px solid rgba(16,185,129,0.15)',
                        borderRadius: 4,
                        fontSize: 9,
                        fontWeight: 700,
                        color: '#10b981',
                        fontFamily: '"Space Mono", monospace',
                      }}
                    >
                      {m.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {reasoning.mismatches.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 9,
                    color: '#fbbf24',
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: '0.15em',
                    marginBottom: 10,
                    textTransform: 'uppercase',
                  }}
                >
                  MISMATCHES
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {reasoning.mismatches.map((m, i) => (
                    <span
                      key={i}
                      style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        background: 'rgba(251,191,36,0.08)',
                        border: '1px solid rgba(251,191,36,0.15)',
                        borderRadius: 4,
                        fontSize: 9,
                        fontWeight: 700,
                        color: '#fbbf24',
                        fontFamily: '"Space Mono", monospace',
                      }}
                    >
                      {m.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </LiquidMetalCard>
  );
}
