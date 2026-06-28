/**
 * Code Review Scoring Rubric — 6 BARS Dimensions
 *
 * TypeScript representation of scorerRubric.yaml (kept in sync manually).
 * Workers can't read YAML at runtime, so this is the importable source.
 *
 * Research basis:
 *   - knowledge/outputs/code-review-content-sourcing.md (2026-04-08)
 *   - ADR-032 (code review research integration)
 *   - ADR-034 (challenge authoring system)
 *
 * Scale: 1-5 per dimension, encounter-level scoring (per PR, not per turn).
 * Anchors follow Hodges-compliant BARS: concrete observable behaviors only.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BarsAnchor {
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly description: string;
}

export interface CrossCheck {
  readonly condition: string;
  readonly maxScore: 1 | 2 | 3 | 4 | 5;
  readonly reason: string;
}

export interface WeightOverride {
  readonly senior: number;
  readonly junior: number;
}

export interface RubricDimension {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
  readonly description: string;
  readonly needsGroundTruth: boolean;
  readonly research: string;
  readonly anchors: readonly BarsAnchor[];
  readonly crossChecks: readonly CrossCheck[];
  readonly weightOverride?: WeightOverride;
  readonly note?: string;
}

export interface ScoringBands {
  readonly strong: { readonly min: number; readonly max: number };
  readonly adequate: { readonly min: number; readonly max: number };
  readonly weak: { readonly min: number; readonly max: number };
}

export interface Rubric {
  readonly version: string;
  readonly scale: { readonly min: 1; readonly max: 5; readonly scoringLevel: 'encounter' };
  readonly bands: ScoringBands;
  readonly compositeWeights: { readonly bars: number; readonly effectiveness: number };
  readonly dimensions: readonly RubricDimension[];
}

// ─── Dimension IDs (for type-safe access) ───────────────────────────────────

export const DIMENSION_IDS = [
  'issue_identification',
  'reasoning_quality',
  'prioritization',
  'question_formation',
  'revision_evaluation',
  'ai_direction',
] as const;

export type DimensionId = (typeof DIMENSION_IDS)[number];

// ─── The Rubric ─────────────────────────────────────────────────────────────

export const SCORER_RUBRIC: Rubric = {
  version: '1.0.0',
  scale: { min: 1, max: 5, scoringLevel: 'encounter' },
  bands: {
    strong: { min: 75, max: 100 },
    adequate: { min: 45, max: 74 },
    weak: { min: 0, max: 44 },
  },
  compositeWeights: { bars: 0.85, effectiveness: 0.15 },
  dimensions: [
    // ── 1. Issue Identification Depth ────────────────────────────────────
    {
      id: 'issue_identification',
      name: 'Issue Identification Depth',
      weight: 0.20,
      description:
        'What defects and design issues does the reviewer surface, and how significant are they? Functional defects and security issues outrank design concerns, which outrank style and docs issues.',
      needsGroundTruth: true,
      research: 'Bosu 2015 [R6-P5], Zhang 2024 [R6-P7]',
      anchors: [
        {
          level: 5,
          description:
            'Found all critical and major planted bugs; correctly identified their category (functional, security, design); flagged no more than one false positive across the entire review.',
        },
        {
          level: 4,
          description:
            'Found ≥70% of critical/major bugs with correct categorization; may have missed one major bug or surfaced 1-2 false positives.',
        },
        {
          level: 3,
          description:
            'Found 40-70% of critical/major bugs; may have miscategorized severity on one or two findings; 2-3 false positives.',
        },
        {
          level: 2,
          description:
            'Found fewer than 40% of critical/major bugs; most comments target style or cosmetic issues while real defects go unmentioned; or more false positives than true findings.',
        },
        {
          level: 1,
          description:
            'Found zero planted bugs; comments are exclusively style nits, boilerplate ("add error handling"), or factually incorrect claims.',
        },
      ],
      crossChecks: [
        {
          condition: 'bugs_found_pct < 0.40',
          maxScore: 3,
          reason: 'Cannot score above 3 when <40% of critical/major bugs found',
        },
        {
          condition: 'false_positives > true_findings',
          maxScore: 2,
          reason: 'Cannot score above 2 when false positives outnumber real findings',
        },
      ],
    },

    // ── 2. Reasoning & Explanation Quality ──────────────────────────────
    {
      id: 'reasoning_quality',
      name: 'Reasoning & Explanation Quality',
      weight: 0.20,
      description:
        'Does the reviewer explain WHY an issue matters — the failure mechanism, the user-facing consequence, the violated invariant — not just THAT something is wrong?',
      needsGroundTruth: false,
      research: 'Bosu 2015 [R6-P5]',
      anchors: [
        {
          level: 5,
          description:
            'Every finding specifies the failure mechanism (what breaks, when, for which input), references the relevant constraint or contract, and proposes a fix with stated trade-offs.',
        },
        {
          level: 4,
          description:
            'Most findings explain the failure mechanism with correct technical framing; proposes direction for a fix but not a complete solution; one or two findings are surface-level.',
        },
        {
          level: 3,
          description:
            'Mix of deep and surface explanations; some comments explain consequences ("this will throw on empty input") while others say only "this is wrong" or "this could cause issues."',
        },
        {
          level: 2,
          description:
            'Predominantly surface-level: "this is wrong" without explaining consequences; or vague claims ("this could cause issues") with no scenario or mechanism described.',
        },
        {
          level: 1,
          description:
            'No explanations given; comments are bare directives ("fix this"), factually incorrect reasoning, or copy-paste boilerplate unrelated to the specific code under review.',
        },
      ],
      crossChecks: [],
    },

    // ── 3. Prioritization Accuracy ──────────────────────────────────────
    {
      id: 'prioritization',
      name: 'Prioritization Accuracy',
      weight: 0.15,
      description:
        'Can the reviewer distinguish blockers from nitpicks? Do severity labels match actual impact? Does the final verdict correctly reflect which issues are merge-blocking?',
      needsGroundTruth: true,
      research: 'MacLeod 2018 [R6-P4]',
      anchors: [
        {
          level: 5,
          description:
            'Every severity label matches actual impact; critical bugs are flagged as blockers; the verdict correctly gates merge on unresolved critical/major issues; nits are explicitly marked as non-blocking.',
        },
        {
          level: 4,
          description:
            'Severity labels mostly correct with one miscalibration (e.g. a major bug marked as minor); verdict is directionally correct; blocker/nit distinction is clear.',
        },
        {
          level: 3,
          description:
            'Some severity errors (2-3 miscalibrations); or approved the PR while a major (non-critical) bug remained unresolved; blocker vs. nit distinction is inconsistent.',
        },
        {
          level: 2,
          description:
            'Multiple severity errors; approved with an unfound critical bug; or treated all issues as equal severity (no triage).',
        },
        {
          level: 1,
          description:
            'No severity labels at all; or severity is inverted (critical issues marked as nits, style issues marked as blockers); rubber-stamp "LGTM" with unresolved critical bugs.',
        },
      ],
      crossChecks: [
        {
          condition: 'approved_with_unfound_critical',
          maxScore: 2,
          reason: 'Cannot score above 2 when PR approved with unfound critical bugs',
        },
      ],
    },

    // ── 4. Question Formation ───────────────────────────────────────────
    {
      id: 'question_formation',
      name: 'Question Formation',
      weight: 0.15,
      description:
        "Does the reviewer ask questions that elicit rationale, history, and design intent before criticizing? Questions that surface context the reviewer couldn't know from the diff alone are the hallmark of senior reviewers (Sillito's taxonomy).",
      needsGroundTruth: false,
      research: 'Sillito 2006 [R6-P10], Bacchelli & Bird 2013 [R6-P1]',
      anchors: [
        {
          level: 5,
          description:
            'Asked ≥2 questions that surfaced design intent, historical context, or constraints not visible in the diff; adjusted feedback based on the answers received; no assumptions made without checking.',
        },
        {
          level: 4,
          description:
            'Asked 1-2 clarifying questions before critiquing ambiguous code; demonstrated awareness that context might change the assessment; one or two assumptions made but reasonable ones.',
        },
        {
          level: 3,
          description:
            'Occasionally asked "why" but mostly assumed intent; questions were superficial ("was this intentional?") rather than probing design rationale or constraints.',
        },
        {
          level: 2,
          description:
            'Never asked any clarifying questions; made confident claims about code that could have alternative valid interpretations; assumptions led to at least one false positive.',
        },
        {
          level: 1,
          description:
            'Dismissed all context provided by the implementer; insisted on changes without engaging with rationale; or asked zero questions across the entire review.',
        },
      ],
      crossChecks: [],
    },

    // ── 5. Revision Evaluation (PIPE-exclusive) ─────────────────────────
    {
      id: 'revision_evaluation',
      name: 'Revision Evaluation',
      weight: 0.20,
      description:
        "After the implementer responds to feedback (fix, pushback, or clarification), does the reviewer correctly assess whether the fix is complete, incomplete, or introduces new issues? This is PIPE's exclusive moat — no competitor can score it without an interactive multi-turn implementer agent.",
      needsGroundTruth: true,
      research: 'PIPE-exclusive dimension',
      anchors: [
        {
          level: 5,
          description:
            'Verified every claimed fix against the actual code change; caught at least one incomplete fix or newly introduced issue; concessions were reasoned ("you\'re right because X") not reflexive ("oh ok makes sense").',
        },
        {
          level: 4,
          description:
            'Verified most claimed fixes; correctly identified fix completeness on critical issues; may have accepted one minor incomplete fix without checking; concessions mostly reasoned.',
        },
        {
          level: 3,
          description:
            'Spot-checked some fixes but accepted others at face value; mix of verified and unverified responses; at least one "oh ok" concession without evaluation on a significant issue.',
        },
        {
          level: 2,
          description:
            'Accepted most implementer responses without verification; caved on pushback ("oh ok makes sense") on >50% of challenged points; missed an incomplete fix on a major bug.',
        },
        {
          level: 1,
          description:
            'Rubber-stamped all implementer responses; never re-examined code after implementer claimed a fix; or abandoned all original findings after pushback.',
        },
      ],
      crossChecks: [
        {
          condition: 'cave_ratio > 0.50',
          maxScore: 3,
          reason: 'Cannot score above 3 when reviewer caves on >50% of pushback',
        },
        {
          condition: 'zero_fix_verifications',
          maxScore: 2,
          reason: 'Cannot score above 2 when reviewer never verified any claimed fix',
        },
      ],
    },

    // ── 6. AI Direction ─────────────────────────────────────────────────
    {
      id: 'ai_direction',
      name: 'AI Direction',
      weight: 0.10,
      description:
        'Can the reviewer direct, evaluate, and push back on AI-generated code? This measures judgment on acceptance — not blind acceptance of suggested changes, not blanket rejection, but merit-based evaluation. Weighted more heavily for senior-level assessments.',
      needsGroundTruth: false,
      research: 'Jellyfish 2025 [R6-P11], Graphite Diamond [R6-S11]',
      note: 'This dimension has no prior empirical BARS validation. Anchors are inferred from operational metrics. Treat scores as directional until a critical-incident study with expert reviewers can validate the anchor points.',
      anchors: [
        {
          level: 5,
          description:
            'Caught a flawed implementer fix and held the line with evidence when pushed back; evaluated a cleaner alternative on its merits (accepted or rejected with stated reasoning); escalated productively when the conversation stalled.',
        },
        {
          level: 4,
          description:
            'Correctly evaluated most implementer proposals; pushed back on at least one flawed suggestion with a specific counter-argument; accepted valid alternatives without defensiveness.',
        },
        {
          level: 3,
          description:
            'Mix of merit-based and reflexive responses; accepted some flawed implementer proposals without scrutiny; pushed back on others with reasoning; no clear pattern of judgment.',
        },
        {
          level: 2,
          description:
            'Deferred to the implementer on most suggestions regardless of quality; or rejected all implementer proposals without evaluating their merit; pattern is reflexive not reasoned.',
        },
        {
          level: 1,
          description:
            'Blindly accepted every implementer suggestion ("sounds good, ship it") or blindly rejected everything ("no, do it my way") with no evidence of evaluating individual proposals.',
        },
      ],
      crossChecks: [],
      weightOverride: {
        senior: 0.15,
        junior: 0.05,
      },
    },
  ],
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Look up a dimension by ID. Throws if not found. */
export function getDimension(id: DimensionId): RubricDimension {
  const dim = SCORER_RUBRIC.dimensions.find((d) => d.id === id);
  if (!dim) throw new Error(`[scorerRubric] Unknown dimension: ${id}`);
  return dim;
}

