/**
 * BDD for ADR-036 Phase 3 end-to-end — canonical fixture from the
 * `role-discovery-data-contract-path-b-handoff.md` §"BDD test for Phase 3".
 *
 * Scenario:
 *   Given a Role Context Document with a distinctive `technical_context`:
 *     stack: ['Rust', 'WebAssembly']
 *     dispositional_weights: { pragmatism: 1.3, rigor: 0.8 }
 *   When the code-review consumers run against that RCD,
 *   Then (1) a challenge generated from this RCD has a prompt that contains
 *     the verbatim string "Rust" or "WebAssembly",
 *   And  (2) the scorer applied to a mock review conversation produces
 *     per-dimension contributions where the pragmatism-related dimensions
 *     are weighted higher than the rigor-related dimensions compared to the
 *     baseline,
 *   And  (3) the scorer never clamps any dimension to zero — the
 *     sign-preservation invariant holds under every input path.
 *
 * Unit-level invariants for the prompt builders and the weight function live
 * in `codeReviewPhase3.test.ts` and `scorerDispositional.test.ts`. This file
 * is the canonical, spec-matching Phase 3 end-to-end BDD test — one full
 * seeded fixture, three handoff-mandated assertions.
 */

import { describe, it, expect } from 'vitest';

import { buildGeneratorSystemPrompt } from '../lib/challengeGeneration/prompts';
import {
  applyDispositionalWeights,
  getWeightsForLevel,
  computeBarsComposite,
  MIN_DISPOSITIONAL,
  type DimensionId,
} from '../lib/scorerRubric';
import { computeOverallScore, type BarsDimensionScores, type EffectivenessScore } from '../lib/scoring';
import type { CandidatePersona, RoleContextDocument } from '../types';

// ─── Canonical Phase 3 BDD fixture ───────────────────────────────────────────

const SPEC_STACK = ['Rust', 'WebAssembly'] as const;
const SPEC_DISPOSITIONAL = { pragmatism: 1.3, rigor: 0.8 } as const;

const LEGACY_PERSONA: CandidatePersona = {
  seniority: 'senior, 5+ years',
  archetype: 'Systems Engineer',
  mustHaveSkills: ['TypeScript', 'Node.js'],
  niceToHaveSkills: [],
  disposition: [],
  careerSignal: 'has shipped a distributed system',
  redFlags: [],
  dealbreakers: [],
};

function buildSpecRcd(): RoleContextDocument {
  return {
    rcd_version: 'rcd-v1',
    role_context_id: 'rc-phase3-e2e',
    pipeline_id: 'pipe-phase3-e2e',
    created_at: '2026-04-11T00:00:00Z',
    domain_matrix: {},
    conflicts: [],
    technical_context: {
      stack: [...SPEC_STACK],
      constructs: ['zero_unsafe', 'no_std'],
      seniority_band: 'senior',
      codebase_expectations: [
        'single binary, no service mesh',
        'strict clippy lints, deny warnings',
      ],
      dispositional_weights: { ...SPEC_DISPOSITIONAL },
    },
    team_culture_profile: { per_stakeholder: {} },
    bars_overrides: [],
    probe_bank_enrichment: { static_base_version: 'v1', enriched_probes: [] },
    dealbreakers: [],
    red_flags: [],
    consumer_slice: {
      seniority: 'senior',
      archetype: 'Systems Engineer',
      mustHaveSkills: ['Rust', 'WebAssembly'],
      niceToHaveSkills: [],
      disposition: ['pragmatic'],
      careerSignal: 'has shipped a WebAssembly runtime',
      redFlags: [],
      dealbreakers: [],
    },
    validation_metadata: {
      schema_version: 'rcd-v1',
      synthesis_model: 'mock-gemma',
      synthesis_prompt_version: 'rcd-synthesis-v1',
      verification_pass_model: 'mock-gemma',
      face_validity_reviewed_at: null,
      face_validity_reviewer: null,
    },
  };
}

// The trait → dimension mapping the scorer uses (mirrors scorerRubric.ts).
const PRAGMATISM_DIMS: DimensionId[] = ['prioritization', 'ai_direction'];
const RIGOR_DIMS: DimensionId[] = ['issue_identification', 'revision_evaluation'];

const ALL_DIMENSIONS: DimensionId[] = [
  'issue_identification',
  'reasoning_quality',
  'prioritization',
  'question_formation',
  'revision_evaluation',
  'ai_direction',
];

