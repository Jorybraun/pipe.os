/**
 * ProjectShowcaseSection — cards with name, description, skills, URL link.
 */

import { ExternalLink } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../../';

interface DecomposedProject {
  name: string;
  description: string;
  url?: string;
  skills_demonstrated?: string[];
}

interface ProjectShowcaseSectionProps {
  props: {
    projects: DecomposedProject[];
  };
}

export function ProjectShowcaseSection({ props }: ProjectShowcaseSectionProps): JSX.Element {
  const { projects } = props;

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <SubTitle>PROJECT SHOWCASE</SubTitle>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {projects.map((proj, i) => (
          <div
            key={i}
            style={{
              padding: '16px 20px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--pipe-text, #fff)' }}>
                {proj.name}
              </span>
              {proj.url && (
                <a
                  href={proj.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#60a5fa' }}
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
            {proj.description && (
              <span style={{ fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.5 }}>
                {proj.description}
              </span>
            )}
            {proj.skills_demonstrated && proj.skills_demonstrated.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                {proj.skills_demonstrated.map((skill) => (
                  <span
                    key={skill}
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
                    {skill.toUpperCase()}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </LiquidMetalCard>
  );
}
