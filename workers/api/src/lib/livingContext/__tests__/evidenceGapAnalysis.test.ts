import { describe, it, expect } from 'vitest';
import { analyzeEvidenceGaps, type GapAnalysisOptions } from '../evidenceGapAnalysis';

function makeEvidence(overrides: {
  assertion_id: string;
  concept_key: string | null;
  strength?: number;
  effective_strength?: number;
  evidence_level?: string;
  observed_at?: string | null;
  exact_text?: string | null;
}) {
  return {
    assertion_id: overrides.assertion_id,
    narrative: `Evidence for ${overrides.concept_key ?? 'unknown'}`,
    concept_key: overrides.concept_key,
    strength: overrides.strength ?? 0.8,
    evidence_level: overrides.evidence_level ?? 'demonstrated',
    observed_at: overrides.observed_at ?? '2026-06-01T00:00:00Z',
    exact_text: overrides.exact_text ?? 'Sample source text',
    decay_multiplier: 1.0,
    effective_strength: overrides.effective_strength ?? overrides.strength ?? 0.8,
  };
}

function makeDemand(id: string, concepts: string[], weight = 0.5) {
  return { id, narrative: `Demand for ${concepts.join(', ')}`, weight, concepts };
}

describe('analyzeEvidenceGaps', () => {
  it('returns strong coverage when all demand concepts have high-strength evidence', () => {
    const evidence = [
      makeEvidence({ assertion_id: 'a1', concept_key: 'lang:typescript', strength: 0.9, effective_strength: 0.9 }),
      makeEvidence({ assertion_id: 'a2', concept_key: 'framework:react', strength: 0.8, effective_strength: 0.8 }),
    ];
    const demands = [
      makeDemand('d1', ['lang:typescript', 'framework:react']),
    ];

    const result = analyzeEvidenceGaps(evidence, demands);

    expect(result.demands).toHaveLength(1);
    expect(result.demands[0].coverageLevel).toBe('strong');
    expect(result.demands[0].matchedConcepts).toEqual(['lang:typescript', 'framework:react']);
    expect(result.demands[0].missingConcepts).toEqual([]);
    expect(result.summary.strongCount).toBe(1);
    expect(result.summary.coverageScore).toBe(1);
  });

  it('returns none coverage when no concepts match', () => {
    const evidence = [
      makeEvidence({ assertion_id: 'a1', concept_key: 'lang:python', strength: 0.9, effective_strength: 0.9 }),
    ];
    const demands = [
      makeDemand('d1', ['lang:typescript', 'framework:react']),
    ];

    const result = analyzeEvidenceGaps(evidence, demands);

    expect(result.demands[0].coverageLevel).toBe('none');
    expect(result.demands[0].missingConcepts).toEqual(['lang:typescript', 'framework:react']);
    expect(result.summary.noneCount).toBe(1);
    expect(result.summary.coverageScore).toBe(0);
  });

  it('returns partial coverage when some concepts match', () => {
    const evidence = [
      makeEvidence({ assertion_id: 'a1', concept_key: 'lang:typescript', strength: 0.7, effective_strength: 0.7 }),
    ];
    const demands = [
      makeDemand('d1', ['lang:typescript', 'framework:react', 'tool:webpack']),
    ];

    const result = analyzeEvidenceGaps(evidence, demands);

    expect(result.demands[0].coverageLevel).toBe('partial');
    expect(result.demands[0].matchedConcepts).toEqual(['lang:typescript']);
    expect(result.demands[0].missingConcepts).toEqual(['framework:react', 'tool:webpack']);
  });

  it('returns weak coverage when evidence strength is low', () => {
    const evidence = [
      makeEvidence({ assertion_id: 'a1', concept_key: 'lang:typescript', strength: 0.15, effective_strength: 0.15 }),
    ];
    const demands = [
      makeDemand('d1', ['lang:typescript', 'framework:react', 'framework:nextjs', 'tool:eslint']),
    ];

    const result = analyzeEvidenceGaps(evidence, demands);

    expect(result.demands[0].coverageLevel).toBe('weak');
  });

  it('aggregates multiple evidence rows for the same concept', () => {
    const evidence = [
      makeEvidence({ assertion_id: 'a1', concept_key: 'lang:typescript', strength: 0.5, effective_strength: 0.5 }),
      makeEvidence({ assertion_id: 'a2', concept_key: 'lang:typescript', strength: 0.9, effective_strength: 0.9 }),
    ];
    const demands = [
      makeDemand('d1', ['lang:typescript']),
    ];

    const result = analyzeEvidenceGaps(evidence, demands);

    expect(result.demands[0].evidenceCount).toBe(2);
    expect(result.demands[0].bestStrength).toBe(0.9);
    expect(result.demands[0].effectiveStrength).toBe(0.9);
    expect(result.demands[0].supportingAssertions).toHaveLength(2);
  });

  it('computes weighted coverage score based on demand weights', () => {
    const evidence = [
      makeEvidence({ assertion_id: 'a1', concept_key: 'lang:typescript', strength: 0.9, effective_strength: 0.9 }),
    ];
    const demands = [
      makeDemand('d1', ['lang:typescript'], 0.8),
      makeDemand('d2', ['lang:python'], 0.2),
    ];

    const result = analyzeEvidenceGaps(evidence, demands);

    expect(result.summary.strongCount).toBe(1);
    expect(result.summary.noneCount).toBe(1);
    expect(result.summary.weightedCoverageScore).toBeGreaterThan(result.summary.coverageScore);
  });

  it('generates recommendations for missing evidence', () => {
    const evidence: Parameters<typeof analyzeEvidenceGaps>[0] = [];
    const demands = [
      makeDemand('d1', ['lang:typescript', 'framework:react'], 0.9),
    ];

    const result = analyzeEvidenceGaps(evidence, demands);

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.some((r) => r.includes('No evidence'))).toBe(true);
    expect(result.recommendations.some((r) => r.includes('high-weight'))).toBe(true);
  });

  it('handles empty demands gracefully', () => {
    const evidence = [
      makeEvidence({ assertion_id: 'a1', concept_key: 'lang:typescript' }),
    ];

    const result = analyzeEvidenceGaps(evidence, []);

    expect(result.demands).toHaveLength(0);
    expect(result.summary.totalDemands).toBe(0);
    expect(result.summary.coverageScore).toBe(0);
    expect(result.recommendations).toHaveLength(0);
  });

  it('handles demands with no concepts gracefully', () => {
    const evidence = [
      makeEvidence({ assertion_id: 'a1', concept_key: 'lang:typescript' }),
    ];
    const demands = [makeDemand('d1', [])];

    const result = analyzeEvidenceGaps(evidence, demands);

    expect(result.demands[0].coverageLevel).toBe('none');
    expect(result.demands[0].matchedConcepts).toEqual([]);
  });

  it('supports custom coverage thresholds', () => {
    const evidence = [
      makeEvidence({ assertion_id: 'a1', concept_key: 'lang:typescript', strength: 0.4, effective_strength: 0.4 }),
    ];
    const demands = [makeDemand('d1', ['lang:typescript'])];

    const defaultResult = analyzeEvidenceGaps(evidence, demands);
    expect(defaultResult.demands[0].coverageLevel).toBe('partial');

    const customOptions: GapAnalysisOptions = { strongThreshold: 0.3 };
    const customResult = analyzeEvidenceGaps(evidence, demands, customOptions);
    expect(customResult.demands[0].coverageLevel).toBe('strong');
  });

  it('includes exact text in supporting assertions', () => {
    const evidence = [
      makeEvidence({
        assertion_id: 'a1',
        concept_key: 'lang:typescript',
        exact_text: 'Built production TypeScript services for 5 years',
      }),
    ];
    const demands = [makeDemand('d1', ['lang:typescript'])];

    const result = analyzeEvidenceGaps(evidence, demands);

    expect(result.demands[0].supportingAssertions[0].exactText).toBe(
      'Built production TypeScript services for 5 years',
    );
  });

  it('ignores evidence rows with null concept keys', () => {
    const evidence = [
      makeEvidence({ assertion_id: 'a1', concept_key: null }),
      makeEvidence({ assertion_id: 'a2', concept_key: 'lang:typescript', strength: 0.9, effective_strength: 0.9 }),
    ];
    const demands = [makeDemand('d1', ['lang:typescript'])];

    const result = analyzeEvidenceGaps(evidence, demands);

    expect(result.demands[0].evidenceCount).toBe(1);
    expect(result.demands[0].coverageLevel).toBe('strong');
  });
});