/** Get the anchor description for a given dimension and level. */
export function getAnchor(id: DimensionId, level: 1 | 2 | 3 | 4 | 5): string {
  const dim = getDimension(id);
  const anchor = dim.anchors.find((a) => a.level === level);
  if (!anchor) throw new Error(`[scorerRubric] No anchor for ${id} level ${level}`);
  return anchor.description;
}

/**
 * Returns dimension weights adjusted for candidate seniority level.
 * AI direction weight shifts between junior (5%) and senior (15%);
 * other weights are re-normalized to maintain sum = 1.0.
 */
export function getWeightsForLevel(
  level: 'junior' | 'mid' | 'senior',
): Record<DimensionId, number> {
  const weights: Record<string, number> = {};
  let totalRaw = 0;

  for (const dim of SCORER_RUBRIC.dimensions) {
    let w = dim.weight;
    if (dim.weightOverride) {
      if (level === 'senior') w = dim.weightOverride.senior;
      else if (level === 'junior') w = dim.weightOverride.junior;
      // 'mid' uses default weight
    }
    weights[dim.id] = w;
    totalRaw += w;
  }

  // Re-normalize so weights sum to 1.0
  for (const id of DIMENSION_IDS) {
    weights[id] = weights[id]! / totalRaw;
  }

  return weights as Record<DimensionId, number>;
}