const FLAT_EFFECTIVENESS: EffectivenessScore = {
  ris: 0,
  efficiency: 0,
  delta: 0,
  score: 50, // midpoint — keeps the effectiveness contribution constant
};

// ─── Assertion 1 — generator prompt contains verbatim RCD stack tokens ──────

describe('Phase 3 BDD — assertion 1: generator prompt sources stack from the RCD verbatim', () => {
  it('builds a generator system prompt that contains the RCD stack tokens "Rust" and "WebAssembly"', () => {
    const rcd = buildSpecRcd();
    const prompt = buildGeneratorSystemPrompt(
      LEGACY_PERSONA,
      { types: ['CODE_IMPLEMENTATION'], count: 3, seniority: 'SENIOR' },
      rcd,
    );

    // The verbatim presence of the stack tokens is the whole point — the
    // scorer must be able to trace a generated challenge back to an RCD
    // field without the prompt restating the flat persona's stale mustHave
    // list.
    expect(prompt).toContain('Rust');
    expect(prompt).toContain('WebAssembly');

    // And the legacy persona's stack must not leak through the RCD path —
    // if it does, the generator is still reading from the old source.
    expect(prompt).not.toContain('Node.js');
  });
});

// ─── Assertion 2 — pragmatism weighted above rigor relative to baseline ─────

describe('Phase 3 BDD — assertion 2: dispositional overlay tilts pragmatism above rigor', () => {
  it('shifts per-dimension weights so pragmatism contributions exceed rigor contributions relative to the baseline', () => {
    const base = getWeightsForLevel('senior');
    const applied = applyDispositionalWeights(base, SPEC_DISPOSITIONAL);

    // Pragmatism dimensions gain weight; rigor dimensions lose weight.
    // We compare the ratio (pragmatism / rigor) before and after — a ratio
    // that grows is the precise statement of "pragmatism weighted higher
    // than rigor compared to baseline."
    const pragBase = PRAGMATISM_DIMS.reduce((sum, d) => sum + base[d]!, 0);
    const rigorBase = RIGOR_DIMS.reduce((sum, d) => sum + base[d]!, 0);
    const pragApplied = PRAGMATISM_DIMS.reduce((sum, d) => sum + applied[d]!, 0);
    const rigorApplied = RIGOR_DIMS.reduce((sum, d) => sum + applied[d]!, 0);

    const baseRatio = pragBase / rigorBase;
    const appliedRatio = pragApplied / rigorApplied;

    expect(appliedRatio).toBeGreaterThan(baseRatio);

    // Additionally: a candidate who scores high on pragmatism-related
    // dimensions and mid on rigor should score higher under the RCD overlay
    // than under the baseline weights. This is the end-to-end consequence
    // the scorer is supposed to deliver.
    const pragmaticScores: BarsDimensionScores = {
      issue_identification: 3,
      reasoning_quality: 3,
      prioritization: 5,
      question_formation: 3,
      revision_evaluation: 3,
      ai_direction: 5,
    };
    const baselineComposite = computeOverallScore(
      pragmaticScores,
      FLAT_EFFECTIVENESS,
      'senior',
    );
    const rcdComposite = computeOverallScore(
      pragmaticScores,
      FLAT_EFFECTIVENESS,
      'senior',
      SPEC_DISPOSITIONAL,
    );
    expect(rcdComposite).toBeGreaterThan(baselineComposite);

    // And the inverse: a candidate who scores high on rigor and mid on
    // pragmatism should score LOWER under the RCD overlay. The overlay
    // tilts both ways — it's not a free boost.
    const rigorousScores: BarsDimensionScores = {
      issue_identification: 5,
      reasoning_quality: 3,
      prioritization: 3,
      question_formation: 3,
      revision_evaluation: 5,
      ai_direction: 3,
    };
    const rigorousBaseline = computeOverallScore(
      rigorousScores,
      FLAT_EFFECTIVENESS,
      'senior',
    );
    const rigorousRcd = computeOverallScore(
      rigorousScores,
      FLAT_EFFECTIVENESS,
      'senior',
      SPEC_DISPOSITIONAL,
    );
    expect(rigorousRcd).toBeLessThan(rigorousBaseline);
  });
});

// ─── Assertion 3 — sign-preservation invariant ──────────────────────────────

