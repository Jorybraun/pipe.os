import { describe, it, expect } from 'vitest';
import { checkGuardrails, DEFERRED_RULES, type MatchConfigInput } from '../guardrails';

function baseInput(): MatchConfigInput {
  return {
    match_philosophy: 'hybrid',
    tolerance: 'moderate',
    stage_linkage: 'shared-repo',
    automation_granularity: 'per-candidate',
    hybrid_mix_ratio: 0.6,
    non_negotiable_skills: ['typescript', 'react'],
  };
}

describe('checkGuardrails', () => {
  it('returns allowed for the default-defaults config', () => {
    const r = checkGuardrails(baseInput());
    expect(r.allowed).toBe(true);
    expect(r.blocks).toHaveLength(0);
  });

  it('blocks hybrid with null mix ratio', () => {
    const r = checkGuardrails({ ...baseInput(), hybrid_mix_ratio: null });
    expect(r.allowed).toBe(false);
    expect(r.blocks.map((b) => b.code)).toContain('B-HYBRID-MIX-RATIO-REQUIRED');
  });

  it('blocks hybrid with out-of-range mix ratio', () => {
    const r = checkGuardrails({ ...baseInput(), hybrid_mix_ratio: 1.5 });
    expect(r.allowed).toBe(false);
    expect(r.blocks.map((b) => b.code)).toContain('B-HYBRID-MIX-RATIO-RANGE');
  });

  it('blocks tailored with a mix ratio set', () => {
    const r = checkGuardrails({
      ...baseInput(),
      match_philosophy: 'tailored',
      hybrid_mix_ratio: 0.5,
    });
    expect(r.allowed).toBe(false);
    expect(r.blocks.map((b) => b.code)).toContain('B-MIX-RATIO-WITHOUT-HYBRID');
  });

  it('allows tailored with null mix ratio', () => {
    const r = checkGuardrails({
      ...baseInput(),
      match_philosophy: 'tailored',
      hybrid_mix_ratio: null,
    });
    expect(r.allowed).toBe(true);
  });

  it('warns when non_negotiable_skills is empty', () => {
    const r = checkGuardrails({ ...baseInput(), non_negotiable_skills: [] });
    expect(r.allowed).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('W-NO-NON-NEGOTIABLE-SKILLS');
  });

  it('registers all 5 ADR-039 §4 deferred rules so v2 can find them', () => {
    expect(DEFERRED_RULES).toHaveLength(5);
    const codes = DEFERRED_RULES.map((r) => r.code);
    expect(codes).toContain('B-TAILORED-STRICT-UNCOMMON-AUTOREJECT');
    expect(codes).toContain('B-PER-STAGE-AND-PER-PIPELINE');
    expect(codes).toContain('B-VALIDATE-AUTODISQUALIFY');
    expect(codes).toContain('W-TAILORED-STRICT-AUTOREJECT');
    expect(codes).toContain('W-VALIDATE-SPARSE-CANDIDATE');
  });
});
