# autoStageBuilder RCD Primary Cutover

**Status:** LINKED-ONLY  
**Phase:** 0  
**Covered by:** [docs/plans/phase0-subagent-execution-plan.md — Subagent D](../../phase0-subagent-execution-plan.md#subagent-d----cut-over-autostagebuilder-to-rcd-primary)

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part2-role-discovery.md (lines 200–201)

`buildMatchRequest()` in `lib/match/autoStageBuilder.ts` now reads RCD `technical_context` and `domain_matrix` with `persona_json` fallback. Status: ✅ COMPLETE per phase0 plan.
