/**
 * SkillLandscapeSection — horizontal bars (proficiency).
 */

import { LiquidMetalCard, SubTitle } from '../../';

interface DecomposedSkill {
  name: string;
  proficiency: 'expert' | 'proficient' | 'familiar' | 'exposure';
  years_exposure?: number;
  depth_pattern?: string;
}

interface SkillLandscapeSectionProps {
  props: {
    skills: DecomposedSkill[];
  };
}

const PROFICIENCY_WIDTH: Record<string, number> = {
  expert: 100,
  proficient: 75,
  familiar: 50,
  exposure: 25,
};

const PROFICIENCY_COLOR: Record<string, string> = {
  expert: '#10b981',
  proficient: '#60a5fa',
  familiar: '#fbbf24',
  exposure: 'var(--pipe-text-dim)',
};

export function SkillLandscapeSection({ props }: SkillLandscapeSectionProps): JSX.Element {
  const { skills } = props;

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <SubTitle>SKILL LANDSCAPE</SubTitle>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {skills.map((skill, i) => {
          const width = PROFICIENCY_WIDTH[skill.proficiency] ?? 50;
          const color = PROFICIENCY_COLOR[skill.proficiency] ?? 'var(--pipe-text-dim)';
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--pipe-text, #fff)' }}>
                  {skill.name}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: 'var(--pipe-text-dim)',
                    fontFamily: '"Space Mono", monospace',
                    textTransform: 'uppercase',
                  }}
                >
                  {skill.proficiency}
                  {skill.years_exposure ? ` · ${skill.years_exposure}Y` : ''}
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${width}%`,
                    height: '100%',
                    background: color,
                    borderRadius: 2,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </LiquidMetalCard>
  );
}
