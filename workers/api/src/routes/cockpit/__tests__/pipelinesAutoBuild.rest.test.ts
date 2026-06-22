/**
 * pipelinesAutoBuild REST tests — ADR-039 v1 slice
 *
 * Module-level tests that exercise the auto-build route's Zod body schema and
 * the 201-response shape contract the frontend depends on (`warnings` field
 * consumed by `RoleDiscoveryPage.handleWizardComplete` + surfaced in the
 * `PipelineShellPage` auto-build warnings banner).
 *
 * Per the repo convention (see challengeAuthoring.rest.test.ts header): full
 * HTTP-layer integration tests require @cloudflare/vitest-pool-workers, which
 * is not yet configured. These tests lock in the schema + response contract
 * without spinning up Wrangler.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { checkGuardrails, type MatchConfigInput } from '../../../lib/match/guardrails';

// ── 1. Body schema — mirrors workers/api/src/routes/cockpit/pipelinesAutoBuild.ts

const matchConfigSchema = z.object({
  match_philosophy: z.enum(['tailored', 'hybrid', 'validate']),
  tolerance: z.enum(['strict', 'moderate', 'lenient']),
  stage_linkage: z.enum(['shared-repo', 'per-stage']),
  automation_granularity: z.enum([
    'per-pipeline',
    'per-candidate',
    'per-stage',
    'recruiter-override',
  ]),
  hybrid_mix_ratio: z.number().min(0).max(1).nullable(),
  non_negotiable_skills: z.array(z.string()).default([]),
});

const bodySchema = z.object({
  role_context_id: z.string().min(1),
  pipeline_title: z.string().min(1).max(200).optional(),
  match_config: matchConfigSchema,
  selected_stages: z
    .array(z.enum(['SCREENING', 'CODE_REVIEW', 'LIVE_CODING'] as const))
    .min(1)
    .default(['SCREENING', 'CODE_REVIEW', 'LIVE_CODING'])
    .transform((values) => [...new Set(values)] as Array<'SCREENING' | 'CODE_REVIEW' | 'LIVE_CODING'>),
});

describe('POST /api/v1/pipelines/auto-build — body schema', () => {
  it('accepts a valid tailored+strict wizard output', () => {
    const result = bodySchema.safeParse({
      role_context_id: 'rc_123',
      pipeline_title: 'Senior Frontend Engineer',
      match_config: {
        match_philosophy: 'tailored',
        tolerance: 'strict',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
        non_negotiable_skills: ['react', 'typescript'],
      },
      selected_stages: ['SCREENING', 'CODE_REVIEW', 'LIVE_CODING'],
    });
    expect(result.success).toBe(true);
    expect(result.success ? result.data.selected_stages : []).toEqual(['SCREENING', 'CODE_REVIEW', 'LIVE_CODING']);
  });

  it('accepts a valid hybrid wizard output with mix ratio', () => {
    const result = bodySchema.safeParse({
      role_context_id: 'rc_123',
      match_config: {
        match_philosophy: 'hybrid',
        tolerance: 'moderate',
        stage_linkage: 'per-stage',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: 0.6,
        non_negotiable_skills: [],
      },
      selected_stages: ['CODE_REVIEW', 'LIVE_CODING'],
    });
    expect(result.success).toBe(true);
    expect(result.success ? result.data.selected_stages : []).toEqual(['CODE_REVIEW', 'LIVE_CODING']);
  });

  it('rejects an empty role_context_id', () => {
    const result = bodySchema.safeParse({
      role_context_id: '',
      match_config: {
        match_philosophy: 'tailored',
        tolerance: 'strict',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
        non_negotiable_skills: [],
      },
      selected_stages: ['SCREENING'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range hybrid_mix_ratio', () => {
    const result = bodySchema.safeParse({
      role_context_id: 'rc_123',
      match_config: {
        match_philosophy: 'hybrid',
        tolerance: 'moderate',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: 1.5, // out of [0, 1]
        non_negotiable_skills: [],
      },
      selected_stages: ['SCREENING'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown match_philosophy values', () => {
    const result = bodySchema.safeParse({
      role_context_id: 'rc_123',
      match_config: {
        match_philosophy: 'strict', // misapplied from tolerance
        tolerance: 'strict',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
        non_negotiable_skills: [],
      },
      selected_stages: ['SCREENING'],
    });
    expect(result.success).toBe(false);
  });

  it('defaults non_negotiable_skills to empty array when omitted', () => {
    const result = bodySchema.safeParse({
      role_context_id: 'rc_123',
      match_config: {
        match_philosophy: 'validate',
        tolerance: 'lenient',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.match_config.non_negotiable_skills).toEqual([]);
    }
  });

  it('defaults selected_stages to all stages when omitted', () => {
    const result = bodySchema.safeParse({
      role_context_id: 'rc_123',
      match_config: {
        match_philosophy: 'tailored',
        tolerance: 'strict',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
        non_negotiable_skills: [],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selected_stages).toEqual(['SCREENING', 'CODE_REVIEW', 'LIVE_CODING']);
    }
  });

  it('deduplicates selected_stages values', () => {
    const result = bodySchema.safeParse({
      role_context_id: 'rc_123',
      match_config: {
        match_philosophy: 'tailored',
        tolerance: 'strict',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
        non_negotiable_skills: [],
      },
      selected_stages: ['SCREENING', 'CODE_REVIEW', 'SCREENING', 'LIVE_CODING'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selected_stages).toEqual(['SCREENING', 'CODE_REVIEW', 'LIVE_CODING']);
    }
  });

  it('rejects an empty selected_stages array', () => {
    const result = bodySchema.safeParse({
      role_context_id: 'rc_123',
      match_config: {
        match_philosophy: 'tailored',
        tolerance: 'strict',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
        non_negotiable_skills: [],
      },
      selected_stages: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown selected_stages values', () => {
    const result = bodySchema.safeParse({
      role_context_id: 'rc_123',
      match_config: {
        match_philosophy: 'tailored',
        tolerance: 'strict',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
        non_negotiable_skills: [],
      },
      selected_stages: ['SCREENING', 'NOT_A_STAGE'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects pipeline_title longer than 200 chars', () => {
    const result = bodySchema.safeParse({
      role_context_id: 'rc_123',
      pipeline_title: 'x'.repeat(201),
      match_config: {
        match_philosophy: 'tailored',
        tolerance: 'strict',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
        non_negotiable_skills: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

// ── 2. 422 GUARDRAIL_BLOCKED response contract ────────────────────────────────
//
// Locks in the contract the route returns when checkGuardrails flags a block.
// The frontend does not currently consume this body, but the shape needs to
// stay stable for future UX surfacing.

describe('guardrail → 422 contract', () => {
  it('hybrid without mix ratio → 1 block, 0 warnings', () => {
    const input: MatchConfigInput = {
      match_philosophy: 'hybrid',
      tolerance: 'moderate',
      stage_linkage: 'shared-repo',
      automation_granularity: 'per-candidate',
      hybrid_mix_ratio: null,
      non_negotiable_skills: ['react'],
    };
    const result = checkGuardrails(input);
    expect(result.allowed).toBe(false);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.code).toBe('B-HYBRID-MIX-RATIO-REQUIRED');
    expect(result.warnings).toHaveLength(0);
  });

  it('tailored with mix ratio → 1 block (mix_ratio without hybrid)', () => {
    const input: MatchConfigInput = {
      match_philosophy: 'tailored',
      tolerance: 'strict',
      stage_linkage: 'shared-repo',
      automation_granularity: 'per-candidate',
      hybrid_mix_ratio: 0.5,
      non_negotiable_skills: ['react'],
    };
    const result = checkGuardrails(input);
    expect(result.allowed).toBe(false);
    expect(result.blocks[0]!.code).toBe('B-MIX-RATIO-WITHOUT-HYBRID');
  });
});

// ── 3. 201 response warnings contract ─────────────────────────────────────────
//
// The frontend reads `res.warnings` and forwards it via router state to
// PipelineShellPage, which renders a dismissible banner keyed on warning.code.

describe('201 response warnings contract', () => {
  it('includes W-NO-NON-NEGOTIABLE-SKILLS warning when list is empty', () => {
    const input: MatchConfigInput = {
      match_philosophy: 'tailored',
      tolerance: 'strict',
      stage_linkage: 'shared-repo',
      automation_granularity: 'per-candidate',
      hybrid_mix_ratio: null,
      non_negotiable_skills: [],
    };
    const result = checkGuardrails(input);
    expect(result.allowed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.code).toBe('W-NO-NON-NEGOTIABLE-SKILLS');
    expect(result.warnings[0]!.severity).toBe('warn');
    // Message must be recruiter-legible (no template placeholders left unresolved).
    expect(result.warnings[0]!.message).toMatch(/non-negotiable/i);
  });

  it('omits warnings when non-negotiable skills are present', () => {
    const input: MatchConfigInput = {
      match_philosophy: 'tailored',
      tolerance: 'strict',
      stage_linkage: 'shared-repo',
      automation_granularity: 'per-candidate',
      hybrid_mix_ratio: null,
      non_negotiable_skills: ['react', 'typescript'],
    };
    const result = checkGuardrails(input);
    expect(result.allowed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