// ─── Dispositional weights (ADR-036 §3) ────────────────────────────────────

/**
 * Sign-preservation clamp range for dispositional multipliers.
 *
 * A scorer that silently zeros a dimension poisons every candidate result
 * for a role forever, so dispositional multipliers are bounded to
 * [MIN_DISPOSITIONAL, MAX_DISPOSITIONAL]. Weights can only shift magnitudes,
 * never signs. This is the single highest-risk bug in Path B — test it.
 */
export const MIN_DISPOSITIONAL = 0.5;
export const MAX_DISPOSITIONAL = 1.5;

/**
 * RCD trait names that map onto rubric dimensions. The RCD expresses team
 * disposition in human-readable traits; the scorer cares about rubric
 * dimensions. This table is the translation layer.
 */
const TRAIT_TO_DIMENSIONS: Record<string, readonly DimensionId[]> = {
  pragmatism: ['prioritization', 'ai_direction'],
  rigor: ['issue_identification', 'revision_evaluation'],
  communication: ['reasoning_quality', 'question_formation'],
};

function clampDispositional(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n < MIN_DISPOSITIONAL) return MIN_DISPOSITIONAL;
  if (n > MAX_DISPOSITIONAL) return MAX_DISPOSITIONAL;
  return n;
}

/**
 * Applies dispositional multipliers to seniority-adjusted base weights and
 * re-normalizes so the result still sums to 1.0.
 *
 * Accepted key forms in `dispositional`:
 *   - Trait names (`pragmatism`, `rigor`, `communication`) — applied to all
 *     dimensions in TRAIT_TO_DIMENSIONS for that trait.
 *   - Direct dimension IDs — override trait-level values. Useful when an RCD
 *     wants to tune a single dimension without moving the whole trait.
 *
 * All multipliers are clamped to [0.5, 1.5] BEFORE being applied. This is the
 * sign-preservation invariant: no dimension can be zeroed out, no dimension
 * can dominate.
 */
