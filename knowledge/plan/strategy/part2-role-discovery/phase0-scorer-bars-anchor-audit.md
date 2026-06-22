# Phase 0 — Scorer BARS Anchor Consumption Audit

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part2-role-discovery.md (lines 62–69, 74–77)
**Phase:** 0  
**Status:** NEEDS-REFINEMENT  
**Estimate:** unclear — see note

## Source quote

> | Scorer agents | `dispositional_weights` scalar only | `lib/scorerAgent.ts:67` | ✗ Partial |

> BARS overrides are captured in the RCD and persisted to `bars_overrides` on the role context. The code review scorer reads them via the `dispositional_weights` scalar, which shifts dimension weights ±50% clamped to [0.5, 1.5]. This is a narrow consumption — the actual BARS anchor text overrides aren't being read by the scorer yet, only the weight shifts.

## Why

The scoring agents currently apply `dispositional_weights` as a numeric scalar shift but don't read the BARS anchor text from `bars_overrides`. The anchor text contains team-specific rubric language that, when injected into scorer prompts, would align scoring output with the team's stated standards (e.g., "this team values collaboration over code purity — the anchor for 'EXCEEDS_EXPECTATIONS' on dimension X should read…"). This is a quality gap in the scoring layer.

## Why NEEDS-REFINEMENT

The strategy explicitly scopes full BARS anchor text consumption to Part 5 via the `BarsOverride` sub-element type. The Part 2 / Phase 0 mention is observational (describing what the scorer _does_ today) rather than a work request. Two options:

**Option A (defer):** Leave anchor text consumption to Part 5 when `BarsOverride` sub-elements are available. No new work here.  
**Option B (Phase 0 partial):** Inject the raw `bars_overrides[].anchor_text` fields from `rcd_json` into the scorer prompt as a prompt-engineering change. Low risk, no schema change, delivers quality improvement before the full sub-element architecture lands.

This plan is a placeholder until the product owner decides Option A vs. B. Do not implement without explicit decision.

## Subtasks (delegable)

_Not defined — requires Option A/B decision first._

## Dependencies

- Depends on: Product decision on Option A vs. B
- Blocks: Nothing at current scope
- Full anchor-per-dimension consumption: see Part 5 BarsOverride sub-element plan

## Acceptance criteria

_Deferred pending refinement._
