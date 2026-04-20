/**
 * Match-config guardrails — ADR-039 §4 (5 rules: 3 BLOCK, 2 WARN).
 *
 * Pure function. No I/O. Called from POST /api/v1/pipelines/auto-build
 * before any DB writes.
 *
 * v1 scope (per .claude/plans/polymorphic-wobbling-tiger.md):
 *   - Validates the four wizard axes are internally coherent
 *     (e.g. hybrid_mix_ratio required iff philosophy='hybrid').
 *
 * Deferred rules (need fields the schema does not yet carry):
 *   - BLOCK tailored+strict+uncommon-stack+auto-reject
 *     (needs `auto_decision_action` + stack-popularity index — neither exist)
 *   - BLOCK per-stage automation + per-pipeline overrides simultaneously
 *     (needs per-stage override rows — v1 has no override surface)
 *   - BLOCK validate + auto-disqualify
 *     (needs `auto_decision_action` field)
 *   - WARN tailored+strict+auto-reject
 *     (same: needs `auto_decision_action`)
 *   - WARN validate-mode + sparse candidate profile
 *     (needs candidate ingest — v2 work)
 *
 * Each deferred rule is registered in DEFERRED_RULES so v2 work can drop
 * an implementation in without rediscovering the rule list.
 */

export type MatchPhilosophy = 'tailored' | 'hybrid' | 'validate';
export type Tolerance = 'strict' | 'moderate' | 'lenient';
export type StageLinkage = 'shared-repo' | 'per-stage';
export type AutomationGranularity =
  | 'per-pipeline'
  | 'per-candidate'
  | 'per-stage'
  | 'recruiter-override';

export interface MatchConfigInput {
  match_philosophy: MatchPhilosophy;
  tolerance: Tolerance;
  stage_linkage: StageLinkage;
  automation_granularity: AutomationGranularity;
  hybrid_mix_ratio: number | null;
  non_negotiable_skills: string[];
}

export interface GuardrailViolation {
  code: string;
  severity: 'block' | 'warn';
  message: string;
}

export interface GuardrailResult {
  allowed: boolean;
  blocks: GuardrailViolation[];
  warnings: GuardrailViolation[];
}

export const DEFERRED_RULES: ReadonlyArray<{ code: string; reason: string }> = [
  { code: 'B-TAILORED-STRICT-UNCOMMON-AUTOREJECT', reason: 'needs auto_decision_action field + stack-popularity index' },
  { code: 'B-PER-STAGE-AND-PER-PIPELINE',          reason: 'needs per-stage override rows (v2)' },
  { code: 'B-VALIDATE-AUTODISQUALIFY',             reason: 'needs auto_decision_action field' },
  { code: 'W-TAILORED-STRICT-AUTOREJECT',          reason: 'needs auto_decision_action field' },
  { code: 'W-VALIDATE-SPARSE-CANDIDATE',           reason: 'needs candidate ingest (v2)' },
];

export function checkGuardrails(input: MatchConfigInput): GuardrailResult {
  const blocks: GuardrailViolation[] = [];
  const warnings: GuardrailViolation[] = [];

  // BLOCK: hybrid philosophy must declare a mix ratio in [0, 1].
  if (input.match_philosophy === 'hybrid') {
    if (input.hybrid_mix_ratio === null || input.hybrid_mix_ratio === undefined) {
      blocks.push({
        code: 'B-HYBRID-MIX-RATIO-REQUIRED',
        severity: 'block',
        message: 'hybrid match philosophy requires hybrid_mix_ratio',
      });
    } else if (input.hybrid_mix_ratio < 0 || input.hybrid_mix_ratio > 1) {
      blocks.push({
        code: 'B-HYBRID-MIX-RATIO-RANGE',
        severity: 'block',
        message: `hybrid_mix_ratio must be in [0, 1] (got ${input.hybrid_mix_ratio})`,
      });
    }
  }

  // BLOCK: non-hybrid philosophies must NOT carry a mix ratio.
  if (input.match_philosophy !== 'hybrid' && input.hybrid_mix_ratio !== null && input.hybrid_mix_ratio !== undefined) {
    blocks.push({
      code: 'B-MIX-RATIO-WITHOUT-HYBRID',
      severity: 'block',
      message: `hybrid_mix_ratio set but match_philosophy is '${input.match_philosophy}'`,
    });
  }

  // WARN: empty non_negotiable_skills means coverage will not be enforced.
  if (input.non_negotiable_skills.length === 0) {
    warnings.push({
      code: 'W-NO-NON-NEGOTIABLE-SKILLS',
      severity: 'warn',
      message: 'no skills marked non-negotiable — repo match will fall back to persona.mustHaveSkills as soft constraints',
    });
  }

  return { allowed: blocks.length === 0, blocks, warnings };
}