export function applyDispositionalWeights(
  baseWeights: Record<DimensionId, number>,
  dispositional: Record<string, number> | undefined,
): Record<DimensionId, number> {
  if (!dispositional || Object.keys(dispositional).length === 0) {
    return baseWeights;
  }

  // Build a per-dimension multiplier starting from 1.0.
  const multipliers: Record<DimensionId, number> = {
    issue_identification: 1,
    reasoning_quality: 1,
    prioritization: 1,
    question_formation: 1,
    revision_evaluation: 1,
    ai_direction: 1,
  };

  // First pass: trait-level keys.
  for (const [key, raw] of Object.entries(dispositional)) {
    const dims = TRAIT_TO_DIMENSIONS[key];
    if (!dims) continue;
    const m = clampDispositional(raw);
    for (const d of dims) multipliers[d] = m;
  }

  // Second pass: direct dimension-ID keys override trait-level values.
  for (const [key, raw] of Object.entries(dispositional)) {
    if ((DIMENSION_IDS as readonly string[]).includes(key)) {
      multipliers[key as DimensionId] = clampDispositional(raw);
    }
  }

  const adjusted: Record<string, number> = {};
  let total = 0;
  for (const id of DIMENSION_IDS) {
    const v = baseWeights[id] * multipliers[id];
    adjusted[id] = v;
    total += v;
  }

  if (total <= 0) {
    // Degenerate — should be impossible given the clamp, but fall back safely.
    return baseWeights;
  }

  for (const id of DIMENSION_IDS) {
    adjusted[id] = adjusted[id]! / total;
  }
  return adjusted as Record<DimensionId, number>;
}

