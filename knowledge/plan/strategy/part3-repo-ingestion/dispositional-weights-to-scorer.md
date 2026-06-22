# Dispositional Weights Flow to Implementation Scorer

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part3-repo-ingestion.md (lines 207–208)
**Phase:** 2
**Status:** NEEDS-REFINEMENT
**Estimate:** TBD

## Source quote
> The decomposed RCD's sub-element-level dispositional signals (per-dimension weights on specific BARS anchors) should flow through to the scorer rather than just the implementer. Today, the scorer reads `dispositional_weights` as a single scalar that shifts dimension weights ±50% clamped. This is a narrow consumption — actual per-anchor overrides aren't being used. Part 2's sub-element `BarsOverride` type addresses this on the role side.

## Why
The current scorer receives only a flat scalar shift. Per-anchor `BarsOverride` weights from the decomposed RCD would allow the scorer to apply role-specific calibration (e.g., weight debugging heavily for a platform reliability role). This produces assessments that reflect what the role actually values.

## Why NEEDS-REFINEMENT
This plan has two hard blockers that make it non-delegable today:

1. **`BarsOverride` type does not yet exist.** Part 2 (Role Discovery decomposition) must define and ship the `BarsOverride` sub-element type in RCD before this plan can consume it.

2. **Implementation scorer does not yet exist.** `code-implementation-scorer-sherlock.md` must ship before this plan can wire per-anchor weights into it.

The strategy explicitly calls out that Part 2's `BarsOverride` type "addresses this on the role side" — this plan is a consumer of that work, not a standalone. Return to this plan once both blockers are resolved.

## Known prerequisites
- `code-implementation-scorer-sherlock.md` Phase 1 DONE
- Part 2 `BarsOverride` sub-element type defined in RCD schema

## Subtasks (delegable)
_To be defined after prerequisites land._

## Dependencies
- Depends on: `code-implementation-scorer-sherlock.md`
- Depends on: Part 2 role decomposition (`BarsOverride` type)

## Acceptance criteria
_To be defined after refinement._
