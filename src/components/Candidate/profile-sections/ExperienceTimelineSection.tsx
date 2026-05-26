/**
 * ExperienceTimelineSection — vertical timeline with company, role, duration, domain color.
 */

import { LiquidMetalCard, SubTitle } from '../../';

interface DecomposedExperience {
  company: string;
  role: string;
  duration_months?: number;
  domain?: string;
  company_stage?: string;
  impact_summary?: string;
  narrative?: string;
  skills_demonstrated?: string[];
}

interface ExperienceTimelineSectionProps {
  props: {
    experiences: DecomposedExperience[];
  };
}

export function ExperienceTimelineSection({ props }: ExperienceTimelineSectionProps): JSX.Element {
  const { experiences } = props;

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <SubTitle>EXPERIENCE TIMELINE</SubTitle>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {experiences.map((exp, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 16,
              padding: '16px 20px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 8,
            }}
          >
            <div
              style={{
                width: 3,
                borderRadius: 2,
                background: 'var(--pipe-accent)',
                flexShrink: 0,
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: 'var(--pipe-text, #fff)',
                  }}
                >
                  {exp.company}
                </span>
                {exp.duration_months != null && (
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    {Math.round(exp.duration_months / 12 * 10) / 10} YRS
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12, color: 'var(--pipe-text-muted)' }}>{exp.role}</span>
              {exp.impact_summary && (
                <span style={{ fontSize: 11, color: 'var(--pipe-text-dim)', lineHeight: 1.5 }}>
                  {exp.impact_summary}
                </span>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {exp.domain && (
                  <span
                    style={{
                      padding: '2px 6px',
                      background: 'rgba(96,165,250,0.06)',
                      border: '1px solid rgba(96,165,250,0.12)',
                      borderRadius: 3,
                      fontSize: 8,
                      fontWeight: 700,
                      color: 'rgba(96,165,250,0.7)',
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    {exp.domain.toUpperCase()}
                  </span>
                )}
                {exp.company_stage && (
                  <span
                    style={{
                      padding: '2px 6px',
                      background: 'rgba(16,185,129,0.06)',
                      border: '1px solid rgba(16,185,129,0.12)',
                      borderRadius: 3,
                      fontSize: 8,
                      fontWeight: 700,
                      color: 'rgba(16,185,129,0.7)',
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    {exp.company_stage.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </LiquidMetalCard>
  );
}
