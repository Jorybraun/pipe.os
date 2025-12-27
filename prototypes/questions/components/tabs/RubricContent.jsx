import React from 'react';
import { SubTitle } from '../ui/SubTitle';
import { RubricEditor } from '../RubricEditor';

/**
 * Rubric tab content - stateless presentation component.
 */
export function RubricContent({ dimensions, onDimensionsChange }) {
  return (
    <div>
      <SubTitle>SCORING_RUBRIC</SubTitle>
      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, margin: '16px 0 24px' }}>
        Define the criteria used to evaluate candidate responses. Each criterion has a weight that contributes to the overall score.
      </p>
      <RubricEditor dimensions={dimensions} onChange={onDimensionsChange} />
    </div>
  );
}