describe('Phase 3 BDD — assertion 3: scorer never clamps any dimension to zero', () => {
  it('produces strictly positive weights under the spec-fixture dispositional overlay', () => {
    const base = getWeightsForLevel('senior');
    const applied = applyDispositionalWeights(base, SPEC_DISPOSITIONAL);

    for (const id of ALL_DIMENSIONS) {
      expect(applied[id]).toBeGreaterThan(0);
      // Floor must be at least the minimum dispositional multiplier times
      // the smallest baseline weight, scaled by renormalization. Using the
      // raw MIN_DISPOSITIONAL as a loose lower bound would miss renorm
      // shrinkage, so we check non-zero here and tighten the invariant
      // below with the extreme-input cases.
    }
  });

  it('preserves strictly positive weights even under pathological dispositional inputs', () => {
    const base = getWeightsForLevel('senior');

    // Zeroing attempts — each of these would collapse a dimension if the
    // clamp were not applied BEFORE multiplication. The scorer must absorb
    // every one of them.
    const pathologicals: Record<string, number>[] = [
      { pragmatism: 0, rigor: 0, communication: 0 },
      { pragmatism: -1, rigor: -100, communication: -0.01 },
      { pragmatism: Number.NaN, rigor: Number.POSITIVE_INFINITY, communication: Number.NEGATIVE_INFINITY },
      { prioritization: 0, ai_direction: 0 }, // direct dimension-ID zeroing
      { issue_identification: Number.NEGATIVE_INFINITY },
    ];

    for (const disp of pathologicals) {
      const applied = applyDispositionalWeights(base, disp);
      for (const id of ALL_DIMENSIONS) {
        expect(applied[id]).toBeGreaterThan(0);
        // Stronger invariant: the floor is MIN_DISPOSITIONAL × (smallest
        // baseline weight across dimensions) / (sum of max-clamped base
        // weights). No need to compute exactly — just assert it's nowhere
        // near zero.
        expect(applied[id]).toBeGreaterThan(0.01);
      }
    }

    // And the integration consequence: a candidate whose only strong
    // dimension is one the RCD "zeroed" must still see that dimension
    // contribute to the composite. If the clamp is broken, the composite
    // collapses to the default midpoint (3 out of 5). We exercise this via
    // computeBarsComposite directly so the test is independent of the
    // effectiveness overlay.
    const focusedScores: BarsDimensionScores = {
      issue_identification: 5, // the "zeroed" dimension
      reasoning_quality: 1,
      prioritization: 1,
      question_formation: 1,
      revision_evaluation: 1,
      ai_direction: 1,
    };
    const focusedComposite = computeBarsComposite(
      focusedScores,
      'senior',
      { issue_identification: 0 },
    );
    // Baseline midpoint (all 3s) composite for comparison:
    const midpointComposite = computeBarsComposite(
      {
        issue_identification: 3,
        reasoning_quality: 3,
        prioritization: 3,
        question_formation: 3,
        revision_evaluation: 3,
        ai_direction: 3,
      },
      'senior',
    );
    // Issue identification was driven to 5; every other dimension is 1.
    // With a working clamp, the strong dimension still lifts the composite
    // above the "all 1s" floor. With a broken clamp, the strong dimension
    // drops out entirely and the composite goes below the midpoint in a
    // way that's indistinguishable from a sign collapse. We assert the
    // composite is strictly above the "all 1s" floor:
    const floorComposite = computeBarsComposite(
      {
        issue_identification: 1,
        reasoning_quality: 1,
        prioritization: 1,
        question_formation: 1,
        revision_evaluation: 1,
        ai_direction: 1,
      },
      'senior',
    );
    expect(focusedComposite).toBeGreaterThan(floorComposite);
    // And the midpoint baseline is a sanity reference — if the clamp is
    // broken the focused composite collapses toward the floor, not the
    // midpoint.
    expect(midpointComposite).toBeGreaterThan(floorComposite);
  });

  it('exposes MIN_DISPOSITIONAL as the load-bearing lower bound for the overlay', () => {
    // This is a regression guard. The clamp constant is the ADR-036
    // invariant; if a refactor accidentally drops it to 0, every other
    // assertion in this file becomes a no-op. Lock it.
    expect(MIN_DISPOSITIONAL).toBeGreaterThan(0);
    expect(MIN_DISPOSITIONAL).toBeLessThan(1);
  });
});
