import type { RubricDimension } from '../../../types/question';
import { SubTitle } from '../../ui/SubTitle';
import { LiquidMetalCard } from '../../ui/LiquidMetalCard';

/**
 * Props for the RubricTab component.
 */
export interface RubricTabProps {
  /**
   * Array of rubric dimensions to display.
   */
  rubric: RubricDimension[];
}

/**
 * Rubric tab - displays scoring criteria and weights.
 *
 * Display-only component showing rubric dimensions, their descriptions,
 * and weight percentages for candidate evaluation.
 */
export function RubricTab({ rubric }: RubricTabProps): JSX.Element {
  return (
    <div>
      <SubTitle>SCORING_RUBRIC</SubTitle>

      <p style={{ fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.7, margin: '16px 0 24px' }}>
        Define the criteria used to evaluate candidate responses. Each criterion has a weight that contributes to the overall score.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rubric.map((dimension) => (
          <LiquidMetalCard key={dimension.id} variant="default" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pipe-text, #fff)' }}>
                {dimension.name}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'rgba(150,255,150,0.8)' }}>
                {dimension.weight}%
              </div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--pipe-text-muted)', lineHeight: 1.6 }}>
              {dimension.description}
            </div>
          </LiquidMetalCard>
        ))}
      </div>
    </div>
  );
}