/**
 * Compute weighted BARS composite from dimension scores (1-5) → 0-100.
 * Applies seniority-adjusted weights, with optional dispositional overlay
 * from the RCD (clamped to [0.5, 1.5] per dimension, then renormalized).
 */
export function computeBarsComposite(
  scores: Record<DimensionId, number>,
  level: 'junior' | 'mid' | 'senior' = 'mid',
  dispositionalWeights?: Record<string, number>,
): number {
  const base = getWeightsForLevel(level);
  const weights = applyDispositionalWeights(base, dispositionalWeights);
  let sum = 0;
  for (const id of DIMENSION_IDS) {
    const score = scores[id];
    if (!Number.isFinite(score) || score < 1 || score > 5) {
      throw new Error(`[scorerRubric] Missing or invalid BARS dimension score: ${id}`);
    }
    sum += score * weights[id]!;
  }
  // Convert 1-5 scale to 0-100: (weighted_avg - 1) / 4 * 100
  return Math.round(((sum - 1) / 4) * 100);
}

/**
 * Build the BARS section of a scorer prompt by serializing all dimensions
 * and their anchors into text the LLM can reference.
 */
export function buildBarsPromptSection(options?: {
  /** Only include dimensions that need/don't need ground truth */
  needsGroundTruth?: boolean;
}): string {
  const dims = options?.needsGroundTruth !== undefined
    ? SCORER_RUBRIC.dimensions.filter((d) => d.needsGroundTruth === options.needsGroundTruth)
    : SCORER_RUBRIC.dimensions;

  const sections = dims.map((dim, idx) => {
    const anchorLines = dim.anchors
      .map((a) => `  ${a.level}: ${a.description}`)
      .join('\n');

    const crossCheckLines = dim.crossChecks.length > 0
      ? '\n  MANDATORY CROSS-CHECKS:\n' +
        dim.crossChecks.map((cc) => `  - If ${cc.condition} → max score ${cc.maxScore} (${cc.reason})`).join('\n')
      : '';

    return `### ${idx + 1}. ${dim.name} (weight: ${Math.round(dim.weight * 100)}%)
${dim.description}

Anchors (1-5):
${anchorLines}${crossCheckLines}`;
  });

  return sections.join('\n\n');
}
