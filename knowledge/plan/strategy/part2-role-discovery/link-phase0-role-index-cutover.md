# ROLE_INDEX Cutover to RCD Narrative

**Status:** LINKED-ONLY  
**Phase:** 0  
**Covered by:** [docs/plans/phase0-subagent-execution-plan.md — Subagent F](../../phase0-subagent-execution-plan.md#subagent-f----cut-over-role_index-to-rcd-narrative)

**Source:** knowledge/plan/pipe-strategy-v2-part2-role-discovery.md (lines 202–203)

Switch all `buildRoleSearchableProfile` call sites in `routes/discovery/roleContexts.ts` to `buildRcdSearchProfile`, and run `scripts/backfillRoleEmbeddings.ts` against existing role contexts. Status: ✅ COMPLETE per phase0 plan.
