/**
 * EducationSection — institution + degree + field + year cards.
 */

import { GraduationCap } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../../';

interface DecomposedEducation {
  institution: string;
  degree: string;
  field?: string;
  year?: string;
}

interface EducationSectionProps {
  props: {
    education: DecomposedEducation[];
  };
}

export function EducationSection({ props }: EducationSectionProps): JSX.Element {
  const { education } = props;

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <SubTitle>EDUCATION</SubTitle>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {education.map((edu, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '14px 18px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 8,
            }}
          >
            <GraduationCap size={16} color="var(--pipe-text-dim)" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--pipe-text, #fff)' }}>
                {edu.institution}
              </span>
              <span style={{ fontSize: 11, color: 'var(--pipe-text-muted)' }}>
                {edu.degree}
                {edu.field ? ` · ${edu.field}` : ''}
              </span>
              {edu.year && (
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--pipe-text-dim)',
                    fontFamily: '"Space Mono", monospace',
                  }}
                >
                  {edu.year}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </LiquidMetalCard>
  );
}
