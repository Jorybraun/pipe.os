/**
 * NarrativeSection — prose paragraph + concept tag pills.
 */

import { LiquidMetalCard, SubTitle } from '../../';

interface NarrativeSectionProps {
  props: {
    text: string;
    keyConcepts?: Record<string, unknown>;
  };
}

export function NarrativeSection({ props }: NarrativeSectionProps): JSX.Element {
  const { text, keyConcepts } = props;

  const conceptTags: string[] = [];
  if (keyConcepts && typeof keyConcepts === 'object') {
    const extract = (val: unknown): string[] => {
      if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
      if (typeof val === 'string') return [val];
      return [];
    };
    for (const [key, val] of Object.entries(keyConcepts)) {
      const items = extract(val);
      for (const item of items) {
        conceptTags.push(`${key}: ${item}`);
      }
    }
  }

  return (
    <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <SubTitle>AI PROFILE</SubTitle>
      </div>
      <div
        style={{
          fontSize: 14,
          color: 'var(--pipe-text-muted)',
          lineHeight: 1.7,
          marginBottom: conceptTags.length > 0 ? 20 : 0,
        }}
      >
        {text}
      </div>
      {conceptTags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {conceptTags.map((tag) => (
            <span
              key={tag}
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
              {tag.toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </LiquidMetalCard>
  );
}
